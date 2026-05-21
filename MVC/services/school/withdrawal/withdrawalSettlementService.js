const schoolRepositories = require('../../../repositories/school');
const { idsEqual, toPublicId } = require('../../../utils/idAdapter');

function asIdArray(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)));
}

function roundMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(2));
}

function normalizeManualSettlementRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const debitAccountId = toPublicId(row?.debitAccountId || '');
      const debitAccountCode = String(row?.debitAccountCode || '').trim();
      const debitAccountName = String(row?.debitAccountName || '').trim();
      const creditAccountId = toPublicId(row?.creditAccountId || '');
      const creditAccountCode = String(row?.creditAccountCode || '').trim();
      const creditAccountName = String(row?.creditAccountName || '').trim();
      const amount = roundMoney(row?.amount || 0);
      const memo = String(row?.memo || '').trim();
      return {
        index: index + 1,
        debitAccountId,
        debitAccountCode,
        debitAccountName,
        creditAccountId,
        creditAccountCode,
        creditAccountName,
        amount,
        memo
      };
    })
    .filter((row) => row.amount > 0 || row.debitAccountId || row.creditAccountId || row.memo);
}

function isClassLinkedTransaction(tx, classId = '') {
  const targetClassId = toPublicId(classId || '');
  const metadataClassId = toPublicId(tx?.metadata?.classId || '');
  const feeClassId = toPublicId(tx?.fee?.classId || '');
  const sourceEventType = String(tx?.source?.eventType || '').trim().toLowerCase();
  const sourceEventId = String(tx?.source?.eventId || '').trim();
  const sourceIdempotencyKey = String(tx?.source?.idempotencyKey || '').trim();

  if (targetClassId) {
    if (idsEqual(metadataClassId, targetClassId)) return true;
    if (idsEqual(feeClassId, targetClassId)) return true;
    if (sourceEventId.includes(targetClassId)) return true;
    if (sourceIdempotencyKey.includes(`|${targetClassId}|`)) return true;
    return false;
  }

  if (metadataClassId || feeClassId) return true;
  if (sourceEventType === 'class_fee') return true;
  return sourceIdempotencyKey.includes('TRMCLASS|');
}

function shouldIncludeByClassScope(tx, includeClassLinked = 'all', classId = '') {
  if (includeClassLinked === 'all') return true;
  const linked = isClassLinkedTransaction(tx, classId);
  if (includeClassLinked === 'only') return linked;
  if (includeClassLinked === 'exclude') return !linked;
  return true;
}

async function getEligibleSourceTransactions({
  orgId,
  relatedTransactionIds,
  includeClassLinked = 'all',
  classId = ''
}) {
  const targetOrgId = toPublicId(orgId || '');
  const ids = asIdArray(relatedTransactionIds);
  if (!ids.length) return { transactions: [], warnings: [] };

  const warnings = [];
  const rows = [];

  for (const txId of ids) {
    const row = await schoolRepositories.globalTransactions.getById(txId);
    if (!row) {
      warnings.push(`Financial transaction ${txId} was not found for settlement.`);
      continue;
    }
    if (targetOrgId && !idsEqual(row?.orgId || '', targetOrgId)) continue;
    if (String(row?.status || '').toLowerCase() !== 'posted') continue;
    if (String(row?.reversalOfTransactionId || '').trim()) continue;
    if (!shouldIncludeByClassScope(row, includeClassLinked, classId)) continue;

    const existingReverse = await schoolRepositories.globalTransactions.findReversalByTransactionId(txId);
    if (existingReverse) continue;
    rows.push(row);
  }

  return { transactions: rows, warnings };
}

function buildFallbackParty(withdrawalRecord, seedTx) {
  const seedParty = seedTx?.party || {};
  const studentId = toPublicId(seedParty.studentId || withdrawalRecord?.studentId || '');
  const programId = toPublicId(seedParty.programId || withdrawalRecord?.programId || '');
  if (!studentId || !programId) {
    throw new Error('Settlement row creation requires student/program context.');
  }

  return {
    studentId,
    personId: toPublicId(seedParty.personId || withdrawalRecord?.personId || ''),
    programId,
    feeCategory: String(seedParty.feeCategory || 'general').trim() || 'general'
  };
}

function buildFallbackFee(seedTx) {
  const seedFee = seedTx?.fee || {};
  const category = String(seedFee.category || 'withdrawal_refund').trim() || 'withdrawal_refund';
  const code = String(seedFee.code || 'WDR_REFUND').trim().toUpperCase();
  const label = String(seedFee.label || 'Withdrawal Refund Settlement').trim() || 'Withdrawal Refund Settlement';
  return {
    category,
    code,
    label,
    frequency: String(seedFee.frequency || 'one_time').trim().toLowerCase() || 'one_time',
    isOptional: Boolean(seedFee.isOptional)
  };
}

function buildRowMetadata(row, side, withdrawalId) {
  const accountId = side === 'debit' ? row.debitAccountId : row.creditAccountId;
  const accountCode = side === 'debit' ? row.debitAccountCode : row.creditAccountCode;
  const accountName = side === 'debit' ? row.debitAccountName : row.creditAccountName;
  const counterAccountId = side === 'debit' ? row.creditAccountId : row.debitAccountId;
  const counterAccountCode = side === 'debit' ? row.creditAccountCode : row.debitAccountCode;
  const counterAccountName = side === 'debit' ? row.creditAccountName : row.debitAccountName;

  return {
    accountId,
    accountCode,
    accountName,
    counterAccountId,
    counterAccountCode,
    counterAccountName,
    settlementWithdrawalId: withdrawalId,
    settlementRowIndex: row.index,
    settlementMode: 'manual_double_entry'
  };
}

async function settleRefundWithManualEntries({
  withdrawalRecord,
  orgId,
  effectiveDate,
  reason = '',
  manualRows,
  relatedTransactionIds,
  reqUser
}) {
  void reqUser;
  const withdrawalId = toPublicId(withdrawalRecord?.id || '');
  const targetOrgId = toPublicId(orgId || withdrawalRecord?.orgId || '');
  const existingSettlementIds = asIdArray(withdrawalRecord?.financialImpact?.refundTransactionIds);

  if (!withdrawalId || !targetOrgId) {
    return {
      transactionIds: existingSettlementIds,
      settledRefundAmount: 0,
      sourceChargeBase: 0,
      ratio: 0,
      warnings: ['Withdrawal context is incomplete. Financial settlement skipped.']
    };
  }

  if (existingSettlementIds.length) {
    return {
      transactionIds: existingSettlementIds,
      settledRefundAmount: roundMoney(withdrawalRecord?.financialImpact?.refundAmount || 0),
      sourceChargeBase: 0,
      ratio: 0,
      warnings: []
    };
  }

  const rows = normalizeManualSettlementRows(manualRows);
  if (!rows.length) {
    return {
      transactionIds: [],
      settledRefundAmount: 0,
      sourceChargeBase: 0,
      ratio: 0,
      warnings: ['No manual settlement rows were provided.']
    };
  }

  const invalidRow = rows.find((row) => !row.debitAccountId || !row.creditAccountId || row.amount <= 0);
  if (invalidRow) {
    throw new Error(`Settlement row #${invalidRow.index} is incomplete. Debit account, credit account, and positive amount are required.`);
  }

  const debitTotal = roundMoney(rows.reduce((sum, row) => sum + row.amount, 0));
  const creditTotal = roundMoney(rows.reduce((sum, row) => sum + row.amount, 0));
  if (debitTotal <= 0) {
    throw new Error('Manual settlement total must be greater than zero.');
  }
  if (Math.abs(debitTotal - creditTotal) > 0.009) {
    throw new Error('Manual settlement is not balanced between debit and credit totals.');
  }

  const { transactions: seedRows } = await getEligibleSourceTransactions({
    orgId: targetOrgId,
    relatedTransactionIds,
    includeClassLinked: 'all',
    classId: ''
  });
  const seedTx = seedRows[0] || null;
  const party = buildFallbackParty(withdrawalRecord, seedTx);
  const fee = buildFallbackFee(seedTx);
  const currency = String(seedTx?.amount?.currency || 'CAD').trim().toUpperCase() || 'CAD';

  const createPayload = [];
  rows.forEach((row) => {
    const memoBase = row.memo || `Manual withdrawal settlement row ${row.index}`;
    const linePrefix = `WDRMAN|PROGRAM|${withdrawalId}|${row.index}`;
    createPayload.push({
      orgId: targetOrgId,
      postedAt: new Date().toISOString(),
      effectiveDate: effectiveDate || new Date().toISOString().slice(0, 10),
      status: 'posted',
      transactionType: 'adjustment',
      source: {
        module: 'school_withdrawal',
        eventType: 'withdrawal_financial_settlement_manual',
        eventId: `WDRMAN-DEBIT-${withdrawalId}-${row.index}`,
        idempotencyKey: `${linePrefix}|DEBIT`
      },
      party: { ...party },
      fee: { ...fee },
      amount: {
        value: row.amount,
        currency,
        direction: 'debit'
      },
      balanceEffect: row.amount,
      memo: memoBase,
      internalNote: `Manual withdrawal settlement (debit), withdrawal ${withdrawalId}${reason ? `: ${reason}` : ''}`,
      externalReference: withdrawalId,
      reconciliationStatus: 'unreconciled',
      reversalOfTransactionId: '',
      metadata: buildRowMetadata(row, 'debit', withdrawalId)
    });

    createPayload.push({
      orgId: targetOrgId,
      postedAt: new Date().toISOString(),
      effectiveDate: effectiveDate || new Date().toISOString().slice(0, 10),
      status: 'posted',
      transactionType: 'adjustment',
      source: {
        module: 'school_withdrawal',
        eventType: 'withdrawal_financial_settlement_manual',
        eventId: `WDRMAN-CREDIT-${withdrawalId}-${row.index}`,
        idempotencyKey: `${linePrefix}|CREDIT`
      },
      party: { ...party },
      fee: { ...fee },
      amount: {
        value: row.amount,
        currency,
        direction: 'credit'
      },
      balanceEffect: -row.amount,
      memo: memoBase,
      internalNote: `Manual withdrawal settlement (credit), withdrawal ${withdrawalId}${reason ? `: ${reason}` : ''}`,
      externalReference: withdrawalId,
      reconciliationStatus: 'unreconciled',
      reversalOfTransactionId: '',
      metadata: buildRowMetadata(row, 'credit', withdrawalId)
    });
  });

  const created = await schoolRepositories.globalTransactions.create(createPayload);
  const createdRows = Array.isArray(created) ? created : [created];
  const transactionIds = createdRows.map((tx) => toPublicId(tx?.id || '')).filter(Boolean);

  return {
    transactionIds,
    settledRefundAmount: debitTotal,
    sourceChargeBase: debitTotal,
    ratio: 1,
    warnings: []
  };
}

async function settleRefundFromTransactions({
  withdrawalRecord,
  orgId,
  scopeType,
  relatedTransactionIds,
  targetRefundAmount,
  effectiveDate,
  reason = '',
  includeClassLinked = 'all',
  classId = '',
  reqUser
}) {
  const withdrawalId = toPublicId(withdrawalRecord?.id || '');
  const targetOrgId = toPublicId(orgId || withdrawalRecord?.orgId || '');
  const existingSettlementIds = asIdArray(withdrawalRecord?.financialImpact?.refundTransactionIds);

  if (!withdrawalId || !targetOrgId) {
    return {
      transactionIds: existingSettlementIds,
      settledRefundAmount: 0,
      sourceChargeBase: 0,
      ratio: 0,
      warnings: ['Withdrawal context is incomplete. Financial settlement skipped.']
    };
  }

  if (existingSettlementIds.length) {
    return {
      transactionIds: existingSettlementIds,
      settledRefundAmount: roundMoney(withdrawalRecord?.financialImpact?.refundAmount || 0),
      sourceChargeBase: 0,
      ratio: 0,
      warnings: []
    };
  }

  const requestedRefund = roundMoney(targetRefundAmount);
  if (!(requestedRefund > 0)) {
    return {
      transactionIds: [],
      settledRefundAmount: 0,
      sourceChargeBase: 0,
      ratio: 0,
      warnings: []
    };
  }

  const { transactions: sourceRows, warnings } = await getEligibleSourceTransactions({
    orgId: targetOrgId,
    relatedTransactionIds,
    includeClassLinked,
    classId
  });
  if (!sourceRows.length) {
    return {
      transactionIds: [],
      settledRefundAmount: 0,
      sourceChargeBase: 0,
      ratio: 0,
      warnings
    };
  }

  const debitBase = roundMoney(sourceRows.reduce((sum, tx) => (
    String(tx?.amount?.direction || '').toLowerCase() === 'debit'
      ? sum + Number(tx?.amount?.value || 0)
      : sum
  ), 0));
  if (!(debitBase > 0)) {
    return {
      transactionIds: [],
      settledRefundAmount: 0,
      sourceChargeBase: 0,
      ratio: 0,
      warnings: warnings.concat(['No debit-side source charges were found for settlement.'])
    };
  }

  const ratio = Math.max(0, Math.min(1, requestedRefund / debitBase));
  if (!(ratio > 0)) {
    return {
      transactionIds: [],
      settledRefundAmount: 0,
      sourceChargeBase: debitBase,
      ratio,
      warnings
    };
  }
  if (requestedRefund > debitBase) {
    warnings.push(`Requested refund (${requestedRefund}) exceeds source charge base (${debitBase}). Refund was capped.`);
  }

  const transactionIds = [];
  let settledRefundAmount = 0;
  let index = 0;
  for (const sourceTx of sourceRows) {
    index += 1;
    const sourceAmount = roundMoney(sourceTx?.amount?.value || 0);
    const settlementAmount = roundMoney(sourceAmount * ratio);
    if (!(settlementAmount > 0)) continue;

    const originalDirection = String(sourceTx?.amount?.direction || '').toLowerCase();
    const flippedDirection = originalDirection === 'debit' ? 'credit' : 'debit';
    const baseEffect = Number(sourceTx?.balanceEffect || 0);
    const settlementBalanceEffect = roundMoney(baseEffect * -ratio);
    const key = `WDRSET|${String(scopeType || 'withdrawal').toUpperCase()}|${withdrawalId}|${sourceTx.id}`;

    try {
      const created = await schoolRepositories.globalTransactions.create({
        orgId: targetOrgId,
        postedAt: new Date().toISOString(),
        effectiveDate: effectiveDate || new Date().toISOString().slice(0, 10),
        status: 'posted',
        transactionType: 'adjustment',
        source: {
          module: 'school_withdrawal',
          eventType: 'withdrawal_financial_settlement',
          eventId: `WDRSET-${withdrawalId}-${index}-${sourceTx.id}`,
          idempotencyKey: key
        },
        party: { ...(sourceTx?.party || {}) },
        fee: { ...(sourceTx?.fee || {}) },
        amount: {
          value: settlementAmount,
          currency: String(sourceTx?.amount?.currency || 'CAD').trim().toUpperCase() || 'CAD',
          direction: flippedDirection
        },
        balanceEffect: settlementBalanceEffect,
        memo: `Withdrawal settlement for ${sourceTx.id}`,
        internalNote: `Policy settlement for withdrawal ${withdrawalId}${reason ? `: ${reason}` : ''}`,
        externalReference: withdrawalId,
        reconciliationStatus: 'unreconciled',
        reversalOfTransactionId: '',
        metadata: {
          ...(sourceTx?.metadata || {}),
          settlementSourceTransactionId: String(sourceTx.id || ''),
          settlementWithdrawalId: withdrawalId,
          settlementScopeType: String(scopeType || ''),
          settlementRatio: ratio,
          settlementMode: ratio >= 0.9999 ? 'full_refund' : 'partial_refund'
        }
      });

      const createdId = toPublicId(created?.id || '');
      if (createdId) transactionIds.push(createdId);
      if (originalDirection === 'debit') settledRefundAmount = roundMoney(settledRefundAmount + settlementAmount);
    } catch (error) {
      warnings.push(`Failed to create settlement transaction for ${sourceTx.id}: ${error.message}`);
    }
  }

  return {
    transactionIds,
    settledRefundAmount,
    sourceChargeBase: debitBase,
    ratio,
    warnings
  };
}

module.exports = {
  asIdArray,
  roundMoney,
  normalizeManualSettlementRows,
  isClassLinkedTransaction,
  getEligibleSourceTransactions,
  settleRefundFromTransactions,
  settleRefundWithManualEntries
};
