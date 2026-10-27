const test = require('node:test');
const assert = require('node:assert/strict');

const reportService = require('../MVC/services/school/reportService');

const scopedTemplate = {
  id: 'RPTTPL-SCOPE-1',
  orgId: 'ORG-TEST-1',
  type: 'progress_report_v1',
  version: 1,
  title: 'Scoped Export Template',
  status: 'draft',
  schema: {
    version: 1,
    fields: [
      {
        id: 'student_name',
        label: 'Student Name',
        type: 'text',
        readOnly: true,
        prefillKey: 'student_full_name',
        valueMode: 'manual'
      },
      {
        id: 'unused_metric',
        label: 'Unused',
        type: 'number',
        readOnly: true,
        prefillKey: 'class_attendance_present',
        valueMode: 'manual'
      },
      {
        id: 'total_score',
        label: 'Total',
        type: 'number',
        valueMode: 'calculated',
        calculationRule: { enabled: true, expression: 'answers.student_name', onError: 'keep_last' },
        calculationDependencies: ['student_name']
      }
    ]
  },
  placeholderMap: { student_name: 'student_full_name' },
  snapshotKeys: ['student_full_name', 'student_name', 'total_score']
};

const legacyTemplate = {
  ...scopedTemplate,
  id: 'RPTTPL-LEGACY-1',
  snapshotKeys: []
};

const assignment = { reportScope: 'each_student', sharedAnswers: {} };

function richInstance(overrides = {}) {
  return {
    id: 'RPTINS-1',
    status: 'submitted',
    answers: {
      student_name: 'From answers',
      unused_metric: 42,
      total_score: 100
    },
    prefillSnapshot: {
      student_full_name: 'Ada Lovelace',
      class_attendance_present: 99,
      teacher_name: 'Should drop'
    },
    ...overrides
  };
}

test('buildReportInstanceExportPayload scopes prefill, answers, and mergedAnswers when snapshotKeys set', async () => {
  const payload = await reportService.buildReportInstanceExportPayload({
    template: scopedTemplate,
    instance: richInstance(),
    assignment,
    format: 'json'
  });

  assert.equal(payload.prefillSnapshot.student_full_name, 'Ada Lovelace');
  assert.equal(payload.prefillSnapshot.class_attendance_present, undefined);
  assert.equal(payload.prefillSnapshot.teacher_name, undefined);

  assert.equal(payload.answers.student_name, 'From answers');
  assert.equal(payload.answers.unused_metric, undefined);

  assert.equal(payload.mergedAnswers.student_name, 'Ada Lovelace');
  assert.equal(payload.mergedAnswers.unused_metric, undefined);
  assert.ok(Object.prototype.hasOwnProperty.call(payload.mergedAnswers, 'total_score'));
});

test('buildReportInstanceExportPayload keeps in-scope calculated field dependencies in mergedAnswers', async () => {
  const payload = await reportService.buildReportInstanceExportPayload({
    template: scopedTemplate,
    instance: richInstance({ answers: { student_name: 'Ada' } }),
    assignment,
    format: 'json'
  });
  assert.equal(payload.mergedAnswers.student_name, 'Ada Lovelace');
  assert.ok(Object.prototype.hasOwnProperty.call(payload.mergedAnswers, 'total_score'));
});

test('buildReportInstanceExportPayload skips collections for scoped JSON export', async () => {
  const payload = await reportService.buildReportInstanceExportPayload({
    template: scopedTemplate,
    instance: richInstance(),
    assignment,
    format: 'json',
    reqUser: { id: 'user-1' }
  });
  assert.deepEqual(payload.collections, {});
  assert.deepEqual(payload.collectionDiagnostics, {});
});

test('buildReportInstanceExportPayload legacy template without snapshotKeys keeps full prefill', async () => {
  const payload = await reportService.buildReportInstanceExportPayload({
    template: legacyTemplate,
    instance: richInstance(),
    assignment,
    format: 'json',
    options: { buildCollections: false }
  });
  assert.equal(payload.prefillSnapshot.class_attendance_present, 99);
  assert.equal(payload.prefillSnapshot.teacher_name, 'Should drop');
  assert.equal(payload.answers.unused_metric, 42);
});

test('buildReportInstanceExportPayload locked instance uses lockSnapshot mergedAnswers', async () => {
  const instance = richInstance({
    status: 'locked',
    lockSnapshot: {
      mergedAnswers: { student_name: 'Locked name', unused_metric: 77, total_score: 5 },
      placeholders: { '{{student_full_name}}': 'Locked name' }
    }
  });
  const payload = await reportService.buildReportInstanceExportPayload({
    template: scopedTemplate,
    instance,
    assignment,
    format: 'json'
  });
  assert.equal(payload.mergedAnswers.student_name, 'Locked name');
  assert.equal(payload.mergedAnswers.unused_metric, undefined);
  assert.equal(payload.mergedAnswers.total_score, 5);
  assert.equal(payload.placeholders['{{student_full_name}}'], 'Locked name');
});

test('buildReportInstanceExportPayload locked DOCX expands shortcut placeholder tokens', async () => {
  const template = {
    ...scopedTemplate,
    snapshotKeyDocxAliases: { student_full_name: 'vubg' }
  };
  const instance = richInstance({
    status: 'locked',
    lockSnapshot: {
      mergedAnswers: { student_name: 'Ada' },
      placeholders: { '{{student_full_name}}': 'Ada Lovelace' }
    }
  });
  const payload = await reportService.buildReportInstanceExportPayload({
    template,
    instance,
    assignment,
    format: 'docx'
  });
  assert.equal(payload.placeholders['{{vubg}}'], 'Ada Lovelace');
});
