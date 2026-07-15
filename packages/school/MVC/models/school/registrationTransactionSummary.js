function cleanString(value, max = 500) {
  const normalized = String(value === undefined || value === null ? '' : value).replace(/\0/g, '').trim();
  return normalized.length > max ? normalized.slice(0, max) : normalized;
}

function cleanIds(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => cleanString(item, 120))
    .filter(Boolean)));
}

function cleanIssues(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanString(item, 1000))
    .filter(Boolean)
    .slice(0, 100);
}

function normalizeCycleStatus(value, { transactionIds = [], reversalIds = [] } = {}) {
  const normalized = cleanString(value, 40).toLowerCase();
  if (['draft', 'posting', 'posted', 'returned_to_draft', 'voided', 'reversing', 'reversed', 'reversal_error', 'error'].includes(normalized)) return normalized;
  if (reversalIds.length) return 'reversed';
  if (transactionIds.length) return 'posted';
  return 'posting';
}

function sanitizePostingCycle(value, fallbackNumber = 1) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const cycleNoRaw = Number.parseInt(String(input.cycleNo || fallbackNumber), 10);
  const cycleNo = Number.isFinite(cycleNoRaw) && cycleNoRaw > 0 ? cycleNoRaw : fallbackNumber;
  const transactionIds = cleanIds(input.transactionIds || input.originalTransactionIds);
  const reversalIds = cleanIds(input.reversalIds || input.reversalTransactionIds);
  return {
    cycleNo,
    cycleId: cleanString(input.cycleId, 120),
    status: normalizeCycleStatus(input.status, { transactionIds, reversalIds }),
    draftedAt: cleanString(input.draftedAt, 40),
    postedAt: cleanString(input.postedAt, 40),
    reversedAt: cleanString(input.reversedAt || input.rollbackAt, 40),
    returnedToDraftAt: cleanString(input.returnedToDraftAt, 40),
    voidedAt: cleanString(input.voidedAt, 40),
    transactionIds,
    reversalIds,
    unresolvedTransactionIds: cleanIds(input.unresolvedTransactionIds),
    issues: cleanIssues(input.issues)
  };
}

function sanitizePostingCycles(value) {
  const rows = (Array.isArray(value) ? value : [])
    .map((row, index) => sanitizePostingCycle(row, index + 1))
    .filter((row) => row.cycleId || row.transactionIds.length || row.reversalIds.length);
  rows.sort((a, b) => a.cycleNo - b.cycleNo || a.cycleId.localeCompare(b.cycleId));
  return rows.filter((row, index) => !rows.slice(0, index).some((candidate) => candidate.cycleNo === row.cycleNo));
}

function sanitizeLifecycleStatusHistory(value) {
  return (Array.isArray(value) ? value : []).slice(-100).map((row) => {
    const input = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
    const postingCycleRaw = Number.parseInt(String(input.postingCycle || 0), 10);
    const snapshot = input.financialSnapshot && typeof input.financialSnapshot === 'object' && !Array.isArray(input.financialSnapshot)
      ? input.financialSnapshot
      : {};
    const total = Number(snapshot.total || 0);
    return {
      actor: cleanString(input.actor, 120),
      timestamp: cleanString(input.timestamp, 40),
      reason: cleanString(input.reason, 1000),
      oldStatus: cleanString(input.oldStatus, 40).toLowerCase(),
      newStatus: cleanString(input.newStatus, 40).toLowerCase(),
      effectiveDate: cleanString(input.effectiveDate, 40),
      postingCycle: Number.isFinite(postingCycleRaw) && postingCycleRaw > 0 ? postingCycleRaw : 0,
      financialSnapshot: {
        transactionIds: cleanIds(snapshot.transactionIds),
        reversalIds: cleanIds(snapshot.reversalIds),
        total: Number.isFinite(total) ? Number(total.toFixed(2)) : 0
      }
    };
  });
}

function normalizeRegistrationType(value) {
  const normalized = cleanString(value, 20).toLowerCase();
  return ['program', 'term', 'class'].includes(normalized) ? normalized : 'registration';
}

function buildCycleId(registrationType, registrationId, cycleNo) {
  const prefix = normalizeRegistrationType(registrationType).toUpperCase();
  const safeRegistrationId = cleanString(registrationId, 80).replace(/[^A-Za-z0-9:_-]+/g, '-');
  return `${prefix}-${safeRegistrationId || 'REGISTRATION'}-C${cycleNo}`.slice(0, 120);
}

function normalizeTransactionSummary(value, { registrationType = '', registrationId = '' } = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const transactionIds = cleanIds(input.transactionIds || input.postedTransactionIds);
  const draftTransactionIds = cleanIds(input.draftTransactionIds);
  const reversalIds = cleanIds(input.reversalIds);
  let postingCycles = sanitizePostingCycles(input.postingCycles);

  if (!postingCycles.length && (transactionIds.length || draftTransactionIds.length || reversalIds.length)) {
    postingCycles = [sanitizePostingCycle({
      cycleNo: 1,
      cycleId: buildCycleId(registrationType, registrationId, 1),
      status: reversalIds.length ? 'reversed' : (draftTransactionIds.length ? 'draft' : 'posted'),
      draftedAt: input.draftSavedAt || '',
      postedAt: input.approvedAt || input.postedAt || '',
      reversedAt: input.lastRollbackAt || input.rollbackAt || '',
      transactionIds: transactionIds.length ? transactionIds : draftTransactionIds,
      reversalIds
    }, 1)];
  }

  const maxCycleNo = postingCycles.reduce((max, row) => Math.max(max, row.cycleNo), 0);
  const activePostingCycleNoRaw = Number.parseInt(String(input.activePostingCycleNo || 0), 10);
  const activePostingCycleNo = Number.isFinite(activePostingCycleNoRaw) && activePostingCycleNoRaw > 0
    ? activePostingCycleNoRaw
    : (postingCycles[postingCycles.length - 1]?.cycleNo || 0);

  return {
    ...input,
    transactionIds,
    postedTransactionIds: cleanIds(input.postedTransactionIds || input.transactionIds),
    draftTransactionIds,
    reversalIds,
    postingCycles,
    activePostingCycleNo,
    nextPostingCycleNo: Math.max(maxCycleNo + 1, Number.parseInt(String(input.nextPostingCycleNo || 1), 10) || 1),
    reconciliationIssues: cleanIssues(input.reconciliationIssues),
    unresolvedTransactionIds: cleanIds(input.unresolvedTransactionIds),
    lifecycleStatusHistory: sanitizeLifecycleStatusHistory(input.lifecycleStatusHistory),
    pendingTransition: input.pendingTransition && typeof input.pendingTransition === 'object' && !Array.isArray(input.pendingTransition)
      ? {
        fromStatus: cleanString(input.pendingTransition.fromStatus, 40).toLowerCase(),
        toStatus: cleanString(input.pendingTransition.toStatus, 40).toLowerCase(),
        effectiveDate: cleanString(input.pendingTransition.effectiveDate, 40),
        reason: cleanString(input.pendingTransition.reason, 1000),
        requestedAt: cleanString(input.pendingTransition.requestedAt, 40),
        requestedBy: cleanString(input.pendingTransition.requestedBy, 120),
        status: cleanString(input.pendingTransition.status, 40).toLowerCase(),
        issues: cleanIssues(input.pendingTransition.issues)
      }
      : null
  };
}

function beginPostingCycle(summary, { registrationType, registrationId } = {}) {
  const normalized = normalizeTransactionSummary(summary, { registrationType, registrationId });
  const active = normalized.postingCycles.find((row) => row.cycleNo === normalized.activePostingCycleNo);
  if (active && ['draft', 'posting'].includes(active.status)) return { summary: normalized, cycle: active };
  if (normalized.postingCycles.some((row) => ['reversing', 'reversal_error', 'error'].includes(row.status))) {
    throw new Error('A previous financial posting cycle is unresolved. Reconcile it before approving this draft.');
  }

  const cycleNo = normalized.nextPostingCycleNo;
  const cycle = sanitizePostingCycle({
    cycleNo,
    cycleId: buildCycleId(registrationType, registrationId, cycleNo),
    status: 'draft',
    draftedAt: new Date().toISOString()
  }, cycleNo);
  return {
    cycle,
    summary: {
      ...normalized,
      postingCycles: [...normalized.postingCycles, cycle],
      activePostingCycleNo: cycleNo,
      nextPostingCycleNo: cycleNo + 1,
      transactionIds: [],
      postedTransactionIds: [],
      draftTransactionIds: [],
      reversalIds: [],
      reconciliationIssues: [],
      unresolvedTransactionIds: []
    }
  };
}

function updatePostingCycle(summary, cycleNo, patch = {}, context = {}) {
  const normalized = normalizeTransactionSummary(summary, context);
  const postingCycles = normalized.postingCycles.map((row) => (
    row.cycleNo === cycleNo ? sanitizePostingCycle({ ...row, ...patch }, cycleNo) : row
  ));
  const current = postingCycles.find((row) => row.cycleNo === cycleNo) || sanitizePostingCycle(patch, cycleNo);
  if (!postingCycles.some((row) => row.cycleNo === cycleNo)) postingCycles.push(current);
  postingCycles.sort((a, b) => a.cycleNo - b.cycleNo);
  return {
    ...normalized,
    postingCycles,
    activePostingCycleNo: cycleNo,
    transactionIds: current.transactionIds,
    postedTransactionIds: current.status === 'posted' ? current.transactionIds : [],
    draftTransactionIds: ['draft', 'returned_to_draft', 'posting'].includes(current.status) ? current.transactionIds : [],
    reversalIds: current.reversalIds,
    reconciliationIssues: current.issues,
    unresolvedTransactionIds: current.unresolvedTransactionIds
  };
}

module.exports = {
  cleanIds,
  cleanIssues,
  sanitizePostingCycle,
  sanitizePostingCycles,
  sanitizeLifecycleStatusHistory,
  normalizeTransactionSummary,
  beginPostingCycle,
  updatePostingCycle,
  buildCycleId
};
