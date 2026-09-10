'use strict';

const dataService = require('./schoolDataService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const timesheetLegacyImportService = require('./timesheetLegacyImportService');
const timesheetImportLifecycleService = require('./timesheetImportLifecycleService');
const timesheetImportWorkSessionBuilderService = require('./timesheetImportWorkSessionBuilderService');
const timesheetImportPolicyService = require('./timesheetImportPolicyService');
const timesheetLiveAssemblyService = require('./timesheetLiveAssemblyService');
const timesheetPayrollContextService = require('./timesheetPayrollContextService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function cleanId(value) {
  return String(value ?? '').trim();
}

function buildImportSupplementalEntryFilter(batchId = '') {
  const targetBatchId = cleanId(batchId);
  if (!targetBatchId) return null;
  return (entry) => {
    const entryBatchId = cleanId(entry?.legacyImportBatchId);
    if (entryBatchId && idsEqual(entryBatchId, targetBatchId)) return false;
    const assignees = Array.isArray(entry?.assignees) ? entry.assignees : [];
    return !assignees.some((assignee) => idsEqual(cleanId(assignee?.legacyImportBatchId), targetBatchId));
  };
}

function isPerformableCompileResult(result = {}) {
  return String(result?.status || '').toLowerCase() === 'ok' && cleanId(result?.matchedPeriod?.id);
}

async function resolveImportPersonName({ orgId, personId, reqUser, fallback = '' }) {
  try {
    const person = await schoolPersonAccessService.getPersonById({
      reqUser,
      personId,
      requireSchoolRole: false
    });
    if (!person) return String(fallback || personId || '').trim();
    return String(
      person.displayName
      || person.name
      || `${person.firstName || person.name?.first || ''} ${person.lastName || person.name?.last || ''}`.trim()
      || fallback
      || personId
    ).trim();
  } catch (_error) {
    return String(fallback || personId || '').trim();
  }
}

async function buildImportExecutionPlan({
  orgId,
  personId,
  compileResults = [],
  reqUser,
  periodFilterId = ''
}) {
  await timesheetLegacyImportService.assertImportAllowed({
    orgId,
    scope: timesheetLegacyImportService.IMPORT_SCOPES.MANAGEMENT
  });

  const targetPersonId = cleanId(personId);
  const payrollContext = await timesheetPayrollContextService.resolvePayrollPersonContext({
    orgId,
    personId: targetPersonId,
    reqUser
  });
  const needsRoleSelection = payrollContext.roles.length > 1
    ? [{
      personId: targetPersonId,
      personName: payrollContext.personName,
      roles: payrollContext.roles,
      defaultRole: payrollContext.defaultRole
    }]
    : [];

  const rows = [];
  const skipped = [];
  const filterId = cleanId(periodFilterId);
  let readyCount = 0;
  let blockedCount = 0;

  for (const result of (Array.isArray(compileResults) ? compileResults : [])) {
    if (!isPerformableCompileResult(result)) continue;
    const periodId = cleanId(result?.matchedPeriod?.id);
    if (filterId && !idsEqual(periodId, filterId)) continue;

    const period = await dataService.getDataById('timesheetPeriods', periodId, reqUser);
    const eligibility = await timesheetLegacyImportService.resolveImportExecutionEligibility({
      periodId,
      personId: targetPersonId,
      reqUser,
      period
    });
    const existingTimesheet = eligibility.existingTimesheet || null;
    const row = {
      fileName: String(result?.fileName || '').trim(),
      personId: targetPersonId,
      personName: payrollContext.personName,
      periodId,
      periodName: String(period?.name || result?.matchedPeriod?.name || periodId).trim(),
      rowCount: Array.isArray(result?.rows) ? result.rows.length : 0,
      compileResult: result,
      batchId: timesheetImportWorkSessionBuilderService.buildImportBatchId({
        periodId,
        personId: targetPersonId,
        sourceFileName: result?.fileName
      }),
      eligibility: eligibility.state,
      blockReason: eligibility.state === 'blocked' ? String(eligibility.message || '').trim() : '',
      existingTimesheetId: cleanId(existingTimesheet?.id),
      existingTimesheetStatus: String(existingTimesheet?.status || '').trim(),
      legacyImportFileName: String(existingTimesheet?.legacyImportFileName || '').trim()
    };

    rows.push(row);
    if (eligibility.state === 'blocked') {
      blockedCount += 1;
      skipped.push({
        fileName: row.fileName,
        periodId,
        periodName: row.periodName,
        message: row.blockReason
      });
    } else {
      readyCount += 1;
    }
  }

  return {
    rows,
    skipped,
    readyCount,
    blockedCount,
    needsRoleSelection,
    defaultPersonRole: payrollContext.roles.length === 1 ? payrollContext.roles[0] : payrollContext.defaultRole
  };
}

async function rollbackImportExecution({
  batchId,
  activityId,
  activityIds = [],
  timesheetId,
  reqUser
}) {
  const rolledBack = {
    workSessions: null,
    timesheet: null
  };

  const targetActivityIds = [...new Set(
    (Array.isArray(activityIds) ? activityIds : [])
      .map((value) => cleanId(value))
      .filter(Boolean)
      .concat(cleanId(activityId) ? [cleanId(activityId)] : [])
  )];

  if (batchId && targetActivityIds.length) {
    const cleanupResults = [];
    for (const targetActivityId of targetActivityIds) {
      try {
        const cleanup = await timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByBatchId({
          activityId: targetActivityId,
          batchId,
          reqUser
        });
        cleanupResults.push({ activityId: targetActivityId, ...cleanup });
      } catch (error) {
        console.warn(`Import execution rollback work-session cleanup failed for batch ${batchId} on activity ${targetActivityId}: ${error.message}`);
      }
    }
    rolledBack.workSessions = cleanupResults;
  }

  const targetTimesheetId = cleanId(timesheetId);
  if (targetTimesheetId) {
    try {
      const timesheet = await dataService.getDataById('timesheets', targetTimesheetId, reqUser);
      if (timesheet) {
        await timesheetLegacyImportService.rollbackAppliedLegacyImports([{
          periodId: cleanId(timesheet.periodId),
          timesheetId: targetTimesheetId,
          appliedStatus: 'processed',
          timesheet
        }], reqUser);
      } else {
        await timesheetLegacyImportService.purgeImportedTimesheetRecord(targetTimesheetId, reqUser);
      }
      rolledBack.timesheet = { timesheetId: targetTimesheetId };
    } catch (error) {
      console.warn(`Import execution rollback timesheet cleanup failed for ${targetTimesheetId}: ${error.message}`);
    }
  }

  return rolledBack;
}

async function resolveImportActivitiesForExecution({
  orgId,
  reqUser,
  policy,
  compiledRows = []
}) {
  const defaultActivity = await timesheetLegacyImportService.resolveImportActivity({
    orgId,
    reqUser,
    activityId: policy.importActivityId
  });
  const buckets = timesheetImportPolicyService.partitionCompiledRowsByImportActivity(compiledRows, policy);
  const activityCache = new Map([[cleanId(defaultActivity.id), defaultActivity]]);

  for (const activityId of buckets.keys()) {
    if (activityCache.has(activityId)) continue;
    activityCache.set(
      activityId,
      await timesheetLegacyImportService.resolveImportActivity({ orgId, reqUser, activityId })
    );
  }

  return {
    defaultActivity,
    buckets,
    activityCache,
    protectedActivityIds: timesheetImportPolicyService.listDistinctImportActivityIds(policy)
  };
}

async function performImportExecution({
  orgId,
  personId,
  periodId,
  personRole = '',
  compileResult = null,
  batchId = '',
  reqUser
}) {
  const policy = await timesheetLegacyImportService.assertImportAllowed({
    orgId,
    scope: timesheetLegacyImportService.IMPORT_SCOPES.MANAGEMENT
  });

  const targetPersonId = cleanId(personId);
  const targetPeriodId = cleanId(periodId);
  const resolvedBatchId = cleanId(batchId) || timesheetImportWorkSessionBuilderService.buildImportBatchId({
    periodId: targetPeriodId,
    personId: targetPersonId,
    sourceFileName: compileResult?.fileName
  });
  const sourceFileName = String(compileResult?.fileName || 'imported.xlsx').trim();
  const compiledRows = Array.isArray(compileResult?.rows) ? compileResult.rows : [];
  const stackedRows = timesheetImportWorkSessionBuilderService.stackCompiledRowsByDate(
    compiledRows,
    { baseStartTime: policy.importBaseStartTime }
  );
  const {
    defaultActivity,
    buckets,
    activityCache,
    protectedActivityIds
  } = await resolveImportActivitiesForExecution({
    orgId,
    reqUser,
    policy,
    compiledRows: stackedRows
  });
  const usedActivityIds = [...buckets.keys()];

  const period = await dataService.getDataById('timesheetPeriods', targetPeriodId, reqUser);
  if (!period) throw new Error('Timesheet period not found.');
  if (!idsEqual(period.orgId, orgId)) throw new Error('Timesheet period is not in the active organization.');

  const eligibility = await timesheetLegacyImportService.resolveImportExecutionEligibility({
    periodId: targetPeriodId,
    personId: targetPersonId,
    reqUser,
    period
  });
  if (eligibility.state === 'blocked') {
    const blockedTimesheet = await dataService.getTimesheetByPeriodAndTeacher(targetPeriodId, targetPersonId, reqUser);
    const error = new Error(eligibility.message || 'This timesheet period is not eligible for import execution.');
    error.statusCode = 409;
    error.skipDescriptor = timesheetLegacyImportService.buildExistingTimesheetSkipDescriptor(
      blockedTimesheet || {},
      period
    );
    throw error;
  }

  let priorTimesheet = null;
  const existingTimesheetId = cleanId(eligibility.existingTimesheet?.id);
  if (existingTimesheetId) {
    priorTimesheet = await dataService.getDataById('timesheets', existingTimesheetId, reqUser);
  }

  const payrollContext = await timesheetPayrollContextService.resolvePayrollPersonContext({
    orgId,
    personId: targetPersonId,
    reqUser
  });
  const resolvedPersonRole = timesheetPayrollContextService.normalizePayrollRole(personRole)
    || (payrollContext.roles.length === 1 ? payrollContext.roles[0] : '');
  if (payrollContext.roles.length > 1 && !resolvedPersonRole) {
    const error = new Error('Select a payroll role before performing this import.');
    error.statusCode = 400;
    throw error;
  }
  if (resolvedPersonRole && !payrollContext.roles.includes(resolvedPersonRole)) {
    const error = new Error('The selected payroll role is not valid for this person.');
    error.statusCode = 400;
    throw error;
  }

  const personName = await resolveImportPersonName({
    orgId,
    personId: targetPersonId,
    reqUser,
    fallback: payrollContext.personName
  });

  const steps = {
    workSessions: { status: 'pending', summary: '', error: '' },
    timesheet: { status: 'pending', summary: '', error: '' },
    processed: { status: 'pending', summary: '', error: '' }
  };
  let createdTimesheetId = '';

  try {
    steps.workSessions.status = 'running';
    await timesheetLegacyImportService.cleanupStatHolidayForTimesheetTarget({
      orgId,
      personId: targetPersonId,
      period,
      reqUser
    });
    for (const activityId of usedActivityIds) {
      await timesheetImportWorkSessionBuilderService.removeImportWorkSessionsForTarget({
        activityId,
        personId: targetPersonId,
        periodId: targetPeriodId,
        periodStartDate: period.startDate,
        periodEndDate: period.endDate,
        reqUser
      });
      await timesheetImportWorkSessionBuilderService.removeTrackedImportWorkSessionsForPersonPeriod({
        orgId,
        personId: targetPersonId,
        periodStartDate: period.startDate,
        periodEndDate: period.endDate,
        importActivityId: activityId,
        reqUser
      });
    }

    const workSessionOutcomes = [];
    for (const [activityId, rows] of buckets.entries()) {
      const activity = activityCache.get(activityId);
      if (!activity || !rows.length) continue;
      const outcome = await timesheetImportWorkSessionBuilderService.createImportWorkSessions({
        orgId,
        activity,
        compiledRows: rows,
        personId: targetPersonId,
        personName,
        personRole: resolvedPersonRole || payrollContext.defaultRole,
        periodId: targetPeriodId,
        batchId: resolvedBatchId,
        sourceFileName,
        baseStartTime: policy.importBaseStartTime,
        skipStacking: true,
        reqUser
      });
      workSessionOutcomes.push({
        activityId: cleanId(outcome.activityId),
        createdEntryIds: outcome.createdEntryIds,
        rowCount: outcome.rowCount
      });
    }

    const totalWorkSessionCount = workSessionOutcomes.reduce((sum, row) => sum + Number(row.rowCount || 0), 0);
    const createdEntryIds = workSessionOutcomes.flatMap((row) => row.createdEntryIds || []);
    const activityCount = workSessionOutcomes.length;
    steps.workSessions = {
      status: 'success',
      summary: activityCount > 1
        ? `Created ${totalWorkSessionCount} work session(s) across ${activityCount} activities.`
        : `Created ${totalWorkSessionCount} work session(s).`,
      error: '',
      createdEntryIds,
      workSessionActivities: workSessionOutcomes
    };

    steps.timesheet.status = 'running';
    const allowedImportSessionIds = new Set();
    workSessionOutcomes.forEach((outcome) => {
      timesheetImportWorkSessionBuilderService.buildImportActivitySessionIds({
        activityId: outcome.activityId,
        personId: targetPersonId,
        entryIds: outcome.createdEntryIds
      }).forEach((sessionId) => allowedImportSessionIds.add(sessionId));
    });
    const importActivitySessionGuard = {
      activityId: cleanId(defaultActivity.id),
      protectedActivityIds,
      personId: targetPersonId,
      allowedSessionIds: allowedImportSessionIds
    };
    const assembly = await timesheetLiveAssemblyService.buildImportedTimesheetEntries({
      orgId,
      personId: targetPersonId,
      period,
      reqUser,
      personName,
      personRole: resolvedPersonRole || payrollContext.defaultRole,
      allowManagerOverride: false,
      supplementalEntryFilter: buildImportSupplementalEntryFilter(resolvedBatchId),
      importActivitySessionGuard
    });
    if (!assembly.entries.length) {
      throw new Error('No timesheet entries were assembled for the selected period.');
    }

    const nowIso = new Date().toISOString();
    const basePayload = {
      orgId,
      periodId: targetPeriodId,
      teacherId: targetPersonId,
      status: 'draft',
      entries: assembly.entries,
      totalHours: assembly.totalHours,
      legacyImport: {
        activityId: cleanId(defaultActivity.id),
        sourceFileName,
        importedAt: nowIso,
        importedBy: cleanId(reqUser?.id),
        rowCount: totalWorkSessionCount,
        matchedPeriodId: targetPeriodId,
        legacyImportBatchId: resolvedBatchId,
        executionMode: 'activity_first',
        workSessionEntryIds: createdEntryIds,
        workSessionActivities: workSessionOutcomes.map((outcome) => ({
          activityId: outcome.activityId,
          entryIds: outcome.createdEntryIds,
          rowCount: outcome.rowCount
        }))
      }
    };
    if (priorTimesheet?.id) {
      basePayload.id = cleanId(priorTimesheet.id);
    }

    const { payload: lifecyclePayload, requiresPostSaveFinalization } =
      timesheetImportLifecycleService.prepareImportTargetPayload({
        basePayload,
        period,
        targetStatus: 'processed',
        reqUser,
        priorTimesheet
      });

    let saved = await timesheetLegacyImportService.persistTimesheetPayload(lifecyclePayload, reqUser);
    createdTimesheetId = cleanId(saved?.id);
    steps.timesheet = {
      status: 'success',
      summary: `Saved timesheet with ${assembly.entries.length} row(s), ${assembly.totalHours} hour(s).`,
      error: '',
      timesheetId: createdTimesheetId,
      statHolidayWarnings: assembly.statHolidayWarnings
    };

    steps.processed.status = 'running';
    if (requiresPostSaveFinalization) {
      saved = await timesheetImportLifecycleService.finalizeImportTargetAfterSave({
        savedTimesheet: saved,
        period,
        targetStatus: 'processed',
        reqUser,
        dataService
      });
    }
    steps.processed = {
      status: 'success',
      summary: 'Timesheet marked processed and sources locked.',
      error: '',
      timesheetId: cleanId(saved?.id),
      appliedStatus: 'processed'
    };

    return {
      batchId: resolvedBatchId,
      periodId: targetPeriodId,
      personId: targetPersonId,
      timesheetId: cleanId(saved?.id),
      steps,
      statHolidayWarnings: assembly.statHolidayWarnings
    };
  } catch (error) {
    if (steps.workSessions.status === 'running') {
      steps.workSessions = { status: 'error', summary: '', error: error.message };
    } else if (steps.timesheet.status === 'running') {
      steps.timesheet = { status: 'error', summary: '', error: error.message };
    } else if (steps.processed.status === 'running') {
      steps.processed = { status: 'error', summary: '', error: error.message };
    }

    const rolledBack = await rollbackImportExecution({
      batchId: resolvedBatchId,
      activityId: cleanId(defaultActivity.id),
      activityIds: usedActivityIds,
      timesheetId: createdTimesheetId,
      reqUser
    });

    const rollbackError = new Error(`${error.message} Import failed and earlier changes were rolled back.`);
    rollbackError.statusCode = Number(error?.statusCode) || 400;
    rollbackError.steps = steps;
    rollbackError.rolledBack = rolledBack;
    throw rollbackError;
  }
}

module.exports = {
  buildImportExecutionPlan,
  performImportExecution,
  rollbackImportExecution,
  resolveImportActivitiesForExecution,
  isPerformableCompileResult
};
