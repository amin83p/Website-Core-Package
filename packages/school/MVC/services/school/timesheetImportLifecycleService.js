'use strict';

const {
  sanitizeSubmissionSnapshot,
  sanitizeSnapshotEntry,
  sanitizeReviewHistory
} = require('../../models/school/timesheetModel');
const schoolDependencyService = require('./schoolDependencyService');
const timesheetManualMaterializationService = require('./timesheetManualMaterializationService');
const taskService = require('./taskService');
const timesheetImportPolicyService = require('./timesheetImportPolicyService');

const POST_SAVE_TARGETS = new Set(['submitted', 'manager_approved', 'processed']);

function resolveActorId(reqUser) {
  return String(reqUser?.id || reqUser?.username || '').trim();
}

function resolveActorName(reqUser) {
  return String(reqUser?.displayName || reqUser?.name || reqUser?.username || reqUser?.id || '').trim();
}

function resetManagerReview(reviewVersion = 0) {
  return { status: 'pending', reviewVersion: Math.max(0, Number(reviewVersion || 0)) };
}

function getReviewHistory(timesheet) {
  return Array.isArray(timesheet?.reviewHistory) ? [...timesheet.reviewHistory] : [];
}

function countActiveTimesheetEntries(entries = []) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => entry && entry.isDeleted !== true).length;
}

function calculateTimesheetTotal(entries = []) {
  const total = (Array.isArray(entries) ? entries : []).reduce((sum, entry) => {
    if (!entry || entry.isDeleted === true) return sum;
    return sum + Number(parseFloat(entry?.hours ?? entry?.timesheetHours ?? entry?.durationHours) || 0);
  }, 0);
  return Number(total.toFixed(2));
}

function isPendingManualApproval(entry) {
  return Boolean(entry && entry.isDeleted !== true && entry.isManual === true
    && String(entry.approvalStatus || '').trim().toLowerCase() === 'pending_approval');
}

function assertNoPendingManualApprovals(entries = []) {
  const pendingRows = (Array.isArray(entries) ? entries : []).filter(isPendingManualApproval);
  if (!pendingRows.length) return;
  const error = new Error(`${pendingRows.length} paid manual row(s) still require approval or rejection before applying this import status.`);
  error.statusCode = 400;
  throw error;
}

function buildSubmissionSnapshot({
  normalizedEntries,
  period,
  reviewVersion = 0,
  submittedAt = '',
  lastModifiedAt = ''
}) {
  const entries = (Array.isArray(normalizedEntries) ? normalizedEntries : [])
    .filter((entry) => entry && entry.isDeleted !== true)
    .map((entry) => sanitizeSnapshotEntry(entry))
    .filter(Boolean);
  return sanitizeSubmissionSnapshot({
    submittedAt: submittedAt || new Date().toISOString(),
    reviewVersion: Math.max(0, Number(reviewVersion || 0)),
    lastModifiedAt: lastModifiedAt || new Date().toISOString(),
    sourcePeriodId: String(period?.id || ''),
    sourcePeriodName: String(period?.name || ''),
    entries
  });
}

function buildReviewHistoryEntry({
  event,
  reqUser,
  note = '',
  statusBefore = '',
  statusAfter = '',
  submissionSnapshot = null,
  totalHours = 0,
  entryCount = 0
}) {
  const snapshot = submissionSnapshot ? sanitizeSubmissionSnapshot(submissionSnapshot) : null;
  return {
    event,
    at: new Date().toISOString(),
    by: resolveActorId(reqUser),
    byName: resolveActorName(reqUser),
    note: String(note || '').trim(),
    statusBefore: String(statusBefore || '').trim().toLowerCase(),
    statusAfter: String(statusAfter || '').trim().toLowerCase(),
    submissionSnapshotAt: snapshot?.submittedAt || '',
    totalHours: Number(Number(totalHours || 0).toFixed(2)),
    entryCount: Number(entryCount || 0),
    ...(snapshot ? { submissionSnapshot: snapshot } : {})
  };
}

function appendReviewHistory(timesheet, entry) {
  return sanitizeReviewHistory([...getReviewHistory(timesheet), entry]);
}

function clearNonDraftLifecycleFields(payload = {}) {
  return {
    ...payload,
    status: 'draft',
    approvedAt: '',
    approvedBy: '',
    processedAt: '',
    processedBy: '',
    processedByName: '',
    returnedAt: '',
    returnedBy: '',
    returnReason: '',
    allowLateSubmission: false,
    materializationSummary: null,
    lockedSourceRefs: [],
    submissionSnapshot: null,
    managerReview: resetManagerReview(payload.reviewVersion || 0)
  };
}

function normalizeTargetStatus(value) {
  return timesheetImportPolicyService.normalizeImportTargetStatus(value, 'draft');
}

function prepareImportTargetPayload({
  basePayload,
  period,
  targetStatus,
  reqUser,
  priorTimesheet = null
}) {
  const normalizedTarget = normalizeTargetStatus(targetStatus);
  assertNoPendingManualApprovals(basePayload?.entries);

  if (normalizedTarget === 'draft') {
    return {
      payload: clearNonDraftLifecycleFields({
        ...basePayload,
        reviewVersion: Math.max(0, Number(priorTimesheet?.reviewVersion || basePayload.reviewVersion || 0))
      }),
      requiresPostSaveFinalization: false,
      appliedStatus: 'draft'
    };
  }

  if (String(period?.status || '').trim().toLowerCase() === 'processed' && normalizedTarget === 'processed') {
    const error = new Error('This period has already been processed and is locked.');
    error.statusCode = 400;
    throw error;
  }

  const statusBefore = String(priorTimesheet?.status || basePayload?.status || 'draft').trim().toLowerCase() || 'draft';
  const nextReviewVersion = Math.max(1, Number(priorTimesheet?.reviewVersion || basePayload?.reviewVersion || 0) + 1);
  const totalHours = calculateTimesheetTotal(basePayload.entries);
  const entryCount = countActiveTimesheetEntries(basePayload.entries);
  const nowIso = new Date().toISOString();
  const submissionSnapshot = buildSubmissionSnapshot({
    normalizedEntries: basePayload.entries,
    period,
    reviewVersion: nextReviewVersion,
    submittedAt: nowIso,
    lastModifiedAt: nowIso
  });

  let payload = {
    ...basePayload,
    status: 'submitted',
    totalHours,
    reviewVersion: nextReviewVersion,
    managerReview: resetManagerReview(nextReviewVersion),
    submissionSnapshot,
    approvedAt: '',
    approvedBy: '',
    processedAt: '',
    processedBy: '',
    processedByName: '',
    returnedAt: '',
    returnedBy: '',
    returnReason: '',
    allowLateSubmission: false,
    materializationSummary: null,
    lockedSourceRefs: [],
    reviewHistory: appendReviewHistory(priorTimesheet || basePayload, buildReviewHistoryEntry({
      event: 'submitted',
      reqUser,
      note: 'Legacy Excel import',
      statusBefore,
      statusAfter: 'submitted',
      submissionSnapshot,
      totalHours,
      entryCount
    }))
  };

  if (normalizedTarget === 'manager_approved' || normalizedTarget === 'processed') {
    payload = {
      ...payload,
      managerReview: {
        status: 'approved',
        reviewVersion: nextReviewVersion,
        reviewedAt: nowIso,
        reviewedBy: resolveActorId(reqUser),
        reviewedByName: resolveActorName(reqUser),
        note: 'Legacy Excel import'
      },
      reviewHistory: appendReviewHistory({ reviewHistory: payload.reviewHistory }, buildReviewHistoryEntry({
        event: 'manager_approved',
        reqUser,
        note: 'Legacy Excel import',
        statusBefore: 'submitted',
        statusAfter: 'submitted',
        submissionSnapshot,
        totalHours,
        entryCount
      }))
    };
  }

  return {
    payload,
    requiresPostSaveFinalization: POST_SAVE_TARGETS.has(normalizedTarget),
    appliedStatus: normalizedTarget
  };
}

async function finalizeImportTargetAfterSave({
  savedTimesheet,
  period,
  targetStatus,
  reqUser,
  dataService
}) {
  const normalizedTarget = normalizeTargetStatus(targetStatus);
  if (!POST_SAVE_TARGETS.has(normalizedTarget)) {
    return savedTimesheet;
  }

  const savedRow = savedTimesheet && typeof savedTimesheet === 'object' ? savedTimesheet : null;
  if (!savedRow?.id) return savedTimesheet;

  if (normalizedTarget === 'processed') {
    const materialized = await timesheetManualMaterializationService.materializeApprovedTimesheetManualEntries({
      timesheet: savedRow,
      period,
      reqUser
    });
    const timesheetForLock = materialized?.timesheet || savedRow;
    const lockSummary = await schoolDependencyService.lockSourcesForApprovedTimesheet(timesheetForLock, reqUser);
    const timesheetParametersPolicyModel = require('../../models/school/timesheetParametersPolicyModel');
    const statutoryHolidayTimesheetLifecycleService = require('./statutoryHolidayTimesheetLifecycleService');
    const timesheetParametersPolicy = await timesheetParametersPolicyModel.getPolicyForOrg(
      String(timesheetForLock?.orgId || savedRow?.orgId || '').trim()
    );
    const statHolidayLockSummary = await statutoryHolidayTimesheetLifecycleService.lockStatHolidayAssigneesForTimesheet({
      orgId: String(timesheetForLock?.orgId || savedRow?.orgId || '').trim(),
      policy: timesheetParametersPolicy,
      personId: String(timesheetForLock?.teacherId || savedRow?.teacherId || '').trim(),
      period,
      timesheetId: savedRow.id,
      reqUser
    });
    const lockedSourceRefs = schoolDependencyService.dedupeSourceRefs([
      ...(Array.isArray(lockSummary?.lockedSourceRefs) ? lockSummary.lockedSourceRefs : []),
      ...(statHolidayLockSummary?.lockedSourceRefs || [])
    ]);
    const nowIso = new Date().toISOString();
    const totalHours = calculateTimesheetTotal(timesheetForLock.entries);
    const submissionSnapshot = buildSubmissionSnapshot({
      normalizedEntries: timesheetForLock.entries,
      period,
      reviewVersion: Number(savedRow.reviewVersion || 0),
      submittedAt: String(savedRow?.submissionSnapshot?.submittedAt || nowIso),
      lastModifiedAt: nowIso
    });
    const payload = {
      ...timesheetForLock,
      status: 'processed',
      totalHours,
      submissionSnapshot,
      processedAt: nowIso,
      processedBy: resolveActorId(reqUser),
      processedByName: resolveActorName(reqUser),
      lockedSourceRefs,
      materializationSummary: materialized?.summary || null,
      reviewHistory: appendReviewHistory(timesheetForLock, buildReviewHistoryEntry({
        event: 'processed',
        reqUser,
        note: 'Legacy Excel import',
        statusBefore: 'submitted',
        statusAfter: 'processed',
        submissionSnapshot,
        totalHours,
        entryCount: countActiveTimesheetEntries(timesheetForLock.entries)
      }))
    };
    const updated = await dataService.updateData('timesheets', savedRow.id, payload, reqUser);
    try {
      await taskService.resolveTimesheetTask(updated, reqUser, {
        note: 'Timesheet processed via legacy import.',
        action: 'timesheet_processed'
      });
    } catch (error) {
      console.warn(`School task sync skipped for timesheet ${savedRow.id}: ${error.message}`);
    }
    return updated;
  }

  const lockSummary = await schoolDependencyService.lockSourcesForApprovedTimesheet(savedRow, reqUser);
  const lockedSourceRefs = schoolDependencyService.dedupeSourceRefs([
    ...(Array.isArray(lockSummary?.lockedSourceRefs) ? lockSummary.lockedSourceRefs : [])
  ]);
  const updated = await dataService.updateData('timesheets', savedRow.id, {
    ...savedRow,
    lockedSourceRefs
  }, reqUser);

  if (normalizedTarget === 'submitted') {
    try {
      await taskService.resolveTimesheetTask(updated, reqUser, {
        note: 'Timesheet submitted via legacy import.',
        action: 'timesheet_submitted'
      });
      await taskService.upsertTimesheetTask(updated, period, reqUser);
    } catch (error) {
      console.warn(`School task sync skipped for timesheet ${savedRow.id}: ${error.message}`);
    }
  }

  return updated;
}

module.exports = {
  prepareImportTargetPayload,
  finalizeImportTargetAfterSave,
  normalizeTargetStatus,
  calculateTimesheetTotal,
  countActiveTimesheetEntries
};
