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
const statutoryHolidayWorkSessionService = require('../MVC/services/school/statutoryHolidayWorkSessionService');
const schoolRepositories = require('../MVC/repositories/school');

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
    purgeRepo: schoolRepositories.timesheets.maintenancePurgeById
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
  timesheetLiveAssemblyService.buildImportedTimesheetEntries = async () => ({
    entries: [{
      sessionId: 'act-ACT_IMPORT-ENT-ACT_IMPORT-0001-PERSON_1',
      date: '2026-03-01',
      hours: 2,
      timesheetHours: 2,
      isManual: false,
      isSchoolActivity: true
    }, {
      sessionId: 'stat-holiday-2026-03-10',
      date: '2026-03-10',
      hours: 8,
      timesheetHours: 8,
      isManual: false,
      isStatHoliday: true
    }],
    totalHours: 10,
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
  timesheetImportLifecycleService.prepareImportTargetPayload = ({ basePayload, priorTimesheet = null }) => ({
    payload: priorTimesheet?.id ? { ...basePayload, id: priorTimesheet.id } : basePayload,
    requiresPostSaveFinalization: true,
    appliedStatus: 'processed'
  });
  timesheetImportLifecycleService.finalizeImportTargetAfterSave = async ({ savedTimesheet }) => {
    const updated = { ...savedTimesheet, status: 'processed' };
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
  } finally {
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
  const stub = stubExecutionDeps();
  try {
    const compileResult = compileOkResult('PER_A');
    const outcome = await executionService.performImportExecution({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      personRole: 'teacher',
      compileResult,
      batchId: 'BATCH_1',
      reqUser: REQ_USER
    });
    assert.equal(outcome.steps.processed.status, 'success');
    assert.equal(outcome.steps.processed.appliedStatus, 'processed');
    const saved = stub.getCreatedTimesheets()[0];
    assert.equal(saved.status, 'processed');
    assert.equal(saved.legacyImport.executionMode, 'activity_first');
    assert.equal(saved.entries.length, 2);
  } finally {
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
