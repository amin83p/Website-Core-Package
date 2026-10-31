const test = require('node:test');
const assert = require('node:assert/strict');

const reportAssignmentSplitMigrationService = require('../MVC/services/school/reportAssignmentSplitMigrationService');
const reportViewService = require('../MVC/services/school/reportViewService');

test('assignmentNeedsSplit when multiple instance row ids share one assignment', () => {
  const assignment = {
    id: '581970',
    classId: '646148',
    reportScope: 'each_student',
    targetRows: [{
      rowId: 'session:SES-1:2026-10-16',
      sessionId: 'SES-1',
      status: 'active'
    }]
  };
  const instances = [
    { id: '1', assignmentId: '581970', assignmentRowId: 'session:SES-1:2026-10-16', status: 'draft' },
    { id: '2', assignmentId: '581970', assignmentRowId: 'row_legacy_a', status: 'submitted' },
    { id: '3', assignmentId: '581970', assignmentRowId: 'row_legacy_b', status: 'submitted' }
  ];
  assert.equal(reportAssignmentSplitMigrationService.assignmentNeedsSplit(assignment, instances), true);
  const plan = reportAssignmentSplitMigrationService.planSplitForAssignment(assignment, instances);
  assert.equal(plan.rowCount, 3);
});

test('evaluateSharedFieldsEditability unlocks draft row group after split isolation', () => {
  const assignment = { id: '646148-3', reportScope: 'each_student' };
  const template = {
    schema: {
      fields: [{ id: 'shared_note', type: 'textarea', sharedAcrossStudents: true }]
    }
  };
  const instances = [
    { id: 'RI-1', assignmentId: '646148-3', status: 'draft', studentId: 'S1' },
    { id: 'RI-2', assignmentId: '646148-3', status: 'draft', studentId: 'S2' }
  ];
  const gate = reportViewService.evaluateSharedFieldsEditability({
    assignment,
    template,
    instances,
    currentInstanceId: 'RI-1'
  });
  assert.equal(gate.sharedFieldsEditable, true);
  assert.equal(gate.blockingSiblingCount, 0);
});
