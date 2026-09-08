'use strict';

const dataService = require('./schoolDataService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const timesheetLegacyImportService = require('./timesheetLegacyImportService');
const timesheetImportLifecycleService = require('./timesheetImportLifecycleService');
const timesheetImportWorkSessionBuilderService = require('./timesheetImportWorkSessionBuilderService');
const timesheetLiveAssemblyService = require('./timesheetLiveAssemblyService');
const timesheetPayrollContextService = require('./timesheetPayrollContextService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function cleanId(value) {
  return String(value ?? '').trim();
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

  for (const result of (Array.isArray(compileResults) ? compileResults : [])) {
    if (!isPerformableCompileResult(result)) continue;
    const periodId = cleanId(result?.matchedPeriod?.id);
    if (filterId && !idsEqual(periodId, filterId)) continue;

    const period = await dataService.getDataById('timesheetPeriods', periodId, reqUser);
    const skipDescriptor = await timesheetLegacyImportService.detectExistingTimesheetForImport({
      periodId,
      personId: targetPersonId,
      reqUser,
      period
    });
    if (skipDescriptor) {
      skipped.push({
        fileName: String(result?.fileName || '').trim(),
        periodId,
        message: skipDescriptor.message
      });
      continue;
    }

    rows.push({
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
      })
    });
  }

  return {
    rows,
    skipped,
    needsRoleSelection,
    defaultPersonRole: payrollContext.roles.length === 1 ? payrollContext.roles[0] : payrollContext.defaultRole
  };
}

async function rollbackImportExecution({
  batchId,
  activityId,
  timesheetId,
  reqUser
}) {
  const rolledBack = {
    workSessions: null,
    timesheet: null
  };

  if (batchId && activityId) {
    try {
      rolledBack.workSessions = await timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByBatchId({
        activityId,
        batchId,
        reqUser
      });
    } catch (error) {
      console.warn(`Import execution rollback work-session cleanup failed for batch ${batchId}: ${error.message}`);
    }
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
        await dataService.deleteData('timesheets', targetTimesheetId, reqUser, { skipDeletionGuard: true });
      }
      rolledBack.timesheet = { timesheetId: targetTimesheetId };
    } catch (error) {
      console.warn(`Import execution rollback timesheet cleanup failed for ${targetTimesheetId}: ${error.message}`);
    }
  }

  return rolledBack;
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
  const activity = await timesheetLegacyImportService.resolveImportActivity({
    orgId,
    reqUser,
    activityId: policy.importActivityId
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

  const period = await dataService.getDataById('timesheetPeriods', targetPeriodId, reqUser);
  if (!period) throw new Error('Timesheet period not found.');
  if (!idsEqual(period.orgId, orgId)) throw new Error('Timesheet period is not in the active organization.');

  const existingSkip = await timesheetLegacyImportService.detectExistingTimesheetForImport({
    periodId: targetPeriodId,
    personId: targetPersonId,
    reqUser,
    period
  });
  if (existingSkip) {
    const error = new Error(existingSkip.message);
    error.statusCode = 409;
    error.skipDescriptor = existingSkip;
    throw error;
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
    const workSessionOutcome = await timesheetImportWorkSessionBuilderService.createImportWorkSessions({
      orgId,
      activity,
      compiledRows,
      personId: targetPersonId,
      personName,
      personRole: resolvedPersonRole || payrollContext.defaultRole,
      periodId: targetPeriodId,
      batchId: resolvedBatchId,
      sourceFileName,
      reqUser
    });
    steps.workSessions = {
      status: 'success',
      summary: `Created ${workSessionOutcome.rowCount} work session(s).`,
      error: '',
      createdEntryIds: workSessionOutcome.createdEntryIds
    };

    steps.timesheet.status = 'running';
    const assembly = await timesheetLiveAssemblyService.buildImportedTimesheetEntries({
      orgId,
      personId: targetPersonId,
      period,
      reqUser,
      personRole: resolvedPersonRole || payrollContext.defaultRole,
      allowManagerOverride: true
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
        activityId: cleanId(activity.id),
        sourceFileName,
        importedAt: nowIso,
        importedBy: cleanId(reqUser?.id),
        rowCount: workSessionOutcome.rowCount,
        matchedPeriodId: targetPeriodId,
        legacyImportBatchId: resolvedBatchId,
        executionMode: 'activity_first',
        workSessionEntryIds: workSessionOutcome.createdEntryIds
      }
    };

    const { payload: lifecyclePayload, requiresPostSaveFinalization } =
      timesheetImportLifecycleService.prepareImportTargetPayload({
        basePayload,
        period,
        targetStatus: 'processed',
        reqUser,
        priorTimesheet: null
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
      activityId: cleanId(activity.id),
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
  isPerformableCompileResult
};
