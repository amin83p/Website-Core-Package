'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const timesheetLegacyImportService = require('../MVC/services/school/timesheetLegacyImportService');
const dataService = require('../MVC/services/school/schoolDataService');
const activityService = require('../MVC/services/school/activityService');
const timesheetImportPolicyModel = require('../MVC/models/school/timesheetImportPolicyModel');
const timesheetImportLifecycleService = require('../MVC/services/school/timesheetImportLifecycleService');
const schoolDependencyService = require('../MVC/services/school/schoolDependencyService');
const timesheetManualMaterializationService = require('../MVC/services/school/timesheetManualMaterializationService');
const taskService = require('../MVC/services/school/taskService');
const timesheetImportWorkSessionBuilderService = require('../MVC/services/school/timesheetImportWorkSessionBuilderService');
const schoolRepositories = require('../MVC/repositories/school');
const { sanitizeLegacyImport, sanitizeTimesheetPayload } = require('../MVC/models/school/timesheetModel');

const ROOT = path.resolve(__dirname, '../../..');
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
  title: 'Legacy Import Activity',
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

function stubLegacyImportApplyDeps({
  existingByPeriod = {},
  addShouldFailOnPeriod = '',
  periods = {}
} = {}) {
  const originals = {
    getPolicy: timesheetImportPolicyModel.getPolicyForOrg,
    getActivity: activityService.getActivity,
    getById: dataService.getDataById,
    getTimesheet: dataService.getTimesheetByPeriodAndTeacher,
    addData: dataService.addData,
    updateData: dataService.updateData,
    deleteData: dataService.deleteData,
    purgeRepo: schoolRepositories.timesheets.maintenancePurgeById,
    prepare: timesheetImportLifecycleService.prepareImportTargetPayload,
    finalize: timesheetImportLifecycleService.finalizeImportTargetAfterSave,
    unlock: schoolDependencyService.unlockSourcesForTimesheet,
    revert: timesheetManualMaterializationService.revertMaterializedRecordsForTimesheet,
    resolveTask: taskService.resolveTimesheetTask
  };

  const created = [];
  let addCounter = 0;

  timesheetImportPolicyModel.getPolicyForOrg = async () => POLICY;
  activityService.getActivity = async () => ACTIVITY;
  dataService.getDataById = async (entityType, id) => {
    if (entityType === 'timesheetPeriods') {
      return periods[id] || {
        id,
        orgId: 'ORG_1',
        name: id,
        startDate: '2026-03-01',
        endDate: '2026-03-15',
        status: 'open'
      };
    }
    if (entityType === 'timesheets') {
      return created.find((row) => row.id === id) || null;
    }
    return null;
  };
  dataService.getTimesheetByPeriodAndTeacher = async (periodId) => existingByPeriod[periodId] || null;
  dataService.addData = async (entityType, payload) => {
    if (entityType !== 'timesheets') return payload;
    addCounter += 1;
    if (addShouldFailOnPeriod && payload.periodId === addShouldFailOnPeriod) {
      throw new Error(`Simulated failure for ${addShouldFailOnPeriod}`);
    }
    const saved = { ...payload, id: `TS_${addCounter}` };
    created.push(saved);
    return saved;
  };
  dataService.updateData = async () => {
    throw new Error('updateData should not be called during create-only legacy import apply');
  };
  dataService.deleteData = async (entityType, id) => {
    const index = created.findIndex((row) => row.id === id);
    if (index >= 0) created.splice(index, 1);
    return { entityType, id };
  };
  schoolRepositories.timesheets.maintenancePurgeById = async (id) => {
    const index = created.findIndex((row) => row.id === id);
    if (index >= 0) created.splice(index, 1);
    return { id };
  };
  timesheetImportLifecycleService.prepareImportTargetPayload = ({ basePayload }) => ({
    payload: basePayload,
    requiresPostSaveFinalization: false,
    appliedStatus: 'draft'
  });
  timesheetImportLifecycleService.finalizeImportTargetAfterSave = async ({ savedTimesheet }) => savedTimesheet;
  schoolDependencyService.unlockSourcesForTimesheet = async () => ({ unlocked: true });
  timesheetManualMaterializationService.revertMaterializedRecordsForTimesheet = async () => ({ reverted: true });
  taskService.resolveTimesheetTask = async () => null;

  return {
    getCreated: () => [...created],
    restore: () => {
      timesheetImportPolicyModel.getPolicyForOrg = originals.getPolicy;
      activityService.getActivity = originals.getActivity;
      dataService.getDataById = originals.getById;
      dataService.getTimesheetByPeriodAndTeacher = originals.getTimesheet;
      dataService.addData = originals.addData;
      dataService.updateData = originals.updateData;
      dataService.deleteData = originals.deleteData;
      schoolRepositories.timesheets.maintenancePurgeById = originals.purgeRepo;
      timesheetImportLifecycleService.prepareImportTargetPayload = originals.prepare;
      timesheetImportLifecycleService.finalizeImportTargetAfterSave = originals.finalize;
      schoolDependencyService.unlockSourcesForTimesheet = originals.unlock;
      timesheetManualMaterializationService.revertMaterializedRecordsForTimesheet = originals.revert;
      taskService.resolveTimesheetTask = originals.resolveTask;
    }
  };
}

function stubLegacyImportDeleteDeps({
  existingByPeriod = {},
  policy = POLICY,
  periods = {},
  activity = ACTIVITY
} = {}) {
  const originals = {
    getPolicy: timesheetImportPolicyModel.getPolicyForOrg,
    getById: dataService.getDataById,
    getTimesheet: dataService.getTimesheetByPeriodAndTeacher,
    updateData: dataService.updateData,
    purgeRepo: schoolRepositories.timesheets.maintenancePurgeById,
    unlock: schoolDependencyService.unlockSourcesForTimesheet,
    revert: timesheetManualMaterializationService.revertMaterializedRecordsForTimesheet,
    revertEntry: timesheetManualMaterializationService.revertMaterializedActivityManualEntry,
    removeBatch: timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByBatchId,
    removeEntryIds: timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByEntryIds,
    removeTarget: timesheetImportWorkSessionBuilderService.removeImportWorkSessionsForTarget,
    removeTracked: timesheetImportWorkSessionBuilderService.removeTrackedImportWorkSessionsForPersonPeriod
  };
  const store = Object.fromEntries(
    Object.entries(existingByPeriod).map(([periodId, row]) => [periodId, { ...row }])
  );
  const activityUpdates = [];
  const batchRemovals = [];
  const entryIdRemovals = [];
  const targetRemovals = [];
  const trackedRemovals = [];

  timesheetImportPolicyModel.getPolicyForOrg = async () => policy;
  dataService.getDataById = async (entityType, id) => {
    if (entityType === 'timesheetPeriods') {
      return periods[id] || {
        id,
        orgId: 'ORG_1',
        name: id,
        startDate: '2026-03-01',
        endDate: '2026-03-15',
        status: 'open'
      };
    }
    if (entityType === 'activities') {
      return { ...activity, id: id || activity.id, entries: Array.isArray(activity.entries) ? activity.entries : [] };
    }
    return null;
  };
  dataService.getTimesheetByPeriodAndTeacher = async (periodId) => {
    const row = store[periodId];
    return row ? { ...row, entries: Array.isArray(row.entries) ? [...row.entries] : [] } : null;
  };
  dataService.updateData = async (entityType, id, payload) => {
    if (entityType === 'activities') {
      activityUpdates.push({ id, payload });
      return payload;
    }
    if (entityType !== 'timesheets') return payload;
    const saved = { ...payload, id: String(id ?? '').trim() || payload.id };
    store[saved.periodId] = saved;
    return saved;
  };
  schoolDependencyService.unlockSourcesForTimesheet = async () => ({ unlocked: true });
  timesheetManualMaterializationService.revertMaterializedRecordsForTimesheet = async () => ({ reverted: true });
  timesheetManualMaterializationService.revertMaterializedActivityManualEntry = async () => ({ reverted: true });
  timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByBatchId = async (args) => {
    batchRemovals.push(args);
    return {
      removedEntries: 2,
      removedAssignees: 0
    };
  };
  timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByEntryIds = async (args) => {
    entryIdRemovals.push(args);
    return {
      removedEntries: Array.isArray(args?.entryIds) ? args.entryIds.length : 0,
      removedAssignees: 0
    };
  };
  timesheetImportWorkSessionBuilderService.removeImportWorkSessionsForTarget = async (args) => {
    targetRemovals.push(args);
    return {
      removedEntries: 1,
      removedAssignees: 0
    };
  };
  timesheetImportWorkSessionBuilderService.removeTrackedImportWorkSessionsForPersonPeriod = async (args) => {
    trackedRemovals.push(args);
    return {
      removedEntries: 1,
      scannedActivities: 1,
      cleanedActivities: [{ activityId: args?.importActivityId || 'ACT_IMPORT', removedEntries: 1 }]
    };
  };
  dataService.deleteData = async (entityType, id) => {
    if (entityType !== 'timesheets') return { entityType, id };
    Object.keys(store).forEach((periodId) => {
      if (store[periodId]?.id === id) delete store[periodId];
    });
    return { entityType, id };
  };
  schoolRepositories.timesheets.maintenancePurgeById = async (id) => {
    Object.keys(store).forEach((periodId) => {
      if (store[periodId]?.id === id) delete store[periodId];
    });
    return { id };
  };

  return {
    getStore: () => ({ ...store }),
    getActivityUpdates: () => [...activityUpdates],
    getBatchRemovals: () => [...batchRemovals],
    getEntryIdRemovals: () => [...entryIdRemovals],
    getTargetRemovals: () => [...targetRemovals],
    getTrackedRemovals: () => [...trackedRemovals],
    restore: () => {
      timesheetImportPolicyModel.getPolicyForOrg = originals.getPolicy;
      dataService.getDataById = originals.getById;
      dataService.getTimesheetByPeriodAndTeacher = originals.getTimesheet;
      dataService.updateData = originals.updateData;
      schoolRepositories.timesheets.maintenancePurgeById = originals.purgeRepo;
      schoolDependencyService.unlockSourcesForTimesheet = originals.unlock;
      timesheetManualMaterializationService.revertMaterializedRecordsForTimesheet = originals.revert;
      timesheetManualMaterializationService.revertMaterializedActivityManualEntry = originals.revertEntry;
      timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByBatchId = originals.removeBatch;
      timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByEntryIds = originals.removeEntryIds;
      timesheetImportWorkSessionBuilderService.removeImportWorkSessionsForTarget = originals.removeTarget;
      timesheetImportWorkSessionBuilderService.removeTrackedImportWorkSessionsForPersonPeriod = originals.removeTracked;
    }
  };
}

test('sanitizeLegacyImport persists activity-first import trace metadata', () => {
  const sanitized = sanitizeLegacyImport({
    activityId: 'ACT_IMPORT',
    sourceFileName: 'january.xlsx',
    importedAt: '2026-01-01T00:00:00.000Z',
    importedBy: 'USER_1',
    rowCount: 5,
    matchedPeriodId: 'PER_A',
    executionMode: 'activity_first',
    legacyImportBatchId: 'BATCH_1',
    workSessionEntryIds: ['ENT-ACT_IMPORT-0001', 'ENT-ACT_IMPORT-0002']
  });
  assert.equal(sanitized.executionMode, 'activity_first');
  assert.equal(sanitized.legacyImportBatchId, 'BATCH_1');
  assert.deepEqual(sanitized.workSessionEntryIds, ['ENT-ACT_IMPORT-0001', 'ENT-ACT_IMPORT-0002']);

  const payload = sanitizeTimesheetPayload({
    orgId: 'ORG_1',
    periodId: 'PER_A',
    teacherId: 'PERSON_1',
    status: 'processed',
    entries: [],
    legacyImport: sanitized
  });
  assert.equal(payload.legacyImport.legacyImportBatchId, 'BATCH_1');
  assert.deepEqual(payload.legacyImport.workSessionEntryIds, ['ENT-ACT_IMPORT-0001', 'ENT-ACT_IMPORT-0002']);
});

test('buildExistingTimesheetSkipDescriptor includes status and legacy filename', () => {
  const skip = timesheetLegacyImportService.buildExistingTimesheetSkipDescriptor(
    {
      id: 'TS_1',
      status: 'draft',
      periodId: 'PER_A',
      legacyImport: { sourceFileName: 'march.xlsx' }
    },
    { id: 'PER_A', name: '2026-MAR-01' }
  );
  assert.equal(skip.periodId, 'PER_A');
  assert.equal(skip.timesheetId, 'TS_1');
  assert.equal(skip.legacyImportFileName, 'march.xlsx');
  assert.match(skip.message, /Delete the imported file \(march\.xlsx\)/);
});

test('resolveImportOutcomeStatus maps applied and skipped combinations', () => {
  assert.equal(timesheetLegacyImportService.resolveImportOutcomeStatus([{ periodId: 'A' }], []), 'success');
  assert.equal(timesheetLegacyImportService.resolveImportOutcomeStatus([], [{ periodId: 'A' }]), 'partial');
  assert.equal(
    timesheetLegacyImportService.resolveImportOutcomeStatus([{ periodId: 'A' }], [{ periodId: 'B' }]),
    'success'
  );
});

test('buildImportOutcomeMessage summarizes skipped and applied periods', () => {
  const mixed = timesheetLegacyImportService.buildImportOutcomeMessage({
    applied: [{ rowCount: 2 }],
    skipped: [{ periodId: 'PER_B' }],
    totalRows: 2
  });
  assert.match(mixed, /Imported 2 row\(s\) across 1 period\(s\)/);
  assert.match(mixed, /1 period\(s\) were skipped/);

  const allSkipped = timesheetLegacyImportService.buildImportOutcomeMessage({
    applied: [],
    skipped: [{ periodId: 'PER_A' }, { periodId: 'PER_B' }],
    totalRows: 0
  });
  assert.match(allSkipped, /No timesheets were imported/);
  assert.match(allSkipped, /2 period\(s\) already have a timesheet/);
});

test('applyLegacyImports skips periods that already have a timesheet', async () => {
  const stub = stubLegacyImportApplyDeps({
    existingByPeriod: {
      PER_B: { id: 'TS_EXISTING', status: 'draft', periodId: 'PER_B' }
    }
  });
  try {
    const outcome = await timesheetLegacyImportService.applyLegacyImports({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      compileResults: [
        compileOkResult('PER_A'),
        compileOkResult('PER_B')
      ],
      reqUser: REQ_USER,
      scope: timesheetLegacyImportService.IMPORT_SCOPES.MANAGEMENT
    });
    assert.equal(outcome.responseStatus, 'success');
    assert.equal(outcome.applied.length, 1);
    assert.equal(outcome.applied[0].periodId, 'PER_A');
    assert.equal(outcome.skipped.length, 1);
    assert.equal(outcome.skipped[0].periodId, 'PER_B');
    assert.equal(stub.getCreated().length, 1);
  } finally {
    stub.restore();
  }
});

test('applyLegacyImports returns partial when every matched period is skipped', async () => {
  const stub = stubLegacyImportApplyDeps({
    existingByPeriod: {
      PER_A: { id: 'TS_EXISTING', status: 'draft', periodId: 'PER_A' }
    }
  });
  try {
    const outcome = await timesheetLegacyImportService.applyLegacyImports({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      compileResults: [compileOkResult('PER_A')],
      reqUser: REQ_USER,
      scope: timesheetLegacyImportService.IMPORT_SCOPES.MANAGEMENT
    });
    assert.equal(outcome.responseStatus, 'partial');
    assert.equal(outcome.applied.length, 0);
    assert.equal(outcome.skipped.length, 1);
    assert.equal(stub.getCreated().length, 0);
  } finally {
    stub.restore();
  }
});

test('applyLegacyImports rolls back earlier periods when a later apply fails', async () => {
  const stub = stubLegacyImportApplyDeps({
    addShouldFailOnPeriod: 'PER_B'
  });
  try {
    await assert.rejects(
      () => timesheetLegacyImportService.applyLegacyImports({
        orgId: 'ORG_1',
        personId: 'PERSON_1',
        compileResults: [
          compileOkResult('PER_A'),
          compileOkResult('PER_B')
        ],
        reqUser: REQ_USER,
        scope: timesheetLegacyImportService.IMPORT_SCOPES.MANAGEMENT
      }),
      (error) => {
        assert.match(error.message, /rolled back/i);
        assert.equal(Array.isArray(error.rolledBack), true);
        assert.equal(error.rolledBack.length, 1);
        assert.equal(error.rolledBack[0].periodId, 'PER_A');
        return true;
      }
    );
    assert.equal(stub.getCreated().length, 0);
  } finally {
    stub.restore();
  }
});

test('buildLegacyImportEntries maps compiled rows to activity-linked legacy entries', () => {
  const rows = timesheetLegacyImportService.buildLegacyImportEntries({
    compiledRows: [{
      date: '2026-03-01',
      className: 'Math 10',
      hours: 2.5,
      comment: 'Legacy row'
    }],
    activity: {
      id: 'ACT_IMPORT',
      title: 'Legacy Import Activity',
      departmentId: 'DEPT_1',
      departmentName: 'Academics',
      categoryName: 'Teaching',
      visibilityScope: 'school'
    },
    personId: 'PERSON_1',
    periodId: 'PERIOD_1'
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].activityId, 'ACT_IMPORT');
  assert.equal(rows[0].isLegacyImport, true);
  assert.equal(rows[0].isSchoolActivity, true);
  assert.match(rows[0].sessionId, /^legacyimp-PERIOD_1-PERSON_1-/);
  assert.equal(rows[0].hours, 2.5);
});

test('buildLegacyImportEntries maps optional-only rows to billable hours with optional comment', () => {
  const rows = timesheetLegacyImportService.buildLegacyImportEntries({
    compiledRows: [{
      date: '2026-03-01',
      className: 'ELA One on One',
      hours: 0,
      optionalHours: 1.5,
      studentName: 'Student A'
    }],
    activity: {
      id: 'ACT_IMPORT',
      title: 'Legacy Import Activity',
      departmentId: 'DEPT_1',
      departmentName: 'Academics',
      categoryName: 'Teaching',
      visibilityScope: 'school'
    },
    personId: 'PERSON_1',
    periodId: 'PERIOD_1'
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].hours, 1.5);
  assert.equal(rows[0].timesheetHours, 1.5);
  assert.match(rows[0].comment, /This hour was optional \(1\.5 hrs\)/);
  assert.match(rows[0].comment, /Student: Student A/);
});

test('strip legacy import entries via isLegacyImportEntry helper', () => {
  assert.equal(timesheetLegacyImportService.isLegacyImportEntry({ isLegacyImport: true }), true);
  assert.equal(timesheetLegacyImportService.isLegacyImportEntry({ sessionId: 'legacyimp-1-2-3' }), true);
  assert.equal(timesheetLegacyImportService.isLegacyImportEntry({ sessionId: 'sess-1' }), false);
});

test('groupCompileResultsByPeriod filters to selected period', () => {
  const grouped = timesheetLegacyImportService.groupCompileResultsByPeriod([
    { status: 'ok', matchedPeriod: { id: 'PER_A' }, rows: [{ date: '2026-01-01', hours: 1, className: 'A' }] },
    { status: 'ok', matchedPeriod: { id: 'PER_B' }, rows: [{ date: '2026-01-02', hours: 2, className: 'B' }] }
  ], 'PER_B');
  assert.equal(grouped.size, 1);
  assert.ok(grouped.has('PER_B'));
});

test('timesheet editor merge includes legacy import entries in active grid', () => {
  const editor = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../MVC/views/school/timesheet/timesheetEditor.ejs'),
    'utf8'
  );
  assert.match(editor, /isLegacyImportEntry\(e\)/);
  assert.match(editor, /isManual \|\| e\.isPriorPeriodAdjustment \|\| isLegacyImportEntry\(e\)/);
});

test('effective entry service includes stored legacy import rows', () => {
  const effective = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../MVC/services/school/timesheetEffectiveEntryService.js'),
    'utf8'
  );
  assert.match(effective, /legacyImportEntries/);
  assert.match(effective, /timesheetLegacyImportService\.isLegacyImportEntry/);
});

test('legacy import apply resolves scoped target status and lifecycle wiring', () => {
  const legacy = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../MVC/services/school/timesheetLegacyImportService.js'),
    'utf8'
  );
  assert.match(legacy, /resolveImportTargetStatusForScope\(policy, scope\)/);
  assert.match(legacy, /timesheetImportLifecycleService\.prepareImportTargetPayload/);
  assert.match(legacy, /timesheetImportLifecycleService\.finalizeImportTargetAfterSave/);
  assert.match(legacy, /detectExistingTimesheetForImport/);
  assert.match(legacy, /rollbackAppliedLegacyImports/);
  assert.match(legacy, /responseStatus/);
});

test('timesheet manage and list views handle skipped and rollback import responses', () => {
  const manageView = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/timesheet/timesheetManage.ejs'), 'utf8');
  const listView = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/timesheet/timesheetList.ejs'), 'utf8');
  assert.match(manageView, /renderImportSkippedSummary/);
  assert.match(manageView, /showImportApplyResultMessage/);
  assert.match(manageView, /renderImportRollbackSummary/);
  assert.match(listView, /renderImportSkippedSummary/);
  assert.match(listView, /showImportApplyResultMessage/);
});

test('listMyTimesheets passes admin legacy delete flag to timesheet list view', () => {
  const controller = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/controllers/school/timesheetController.js'),
    'utf8'
  );
  const listView = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/timesheet/timesheetList.ejs'), 'utf8');
  assert.match(controller, /canDeleteMyTimesheetLegacyImport = await isTimesheetSectionAdmin\(req\.user, OPERATIONS\.DELETE\)/);
  assert.match(controller, /canDeleteMyTimesheetLegacyImport,/);
  assert.match(controller, /skipImportPolicyCheck: canAdminDelete/);
  assert.match(controller, /deleteMyTimesheetLegacyImport[\s\S]*?operationId: OPERATIONS\.DELETE/);
  assert.match(listView, /canDeleteImportedTimesheet/);
  assert.match(listView, /canDeleteMyTimesheetLegacyImport/);
  assert.match(listView, /data-period-id="/);
  assert.match(listView, /params\.set\('teacherId', resolvedTeacherId\)/);
  assert.match(listView, /beginLegacyDeleteLoading/);
  assert.match(listView, /Removing Imported Timesheet/);
});

test('timesheet list view keeps legacy delete handlers outside import-only script guard', () => {
  const listView = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/timesheet/timesheetList.ejs'), 'utf8');
  const scriptStart = listView.indexOf('<script>');
  const scriptBlock = listView.slice(scriptStart);
  const importGuardIndex = scriptBlock.indexOf('<% if (typeof canImportMyTimesheets !== \'undefined\' && canImportMyTimesheets) { %>');
  const deleteHandlerIndex = scriptBlock.indexOf('function deleteMyLegacyImport');
  const rowPatchIndex = scriptBlock.indexOf('function applyMyTimesheetRowAfterLegacyDelete');
  assert.ok(importGuardIndex >= 0);
  assert.ok(deleteHandlerIndex >= 0 && deleteHandlerIndex < importGuardIndex);
  assert.ok(rowPatchIndex >= 0 && rowPatchIndex < importGuardIndex);
  const deleteFn = scriptBlock.slice(deleteHandlerIndex, scriptBlock.indexOf('document.addEventListener(\'click\', (event) => {', deleteHandlerIndex));
  assert.match(deleteFn, /applyMyTimesheetRowAfterLegacyDelete/);
  assert.doesNotMatch(deleteFn, /window\.location\.reload\(\)/);
});

test('deleteLegacyImport honors skipImportPolicyCheck for admin delete override', async () => {
  const disabledPolicy = { ...POLICY, allowImportInMyTimesheets: false };
  const stub = stubLegacyImportDeleteDeps({
    policy: disabledPolicy,
    existingByPeriod: {
      PER_A: {
        id: 'TS_LEGACY',
        orgId: 'ORG_1',
        periodId: 'PER_A',
        personId: 'PERSON_1',
        teacherId: 'PERSON_1',
        status: 'draft',
        entries: [{ isLegacyImport: true, hours: 4, sessionId: 'legacyimp-PER_A-PERSON_1-1' }],
        legacyImport: { sourceFileName: 'march.xlsx', importedAt: '2026-03-01' },
        totalHours: 4
      }
    }
  });
  try {
    await assert.rejects(
      () => timesheetLegacyImportService.deleteLegacyImport({
        orgId: 'ORG_1',
        personId: 'PERSON_1',
        periodId: 'PER_A',
        reqUser: REQ_USER,
        scope: timesheetLegacyImportService.IMPORT_SCOPES.MY_TIMESHEETS,
        skipImportPolicyCheck: false
      }),
      (error) => error.statusCode === 403
    );

    const outcome = await timesheetLegacyImportService.deleteLegacyImport({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      reqUser: REQ_USER,
      scope: timesheetLegacyImportService.IMPORT_SCOPES.MY_TIMESHEETS,
      skipImportPolicyCheck: true
    });
    assert.equal(outcome.hadLegacyImport, true);
    assert.equal(outcome.hasLegacyImport, false);
    assert.equal(outcome.periodId, 'PER_A');
    assert.equal(outcome.totalHours, 0);
    assert.equal(outcome.tsStatus, 'not_started');
  } finally {
    stub.restore();
  }
});

test('deleteLegacyImport returns row refresh payload after removing legacy rows', async () => {
  const stub = stubLegacyImportDeleteDeps({
    existingByPeriod: {
      PER_A: {
        id: 'TS_LEGACY',
        orgId: 'ORG_1',
        periodId: 'PER_A',
        personId: 'PERSON_1',
        teacherId: 'PERSON_1',
        status: 'draft',
        entries: [
          { isLegacyImport: true, hours: 4, sessionId: 'legacyimp-PER_A-PERSON_1-1' },
          { sessionId: 'sess-manual', hours: 1.5 }
        ],
        legacyImport: { sourceFileName: 'march.xlsx', importedAt: '2026-03-01' },
        totalHours: 5.5
      }
    }
  });
  try {
    const outcome = await timesheetLegacyImportService.deleteLegacyImport({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      reqUser: REQ_USER,
      scope: timesheetLegacyImportService.IMPORT_SCOPES.MY_TIMESHEETS
    });
    assert.equal(outcome.removedRows, 1);
    assert.equal(outcome.hadLegacyImport, true);
    assert.equal(outcome.hasLegacyImport, false);
    assert.equal(outcome.periodId, 'PER_A');
    assert.equal(outcome.timesheetId, 'TS_LEGACY');
    assert.equal(outcome.totalHours, 1.5);
    assert.equal(outcome.tsStatus, 'draft');
    assert.equal(outcome.sourceFileName, 'march.xlsx');
  } finally {
    stub.restore();
  }
});

test('deleteLegacyImport removes legacy rows from submitted imported timesheet', async () => {
  const stub = stubLegacyImportDeleteDeps({
    existingByPeriod: {
      PER_A: {
        id: 'TS_LEGACY',
        orgId: 'ORG_1',
        periodId: 'PER_A',
        personId: 'PERSON_1',
        teacherId: 'PERSON_1',
        status: 'submitted',
        entries: [{
          isLegacyImport: true,
          hours: 4,
          sessionId: 'legacyimp-PER_A-PERSON_1-1',
          activityId: 'ACT_IMPORT'
        }],
        legacyImport: {
          activityId: 'ACT_IMPORT',
          sourceFileName: 'march.xlsx',
          importedAt: '2026-03-01'
        },
        totalHours: 4
      }
    },
    activity: {
      ...ACTIVITY,
      entries: [{
        entryId: 'ENTRY_1',
        assignees: [{
          personId: 'PERSON_1',
          materializedFromTimesheetId: 'TS_LEGACY',
          materializedFromTimesheetEntryId: 'legacyimp-PER_A-PERSON_1-1'
        }]
      }]
    }
  });
  try {
    const outcome = await timesheetLegacyImportService.deleteLegacyImport({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      reqUser: REQ_USER,
      scope: timesheetLegacyImportService.IMPORT_SCOPES.MY_TIMESHEETS
    });
    assert.equal(outcome.hadLegacyImport, true);
    assert.equal(outcome.hasLegacyImport, false);
    assert.equal(outcome.removedRows, 1);
    assert.equal(outcome.tsStatus, 'not_started');
    assert.equal(outcome.totalHours, 0);
    assert.equal(stub.getActivityUpdates().length, 1);
  } finally {
    stub.restore();
  }
});

test('deleteLegacyImport removes activity-first imported timesheet and work sessions by batch id', async () => {
  const stub = stubLegacyImportDeleteDeps({
    existingByPeriod: {
      PER_A: {
        id: 'TS_IMPORTED',
        orgId: 'ORG_1',
        periodId: 'PER_A',
        personId: 'PERSON_1',
        teacherId: 'PERSON_1',
        status: 'processed',
        entries: [
          { sessionId: 'act-ACT_IMPORT-ENT-1-PERSON_1', hours: 2 },
          { sessionId: 'stat-holiday-2026-03-10', hours: 8 }
        ],
        legacyImport: {
          sourceFileName: 'march.xlsx',
          importedAt: '2026-03-01',
          activityId: 'ACT_IMPORT',
          legacyImportBatchId: 'BATCH_1',
          executionMode: 'activity_first'
        },
        totalHours: 10
      }
    }
  });
  try {
    const outcome = await timesheetLegacyImportService.deleteLegacyImport({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      reqUser: REQ_USER,
      scope: timesheetLegacyImportService.IMPORT_SCOPES.MANAGEMENT
    });
    assert.equal(outcome.deletedTimesheet, true);
    assert.equal(outcome.timesheetId, '');
    assert.equal(outcome.tsStatus, 'not_started');
    assert.equal(outcome.importWorkSessionCleanup?.removedEntries >= 2, true);
    assert.deepEqual(stub.getBatchRemovals()[0], {
      activityId: 'ACT_IMPORT',
      batchId: 'BATCH_1',
      reqUser: REQ_USER
    });
    assert.equal(stub.getStore().PER_A, undefined);
  } finally {
    stub.restore();
  }
});

test('deleteLegacyImport removes activity-first imported timesheet without batch metadata using fallback cleanup', async () => {
  const stub = stubLegacyImportDeleteDeps({
    existingByPeriod: {
      PER_A: {
        id: 'TS_IMPORTED_NO_BATCH',
        orgId: 'ORG_1',
        periodId: 'PER_A',
        personId: 'PERSON_1',
        teacherId: 'PERSON_1',
        status: 'processed',
        entries: [
          { sessionId: 'act-ACT_IMPORT-ENT-1-PERSON_1', hours: 2 },
          { sessionId: 'stat-holiday-2026-03-10', hours: 8 }
        ],
        legacyImport: {
          sourceFileName: 'august.xlsx',
          importedAt: '2026-08-01',
          activityId: 'ACT_IMPORT'
        },
        totalHours: 10
      }
    }
  });
  try {
    assert.equal(
      timesheetLegacyImportService.isActivityFirstLegacyImport(stub.getStore().PER_A),
      true
    );
    const outcome = await timesheetLegacyImportService.deleteLegacyImport({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      reqUser: REQ_USER,
      scope: timesheetLegacyImportService.IMPORT_SCOPES.MANAGEMENT
    });
    assert.equal(outcome.deletedTimesheet, true);
    assert.equal(outcome.timesheetId, '');
    assert.equal(outcome.tsStatus, 'not_started');
    assert.equal(outcome.hasLegacyImport, false);
    assert.equal(stub.getStore().PER_A, undefined);
    assert.equal(stub.getBatchRemovals().length, 0);
    assert.equal(stub.getTargetRemovals().length, 1);
    assert.equal(stub.getTrackedRemovals().length, 1);
    assert.ok(outcome.importWorkSessionCleanup);
    assert.ok(outcome.importWorkSessionCleanup.removedEntries >= 2);
  } finally {
    stub.restore();
  }
});

test('deleteLegacyImport removes activity-first work sessions by stored entry ids', async () => {
  const stub = stubLegacyImportDeleteDeps({
    existingByPeriod: {
      PER_A: {
        id: 'TS_IMPORTED_ENTRY_IDS',
        orgId: 'ORG_1',
        periodId: 'PER_A',
        personId: 'PERSON_1',
        teacherId: 'PERSON_1',
        status: 'processed',
        entries: [
          { sessionId: 'act-ACT_IMPORT-ENT-1-PERSON_1', hours: 2 },
          { sessionId: 'act-ACT_IMPORT-ENT-2-PERSON_1', hours: 3 }
        ],
        legacyImport: {
          sourceFileName: 'august.xlsx',
          importedAt: '2026-08-01',
          activityId: 'ACT_IMPORT',
          executionMode: 'activity_first',
          workSessionEntryIds: ['ENT-1', 'ENT-2']
        },
        totalHours: 5
      }
    }
  });
  try {
    const outcome = await timesheetLegacyImportService.deleteLegacyImport({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      reqUser: REQ_USER,
      scope: timesheetLegacyImportService.IMPORT_SCOPES.MANAGEMENT
    });
    assert.equal(outcome.deletedTimesheet, true);
    assert.equal(stub.getEntryIdRemovals().length, 1);
    assert.deepEqual(stub.getEntryIdRemovals()[0], {
      activityId: 'ACT_IMPORT',
      entryIds: ['ENT-1', 'ENT-2'],
      reqUser: REQ_USER
    });
  } finally {
    stub.restore();
  }
});

test('buildLegacyImportDeleteMessage reports work session cleanup counts', () => {
  assert.match(timesheetLegacyImportService.buildLegacyImportDeleteMessage({
    deletedTimesheet: true,
    importWorkSessionCleanup: { removedEntries: 3 }
  }), /3 import work sessions removed/);
  assert.match(timesheetLegacyImportService.buildLegacyImportDeleteMessage({
    timesheetAlreadyRemoved: true,
    importWorkSessionCleanup: { removedEntries: 2 }
  }), /already removed/);
});

test('deleteLegacyImport recovers orphan import work sessions when timesheet is already gone', async () => {
  const activityStore = {
    id: 'ACT_IMPORT',
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    evaluationType: 'attendance',
    title: 'Historical Timesheet Import 2026',
    entries: [
      {
        entryId: 'ENT-1',
        date: '2026-01-09',
        legacyImportPersonId: 'PERSON_1',
        legacyImportPeriodId: 'PER_A',
        assignees: [{ personId: 'PERSON_1', status: 'attended', paid: true, paidHours: 6 }]
      },
      {
        entryId: 'ENT-2',
        date: '2026-01-10',
        legacyImportPersonId: 'PERSON_2',
        legacyImportPeriodId: 'PER_A',
        assignees: [{ personId: 'PERSON_2', status: 'attended', paid: true, paidHours: 3 }]
      }
    ]
  };
  const originals = {
    getPolicy: timesheetImportPolicyModel.getPolicyForOrg,
    getById: dataService.getDataById,
    getTimesheet: dataService.getTimesheetByPeriodAndTeacher,
    getActivity: activityService.getActivity,
    updateData: dataService.updateData,
    listActivities: activityService.listActivities
  };

  timesheetImportPolicyModel.getPolicyForOrg = async () => POLICY;
  dataService.getDataById = async (entityType, id) => {
    if (entityType === 'timesheetPeriods') {
      return {
        id,
        orgId: 'ORG_1',
        name: id,
        startDate: '2026-01-01',
        endDate: '2026-01-15',
        status: 'open'
      };
    }
    return null;
  };
  dataService.getTimesheetByPeriodAndTeacher = async () => null;
  dataService.updateData = async (entityType, id, payload) => {
    if (entityType === 'activities') {
      activityStore.entries = payload.entries;
      activityStore.locked = payload.locked;
      return payload;
    }
    return payload;
  };
  activityService.getActivity = async () => ({
    ...activityStore,
    entries: activityStore.entries.map((entry) => ({ ...entry, assignees: entry.assignees.map((row) => ({ ...row })) }))
  });
  activityService.listActivities = async () => [{
    ...activityStore,
    entries: activityStore.entries.map((entry) => ({ ...entry, assignees: entry.assignees.map((row) => ({ ...row })) }))
  }];

  try {
    const outcome = await timesheetLegacyImportService.deleteLegacyImport({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      reqUser: REQ_USER,
      scope: timesheetLegacyImportService.IMPORT_SCOPES.MANAGEMENT
    });
    assert.equal(outcome.hadLegacyImport, true);
    assert.equal(outcome.timesheetAlreadyRemoved, true);
    assert.equal(outcome.importWorkSessionCleanup?.removedEntries, 1);
    assert.equal(activityStore.entries.length, 1);
    assert.equal(activityStore.entries[0].entryId, 'ENT-2');
  } finally {
    timesheetImportPolicyModel.getPolicyForOrg = originals.getPolicy;
    dataService.getDataById = originals.getById;
    dataService.getTimesheetByPeriodAndTeacher = originals.getTimesheet;
    dataService.updateData = originals.updateData;
    activityService.getActivity = originals.getActivity;
    activityService.listActivities = originals.listActivities;
  }
});

test('deleteLegacyImport removes locked import-stamped work sessions after unlock', async () => {
  const realRemovers = {
    removeBatch: timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByBatchId,
    removeEntryIds: timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByEntryIds,
    removeTarget: timesheetImportWorkSessionBuilderService.removeImportWorkSessionsForTarget,
    removeTracked: timesheetImportWorkSessionBuilderService.removeTrackedImportWorkSessionsForPersonPeriod
  };
  const activityStore = {
    id: 'ACT_IMPORT',
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    evaluationType: 'attendance',
    title: 'Historical Timesheet Import 2026',
    locked: true,
    lockReason: 'timesheet_approved',
    lockedTimesheetId: 'TS_IMPORTED',
    entries: [
      {
        entryId: 'ENT-1',
        date: '2026-03-01',
        legacyImportPersonId: 'PERSON_1',
        legacyImportPeriodId: 'PER_A',
        legacyImportBatchId: 'BATCH_1',
        locked: true,
        lockReason: 'timesheet_approved',
        lockedTimesheetId: 'TS_IMPORTED',
        assignees: [{
          personId: 'PERSON_1',
          status: 'attended',
          paid: true,
          paidHours: 6,
          legacyImportBatchId: 'BATCH_1',
          locked: true,
          lockReason: 'timesheet_approved',
          lockedTimesheetId: 'TS_IMPORTED'
        }]
      }
    ]
  };
  const stub = stubLegacyImportDeleteDeps({
    existingByPeriod: {
      PER_A: {
        id: 'TS_IMPORTED',
        orgId: 'ORG_1',
        periodId: 'PER_A',
        teacherId: 'PERSON_1',
        status: 'processed',
        entries: [{ sessionId: 'act-ACT_IMPORT-ENT-1-PERSON_1', hours: 6 }],
        legacyImport: {
          sourceFileName: 'march.xlsx',
          importedAt: '2026-03-01',
          activityId: 'ACT_IMPORT',
          legacyImportBatchId: 'BATCH_1',
          executionMode: 'activity_first'
        },
        totalHours: 6
      }
    },
    periods: {
      PER_A: {
        id: 'PER_A',
        orgId: 'ORG_1',
        name: 'PER_A',
        startDate: '2026-03-01',
        endDate: '2026-03-15',
        status: 'open'
      }
    }
  });
  const originals = {
    getActivity: activityService.getActivity,
    updateData: dataService.updateData,
    listActivities: activityService.listActivities
  };

  activityService.getActivity = async () => ({
    ...activityStore,
    entries: activityStore.entries.map((entry) => ({
      ...entry,
      assignees: entry.assignees.map((row) => ({ ...row }))
    }))
  });
  dataService.updateData = async (entityType, id, payload) => {
    if (entityType === 'activities') {
      activityStore.entries = payload.entries;
      activityStore.locked = payload.locked;
      delete activityStore.lockReason;
      delete activityStore.lockedTimesheetId;
      return payload;
    }
    return payload;
  };
  activityService.listActivities = async () => [{
    ...activityStore,
    entries: activityStore.entries.map((entry) => ({
      ...entry,
      assignees: entry.assignees.map((row) => ({ ...row }))
    }))
  }];
  timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByBatchId = realRemovers.removeBatch;
  timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByEntryIds = realRemovers.removeEntryIds;
  timesheetImportWorkSessionBuilderService.removeImportWorkSessionsForTarget = realRemovers.removeTarget;
  timesheetImportWorkSessionBuilderService.removeTrackedImportWorkSessionsForPersonPeriod = realRemovers.removeTracked;

  try {
    const outcome = await timesheetLegacyImportService.deleteLegacyImport({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      reqUser: REQ_USER,
      scope: timesheetLegacyImportService.IMPORT_SCOPES.MANAGEMENT
    });
    assert.equal(outcome.deletedTimesheet, true);
    assert.equal(activityStore.entries.length, 0);
    assert.equal(outcome.importWorkSessionCleanup?.removedEntries >= 1, true);
  } finally {
    activityService.getActivity = originals.getActivity;
    dataService.updateData = originals.updateData;
    activityService.listActivities = originals.listActivities;
    stub.restore();
  }
});

test('deleteLegacyImport recovers orphan import work sessions when activity has invalid over-24h entries', async () => {
  const realRemovers = {
    removeBatch: timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByBatchId,
    removeEntryIds: timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByEntryIds,
    removeTarget: timesheetImportWorkSessionBuilderService.removeImportWorkSessionsForTarget,
    removeTracked: timesheetImportWorkSessionBuilderService.removeTrackedImportWorkSessionsForPersonPeriod
  };
  const activityStore = {
    id: 'ACT_IMPORT',
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    evaluationType: 'attendance',
    title: 'Historical Timesheet Import 2026',
    entries: [
      {
        entryId: 'ENT-ORPHAN-30',
        date: '2026-01-15',
        durationHours: 30,
        assignees: [{ personId: 'PERSON_1', status: 'attended', paid: true, paidHours: 30 }]
      },
      {
        entryId: 'ENT-1',
        date: '2026-01-09',
        durationHours: 6,
        legacyImportPersonId: 'PERSON_1',
        legacyImportPeriodId: 'PER_A',
        assignees: [{ personId: 'PERSON_1', status: 'attended', paid: true, paidHours: 6 }]
      }
    ]
  };
  const originals = {
    getPolicy: timesheetImportPolicyModel.getPolicyForOrg,
    getById: dataService.getDataById,
    getTimesheet: dataService.getTimesheetByPeriodAndTeacher,
    getActivity: activityService.getActivity,
    updateData: dataService.updateData,
    listActivities: activityService.listActivities
  };

  timesheetImportPolicyModel.getPolicyForOrg = async () => POLICY;
  dataService.getDataById = async (entityType, id) => {
    if (entityType === 'timesheetPeriods') {
      return {
        id,
        orgId: 'ORG_1',
        name: id,
        startDate: '2026-01-01',
        endDate: '2026-01-15',
        status: 'open'
      };
    }
    return null;
  };
  dataService.getTimesheetByPeriodAndTeacher = async () => null;
  dataService.updateData = async (entityType, id, payload) => {
    if (entityType === 'activities') {
      activityStore.entries = payload.entries;
      activityStore.locked = payload.locked;
      return payload;
    }
    return payload;
  };
  activityService.getActivity = async () => ({
    ...activityStore,
    entries: activityStore.entries.map((entry) => ({ ...entry, assignees: entry.assignees.map((row) => ({ ...row })) }))
  });
  activityService.listActivities = async () => [{
    ...activityStore,
    entries: activityStore.entries.map((entry) => ({ ...entry, assignees: entry.assignees.map((row) => ({ ...row })) }))
  }];

  try {
    const outcome = await timesheetLegacyImportService.deleteLegacyImport({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodId: 'PER_A',
      reqUser: REQ_USER,
      scope: timesheetLegacyImportService.IMPORT_SCOPES.MANAGEMENT
    });
    assert.equal(outcome.hadLegacyImport, true);
    assert.ok(outcome.importWorkSessionCleanup?.removedEntries >= 1);
    assert.equal(activityStore.entries.some((entry) => entry.entryId === 'ENT-1'), false);
  } finally {
    timesheetImportPolicyModel.getPolicyForOrg = originals.getPolicy;
    dataService.getDataById = originals.getById;
    dataService.getTimesheetByPeriodAndTeacher = originals.getTimesheet;
    dataService.updateData = originals.updateData;
    activityService.getActivity = originals.getActivity;
    activityService.listActivities = originals.listActivities;
    timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByBatchId = realRemovers.removeBatch;
    timesheetImportWorkSessionBuilderService.removeImportWorkSessionsByEntryIds = realRemovers.removeEntryIds;
    timesheetImportWorkSessionBuilderService.removeImportWorkSessionsForTarget = realRemovers.removeTarget;
    timesheetImportWorkSessionBuilderService.removeTrackedImportWorkSessionsForPersonPeriod = realRemovers.removeTracked;
  }
});

test('assertTimesheetEditable still blocks submitted status for import apply', () => {
  assert.throws(
    () => timesheetLegacyImportService.assertTimesheetEditable({ status: 'submitted' }, { status: 'open' }),
    /Imported timesheets can only be applied/
  );
});

test('deleteLegacyImportsForYear deletes imported periods in year and skips non-imported periods', async () => {
  const stub = stubLegacyImportDeleteDeps({
    existingByPeriod: {
      PER_A: {
        id: 'TS_A',
        orgId: 'ORG_1',
        periodId: 'PER_A',
        personId: 'PERSON_1',
        teacherId: 'PERSON_1',
        status: 'draft',
        entries: [{ isLegacyImport: true, hours: 4, sessionId: 'legacyimp-PER_A-PERSON_1-1' }],
        legacyImport: { sourceFileName: 'jan.xlsx', importedAt: '2026-01-01' },
        totalHours: 4
      },
      PER_B: {
        id: 'TS_B',
        orgId: 'ORG_1',
        periodId: 'PER_B',
        personId: 'PERSON_1',
        teacherId: 'PERSON_1',
        status: 'draft',
        entries: [],
        totalHours: 0
      },
      PER_C: {
        id: 'TS_C',
        orgId: 'ORG_1',
        periodId: 'PER_C',
        personId: 'PERSON_1',
        teacherId: 'PERSON_1',
        status: 'draft',
        entries: [{ isLegacyImport: true, hours: 2, sessionId: 'legacyimp-PER_C-PERSON_1-1' }],
        legacyImport: { sourceFileName: 'mar.xlsx', importedAt: '2026-03-01' },
        totalHours: 2
      }
    },
    periods: {
      PER_A: { id: 'PER_A', orgId: 'ORG_1', name: 'Jan', startDate: '2026-01-01', endDate: '2026-01-15', status: 'open' },
      PER_B: { id: 'PER_B', orgId: 'ORG_1', name: 'Feb', startDate: '2026-02-01', endDate: '2026-02-15', status: 'open' },
      PER_C: { id: 'PER_C', orgId: 'ORG_1', name: 'Mar', startDate: '2026-03-01', endDate: '2026-03-15', status: 'open' },
      PER_2025: { id: 'PER_2025', orgId: 'ORG_1', name: 'Dec 2025', startDate: '2025-12-01', endDate: '2025-12-15', status: 'open' }
    }
  });
  const originalFetch = dataService.fetchData;
  dataService.fetchData = async (entityType) => {
    if (entityType === 'timesheetPeriods') {
      return [
        { id: 'PER_A', orgId: 'ORG_1', name: 'Jan', startDate: '2026-01-01', endDate: '2026-01-15', status: 'open' },
        { id: 'PER_B', orgId: 'ORG_1', name: 'Feb', startDate: '2026-02-01', endDate: '2026-02-15', status: 'open' },
        { id: 'PER_C', orgId: 'ORG_1', name: 'Mar', startDate: '2026-03-01', endDate: '2026-03-15', status: 'open' },
        { id: 'PER_2025', orgId: 'ORG_1', name: 'Dec 2025', startDate: '2025-12-01', endDate: '2025-12-15', status: 'open' }
      ];
    }
    return originalFetch(entityType);
  };
  try {
    const outcome = await timesheetLegacyImportService.deleteLegacyImportsForYear({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      year: '2026',
      reqUser: REQ_USER,
      scope: timesheetLegacyImportService.IMPORT_SCOPES.MY_TIMESHEETS,
      skipImportPolicyCheck: true
    });
    assert.equal(outcome.deletedCount, 2);
    assert.equal(outcome.results.length, 2);
    assert.deepEqual(
      outcome.results.map((row) => row.periodId).sort(),
      ['PER_A', 'PER_C']
    );
    assert.equal(outcome.failures.length, 0);
  } finally {
    dataService.fetchData = originalFetch;
    stub.restore();
  }
});

test('my timesheets list and routes expose bulk year legacy delete', () => {
  const controller = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/controllers/school/timesheetController.js'), 'utf8');
  const listView = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/timesheet/timesheetList.ejs'), 'utf8');
  const routes = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/timesheetRoutes.js'), 'utf8');
  assert.match(controller, /deleteMyTimesheetLegacyImportsForYear/);
  assert.match(controller, /deleteLegacyImportsForYear/);
  assert.match(controller, /canDeleteAllImportedTimesheets/);
  assert.match(listView, /btnDeleteAllImportedTimesheets/);
  assert.match(listView, /deleteAllImportedTimesheetsForYear/);
  assert.match(listView, /api\/import\/legacy\/year/);
  assert.match(routes, /\/api\/import\/legacy\/year/);
});
