const test = require('node:test');
const assert = require('node:assert/strict');

const reportService = require('../MVC/services/school/reportService');

test('buildDocxPlaceholderPayloadDetailed does not re-convert display letter grades to dash', () => {
  const template = {
    id: 'RPTTPL-CONV-1',
    snapshotKeys: ['student_session_rating_span_class_effort_percent', 'classEffort'],
    schema: {
      version: 1,
      fields: [{
        id: 'classEffort',
        label: 'Class Effort',
        type: 'text',
        readOnly: true,
        prefillKey: 'student_session_rating_span_class_effort_percent',
        valueMode: 'manual',
        exportTextCase: 'as_entered',
        conversionRule: {
          enabled: true,
          applyOnReadOnlyDisplay: true,
          expression: "ifelse(value >= 95, 'S', ifelse(value >= 80, 'G', '-'))",
          onError: 'empty'
        }
      }]
    },
    placeholderMap: { classEffort: '{{classEffort}}' }
  };
  const instance = {
    id: 'RPTINS-TEST-1',
    answers: { classEffort: 100 },
    prefillSnapshot: { student_session_rating_span_class_effort_percent: 100 }
  };
  const bundle = reportService.buildDocxPlaceholderPayloadDetailed(template, instance, null, { respectSnapshotKeys: true });
  assert.equal(bundle.placeholders['{{classEffort}}'], 'S');
});
