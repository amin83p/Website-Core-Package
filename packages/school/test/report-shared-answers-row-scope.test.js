const test = require('node:test');
const assert = require('node:assert/strict');

const reportAssignmentModel = require('../MVC/models/school/reportAssignmentModel');
const reportService = require('../MVC/services/school/reportService');
const schoolDataService = require('../MVC/services/school/schoolDataService');
const reportInstanceSaveService = require('../MVC/services/school/reportInstanceSaveService');
const reportViewService = require('../MVC/services/school/reportViewService');

const rowA = 'session:SES_1:2026-06-01';
const rowB = 'session:SES_2:2026-07-01';

test('resolveSharedAnswersForRow avoids flat bleed on multi-row assignments', () => {
  const assignment = {
    reportScope: 'each_student',
    sharedAnswers: { shared_note: 'legacy flat' },
    targetRows: [
      { rowId: rowA, status: 'active' },
      { rowId: rowB, status: 'active' }
    ]
  };
  assert.deepEqual(reportAssignmentModel.resolveSharedAnswersForRow(assignment, rowA), {});
  assert.deepEqual(reportAssignmentModel.resolveSharedAnswersForRow(assignment, rowB), {});
});

test('resolveSharedAnswersForRow falls back to flat sharedAnswers for single-row assignments', () => {
  const assignment = {
    reportScope: 'each_student',
    sharedAnswers: { shared_note: 'only row' },
    targetRows: [{ rowId: rowA, status: 'active' }]
  };
  assert.deepEqual(
    reportAssignmentModel.resolveSharedAnswersForRow(assignment, rowA),
    { shared_note: 'only row' }
  );
});

test('resolveSharedAnswersForRow reads sharedAnswersByRowId slice', () => {
  const assignment = {
    reportScope: 'each_student',
    sharedAnswers: { shared_note: 'legacy flat' },
    sharedAnswersByRowId: {
      [rowA]: { shared_note: 'row A only' }
    },
    targetRows: [
      { rowId: rowA, status: 'active' },
      { rowId: rowB, status: 'active' }
    ]
  };
  assert.deepEqual(
    reportAssignmentModel.resolveSharedAnswersForRow(assignment, rowA),
    { shared_note: 'row A only' }
  );
  assert.deepEqual(reportAssignmentModel.resolveSharedAnswersForRow(assignment, rowB), {});
});

test('mergeTemplateData uses row-scoped shared answers', () => {
  const template = {
    schema: {
      fields: [{ id: 'shared_note', type: 'textarea', sharedAcrossStudents: true }]
    }
  };
  const assignment = {
    reportScope: 'each_student',
    sharedAnswersByRowId: {
      [rowA]: { shared_note: 'A' },
      [rowB]: { shared_note: 'B' }
    },
    targetRows: [
      { rowId: rowA, status: 'active' },
      { rowId: rowB, status: 'active' }
    ]
  };
  const mergedA = reportService.mergeTemplateData(template, { assignmentRowId: rowA, answers: {} }, assignment);
  const mergedB = reportService.mergeTemplateData(template, { assignmentRowId: rowB, answers: {} }, assignment);
  assert.equal(mergedA.shared_note, 'A');
  assert.equal(mergedB.shared_note, 'B');
});

test('persistInstanceAnswers writes sharedAnswersByRowId for the instance row only', async (t) => {
  const assignment = {
    id: 'ASG_1',
    orgId: 'ORG',
    reportScope: 'each_student',
    sharedAnswers: { shared_note: 'legacy' },
    targetRows: [
      { rowId: rowA, status: 'active' },
      { rowId: rowB, status: 'active' }
    ]
  };
  const template = {
    schema: {
      fields: [{ id: 'shared_note', type: 'textarea', sharedAcrossStudents: true }]
    }
  };
  const instance = {
    id: 'RI_1',
    assignmentId: 'ASG_1',
    assignmentRowId: rowA,
    status: 'draft',
    answers: {},
    prefillSnapshot: {}
  };

  let updatePayload = null;
  const origUpdate = schoolDataService.updateData;
  const origGate = reportViewService.loadAssignmentInstancesForSharedGate;
  const origAdmin = reportViewService.isReportInstanceAdminEditor;
  const origBuild = reportViewService.buildInstanceAnswers;

  schoolDataService.updateData = async (collection, id, payload) => {
    if (collection === 'reportAssignments') updatePayload = payload;
    return { id, ...payload };
  };
  reportViewService.loadAssignmentInstancesForSharedGate = async () => [];
  reportViewService.isReportInstanceAdminEditor = async () => false;
  reportViewService.buildInstanceAnswers = (tpl, body, merged) => ({
    answers: { ...(merged || {}), ...(body || {}) },
    issues: []
  });

  t.after(() => {
    schoolDataService.updateData = origUpdate;
    reportViewService.loadAssignmentInstancesForSharedGate = origGate;
    reportViewService.isReportInstanceAdminEditor = origAdmin;
    reportViewService.buildInstanceAnswers = origBuild;
  });

  await reportInstanceSaveService.persistInstanceAnswers({
    instance,
    template,
    assignment,
    body: { shared_note: 'saved on A', submitAction: 'save' },
    submitAction: 'save',
    reqUser: { id: 'U1' }
  });

  assert.ok(updatePayload);
  assert.equal(updatePayload.sharedAnswersByRowId[rowA].shared_note, 'saved on A');
  assert.equal(updatePayload.sharedAnswersByRowId[rowB], undefined);
  assert.deepEqual(updatePayload.sharedAnswers, {});
});
