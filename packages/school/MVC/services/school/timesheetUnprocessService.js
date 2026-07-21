function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function validateUnprocessEligibility({ period, timesheet, note } = {}) {
  if (normalizeStatus(period?.status) === 'processed') {
    return { ok: false, message: 'This period has been processed and is locked.' };
  }
  if (normalizeStatus(timesheet?.status) !== 'processed') {
    return { ok: false, message: 'Only processed timesheets can be reopened to manager approved.' };
  }
  if (!String(note || '').trim()) {
    return { ok: false, message: 'A reopen note is required. Explain why this processed timesheet is being unlocked.' };
  }
  return { ok: true, message: '' };
}

function buildPreservedManagerReview(existing = {}, { now = '', actorId = '', actorName = '' } = {}) {
  const reviewVersion = Number(existing.reviewVersion || 0);
  const priorReview = existing.managerReview && typeof existing.managerReview === 'object'
    ? existing.managerReview
    : {};
  return {
    status: 'approved',
    reviewVersion,
    reviewedAt: String(priorReview.reviewedAt || existing.processedAt || now || ''),
    reviewedBy: String(priorReview.reviewedBy || existing.processedBy || actorId || ''),
    reviewedByName: String(priorReview.reviewedByName || existing.processedByName || actorName || ''),
    note: String(priorReview.note || '').trim()
  };
}

function buildUnprocessTimesheetUpdate({
  existing = {},
  restoredEntries = [],
  submissionSnapshot = null,
  now = new Date().toISOString(),
  actorId = '',
  actorName = '',
  totalHours = 0
} = {}) {
  const reviewVersion = Number(existing.reviewVersion || 0);
  return {
    ...existing,
    status: 'submitted',
    entries: Array.isArray(restoredEntries) ? restoredEntries : [],
    totalHours: Number(Number(totalHours || 0).toFixed(2)),
    reviewVersion,
    managerReview: buildPreservedManagerReview(existing, { now, actorId, actorName }),
    lockedSourceRefs: [],
    materializationSummary: null,
    processedAt: '',
    processedBy: '',
    processedByName: '',
    approvedAt: '',
    approvedBy: '',
    submissionSnapshot
  };
}

module.exports = {
  validateUnprocessEligibility,
  buildPreservedManagerReview,
  buildUnprocessTimesheetUpdate
};
