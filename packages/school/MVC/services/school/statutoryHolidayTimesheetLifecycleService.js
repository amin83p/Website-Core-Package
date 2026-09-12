'use strict';

const activityService = require('./activityService');
const schoolAdminAccessService = require('./schoolAdminAccessService');
const schoolDependencyService = require('./schoolDependencyService');
const statutoryHolidayEligibilityService = require('./statutoryHolidayEligibilityService');
const statutoryHolidaySchemeService = require('./statutoryHolidaySchemeService');
const statutoryHolidayWorkSessionService = require('./statutoryHolidayWorkSessionService');
const timesheetParametersPolicyService = require('./timesheetParametersPolicyService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { OPERATIONS } = require('../../../config/accessConstants');

function cleanId(value) {
  return String(value ?? '').trim();
}

function isStatHolidayEntry(entry = {}) {
  const sessionId = cleanId(entry?.sessionId);
  return entry?.isStatutoryHoliday === true || sessionId.startsWith('stathol-');
}

function isStatHolidayPayEnabled(policy = {}) {
  const resolved = timesheetParametersPolicyService.resolvePolicy(policy);
  return resolved?.statutoryHolidayPay?.enabled !== false;
}

function stripStatHolidayEntries(entries = []) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => !isStatHolidayEntry(entry));
}

function mergeStatHolidayRowsIntoEntries({
  entries = [],
  statHolidayRows = [],
  usesActivityMode = false,
  existingEntriesBySessionId = new Map()
} = {}) {
  const incomingStatHolidayBySessionId = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const sessionId = cleanId(entry?.sessionId);
    if (!sessionId || !isStatHolidayEntry(entry)) return;
    incomingStatHolidayBySessionId.set(sessionId, entry);
  });
  const baseRows = stripStatHolidayEntries(entries);
  const mergedStatRows = (Array.isArray(statHolidayRows) ? statHolidayRows : []).map((row) => {
    const sessionId = cleanId(row?.sessionId);
    const incomingRow = sessionId ? incomingStatHolidayBySessionId.get(sessionId) : null;
    const existingRow = sessionId ? existingEntriesBySessionId.get(sessionId) : null;
    const sourceRow = incomingRow || existingRow;
    const nextRow = {
      ...row,
      ...(sourceRow?.statHolidayOverride ? { statHolidayOverride: sourceRow.statHolidayOverride } : {}),
      ...(sourceRow?.comment ? { comment: sourceRow.comment } : {})
    };
    if (!usesActivityMode) return nextRow;
    return {
      ...nextRow,
      hours: 0,
      timesheetHours: 0,
      durationHours: 0
    };
  });
  return [...baseRows, ...mergedStatRows];
}

async function assertStatHolidayPayConfigured({ orgId, policy, reqUser } = {}) {
  const resolved = timesheetParametersPolicyService.resolvePolicy(policy);
  if (!isStatHolidayPayEnabled(resolved)) return resolved;
  const activityIds = statutoryHolidaySchemeService.resolveAllSchemeActivityIds(resolved);
  const defaultActivityId = statutoryHolidayEligibilityService.resolveStatHolidayActivityId(resolved);
  if (!activityIds.length && !defaultActivityId) {
    const error = new Error(
      'Statutory holiday pay requires a public statutory holiday activity. Configure one in School Settings before submitting timesheets.'
    );
    error.statusCode = 400;
    throw error;
  }
  if (!statutoryHolidayEligibilityService.usesStatHolidayActivityMode(resolved)) {
    const error = new Error(
      'Legacy synthetic statutory holiday rows are no longer supported. Select a public activity in School Settings.'
    );
    error.statusCode = 400;
    throw error;
  }
  const timesheetLegacyImportService = require('./timesheetLegacyImportService');
  const idsToValidate = activityIds.length ? activityIds : [defaultActivityId];
  for (const activityId of idsToValidate) {
    await timesheetLegacyImportService.resolvePublicStatHolidayActivity({
      orgId,
      reqUser,
      activityId
    });
  }
  return resolved;
}

async function materializeStatHoliday({
  orgId,
  personId,
  personName = '',
  personRole = '',
  period = {},
  policy,
  holidays = [],
  periodEntries = [],
  supplementalEntries = [],
  supplementalEntryFilter = null,
  existingEntries = [],
  reqUser,
  allowManagerOverride = false,
  overrideMap = null,
  persistToActivity = false
} = {}) {
  if (!isStatHolidayPayEnabled(policy)) {
    return {
      rows: [],
      warnings: [],
      evaluations: [],
      usesActivityMode: false,
      activityId: '',
      syncOutcome: null
    };
  }
  return statutoryHolidayWorkSessionService.materializeStatHolidayForPersonPeriod({
    orgId,
    personId,
    personName,
    personRole,
    period,
    policy,
    holidays,
    periodEntries,
    supplementalEntries,
    supplementalEntryFilter,
    existingEntries,
    reqUser,
    allowManagerOverride,
    overrideMap,
    persistToActivity
  });
}

async function previewStatHolidayForTimesheet(ctx = {}) {
  return materializeStatHoliday({ ...ctx, persistToActivity: false });
}

async function applyStatHolidayOnTimesheetSubmit(ctx = {}) {
  await assertStatHolidayPayConfigured(ctx);
  return materializeStatHoliday({ ...ctx, persistToActivity: true, allowManagerOverride: false });
}

async function updateStatHolidayOnReviewerSave(ctx = {}) {
  await assertStatHolidayPayConfigured(ctx);
  return materializeStatHoliday({
    ...ctx,
    persistToActivity: true,
    allowManagerOverride: ctx.allowManagerOverride === true
  });
}

async function clearStatHolidayForReturnedTimesheet({
  orgId,
  personId,
  period = {},
  policy,
  reqUser,
  entries = []
} = {}) {
  const resolved = timesheetParametersPolicyService.resolvePolicy(policy);
  const nextEntries = stripStatHolidayEntries(entries);
  if (!isStatHolidayPayEnabled(resolved)) {
    return { entries: nextEntries, removedAssignees: 0 };
  }
  if (!cleanId(personId) || !cleanId(period?.id)) {
    return { entries: nextEntries, removedAssignees: 0 };
  }
  const activityIds = statutoryHolidaySchemeService.resolveAllSchemeActivityIds(resolved);
  let removedAssignees = 0;
  for (const activityId of activityIds) {
    const outcome = await statutoryHolidayWorkSessionService.removeStatHolidayWorkSessionsForTarget({
      activityId,
      personId,
      periodId: period.id,
      periodStartDate: period.startDate,
      periodEndDate: period.endDate,
      reqUser
    });
    removedAssignees += Number(outcome?.removedAssignees || 0);
    await statutoryHolidayWorkSessionService.clearStatHolidayActivityLevelAttendees({
      activityId,
      reqUser
    });
  }
  return {
    entries: nextEntries,
    removedAssignees
  };
}

function isManagerApproved(timesheet = {}) {
  const reviewVersion = Number(timesheet?.reviewVersion || 0);
  const managerReview = timesheet?.managerReview || {};
  return String(managerReview.status || '').toLowerCase() === 'approved'
    && Number(managerReview.reviewVersion || 0) === reviewVersion;
}

async function resolveStatHolidayOverridePermission({
  reqUser,
  timesheet = {},
  period = {},
  reviewerEdit = false
} = {}) {
  const status = String(timesheet?.status || 'draft').toLowerCase();
  if (!reviewerEdit || status !== 'submitted') return false;
  if (status === 'processed' || String(period?.status || '').toLowerCase() === 'processed') return false;

  const canUpdate = await schoolAdminAccessService.isTimesheetManagementAdminViewerAsync(reqUser, OPERATIONS.UPDATE);
  if (canUpdate) return true;

  if (!isManagerApproved(timesheet)) return false;
  return schoolAdminAccessService.isTimesheetManagementAdminViewerAsync(reqUser, OPERATIONS.CONFIGURE);
}

async function collectStatHolidayAssigneeLocks({
  orgId,
  policy,
  personId,
  period = {},
  reqUser
} = {}) {
  const targetPersonId = cleanId(personId);
  const targetPeriodId = cleanId(period?.id);
  if (!targetPersonId || !targetPeriodId) {
    return { activityIds: [], locks: [] };
  }

  const activityIds = statutoryHolidaySchemeService.resolveAllSchemeActivityIds(policy);
  const locks = [];
  const resolvedActivityIds = [];

  for (const activityId of activityIds) {
    const activity = await activityService.getActivity(activityId, reqUser);
    if (!activity || !idsEqual(activity.orgId, orgId)) continue;
    resolvedActivityIds.push(activityId);
    activityService.getActivityEntries(activity).forEach((entry) => {
      const entryId = cleanId(entry?.entryId);
      if (!entryId) return;
      activityService.normalizeActivityAssigneeRows(entry.assignees).forEach((assignee) => {
        if (!idsEqual(assignee?.statHolidayPersonId, targetPersonId)) return;
        if (cleanId(assignee?.statHolidayPeriodId) && !idsEqual(assignee.statHolidayPeriodId, targetPeriodId)) return;
        if (!cleanId(assignee?.statHolidayId)) return;
        locks.push({ activityId, entryId, personId: targetPersonId });
      });
    });
  }

  return { activityIds: resolvedActivityIds, locks };
}

async function lockStatHolidayAssigneesForTimesheet({
  orgId,
  policy,
  personId,
  period = {},
  timesheetId = '',
  reqUser
} = {}) {
  if (!isStatHolidayPayEnabled(policy)) return { lockedSourceRefs: [] };
  const { locks } = await collectStatHolidayAssigneeLocks({
    orgId,
    policy,
    personId,
    period,
    reqUser
  });
  if (!locks.length || !cleanId(timesheetId)) return { lockedSourceRefs: [] };

  const lockedSourceRefs = [];
  const summaries = [];
  const locksByActivity = new Map();
  locks.forEach((lock) => {
    const activityId = cleanId(lock?.activityId);
    if (!activityId) return;
    if (!locksByActivity.has(activityId)) locksByActivity.set(activityId, []);
    locksByActivity.get(activityId).push({
      entryId: lock.entryId,
      personId: lock.personId
    });
  });

  for (const [activityId, activityLocks] of locksByActivity.entries()) {
    const summary = await schoolDependencyService.lockActivityAssignees({
      activityId,
      locks: activityLocks,
      timesheetId,
      reqUser
    });
    summaries.push(summary);
    activityLocks.forEach((lock) => {
      lockedSourceRefs.push({
        type: 'activity',
        activityId,
        activityEntryId: lock.entryId,
        personId: lock.personId
      });
    });
  }

  return { lockedSourceRefs, summary: summaries };
}

module.exports = {
  isStatHolidayEntry,
  isStatHolidayPayEnabled,
  stripStatHolidayEntries,
  mergeStatHolidayRowsIntoEntries,
  assertStatHolidayPayConfigured,
  previewStatHolidayForTimesheet,
  applyStatHolidayOnTimesheetSubmit,
  updateStatHolidayOnReviewerSave,
  clearStatHolidayForReturnedTimesheet,
  resolveStatHolidayOverridePermission,
  collectStatHolidayAssigneeLocks,
  lockStatHolidayAssigneesForTimesheet
};
