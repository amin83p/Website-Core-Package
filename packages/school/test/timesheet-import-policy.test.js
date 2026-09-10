'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const timesheetImportPolicyService = require('../MVC/services/school/timesheetImportPolicyService');
const timesheetImportLifecycleService = require('../MVC/services/school/timesheetImportLifecycleService');

test('validatePolicyInput requires activity when import toggles are enabled', () => {
  assert.throws(
    () => timesheetImportPolicyService.validatePolicyInput({
      allowImportInTimesheetManagement: true,
      importActivityId: ''
    }),
    /legacy import activity/i
  );
});

test('validatePolicyInput accepts disabled import without activity', () => {
  const policy = timesheetImportPolicyService.validatePolicyInput({
    allowImportInTimesheetManagement: false,
    allowImportInMyTimesheets: false,
    importActivityId: ''
  });
  assert.equal(policy.importActivityId, '');
  assert.equal(policy.importTargetStatus, 'draft');
  assert.equal(policy.importBaseStartTime, '00:00');
});

test('validatePolicyInput accepts valid import base start time', () => {
  const policy = timesheetImportPolicyService.validatePolicyInput({
    importBaseStartTime: '08:30'
  });
  assert.equal(policy.importBaseStartTime, '08:30');
});

test('validatePolicyInput rejects invalid import base start time', () => {
  assert.throws(
    () => timesheetImportPolicyService.validatePolicyInput({
      importBaseStartTime: '25:00'
    }),
    /invalid import base start time/i
  );
  assert.throws(
    () => timesheetImportPolicyService.validatePolicyInput({
      importBaseStartTime: 'not-a-time'
    }),
    /invalid import base start time/i
  );
});

test('validatePolicyInput rejects unknown import target status', () => {
  assert.throws(
    () => timesheetImportPolicyService.validatePolicyInput({
      importTargetStatus: 'archived'
    }),
    /invalid imported timesheet status/i
  );
});

test('resolveImportTargetStatusForScope caps My Timesheets to draft', () => {
  const policy = {
    importTargetStatus: 'processed',
    allowImportInTimesheetManagement: true,
    allowImportInMyTimesheets: true,
    importActivityId: 'ACT_1'
  };
  assert.equal(timesheetImportPolicyService.resolveImportTargetStatusForScope(policy, 'management'), 'processed');
  assert.equal(timesheetImportPolicyService.resolveImportTargetStatusForScope(policy, 'my_timesheets'), 'draft');
});

test('isImportAllowedForScope respects page toggles', () => {
  const policy = {
    importActivityId: 'ACT_1',
    allowImportInTimesheetManagement: true,
    allowImportInMyTimesheets: false,
    importTargetStatus: 'submitted'
  };
  assert.equal(timesheetImportPolicyService.isImportAllowedForScope(policy, 'management'), true);
  assert.equal(timesheetImportPolicyService.isImportAllowedForScope(policy, 'my_timesheets'), false);
});

test('normalizeClassNameActivityMappings trims rows and rejects duplicates', () => {
  const normalized = timesheetImportPolicyService.normalizeClassNameActivityMappings([
    { className: ' LINC ', activityId: 'ACT_LINC' },
    { className: 'ELA One on One', activityId: 'ACT_ELA' },
    { className: '', activityId: 'ACT_SKIP' }
  ]);
  assert.deepEqual(normalized, [
    { className: 'LINC', activityId: 'ACT_LINC' },
    { className: 'ELA One on One', activityId: 'ACT_ELA' }
  ]);
  assert.throws(
    () => timesheetImportPolicyService.normalizeClassNameActivityMappings([
      { className: 'LINC', activityId: 'ACT_1' },
      { className: ' linc ', activityId: 'ACT_2' }
    ], { enforceUnique: true }),
    /duplicate class name mapping/i
  );
});

test('resolveImportActivityIdForClassName uses exact case-insensitive mapping with fallback', () => {
  const policy = {
    importActivityId: 'ACT_DEFAULT',
    classNameActivityMappings: [
      { className: 'LINC', activityId: 'ACT_LINC' },
      { className: 'ELA One on One', activityId: 'ACT_ELA' }
    ]
  };
  assert.equal(timesheetImportPolicyService.resolveImportActivityIdForClassName('LINC', policy), 'ACT_LINC');
  assert.equal(timesheetImportPolicyService.resolveImportActivityIdForClassName(' linc ', policy), 'ACT_LINC');
  assert.equal(timesheetImportPolicyService.resolveImportActivityIdForClassName('Math', policy), 'ACT_DEFAULT');
});

test('partitionCompiledRowsByImportActivity groups rows by mapped activity', () => {
  const policy = {
    importActivityId: 'ACT_DEFAULT',
    classNameActivityMappings: [
      { className: 'LINC', activityId: 'ACT_LINC' },
      { className: 'ELA One on One', activityId: 'ACT_ELA' }
    ]
  };
  const buckets = timesheetImportPolicyService.partitionCompiledRowsByImportActivity([
    { className: 'LINC', hours: 6 },
    { className: 'Math', hours: 2 },
    { className: 'ELA One on One', hours: 1.5 }
  ], policy);

  assert.equal(buckets.get('ACT_LINC')?.length, 1);
  assert.equal(buckets.get('ACT_ELA')?.length, 1);
  assert.equal(buckets.get('ACT_DEFAULT')?.length, 1);
  assert.equal(buckets.get('ACT_DEFAULT')?.[0]?.className, 'Math');
});

const samplePolicy = {
  importActivityId: 'ACT_DEFAULT',
  classNameActivityMappings: [
    { className: 'LINC', activityId: 'ACT_LINC' },
    { className: 'ELA One on One', activityId: 'ACT_ELA' }
  ]
};

test('resolveImportClassActivityMapping marks explicit, default, and unmapped classes', () => {
  const explicit = timesheetImportPolicyService.resolveImportClassActivityMapping('LINC', samplePolicy);
  assert.equal(explicit.mappingStatus, 'explicit');
  assert.equal(explicit.hasExplicitMapping, true);
  assert.equal(explicit.resolvedActivityId, 'ACT_LINC');
  assert.equal(explicit.mappingNote, '');

  const defaultFallback = timesheetImportPolicyService.resolveImportClassActivityMapping('Math', samplePolicy);
  assert.equal(defaultFallback.mappingStatus, 'default');
  assert.equal(defaultFallback.hasExplicitMapping, false);
  assert.equal(defaultFallback.resolvedActivityId, 'ACT_DEFAULT');
  assert.match(defaultFallback.mappingNote, /default import activity/i);

  const caseInsensitive = timesheetImportPolicyService.resolveImportClassActivityMapping(' linc ', samplePolicy);
  assert.equal(caseInsensitive.mappingStatus, 'explicit');
  assert.equal(caseInsensitive.resolvedActivityId, 'ACT_LINC');

  const unmapped = timesheetImportPolicyService.resolveImportClassActivityMapping('Math', {
    importActivityId: '',
    classNameActivityMappings: samplePolicy.classNameActivityMappings
  });
  assert.equal(unmapped.mappingStatus, 'unmapped');
  assert.equal(unmapped.resolvedActivityId, '');
  assert.match(unmapped.mappingNote, /skipped on import/i);
});

test('annotateImportCompileRows preserves row fields and adds importClassMapping', () => {
  const rows = [
    { className: 'LINC', hours: 6, studentName: 'Alice' },
    { className: 'Math', hours: 2 }
  ];
  const annotated = timesheetImportPolicyService.annotateImportCompileRows(rows, samplePolicy);

  assert.equal(annotated.length, 2);
  assert.equal(annotated[0].hours, 6);
  assert.equal(annotated[0].studentName, 'Alice');
  assert.equal(annotated[0].importClassMapping.mappingStatus, 'explicit');
  assert.equal(annotated[1].importClassMapping.mappingStatus, 'default');
});

test('summarizeImportClassMappingIssues counts distinct classes and rows', () => {
  const rows = timesheetImportPolicyService.annotateImportCompileRows([
    { className: 'LINC', hours: 6 },
    { className: 'Math', hours: 2 },
    { className: 'Math', hours: 1 },
    { className: 'Science', hours: 3 }
  ], {
    importActivityId: '',
    classNameActivityMappings: samplePolicy.classNameActivityMappings
  });

  const summary = timesheetImportPolicyService.summarizeImportClassMappingIssues(rows);
  assert.equal(summary.defaultFallbackClassCount, 0);
  assert.equal(summary.defaultFallbackRowCount, 0);
  assert.equal(summary.unmappedClassCount, 2);
  assert.equal(summary.unmappedRowCount, 3);
  assert.deepEqual(summary.unmappedClasses.sort(), ['Math', 'Science']);
});

test('finalizeImportTargetAfterSave locks statutory holiday assignees when processed', async () => {
  const schoolDependencyService = require('../MVC/services/school/schoolDependencyService');
  const timesheetManualMaterializationService = require('../MVC/services/school/timesheetManualMaterializationService');
  const timesheetParametersPolicyModel = require('../MVC/models/school/timesheetParametersPolicyModel');
  const statutoryHolidayTimesheetLifecycleService = require('../MVC/services/school/statutoryHolidayTimesheetLifecycleService');
  const taskService = require('../MVC/services/school/taskService');

  const originals = {
    materialize: timesheetManualMaterializationService.materializeApprovedTimesheetManualEntries,
    lockSources: schoolDependencyService.lockSourcesForApprovedTimesheet,
    dedupe: schoolDependencyService.dedupeSourceRefs,
    getPolicy: timesheetParametersPolicyModel.getPolicyForOrg,
    lockStatHoliday: statutoryHolidayTimesheetLifecycleService.lockStatHolidayAssigneesForTimesheet,
    resolveTask: taskService.resolveTimesheetTask
  };

  const lockStatHolidayCalls = [];
  const updates = [];
  const dataService = {
    updateData: async (_entityType, id, payload) => {
      updates.push({ id, payload });
      return { id, ...payload };
    }
  };

  timesheetManualMaterializationService.materializeApprovedTimesheetManualEntries = async ({ timesheet }) => ({
    timesheet,
    summary: null
  });
  schoolDependencyService.lockSourcesForApprovedTimesheet = async () => ({
    lockedSourceRefs: [{ type: 'activity', activityId: 'ACT_IMPORT', activityEntryId: 'ENT-1', personId: 'PERSON_1' }]
  });
  schoolDependencyService.dedupeSourceRefs = (refs) => refs;
  timesheetParametersPolicyModel.getPolicyForOrg = async () => ({
    statutoryHolidayPay: { enabled: true, activityId: 'ACT_STAT' }
  });
  statutoryHolidayTimesheetLifecycleService.lockStatHolidayAssigneesForTimesheet = async (args) => {
    lockStatHolidayCalls.push(args);
    return {
      lockedSourceRefs: [{
        type: 'activity',
        activityId: 'ACT_STAT',
        activityEntryId: 'ENT-STAT-1',
        personId: 'PERSON_1'
      }]
    };
  };
  taskService.resolveTimesheetTask = async () => null;

  try {
    const saved = await timesheetImportLifecycleService.finalizeImportTargetAfterSave({
      savedTimesheet: {
        id: 'TS_1',
        orgId: 'ORG_1',
        teacherId: 'PERSON_1',
        entries: [{ sessionId: 'act-1', hours: 2 }],
        reviewVersion: 1,
        reviewHistory: []
      },
      period: { id: 'PER_A', name: 'PER_A', startDate: '2026-03-01', endDate: '2026-03-15' },
      targetStatus: 'processed',
      reqUser: { id: 'USER_1', displayName: 'Admin' },
      dataService
    });

    assert.equal(lockStatHolidayCalls.length, 1);
    assert.equal(lockStatHolidayCalls[0].timesheetId, 'TS_1');
    assert.equal(lockStatHolidayCalls[0].personId, 'PERSON_1');
    assert.equal(saved.status, 'processed');
    assert.equal(saved.lockedSourceRefs.length, 2);
    assert.equal(saved.lockedSourceRefs[1].activityId, 'ACT_STAT');
  } finally {
    timesheetManualMaterializationService.materializeApprovedTimesheetManualEntries = originals.materialize;
    schoolDependencyService.lockSourcesForApprovedTimesheet = originals.lockSources;
    schoolDependencyService.dedupeSourceRefs = originals.dedupe;
    timesheetParametersPolicyModel.getPolicyForOrg = originals.getPolicy;
    statutoryHolidayTimesheetLifecycleService.lockStatHolidayAssigneesForTimesheet = originals.lockStatHoliday;
    taskService.resolveTimesheetTask = originals.resolveTask;
  }
});
