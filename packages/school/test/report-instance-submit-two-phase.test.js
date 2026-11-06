const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../MVC/services/school/schoolDataService');
const reportInstanceSaveService = require('../MVC/services/school/reportInstanceSaveService');
const reportViewService = require('../MVC/services/school/reportViewService');

const template = {
  id: 'TPL_SUB_1',
  version: 1,
  schema: {
    fields: [
      { id: 'note', label: 'Note', type: 'text', valueMode: 'manual' }
    ]
  }
};

const assignment = {
  id: 'ASG_1',
  reportScope: 'class'
};

test('submit performs draft write then submitted status write', async (t) => {
  const instance = {
    id: 'RINS_1',
    assignmentId: 'ASG_1',
    status: 'draft',
    answers: {},
    prefillSnapshot: {},
    derivedOverrides: {},
    audit: {}
  };

  const updates = [];
  const origUpdate = schoolDataService.updateData;
  const origGate = reportViewService.loadAssignmentInstancesForSharedGate;
  const origAdmin = reportViewService.isReportInstanceAdminEditor;

  schoolDataService.updateData = async (collection, id, payload) => {
    updates.push({ collection, id, payload });
    return { id, ...payload };
  };
  reportViewService.loadAssignmentInstancesForSharedGate = async () => [];
  reportViewService.isReportInstanceAdminEditor = async () => false;

  t.after(() => {
    schoolDataService.updateData = origUpdate;
    reportViewService.loadAssignmentInstancesForSharedGate = origGate;
    reportViewService.isReportInstanceAdminEditor = origAdmin;
  });

  await reportInstanceSaveService.persistInstanceAnswers({
    instance,
    template,
    assignment,
    body: { field__note: 'hello', submitAction: 'submit' },
    submitAction: 'submit',
    reqUser: { id: 'teacher1' }
  });

  const instanceUpdates = updates.filter((u) => u.collection === 'reportInstances');
  assert.equal(instanceUpdates.length, 2);
  assert.equal(instanceUpdates[0].payload.status, 'draft');
  assert.ok(instanceUpdates[0].payload.audit.lastDraftSavedAt);
  assert.equal(instanceUpdates[1].payload.status, 'submitted');
  assert.ok(instanceUpdates[1].payload.audit.submittedAt);
});

test('save draft performs single instance update', async (t) => {
  const instance = {
    id: 'RINS_2',
    assignmentId: 'ASG_1',
    status: 'draft',
    answers: {},
    prefillSnapshot: {},
    derivedOverrides: {},
    audit: {}
  };

  const updates = [];
  const origUpdate = schoolDataService.updateData;
  const origGate = reportViewService.loadAssignmentInstancesForSharedGate;
  const origAdmin = reportViewService.isReportInstanceAdminEditor;

  schoolDataService.updateData = async (collection, id, payload) => {
    updates.push({ collection, id, payload });
    return { id, ...payload };
  };
  reportViewService.loadAssignmentInstancesForSharedGate = async () => [];
  reportViewService.isReportInstanceAdminEditor = async () => false;

  t.after(() => {
    schoolDataService.updateData = origUpdate;
    reportViewService.loadAssignmentInstancesForSharedGate = origGate;
    reportViewService.isReportInstanceAdminEditor = origAdmin;
  });

  await reportInstanceSaveService.persistInstanceAnswers({
    instance,
    template,
    assignment,
    body: { field__note: 'x', submitAction: 'save' },
    submitAction: 'save',
    reqUser: { id: 'teacher1' }
  });

  const instanceUpdates = updates.filter((u) => u.collection === 'reportInstances');
  assert.equal(instanceUpdates.length, 1);
  assert.equal(instanceUpdates[0].payload.status, 'draft');
});
