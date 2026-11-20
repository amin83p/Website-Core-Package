'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const reportService = require('../MVC/services/school/reportService');

test('templateScopedPrefillValuesChanged compares scoped keys without throwing', () => {
  const template = {
    schema: {
      fields: [
        {
          id: 'attendance_pct',
          label: 'Attendance',
          type: 'number',
          prefillKey: 'student_attendance_span_percent'
        }
      ]
    }
  };
  assert.equal(
    reportService.templateScopedPrefillValuesChanged(
      { student_attendance_span_percent: 1 },
      { student_attendance_span_percent: 87.5 },
      template
    ),
    true
  );
  assert.equal(
    reportService.templateScopedPrefillValuesChanged(
      { student_attendance_span_percent: 50 },
      { student_attendance_span_percent: 50 },
      template
    ),
    false
  );
});