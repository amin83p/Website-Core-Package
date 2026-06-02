const globalTransactionLedgerModel = require('../../models/school/globalTransactionLedgerModel');
const transactionDefinitionModel = require('../../models/school/transactionDefinitionModel');
const { ALL_FEE_CATEGORIES_KEY } = require('../../models/school/feeCategoryCatalog');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');

function collectFeeLinesForCategory(feeGroups, feeCategory) {
  const normalizedCategory = String(feeCategory || '').trim();
  const globalLines = Array.isArray(feeGroups?.[ALL_FEE_CATEGORIES_KEY]) ? feeGroups[ALL_FEE_CATEGORIES_KEY] : [];
  const specificLines = Array.isArray(feeGroups?.[normalizedCategory]) ? feeGroups[normalizedCategory] : [];
  return globalLines.concat(specificLines);
}

function roundMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(2));
}

function resolveEntryAmounts(definitionEntries, runtimeAmount) {
  const normalizedRuntimeAmount = Number(runtimeAmount);
  const rawDefinitionAmounts = definitionEntries.map((entry) => roundMoney(entry?.amount));
  const positiveAmounts = rawDefinitionAmounts.filter((amount) => Number.isFinite(amount) && amount > 0);
  const runtimeIndexes = rawDefinitionAmounts
    .map((amount, index) => ({ amount, index }))
    .filter((row) => !(row.amount > 0));

  if (!Number.isFinite(normalizedRuntimeAmount) || normalizedRuntimeAmount <= 0) {
    return rawDefinitionAmounts;
  }

  if (!runtimeIndexes.length) {
    return rawDefinitionAmounts.map((amount) => {
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('invalid amount');
      return roundMoney(amount);
    });
  }

  const fixedTotal = roundMoney(positiveAmounts.reduce((sum, amount) => sum + amount, 0));
  const remainingRuntimeAmount = roundMoney(normalizedRuntimeAmount - fixedTotal);
  if (remainingRuntimeAmount < 0) {
    throw new Error(`fixed amount rows exceed the passed total (${fixedTotal.toFixed(2)} > ${roundMoney(normalizedRuntimeAmount).toFixed(2)})`);
  }

  const runtimePercentages = runtimeIndexes.map((row) => {
    const percentage = Number(definitionEntries[row.index]?.percentage);
    return Number.isFinite(percentage) && percentage >= 0 ? roundMoney(percentage) : 0;
  });
  const totalRuntimePercentage = roundMoney(runtimePercentages.reduce((sum, percentage) => sum + percentage, 0));

  if (runtimeIndexes.length === 1 && totalRuntimePercentage === 0) {
    return rawDefinitionAmounts.map((amount, index) => (index === runtimeIndexes[0].index ? remainingRuntimeAmount : amount));
  }
  if (Math.abs(totalRuntimePercentage - 100) > 0.01) {
    throw new Error(`runtime template percentages must total 100 (current total ${totalRuntimePercentage.toFixed(2)})`);
  }

  let runtimeRunning = 0;
  return rawDefinitionAmounts.map((amount, index) => {
    if (amount > 0) return amount;
    const runtimeIndex = runtimeIndexes.findIndex((row) => row.index === index);
    if (runtimeIndex === -1) return 0;
    const resolvedAmount = runtimeIndex === runtimeIndexes.length - 1
      ? roundMoney(remainingRuntimeAmount - runtimeRunning)
      : roundMoney(remainingRuntimeAmount * ((runtimePercentages[runtimeIndex] || 0) / 100));
    runtimeRunning += resolvedAmount;
    return resolvedAmount;
  });
}

function buildTransactionsForFeeLines({
  feeGroups,
  feeCategory,
  student,
  transactionDefinitions,
  allAccounts,
  reqUser,
  requestBody = {},
  orgId,
  sourceModule = 'school_program',
  sourceType = 'program_transaction_definition',
  sourceEventType = 'fee_transactions_apply',
  sourceEventIdBase = '',
  idempotencyBase = '',
  externalReference = '',
  party = {},
  fee = {},
  memoLabel = 'Transaction',
  internalNote = 'Fee transaction applied',
  metadata = {},
  transactionType = 'charge'
}) {
  const normalizedFeeCategory = String(feeCategory || '').trim();
  const categoryLines = collectFeeLinesForCategory(feeGroups, normalizedFeeCategory);
  if (!normalizedFeeCategory) throw new Error('Student fee category is required to apply transactions.');
  if (!categoryLines.length) {
    return { items: [], skipped: [`No transaction rows found for fee category "${normalizedFeeCategory}".`] };
  }

  const txDefsById = new Map((transactionDefinitions || []).map((d) => [toPublicId(d.id), d]));
  const txDefsByCode = new Map(
    (transactionDefinitions || [])
      .filter((d) => d.code)
      .map((d) => [String(d.code).toUpperCase(), d])
  );
  const accountsById = new Map((allAccounts || []).map((a) => [toPublicId(a.id), a]));

  const effectiveOrgId = toPublicId(orgId || student?.orgId);
  const allowedOrgIds = new Set([effectiveOrgId, 'SYSTEM']);
  const effectiveDate = String(requestBody.effectiveDate || '').trim() || new Date().toISOString().slice(0, 10);
  const safeSourceEventType = String(sourceEventType || 'fee_transactions_apply').trim();
  const rawSourceEventIdBase = String(sourceEventIdBase || `FEEAPPLY-${student?.id || 'student'}-${Date.now()}`).trim();
  const safeSourceEventIdBase = rawSourceEventIdBase
    .replace(/[^A-Za-z0-9_.:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || `FEEAPPLY-${student?.id || 'student'}`;
  const safeIdempotencyBase = String(idempotencyBase || `${safeSourceEventType}|${student?.id || ''}|${safeSourceEventIdBase}`).trim();

  const items = [];
  const skipped = [];

  function resolveRefToAccount(refRaw) {
    const ref = transactionDefinitionModel.parseAccountRef(refRaw);
    if (ref.kind === 'ACCOUNT') {
      const account = accountsById.get(toPublicId(ref.value));
      if (!account) throw new Error(`Account not found for reference ${ref.ref}`);
      if (!allowedOrgIds.has(toPublicId(account.orgId))) {
        throw new Error(`Account ${account.id} is outside organization scope.`);
      }
      if (!account.allowPost || String(account.status || '').toLowerCase() !== 'active') {
        throw new Error(`Account ${account.id} is not active/postable.`);
      }
      return account;
    }

    if (String(ref.value || '').toLowerCase() === 'student') {
      const studentAccountId = toPublicId(student?.studentAccountId);
      if (studentAccountId) {
        const studentAccount = accountsById.get(studentAccountId);
        if (!studentAccount) throw new Error(`Student account ${studentAccountId} was not found.`);
        if (!allowedOrgIds.has(toPublicId(studentAccount.orgId))) {
          throw new Error(`Student account ${studentAccountId} is outside organization scope.`);
        }
        if (!studentAccount.allowPost || String(studentAccount.status || '').toLowerCase() !== 'active') {
          throw new Error(`Student account ${studentAccountId} is not active/postable.`);
        }
        return studentAccount;
      }
    }

    const roleCandidates = (allAccounts || []).filter((a) =>
      idsEqual(a.orgId, effectiveOrgId) &&
      String(a.partyRole || 'none') === String(ref.value) &&
      a.allowPost &&
      String(a.status || '').toLowerCase() === 'active'
    );
    if (!roleCandidates.length) {
      throw new Error(`No active postable account found for role "${ref.value}".`);
    }

    return roleCandidates.find((a) => Boolean(a.isControl))
      || roleCandidates.slice().sort((a, b) => Number(a.level || 0) - Number(b.level || 0))[0];
  }

  categoryLines.forEach((line, idx) => {
    const lineObj = (line && typeof line === 'object') ? line : {};
    const txId = toPublicId(lineObj.transactionDefinitionId);
    const txCode = String(lineObj.code || '').trim().toUpperCase();
    const txDef = txId ? txDefsById.get(txId) : (txCode ? txDefsByCode.get(txCode) : null);

    if (!txDef) {
      skipped.push(`Category "${normalizedFeeCategory}" row #${idx + 1} has no valid transaction template.`);
      return;
    }
    if (String(txDef.status || '').toLowerCase() !== 'active') {
      skipped.push(`Transaction template "${txDef.code || txDef.id}" is not active.`);
      return;
    }
    if (txDef.validFrom && effectiveDate < String(txDef.validFrom)) {
      skipped.push(`Transaction template "${txDef.code || txDef.id}" is not yet valid on ${effectiveDate}.`);
      return;
    }
    if (txDef.validTo && effectiveDate > String(txDef.validTo)) {
      skipped.push(`Transaction template "${txDef.code || txDef.id}" expired before ${effectiveDate}.`);
      return;
    }

    const definitionEntries = Array.isArray(txDef.entries) ? txDef.entries : [];
    if (!definitionEntries.length) {
      skipped.push(`Transaction template "${txDef.code || txDef.id}" has no posting entries.`);
      return;
    }

    let entryAmounts;
    try {
      entryAmounts = resolveEntryAmounts(definitionEntries, lineObj.amount);
    } catch (amountError) {
      skipped.push(`Transaction "${txDef.code || txDef.id}" skipped: ${amountError.message}`);
      return;
    }

    definitionEntries.forEach((definitionEntry, entryIndex) => {
      try {
        const debitAccount = resolveRefToAccount(definitionEntry.debitRef);
        const creditAccount = resolveRefToAccount(definitionEntry.creditRef);
        const txAmount = Number(entryAmounts[entryIndex]);
        if (!Number.isFinite(txAmount) || txAmount <= 0) {
          throw new Error('invalid amount');
        }

        const txCurrency = String(lineObj.currency || definitionEntry.currency || 'CAD').trim().toUpperCase();
        const lineKey = `${String(txDef.id)}-${idx + 1}-${entryIndex + 1}`;
        const memoTemplate = String(
          lineObj.notes ||
          definitionEntry.memoTemplate ||
          `${memoLabel}: ${txDef.name || txDef.code || txDef.id}`
        ).trim();

        const memo = globalTransactionLedgerModel.resolveMemoTemplate(memoTemplate, {
          orgId: effectiveOrgId,
          studentId: String(student?.id || ''),
          personId: String(student?.personId || ''),
          feeCategory: normalizedFeeCategory,
          effectiveDate,
          externalReference,
          amount: txAmount,
          currency: txCurrency,
          lineIndex: idx + 1,
          entryId: definitionEntry.entryId || `ENTRY_${entryIndex + 1}`,
          sourceEventType: safeSourceEventType,
          sourceEventId: rawSourceEventIdBase,
          transactionDefinitionId: String(txDef.id),
          transactionDefinitionCode: String(txDef.code || ''),
          transactionDefinitionName: String(txDef.name || ''),
          ...party
        });

        const base = {
          orgId: effectiveOrgId,
          status: 'posted',
          postedAt: new Date().toISOString(),
          effectiveDate,
          transactionType: String(transactionType || 'charge').trim().toLowerCase() || 'charge',
          party: {
            studentId: String(student?.id || ''),
            personId: String(student?.personId || ''),
            feeCategory: normalizedFeeCategory,
            ...party
          },
          fee: {
            category: normalizedFeeCategory,
            code: String(txDef.code || lineObj.code || '').toUpperCase(),
            label: String(txDef.name || lineObj.label || '').trim(),
            frequency: String(lineObj.frequency || txDef.frequency || 'one_time').trim().toLowerCase() || 'one_time',
            isOptional: lineObj.isOptional === undefined ? false : Boolean(lineObj.isOptional),
            sourceAmount: Number.isFinite(Number(lineObj.amount)) ? roundMoney(lineObj.amount) : null,
            ...fee
          },
          amount: {
            value: txAmount,
            currency: txCurrency
          },
          memo,
          externalReference,
          internalNote,
          metadata: {
            sourceType,
            studentId: String(student?.id || ''),
            transactionDefinitionId: String(txDef.id),
            transactionDefinitionCode: String(txDef.code || ''),
            lineIndex: idx,
            entryIndex,
            generatedBy: String(reqUser?.id || reqUser?.username || 'system'),
            ...metadata
          }
        };

        items.push(
          {
            ...base,
            source: {
              module: sourceModule,
              eventType: safeSourceEventType,
              eventId: `${safeSourceEventIdBase}-${lineKey}-DR`,
              idempotencyKey: `${safeIdempotencyBase}|${lineKey}|DR`
            },
            amount: { ...base.amount, direction: 'debit' },
            metadata: {
              ...base.metadata,
              ledgerSide: 'debit',
              accountId: debitAccount.id,
              accountCode: debitAccount.code,
              accountName: debitAccount.name
            }
          },
          {
            ...base,
            source: {
              module: sourceModule,
              eventType: safeSourceEventType,
              eventId: `${safeSourceEventIdBase}-${lineKey}-CR`,
              idempotencyKey: `${safeIdempotencyBase}|${lineKey}|CR`
            },
            amount: { ...base.amount, direction: 'credit' },
            metadata: {
              ...base.metadata,
              ledgerSide: 'credit',
              accountId: creditAccount.id,
              accountCode: creditAccount.code,
              accountName: creditAccount.name
            }
          }
        );
      } catch (entryError) {
        skipped.push(`Transaction "${txDef.code || txDef.id}" line ${entryIndex + 1} skipped: ${entryError.message}`);
      }
    });
  });

  return { items, skipped };
}

function buildProgramTransactionsForStudent({
  program,
  student,
  transactionDefinitions,
  allAccounts,
  reqUser,
  requestBody
}) {
  return buildTransactionsForFeeLines({
    feeGroups: program?.feeGroups,
    feeCategory: student?.feeCategory,
    student,
    transactionDefinitions,
    allAccounts,
    reqUser,
    requestBody,
    orgId: program?.orgId || student?.orgId,
    sourceModule: 'school_program',
    sourceType: 'program_transaction_definition',
    sourceEventType: String(requestBody?.sourceEventType || 'program_transactions_apply').trim(),
    sourceEventIdBase: String(requestBody?.sourceEventId || `PRGAPPLY-${program?.id || 'program'}-${student?.id || 'student'}-${Date.now()}`).trim(),
    idempotencyBase: String(requestBody?.idempotencyKey || `PRGAPPLY|${program?.id || ''}|${student?.id || ''}|${requestBody?.sourceEventId || ''}`).trim(),
    externalReference: String(requestBody?.externalReference || '').trim(),
    party: {
      programId: String(program?.id || '')
    },
    memoLabel: 'Program transaction',
    internalNote: `Program transaction applied (${program?.id || ''})`,
    metadata: {
      programId: String(program?.id || '')
    }
  });
}

function buildPreviewRowsFromTransactions(items) {
  const previewItems = [];
  for (let i = 0; i < items.length; i += 2) {
    const debit = items[i];
    const credit = items[i + 1];
    previewItems.push({
      memo: debit?.memo || '',
      amount: debit?.amount?.value || 0,
      currency: debit?.amount?.currency || '',
      debitAccount: {
        id: debit?.metadata?.accountId || '',
        code: debit?.metadata?.accountCode || '',
        name: debit?.metadata?.accountName || ''
      },
      creditAccount: {
        id: credit?.metadata?.accountId || '',
        code: credit?.metadata?.accountCode || '',
        name: credit?.metadata?.accountName || ''
      }
    });
  }
  return previewItems;
}

module.exports = {
  collectFeeLinesForCategory,
  buildTransactionsForFeeLines,
  buildProgramTransactionsForStudent,
  buildPreviewRowsFromTransactions
};
