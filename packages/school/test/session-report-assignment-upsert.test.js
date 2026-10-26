const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../MVC/services/school/schoolDataService');
const reportIntegrityService = require('../MVC/services/school/reportIntegrityService');
const classReferenceSyncService = require('../MVC/services/school/classReferenceSyncService');
const sessionReportAssignmentService = require('../MVC/services/school/sessionReportAssignmentService');

const classData = {
  id: 'CLS_1',
  orgId: 'ORG',
  title: 'Morning',
  instructors: [{ personId: 'TCH_1', name: 'Teacher One' }]
};
const session = {
  sessionId: 'SES_1',
  date: '2026-06-04',
  startTime: '09:00',
  endTime: '11:00',
  deliveredBy: 'TCH_1'
};
const sessionRoster = [{ personId: 'STU_1', name: 'Student One' }, { personId: 'STU_2', name: 'Student Two' }];
const reqUser = { id: 'USER_1', activeOrgId: 'ORG' };

const baseInput = {
  templateId: 'TPL_1',
  reportScope: 'each_student',
  reportStartDate: '2026-06-01',
  reportDueDate: '2026-06-10',
  taskStartTime: '09:00',
  taskEndTime: '10:00',
  timesheetReflection: false,
  conductRequiredBeforeFill: true
};

function restoreAfter(t, restores) {
  t.after(() => {
    restores.forEach(({ target, key, value }) => {
      target[key] = value;
    });
  });
}

test('mergeTargetRows updates an existing session row by rowId', () => {
  const existing = [{
    rowId: 'session:SES_1:2026-06-01',
    targetType: 'session',
    sessionId: 'SES_1',
    reportStartDate: '2026-06-01',
    taskEndTime: '09:30'
  }];
  const merged = sessionReportAssignmentService.mergeTargetRows(existing, {
    rowId: 'session:SES_1:2026-06-01',
    taskEndTime: '10:00',
    conflictPermitted: true
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].taskEndTime, '10:00');
  assert.equal(merged[0].conflictPermitted, true);
});

test('resolveWizardRowStudentIds uses session roster for each_student when none selected', () => {
  const ids = sessionReportAssignmentService.resolveWizardRowStudentIds('each_student', [], sessionRoster);
  assert.deepEqual(ids, ['STU_1', 'STU_2']);
});

test('buildSessionTargetRow defaults conflictPermitted from input and honors report due date', () => {
  const row = sessionReportAssignmentService.buildSessionTargetRow({
    session,
    reportStartDate: '2026-06-01',
    reportDueDate: '2026-06-10',
    taskStartTime: '09:00',
    taskEndTime: '10:00',
    conflictPermitted: true,
    timesheetReflection: false,
    allocatedHours: 0,
    conductRequiredBeforeFill: true,
    teacherId: 'TCH_1',
    reportScope: 'each_student',
    targetStudentIds: [],
    sessionRoster
  });
  assert.equal(row.reportDueDate, '2026-06-10');
  assert.equal(row.conflictPermitted, true);
  assert.deepEqual(row.targetStudentIds, ['STU_1', 'STU_2']);
});

test('upsert merges into existing class assignment instead of creating a new one', async (t) => {
  const existingAssignment = {
    id: 'ASG_EXISTING',
    orgId: 'ORG',
    classId: 'CLS_1',
    reportScope: 'class',
    templateId: 'TPL_1',
    targetRows: [{
      rowId: 'session:SES_OLD:2026-06-01',
      targetType: 'session',
      sessionId: 'SES_OLD',
      status: 'active',
      teacherId: 'TCH_1'
    }],
    status: 'active',
    audit: { createUser: 'USER_0', createDateTime: '2026-01-01T00:00:00.000Z' }
  };

  const originalFetch = schoolDataService.fetchAllData;
  const originalAdd = schoolDataService.addData;
  const originalUpdate = schoolDataService.updateData;
  const originalValidate = reportIntegrityService.validateAssignmentCrossEntityContext;
  const originalCleanup = classReferenceSyncService.cleanupReportInstancesForRemovedTargetRows;
  const originalNotify = classReferenceSyncService.notifyClassReferencesChanged;

  let addCalls = 0;
  let updateCalls = 0;

  schoolDataService.fetchAllData = async () => [existingAssignment];
  schoolDataService.addData = async () => {
    addCalls += 1;
    return { id: 'ASG_NEW' };
  };
  schoolDataService.updateData = async (collection, id, payload) => {
    updateCalls += 1;
    assert.equal(collection, 'reportAssignments');
    assert.equal(id, 'ASG_EXISTING');
    assert.equal(payload.targetRows.length, 2);
    return { id, ...payload };
  };
  reportIntegrityService.validateAssignmentCrossEntityContext = async ({ targetRows }) => ({
    template: { id: 'TPL_1', version: 1 },
    effectiveTargetRows: targetRows,
    persistedTargetStudentIds: []
  });
  classReferenceSyncService.cleanupReportInstancesForRemovedTargetRows = async () => {};
  classReferenceSyncService.notifyClassReferencesChanged = async () => {};

  restoreAfter(t, [
    { target: schoolDataService, key: 'fetchAllData', value: originalFetch },
    { target: schoolDataService, key: 'addData', value: originalAdd },
    { target: schoolDataService, key: 'updateData', value: originalUpdate },
    { target: reportIntegrityService, key: 'validateAssignmentCrossEntityContext', value: originalValidate },
    { target: classReferenceSyncService, key: 'cleanupReportInstancesForRemovedTargetRows', value: originalCleanup },
    { target: classReferenceSyncService, key: 'notifyClassReferencesChanged', value: originalNotify }
  ]);

  const result = await sessionReportAssignmentService.upsertSessionTargetRowForAssignment({
    classData,
    session,
    sessionRoster,
    reqUser,
    input: {
      ...baseInput,
      reportScope: 'class',
      conflictPermitted: true
    }
  });

  assert.equal(result.createdAssignment, false);
  assert.equal(result.assignment.id, 'ASG_EXISTING');
  assert.equal(addCalls, 0);
  assert.equal(updateCalls, 1);
});

test('upsert creates a new assignment when none exists for class and scope', async (t) => {
  const originalFetch = schoolDataService.fetchAllData;
  const originalAdd = schoolDataService.addData;
  const originalUpdate = schoolDataService.updateData;
  const originalValidate = reportIntegrityService.validateAssignmentCrossEntityContext;

  let addCalls = 0;
  let updateCalls = 0;

  schoolDataService.fetchAllData = async () => [];
  schoolDataService.addData = async (collection, payload) => {
    addCalls += 1;
    assert.equal(collection, 'reportAssignments');
    assert.equal(payload.reportDueDate, '2026-06-10');
    assert.equal(payload.conflictPermitted, true);
    return { id: 'ASG_NEW', ...payload };
  };
  schoolDataService.updateData = async () => {
    updateCalls += 1;
    return {};
  };
  reportIntegrityService.validateAssignmentCrossEntityContext = async ({ targetRows }) => ({
    template: { id: 'TPL_1', version: 1, conductRequiredBeforeFill: true },
    effectiveTargetRows: targetRows,
    persistedTargetStudentIds: ['STU_1', 'STU_2']
  });

  restoreAfter(t, [
    { target: schoolDataService, key: 'fetchAllData', value: originalFetch },
    { target: schoolDataService, key: 'addData', value: originalAdd },
    { target: schoolDataService, key: 'updateData', value: originalUpdate },
    { target: reportIntegrityService, key: 'validateAssignmentCrossEntityContext', value: originalValidate }
  ]);

  const result = await sessionReportAssignmentService.upsertSessionTargetRowForAssignment({
    classData,
    session,
    sessionRoster,
    reqUser,
    input: {
      ...baseInput,
      conflictPermitted: undefined
    }
  });

  assert.equal(result.createdAssignment, true);
  assert.equal(result.assignment.id, 'ASG_NEW');
  assert.equal(addCalls, 1);
  assert.equal(updateCalls, 0);
});
