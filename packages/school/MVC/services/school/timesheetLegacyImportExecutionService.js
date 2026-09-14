'use strict';

const dataService = require('./schoolDataService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const timesheetLegacyImportService = require('./timesheetLegacyImportService');
const timesheetImportLifecycleService = require('./timesheetImportLifecycleService');
const timesheetImportWorkSessionBuilderService = require('./timesheetImportWorkSessionBuilderService');
const timesheetImportPolicyService = require('./timesheetImportPolicyService');
const timesheetLiveAssemblyService = require('./timesheetLiveAssemblyService');
const timesheetPayrollContextService = require('./timesheetPayrollContextService');
const timesheetParametersPolicyModel = require('../../models/school/timesheetParametersPolicyModel');
const timesheetParametersPolicyService = require('./timesheetParametersPolicyService');
const statutoryHolidayEligibilityService = require('./statutoryHolidayEligibilityService');
const statutoryHolidaySchemeService = require('./statutoryHolidaySchemeService');
const statutoryHolidayTimesheetLifecycleService = require('./statutoryHolidayTimesheetLifecycleService');
const statutoryHolidayWorkSessionService = require('./statutoryHolidayWorkSessionService');
const activityService = require('./activityService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function cleanId(value) {
  return String(value ?? '').trim();
}

function mergeStatHolidayActivitySessionsIntoEntries(entries = [], activitySessions = []) {
  const merged = [...(Array.isArray(entries) ? entries : [])];
  const seenSessionIds = new Set(
    merged.map((row) => cleanId(row?.sessionId)).filter(Boolean)
  );
  (Array.isArray(activitySessions) ? activitySessions : []).forEach((row) => {
    if (!row || !cleanId(row?.statHolidayId)) return;
    const sessionId = cleanId(row?.sessionId);
    if (!sessionId || seenSessionIds.has(sessionId)) return;
    seenSessionIds.add(sessionId);
    merged.push(row);
  });
  return merged;
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

function buildProxyWorkdayEntriesFromCompiledRows(compiledRows = []) {
  return (Array.isArray(compiledRows) ? compiledRows : [])
    .map((row, index) => {
      const date = cleanId(row?.date);
      const hours = timesheetImportWorkSessionBuilderService.resolveImportBillableHours(row);
      if (!date || !Number.isFinite(hours) || hours <= 0) return null;
      return {
        sessionId: `import-preview-${date}-${index + 1}`,
        date,
        hours,
        timesheetHours: hours,
        durationHours: hours,
        isManual: false,
        isSchoolActivity: true
      };
    })
    .filter(Boolean);
}

function emptyStatHolidayPreview() {
  return {
    hasStatHolidays: false,
    count: 0,
    evaluationCount: 0,
    payableHolidayCount: 0,
    holidayNames: [],
    warnings: [],
    configurationWarnings: [],
    missingDayEntries: [],
    blockingErrors: [],
    schemeOutcomes: [],
    hasBlockingIssues: false,
    activityId: '',
    activityTitle: ''
  };
}

async function buildStatHolidayConfigurationMismatchWarnings({
  policy,
  missingDayEntries = [],
  schemeOutcomes = [],
  reqUser
} = {}) {
  if ((!Array.isArray(missingDayEntries) || !missingDayEntries.length)
    && (!Array.isArray(schemeOutcomes) || !schemeOutcomes.length)) {
    return [];
  }
  const resolved = timesheetParametersPolicyService.resolvePolicy(policy);
  const mappingActivityId = cleanId(resolved?.statutoryHolidayPay?.mappingActivityId);
  if (!mappingActivityId) return [];

  const schemesInUse = statutoryHolidaySchemeService.resolveSchemesWithAssignedDepartments(resolved);
  const warnings = [];
  for (const { schemeId, config } of schemesInUse) {
    const payActivityId = statutoryHolidayEligibilityService.resolveStatHolidayActivityId(resolved, schemeId);
    if (!payActivityId || idsEqual(payActivityId, mappingActivityId)) continue;
    const schemeOutcome = (Array.isArray(schemeOutcomes) ? schemeOutcomes : [])
      .find((row) => cleanId(row?.schemeId) === cleanId(schemeId));
    const schemeMissing = Array.isArray(schemeOutcome?.missingDayEntries) ? schemeOutcome.missingDayEntries : [];
    const aggregatedMissing = (Array.isArray(missingDayEntries) ? missingDayEntries : [])
      .filter((row) => cleanId(row?.schemeId) === cleanId(schemeId));
    if (!schemeMissing.length && !aggregatedMissing.length) continue;
    const [payActivity, mappingActivity] = await Promise.all([
      activityService.getActivity(payActivityId, reqUser).catch(() => null),
      activityService.getActivity(mappingActivityId, reqUser).catch(() => null)
    ]);
    const schemeName = String(config?.name || schemeId).trim();
    const payLabel = String(payActivity?.title || payActivityId).trim();
    const mappingLabel = String(mappingActivity?.title || mappingActivityId).trim();
    warnings.push(
      `Holiday day mapping is configured on "${mappingLabel}" but ${schemeName} statutory holiday pay uses "${payLabel}". Map holiday day work sessions on the scheme activity or align both settings.`
    );
  }
  return warnings;
}

async function previewImportExecutionStatHolidayForRow({
  orgId,
  personId,
  period,
  compiledRows = [],
  reqUser,
  personRole = '',
  personName = ''
} = {}) {
  if (!cleanId(period?.id) || !cleanId(personId)) return emptyStatHolidayPreview();

  const [timesheetParametersPolicy, allHolidays] = await Promise.all([
    timesheetParametersPolicyModel.getPolicyForOrg(orgId),
    dataService.fetchAllData('holidays', {}, reqUser)
  ]);
  if (!statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled(timesheetParametersPolicy)) {
    return emptyStatHolidayPreview();
  }

  const resolvedPolicy = timesheetParametersPolicyService.resolvePolicy(timesheetParametersPolicy);
  const schemesInUse = statutoryHolidaySchemeService.resolveSchemesWithAssignedDepartments(resolvedPolicy);
  const unconfiguredSchemes = schemesInUse.filter(({ config }) => !cleanId(config?.activityId));
  if (unconfiguredSchemes.length) {
    const blockingErrors = unconfiguredSchemes.map(({ schemeId, config }) => {
      const schemeName = String(config?.name || schemeId).trim();
      return `Statutory holiday scheme "${schemeName}" has no public activity configured. Assign an activity in School Settings before importing.`;
    });
    return {
      ...emptyStatHolidayPreview(),
      hasBlockingIssues: true,
      blockingErrors
    };
  }
  const configuredActivityId = statutoryHolidayEligibilityService.resolveStatHolidayActivityId(resolvedPolicy);

  const proxyEntries = buildProxyWorkdayEntriesFromCompiledRows(compiledRows);
  const periodWorkdayEntries = statutoryHolidayEligibilityService.assemblePeriodWorkdayEntries(
    [],
    proxyEntries
  );
  try {
    const materialization = await statutoryHolidayTimesheetLifecycleService.previewStatHolidayForTimesheet({
      orgId,
      personId,
      personName,
      personRole,
      period,
      policy: timesheetParametersPolicy,
      holidays: allHolidays,
      periodEntries: periodWorkdayEntries,
      existingEntries: [],
      reqUser
    });
    const statRows = Array.isArray(materialization?.rows) ? materialization.rows : [];
    const evaluations = Array.isArray(materialization?.evaluations) ? materialization.evaluations : [];
    const holidayNames = [...new Set([
      ...statRows.map((row) => String(row?.className || row?.statHolidayMeta?.holidayName || '').trim()),
      ...evaluations.map((row) => String(row?.title || row?.holidayName || '').trim())
    ].filter(Boolean))];
    const missingDayEntries = Array.isArray(materialization?.syncOutcome?.missingDayEntries)
      ? materialization.syncOutcome.missingDayEntries
      : [];
    const schemeOutcomes = Array.isArray(materialization?.syncOutcome?.schemeOutcomes)
      ? materialization.syncOutcome.schemeOutcomes
      : [];
    const activityId = cleanId(materialization?.syncOutcome?.activityId) || configuredActivityId;
    let activityTitle = '';
    if (activityId) {
      const activity = await activityService.getActivity(activityId, reqUser).catch(() => null);
      activityTitle = String(activity?.title || '').trim();
    }
    const blockingErrors = Array.isArray(materialization?.blockingErrors)
      ? materialization.blockingErrors.filter(Boolean)
      : [];
    const configurationWarnings = await buildStatHolidayConfigurationMismatchWarnings({
      policy: timesheetParametersPolicy,
      missingDayEntries,
      schemeOutcomes,
      reqUser
    });
    const eligibilityWarnings = Array.isArray(materialization?.warnings) ? materialization.warnings : [];
    const warnings = [...eligibilityWarnings, ...configurationWarnings];
    const hasBlockingIssues = blockingErrors.length > 0 || materialization?.syncOutcome?.blocked === true;
    return {
      hasStatHolidays: statRows.length > 0 || missingDayEntries.length > 0 || evaluations.length > 0,
      count: statRows.length,
      evaluationCount: evaluations.length,
      payableHolidayCount: holidayNames.length,
      holidayNames,
      warnings,
      configurationWarnings,
      missingDayEntries,
      blockingErrors,
      schemeOutcomes,
      hasBlockingIssues,
      activityId,
      activityTitle
    };
  } catch (error) {
    return {
      ...emptyStatHolidayPreview(),
      activityId: configuredActivityId,
      hasBlockingIssues: true,
      blockingErrors: [
        String(error?.message || 'Unable to preview statutory holidays for import.')
      ]
    };
  }
}

function resolveImportExecutionTargetStatus(targetStatus, policy) {
  const policyDefault = timesheetImportPolicyService.resolveImportTargetStatusForScope(
    policy,
    timesheetLegacyImportService.IMPORT_SCOPES.MANAGEMENT
  );
  return timesheetImportPolicyService.normalizeImportTargetStatus(targetStatus, policyDefault);
}

function describeImportFinalizeSummary(appliedStatus = '') {
  const token = String(appliedStatus || '').trim().toLowerCase();
  if (token === 'processed') return 'Timesheet marked processed and sources locked.';
  if (token === 'manager_approved') return 'Timesheet manager-approved and sources locked.';
  if (token === 'submitted') return 'Timesheet submitted and sources locked.';
  return '';
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
  const policy = await timesheetLegacyImportService.assertImportAllowed({
    orgId,
    scope: timesheetLegacyImportService.IMPORT_SCOPES.MANAGEMENT
  });
  const defaultImportTargetStatus = timesheetImportPolicyService.resolveImportTargetStatusForScope(
    policy,
    timesheetLegacyImportService.IMPORT_SCOPES.MANAGEMENT
  );

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
      row.targetStatus = defaultImportTargetStatus;
      row.statHolidayPreview = await previewImportExecutionStatHolidayForRow({
        orgId,
        personId: targetPersonId,
        period,
        compiledRows: Array.isArray(result?.rows) ? result.rows : [],
        reqUser,
        personRole: payrollContext.roles.length === 1 ? payrollContext.roles[0] : payrollContext.defaultRole,
        personName: payrollContext.personName
      });
    }
  }

  return {
    rows,
    skipped,
    readyCount,
    blockedCount,
    needsRoleSelection,
    defaultImportTargetStatus,
    importTargetStatusOptions: [...timesheetImportPolicyService.IMPORT_TARGET_STATUSES],
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
  targetStatus = '',
  compileResult = null,
  batchId = '',
  reqUser
}) {
  const policy = await timesheetLegacyImportService.assertImportAllowed({
    orgId,
    scope: timesheetLegacyImportService.IMPORT_SCOPES.MANAGEMENT
  });
  const resolvedTargetStatus = resolveImportExecutionTargetStatus(targetStatus, policy);
  const shouldApplyStatHoliday = resolvedTargetStatus !== 'draft';

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
        workSessionStartTime: policy.importWorkSessionStartTime,
        workSessionEndTime: policy.importWorkSessionEndTime,
        consolidateIntoOneWorkSession: policy.saveImportedSessionsIntoOneWorkSession !== false,
        skipStacking: true,
        reqUser
      });
      workSessionOutcomes.push({
        activityId: cleanId(outcome.activityId),
        createdEntryIds: outcome.createdEntryIds,
        createdSessionIds: outcome.createdSessionIds,
        rowCount: outcome.rowCount
      });
    }

    const totalAssigneeRowCount = workSessionOutcomes.reduce((sum, row) => sum + Number(row.rowCount || 0), 0);
    const totalDailyEntryCount = workSessionOutcomes.reduce(
      (sum, row) => sum + (Array.isArray(row.createdEntryIds) ? row.createdEntryIds.length : 0),
      0
    );
    const createdEntryIds = workSessionOutcomes.flatMap((row) => row.createdEntryIds || []);
    const activityCount = workSessionOutcomes.length;
    steps.workSessions = {
      status: 'success',
      summary: activityCount > 1
        ? `Imported ${totalAssigneeRowCount} class row(s) into ${totalDailyEntryCount} daily work session(s) across ${activityCount} activities.`
        : `Imported ${totalAssigneeRowCount} class row(s) into ${totalDailyEntryCount} daily work session(s).`,
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
        entryIds: outcome.createdEntryIds,
        sessionIds: outcome.createdSessionIds
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

    let importEntries = assembly.entries;
    let importTotalHours = assembly.totalHours;
    let statHolidayWarnings = [];
    let effectiveTargetStatus = resolvedTargetStatus;
    let statHolidayBlocked = false;
    const [timesheetParametersPolicy, allHolidays] = await Promise.all([
      timesheetParametersPolicyModel.getPolicyForOrg(orgId),
      dataService.fetchAllData('holidays', {}, reqUser)
    ]);
    if (shouldApplyStatHoliday
      && statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled(timesheetParametersPolicy)) {
      const periodWorkdayEntries = statutoryHolidayEligibilityService.assemblePeriodWorkdayEntries(
        [],
        importEntries
      );
      const statHolidayMaterialization = await statutoryHolidayTimesheetLifecycleService.applyStatHolidayOnTimesheetSubmit({
        orgId,
        personId: targetPersonId,
        personName,
        personRole: resolvedPersonRole || payrollContext.defaultRole,
        period,
        policy: timesheetParametersPolicy,
        holidays: allHolidays,
        periodEntries: periodWorkdayEntries,
        existingEntries: importEntries,
        reqUser
      });
      statHolidayWarnings = Array.isArray(statHolidayMaterialization?.warnings)
        ? statHolidayMaterialization.warnings
        : [];
      const blockingErrors = Array.isArray(statHolidayMaterialization?.blockingErrors)
        ? statHolidayMaterialization.blockingErrors.filter(Boolean)
        : [];
      statHolidayBlocked = blockingErrors.length > 0
        || statHolidayMaterialization?.syncOutcome?.blocked === true;
      if (statHolidayBlocked) {
        effectiveTargetStatus = 'draft';
        statHolidayWarnings = [
          ...statHolidayWarnings,
          ...blockingErrors.map((message) => ({
            blocking: true,
            reasons: [message]
          }))
        ];
      }
      importEntries = statutoryHolidayTimesheetLifecycleService.mergeStatHolidayRowsIntoEntries({
        entries: importEntries,
        statHolidayRows: statHolidayMaterialization?.rows || [],
        usesActivityMode: statHolidayMaterialization?.usesActivityMode === true,
        existingEntriesBySessionId: new Map()
      });
      if (statHolidayMaterialization?.usesActivityMode === true && !statHolidayBlocked) {
        const resolvedPolicy = timesheetParametersPolicyService.resolvePolicy(timesheetParametersPolicy);
        const schemeActivityIds = new Set(
          statutoryHolidaySchemeService.resolveAllSchemeActivityIds(resolvedPolicy)
            .map((activityId) => cleanId(activityId))
            .filter(Boolean)
        );
        const refreshedActivitySessions = await activityService.getTimesheetEntriesForPerson({
          orgId,
          personId: targetPersonId,
          periodStartDate: period.startDate,
          periodEndDate: period.endDate,
          reqUser
        });
        const scopedStatHolidaySessions = (Array.isArray(refreshedActivitySessions) ? refreshedActivitySessions : [])
          .filter((row) => schemeActivityIds.has(cleanId(row?.activityId)));
        importEntries = mergeStatHolidayActivitySessionsIntoEntries(importEntries, scopedStatHolidaySessions);
      }
      importTotalHours = timesheetLiveAssemblyService.calculateTimesheetTotal(importEntries);
    }

    const nowIso = new Date().toISOString();
    const basePayload = {
      orgId,
      periodId: targetPeriodId,
      teacherId: targetPersonId,
      status: 'draft',
      entries: importEntries,
      totalHours: importTotalHours,
      legacyImport: {
        activityId: cleanId(defaultActivity.id),
        sourceFileName,
        importedAt: nowIso,
        importedBy: cleanId(reqUser?.id),
        rowCount: totalAssigneeRowCount,
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

    const { payload: lifecyclePayload, requiresPostSaveFinalization, appliedStatus } =
      timesheetImportLifecycleService.prepareImportTargetPayload({
        basePayload,
        period,
        targetStatus: effectiveTargetStatus,
        reqUser,
        priorTimesheet
      });

    let saved = await timesheetLegacyImportService.persistTimesheetPayload(lifecyclePayload, reqUser);
    createdTimesheetId = cleanId(saved?.id);
    const savedStatusLabel = String(appliedStatus || effectiveTargetStatus || 'draft');
    const draftFallbackNote = statHolidayBlocked && resolvedTargetStatus !== 'draft'
      ? ` Saved as draft because statutory holiday work sessions are missing in Settings (requested ${resolvedTargetStatus}).`
      : '';
    steps.timesheet = {
      status: 'success',
      summary: `Saved timesheet as ${savedStatusLabel} with ${importEntries.length} row(s), ${importTotalHours} hour(s).${draftFallbackNote}`,
      error: '',
      timesheetId: createdTimesheetId,
      statHolidayWarnings,
      statHolidayBlocked,
      appliedStatus: savedStatusLabel
    };

    if (requiresPostSaveFinalization) {
      steps.processed.status = 'running';
      saved = await timesheetImportLifecycleService.finalizeImportTargetAfterSave({
        savedTimesheet: saved,
        period,
        targetStatus: appliedStatus || resolvedTargetStatus,
        reqUser,
        dataService
      });
      steps.processed = {
        status: 'success',
        summary: describeImportFinalizeSummary(appliedStatus || resolvedTargetStatus),
        error: '',
        timesheetId: cleanId(saved?.id),
        appliedStatus: savedStatusLabel
      };
    }

    return {
      batchId: resolvedBatchId,
      periodId: targetPeriodId,
      personId: targetPersonId,
      timesheetId: cleanId(saved?.id),
      steps,
      statHolidayWarnings,
      statHolidayBlocked,
      appliedStatus: savedStatusLabel
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
  isPerformableCompileResult,
  previewImportExecutionStatHolidayForRow,
  buildProxyWorkdayEntriesFromCompiledRows,
  resolveImportExecutionTargetStatus
};
