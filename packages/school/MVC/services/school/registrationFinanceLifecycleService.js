const schoolRepositories = require('../../repositories/school');
const {
  cleanIds,
  normalizeTransactionSummary,
  beginPostingCycle,
  updatePostingCycle
} = require('../../models/school/registrationTransactionSummary');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function roundMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function normalizeDirection(value) {
  return String(value || '').trim().toLowerCase();
}

function getAccountId(transaction) {
  return toPublicId(transaction?.metadata?.accountId || transaction?.accountId || '');
}

function getDraftLineId(transaction) {
  return String(
    transaction?.metadata?.draftLineId ||
    transaction?.metadata?.registrationLifecycle?.draftLineId ||
    ''
  ).trim();
}

function validateReversalPair(original, reversal) {
  const issues = [];
  if (!original) return ['Original transaction is missing.'];
  if (!reversal) return [`Transaction ${original.id} has not been reversed.`];
  if (String(original.status || '').toLowerCase() !== 'posted') issues.push(`Original transaction ${original.id} is not posted.`);
  if (String(reversal.status || '').toLowerCase() !== 'posted') issues.push(`Reversal ${reversal.id} is not posted.`);
  if (!idsEqual(reversal.reversalOfTransactionId, original.id)) issues.push(`Reversal ${reversal.id} does not reference ${original.id}.`);
  if (!idsEqual(reversal.orgId, original.orgId)) issues.push(`Reversal ${reversal.id} is outside the original organization.`);
  if (getAccountId(reversal) !== getAccountId(original)) issues.push(`Reversal ${reversal.id} uses a different account.`);
  if (roundMoney(reversal?.amount?.value) !== roundMoney(original?.amount?.value)) issues.push(`Reversal ${reversal.id} uses a different amount.`);
  if (String(reversal?.amount?.currency || '').toUpperCase() !== String(original?.amount?.currency || '').toUpperCase()) {
    issues.push(`Reversal ${reversal.id} uses a different currency.`);
  }
  const expectedDirection = normalizeDirection(original?.amount?.direction) === 'debit' ? 'credit' : 'debit';
  if (normalizeDirection(reversal?.amount?.direction) !== expectedDirection) issues.push(`Reversal ${reversal.id} has the wrong direction.`);
  if (roundMoney(reversal.balanceEffect) !== roundMoney(-Number(original.balanceEffect || 0))) {
    issues.push(`Reversal ${reversal.id} does not negate the original balance effect.`);
  }
  return issues;
}

function validatePostingReplay(expected, existing) {
  const issues = [];
  const key = String(expected?.source?.idempotencyKey || '').trim();
  if (!existing) return [`Posting ${key || 'transaction'} was not found.`];
  if (!idsEqual(existing.orgId, expected.orgId)) issues.push(`Existing posting ${existing.id} is outside the expected organization.`);
  if (String(existing.status || '').toLowerCase() !== 'posted') issues.push(`Existing posting ${existing.id} is not posted.`);
  if (getAccountId(existing) !== getAccountId(expected)) issues.push(`Existing posting ${existing.id} uses a different account.`);
  if (roundMoney(existing?.amount?.value) !== roundMoney(expected?.amount?.value)) issues.push(`Existing posting ${existing.id} uses a different amount.`);
  if (String(existing?.amount?.currency || '').toUpperCase() !== String(expected?.amount?.currency || '').toUpperCase()) {
    issues.push(`Existing posting ${existing.id} uses a different currency.`);
  }
  if (normalizeDirection(existing?.amount?.direction) !== normalizeDirection(expected?.amount?.direction)) {
    issues.push(`Existing posting ${existing.id} uses a different direction.`);
  }
  return issues;
}

async function findPostingByIdempotencyKey(item, options = {}) {
  const key = String(item?.source?.idempotencyKey || '').trim();
  if (!key) throw new Error('Posting idempotency key is required.');
  const rows = await schoolRepositories.globalTransactions.list({
    ...options,
    query: { 'source.idempotencyKey__eq': key, orgId__eq: item.orgId, page: 1, limit: 2 },
    scope: { canViewAll: true }
  });
  return (Array.isArray(rows) ? rows : []).find((row) => String(row?.source?.idempotencyKey || '').trim() === key) || null;
}

function actorId(options = {}) {
  const user = options.requestingUser || options.reqUser || {};
  return toPublicId(user?.id) || String(user?.username || 'system').trim() || 'system';
}

function validateRegistrationTransactionIdentity(expected, existing, allowedStatuses = ['draft', 'posted']) {
  const issues = [];
  if (!existing) return ['Registration transaction was not found.'];
  if (!allowedStatuses.includes(String(existing.status || '').toLowerCase())) {
    issues.push(`Transaction ${existing.id} has status ${existing.status}.`);
  }
  if (!idsEqual(existing.orgId, expected.orgId)) issues.push(`Transaction ${existing.id} is outside the expected organization.`);
  if (String(existing.transactionType || '').toLowerCase() !== 'charge') issues.push(`Transaction ${existing.id} is not a charge.`);
  if (!idsEqual(existing?.metadata?.registrationId, expected?.metadata?.registrationId) ||
      String(existing?.metadata?.registrationType || '').toLowerCase() !== String(expected?.metadata?.registrationType || '').toLowerCase()) {
    issues.push(`Transaction ${existing.id} belongs to another registration.`);
  }
  if (String(existing?.source?.idempotencyKey || '').trim() !== String(expected?.source?.idempotencyKey || '').trim()) {
    issues.push(`Transaction ${existing.id} uses a different stable line key.`);
  }
  if (getDraftLineId(existing) !== getDraftLineId(expected)) {
    issues.push(`Transaction ${existing.id} uses a different draft line id.`);
  }
  if (!idsEqual(existing?.party?.studentId, expected?.party?.studentId) ||
      !idsEqual(existing?.party?.programId, expected?.party?.programId) ||
      String(existing?.party?.feeCategory || '').trim() !== String(expected?.party?.feeCategory || '').trim()) {
    issues.push(`Transaction ${existing.id} belongs to a different financial party.`);
  }
  return issues;
}

function validateRegistrationTransactionShape(expected, existing, allowedStatuses = ['draft', 'posted']) {
  const issues = validateRegistrationTransactionIdentity(expected, existing, allowedStatuses);
  if (!existing) return issues;
  if (getAccountId(existing) !== getAccountId(expected)) issues.push(`Transaction ${existing.id} uses a different account.`);
  if (roundMoney(existing?.amount?.value) !== roundMoney(expected?.amount?.value)) issues.push(`Transaction ${existing.id} uses a different amount.`);
  if (String(existing?.amount?.currency || '').toUpperCase() !== String(expected?.amount?.currency || '').toUpperCase()) {
    issues.push(`Transaction ${existing.id} uses a different currency.`);
  }
  if (normalizeDirection(existing?.amount?.direction) !== normalizeDirection(expected?.amount?.direction)) {
    issues.push(`Transaction ${existing.id} uses a different direction.`);
  }
  return issues;
}

function collectStoredRegistrationItems(summary = {}) {
  return [
    ...(Array.isArray(summary.draftTransactionItems) ? summary.draftTransactionItems : []),
    ...(Array.isArray(summary.draftTermTransactionItems) ? summary.draftTermTransactionItems : []),
    ...(Array.isArray(summary.draftClassTransactionItems) ? summary.draftClassTransactionItems : [])
  ].filter((item) => item && typeof item === 'object');
}

function registrationFinancialLineMatches(transaction, item) {
  return idsEqual(transaction?.orgId, item?.orgId) &&
    idsEqual(transaction?.party?.studentId, item?.party?.studentId) &&
    idsEqual(transaction?.party?.programId, item?.party?.programId) &&
    idsEqual(getAccountId(transaction), getAccountId(item)) &&
    roundMoney(transaction?.amount?.value) === roundMoney(item?.amount?.value) &&
    String(transaction?.amount?.currency || '').toUpperCase() === String(item?.amount?.currency || '').toUpperCase() &&
    normalizeDirection(transaction?.amount?.direction) === normalizeDirection(item?.amount?.direction);
}

async function ensureRegistrationTransactionOwnership(transactionIds, summary, context = {}, options = {}) {
  const ids = cleanIds(transactionIds);
  if (!ids.length) return [];
  const registrationType = String(context.registrationType || '').trim().toLowerCase();
  const registrationId = toPublicId(context.registrationId);
  const orgId = toPublicId(context.orgId);
  if (!registrationType || !registrationId || !orgId) {
    throw new Error('Registration ownership verification context is incomplete.');
  }
  const storedItems = collectStoredRegistrationItems(summary);
  const claimedItems = new Set();
  const expectations = {};
  const legacyIds = [];
  const rows = [];

  for (const transactionId of ids) {
    // eslint-disable-next-line no-await-in-loop
    const transaction = await schoolRepositories.globalTransactions.getById(transactionId, options);
    if (!transaction) throw new Error(`Transaction ${transactionId} was not found.`);
    rows.push(transaction);
    const existingType = String(transaction?.metadata?.registrationType || '').trim().toLowerCase();
    const existingId = toPublicId(transaction?.metadata?.registrationId);
    if (existingType || existingId) {
      if (existingType !== registrationType || !idsEqual(existingId, registrationId)) {
        throw new Error(`Transaction ${transactionId} belongs to another registration.`);
      }
      continue;
    }

    let matchIndex = storedItems.findIndex((item, index) => {
      if (claimedItems.has(index)) return false;
      const linkedId = toPublicId(item?.metadata?.globalTransactionId || item?.globalTransactionId || item?.id);
      return linkedId && idsEqual(linkedId, transactionId) && registrationFinancialLineMatches(transaction, item);
    });
    if (matchIndex < 0) {
      const matches = storedItems
        .map((item, index) => ({ item, index }))
        .filter(({ item, index }) => !claimedItems.has(index) && registrationFinancialLineMatches(transaction, item));
      if (matches.length !== 1) {
        throw new Error(
          `Legacy transaction ${transactionId} cannot be safely linked: expected exactly one matching stored financial line, found ${matches.length}.`
        );
      }
      matchIndex = matches[0].index;
    }
    claimedItems.add(matchIndex);
    expectations[transactionId] = storedItems[matchIndex];
    legacyIds.push(transactionId);
  }

  if (legacyIds.length) {
    const backfilled = await schoolRepositories.globalTransactions.backfillRegistrationTransactionOwnership({
      transactionIds: legacyIds,
      expectations,
      registrationType,
      registrationId,
      orgId,
      actor: actorId(options),
      cycleNo: Number(context.cycleNo || 0)
    }, options);
    const byId = new Map((Array.isArray(backfilled) ? backfilled : []).map((row) => [toPublicId(row.id), row]));
    return rows.map((row) => byId.get(toPublicId(row.id)) || row);
  }
  return rows;
}

async function syncDraftTransactions(items, context = {}, options = {}) {
  const registrationType = String(context.registrationType || '').trim().toLowerCase();
  const registrationId = toPublicId(context.registrationId);
  const orgId = toPublicId(context.orgId || items?.[0]?.orgId);
  const cycle = context.cycle;
  if (!registrationId || !orgId || !cycle?.cycleId) throw new Error('Draft transaction registration context is incomplete.');

  const expectedItems = scopePostingItems(items, { registrationType, registrationId, cycle }).map((item) => ({
    ...item,
    balanceEffect: roundMoney(item?.amount?.value)
  }));
  const resultByKey = new Map();
  const desiredIds = new Set();
  const missing = [];
  for (const item of expectedItems) {
    const key = String(item?.source?.idempotencyKey || '').trim();
    const existing = await findPostingByIdempotencyKey(item, options);
    if (!existing) {
      missing.push(item);
      continue;
    }
    const issues = validateRegistrationTransactionIdentity(item, existing, ['draft']);
    if (issues.length) throw new Error(`Draft transaction validation failed: ${issues.join(' | ')}`);
    const updated = await schoolRepositories.globalTransactions.update(existing.id, {
      ...item,
      id: existing.id,
      metadata: {
        ...(existing.metadata || {}),
        ...(item.metadata || {}),
        registrationLifecycle: {
          ...(existing?.metadata?.registrationLifecycle || {}),
          ...(item?.metadata?.registrationLifecycle || {}),
          statusHistory: Array.isArray(existing?.metadata?.registrationLifecycle?.statusHistory)
            ? existing.metadata.registrationLifecycle.statusHistory
            : []
        }
      }
    }, options);
    desiredIds.add(toPublicId(updated?.id));
    resultByKey.set(key, updated);
  }

  if (missing.length) {
    const created = await schoolRepositories.globalTransactions.create(missing, options);
    (Array.isArray(created) ? created : [created]).filter(Boolean).forEach((row) => {
      desiredIds.add(toPublicId(row.id));
      resultByKey.set(String(row?.source?.idempotencyKey || '').trim(), row);
    });
  }

  const removedIds = cleanIds(context.currentDraftTransactionIds).filter((id) => !desiredIds.has(id));
  if (removedIds.length) {
    await schoolRepositories.globalTransactions.transitionRegistrationTransactions({
      transactionIds: removedIds,
      registrationType,
      registrationId,
      orgId,
      fromStatus: 'draft',
      toStatus: 'voided',
      actor: actorId(options),
      reason: context.reason || 'Draft registration transaction line removed.',
      cycleNo: Number(cycle.cycleNo || 0)
    }, options);
  }

  const rows = expectedItems
    .map((item) => resultByKey.get(String(item?.source?.idempotencyKey || '').trim()))
    .filter(Boolean);
  return {
    rows,
    transactionIds: cleanIds(rows.map((row) => row.id)),
    items: rows.map((row) => ({ ...row, metadata: { ...(row.metadata || {}), globalTransactionId: row.id } })),
    voidedTransactionIds: removedIds
  };
}

async function postCycleTransactions(items, options = {}) {
  const expectedItems = Array.isArray(items) ? items : [];
  if (!expectedItems.length) return [];
  const resultByKey = new Map();
  const missing = [];
  const draftIds = [];
  for (const item of expectedItems) {
    const key = String(item?.source?.idempotencyKey || '').trim();
    const existing = await findPostingByIdempotencyKey(item, options);
    if (!existing) {
      missing.push({ ...item, status: 'draft', postedAt: '' });
      continue;
    }
    const issues = validateRegistrationTransactionShape(item, existing);
    if (issues.length) throw new Error(`Registration posting validation failed: ${issues.join(' | ')}`);
    if (String(existing.status || '').toLowerCase() === 'draft') draftIds.push(toPublicId(existing.id));
    resultByKey.set(key, existing);
  }

  if (missing.length) {
    const created = await schoolRepositories.globalTransactions.create(missing, options);
    (Array.isArray(created) ? created : [created]).filter(Boolean).forEach((row) => {
      draftIds.push(toPublicId(row.id));
      resultByKey.set(String(row?.source?.idempotencyKey || '').trim(), row);
    });
  }

  if (draftIds.length) {
    const sample = expectedItems[0];
    const transitioned = await schoolRepositories.globalTransactions.transitionRegistrationTransactions({
      transactionIds: draftIds,
      registrationType: String(sample?.metadata?.registrationType || '').toLowerCase(),
      registrationId: toPublicId(sample?.metadata?.registrationId),
      orgId: toPublicId(sample?.orgId),
      fromStatus: 'draft',
      toStatus: 'posted',
      actor: actorId(options),
      reason: options.reason || 'Registration approved.',
      cycleNo: Number(sample?.metadata?.postingCycleNo || 0)
    }, options);
    (Array.isArray(transitioned) ? transitioned : []).forEach((row) => {
      resultByKey.set(String(row?.source?.idempotencyKey || '').trim(), row);
    });
  }

  return expectedItems.map((item) => resultByKey.get(String(item?.source?.idempotencyKey || '').trim())).filter(Boolean);
}

async function findAcademicEntryByIdempotencyKey(key, options = {}) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return null;
  const rows = await schoolRepositories.academicLedger.list({
    ...options,
    query: { 'source.idempotencyKey__eq': normalizedKey, page: 1, limit: 2 },
    scope: { canViewAll: true }
  });
  return (Array.isArray(rows) ? rows : []).find(
    (row) => String(row?.source?.idempotencyKey || '').trim() === normalizedKey
  ) || null;
}

async function postAcademicEntriesIdempotently({ source = {}, post, options = {} } = {}) {
  if (typeof post !== 'function') throw new Error('Academic posting callback is required.');
  const key = String(source?.idempotencyKey || '').trim();
  const existing = await findAcademicEntryByIdempotencyKey(key, options);
  if (existing) {
    if (String(existing.status || '').toLowerCase() !== 'posted') {
      throw new Error(`Academic entry ${existing.id} for this posting cycle is not posted.`);
    }
    return [existing];
  }
  try {
    const created = await post();
    return (Array.isArray(created) ? created : [created]).filter(Boolean);
  } catch (error) {
    const concurrent = await findAcademicEntryByIdempotencyKey(key, options);
    if (concurrent && String(concurrent.status || '').toLowerCase() === 'posted') return [concurrent];
    throw error;
  }
}

function sanitizeDraftLineId(value, fallback) {
  const normalized = String(value || fallback || '').trim().replace(/[^A-Za-z0-9_.:-]+/g, '-');
  return (normalized || String(fallback || 'LINE')).slice(0, 80);
}

function scopePostingItems(items, { registrationType, registrationId, cycle } = {}) {
  const cycleId = String(cycle?.cycleId || '').trim();
  if (!cycleId) throw new Error('Posting cycle id is required.');
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const source = item?.source && typeof item.source === 'object' ? item.source : {};
    const metadata = (item?.metadata && typeof item.metadata === 'object') ? item.metadata : {};
    const existingLifecycle = metadata.registrationLifecycle &&
      typeof metadata.registrationLifecycle === 'object' &&
      !Array.isArray(metadata.registrationLifecycle)
      ? metadata.registrationLifecycle
      : {};
    const originalKey = String(
      existingLifecycle.baseIdempotencyKey ||
      metadata.baseRegistrationIdempotencyKey ||
      source.idempotencyKey ||
      `LINE-${index + 1}`
    ).trim().replace(/^REGTX\|[^|]+\|[^|]+\|/i, '');
    const draftLineId = sanitizeDraftLineId(
      existingLifecycle.draftLineId || metadata.draftLineId,
      `L${index + 1}-${originalKey}`
    );
    const stableKey = `REGTX|${String(registrationType || '').trim().toUpperCase()}|${toPublicId(registrationId)}|${draftLineId}`.slice(0, 220);
    return {
      ...item,
      status: String(item?.status || '').toLowerCase() === 'voided' ? 'voided' : 'draft',
      postedAt: '',
      source: {
        ...source,
        eventId: `REGTX-${String(registrationType || '').trim().toUpperCase()}-${toPublicId(registrationId)}-${draftLineId}`.replace(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 120),
        idempotencyKey: stableKey
      },
      metadata: {
        ...metadata,
        registrationType: String(registrationType || '').trim().toLowerCase(),
        registrationId: toPublicId(registrationId),
        draftLineId,
        postingCycleNo: Number(cycle.cycleNo || 0),
        postingCycleId: cycleId,
        registrationLifecycle: {
          ...existingLifecycle,
          registrationType: String(registrationType || '').trim().toLowerCase(),
          registrationId: toPublicId(registrationId),
          draftLineId,
          baseIdempotencyKey: originalKey,
          currentPostingCycleNo: Number(cycle.cycleNo || 0),
          statusHistory: Array.isArray(existingLifecycle.statusHistory) ? existingLifecycle.statusHistory : []
        }
      }
    };
  });
}

function scopeAcademicSource(source = {}, cycle = {}) {
  const cycleId = String(cycle?.cycleId || '').trim();
  return {
    ...source,
    eventId: `${cycleId}-${String(source.eventId || 'ACADEMIC').trim()}`.replace(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 120),
    idempotencyKey: `REGCYCLE|${cycleId}|${String(source.idempotencyKey || 'academic').trim()}`.slice(0, 220)
  };
}

async function findReversalRows(transactionId, options = {}) {
  const rows = await schoolRepositories.globalTransactions.list({
    ...options,
    query: { reversalOfTransactionId__eq: transactionId, page: 1, limit: 10 },
    scope: { canViewAll: true }
  });
  return Array.isArray(rows) ? rows : [];
}

async function reconcileTransactions({
  transactionIds = [],
  registrationType = '',
  registrationId = '',
  orgId = '',
  transactionSummary = {},
  effectiveDate = '',
  reason = '',
  createMissing = true,
  options = {}
} = {}) {
  const reversalIds = [];
  const unresolvedTransactionIds = [];
  const issues = [];
  if (registrationType) {
    try {
      await ensureRegistrationTransactionOwnership(transactionIds, transactionSummary, {
        registrationType,
        registrationId,
        orgId
      }, options);
    } catch (error) {
      return {
        reversalIds: [],
        unresolvedTransactionIds: cleanIds(transactionIds),
        issues: [error.message]
      };
    }
  }

  for (const transactionId of cleanIds(transactionIds)) {
    const original = await schoolRepositories.globalTransactions.getById(transactionId, options);
    if (!original) {
      unresolvedTransactionIds.push(transactionId);
      issues.push(`Original transaction ${transactionId} was not found.`);
      continue;
    }
    if (orgId && !idsEqual(original.orgId, orgId)) {
      unresolvedTransactionIds.push(transactionId);
      issues.push(`Original transaction ${transactionId} is outside the registration organization.`);
      continue;
    }
    if (registrationType && (
      String(original?.metadata?.registrationType || '').toLowerCase() !== String(registrationType).toLowerCase() ||
      !idsEqual(original?.metadata?.registrationId, registrationId)
    )) {
      unresolvedTransactionIds.push(transactionId);
      issues.push(`Original transaction ${transactionId} is not owned by this registration.`);
      continue;
    }
    if (String(original.transactionType || '').toLowerCase() !== 'charge') {
      unresolvedTransactionIds.push(transactionId);
      issues.push(`Original transaction ${transactionId} is not a registration charge.`);
      continue;
    }

    let reversals = await findReversalRows(transactionId, options);
    if (!reversals.length && createMissing && String(original.status || '').toLowerCase() === 'posted') {
      try {
        const created = await schoolRepositories.globalTransactions.reverseTransaction(transactionId, {
          eventId: `REGREV-${registrationId}-${transactionId}`.replace(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 120),
          idempotencyKey: `REGREV|${registrationId}|${transactionId}`.slice(0, 220),
          memo: `Registration reversal for ${transactionId}`,
          internalNote: reason,
          effectiveDate
        }, options);
        reversals = created ? [created] : [];
      } catch (error) {
        // A concurrent or retried request may have created the reversal first.
        reversals = await findReversalRows(transactionId, options);
        if (!reversals.length) issues.push(`Failed to reverse transaction ${transactionId}: ${error.message}`);
      }
    }

    if (reversals.length > 1) issues.push(`Transaction ${transactionId} has multiple reversal records.`);
    const reversal = reversals[0] || null;
    const pairIssues = validateReversalPair(original, reversal);
    if (pairIssues.length) {
      unresolvedTransactionIds.push(transactionId);
      issues.push(...pairIssues);
    } else if (reversal?.id) {
      reversalIds.push(toPublicId(reversal.id));
    }
  }

  return {
    reversalIds: cleanIds(reversalIds),
    unresolvedTransactionIds: cleanIds(unresolvedTransactionIds),
    issues: Array.from(new Set(issues.filter(Boolean)))
  };
}

async function hydrateLegacyCycles(summary, context = {}) {
  let normalized = normalizeTransactionSummary(summary, context);
  const cycles = [];
  for (const cycle of normalized.postingCycles) {
    const transactionIds = cleanIds(cycle.transactionIds);
    for (const reversalId of cleanIds(cycle.reversalIds)) {
      const reversal = await schoolRepositories.globalTransactions.getById(reversalId, context.options || {});
      const originalId = toPublicId(reversal?.reversalOfTransactionId);
      if (originalId && !transactionIds.includes(originalId)) transactionIds.push(originalId);
    }
    cycles.push({ ...cycle, transactionIds });
  }
  normalized = { ...normalized, postingCycles: cycles };
  const active = cycles.find((row) => row.cycleNo === normalized.activePostingCycleNo) || cycles[cycles.length - 1];
  if (active) {
    normalized.transactionIds = cleanIds(active.transactionIds);
    normalized.postedTransactionIds = cleanIds(active.transactionIds);
    normalized.reversalIds = cleanIds(active.reversalIds);
  }
  return normalized;
}

async function ensureDraftTransactions(summary, items, context = {}, options = {}) {
  const cycleState = beginPostingCycle(summary, context);
  const sync = await syncDraftTransactions(items, {
    ...context,
    cycle: cycleState.cycle,
    currentDraftTransactionIds: cleanIds(
      context.currentDraftTransactionIds ||
      cycleState.summary.draftTransactionIds ||
      cycleState.cycle.transactionIds
    )
  }, options);
  const updatedSummary = updatePostingCycle(cycleState.summary, cycleState.cycle.cycleNo, {
    status: 'draft',
    draftedAt: cycleState.cycle.draftedAt || new Date().toISOString(),
    postedAt: '',
    returnedToDraftAt: cycleState.cycle.returnedToDraftAt || '',
    transactionIds: sync.transactionIds,
    reversalIds: [],
    unresolvedTransactionIds: [],
    issues: []
  }, context);
  return {
    ...sync,
    cycle: updatedSummary.postingCycles.find((row) => row.cycleNo === cycleState.cycle.cycleNo) || cycleState.cycle,
    summary: {
      ...updatedSummary,
      draftTransactionIds: sync.transactionIds,
      transactionIds: [],
      postedTransactionIds: [],
      reconciliationIssues: [],
      unresolvedTransactionIds: [],
      pendingTransition: null
    }
  };
}

async function returnPostedSummaryToDraft(summary, context = {}, options = {}) {
  const normalized = await hydrateLegacyCycles(summary, { ...context, options });
  const active = normalized.postingCycles.find((row) => row.cycleNo === normalized.activePostingCycleNo) ||
    normalized.postingCycles[normalized.postingCycles.length - 1];
  let transactionIds = cleanIds(context.transactionIds);
  if (!transactionIds.length) transactionIds = cleanIds(active?.transactionIds);
  if (!transactionIds.length) transactionIds = cleanIds(normalized.transactionIds);
  if (!transactionIds.length) transactionIds = cleanIds(normalized.postedTransactionIds);
  if (!transactionIds.length) {
    return {
      rows: [],
      transactionIds: [],
      summary: { ...normalized, draftTransactionIds: [], transactionIds: [], postedTransactionIds: [] },
      issues: []
    };
  }
  const orgId = toPublicId(context.orgId);
  if (!orgId) throw new Error('Organization is required to return registration transactions to draft.');
  await ensureRegistrationTransactionOwnership(transactionIds, summary, {
    ...context,
    orgId,
    cycleNo: Number(active?.cycleNo || normalized.activePostingCycleNo || 0)
  }, options);
  const transitioned = await schoolRepositories.globalTransactions.transitionRegistrationTransactions({
    transactionIds,
    registrationType: context.registrationType,
    registrationId: context.registrationId,
    orgId,
    fromStatus: 'posted',
    toStatus: 'draft',
    actor: actorId(options),
    reason: context.reason || 'Registration returned to draft.',
    cycleNo: Number(active?.cycleNo || normalized.activePostingCycleNo || 0)
  }, options);
  const now = new Date().toISOString();
  const nextSummary = active
    ? updatePostingCycle(normalized, active.cycleNo, {
      ...active,
      status: 'returned_to_draft',
      returnedToDraftAt: now,
      transactionIds,
      reversalIds: cleanIds(active.reversalIds),
      unresolvedTransactionIds: [],
      issues: []
    }, context)
    : normalized;
  return {
    rows: transitioned,
    transactionIds,
    issues: [],
    summary: {
      ...nextSummary,
      draftTransactionIds: transactionIds,
      transactionIds: [],
      postedTransactionIds: [],
      reconciliationIssues: [],
      unresolvedTransactionIds: [],
      pendingTransition: null,
      lastRollbackAt: now
    }
  };
}

async function settleSummaryForVoid(summary, context = {}) {
  const options = context.options || {};
  let normalized = await hydrateLegacyCycles(summary, context);
  const active = normalized.postingCycles.find((row) => row.cycleNo === normalized.activePostingCycleNo) ||
    normalized.postingCycles[normalized.postingCycles.length - 1];
  const activeStatus = String(active?.status || '').toLowerCase();
  const mutableVoidStatuses = ['draft', 'returned_to_draft', 'posting', 'posted', 'error', 'reversal_error'];
  let transactionIds = cleanIds(context.transactionIds);
  if (!transactionIds.length) transactionIds = cleanIds(normalized.draftTransactionIds);
  if (!transactionIds.length && mutableVoidStatuses.includes(activeStatus)) {
    transactionIds = cleanIds(active?.transactionIds);
  }
  if (!transactionIds.length && mutableVoidStatuses.includes(activeStatus)) {
    transactionIds = cleanIds(normalized.transactionIds);
  }
  const issues = [];
  const orgId = toPublicId(context.orgId);
  if (transactionIds.length && !orgId) issues.push('Organization is required to void registration transactions.');

  if (transactionIds.length && orgId) {
    try {
      await ensureRegistrationTransactionOwnership(transactionIds, summary, {
        ...context,
        orgId,
        cycleNo: Number(active?.cycleNo || 0)
      }, options);
    } catch (error) {
      issues.push(error.message);
    }
    const postedIds = [];
    const draftIds = [];
    for (const transactionId of transactionIds) {
      const row = await schoolRepositories.globalTransactions.getById(transactionId, options);
      if (!row) {
        issues.push(`Transaction ${transactionId} was not found.`);
        continue;
      }
      const status = String(row.status || '').toLowerCase();
      if (status === 'posted') postedIds.push(transactionId);
      else if (status === 'draft') draftIds.push(transactionId);
      else if (status !== 'voided') issues.push(`Transaction ${transactionId} cannot be voided from status ${status}.`);
    }
    if (!issues.length && postedIds.length) {
      await schoolRepositories.globalTransactions.transitionRegistrationTransactions({
        transactionIds: postedIds,
        registrationType: context.registrationType,
        registrationId: context.registrationId,
        orgId,
        fromStatus: 'posted',
        toStatus: 'draft',
        actor: actorId(options),
        reason: context.reason || 'Draft registration reconciliation before void.',
        cycleNo: Number(active?.cycleNo || 0)
      }, options);
      draftIds.push(...postedIds);
    }
    if (!issues.length && draftIds.length) {
      await schoolRepositories.globalTransactions.transitionRegistrationTransactions({
        transactionIds: cleanIds(draftIds),
        registrationType: context.registrationType,
        registrationId: context.registrationId,
        orgId,
        fromStatus: 'draft',
        toStatus: 'voided',
        actor: actorId(options),
        reason: context.reason || `Draft ${context.registrationType || 'registration'} deleted.`,
        cycleNo: Number(active?.cycleNo || 0)
      }, options);
    }
  }

  const now = new Date().toISOString();
  if (active && mutableVoidStatuses.includes(activeStatus)) {
    normalized = updatePostingCycle(normalized, active.cycleNo, {
      ...active,
      status: issues.length ? 'error' : 'voided',
      voidedAt: issues.length ? active.voidedAt : now,
      transactionIds,
      unresolvedTransactionIds: issues.length ? transactionIds : [],
      issues
    }, context);
  }
  normalized = {
    ...normalized,
    draftTransactionIds: [],
    transactionIds: [],
    postedTransactionIds: [],
    reconciliationIssues: issues,
    unresolvedTransactionIds: issues.length ? transactionIds : [],
    pendingTransition: issues.length ? {
      fromStatus: 'draft',
      toStatus: 'void',
      requestedAt: now,
      requestedBy: actorId(options),
      status: 'error',
      reason: context.reason || '',
      issues
    } : null
  };
  return { summary: normalized, issues, unresolvedTransactionIds: normalized.unresolvedTransactionIds };
}

module.exports = {
  normalizeTransactionSummary,
  beginPostingCycle,
  updatePostingCycle,
  scopePostingItems,
  scopeAcademicSource,
  validateReversalPair,
  validatePostingReplay,
  postCycleTransactions,
  syncDraftTransactions,
  ensureDraftTransactions,
  ensureRegistrationTransactionOwnership,
  returnPostedSummaryToDraft,
  postAcademicEntriesIdempotently,
  reconcileTransactions,
  hydrateLegacyCycles,
  settleSummaryForVoid
};
