const globalTransactionLedgerModel = require('../../models/school/globalTransactionLedgerModel');
const { parseAccountRef } = require('../../models/school/transactionDefinitionModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { resolveOrgTodayFromContext } = requireCoreModule('MVC/utils/timezoneUtils');

function parseJsonSafe(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function roundMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(2));
}

function buildTransactionDefinitionPayload(body, orgId) {
  const metadata = parseJsonSafe(body?.metadata, {});
  const entries = parseJsonSafe(body?.entries, []);

  return {
    orgId: toPublicId(orgId),
    code: String(body?.code || '').trim(),
    name: String(body?.name || '').trim(),
    description: String(body?.description || '').trim(),
    status: String(body?.status || 'active').trim(),
    validFrom: String(body?.validFrom || '').trim(),
    validTo: String(body?.validTo || '').trim(),
    entries: Array.isArray(entries) ? entries : [],
    notes: String(body?.notes || '').trim(),
    metadata: (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) ? metadata : {}
  };
}

function resolvePreviewEntryAmounts(entries, runtimeAmount) {
  const normalizedRuntimeAmount = Number(runtimeAmount);
  const safeEntries = Array.isArray(entries) ? entries : [];
  const storedAmounts = safeEntries.map((entry) => roundMoney(entry?.amount));
  const runtimeIndexes = storedAmounts
    .map((amount, index) => ({ amount, index }))
    .filter((row) => !(row.amount > 0));

  if (!Number.isFinite(normalizedRuntimeAmount) || normalizedRuntimeAmount <= 0) {
    return storedAmounts;
  }

  if (!runtimeIndexes.length) {
    return storedAmounts;
  }

  const fixedTotal = roundMoney(storedAmounts.reduce((sum, amount) => sum + (amount > 0 ? amount : 0), 0));
  const remainingRuntimeAmount = roundMoney(normalizedRuntimeAmount - fixedTotal);
  if (remainingRuntimeAmount < 0) {
    throw new Error(`Fixed amount rows exceed the passed total (${fixedTotal.toFixed(2)} > ${roundMoney(normalizedRuntimeAmount).toFixed(2)}).`);
  }

  const percentages = runtimeIndexes.map((row) => roundMoney(safeEntries[row.index]?.percentage));
  const totalPercentage = roundMoney(percentages.reduce((sum, value) => sum + value, 0));
  if (runtimeIndexes.length === 1 && totalPercentage === 0) {
    return storedAmounts.map((amount, index) => (index === runtimeIndexes[0].index ? remainingRuntimeAmount : amount));
  }
  if (Math.abs(totalPercentage - 100) > 0.01) {
    throw new Error(`Runtime template percentages must total 100. Current total is ${totalPercentage.toFixed(2)}.`);
  }

  let running = 0;
  return storedAmounts.map((amount, index) => {
    if (amount > 0) return amount;
    const runtimeIndex = runtimeIndexes.findIndex((row) => row.index === index);
    if (runtimeIndex === -1) return 0;
    const resolvedAmount = runtimeIndex === runtimeIndexes.length - 1
      ? roundMoney(remainingRuntimeAmount - running)
      : roundMoney(remainingRuntimeAmount * ((percentages[runtimeIndex] || 0) / 100));
    running += resolvedAmount;
    return resolvedAmount;
  });
}

function buildAccountLookup(allAccounts) {
  const rows = Array.isArray(allAccounts) ? allAccounts : [];
  const byId = new Map(rows.map((row) => [toPublicId(row?.id), row]));
  return { rows, byId };
}

function resolveRefToAccount(refRaw, allAccounts, orgId, partyContext = {}) {
  const ref = parseAccountRef(refRaw);
  const effectiveOrgId = toPublicId(orgId);
  const allowedOrgIds = new Set([effectiveOrgId, 'SYSTEM']);
  const { rows, byId } = buildAccountLookup(allAccounts);

  if (ref.kind === 'ACCOUNT') {
    const account = byId.get(toPublicId(ref.value));
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
    const studentAccountId = toPublicId(partyContext?.studentAccountId);
    if (studentAccountId) {
      const studentAccount = byId.get(studentAccountId);
      if (!studentAccount) throw new Error(`Student account ${studentAccountId} was not found.`);
      if (!allowedOrgIds.has(toPublicId(studentAccount.orgId))) {
        throw new Error(`Student account ${studentAccount.id} is outside organization scope.`);
      }
      if (!studentAccount.allowPost || String(studentAccount.status || '').toLowerCase() !== 'active') {
        throw new Error(`Student account ${studentAccount.id} is not active/postable.`);
      }
      return studentAccount;
    }
  }

  const roleCandidates = rows.filter((account) =>
    idsEqual(account?.orgId, effectiveOrgId) &&
    String(account?.partyRole || 'none') === String(ref.value) &&
    account?.allowPost &&
    String(account?.status || '').toLowerCase() === 'active'
  );

  if (!roleCandidates.length) {
    throw new Error(`No active postable account is labeled with role "${ref.value}" in this organization.`);
  }

  return roleCandidates.find((account) => Boolean(account.isControl))
    || roleCandidates.slice().sort((a, b) => Number(a.level || 0) - Number(b.level || 0))[0];
}

function buildPreviewRows(definition, allAccounts, orgId, partyContext = {}) {
  const entries = Array.isArray(definition?.entries) ? definition.entries : [];
  const resolvedAmounts = resolvePreviewEntryAmounts(entries, partyContext?.amount);

  return entries.map((line, idx) => {
    const debitAccount = resolveRefToAccount(line?.debitRef, allAccounts, orgId, partyContext);
    const creditAccount = resolveRefToAccount(line?.creditRef, allAccounts, orgId, partyContext);
    return {
      lineIndex: idx + 1,
      entryId: line?.entryId || `ENTRY_${idx + 1}`,
      amount: Number(resolvedAmounts[idx] || 0),
      currency: line?.currency || 'CAD',
      memoTemplate: line?.memoTemplate || '',
      debitAccount: {
        id: toPublicId(debitAccount?.id),
        code: debitAccount?.code || '',
        name: debitAccount?.name || '',
        role: debitAccount?.partyRole || 'none'
      },
      creditAccount: {
        id: toPublicId(creditAccount?.id),
        code: creditAccount?.code || '',
        name: creditAccount?.name || '',
        role: creditAccount?.partyRole || 'none'
      }
    };
  });
}

function filterPostingAccountsForForm(allAccounts, activeOrgId, isSuperAdmin) {
  const effectiveOrgId = toPublicId(activeOrgId);
  const rows = Array.isArray(allAccounts) ? allAccounts : [];

  const orgScoped = isSuperAdmin
    ? rows
    : rows.filter((account) => {
      const accountOrgId = toPublicId(account?.orgId);
      return idsEqual(accountOrgId, effectiveOrgId) || accountOrgId === 'SYSTEM';
    });

  return orgScoped
    .filter((account) => account?.allowPost && String(account?.status || '').toLowerCase() === 'active')
    .sort((a, b) => String(a?.code || '').localeCompare(String(b?.code || '')));
}

function buildPostingItemsFromPreview({
  definition,
  previewRows,
  orgId,
  requestBody = {},
  reqUser
}) {
  const effectiveOrgId = toPublicId(orgId);
  const studentId = toPublicId(requestBody.studentId) || 'DIRECT';
  const programId = toPublicId(requestBody.programId) || 'DIRECT';
  const feeCategory = String(requestBody.feeCategory || '').trim() || 'general';
  const personId = toPublicId(requestBody.personId);
  const teacherId = toPublicId(requestBody.teacherId);
  const teacherPersonId = toPublicId(requestBody.teacherPersonId);
  const staffId = toPublicId(requestBody.staffId);
  const staffPersonId = toPublicId(requestBody.staffPersonId);
  const parentId = toPublicId(requestBody.parentId);
  const parentPersonId = toPublicId(requestBody.parentPersonId);
  const vendorId = toPublicId(requestBody.vendorId);
  const vendorName = String(requestBody.vendorName || '').trim();
  const organizationId = toPublicId(requestBody.organizationId);
  const organizationName = String(requestBody.organizationName || '').trim();
  const entityId = toPublicId(requestBody.entityId);
  const entityName = String(requestBody.entityName || '').trim();
  const externalReference = String(requestBody.externalReference || '').trim();
  const effectiveDate = String(requestBody.effectiveDate || '').trim() || resolveOrgTodayFromContext({ orgToday: reqUser?.orgToday, user: reqUser });
  const sourceEventType = String(requestBody.sourceEventType || 'transaction_definition_apply').trim();
  const sourceEventIdBase = String(requestBody.sourceEventId || `${definition?.id || 'TRX'}-${Date.now()}`).trim();
  const idempotencyBase = String(requestBody.idempotencyKey || `TRXDEF|${toPublicId(definition?.id)}|${sourceEventIdBase}`).trim();

  return (Array.isArray(previewRows) ? previewRows : []).flatMap((row, idx) => {
    const lineKey = `${row?.entryId || `ENTRY_${idx + 1}`}-${idx + 1}`;
    const memoTemplate = row?.memoTemplate || `${definition?.name || definition?.id || 'Transaction'} - line ${row?.lineIndex || idx + 1}`;
    const memo = globalTransactionLedgerModel.resolveMemoTemplate(memoTemplate, {
      orgId: effectiveOrgId,
      studentId,
      personId,
      programId,
      feeCategory,
      teacherId,
      teacherPersonId,
      staffId,
      staffPersonId,
      parentId,
      parentPersonId,
      vendorId,
      vendorName,
      organizationId,
      organizationName,
      entityId,
      entityName,
      effectiveDate,
      externalReference,
      amount: Number(row?.amount || 0),
      currency: row?.currency || 'CAD',
      lineIndex: row?.lineIndex || idx + 1,
      entryId: row?.entryId || `ENTRY_${idx + 1}`,
      sourceEventType,
      sourceEventId: sourceEventIdBase,
      transactionDefinitionId: toPublicId(definition?.id),
      transactionDefinitionCode: String(definition?.code || ''),
      transactionDefinitionName: String(definition?.name || '')
    });

    const base = {
      orgId: effectiveOrgId,
      status: 'posted',
      postedAt: new Date().toISOString(),
      effectiveDate,
      transactionType: 'adjustment',
      party: { studentId, personId, programId, feeCategory },
      fee: {
        category: feeCategory,
        code: String(definition?.code || '').toUpperCase(),
        label: String(definition?.name || ''),
        frequency: '',
        isOptional: false
      },
      amount: { value: Number(row?.amount || 0), currency: row?.currency || 'CAD' },
      memo,
      externalReference,
      internalNote: `Posted from transaction definition ${toPublicId(definition?.id)}`,
      metadata: {
        transactionDefinitionId: toPublicId(definition?.id),
        transactionDefinitionCode: String(definition?.code || ''),
        lineIndex: Number(row?.lineIndex || idx + 1)
      }
    };

    return [
      {
        ...base,
        source: {
          module: 'school_transaction_definition',
          eventType: sourceEventType,
          eventId: `${sourceEventIdBase}|${lineKey}|DR`,
          idempotencyKey: `${idempotencyBase}|${lineKey}|DR`
        },
        amount: { ...base.amount, direction: 'debit' },
        metadata: {
          ...base.metadata,
          ledgerSide: 'debit',
          accountId: toPublicId(row?.debitAccount?.id),
          accountCode: row?.debitAccount?.code || '',
          accountName: row?.debitAccount?.name || ''
        }
      },
      {
        ...base,
        source: {
          module: 'school_transaction_definition',
          eventType: sourceEventType,
          eventId: `${sourceEventIdBase}|${lineKey}|CR`,
          idempotencyKey: `${idempotencyBase}|${lineKey}|CR`
        },
        amount: { ...base.amount, direction: 'credit' },
        metadata: {
          ...base.metadata,
          ledgerSide: 'credit',
          accountId: toPublicId(row?.creditAccount?.id),
          accountCode: row?.creditAccount?.code || '',
          accountName: row?.creditAccount?.name || ''
        }
      }
    ];
  });
}

module.exports = {
  buildTransactionDefinitionPayload,
  resolvePreviewEntryAmounts,
  resolveRefToAccount,
  buildPreviewRows,
  filterPostingAccountsForForm,
  buildPostingItemsFromPreview
};
