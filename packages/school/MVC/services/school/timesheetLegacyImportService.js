'use strict';

const dataService = require('./schoolDataService');
const activityService = require('./activityService');
const activityEntryIdService = require('./activityEntryIdService');
const schoolDependencyService = require('./schoolDependencyService');
const timesheetManualMaterializationService = require('./timesheetManualMaterializationService');
const taskService = require('./taskService');
const timesheetImportPolicyModel = require('../../models/school/timesheetImportPolicyModel');
const timesheetImportPolicyService = require('./timesheetImportPolicyService');
const timesheetImportLifecycleService = require('./timesheetImportLifecycleService');
const timesheetImportWorkSessionBuilderService = require('./timesheetImportWorkSessionBuilderService');
const schoolRepositories = require('../../repositories/school');
const { sanitizeTimesheetPayload } = require('../../models/school/timesheetModel');
const { resolvePeriodStartYearToken } = require('./timesheetExcel/timesheetPeriodMatchService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const IMPORT_SCOPES = Object.freeze({
  MANAGEMENT: 'management',
  MY_TIMESHEETS: 'my_timesheets'
});

const POST_SAVE_IMPORT_STATUSES = new Set(['submitted', 'manager_approved', 'processed']);

function cleanId(value) {
  return String(value ?? '').trim();
}

function normalizeStatus(value) {
  return String(value ?? '').trim().toLowerCase();
}

async function cleanupStatHolidayForTimesheetTarget({
  orgId,
  personId,
  period,
  reqUser
} = {}) {
  return cleanupStatHolidayOnImportDelete({
    orgId,
    personId,
    period,
    reqUser
  });
}

async function purgeImportedTimesheetRecord(timesheetId, reqUser, options = {}) {
  const normalizedId = cleanId(timesheetId);
  if (!normalizedId) return;

  let timesheet = options.timesheet && typeof options.timesheet === 'object' ? options.timesheet : null;
  if (!timesheet && reqUser) {
    timesheet = await dataService.getDataById('timesheets', normalizedId, reqUser);
  }

  const targetOrgId = cleanId(options.orgId || timesheet?.orgId);
  const targetPersonId = cleanId(options.personId || timesheet?.teacherId);
  const targetPeriodId = cleanId(options.periodId || timesheet?.periodId);
  let period = options.period && typeof options.period === 'object' ? options.period : null;
  if (!period && targetPeriodId && reqUser) {
    period = await dataService.getDataById('timesheetPeriods', targetPeriodId, reqUser);
  }

  if (!options.skipStatHolidayCleanup && targetOrgId && targetPersonId && period) {
    await cleanupStatHolidayForTimesheetTarget({
      orgId: targetOrgId,
      personId: targetPersonId,
      period,
      reqUser
    });
  }

  await schoolRepositories.timesheets.maintenancePurgeById(normalizedId, {
    scope: { canViewAll: true },
    requestingUser: reqUser
  });
}

async function loadImportPolicy(orgId) {
  return timesheetImportPolicyModel.getPolicyForOrg(orgId);
}

async function assertImportAllowed({ orgId, scope }) {
  const policy = await loadImportPolicy(orgId);
  if (!timesheetImportPolicyService.isImportAllowedForScope(policy, scope)) {
    const error = new Error('Timesheet import is not enabled for this page in School Settings.');
    error.statusCode = 403;
    throw error;
  }
  if (!cleanId(policy.importActivityId)) {
    const error = new Error('Legacy import activity is not configured in School Settings.');
    error.statusCode = 400;
    throw error;
  }
  return policy;
}

async function resolveImportActivity({ orgId, reqUser, activityId }) {
  const activity = await activityService.getActivity(activityId, reqUser);
  if (!activity || !idsEqual(activity.orgId, orgId)) {
    const error = new Error('The configured legacy import activity was not found.');
    error.statusCode = 400;
    throw error;
  }
  if (normalizeStatus(activity.status) !== 'posted') {
    const error = new Error('The configured legacy import activity must be posted.');
    error.statusCode = 400;
    throw error;
  }
  if (activity.paid !== true) {
    const error = new Error('The configured legacy import activity must be marked as paid.');
    error.statusCode = 400;
    throw error;
  }
  return activity;
}

async function resolvePublicStatHolidayActivity({ orgId, reqUser, activityId }) {
  const activity = await resolveImportActivity({ orgId, reqUser, activityId });
  const visibilityScope = activityService.normalizeActivityVisibilityScope(
    activity.visibilityScope || activity.calendarScope || activity.scope
  );
  if (visibilityScope !== 'school') {
    const error = new Error('The configured statutory holiday activity must be a public (school) activity.');
    error.statusCode = 400;
    throw error;
  }
  return activity;
}

function assertTimesheetEditable(timesheet, period) {
  if (period && normalizeStatus(period.status) === 'processed') {
    const error = new Error('This timesheet period has been processed and is locked.');
    error.statusCode = 400;
    throw error;
  }
  const status = normalizeStatus(timesheet?.status || 'not_started');
  if (status === 'submitted' || status === 'processed') {
    const error = new Error('Imported timesheets can only be applied to draft or not-started timesheets.');
    error.statusCode = 400;
    throw error;
  }
}

function isActivityFirstLegacyImport(timesheet = {}) {
  if (String(timesheet?.legacyImport?.executionMode || '').trim().toLowerCase() === 'activity_first') {
    return true;
  }
  if (cleanId(timesheet?.legacyImport?.legacyImportBatchId)) {
    return true;
  }
  const hasLegacyMeta = Boolean(
    timesheet?.legacyImport?.importedAt
    || timesheet?.legacyImport?.sourceFileName
    || timesheet?.legacyImport?.activityId
  );
  if (!hasLegacyMeta) {
    return false;
  }
  return listActiveLegacyImportEntries(timesheet).length === 0;
}

function assertLegacyImportDeletable(timesheet) {
  const hasLegacyMeta = Boolean(
    timesheet?.legacyImport?.importedAt
    || timesheet?.legacyImport?.activityId
    || timesheet?.legacyImport?.sourceFileName
    || timesheet?.legacyImport?.legacyImportBatchId
  );
  const hasLegacyEntries = (Array.isArray(timesheet.entries) ? timesheet.entries : [])
    .some((entry) => entry?.isDeleted !== true && isLegacyImportEntry(entry));
  if (!hasLegacyMeta && !hasLegacyEntries) {
    const error = new Error('No imported timesheet was found for this period.');
    error.statusCode = 404;
    throw error;
  }
}

function listActiveLegacyImportEntries(timesheet = {}) {
  return (Array.isArray(timesheet.entries) ? timesheet.entries : [])
    .filter((entry) => entry?.isDeleted !== true && isLegacyImportEntry(entry));
}

async function removeLegacyImportRowsFromActivity({ activityId, timesheet, legacyEntries = [], reqUser }) {
  const activity = await dataService.getDataById('activities', activityId, reqUser);
  if (!activity) return { removedAssignees: 0, removedEntries: 0 };

  const timesheetId = cleanId(timesheet?.id);
  const legacySessionIds = new Set(
    legacyEntries.map((entry) => cleanId(entry?.sessionId)).filter(Boolean)
  );
  let removedAssignees = 0;
  let removedEntries = 0;
  const nextEntries = [];

  activityService.getActivityEntries(activity).forEach((entry) => {
    const assignees = Array.isArray(entry.assignees) ? entry.assignees : [];
    const keptAssignees = assignees.filter((assignee) => {
      const fromTimesheet = idsEqual(assignee?.materializedFromTimesheetId, timesheetId);
      const fromLegacyEntry = legacySessionIds.has(cleanId(assignee?.materializedFromTimesheetEntryId));
      if (fromTimesheet && fromLegacyEntry) {
        removedAssignees += 1;
        return false;
      }
      return true;
    });
    if (keptAssignees.length !== assignees.length && !keptAssignees.length) {
      removedEntries += 1;
      return;
    }
    if (keptAssignees.length !== assignees.length) {
      nextEntries.push({ ...entry, assignees: keptAssignees });
      return;
    }
    nextEntries.push(entry);
  });

  if (!removedAssignees && !removedEntries) {
    return { removedAssignees: 0, removedEntries: 0 };
  }

  await dataService.updateData('activities', activityId, {
    ...activity,
    entries: nextEntries,
    attendees: activityService.flattenActivityAssignees(nextEntries)
  }, reqUser);
  return { removedAssignees, removedEntries };
}

function collectImportWorkSessionEntryIds(timesheet = {}, personId = '') {
  const targets = collectImportWorkSessionTargets(timesheet, personId);
  const entryIds = new Set();
  targets.forEach((target) => {
    (Array.isArray(target.entryIds) ? target.entryIds : []).forEach((entryId) => {
      const normalized = cleanId(entryId);
      if (normalized) entryIds.add(normalized);
    });
  });
  return [...entryIds];
}

function collectImportWorkSessionTargetsFromEntries(timesheet = {}, personId = '') {
  const targetPersonId = cleanId(personId) || cleanId(timesheet?.teacherId);
  const groups = new Map();
  (Array.isArray(timesheet?.entries) ? timesheet.entries : []).forEach((entry) => {
    if (!entry || entry.isDeleted === true) return;
    const activityId = cleanId(entry?.activityId);
    const entryId = timesheetImportWorkSessionBuilderService.parseActivityEntryIdFromSessionId(
      entry?.sessionId,
      { activityId, personId: targetPersonId }
    );
    if (!activityId || !entryId) return;
    const bucket = groups.get(activityId) || [];
    bucket.push(entryId);
    groups.set(activityId, bucket);
  });
  return [...groups.entries()]
    .map(([activityId, entryIds]) => ({
      activityId,
      entryIds: [...new Set(entryIds.map((entryId) => cleanId(entryId)).filter(Boolean))]
    }))
    .filter((row) => row.activityId && row.entryIds.length);
}

function collectImportWorkSessionTargetsFromStoredEntryIds(storedEntryIds = []) {
  const groups = new Map();
  (Array.isArray(storedEntryIds) ? storedEntryIds : []).forEach((rawEntryId) => {
    const parsed = activityEntryIdService.parseEntryId(rawEntryId);
    const activityId = cleanId(parsed?.activityId);
    const entryId = cleanId(rawEntryId);
    if (!activityId || !entryId) return;
    const bucket = groups.get(activityId) || [];
    bucket.push(entryId);
    groups.set(activityId, bucket);
  });
  return [...groups.entries()]
    .map(([activityId, entryIds]) => ({
      activityId,
      entryIds: [...new Set(entryIds)]
    }))
    .filter((row) => row.activityId && row.entryIds.length);
}

function collectImportWorkSessionTargets(timesheet = {}, personId = '') {
  const workSessionActivities = Array.isArray(timesheet?.legacyImport?.workSessionActivities)
    ? timesheet.legacyImport.workSessionActivities
    : [];
  if (workSessionActivities.length) {
    return workSessionActivities
      .map((row) => ({
        activityId: cleanId(row?.activityId),
        entryIds: (Array.isArray(row?.entryIds) ? row.entryIds : [])
          .map((entryId) => cleanId(entryId))
          .filter(Boolean)
      }))
      .filter((row) => row.activityId);
  }

  const targetPersonId = cleanId(personId) || cleanId(timesheet?.teacherId);
  const storedIds = (Array.isArray(timesheet?.legacyImport?.workSessionEntryIds)
    ? timesheet.legacyImport.workSessionEntryIds
    : [])
    .map((entryId) => cleanId(entryId))
    .filter(Boolean);

  const groupedFromStoredIds = collectImportWorkSessionTargetsFromStoredEntryIds(storedIds);
  if (groupedFromStoredIds.length) return groupedFromStoredIds;

  const groupedFromEntries = collectImportWorkSessionTargetsFromEntries(timesheet, targetPersonId);
  if (groupedFromEntries.length) return groupedFromEntries;

  const activityId = cleanId(timesheet?.legacyImport?.activityId);
  const entryIds = storedIds.length
    ? [...new Set(storedIds)]
    : timesheetImportWorkSessionBuilderService.extractActivityEntryIdsFromTimesheetEntries(
      timesheet?.entries,
      { activityId, personId: targetPersonId }
    );
  if (!activityId) return [];
  return [{ activityId, entryIds }];
}

async function cleanupImportWorkSessionsOnDelete({
  timesheet,
  orgId = '',
  personId = '',
  period = null,
  reqUser,
  forceOrphanRecovery = false
} = {}) {
  const activityId = cleanId(timesheet?.legacyImport?.activityId);
  const batchId = cleanId(timesheet?.legacyImport?.legacyImportBatchId);
  const targetPersonId = cleanId(personId) || cleanId(timesheet?.teacherId);
  const periodId = cleanId(period?.id);
  const periodStartDate = cleanId(period?.startDate);
  const periodEndDate = cleanId(period?.endDate);
  const shouldCleanup = forceOrphanRecovery
    || isActivityFirstLegacyImport(timesheet)
    || Boolean(activityId && batchId)
    || Boolean(activityId && targetPersonId && periodStartDate && periodEndDate);
  if (!shouldCleanup) {
    return null;
  }

  let cleanup = { removedEntries: 0, removedAssignees: 0, strategies: [], errors: [] };
  const targetOptions = {
    personId: targetPersonId,
    periodId,
    periodStartDate,
    periodEndDate
  };

  const recordCleanupError = (strategy, error) => {
    cleanup.errors.push({ strategy, message: String(error?.message || error || 'Unknown error') });
  };

  const workSessionTargets = collectImportWorkSessionTargets(timesheet, targetPersonId);
  const cleanupActivityIds = [...new Set(
    workSessionTargets.map((target) => cleanId(target.activityId)).filter(Boolean)
  )];
  const primaryActivityId = cleanId(activityId) || cleanupActivityIds[0] || '';

  if (batchId && cleanupActivityIds.length) {
    for (const targetActivityId of cleanupActivityIds) {
      try {
        const batchCleanup = await timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByBatchId({
          activityId: targetActivityId,
          batchId,
          reqUser
        });
        cleanup = {
          ...mergeImportWorkSessionCleanupTotals(cleanup, batchCleanup),
          strategies: [...cleanup.strategies, 'batchId'],
          errors: cleanup.errors
        };
      } catch (error) {
        recordCleanupError('batchId', error);
        throw error;
      }
    }
  }

  for (const target of workSessionTargets) {
    const targetActivityId = cleanId(target.activityId);
    const entryIds = (Array.isArray(target.entryIds) ? target.entryIds : [])
      .map((entryId) => cleanId(entryId))
      .filter(Boolean);
    if (!targetActivityId || !entryIds.length) continue;
    try {
      const entryCleanup = await timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByEntryIds({
        activityId: targetActivityId,
        entryIds,
        reqUser
      });
      if (entryCleanup.removedEntries || entryCleanup.removedAssignees) {
        cleanup = {
          ...mergeImportWorkSessionCleanupTotals(cleanup, entryCleanup),
          strategies: [...cleanup.strategies, 'entryIds'],
          errors: cleanup.errors
        };
      }
    } catch (error) {
      recordCleanupError('entryIds', error);
      throw error;
    }
  }

  for (const targetActivityId of cleanupActivityIds) {
    if (!targetActivityId || !targetPersonId || !periodStartDate || !periodEndDate) continue;
    try {
      const targetCleanup = await timesheetImportWorkSessionBuilderService.removeImportWorkSessionsForTarget({
        activityId: targetActivityId,
        periodId,
        ...targetOptions,
        reqUser
      });
      if (targetCleanup.removedEntries || targetCleanup.removedAssignees) {
        cleanup = {
          ...mergeImportWorkSessionCleanupTotals(cleanup, targetCleanup),
          strategies: [...cleanup.strategies, 'personPeriodTarget'],
          errors: cleanup.errors
        };
      }
    } catch (error) {
      recordCleanupError('personPeriodTarget', error);
      throw error;
    }
  }

  if (cleanId(orgId) && targetPersonId && periodStartDate && periodEndDate) {
    for (const trackedActivityId of cleanupActivityIds.length ? cleanupActivityIds : [primaryActivityId].filter(Boolean)) {
      try {
        const trackedCleanup = await timesheetImportWorkSessionBuilderService.removeTrackedImportWorkSessionsForPersonPeriod({
          orgId,
          ...targetOptions,
          importActivityId: trackedActivityId,
          reqUser
        });
        if (trackedCleanup.removedEntries) {
          cleanup = {
            ...mergeImportWorkSessionCleanupTotals(cleanup, trackedCleanup),
            strategies: [...cleanup.strategies, 'trackedImportActivities'],
            cleanedActivities: [
              ...(Array.isArray(cleanup.cleanedActivities) ? cleanup.cleanedActivities : []),
              ...(Array.isArray(trackedCleanup.cleanedActivities) ? trackedCleanup.cleanedActivities : [])
            ],
            errors: cleanup.errors
          };
        }
      } catch (error) {
        recordCleanupError('trackedImportActivities', error);
        throw error;
      }
    }
  }

  if (!cleanup.removedEntries && !cleanup.removedAssignees) {
    if (cleanup.errors.length) {
      const error = new Error(`Import work session cleanup failed: ${cleanup.errors.map((row) => row.message).join('; ')}`);
      error.statusCode = 500;
      throw error;
    }
    return null;
  }
  delete cleanup.errors;
  return cleanup;
}

function buildLegacyImportDeleteMessage(outcome = {}) {
  const cleanup = outcome?.importWorkSessionCleanup || null;
  const removedSessions = Number(cleanup?.removedEntries || 0);
  const parts = [];
  if (outcome?.timesheetAlreadyRemoved) {
    parts.push('Imported timesheet was already removed for this period.');
  } else if (outcome?.deletedTimesheet) {
    parts.push('Imported timesheet was removed.');
  } else if (outcome?.hadLegacyImport) {
    parts.push('Imported timesheet rows were removed.');
  }
  if (removedSessions > 0) {
    parts.push(`${removedSessions} import work session${removedSessions === 1 ? '' : 's'} removed from the import activity.`);
  } else if (outcome?.hadLegacyImport && !outcome?.timesheetAlreadyRemoved) {
    parts.push('No import work sessions were found on the import activity.');
  }
  return parts.join(' ') || 'Imported timesheet rows were removed.';
}

async function countOrphanImportWorkSessionsForPersonPeriod({
  orgId,
  personId,
  period,
  reqUser
} = {}) {
  const policy = await loadImportPolicy(orgId);
  const importActivityId = cleanId(policy?.importActivityId);
  if (!importActivityId) return 0;
  const countsByPerson = await timesheetImportWorkSessionBuilderService.countOrphanImportWorkSessionsByPerson({
    orgId,
    periodId: cleanId(period?.id),
    periodStartDate: cleanId(period?.startDate),
    periodEndDate: cleanId(period?.endDate),
    importActivityId,
    reqUser
  });
  return Number(countsByPerson.get(cleanId(personId)) || 0);
}

function mergeImportWorkSessionCleanupTotals(left = {}, right = {}) {
  return timesheetImportWorkSessionBuilderService.mergeImportWorkSessionCleanupTotals(left, right);
}

async function cleanupStatHolidayOnImportDelete({
  orgId,
  personId,
  period,
  reqUser
}) {
  try {
    const timesheetParametersPolicyModel = require('../../models/school/timesheetParametersPolicyModel');
    const statutoryHolidayWorkSessionService = require('./statutoryHolidayWorkSessionService');
    const policy = await timesheetParametersPolicyModel.getPolicyForOrg(orgId);
    return await statutoryHolidayWorkSessionService.cleanupStatHolidayWorkSessionsOnImportDelete({
      orgId,
      personId,
      period,
      policy,
      reqUser
    });
  } catch (error) {
    console.warn(`Legacy import delete stat holiday cleanup skipped: ${error.message}`);
    return null;
  }
}

async function purgeLegacyImportSideEffects({
  timesheet,
  orgId = '',
  personId = '',
  period = null,
  reqUser
}) {
  const timesheetId = cleanId(timesheet?.id);
  if (!timesheetId) {
    return { revertedMaterialization: false, unlockedSources: false, activityCleanup: null };
  }

  const status = normalizeStatus(timesheet?.status || 'draft');
  const legacyEntries = listActiveLegacyImportEntries(timesheet);
  let revertedMaterialization = false;
  let unlockedSources = false;

  if (POST_SAVE_IMPORT_STATUSES.has(status) || status === 'processed') {
    try {
      await timesheetManualMaterializationService.revertMaterializedRecordsForTimesheet({ timesheetId, reqUser });
      revertedMaterialization = true;
    } catch (error) {
      console.warn(`Legacy import delete materialization revert skipped for timesheet ${timesheetId}: ${error.message}`);
    }
    try {
      await schoolDependencyService.unlockSourcesForTimesheet(timesheet, reqUser);
      unlockedSources = true;
    } catch (error) {
      console.warn(`Legacy import delete unlock skipped for timesheet ${timesheetId}: ${error.message}`);
    }
  }

  for (const entry of legacyEntries) {
    const activityId = cleanId(entry?.activityId || timesheet?.legacyImport?.activityId);
    if (!activityId) continue;
    if (!entry?.materializedAt && !cleanId(entry?.activityEntryId)) continue;
    try {
      await timesheetManualMaterializationService.revertMaterializedActivityManualEntry({
        timesheetId,
        timesheetEntryId: cleanId(entry?.materializedFromTimesheetEntryId || entry?.sessionId),
        activityId,
        activityEntryId: cleanId(entry?.activityEntryId),
        reqUser
      });
    } catch (error) {
      console.warn(`Legacy import delete activity row revert skipped for ${cleanId(entry?.sessionId)}: ${error.message}`);
    }
  }

  const activityId = cleanId(timesheet?.legacyImport?.activityId)
    || cleanId(legacyEntries[0]?.activityId);
  let importWorkSessionCleanup = null;
  importWorkSessionCleanup = await cleanupImportWorkSessionsOnDelete({
    timesheet,
    orgId,
    personId,
    period,
    reqUser
  });
  const statHolidayCleanup = await cleanupStatHolidayOnImportDelete({
    orgId,
    personId: cleanId(personId) || cleanId(timesheet?.teacherId),
    period,
    reqUser
  });
  const activityCleanup = activityId && legacyEntries.length
    ? await removeLegacyImportRowsFromActivity({ activityId, timesheet, legacyEntries, reqUser })
    : null;

  return {
    revertedMaterialization,
    unlockedSources,
    activityCleanup,
    importWorkSessionCleanup,
    statHolidayCleanup
  };
}

function buildTimesheetPayloadAfterLegacyDelete(timesheet, nextEntries) {
  const activeEntryCount = nextEntries.filter((entry) => entry && entry.isDeleted !== true).length;
  const payload = {
    ...timesheet,
    entries: nextEntries,
    totalHours: calculateStoredEntryTotalHours(nextEntries),
    legacyImport: null
  };
  if (activeEntryCount > 0) return payload;
  return {
    ...payload,
    status: 'draft',
    submissionSnapshot: null,
    managerReview: null,
    materializationSummary: null,
    lockedSourceRefs: [],
    approvedAt: '',
    approvedBy: '',
    processedAt: '',
    processedBy: '',
    processedByName: '',
    returnedAt: '',
    returnedBy: '',
    returnReason: '',
    allowLateSubmission: false
  };
}

function isLegacyImportEntry(entry = {}) {
  return entry?.isLegacyImport === true || String(entry?.sessionId || '').startsWith('legacyimp-');
}

function stripLegacyImportEntries(entries = []) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => !isLegacyImportEntry(entry));
}

function buildExistingTimesheetSkipMessage(timesheet = {}, period = {}) {
  const legacyImportFileName = String(timesheet?.legacyImport?.sourceFileName || '').trim();
  const periodLabel = String(period?.name || period?.id || timesheet?.periodId || 'this period').trim();
  if (legacyImportFileName) {
    return `A timesheet already exists for ${periodLabel}. Delete the imported file (${legacyImportFileName}) or clear the existing timesheet in Timesheet Management, then import again.`;
  }
  return `A timesheet already exists for ${periodLabel}. Clear or remove the existing timesheet in Timesheet Management, then import again.`;
}

function buildExistingTimesheetSkipDescriptor(timesheet = {}, period = {}) {
  const periodId = cleanId(period?.id || timesheet?.periodId);
  const legacyImportFileName = String(timesheet?.legacyImport?.sourceFileName || '').trim();
  return {
    periodId,
    periodName: String(period?.name || period?.id || periodId).trim(),
    timesheetId: cleanId(timesheet?.id),
    timesheetStatus: normalizeStatus(timesheet?.status || 'draft') || 'draft',
    legacyImportFileName,
    message: buildExistingTimesheetSkipMessage(timesheet, period)
  };
}

async function detectExistingTimesheetForImport({ periodId, personId, reqUser, period = null }) {
  const existing = await dataService.getTimesheetByPeriodAndTeacher(periodId, personId, reqUser);
  if (!existing?.id) return null;
  const resolvedPeriod = period || await dataService.getDataById('timesheetPeriods', periodId, reqUser);
  return buildExistingTimesheetSkipDescriptor(existing, resolvedPeriod || { id: periodId });
}

function buildImportExecutionExistingTimesheetSummary(timesheet = {}, period = {}) {
  const descriptor = buildExistingTimesheetSkipDescriptor(timesheet, period);
  return {
    id: descriptor.timesheetId,
    status: descriptor.timesheetStatus,
    legacyImportFileName: descriptor.legacyImportFileName,
    periodId: descriptor.periodId,
    periodName: descriptor.periodName
  };
}

async function resolveImportExecutionEligibility({ periodId, personId, reqUser, period = null }) {
  const existing = await dataService.getTimesheetByPeriodAndTeacher(periodId, personId, reqUser);
  if (!existing?.id) {
    return {
      state: 'ready',
      existingTimesheet: null,
      message: ''
    };
  }

  const resolvedPeriod = period || await dataService.getDataById('timesheetPeriods', periodId, reqUser);
  const existingTimesheet = buildImportExecutionExistingTimesheetSummary(existing, resolvedPeriod || { id: periodId });
  const status = normalizeStatus(existing?.status || 'draft') || 'draft';

  if (status === 'draft' || status === 'not_started') {
    return {
      state: 'ready',
      existingTimesheet,
      message: ''
    };
  }

  const skipDescriptor = buildExistingTimesheetSkipDescriptor(existing, resolvedPeriod || { id: periodId });
  return {
    state: 'blocked',
    existingTimesheet,
    message: skipDescriptor.message
  };
}

function buildLegacyImportEntries({
  compiledRows = [],
  activity = {},
  personId = '',
  periodId = ''
}) {
  const targetPersonId = cleanId(personId);
  const targetPeriodId = cleanId(periodId);
  const activityId = cleanId(activity.id);
  const activityTitle = String(activity.title || activityId || 'Legacy Import').trim();
  const departmentId = cleanId(activity.departmentId);
  const departmentName = String(activity.departmentName || '').trim();
  const categoryName = String(activity.categoryName || '').trim();
  const visibilityScope = normalizeStatus(activity.visibilityScope) === 'individual' ? 'individual' : 'school';

  return (Array.isArray(compiledRows) ? compiledRows : [])
    .map((row, index) => {
      const hours = timesheetImportWorkSessionBuilderService.resolveImportBillableHours(row);
      const date = cleanId(row?.date);
      const className = String(row?.className || '').trim();
      if (!date || !Number.isFinite(hours) || hours <= 0) return null;
      const commentParts = [];
      if (row?.comment) commentParts.push(String(row.comment).trim());
      if (row?.studentName) commentParts.push(`Student: ${String(row.studentName).trim()}`);
      const optionalComment = timesheetImportWorkSessionBuilderService.buildImportOptionalHoursComment(row?.optionalHours);
      if (optionalComment) commentParts.push(optionalComment);
      return {
        sessionId: `legacyimp-${targetPeriodId}-${targetPersonId}-${index + 1}`,
        date,
        className,
        hours,
        timesheetHours: hours,
        durationHours: hours,
        status: 'activity',
        comment: commentParts.filter(Boolean).join(' | '),
        isManual: false,
        isSchoolActivity: true,
        isLegacyImport: true,
        isFinalStatus: true,
        activityId,
        activityName: activityTitle,
        departmentId,
        departmentName,
        categoryName,
        visibilityScope,
        compensationLookup: {
          personId: targetPersonId,
          departmentId,
          activityId
        }
      };
    })
    .filter(Boolean);
}

function groupCompileResultsByPeriod(compileResults = [], periodFilterId = '') {
  const filterId = cleanId(periodFilterId);
  const grouped = new Map();
  (Array.isArray(compileResults) ? compileResults : []).forEach((result) => {
    if (!result || result.status !== 'ok') return;
    const matchedPeriodId = cleanId(result?.matchedPeriod?.id);
    if (!matchedPeriodId) return;
    if (filterId && !idsEqual(matchedPeriodId, filterId)) return;
    const bucket = grouped.get(matchedPeriodId) || [];
    bucket.push(result);
    grouped.set(matchedPeriodId, bucket);
  });
  return grouped;
}

async function persistTimesheetPayload(timesheet, reqUser) {
  const sanitized = sanitizeTimesheetPayload(timesheet);
  if (timesheet?.id) {
    return dataService.updateData('timesheets', timesheet.id, sanitized, reqUser);
  }
  return dataService.addData('timesheets', sanitized, reqUser);
}

function calculateStoredEntryTotalHours(entries = []) {
  const total = (Array.isArray(entries) ? entries : []).reduce((sum, entry) => {
    if (!entry || entry.isDeleted === true) return sum;
    return sum + Number(parseFloat(entry?.hours ?? entry?.timesheetHours ?? entry?.durationHours) || 0);
  }, 0);
  return Number(total.toFixed(2));
}

async function applyLegacyImportForPeriod({
  orgId,
  personId,
  periodId,
  compileResults = [],
  activity,
  reqUser,
  importedBy = '',
  importTargetStatus = 'draft'
}) {
  const period = await dataService.getDataById('timesheetPeriods', periodId, reqUser);
  if (!period) throw new Error('Timesheet period not found.');
  if (!idsEqual(period.orgId, orgId)) throw new Error('Timesheet period is not in the active organization.');

  const existingSkip = await detectExistingTimesheetForImport({
    periodId,
    personId,
    reqUser,
    period
  });
  if (existingSkip) {
    const error = new Error(existingSkip.message);
    error.statusCode = 409;
    error.skipDescriptor = existingSkip;
    throw error;
  }

  const combinedRows = (Array.isArray(compileResults) ? compileResults : [])
    .flatMap((result) => (Array.isArray(result?.rows) ? result.rows : []));
  const lastResult = (Array.isArray(compileResults) ? compileResults : []).slice(-1)[0] || null;
  const legacyEntries = buildLegacyImportEntries({
    compiledRows: combinedRows,
    activity,
    personId,
    periodId
  });
  if (!legacyEntries.length) {
    throw new Error('No import rows were available for the selected period.');
  }

  const nowIso = new Date().toISOString();
  const payload = {
    orgId,
    periodId: cleanId(periodId),
    teacherId: cleanId(personId),
    status: 'draft',
    entries: legacyEntries,
    totalHours: calculateStoredEntryTotalHours(legacyEntries),
    legacyImport: {
      activityId: cleanId(activity.id),
      sourceFileName: String(lastResult?.fileName || 'imported.xlsx').trim(),
      importedAt: nowIso,
      importedBy: cleanId(importedBy),
      rowCount: legacyEntries.length,
      matchedPeriodId: cleanId(periodId)
    }
  };

  const { payload: lifecyclePayload, requiresPostSaveFinalization, appliedStatus } =
    timesheetImportLifecycleService.prepareImportTargetPayload({
      basePayload: payload,
      period,
      targetStatus: importTargetStatus,
      reqUser,
      priorTimesheet: null
    });

  let saved = await persistTimesheetPayload(lifecyclePayload, reqUser);
  if (requiresPostSaveFinalization) {
    saved = await timesheetImportLifecycleService.finalizeImportTargetAfterSave({
      savedTimesheet: saved,
      period,
      targetStatus: appliedStatus,
      reqUser,
      dataService
    });
  }

  return {
    timesheet: saved,
    timesheetId: cleanId(saved?.id),
    rowCount: legacyEntries.length,
    periodId: cleanId(periodId),
    sourceFileName: payload.legacyImport.sourceFileName,
    appliedStatus
  };
}

async function rollbackAppliedLegacyImports(rollbackStack = [], reqUser) {
  const rolledBack = [];
  for (const entry of [...rollbackStack].reverse()) {
    const timesheetId = cleanId(entry?.timesheetId);
    if (!timesheetId) continue;
    try {
      let timesheet = entry?.timesheet && typeof entry.timesheet === 'object' ? entry.timesheet : null;
      if (!timesheet) {
        timesheet = await dataService.getDataById('timesheets', timesheetId, reqUser);
      }
      if (timesheet) {
        const appliedStatus = normalizeStatus(entry?.appliedStatus || timesheet?.status || 'draft');
        if (POST_SAVE_IMPORT_STATUSES.has(appliedStatus) || normalizeStatus(timesheet.status) === 'processed') {
          try {
            await timesheetManualMaterializationService.revertMaterializedRecordsForTimesheet({
              timesheetId,
              reqUser
            });
          } catch (error) {
            console.warn(`Import rollback materialization revert skipped for timesheet ${timesheetId}: ${error.message}`);
          }
          try {
            await schoolDependencyService.unlockSourcesForTimesheet(timesheet, reqUser);
          } catch (error) {
            console.warn(`Import rollback unlock skipped for timesheet ${timesheetId}: ${error.message}`);
          }
        }
        try {
          await taskService.resolveTimesheetTask(timesheet, reqUser, {
            note: 'Legacy Excel import rolled back.',
            action: 'timesheet_import_rollback'
          });
        } catch (error) {
          console.warn(`Import rollback task sync skipped for timesheet ${timesheetId}: ${error.message}`);
        }
      }
      const periodId = cleanId(entry?.periodId || timesheet?.periodId);
      const period = periodId && reqUser
        ? await dataService.getDataById('timesheetPeriods', periodId, reqUser)
        : null;
      await purgeImportedTimesheetRecord(timesheetId, reqUser, {
        timesheet,
        orgId: cleanId(timesheet?.orgId),
        personId: cleanId(timesheet?.teacherId),
        periodId,
        period
      });
      rolledBack.push({
        periodId,
        timesheetId
      });
    } catch (error) {
      console.warn(`Import rollback failed for timesheet ${timesheetId}: ${error.message}`);
    }
  }
  return rolledBack;
}

function buildImportOutcomeMessage({ applied = [], skipped = [], totalRows = 0 }) {
  if (applied.length && skipped.length) {
    return `Imported ${totalRows} row(s) across ${applied.length} period(s). ${skipped.length} period(s) were skipped because a timesheet already exists.`;
  }
  if (applied.length) {
    return `Imported ${totalRows} row(s) across ${applied.length} period(s).`;
  }
  if (skipped.length) {
    return `No timesheets were imported. ${skipped.length} period(s) already have a timesheet. Delete or clear the existing timesheet, then import again.`;
  }
  return 'No timesheets were imported.';
}

function resolveImportOutcomeStatus(applied = [], skipped = []) {
  if (applied.length > 0) return 'success';
  if (skipped.length > 0) return 'partial';
  return 'success';
}

async function applyLegacyImports({
  orgId,
  personId,
  compileResults = [],
  reqUser,
  scope = IMPORT_SCOPES.MANAGEMENT,
  periodFilterId = ''
}) {
  const policy = await assertImportAllowed({ orgId, scope });
  const activity = await resolveImportActivity({
    orgId,
    reqUser,
    activityId: policy.importActivityId
  });
  const grouped = groupCompileResultsByPeriod(compileResults, periodFilterId);
  if (!grouped.size) {
    throw new Error('No compiled files matched an app timesheet period for import.');
  }

  const importTargetStatus = timesheetImportPolicyService.resolveImportTargetStatusForScope(policy, scope);
  const skipped = [];
  const toApply = [];

  for (const [periodId, results] of grouped.entries()) {
    const period = await dataService.getDataById('timesheetPeriods', periodId, reqUser);
    const skipDescriptor = await detectExistingTimesheetForImport({
      periodId,
      personId,
      reqUser,
      period
    });
    if (skipDescriptor) {
      skipped.push(skipDescriptor);
      continue;
    }
    toApply.push({ periodId, results, period });
  }

  const applied = [];
  const rollbackStack = [];

  try {
    for (const bucket of toApply) {
      const outcome = await applyLegacyImportForPeriod({
        orgId,
        personId,
        periodId: bucket.periodId,
        compileResults: bucket.results,
        activity,
        reqUser,
        importedBy: cleanId(reqUser?.id),
        importTargetStatus
      });
      rollbackStack.push({
        periodId: outcome.periodId,
        timesheetId: outcome.timesheetId,
        appliedStatus: outcome.appliedStatus,
        timesheet: outcome.timesheet
      });
      applied.push({
        periodId: outcome.periodId,
        timesheetId: outcome.timesheetId,
        rowCount: outcome.rowCount,
        sourceFileName: outcome.sourceFileName,
        appliedStatus: outcome.appliedStatus
      });
    }
  } catch (error) {
    const rolledBack = rollbackStack.length
      ? await rollbackAppliedLegacyImports(rollbackStack, reqUser)
      : [];
    const rollbackError = new Error(`${error.message} Import failed and earlier changes were rolled back.`);
    rollbackError.statusCode = Number(error?.statusCode) || 400;
    rollbackError.rolledBack = rolledBack;
    throw rollbackError;
  }

  const totalRows = applied.reduce((sum, row) => sum + Number(row.rowCount || 0), 0);
  const responseStatus = resolveImportOutcomeStatus(applied, skipped);

  return {
    responseStatus,
    applied,
    skipped,
    rolledBack: [],
    totalRows,
    appliedStatus: importTargetStatus,
    message: buildImportOutcomeMessage({ applied, skipped, totalRows })
  };
}

async function deleteLegacyImport({
  orgId,
  personId,
  periodId,
  reqUser,
  scope = IMPORT_SCOPES.MANAGEMENT,
  skipImportPolicyCheck = false
}) {
  if (!skipImportPolicyCheck) {
    await assertImportAllowed({ orgId, scope });
  }
  const targetPeriodId = cleanId(periodId);
  const period = await dataService.getDataById('timesheetPeriods', targetPeriodId, reqUser);
  if (!period) throw new Error('Timesheet period not found.');
  if (!idsEqual(period.orgId, orgId)) throw new Error('Timesheet period is not in the active organization.');

  const timesheet = await dataService.getTimesheetByPeriodAndTeacher(targetPeriodId, personId, reqUser);
  if (!timesheet?.id) {
    const policy = skipImportPolicyCheck
      ? await loadImportPolicy(orgId)
      : await assertImportAllowed({ orgId, scope });
    const importActivityId = cleanId(policy?.importActivityId);
    if (!importActivityId) {
      return {
        removedRows: 0,
        hadLegacyImport: false,
        periodId: targetPeriodId,
        tsStatus: 'not_started',
        totalHours: 0,
        hasLegacyImport: false,
        timesheetId: ''
      };
    }

    const orphanSessionCount = await countOrphanImportWorkSessionsForPersonPeriod({
      orgId,
      personId,
      period,
      reqUser
    });
    const statHolidayCleanup = await cleanupStatHolidayOnImportDelete({
      orgId,
      personId,
      period,
      reqUser
    });
    if (!orphanSessionCount) {
      const statHolidayRemoved = Number(statHolidayCleanup?.removedAssignees || 0)
        + Number(statHolidayCleanup?.removedEntries || 0);
      if (!statHolidayRemoved) {
        return {
          removedRows: 0,
          hadLegacyImport: false,
          periodId: targetPeriodId,
          tsStatus: 'not_started',
          totalHours: 0,
          hasLegacyImport: false,
          timesheetId: ''
        };
      }
      return {
        removedRows: 0,
        hadLegacyImport: true,
        timesheetAlreadyRemoved: true,
        sourceFileName: '',
        periodId: targetPeriodId,
        tsStatus: 'not_started',
        totalHours: 0,
        hasLegacyImport: false,
        timesheetId: '',
        statHolidayCleanup
      };
    }

    const importWorkSessionCleanup = await cleanupImportWorkSessionsOnDelete({
      timesheet: {
        teacherId: personId,
        legacyImport: { activityId: importActivityId }
      },
      orgId,
      personId,
      period,
      reqUser,
      forceOrphanRecovery: true
    });
    if (!importWorkSessionCleanup?.removedEntries && !importWorkSessionCleanup?.removedAssignees) {
      return {
        removedRows: 0,
        hadLegacyImport: false,
        periodId: targetPeriodId,
        tsStatus: 'not_started',
        totalHours: 0,
        hasLegacyImport: false,
        timesheetId: ''
      };
    }

    return {
      removedRows: 0,
      hadLegacyImport: true,
      timesheetAlreadyRemoved: true,
      sourceFileName: '',
      periodId: targetPeriodId,
      tsStatus: 'not_started',
      totalHours: 0,
      hasLegacyImport: false,
      timesheetId: '',
      importWorkSessionCleanup,
      statHolidayCleanup
    };
  }
  assertLegacyImportDeletable(timesheet);

  const activityFirst = isActivityFirstLegacyImport(timesheet);

  const sideEffects = await purgeLegacyImportSideEffects({
    timesheet,
    orgId,
    personId,
    period,
    reqUser
  });

  if (activityFirst) {
    const timesheetId = cleanId(timesheet?.id);
    if (timesheetId) {
      await purgeImportedTimesheetRecord(timesheetId, reqUser, {
        timesheet,
        orgId,
        personId: cleanId(personId) || cleanId(timesheet?.teacherId),
        periodId: targetPeriodId,
        period,
        skipStatHolidayCleanup: true
      });
    }
    return {
      removedRows: Array.isArray(timesheet.entries) ? timesheet.entries.length : 0,
      hadLegacyImport: true,
      sourceFileName: String(timesheet?.legacyImport?.sourceFileName || '').trim(),
      periodId: targetPeriodId,
      tsStatus: 'not_started',
      totalHours: 0,
      hasLegacyImport: false,
      timesheetId: '',
      deletedTimesheet: true,
      activityCleanup: sideEffects?.activityCleanup || null,
      importWorkSessionCleanup: sideEffects?.importWorkSessionCleanup || null,
      statHolidayCleanup: sideEffects?.statHolidayCleanup || null
    };
  }

  const existingEntries = Array.isArray(timesheet.entries) ? timesheet.entries : [];
  const nextEntries = stripLegacyImportEntries(existingEntries);
  const removedRows = existingEntries.length - nextEntries.length;
  if (!removedRows && !timesheet.legacyImport) {
    return {
      removedRows: 0,
      hadLegacyImport: false,
      periodId: targetPeriodId,
      tsStatus: normalizeStatus(timesheet?.status || 'draft') || 'draft',
      totalHours: calculateStoredEntryTotalHours(existingEntries),
      hasLegacyImport: false,
      timesheetId: cleanId(timesheet?.id)
    };
  }

  const payload = buildTimesheetPayloadAfterLegacyDelete(timesheet, nextEntries);
  const saved = await persistTimesheetPayload(payload, reqUser);
  const activeEntryCount = nextEntries.filter((entry) => entry && entry.isDeleted !== true).length;
  const tsStatus = activeEntryCount > 0
    ? (normalizeStatus(saved?.status || timesheet?.status || 'draft') || 'draft')
    : 'not_started';

  return {
    removedRows,
    hadLegacyImport: true,
    sourceFileName: String(timesheet?.legacyImport?.sourceFileName || '').trim(),
    periodId: targetPeriodId,
    tsStatus,
    totalHours: calculateStoredEntryTotalHours(nextEntries),
    hasLegacyImport: false,
    timesheetId: cleanId(saved?.id || timesheet?.id),
    activityCleanup: sideEffects?.activityCleanup || null,
    importWorkSessionCleanup: sideEffects?.importWorkSessionCleanup || null,
    statHolidayCleanup: sideEffects?.statHolidayCleanup || null
  };
}

async function periodHasDeletableLegacyImport({
  orgId,
  personId,
  period,
  reqUser,
  scope = IMPORT_SCOPES.MY_TIMESHEETS,
  skipImportPolicyCheck = false
} = {}) {
  const targetPeriodId = cleanId(period?.id);
  if (!targetPeriodId) return false;

  const timesheet = await dataService.getTimesheetByPeriodAndTeacher(targetPeriodId, personId, reqUser);
  if (timesheet?.id) {
    try {
      assertLegacyImportDeletable(timesheet);
      return true;
    } catch {
      return false;
    }
  }

  let policy;
  if (skipImportPolicyCheck) {
    policy = await loadImportPolicy(orgId);
  } else {
    try {
      policy = await assertImportAllowed({ orgId, scope });
    } catch {
      return false;
    }
  }
  const importActivityId = cleanId(policy?.importActivityId);
  if (!importActivityId) return false;

  const orphanSessionCount = await countOrphanImportWorkSessionsForPersonPeriod({
    orgId,
    personId,
    period,
    reqUser
  });
  return orphanSessionCount > 0;
}

async function deleteLegacyImportsForYear({
  orgId,
  personId,
  year,
  reqUser,
  scope = IMPORT_SCOPES.MY_TIMESHEETS,
  skipImportPolicyCheck = false
} = {}) {
  if (!skipImportPolicyCheck) {
    await assertImportAllowed({ orgId, scope });
  }

  const yearToken = String(year || '').trim();
  if (!/^\d{4}$/.test(yearToken)) {
    const error = new Error('A valid four-digit year is required.');
    error.statusCode = 400;
    throw error;
  }

  const periods = await dataService.fetchData('timesheetPeriods', { orgId__eq: orgId }, reqUser);
  const yearPeriods = (Array.isArray(periods) ? periods : [])
    .filter((row) => idsEqual(row?.orgId, orgId))
    .filter((row) => resolvePeriodStartYearToken(row, yearToken) === yearToken)
    .sort((a, b) => String(a?.startDate || '').localeCompare(String(b?.startDate || '')));

  const results = [];
  const failures = [];
  let deletedCount = 0;
  let skippedCount = 0;

  for (const periodRow of yearPeriods) {
    const shouldAttempt = await periodHasDeletableLegacyImport({
      orgId,
      personId,
      period: periodRow,
      reqUser,
      scope,
      skipImportPolicyCheck
    });
    if (!shouldAttempt) {
      skippedCount += 1;
      continue;
    }

    try {
      const outcome = await deleteLegacyImport({
        orgId,
        personId,
        periodId: periodRow.id,
        reqUser,
        scope,
        skipImportPolicyCheck
      });
      if (!outcome.hadLegacyImport) {
        skippedCount += 1;
        continue;
      }
      deletedCount += 1;
      results.push({
        periodId: cleanId(periodRow.id),
        periodName: String(periodRow.name || '').trim(),
        ...outcome
      });
    } catch (error) {
      failures.push({
        periodId: cleanId(periodRow.id),
        periodName: String(periodRow.name || '').trim(),
        message: String(error?.message || error || 'Delete failed.')
      });
    }
  }

  return {
    year: yearToken,
    deletedCount,
    skippedCount,
    failures,
    results
  };
}

function buildLegacyImportYearDeleteMessage(outcome = {}) {
  const deletedCount = Number(outcome.deletedCount || 0);
  const failureCount = Array.isArray(outcome.failures) ? outcome.failures.length : 0;
  const yearToken = String(outcome.year || '').trim();
  const parts = [];
  if (deletedCount) {
    parts.push(`Removed imported timesheets from ${deletedCount} period${deletedCount === 1 ? '' : 's'} in ${yearToken || 'the selected year'}.`);
  } else {
    parts.push(`No imported timesheets were removed for ${yearToken || 'the selected year'}.`);
  }
  if (failureCount) {
    parts.push(`${failureCount} period${failureCount === 1 ? '' : 's'} could not be deleted.`);
  }
  return parts.join(' ');
}

module.exports = {
  IMPORT_SCOPES,
  assertImportAllowed,
  assertLegacyImportDeletable,
  assertTimesheetEditable,
  buildExistingTimesheetSkipDescriptor,
  buildLegacyImportEntries,
  buildImportOutcomeMessage,
  buildLegacyImportDeleteMessage,
  countOrphanImportWorkSessionsForPersonPeriod,
  detectExistingTimesheetForImport,
  resolveImportExecutionEligibility,
  groupCompileResultsByPeriod,
  isLegacyImportEntry,
  isActivityFirstLegacyImport,
  purgeImportedTimesheetRecord,
  cleanupStatHolidayForTimesheetTarget,
  resolveImportOutcomeStatus,
  rollbackAppliedLegacyImports,
  applyLegacyImports,
  deleteLegacyImport,
  deleteLegacyImportsForYear,
  buildLegacyImportYearDeleteMessage,
  periodHasDeletableLegacyImport,
  resolveImportActivity,
  resolvePublicStatHolidayActivity,
  persistTimesheetPayload,
  calculateStoredEntryTotalHours
};
