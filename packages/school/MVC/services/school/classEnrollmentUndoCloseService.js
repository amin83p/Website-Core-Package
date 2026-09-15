const schoolRepositories = require('../../repositories/school');
const registrationFinanceLifecycleService = require('./registrationFinanceLifecycleService');

function getClassEnrollmentPeriodService() {
  return require('./classEnrollmentPeriodService');
}
const rollingEnrollmentFunderService = require('./rollingEnrollmentFunderService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const UNDOABLE_CLOSE_STATUSES = new Set(['withdrawn', 'completed', 'cancelled', 'archived']);
const OPEN_ENROLLMENT_STATUSES = new Set(['draft', 'planned', 'to_be_confirmed', 'waiting_list', 'active']);
const RESTORABLE_OPEN_STATUSES = new Set(['active', 'to_be_confirmed', 'waiting_list', 'planned', 'draft']);

function normalizeStatus(value, fallback = '') {
  const token = String(value || fallback).trim().toLowerCase();
  return token || fallback;
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function resolveActor(requestingUser, fallback = 'system') {
  const candidate = String(
    requestingUser?.id ||
    requestingUser?.userId ||
    requestingUser?.personId ||
    requestingUser?.username ||
    requestingUser?.email ||
    fallback
  ).trim();
  return candidate || fallback;
}

function normalizeTransactionSummary(period = {}) {
  return registrationFinanceLifecycleService.normalizeTransactionSummary(
    period?.transactionSummary,
    { registrationType: 'class', registrationId: toPublicId(period?.id) }
  );
}

function hasNonZeroFinanceAmounts(summary = {}) {
  const totalAmount = Number(summary?.totalAmount || 0);
  if (Number.isFinite(totalAmount) && totalAmount !== 0) return true;
  const rows = [
    ...(Array.isArray(summary?.draftPreviewRows) ? summary.draftPreviewRows : []),
    ...(Array.isArray(summary?.draftTransactionItems) ? summary.draftTransactionItems : [])
  ];
  return rows.some((row) => {
    const amount = Number(row?.amount ?? row?.total ?? row?.value ?? 0);
    return Number.isFinite(amount) && amount !== 0;
  });
}

function hasFinanceHealthIssues(summary = {}) {
  if ((summary?.unresolvedTransactionIds || []).length) return true;
  if ((summary?.reconciliationIssues || []).length) return true;
  return (Array.isArray(summary?.postingCycles) ? summary.postingCycles : [])
    .some((row) => ['error', 'reversal_error', 'reversing'].includes(normalizeStatus(row?.status)));
}

function buildLastCloseSnapshot(period = {}, closeInput = {}, requestingUser = null) {
  const closedStatus = normalizeStatus(closeInput.status || closeInput.targetStatus, normalizeStatus(period?.status));
  const closedEndDate = normalizeDateOnly(closeInput.endDate || closeInput.effectiveDate || period?.endDate);
  return {
    previousStatus: normalizeStatus(period?.status),
    previousEndDate: normalizeDateOnly(period?.endDate),
    previousReasonEnd: String(period?.reasonEnd || '').trim(),
    closedStatus,
    closedEndDate,
    closedReason: String(closeInput.reasonEnd || closeInput.reason || '').trim(),
    closedAt: new Date().toISOString(),
    closedBy: resolveActor(requestingUser)
  };
}

function withLastCloseSnapshot(period = {}, closeInput = {}, requestingUser = null) {
  const summary = normalizeTransactionSummary(period);
  return {
    ...summary,
    lastCloseSnapshot: buildLastCloseSnapshot(period, closeInput, requestingUser)
  };
}

function buildRestoreSnapshot(period = {}) {
  const summary = normalizeTransactionSummary(period);
  const snapshot = (summary?.lastCloseSnapshot && typeof summary.lastCloseSnapshot === 'object')
    ? summary.lastCloseSnapshot
    : null;
  if (snapshot?.previousStatus && RESTORABLE_OPEN_STATUSES.has(normalizeStatus(snapshot.previousStatus))) {
    return {
      status: normalizeStatus(snapshot.previousStatus, 'active'),
      endDate: normalizeDateOnly(snapshot.previousEndDate),
      reasonEnd: '',
      source: 'lastCloseSnapshot'
    };
  }

  const history = Array.isArray(summary.lifecycleStatusHistory) ? summary.lifecycleStatusHistory : [];
  const lastCloseEntry = [...history].reverse().find((row) => {
    const newStatus = normalizeStatus(row?.newStatus);
    return UNDOABLE_CLOSE_STATUSES.has(newStatus);
  });
  if (lastCloseEntry && RESTORABLE_OPEN_STATUSES.has(normalizeStatus(lastCloseEntry.oldStatus))) {
    return {
      status: normalizeStatus(lastCloseEntry.oldStatus, 'active'),
      endDate: '',
      reasonEnd: '',
      source: 'lifecycleStatusHistory'
    };
  }

  return {
    status: 'active',
    endDate: '',
    reasonEnd: '',
    source: 'default'
  };
}

async function findStudentClassPeriods(period, options = {}) {
  const classId = toPublicId(period?.classId);
  const studentId = toPublicId(period?.studentId);
  if (!classId || !studentId) return [];
  const rows = await schoolRepositories.classEnrollmentPeriods.findByClassId(classId, options);
  return (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row?.studentId, studentId));
}

async function assessUndoCloseEligibility(period, options = {}) {
  const periodId = toPublicId(period?.id);
  const currentStatus = normalizeStatus(period?.status);
  const restorePreview = buildRestoreSnapshot(period);
  const blockers = [];

  if (!UNDOABLE_CLOSE_STATUSES.has(currentStatus)) {
    blockers.push({
      code: 'STATUS_NOT_UNDOABLE',
      message: 'Only withdrawn, completed, cancelled, or archived enrollments can be undone.'
    });
  }

  if (rollingEnrollmentFunderService.enrollmentHasAttachedTransactions(period)) {
    blockers.push({
      code: 'FINANCE_ATTACHED',
      message: 'Undo close is not available when financial transactions are attached to this enrollment.'
    });
  }

  const summary = normalizeTransactionSummary(period);
  if (hasNonZeroFinanceAmounts(summary)) {
    blockers.push({
      code: 'FINANCE_AMOUNT',
      message: 'Undo close is only available when this enrollment has zero financial amounts.'
    });
  }
  if (hasFinanceHealthIssues(summary)) {
    blockers.push({
      code: 'FINANCE_RECONCILIATION',
      message: 'Resolve financial reconciliation issues before undoing this close.'
    });
  }

  const siblingPeriods = await findStudentClassPeriods(period, options);
  const closedEndDate = normalizeDateOnly(period?.endDate);
  const overlappingOpen = siblingPeriods.filter((row) => {
    if (idsEqual(row?.id, periodId)) return false;
    if (!OPEN_ENROLLMENT_STATUSES.has(normalizeStatus(row?.status))) return false;
    const rowStart = normalizeDateOnly(row?.startDate);
    const rowEnd = normalizeDateOnly(row?.endDate) || '9999-12-31';
    const restoreStart = normalizeDateOnly(period?.startDate);
    const restoreEnd = normalizeDateOnly(restorePreview.endDate) || '9999-12-31';
    return rowStart <= restoreEnd && restoreStart <= rowEnd;
  });
  if (overlappingOpen.length) {
    blockers.push({
      code: 'OVERLAPPING_OPEN_PERIOD',
      message: 'Another open enrollment period already exists for this student in this class.'
    });
  }

  const downstreamPeriods = siblingPeriods.filter((row) => {
    if (idsEqual(row?.id, periodId)) return false;
    if (!OPEN_ENROLLMENT_STATUSES.has(normalizeStatus(row?.status))) return false;
    if (!closedEndDate) return false;
    const rowStart = normalizeDateOnly(row?.startDate);
    return rowStart && rowStart > closedEndDate;
  });
  if (downstreamPeriods.length) {
    blockers.push({
      code: 'DOWNSTREAM_PERIOD',
      message: 'A later open enrollment period already exists for this student. Remove or close it before undoing this close.'
    });
  }

  const overlapCheck = await getClassEnrollmentPeriodService().checkOverlap({
    classId: period?.classId,
    studentId: period?.studentId,
    startDate: period?.startDate,
    endDate: restorePreview.endDate || '',
    excludePeriodId: periodId
  }, options);
  if (overlapCheck?.hasOverlap) {
    blockers.push({
      code: 'OVERLAP_CHECK',
      message: 'Restoring this enrollment would overlap another active enrollment period.'
    });
  }

  return {
    canUndo: blockers.length === 0,
    blockers,
    restorePreview: {
      status: restorePreview.status,
      endDate: restorePreview.endDate || '',
      reasonEnd: restorePreview.reasonEnd || '',
      source: restorePreview.source
    },
    currentStatus,
    currentEndDate: normalizeDateOnly(period?.endDate)
  };
}

function appendUndoLifecycleHistory(summary, transition, options = {}) {
  const rows = Array.isArray(summary.lifecycleStatusHistory) ? summary.lifecycleStatusHistory : [];
  return {
    ...summary,
    lifecycleStatusHistory: [...rows, {
      actor: resolveActor(options.requestingUser),
      timestamp: new Date().toISOString(),
      reason: transition.reason,
      oldStatus: transition.oldStatus,
      newStatus: transition.newStatus,
      effectiveDate: transition.effectiveDate || '',
      eventType: 'undo_close'
    }].slice(-100)
  };
}

async function previewUndoClose(periodId, options = {}) {
  const normalizedPeriodId = toPublicId(periodId);
  if (!normalizedPeriodId) throw new Error('periodId is required.');
  const period = await schoolRepositories.classEnrollmentPeriods.getById(normalizedPeriodId, options);
  if (!period) throw new Error('Enrollment period not found.');
  const eligibility = await assessUndoCloseEligibility(period, options);
  return {
    periodId: normalizedPeriodId,
    studentId: toPublicId(period.studentId),
    classId: toPublicId(period.classId),
    ...eligibility
  };
}

async function undoClosePeriod(periodId, input = {}, requestingUser = null, options = {}) {
  const normalizedPeriodId = toPublicId(periodId);
  if (!normalizedPeriodId) throw new Error('periodId is required.');
  const reason = String(input?.reason || '').trim();
  if (!reason) throw new Error('A reason is required to undo the enrollment close.');

  const period = await schoolRepositories.classEnrollmentPeriods.getById(normalizedPeriodId, options);
  if (!period) throw new Error('Enrollment period not found.');

  const eligibility = await assessUndoCloseEligibility(period, options);
  if (!eligibility.canUndo) {
    const message = eligibility.blockers[0]?.message || 'This enrollment close cannot be undone.';
    const error = new Error(message);
    error.blockers = eligibility.blockers;
    throw error;
  }

  const restore = eligibility.restorePreview;
  const currentStatus = normalizeStatus(period.status);
  let summary = normalizeTransactionSummary(period);
  summary = appendUndoLifecycleHistory(summary, {
    reason,
    oldStatus: currentStatus,
    newStatus: restore.status,
    effectiveDate: restore.endDate || ''
  }, { requestingUser });
  delete summary.lastCloseSnapshot;

  const updated = await getClassEnrollmentPeriodService().updatePeriod(normalizedPeriodId, {
    status: restore.status,
    endDate: restore.endDate || '',
    reasonEnd: '',
    transactionSummary: summary,
    notes: [String(period?.notes || '').trim(), `Undo close (${currentStatus} -> ${restore.status}): ${reason}`]
      .filter(Boolean)
      .join(' | ')
  }, requestingUser, { ...options, skipCyclePolicyCheck: true });

  return {
    period: updated,
    restorePreview: restore,
    previousStatus: currentStatus
  };
}

module.exports = {
  UNDOABLE_CLOSE_STATUSES,
  buildLastCloseSnapshot,
  withLastCloseSnapshot,
  buildRestoreSnapshot,
  assessUndoCloseEligibility,
  previewUndoClose,
  undoClosePeriod
};
