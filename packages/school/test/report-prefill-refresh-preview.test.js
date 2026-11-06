const test = require('node:test');
const assert = require('node:assert/strict');

const reportPrefillRefreshPreviewService = require('../MVC/services/school/reportPrefillRefreshPreviewService');
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
