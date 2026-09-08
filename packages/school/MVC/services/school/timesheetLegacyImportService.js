'use strict';

const dataService = require('./schoolDataService');
const activityService = require('./activityService');
const schoolDependencyService = require('./schoolDependencyService');
const timesheetManualMaterializationService = require('./timesheetManualMaterializationService');
const taskService = require('./taskService');
const timesheetImportPolicyModel = require('../../models/school/timesheetImportPolicyModel');
const timesheetImportPolicyService = require('./timesheetImportPolicyService');
const timesheetImportLifecycleService = require('./timesheetImportLifecycleService');
const timesheetImportWorkSessionBuilderService = require('./timesheetImportWorkSessionBuilderService');
const { sanitizeTimesheetPayload } = require('../../models/school/timesheetModel');
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
  return String(timesheet?.legacyImport?.executionMode || '').trim().toLowerCase() === 'activity_first'
    || Boolean(cleanId(timesheet?.legacyImport?.legacyImportBatchId));
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

async function purgeLegacyImportSideEffects({ timesheet, reqUser }) {
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
  const batchId = cleanId(timesheet?.legacyImport?.legacyImportBatchId);
  let importWorkSessionCleanup = null;
  if (activityId && batchId) {
    try {
      importWorkSessionCleanup = await timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByBatchId({
        activityId,
        batchId,
        reqUser
      });
    } catch (error) {
      console.warn(`Legacy import delete work-session cleanup skipped for batch ${batchId}: ${error.message}`);
    }
  }
  const activityCleanup = activityId && legacyEntries.length
    ? await removeLegacyImportRowsFromActivity({ activityId, timesheet, legacyEntries, reqUser })
    : null;

  return { revertedMaterialization, unlockedSources, activityCleanup, importWorkSessionCleanup };
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
      const hours = Number(parseFloat(row?.hours) || 0);
      const date = cleanId(row?.date);
      const className = String(row?.className || '').trim();
      if (!date || !Number.isFinite(hours)) return null;
      const commentParts = [];
      if (row?.comment) commentParts.push(String(row.comment).trim());
      if (row?.studentName) commentParts.push(`Student: ${String(row.studentName).trim()}`);
      if (row?.optionalHours != null && Number.isFinite(Number(row.optionalHours))) {
        commentParts.push(`Optional hours: ${Number(row.optionalHours)}`);
      }
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
      await dataService.deleteData('timesheets', timesheetId, reqUser, { skipDeletionGuard: true });
      rolledBack.push({
        periodId: cleanId(entry?.periodId),
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
  assertLegacyImportDeletable(timesheet);

  const sideEffects = await purgeLegacyImportSideEffects({ timesheet, reqUser });
  const activityFirst = isActivityFirstLegacyImport(timesheet);

  if (activityFirst) {
    const timesheetId = cleanId(timesheet?.id);
    if (timesheetId) {
      await dataService.deleteData('timesheets', timesheetId, reqUser, { skipDeletionGuard: true });
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
      importWorkSessionCleanup: sideEffects?.importWorkSessionCleanup || null
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
    activityCleanup: sideEffects?.activityCleanup || null
  };
}

module.exports = {
  IMPORT_SCOPES,
  assertImportAllowed,
  assertLegacyImportDeletable,
  assertTimesheetEditable,
  buildExistingTimesheetSkipDescriptor,
  buildLegacyImportEntries,
  buildImportOutcomeMessage,
  detectExistingTimesheetForImport,
  groupCompileResultsByPeriod,
  isLegacyImportEntry,
  isActivityFirstLegacyImport,
  resolveImportOutcomeStatus,
  rollbackAppliedLegacyImports,
  applyLegacyImports,
  deleteLegacyImport,
  resolveImportActivity,
  persistTimesheetPayload,
  calculateStoredEntryTotalHours
};
