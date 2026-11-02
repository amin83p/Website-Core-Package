const test = require('node:test');
const assert = require('node:assert/strict');

const reportAssignmentModel = require('../MVC/models/school/reportAssignmentModel');

test('diffTargetRows treats unchanged rows as verbatim copies', () => {
  const existing = {
    templateId: 'TPL-DEFAULT',
    targetRows: [{
      rowId: 'row-a',
      targetType: 'session',
      sessionId: 'SES-1',
      sessionDate: '2026-09-15',
      dueDate: '',
      reportStartDate: '2026-09-01',
      reportDueDate: '2026-09-15',
      taskStartTime: '09:00',
      taskEndTime: '10:00',
      conflictPermitted: true,
      timesheetReflection: false,
      allocatedHours: 0,
      conductRequiredBeforeFill: true,
      teacherId: 'TCH-1',
      status: 'active',
      notes: '',
      targetStudentIds: ['STU-1'],
      templateId: 'TPL-OLD',
      templateVersion: 2
    }]
  };
  const incoming = [JSON.parse(JSON.stringify(existing.targetRows[0]))];
  const diff = reportAssignmentModel.diffTargetRows(existing, incoming);
  assert.deepEqual(diff.addedRowIds, []);
  assert.deepEqual(diff.updatedRowIds, []);
  assert.equal(diff.mergedRows.length, 1);
  assert.equal(diff.mergedRows[0].templateId, 'TPL-OLD');
  assert.equal(diff.mergedRows[0].templateVersion, 2);
});

test('diffTargetRows marks new and updated rows for validation', () => {
  const existing = {
    targetRows: [{
      rowId: 'row-a',
      targetType: 'session',
      sessionId: 'SES-1',
      sessionDate: '2026-09-15',
      dueDate: '',
      reportStartDate: '2026-09-01',
      reportDueDate: '2026-09-15',
      taskStartTime: '09:00',
      taskEndTime: '10:00',
      conflictPermitted: true,
      timesheetReflection: false,
      allocatedHours: 0,
      conductRequiredBeforeFill: true,
      teacherId: 'TCH-1',
      status: 'active',
      notes: '',
      targetStudentIds: []
    }]
  };
  const diff = reportAssignmentModel.diffTargetRows(existing, [
    existing.targetRows[0],
    {
      rowId: 'row-b',
      targetType: 'session',
      sessionId: 'SES-2',
      sessionDate: '2026-10-29',
      dueDate: '',
      reportStartDate: '2026-10-16',
      reportDueDate: '2026-10-29',
      taskStartTime: '09:00',
      taskEndTime: '10:00',
      conflictPermitted: true,
      timesheetReflection: false,
      allocatedHours: 0,
      conductRequiredBeforeFill: true,
      teacherId: 'TCH-1',
      status: 'active',
      notes: '',
      targetStudentIds: []
    }
  ]);
  assert.deepEqual(diff.addedRowIds, ['row-b']);
  assert.deepEqual(diff.updatedRowIds, []);
  assert.deepEqual(diff.validateRowIds.sort(), ['row-b']);
});

test('diffTargetRows tracks removed row ids', () => {
  const existing = {
    targetRows: [{
      rowId: 'row-a',
      targetType: 'session',
      sessionId: 'SES-1',
      sessionDate: '2026-09-15',
      dueDate: '',
      reportStartDate: '2026-09-01',
      reportDueDate: '2026-09-15',
      taskStartTime: '09:00',
      taskEndTime: '10:00',
      conflictPermitted: true,
      timesheetReflection: false,
      allocatedHours: 0,
      conductRequiredBeforeFill: true,
      teacherId: 'TCH-1',
      status: 'active',
      notes: '',
      targetStudentIds: []
    }]
  };
  const diff = reportAssignmentModel.diffTargetRows(existing, []);
  assert.deepEqual(diff.removedRowIds, ['row-a']);
  assert.deepEqual(diff.validateRowIds, []);
});

test('resolveSaveRowValidationMode uses all for new assignments', () => {
  assert.equal(reportAssignmentModel.resolveSaveRowValidationMode({
    hasExistingAssignment: false,
    validateRowIds: []
  }), 'all');
  assert.equal(reportAssignmentModel.resolveSaveRowValidationMode({
    hasExistingAssignment: false,
    validateRowIds: ['row-a']
  }), 'all');
});

test('resolveSaveRowValidationMode uses listed or none for existing assignments', () => {
  assert.equal(reportAssignmentModel.resolveSaveRowValidationMode({
    hasExistingAssignment: true,
    validateRowIds: ['row-a']
  }), 'listed');
  assert.equal(reportAssignmentModel.resolveSaveRowValidationMode({
    hasExistingAssignment: true,
    validateRowIds: []
  }), 'none');
});

test('assignmentSaveRequiresInstanceConfirm is true when rows are removed or students shrink', () => {
  const existing = {
    targetRows: [{
      rowId: 'row-a',
      targetStudentIds: ['STU-1', 'STU-2']
    }, {
      rowId: 'row-b',
      targetStudentIds: ['STU-3']
    }]
  };
  assert.equal(reportAssignmentModel.assignmentSaveRequiresInstanceConfirm({
    diff: { removedRowIds: ['row-b'], validateRowIds: [] },
    existingAssignment: existing,
    mergedRows: [{ rowId: 'row-a', targetStudentIds: ['STU-1', 'STU-2'] }]
  }), true);

  assert.equal(reportAssignmentModel.assignmentSaveRequiresInstanceConfirm({
    diff: { removedRowIds: [], validateRowIds: ['row-a'] },
    existingAssignment: existing,
    mergedRows: [{ rowId: 'row-a', targetStudentIds: ['STU-1'] }],
    incomingRows: [{ rowId: 'row-a', targetStudentIds: ['STU-1'] }]
  }), true);

  assert.equal(reportAssignmentModel.assignmentSaveRequiresInstanceConfirm({
    diff: { removedRowIds: [], validateRowIds: ['row-a'] },
    existingAssignment: existing,
    mergedRows: [{ rowId: 'row-a', targetStudentIds: ['STU-1', 'STU-2'] }],
    incomingRows: [{ rowId: 'row-a', targetStudentIds: ['STU-1', 'STU-2'] }]
  }), false);

  assert.equal(reportAssignmentModel.assignmentSaveRequiresInstanceConfirm({
    diff: { removedRowIds: [], validateRowIds: [] },
    existingAssignment: existing,
    mergedRows: existing.targetRows,
    incomingRows: existing.targetRows
  }), false);
});

test('mergeIncomingTargetRowsForRowIds overlays incoming fields for listed row ids', () => {
  const merged = [{
    rowId: 'row-a',
    reportStartDate: '2026-09-01',
    targetStudentIds: ['STU-1']
  }];
  const incoming = [{
    rowId: 'row-a',
    reportStartDate: '2026-09-08',
    targetStudentIds: ['STU-1']
  }];
  const result = reportAssignmentModel.mergeIncomingTargetRowsForRowIds(merged, incoming, ['row-a']);
  assert.equal(result[0].reportStartDate, '2026-09-08');
});

test('resolveTargetRowTemplateFields prefers row template over assignment default', () => {
  const fields = reportAssignmentModel.resolveTargetRowTemplateFields(
    { templateId: 'TPL-DEFAULT', templateVersion: 1 },
    { templateId: 'TPL-ROW', templateVersion: 3 }
  );
  assert.equal(fields.templateId, 'TPL-ROW');
  assert.equal(fields.templateVersion, 3);
});
