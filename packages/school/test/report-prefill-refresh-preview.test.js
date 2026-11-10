const test = require('node:test');
const assert = require('node:assert/strict');

const reportPrefillRefreshPreviewService = require('../MVC/services/school/reportPrefillRefreshPreviewService');
const reportInstanceLivePrefillResetService = require('../MVC/services/school/reportInstanceLivePrefillResetService');
const reportIntegrityService = require('../MVC/services/school/reportIntegrityService');
const schoolDataService = require('../MVC/services/school/schoolDataService');
const reportService = require('../MVC/services/school/reportService');

const previewTemplate = {
  id: 'TPL_PRE_1',
  version: 1,
  schema: {
    fields: [
      {
        id: 'title_field',
        label: 'Title',
        type: 'text',
        prefillKey: 'report_title',
        valueMode: 'manual'
      }
    ]
  }
};

const assignment = {
  id: 'ASG_P1',
  reportScope: 'class',
  classId: 'CLS1'
};

test('prefill preview diffs live merge ignoring renderCache', async (t) => {
  const instance = {
    id: 'RINS_PRE_1',
    studentId: '',
    teacherId: 'T1',
    status: 'draft',
    answers: {},
    prefillSnapshot: { report_title: 'Saved title' },
    audit: { firstSavedAt: '2025-01-01T00:00:00.000Z' },
    renderCache: {
      templateId: 'TPL_PRE_1',
      templateVersion: 1,
      capturedAt: '2025-01-02T00:00:00.000Z',
      mergedAnswers: { title_field: 'Cached wrong' }
    }
  };

  const origBuild = reportService.buildPrefillSnapshot;
  reportService.buildPrefillSnapshot = async () => ({ report_title: 'Fresh title' });

  t.after(() => {
    reportService.buildPrefillSnapshot = origBuild;
  });

  const preview = await reportPrefillRefreshPreviewService.buildPrefillRefreshPreview({
    instance,
    template: previewTemplate,
    assignment,
    reqUser: { id: 'u1' }
  });

  assert.ok(Array.isArray(preview.changes));
  const row = preview.changes.find((c) => c.prefillKey === 'report_title');
  assert.ok(row, 'expected a change for report_title');
  const sub = row.fields[0];
  assert.equal(sub.currentValue, 'Saved title');
  assert.equal(sub.newValue, 'Fresh title');
});

function withPatched(target, replacements, callback) {
  const originals = {};
  Object.entries(replacements).forEach(([key, value]) => {
    originals[key] = target[key];
    target[key] = value;
  });
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      Object.entries(originals).forEach(([key, value]) => {
        target[key] = value;
      });
    });
}

test('resetInstanceFromLivePrefill rejects locked instances', async () => {
  await withPatched(reportIntegrityService, {
    getEditableInstanceOrThrow: async () => {
      const error = new Error('This report is locked and cannot be edited.');
      error.statusCode = 403;
      throw error;
    }
  }, async () => {
    await assert.rejects(
      () => reportInstanceLivePrefillResetService.resetInstanceFromLivePrefill({
        instanceId: 'RINS_LOCKED',
        reqUser: { id: 'u1' }
      }),
      (err) => err.statusCode === 403
    );
  });
});

test('resetInstanceFromLivePrefill updates draft instance from live prefill merge', async () => {
  const instance = {
    id: 'RINS_RESET_1',
    templateId: 'TPL_PRE_1',
    assignmentId: 'ASG_P1',
    studentId: 'STU-1',
    teacherId: 'T1',
    status: 'draft',
    answers: { title_field: 'Stale answer' },
    prefillSnapshot: { report_title: 'Saved title' },
    audit: {}
  };
  const updates = [];
  await withPatched(reportIntegrityService, {
    getEditableInstanceOrThrow: async () => instance
  }, async () => {
    await withPatched(schoolDataService, {
      getDataById: async (entityType, id) => {
        if (entityType === 'reportTemplates') {
          return previewTemplate;
        }
        if (entityType === 'reportAssignments') {
          return assignment;
        }
        return null;
      },
      updateData: async (entityType, id, payload) => {
        updates.push({ entityType, id, payload });
        return payload;
      }
    }, async () => {
      const origBuild = reportService.buildPrefillSnapshot;
      reportService.buildPrefillSnapshot = async () => ({ report_title: 'Fresh title' });
      try {
        const result = await reportInstanceLivePrefillResetService.resetInstanceFromLivePrefill({
          instanceId: instance.id,
          reqUser: { id: 'u1' }
        });
        assert.equal(result.status, 'success');
        assert.equal(updates.length, 1);
        assert.equal(updates[0].payload.answers.title_field, 'Fresh title');
        assert.equal(updates[0].payload.prefillSnapshot.report_title, 'Fresh title');
        assert.ok(updates[0].payload.audit.prefillRefreshedAt);
      } finally {
        reportService.buildPrefillSnapshot = origBuild;
      }
    });
  });
});
