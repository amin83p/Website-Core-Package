'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const executionService = require('../MVC/services/school/timesheetLegacyImportExecutionService');
const timesheetLegacyImportService = require('../MVC/services/school/timesheetLegacyImportService');
const timesheetImportWorkSessionBuilderService = require('../MVC/services/school/timesheetImportWorkSessionBuilderService');
const timesheetLiveAssemblyService = require('../MVC/services/school/timesheetLiveAssemblyService');
const timesheetImportPolicyModel = require('../MVC/models/school/timesheetImportPolicyModel');
const activityService = require('../MVC/services/school/activityService');
const dataService = require('../MVC/services/school/schoolDataService');
const timesheetPayrollContextService = require('../MVC/services/school/timesheetPayrollContextService');
const timesheetImportLifecycleService = require('../MVC/services/school/timesheetImportLifecycleService');
const timesheetParametersPolicyModel = require('../MVC/models/school/timesheetParametersPolicyModel');
const statutoryHolidayTimesheetLifecycleService = require('../MVC/services/school/statutoryHolidayTimesheetLifecycleService');
const statutoryHolidayWorkSessionService = require('../MVC/services/school/statutoryHolidayWorkSessionService');
const leaveRequestService = require('../MVC/services/school/leaveRequestService');
const timesheetWorkdayHistoryService = require('../MVC/services/school/timesheetWorkdayHistoryService');
const schoolRepositories = require('../MVC/repositories/school');

const realMergeStatHolidayRowsIntoEntries = statutoryHolidayTimesheetLifecycleService.mergeStatHolidayRowsIntoEntries;
const realPreviewStatHolidayForTimesheet = statutoryHolidayTimesheetLifecycleService.previewStatHolidayForTimesheet;

const REQ_USER = { id: 'USER_1', activeOrgId: 'ORG_1' };
const POLICY = {
  importActivityId: 'ACT_IMPORT',
  allowImportInTimesheetManagement: true,
  allowImportInMyTimesheets: true,
  importTargetStatus: 'draft'
};
const ACTIVITY = {
  id: 'ACT_IMPORT',
  orgId: 'ORG_1',
  status: 'posted',
  paid: true,
  title: 'Import Activity',
  departmentId: 'DEPT_1',
  evaluationType: 'attendance',
  entries: []
};

function compileOkResult(periodId, fileName = 'march.xlsx') {
  return {
    status: 'ok',
    fileName,
    matchedPeriod: { id: periodId, name: periodId, startDate: '2026-03-01', endDate: '2026-03-15' },
    rows: [{ date: '2026-03-01', className: 'Math', hours: 2 }]
  };
}

function compileJanuaryResult(periodId = 'PER_JAN', rows = [{ date: '2026-01-02', className: 'Math', hours: 2 }]) {
  return {
    status: 'ok',
    fileName: 'january.xlsx',
    matchedPeriod: { id: periodId, name: periodId, startDate: '2026-01-01', endDate: '2026-01-15' },
    rows
  };
}

function stubStatHolidayImportPreviewDeps({
  payActivityId = 'ACT_PAY',
  payActivityTitle = 'Pay Activity',
  payActivityEntries = [],
  mappingActivityId = '',
  holidays = [{
    id: 'H_NY',
    date: '2026-01-01',
    title: "New Year's Day",
    type: 'National Holiday'
  }],
  periodStartDate = '2026-01-01',
  periodEndDate = '2026-01-15'
} = {}) {
  const originals = {
    getPolicy: timesheetParametersPolicyModel.getPolicyForOrg,
    isEnabled: statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled,
    preview: statutoryHolidayTimesheetLifecycleService.previewStatHolidayForTimesheet,
    fetchAll: dataService.fetchAllData,
    getById: dataService.getDataById,
    resolveActivity: timesheetLegacyImportService.resolvePublicStatHolidayActivity,
    getActivity: activityService.getActivity,
    leave: leaveRequestService.getApprovedLeaveEventsForPerson,
    history: timesheetWorkdayHistoryService.buildWorkdayHistory
  };

  timesheetParametersPolicyModel.getPolicyForOrg = async () => ({
    statutoryHolidayPay: {
      enabled: true,
      activityId: payActivityId,
      mappingActivityId,
      minWorkdays: 30,
      weekdayOccurrencesRequired: 5,
      weekdayOccurrencesLookback: 9,
      earningsLookbackWeeks: 4,
      beforeAfterSearchDays: 14,
      payableHolidayTypes: ['National Holiday']
    }
  });
  statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled = () => true;
  statutoryHolidayTimesheetLifecycleService.previewStatHolidayForTimesheet = realPreviewStatHolidayForTimesheet;
  dataService.fetchAllData = async (entityType) => (entityType === 'holidays' ? holidays : []);
  dataService.getDataById = async (entityType, id) => {
    if (entityType === 'timesheetPeriods') {
      return {
        id,
        orgId: 'ORG_1',
        name: id,
        startDate: periodStartDate,
        endDate: periodEndDate,
        status: 'open'
      };
    }
    return null;
  };
  timesheetLegacyImportService.resolvePublicStatHolidayActivity = async ({ activityId }) => ({
    id: activityId,
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    visibilityScope: 'school',
    title: activityId === payActivityId ? payActivityTitle : `Activity ${activityId}`,
    entries: activityId === payActivityId ? payActivityEntries : []
  });
  activityService.getActivity = async (activityId) => ({
    id: activityId,
    title: activityId === payActivityId
      ? payActivityTitle
      : (activityId === mappingActivityId ? 'Mapping Activity' : `Activity ${activityId}`)
  });
  leaveRequestService.getApprovedLeaveEventsForPerson = async () => [];
  timesheetWorkdayHistoryService.buildWorkdayHistory = async () => (
    new timesheetWorkdayHistoryService.WorkdayHistory()
  );

  return {
    restore: () => {
      timesheetParametersPolicyModel.getPolicyForOrg = originals.getPolicy;
      statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled = originals.isEnabled;
      statutoryHolidayTimesheetLifecycleService.previewStatHolidayForTimesheet = originals.preview;
      dataService.fetchAllData = originals.fetchAll;
      dataService.getDataById = originals.getById;
      timesheetLegacyImportService.resolvePublicStatHolidayActivity = originals.resolveActivity;
      activityService.getActivity = originals.getActivity;
      leaveRequestService.getApprovedLeaveEventsForPerson = originals.leave;
      timesheetWorkdayHistoryService.buildWorkdayHistory = originals.history;
    }
  };
}

function stubExecutionDeps({
  existingByPeriod = {},
  payrollRoles = ['teacher']
} = {}) {
  const originals = {
    getPolicy: timesheetImportPolicyModel.getPolicyForOrg,
    resolveActivity: timesheetLegacyImportService.resolveImportActivity,
    getById: dataService.getDataById,
    getTimesheet: dataService.getTimesheetByPeriodAndTeacher,
    payroll: timesheetPayrollContextService.resolvePayrollPersonContext,
    createSessions: timesheetImportWorkSessionBuilderService.createImportWorkSessions,
    preCleanSessions: timesheetImportWorkSessionBuilderService.removeImportWorkSessionsForTarget,
    trackedCleanSessions: timesheetImportWorkSessionBuilderService.removeTrackedImportWorkSessionsForPersonPeriod,
    removeSessions: timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByBatchId,
    assemble: timesheetLiveAssemblyService.buildImportedTimesheetEntries,
    persist: timesheetLegacyImportService.persistTimesheetPayload,
    prepare: timesheetImportLifecycleService.prepareImportTargetPayload,
    finalize: timesheetImportLifecycleService.finalizeImportTargetAfterSave,
    purgeRepo: schoolRepositories.timesheets.maintenancePurgeById,
    fetchAllData: dataService.fetchAllData,
    getTimesheetParametersPolicy: timesheetParametersPolicyModel.getPolicyForOrg,
    isStatHolidayPayEnabled: statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled,
    applyStatHolidayOnTimesheetSubmit: statutoryHolidayTimesheetLifecycleService.applyStatHolidayOnTimesheetSubmit,
    mergeStatHolidayRowsIntoEntries: statutoryHolidayTimesheetLifecycleService.mergeStatHolidayRowsIntoEntries,
    previewStatHoliday: statutoryHolidayTimesheetLifecycleService.previewStatHolidayForTimesheet
  };

  const createdTimesheets = [];
  let addCounter = 0;
  let savedActivityEntries = [];

  timesheetImportPolicyModel.getPolicyForOrg = async () => POLICY;
  timesheetLegacyImportService.resolveImportActivity = async () => ({ ...ACTIVITY, entries: [...savedActivityEntries] });
  dataService.getDataById = async (entityType, id) => {
    if (entityType === 'timesheetPeriods') {
      return {
        id,
        orgId: 'ORG_1',
        name: id,
        startDate: '2026-03-01',
        endDate: '2026-03-15',
        status: 'open'
      };
    }
    if (entityType === 'timesheets') {
      const created = createdTimesheets.find((row) => row.id === id);
      if (created) return created;
      return Object.values(existingByPeriod).find((row) => row.id === id) || null;
    }
    return null;
  };
  dataService.getTimesheetByPeriodAndTeacher = async (periodId) => existingByPeriod[periodId] || null;
  timesheetPayrollContextService.resolvePayrollPersonContext = async () => ({
    personId: 'PERSON_1',
    personName: 'Teacher One',
    orgId: 'ORG_1',
    roles: payrollRoles,
    defaultRole: payrollRoles[0] || 'teacher',
    roleRecords: {},
    warnings: []
  });
  timesheetImportWorkSessionBuilderService.removeImportWorkSessionsForTarget = async () => ({
    removedEntries: 0,
    removedAssignees: 0
  });
  timesheetImportWorkSessionBuilderService.removeTrackedImportWorkSessionsForPersonPeriod = async () => ({
    removedEntries: 0,
    scannedActivities: 0,
    cleanedActivities: []
  });
  timesheetImportWorkSessionBuilderService.createImportWorkSessions = async ({ batchId, compiledRows }) => {
    savedActivityEntries = compiledRows.map((row, index) => ({
      entryId: `ENT-ACT_IMPORT-000${index + 1}`,
      date: row.date,
      legacyImportBatchId: batchId
    }));
    return {
      activityId: 'ACT_IMPORT',
      batchId,
      createdEntryIds: savedActivityEntries.map((row) => row.entryId),
      rowCount: savedActivityEntries.length
    };
  };
  timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByBatchId = async () => ({
    removedEntries: savedActivityEntries.length,
    removedAssignees: 0
  });
  timesheetParametersPolicyModel.getPolicyForOrg = async () => ({
    statutoryHolidayPay: { enabled: false }
  });
  dataService.fetchAllData = async (entityType) => (entityType === 'holidays' ? [] : []);
  statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled = () => false;
  statutoryHolidayTimesheetLifecycleService.applyStatHolidayOnTimesheetSubmit = async () => ({
    rows: [],
    warnings: [],
    usesActivityMode: true,
    syncOutcome: null
  });
  statutoryHolidayTimesheetLifecycleService.mergeStatHolidayRowsIntoEntries = ({ entries = [] }) => entries;
  statutoryHolidayTimesheetLifecycleService.previewStatHolidayForTimesheet = async () => ({
    rows: [],
    warnings: [],
    usesActivityMode: true,
    syncOutcome: null
  });
  timesheetLiveAssemblyService.buildImportedTimesheetEntries = async () => ({
    entries: [{
      sessionId: 'act-ACT_IMPORT-ENT-ACT_IMPORT-0001-PERSON_1',
      date: '2026-03-01',
      hours: 2,
      timesheetHours: 2,
      isManual: false,
      isSchoolActivity: true
    }],
    totalHours: 2,
    statHolidayWarnings: [],
    payrollContext: { defaultRole: 'teacher', roles: payrollRoles },
    personRole: 'teacher'
  });
  timesheetLegacyImportService.persistTimesheetPayload = async (payload) => {
    addCounter += 1;
    const saved = { ...payload, id: String(payload?.id || '').trim() || `TS_${addCounter}` };
    const existingIndex = createdTimesheets.findIndex((row) => row.id === saved.id);
    if (existingIndex >= 0) {
      createdTimesheets[existingIndex] = saved;
    } else {
      createdTimesheets.push(saved);
    }
    return saved;
  };
  timesheetImportLifecycleService.prepareImportTargetPayload = ({
    basePayload,
    priorTimesheet = null,
    targetStatus = 'draft'
  }) => {
    const normalized = String(targetStatus || 'draft').toLowerCase();
    const requiresPostSaveFinalization = ['submitted', 'manager_approved', 'processed'].includes(normalized);
    const payload = priorTimesheet?.id
      ? { ...basePayload, id: priorTimesheet.id, status: normalized }
      : { ...basePayload, status: normalized };
    return {
      payload,
      requiresPostSaveFinalization,
      appliedStatus: normalized
    };
  };
  timesheetImportLifecycleService.finalizeImportTargetAfterSave = async ({ savedTimesheet, targetStatus }) => {
    const normalized = String(targetStatus || savedTimesheet?.status || 'processed').toLowerCase();
    const updated = { ...savedTimesheet, status: normalized };
    const index = createdTimesheets.findIndex((row) => row.id === updated.id);
    if (index >= 0) createdTimesheets[index] = updated;
    return updated;
  };
  schoolRepositories.timesheets.maintenancePurgeById = async (id) => {
    const index = createdTimesheets.findIndex((row) => row.id === id);
    if (index >= 0) createdTimesheets.splice(index, 1);
    return { id };
  };
  activityService.isPersonEligibleForActivity = () => true;

  return {
    getCreatedTimesheets: () => [...createdTimesheets],
    restore: () => {
      timesheetImportPolicyModel.getPolicyForOrg = originals.getPolicy;
      timesheetLegacyImportService.resolveImportActivity = originals.resolveActivity;
      dataService.getDataById = originals.getById;
      dataService.getTimesheetByPeriodAndTeacher = originals.getTimesheet;
      timesheetPayrollContextService.resolvePayrollPersonContext = originals.payroll;
      timesheetImportWorkSessionBuilderService.createImportWorkSessions = originals.createSessions;
      timesheetImportWorkSessionBuilderService.removeImportWorkSessionsForTarget = originals.preCleanSessions;
      timesheetImportWorkSessionBuilderService.removeTrackedImportWorkSessionsForPersonPeriod = originals.trackedCleanSessions;
      timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByBatchId = originals.removeSessions;
      timesheetLiveAssemblyService.buildImportedTimesheetEntries = originals.assemble;
      timesheetLegacyImportService.persistTimesheetPayload = originals.persist;
      timesheetImportLifecycleService.prepareImportTargetPayload = originals.prepare;
      timesheetImportLifecycleService.finalizeImportTargetAfterSave = originals.finalize;
      schoolRepositories.timesheets.maintenancePurgeById = originals.purgeRepo;
      dataService.fetchAllData = originals.fetchAllData;
      timesheetParametersPolicyModel.getPolicyForOrg = originals.getTimesheetParametersPolicy;
      statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled = originals.isStatHolidayPayEnabled;
      statutoryHolidayTimesheetLifecycleService.applyStatHolidayOnTimesheetSubmit = originals.applyStatHolidayOnTimesheetSubmit;
      statutoryHolidayTimesheetLifecycleService.mergeStatHolidayRowsIntoEntries = originals.mergeStatHolidayRowsIntoEntries;
      statutoryHolidayTimesheetLifecycleService.previewStatHolidayForTimesheet = originals.previewStatHoliday;
    }
  };
}

test('buildImportExecutionPlan returns performable rows and role selection', async () => {
  const stub = stubExecutionDeps();
  try {
    const plan = await executionService.buildImportExecutionPlan({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      compileResults: [compileOkResult('PER_A')],
      reqUser: REQ_USER
    });
    assert.equal(plan.rows.length, 1);
    assert.equal(plan.rows[0].periodId, 'PER_A');
    assert.equal(plan.rows[0].eligibility, 'ready');
    assert.equal(plan.readyCount, 1);
    assert.equal(plan.blockedCount, 0);
    assert.equal(plan.needsRoleSelection.length, 0);
    assert.equal(plan.defaultPersonRole, 'teacher');
    assert.equal(plan.defaultImportTargetStatus, 'draft');
    assert.deepEqual(plan.importTargetStatusOptions, ['draft', 'submitted', 'manager_approved', 'processed']);
    assert.equal(plan.rows[0].targetStatus, 'draft');
    assert.equal(plan.rows[0].statHolidayPreview.hasStatHolidays, false);
    assert.equal(plan.rows[0].statHolidayPreview.hasBlockingIssues, false);
    assert.equal(plan.rows[0].statHolidayPreview.missingDayEntries.length, 0);
  } finally {
    stub.restore();
  }
});

test('buildImportExecutionPlan previews statutory holidays for ready rows', async () => {
  const stub = stubExecutionDeps();
  const originalPreview = statutoryHolidayTimesheetLifecycleService.previewStatHolidayForTimesheet;
  const originalGetPolicy = timesheetParametersPolicyModel.getPolicyForOrg;
  const originalIsEnabled = statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled;

  timesheetParametersPolicyModel.getPolicyForOrg = async () => ({
    statutoryHolidayPay: { enabled: true, activityId: 'ACT_STAT' }
  });
  statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled = () => true;
  statutoryHolidayTimesheetLifecycleService.previewStatHolidayForTimesheet = async () => ({
    rows: [{
      sessionId: 'stathol-H1-PERSON_1',
      date: '2026-03-10',
      isStatutoryHoliday: true,
      statHolidayMeta: { holidayId: 'H1', holidayName: 'Family Day' }
    }],
    warnings: ['Not enough workdays before holiday'],
    usesActivityMode: true,
    syncOutcome: {
      blocked: true,
      activityId: 'ACT_STAT',
      missingDayEntries: [{ holidayId: 'H1', date: '2026-03-10', title: 'Family Day' }]
    },
    blockingErrors: [
      'Missing pre-mapped statutory holiday work session for Family Day (2026-03-10). Map holiday day work sessions in Settings before submitting.'
    ]
  });

  try {
    const plan = await executionService.buildImportExecutionPlan({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      compileResults: [compileOkResult('PER_A')],
      reqUser: REQ_USER
    });
    assert.equal(plan.rows[0].statHolidayPreview.hasStatHolidays, true);
    assert.equal(plan.rows[0].statHolidayPreview.count, 1);
    assert.deepEqual(plan.rows[0].statHolidayPreview.holidayNames, ['Family Day']);
    assert.match(plan.rows[0].statHolidayPreview.warnings[0], /workdays/i);
    assert.equal(plan.rows[0].statHolidayPreview.hasBlockingIssues, true);
    assert.equal(plan.rows[0].statHolidayPreview.missingDayEntries.length, 1);
  } finally {
    statutoryHolidayTimesheetLifecycleService.previewStatHolidayForTimesheet = originalPreview;
    timesheetParametersPolicyModel.getPolicyForOrg = originalGetPolicy;
    statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled = originalIsEnabled;
    stub.restore();
  }
});

test('buildImportExecutionPlan returns blocked rows for existing processed timesheets', async () => {
  const stub = stubExecutionDeps({
    existingByPeriod: {
      PER_A: { id: 'TS_EXISTING', status: 'processed', periodId: 'PER_A' }
    }
  });
  try {
    const plan = await executionService.buildImportExecutionPlan({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      compileResults: [compileOkResult('PER_A')],
      reqUser: REQ_USER
    });
    assert.equal(plan.rows.length, 1);
    assert.equal(plan.rows[0].eligibility, 'blocked');
    assert.match(plan.rows[0].blockReason, /delete|clear|processed/i);
    assert.equal(plan.readyCount, 0);
    assert.equal(plan.blockedCount, 1);
    assert.equal(plan.skipped.length, 1);
  } finally {
    stub.restore();
  }
});

test('buildImportExecutionPlan marks draft timesheets as ready', async () => {
  const stub = stubExecutionDeps({
    existingByPeriod: {
      PER_A: { id: 'TS_DRAFT', status: 'draft', periodId: 'PER_A' }
    }
  });
  try {
    const plan = await executionService.buildImportExecutionPlan({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      compileResults: [compileOkResult('PER_A')],
      reqUser: REQ_USER
    });
    assert.equal(plan.rows.length, 1);
    assert.equal(plan.rows[0].eligibility, 'ready');
    assert.equal(plan.rows[0].existingTimesheetId, 'TS_DRAFT');
    assert.equal(plan.rows[0].existingTimesheetStatus, 'draft');
    assert.equal(plan.readyCount, 1);
    assert.equal(plan.blockedCount, 0);
  } finally {
    stub.restore();
  }
});

test('performImportExecution updates an existing draft instead of rejecting', async () => {
  const stub = stubExecutionDeps({
    existingByPeriod: {
      PER_A: { id: 'TS_DRAFT', status: 'draft', periodId: 'PER_A', teacherId: 'PERSON_1' }
    }
  });
  try {
    const compileResult = compileOkResult('PER_A');
    const outcome = await executionService.performImportExecution({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      personRole: 'teacher',
      compileResult,
      batchId: 'BATCH_1',
      targetStatus: 'processed',
      reqUser: REQ_USER
    });
    assert.equal(outcome.steps.processed.status, 'success');
    const saved = stub.getCreatedTimesheets()[0];
    assert.equal(saved.id, 'TS_DRAFT');
    assert.equal(saved.status, 'processed');
  } finally {
    stub.restore();
  }
});

test('performImportExecution rejects processed existing timesheets', async () => {
  const stub = stubExecutionDeps({
    existingByPeriod: {
      PER_A: { id: 'TS_EXISTING', status: 'processed', periodId: 'PER_A', teacherId: 'PERSON_1' }
    }
  });
  try {
    await assert.rejects(
      () => executionService.performImportExecution({
        orgId: 'ORG_1',
        personId: 'PERSON_1',
        periodId: 'PER_A',
        personRole: 'teacher',
        compileResult: compileOkResult('PER_A'),
        batchId: 'BATCH_1',
        reqUser: REQ_USER
      }),
      (error) => error.statusCode === 409
    );
  } finally {
    stub.restore();
  }
});

test('performImportExecution runs all steps and saves processed timesheet with stat holidays', async () => {
  const applyCalls = [];
  const stub = stubExecutionDeps();
  const originalApply = statutoryHolidayTimesheetLifecycleService.applyStatHolidayOnTimesheetSubmit;
  const originalIsEnabled = statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled;
  const originalGetPolicy = timesheetParametersPolicyModel.getPolicyForOrg;

  timesheetParametersPolicyModel.getPolicyForOrg = async () => ({
    statutoryHolidayPay: { enabled: true, activityId: 'ACT_STAT' }
  });
  statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled = () => true;
  statutoryHolidayTimesheetLifecycleService.applyStatHolidayOnTimesheetSubmit = async (args) => {
    applyCalls.push(args);
    return {
      rows: [{
        sessionId: 'stathol-H1-PERSON_1',
        date: '2026-03-10',
        hours: 0,
        timesheetHours: 0,
        isStatutoryHoliday: true,
        statHolidayMeta: { holidayId: 'H1', calculatedHours: 8 }
      }],
      warnings: [],
      usesActivityMode: true,
      syncOutcome: { rowCount: 1 }
    };
  };
  statutoryHolidayTimesheetLifecycleService.mergeStatHolidayRowsIntoEntries = realMergeStatHolidayRowsIntoEntries;
  const originalGetEntries = activityService.getTimesheetEntriesForPerson;
  activityService.getTimesheetEntriesForPerson = async () => ([{
    sessionId: 'act-ACT_STAT-ENT-H1-PERSON_1',
    activityId: 'ACT_STAT',
    date: '2026-03-10',
    statHolidayId: 'H1',
    hours: 8,
    timesheetHours: 8,
    isSchoolActivity: true
  }]);

  try {
    const compileResult = compileOkResult('PER_A');
    const outcome = await executionService.performImportExecution({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      personRole: 'teacher',
      compileResult,
      batchId: 'BATCH_1',
      targetStatus: 'processed',
      reqUser: REQ_USER
    });
    assert.equal(outcome.steps.processed.status, 'success');
    assert.equal(outcome.steps.processed.appliedStatus, 'processed');
    assert.equal(applyCalls.length, 1);
    assert.equal(applyCalls[0].personId, 'PERSON_1');
    assert.equal(applyCalls[0].period?.id, 'PER_A');
    const saved = stub.getCreatedTimesheets()[0];
    assert.equal(saved.status, 'processed');
    assert.equal(saved.legacyImport.executionMode, 'activity_first');
    assert.equal(saved.entries.length, 3);
    const statRow = saved.entries.find((entry) => entry.isStatutoryHoliday === true);
    assert.ok(statRow);
    assert.equal(statRow.sessionId, 'stathol-H1-PERSON_1');
    assert.equal(statRow.hours, 0);
    const actStatRow = saved.entries.find((entry) => entry.statHolidayId === 'H1' && !entry.isStatutoryHoliday);
    assert.ok(actStatRow);
    assert.equal(actStatRow.sessionId, 'act-ACT_STAT-ENT-H1-PERSON_1');
    assert.equal(actStatRow.hours, 8);
    assert.equal(actStatRow.timesheetHours, 8);
    assert.ok(saved.totalHours > 0);
    assert.equal(saved.totalHours, 10);
  } finally {
    activityService.getTimesheetEntriesForPerson = originalGetEntries;
    statutoryHolidayTimesheetLifecycleService.applyStatHolidayOnTimesheetSubmit = originalApply;
    statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled = originalIsEnabled;
    timesheetParametersPolicyModel.getPolicyForOrg = originalGetPolicy;
    stub.restore();
  }
});

test('performImportExecution falls back to draft when statutory holiday work sessions are missing', async () => {
  const stub = stubExecutionDeps();
  const originalApply = statutoryHolidayTimesheetLifecycleService.applyStatHolidayOnTimesheetSubmit;
  const originalIsEnabled = statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled;
  const originalGetPolicy = timesheetParametersPolicyModel.getPolicyForOrg;

  timesheetParametersPolicyModel.getPolicyForOrg = async () => ({
    statutoryHolidayPay: { enabled: true, activityId: 'ACT_STAT' }
  });
  statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled = () => true;
  statutoryHolidayTimesheetLifecycleService.applyStatHolidayOnTimesheetSubmit = async () => ({
    rows: [{
      sessionId: 'stathol-H1-PERSON_1',
      date: '2026-01-01',
      hours: 0,
      timesheetHours: 0,
      isStatutoryHoliday: true,
      statHolidayMeta: { holidayId: 'H1', calculatedHours: 0, qualified: false }
    }],
    warnings: [{ holidayId: 'H1', reasons: ['Not qualified'] }],
    usesActivityMode: true,
    syncOutcome: { blocked: true, missingDayEntries: [{ holidayId: 'H1', date: '2026-01-01', title: "New Year's Day" }] },
    blockingErrors: ['Missing pre-mapped statutory holiday work session for New Year\'s Day (2026-01-01). Map holiday day work sessions in Settings before submitting.']
  });
  statutoryHolidayTimesheetLifecycleService.mergeStatHolidayRowsIntoEntries = realMergeStatHolidayRowsIntoEntries;

  try {
    const outcome = await executionService.performImportExecution({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      personRole: 'teacher',
      compileResult: compileOkResult('PER_A'),
      batchId: 'BATCH_1',
      targetStatus: 'processed',
      reqUser: REQ_USER
    });
    assert.equal(outcome.appliedStatus, 'draft');
    assert.equal(outcome.statHolidayBlocked, true);
    assert.equal(outcome.steps.timesheet.status, 'success');
    assert.match(outcome.steps.timesheet.summary, /Saved as draft/i);
    assert.equal(outcome.steps.processed?.status || 'pending', 'pending');
    const saved = stub.getCreatedTimesheets()[0];
    assert.equal(saved.status, 'draft');
    assert.equal(saved.entries.some((entry) => entry.isStatutoryHoliday === true), true);
  } finally {
    statutoryHolidayTimesheetLifecycleService.applyStatHolidayOnTimesheetSubmit = originalApply;
    statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled = originalIsEnabled;
    timesheetParametersPolicyModel.getPolicyForOrg = originalGetPolicy;
    stub.restore();
  }
});

test('performImportExecution with draft skips statutory holiday apply', async () => {
  const applyCalls = [];
  const stub = stubExecutionDeps();
  const originalApply = statutoryHolidayTimesheetLifecycleService.applyStatHolidayOnTimesheetSubmit;
  const originalIsEnabled = statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled;
  const originalGetPolicy = timesheetParametersPolicyModel.getPolicyForOrg;

  timesheetParametersPolicyModel.getPolicyForOrg = async () => ({
    statutoryHolidayPay: { enabled: true, activityId: 'ACT_STAT' }
  });
  statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled = () => true;
  statutoryHolidayTimesheetLifecycleService.applyStatHolidayOnTimesheetSubmit = async (args) => {
    applyCalls.push(args);
    return { rows: [], warnings: [], usesActivityMode: true, syncOutcome: null };
  };

  try {
    const outcome = await executionService.performImportExecution({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      personRole: 'teacher',
      compileResult: compileOkResult('PER_A'),
      batchId: 'BATCH_DRAFT',
      targetStatus: 'draft',
      reqUser: REQ_USER
    });
    assert.equal(applyCalls.length, 0);
    assert.equal(outcome.appliedStatus, 'draft');
    assert.equal(outcome.steps.processed.status, 'pending');
    const saved = stub.getCreatedTimesheets()[0];
    assert.equal(saved.status, 'draft');
    assert.equal(saved.entries.length, 1);
    assert.equal(saved.entries.some((entry) => entry.isStatutoryHoliday === true), false);
  } finally {
    statutoryHolidayTimesheetLifecycleService.applyStatHolidayOnTimesheetSubmit = originalApply;
    statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled = originalIsEnabled;
    timesheetParametersPolicyModel.getPolicyForOrg = originalGetPolicy;
    stub.restore();
  }
});

test('performImportExecution requires role when person has teacher and staff roles', async () => {
  const stub = stubExecutionDeps({ payrollRoles: ['teacher', 'staff'] });
  try {
    await assert.rejects(
      () => executionService.performImportExecution({
        orgId: 'ORG_1',
        personId: 'PERSON_1',
        periodId: 'PER_A',
        personRole: '',
        compileResult: compileOkResult('PER_A'),
        batchId: 'BATCH_1',
        reqUser: REQ_USER
      }),
      /Select a payroll role/
    );
  } finally {
    stub.restore();
  }
});

test('performImportExecution creates work sessions across mapped and default activities', async () => {
  const mappedPolicy = {
    ...POLICY,
    classNameActivityMappings: [
      { className: 'LINC', activityId: 'ACT_LINC' },
      { className: 'Math', activityId: 'ACT_MATH' }
    ]
  };
  const sessionCreates = [];
  const assembleCalls = [];
  const originals = {
    getPolicy: timesheetImportPolicyModel.getPolicyForOrg,
    resolveActivity: timesheetLegacyImportService.resolveImportActivity,
    createSessions: timesheetImportWorkSessionBuilderService.createImportWorkSessions,
    assemble: timesheetLiveAssemblyService.buildImportedTimesheetEntries
  };

  const stub = stubExecutionDeps();
  timesheetImportPolicyModel.getPolicyForOrg = async () => mappedPolicy;
  timesheetLegacyImportService.resolveImportActivity = async ({ activityId }) => ({
    ...ACTIVITY,
    id: activityId,
    title: `Activity ${activityId}`,
    entries: []
  });
  timesheetImportWorkSessionBuilderService.createImportWorkSessions = async (args) => {
    sessionCreates.push({
      activityId: args.activity.id,
      rowCount: args.compiledRows.length,
      classNames: args.compiledRows.map((row) => row.className)
    });
    const prefix = args.activity.id;
    return {
      activityId: prefix,
      batchId: args.batchId,
      createdEntryIds: args.compiledRows.map((_row, index) => `ENT-${prefix}-${index + 1}`),
      rowCount: args.compiledRows.length
    };
  };
  timesheetLiveAssemblyService.buildImportedTimesheetEntries = async (args) => {
    assembleCalls.push(args.importActivitySessionGuard);
    return {
      entries: [{
        sessionId: 'act-ACT_LINC-ENT-ACT_LINC-1-PERSON_1',
        date: '2026-03-01',
        hours: 6,
        timesheetHours: 6,
        isManual: false,
        isSchoolActivity: true
      }, {
        sessionId: 'act-ACT_MATH-ENT-ACT_MATH-1-PERSON_1',
        date: '2026-03-01',
        hours: 2,
        timesheetHours: 2,
        isManual: false,
        isSchoolActivity: true
      }],
      totalHours: 8,
      statHolidayWarnings: [],
      payrollContext: { defaultRole: 'teacher', roles: ['teacher'] },
      personRole: 'teacher'
    };
  };

  try {
    const outcome = await executionService.performImportExecution({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      personRole: 'teacher',
      compileResult: {
        status: 'ok',
        fileName: 'march.xlsx',
        matchedPeriod: { id: 'PER_A', name: 'PER_A' },
        rows: [
          { date: '2026-03-01', className: 'LINC', hours: 6 },
          { date: '2026-03-01', className: 'Math', hours: 2 },
          { date: '2026-03-02', className: 'Office Admin', hours: 1 }
        ]
      },
      batchId: 'BATCH_MULTI',
      reqUser: REQ_USER
    });

    assert.equal(sessionCreates.length, 3);
    assert.deepEqual(
      sessionCreates.map((row) => row.activityId).sort(),
      ['ACT_IMPORT', 'ACT_LINC', 'ACT_MATH']
    );
    assert.equal(outcome.steps.workSessions.summary, 'Created 3 work session(s) across 3 activities.');
    const saved = stub.getCreatedTimesheets()[0];
    assert.deepEqual(saved.legacyImport.workSessionActivities.map((row) => row.activityId).sort(), [
      'ACT_IMPORT',
      'ACT_LINC',
      'ACT_MATH'
    ]);
    assert.equal(assembleCalls.length, 1);
    assert.deepEqual(
      [...assembleCalls[0].protectedActivityIds].sort(),
      ['ACT_IMPORT', 'ACT_LINC', 'ACT_MATH']
    );
  } finally {
    stub.restore();
    timesheetImportPolicyModel.getPolicyForOrg = originals.getPolicy;
    timesheetLegacyImportService.resolveImportActivity = originals.resolveActivity;
    timesheetImportWorkSessionBuilderService.createImportWorkSessions = originals.createSessions;
    timesheetLiveAssemblyService.buildImportedTimesheetEntries = originals.assemble;
  }
});

test('performImportExecution pre-cleans statutory holiday assignees before work sessions', async () => {
  const statHolidayCleanups = [];
  const stub = stubExecutionDeps();
  const originalCleanup = timesheetLegacyImportService.cleanupStatHolidayForTimesheetTarget;
  timesheetLegacyImportService.cleanupStatHolidayForTimesheetTarget = async (args) => {
    statHolidayCleanups.push(args);
    return { removedAssignees: 1, removedEntries: 0 };
  };

  try {
    await executionService.performImportExecution({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      personRole: 'teacher',
      compileResult: compileOkResult('PER_A'),
      batchId: 'BATCH_STAT_CLEAN',
      reqUser: REQ_USER
    });
    assert.equal(statHolidayCleanups.length, 1);
    assert.equal(statHolidayCleanups[0].personId, 'PERSON_1');
    assert.equal(statHolidayCleanups[0].period?.id, 'PER_A');
  } finally {
    timesheetLegacyImportService.cleanupStatHolidayForTimesheetTarget = originalCleanup;
    stub.restore();
  }
});

test('performImportExecution chains same-day times across mapped activities', async () => {
  const mappedPolicy = {
    ...POLICY,
    importBaseStartTime: '08:00',
    classNameActivityMappings: [
      { className: 'LINC', activityId: 'ACT_LINC' },
      { className: 'Math', activityId: 'ACT_MATH' }
    ]
  };
  const sessionCreates = [];
  const originals = {
    getPolicy: timesheetImportPolicyModel.getPolicyForOrg,
    resolveActivity: timesheetLegacyImportService.resolveImportActivity,
    createSessions: timesheetImportWorkSessionBuilderService.createImportWorkSessions,
    assemble: timesheetLiveAssemblyService.buildImportedTimesheetEntries
  };

  const stub = stubExecutionDeps();
  timesheetImportPolicyModel.getPolicyForOrg = async () => mappedPolicy;
  timesheetLegacyImportService.resolveImportActivity = async ({ activityId }) => ({
    ...ACTIVITY,
    id: activityId,
    title: `Activity ${activityId}`,
    entries: []
  });
  timesheetImportWorkSessionBuilderService.createImportWorkSessions = async (args) => {
    sessionCreates.push({
      activityId: args.activity.id,
      skipStacking: args.skipStacking,
      rows: args.compiledRows.map((row) => ({
        className: row.className,
        startTime: row.startTime,
        endTime: row.endTime
      }))
    });
    const prefix = args.activity.id;
    return {
      activityId: prefix,
      batchId: args.batchId,
      createdEntryIds: args.compiledRows.map((_row, index) => `ENT-${prefix}-${index + 1}`),
      rowCount: args.compiledRows.length
    };
  };
  timesheetLiveAssemblyService.buildImportedTimesheetEntries = async () => ({
    entries: [{
      sessionId: 'act-ACT_LINC-ENT-ACT_LINC-1-PERSON_1',
      date: '2026-03-01',
      hours: 6,
      timesheetHours: 6,
      isManual: false,
      isSchoolActivity: true
    }, {
      sessionId: 'act-ACT_MATH-ENT-ACT_MATH-1-PERSON_1',
      date: '2026-03-01',
      hours: 2,
      timesheetHours: 2,
      isManual: false,
      isSchoolActivity: true
    }],
    totalHours: 8,
    statHolidayWarnings: [],
    payrollContext: { defaultRole: 'teacher', roles: ['teacher'] },
    personRole: 'teacher'
  });

  try {
    await executionService.performImportExecution({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      personRole: 'teacher',
      compileResult: {
        status: 'ok',
        fileName: 'march.xlsx',
        matchedPeriod: { id: 'PER_A', name: 'PER_A' },
        rows: [
          { date: '2026-03-01', className: 'LINC', hours: 6, sourceRowNumber: 1 },
          { date: '2026-03-01', className: 'Math', hours: 2, sourceRowNumber: 2 }
        ]
      },
      batchId: 'BATCH_CHAIN',
      reqUser: REQ_USER
    });

    assert.equal(sessionCreates.length, 2);
    assert.equal(sessionCreates.every((row) => row.skipStacking === true), true);

    const lincRows = sessionCreates.find((row) => row.activityId === 'ACT_LINC')?.rows || [];
    const mathRows = sessionCreates.find((row) => row.activityId === 'ACT_MATH')?.rows || [];
    assert.equal(lincRows[0].startTime, '08:00');
    assert.equal(lincRows[0].endTime, '14:00');
    assert.equal(mathRows[0].startTime, '14:00');
    assert.equal(mathRows[0].endTime, '16:00');
  } finally {
    stub.restore();
    timesheetImportPolicyModel.getPolicyForOrg = originals.getPolicy;
    timesheetLegacyImportService.resolveImportActivity = originals.resolveActivity;
    timesheetImportWorkSessionBuilderService.createImportWorkSessions = originals.createSessions;
    timesheetLiveAssemblyService.buildImportedTimesheetEntries = originals.assemble;
  }
});

test('normalizeStatHolidayOverrideMap treats zero hours as auto-calculate', () => {
  const map = statutoryHolidayWorkSessionService.normalizeStatHolidayOverrideMap([
    { holidayId: 'H1', hours: 0, forcePay: true },
    { holidayId: 'H2', hours: 6, forcePay: true }
  ]);
  assert.equal(map.H1?.forcePay, true);
  assert.equal(map.H1?.hours, undefined);
  assert.equal(map.H2?.hours, 6);
});

test('performImportExecution assembles timesheets without manager stat holiday overrides', async () => {
  const assembleCalls = [];
  const stub = stubExecutionDeps();
  const originalAssemble = timesheetLiveAssemblyService.buildImportedTimesheetEntries;

  timesheetLiveAssemblyService.buildImportedTimesheetEntries = async (args) => {
    assembleCalls.push(args);
    return originalAssemble
      ? await originalAssemble(args)
      : {
        entries: [{
          sessionId: 'act-ACT_IMPORT-ENT-ACT_IMPORT-0001-PERSON_1',
          date: '2026-03-01',
          hours: 8,
          timesheetHours: 8,
          isManual: false,
          isSchoolActivity: true
        }],
        totalHours: 8,
        statHolidayWarnings: [],
        payrollContext: { defaultRole: 'teacher', roles: ['teacher'] },
        personRole: 'teacher'
      };
  };

  try {
    await executionService.performImportExecution({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      personRole: 'teacher',
      compileResult: compileOkResult('PER_A'),
      batchId: 'BATCH_STAT',
      reqUser: REQ_USER
    });

    assert.equal(assembleCalls.length, 1);
    assert.equal(assembleCalls[0].allowManagerOverride, false);
    assert.equal(assembleCalls[0].statHolidayOverrideMap, undefined);
  } finally {
    stub.restore();
  }
});

test('buildImportExecutionPlan blocks when configured statutory activity lacks Jan 1 work sessions', async () => {
  const stub = stubExecutionDeps();
  const previewStub = stubStatHolidayImportPreviewDeps({
    payActivityId: 'ACT_PAY',
    payActivityTitle: 'Pay Activity',
    payActivityEntries: []
  });
  try {
    const plan = await executionService.buildImportExecutionPlan({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      compileResults: [compileJanuaryResult('PER_JAN')],
      reqUser: REQ_USER
    });
    assert.equal(plan.rows[0].statHolidayPreview.hasBlockingIssues, true);
    assert.equal(plan.rows[0].statHolidayPreview.missingDayEntries.length, 1);
    assert.equal(plan.rows[0].statHolidayPreview.missingDayEntries[0].date, '2026-01-01');
    assert.equal(plan.rows[0].statHolidayPreview.activityId, 'ACT_PAY');
    assert.match(plan.rows[0].statHolidayPreview.blockingErrors[0], /Pay Activity/);
  } finally {
    previewStub.restore();
    stub.restore();
  }
});

test('buildImportExecutionPlan previews blocking statutory holidays when import rows are zero-hour', async () => {
  const stub = stubExecutionDeps();
  const previewStub = stubStatHolidayImportPreviewDeps({
    payActivityId: 'ACT_PAY',
    payActivityEntries: []
  });
  try {
    const plan = await executionService.buildImportExecutionPlan({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      compileResults: [compileJanuaryResult('PER_JAN', [{ date: '2026-01-02', className: 'Math', hours: 0 }])],
      reqUser: REQ_USER
    });
    assert.equal(plan.rows[0].statHolidayPreview.hasBlockingIssues, true);
    assert.equal(plan.rows[0].statHolidayPreview.missingDayEntries[0].date, '2026-01-01');
  } finally {
    previewStub.restore();
    stub.restore();
  }
});

test('buildImportExecutionPlan warns when mapping activity differs from pay activity', async () => {
  const stub = stubExecutionDeps();
  const previewStub = stubStatHolidayImportPreviewDeps({
    payActivityId: 'ACT_PAY',
    mappingActivityId: 'ACT_MAP',
    payActivityEntries: []
  });
  try {
    const plan = await executionService.buildImportExecutionPlan({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      compileResults: [compileJanuaryResult('PER_JAN')],
      reqUser: REQ_USER
    });
    assert.equal(plan.rows[0].statHolidayPreview.configurationWarnings.length, 1);
    assert.match(plan.rows[0].statHolidayPreview.configurationWarnings[0], /Mapping Activity/);
    assert.match(plan.rows[0].statHolidayPreview.configurationWarnings[0], /Pay Activity/);
  } finally {
    previewStub.restore();
    stub.restore();
  }
});

test('performImportExecution does not merge statutory holiday sessions from a different activity', async () => {
  const stub = stubExecutionDeps();
  const previewStub = stubStatHolidayImportPreviewDeps({
    payActivityId: 'ACT_PAY',
    payActivityTitle: 'Pay Activity',
    payActivityEntries: [{
      entryId: 'ENT-PAY-0001',
      date: '2026-01-01',
      startTime: '08:00',
      endTime: '20:00',
      durationHours: 12,
      status: 'posted',
      statHolidayId: 'H_NY',
      assignees: [{
        personId: 'PERSON_1',
        paidHours: 8,
        statHolidayId: 'H_NY',
        statHolidayPersonId: 'PERSON_1',
        statHolidayPeriodId: 'PER_JAN'
      }]
    }],
    periodStartDate: '2026-01-01',
    periodEndDate: '2026-01-15'
  });
  const originalApply = statutoryHolidayTimesheetLifecycleService.applyStatHolidayOnTimesheetSubmit;
  const originalIsEnabled = statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled;
  const originalGetPolicy = timesheetParametersPolicyModel.getPolicyForOrg;
  const originalGetEntries = activityService.getTimesheetEntriesForPerson;
  const originalAssemble = timesheetLiveAssemblyService.buildImportedTimesheetEntries;
  const realMerge = realMergeStatHolidayRowsIntoEntries;

  statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled = () => true;
  timesheetParametersPolicyModel.getPolicyForOrg = async () => ({
    statutoryHolidayPay: { enabled: true, activityId: 'ACT_PAY' }
  });
  statutoryHolidayTimesheetLifecycleService.applyStatHolidayOnTimesheetSubmit = async () => ({
    rows: [{
      sessionId: 'stathol-H_NY-PERSON_1',
      date: '2026-01-01',
      hours: 0,
      timesheetHours: 0,
      isStatutoryHoliday: true,
      statHolidayMeta: { holidayId: 'H_NY', calculatedHours: 8 }
    }],
    warnings: [],
    usesActivityMode: true,
    syncOutcome: { rowCount: 1 }
  });
  statutoryHolidayTimesheetLifecycleService.mergeStatHolidayRowsIntoEntries = realMerge;
  timesheetLiveAssemblyService.buildImportedTimesheetEntries = async () => ({
    entries: [{
      sessionId: 'act-ACT_IMPORT-ENT-ACT_IMPORT-0001-PERSON_1',
      date: '2026-01-02',
      hours: 2,
      timesheetHours: 2,
      isManual: false,
      isSchoolActivity: true
    }],
    totalHours: 2,
    statHolidayWarnings: [],
    payrollContext: { defaultRole: 'teacher', roles: ['teacher'] },
    personRole: 'teacher'
  });
  activityService.getTimesheetEntriesForPerson = async () => ([
    {
      sessionId: 'act-ACT_MAP-ENT-MAP-0001-PERSON_1',
      activityId: 'ACT_MAP',
      date: '2026-01-01',
      statHolidayId: 'H_NY',
      hours: 8,
      timesheetHours: 8,
      isSchoolActivity: true
    },
    {
      sessionId: 'act-ACT_PAY-ENT-PAY-0001-PERSON_1',
      activityId: 'ACT_PAY',
      date: '2026-01-01',
      statHolidayId: 'H_NY',
      hours: 8,
      timesheetHours: 8,
      isSchoolActivity: true
    }
  ]);

  try {
    const outcome = await executionService.performImportExecution({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_JAN',
      personRole: 'teacher',
      compileResult: compileJanuaryResult('PER_JAN'),
      batchId: 'BATCH_JAN',
      targetStatus: 'submitted',
      reqUser: REQ_USER
    });
    assert.equal(outcome.steps.timesheet.status, 'success');
    const saved = stub.getCreatedTimesheets()[0];
    const mapRow = saved.entries.find((entry) => cleanId(entry?.sessionId).includes('ACT_MAP'));
    const payRow = saved.entries.find((entry) => cleanId(entry?.sessionId).includes('ACT_PAY'));
    assert.equal(mapRow, undefined);
    assert.ok(payRow);
  } finally {
    activityService.getTimesheetEntriesForPerson = originalGetEntries;
    timesheetLiveAssemblyService.buildImportedTimesheetEntries = originalAssemble;
    statutoryHolidayTimesheetLifecycleService.applyStatHolidayOnTimesheetSubmit = originalApply;
    statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled = originalIsEnabled;
    timesheetParametersPolicyModel.getPolicyForOrg = originalGetPolicy;
    previewStub.restore();
    stub.restore();
  }
});

function cleanId(value) {
  return String(value ?? '').trim();
}
