const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../MVC/services/school/schoolDataService');
const reportInstanceSaveService = require('../MVC/services/school/reportInstanceSaveService');
const reportViewService = require('../MVC/services/school/reportViewService');

const template = {
  id: 'TPL_RC_SAVE',
  version: 3,
  schema: {
    fields: [
      { id: 'note', label: 'Note', type: 'text', valueMode: 'manual' },
      { id: 'score', label: 'Score', type: 'number', valueMode: 'manual' }
    ]
  }
};

const assignment = { id: 'ASG_RC', reportScope: 'class' };

test('persistInstanceAnswers stores renderCache aligned with saved answers', async (t) => {
  const instance = {
    id: 'RINS_RC',
    assignmentId: 'ASG_RC',
    status: 'draft',
    answers: { note: 'before', score: 1 },
    prefillSnapshot: {},
    derivedOverrides: {},
    audit: {}
  };

  let savedPayload = null;
  const origUpdate = schoolDataService.updateData;
  const origGate = reportViewService.loadAssignmentInstancesForSharedGate;
  const origAdmin = reportViewService.isReportInstanceAdminEditor;

  schoolDataService.updateData = async (collection, id, payload) => {
    if (collection === 'reportInstances') savedPayload = payload;
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
    body: { field__note: 'after', field__score: '88', submitAction: 'save' },
    submitAction: 'save',
    reqUser: { id: 'U1' }
  });

  assert.ok(savedPayload);
  assert.equal(savedPayload.answers.note, 'after');
  assert.equal(savedPayload.answers.score, 88);
  assert.ok(savedPayload.renderCache?.mergedAnswers);
  assert.equal(savedPayload.renderCache.mergedAnswers.note, 'after');
  assert.equal(savedPayload.renderCache.mergedAnswers.score, 88);
  assert.ok(savedPayload.audit?.lastDraftSavedAt);
  assert.equal(savedPayload.renderCache.capturedAt, savedPayload.audit.lastDraftSavedAt);
});