'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const reportService = require('../MVC/services/school/reportService');
const reportGenerationEngineService = require('../MVC/services/school/reportGenerationEngineService');
const { isAutoRefreshPrefillKey } = require('../MVC/services/school/reportPrefillKeyUtils');

test('isAutoRefreshPrefillKey marks gradebook skill metrics', () => {
  assert.equal(isAutoRefreshPrefillKey('student_gradebook_skill_reading_avg_percent'), true);
  assert.equal(isAutoRefreshPrefillKey('student_attendance_span_percent'), true);
  assert.equal(isAutoRefreshPrefillKey('teacher_name'), false);
});

test('mergeTemplateData prefers fresh prefill over stale saved answers when not overridden', () => {
  const template = {
    schema: {
      fields: [
        {
          id: 'reading_avg',
          type: 'text',
          prefillKey: 'student_gradebook_skill_reading_avg_percent'
        }
      ]
    }
  };
  const instance = {
    prefillSnapshot: { student_gradebook_skill_reading_avg_percent: 75 },
    answers: { reading_avg: 37.5 },
    derivedOverrides: {}
  };
  const merged = reportService.mergeTemplateData(template, instance, null);
  assert.equal(merged.reading_avg, 75);
});

test('mergeTemplateData prefers fresh attendance span prefill over stale saved answers', () => {
  const template = {
    schema: {
      fields: [
        {
          id: 'attendance_pct',
          type: 'number',
          prefillKey: 'student_attendance_span_percent'
        }
      ]
    }
  };
  const instance = {
    prefillSnapshot: { student_attendance_span_percent: 87.5 },
    answers: { attendance_pct: 1 },
    derivedOverrides: {}
  };
  const merged = reportService.mergeTemplateData(template, instance, null);
  assert.equal(merged.attendance_pct, 87.5);
});

test('mergeTemplateData keeps manual answers when gradebook skill field is overridden', () => {
  const template = {
    schema: {
      fields: [
        {
          id: 'reading_avg',
          type: 'text',
          prefillKey: 'student_gradebook_skill_reading_avg_percent'
        }
      ]
    }
  };
  const instance = {
    prefillSnapshot: { student_gradebook_skill_reading_avg_percent: 75 },
    answers: { reading_avg: 80 },
    derivedOverrides: { reading_avg: true }
  };
  const merged = reportService.mergeTemplateData(template, instance, null);
  assert.equal(merged.reading_avg, 80);
});

test('hydrateAnswersFromPrefill overwrites stale gradebook skill answers when not overridden', () => {
  const template = {
    schema: {
      fields: [
        {
          id: 'writing_avg',
          type: 'number',
          prefillKey: 'student_gradebook_skill_writing_avg_percent'
        }
      ]
    }
  };
  const instance = {
    prefillSnapshot: { student_gradebook_skill_writing_avg_percent: 37.5 },
    answers: { writing_avg: 18.75 },
    derivedOverrides: {}
  };
  const hydrated = reportGenerationEngineService.hydrateAnswersFromPrefill(template, instance);
  assert.equal(hydrated.changed, true);
  assert.equal(hydrated.answers.writing_avg, 37.5);
});

test('hydrateAnswersFromPrefill keeps overridden gradebook skill answers', () => {
  const template = {
    schema: {
      fields: [
        {
          id: 'writing_avg',
          type: 'number',
          prefillKey: 'student_gradebook_skill_writing_avg_percent'
        }
      ]
    }
  };
  const instance = {
    prefillSnapshot: { student_gradebook_skill_writing_avg_percent: 37.5 },
    answers: { writing_avg: 50 },
    derivedOverrides: { writing_avg: true }
  };
  const hydrated = reportGenerationEngineService.hydrateAnswersFromPrefill(template, instance);
  assert.equal(hydrated.changed, false);
  assert.equal(hydrated.answers.writing_avg, 50);
});

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
