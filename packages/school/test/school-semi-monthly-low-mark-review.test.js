'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const lowMarkService = require('../MVC/services/school/schoolSemiMonthlyLowMarkReviewService');
const sarExportJobService = require('../MVC/services/school/sarExportJobService');

const viewerSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/report/semiMonthlyReportViewer.ejs'),
  'utf8'
);
const modalSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/report/partials/lowMarkReviewModal.ejs'),
  'utf8'
);

test('semi-monthly viewer exposes Low Average Mark Review control', () => {
  assert.match(viewerSource, /btn_openLowMarkReviewModal/);
  assert.match(viewerSource, /Low Average Mark Review/);
  assert.match(viewerSource, /lowMarkReviewModal/);
});

test('low mark modal exposes metric checkboxes and scope below-limit control', () => {
  assert.match(modalSource, /lmrMetric_average_class_mark/);
  assert.match(modalSource, /lmrMetric_listening/);
  assert.match(modalSource, /lmrOnlyBelowThreshold/);
  assert.doesNotMatch(modalSource, /lmrClassIds/);
});

test('resolveAverageClassMarkField finds field by label', () => {
  const template = {
    schema: {
      fields: [
        { id: 'other', label: 'Other', type: 'number' },
        {
          id: 'Average_Class_Mark',
          label: 'Average Class Mark (Auto Calculation)',
          type: 'number',
          valueMode: 'calculated'
        }
      ]
    }
  };
  const resolved = lowMarkService.resolveAverageClassMarkField(template);
  assert.equal(resolved.fieldId, 'Average_Class_Mark');
});

test('resolveMetricField matches conversation and R/W progress report labels', () => {
  const conversation = {
    schema: {
      fields: [
        { id: 'l1', label: 'Listening Comprehension Tasks', type: 'number' },
        { id: 's1', label: 'Presentation / Speaking Tasks', type: 'number' }
      ]
    }
  };
  const rw = {
    schema: {
      fields: [
        { id: 'r1', label: 'Reading Comprehension', type: 'number' },
        { id: 'w1', label: 'Grammar / Vocab Tasks & Writing Tasks', type: 'number' }
      ]
    }
  };
  assert.equal(lowMarkService.resolveMetricField(conversation, 'listening').fieldId, 'l1');
  assert.equal(lowMarkService.resolveMetricField(conversation, 'speaking').fieldId, 's1');
  assert.equal(lowMarkService.resolveMetricField(rw, 'reading').fieldId, 'r1');
  assert.equal(lowMarkService.resolveMetricField(rw, 'writing').fieldId, 'w1');
});

test('resolveMetricField finds attendance punctuality and skills', () => {
  const template = {
    schema: {
      fields: [
        { id: 'Attendance', label: 'Attendance', type: 'number' },
        { id: 'Punctuality', label: 'Punctuality For Class', type: 'number' },
        {
          id: 'listening',
          label: 'Listening',
          type: 'number',
          prefillKey: 'student_gradebook_skill_listening_avg_percent'
        },
        { id: 'Future Goal: Listening', label: 'Future Goal: Listening', type: 'number' }
      ]
    }
  };
  assert.equal(lowMarkService.resolveMetricField(template, 'attendance').fieldId, 'Attendance');
  assert.equal(lowMarkService.resolveMetricField(template, 'punctuality').fieldId, 'Punctuality');
  assert.equal(lowMarkService.resolveMetricField(template, 'listening').fieldId, 'listening');
  assert.equal(lowMarkService.resolveMetricField(template, 'reading'), null);
});

test('auditConfiguredTemplates builds per-metric map and warns per missing metric', () => {
  const templateById = new Map([
    ['T1', {
      schema: {
        fields: [
          { id: 'listening', label: 'Listening', type: 'number' },
          {
            id: 'Average_Class_Mark',
            label: 'Average Class Mark (Auto Calculation)',
            type: 'number'
          }
        ]
      }
    }]
  ]);
  const labelById = new Map([['T1', 'Four-skill template']]);
  const { warnings, fieldsByTemplateId } = lowMarkService.auditConfiguredTemplates(
    ['T1'],
    templateById,
    labelById,
    ['listening', 'reading', 'average_class_mark']
  );
  const map = fieldsByTemplateId.get('T1');
  assert.equal(map.get('listening'), 'listening');
  assert.equal(map.get('average_class_mark'), 'Average_Class_Mark');
  assert.equal(map.has('reading'), false);
  assert.equal(map.has('reading'), false);
  assert.ok(!warnings.some((row) => /No Reading field/.test(row.message)));
});

test('auditConfiguredTemplates warns when template missing all metrics', () => {
  const templateById = new Map([
    ['T1', { schema: { fields: [{ id: 'x', label: 'X', type: 'text' }] } }]
  ]);
  const labelById = new Map([['T1', 'Template One']]);
  const { warnings, fieldsByTemplateId } = lowMarkService.auditConfiguredTemplates(
    ['T1'],
    templateById,
    labelById,
    ['average_class_mark']
  );
  assert.ok(warnings.length >= 1);
  assert.equal(fieldsByTemplateId.size, 0);
});

test('resolveNumericMark and parseThreshold', () => {
  assert.equal(lowMarkService.parseThreshold(60), 60);
  assert.equal(lowMarkService.parseThreshold(0), null);
  assert.equal(lowMarkService.resolveNumericMark({ Average_Class_Mark: 54 }, 'Average_Class_Mark'), 54);
});

test('parseReviewInput defaults metrics and onlyBelowThreshold', () => {
  const parsed = lowMarkService.parseReviewInput({
    startDate: '2026-01-01',
    endDate: '2026-01-15',
    threshold: 60
  });
  assert.equal(parsed.filters.onlyBelowThreshold, true);
  assert.deepEqual(parsed.metricKeys, ['average_class_mark']);
  const off = lowMarkService.parseReviewInput({
    startDate: '2026-01-01',
    endDate: '2026-01-15',
    threshold: 60,
    onlyBelowThreshold: false,
    metricKeys: ['attendance', 'average_class_mark', 'bogus']
  });
  assert.equal(off.filters.onlyBelowThreshold, false);
  assert.deepEqual(off.metricKeys, ['attendance', 'average_class_mark']);
});

test('parseMetricKeys ignores invalid keys', () => {
  assert.deepEqual(lowMarkService.parseMetricKeys([]), ['average_class_mark']);
  assert.deepEqual(lowMarkService.parseMetricKeys(['listening', 'listening', 'nope']), ['listening']);
});

test('collectCellRowsForDate expands all selected metrics on failing instance', () => {
  const evaluations = [
    {
      studentRecordId: 'S1',
      sessionDate: '2026-01-10',
      instanceId: 'I1',
      metricKey: 'attendance',
      mark: 55,
      passesThreshold: false
    },
    {
      studentRecordId: 'S1',
      sessionDate: '2026-01-10',
      instanceId: 'I1',
      metricKey: 'listening',
      mark: 72,
      passesThreshold: true
    },
    {
      studentRecordId: 'S1',
      sessionDate: '2026-01-10',
      instanceId: 'I1',
      metricKey: 'average_class_mark',
      mark: 58,
      passesThreshold: false
    }
  ];
  const rows = lowMarkService.collectCellRowsForDate(
    'S1',
    '2026-01-10',
    ['attendance', 'listening', 'average_class_mark'],
    evaluations,
    true
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.metricKey).sort(), [
    'attendance',
    'average_class_mark'
  ]);

  const allMetrics = lowMarkService.collectCellRowsForDate(
    'S1',
    '2026-01-10',
    ['attendance', 'listening', 'average_class_mark'],
    evaluations,
    false
  );
  assert.equal(allMetrics.length, 3);
});

test('below-limit mode drops students with no visible cells', () => {
  const evaluations = [
    {
      studentRecordId: 'S1',
      sessionDate: '2026-01-10',
      instanceId: 'I1',
      metricKey: 'attendance',
      mark: 40,
      passesThreshold: false
    },
    {
      studentRecordId: 'S2',
      sessionDate: '2026-01-10',
      instanceId: 'I2',
      metricKey: 'attendance',
      mark: 80,
      passesThreshold: true
    }
  ];
  const rowsS1 = lowMarkService.collectCellRowsForDate(
    'S1',
    '2026-01-10',
    ['attendance'],
    evaluations,
    true
  );
  const rowsS2 = lowMarkService.collectCellRowsForDate(
    'S2',
    '2026-01-10',
    ['attendance'],
    evaluations,
    true
  );
  assert.equal(rowsS1.length, 1);
  assert.equal(rowsS2.length, 0);
});

test('student OR inclusion when any metric fails threshold', () => {
  const evaluations = [
    { studentRecordId: 'S1', passesThreshold: true, metricKey: 'attendance' },
    { studentRecordId: 'S1', passesThreshold: false, metricKey: 'listening' },
    { studentRecordId: 'S2', passesThreshold: true, metricKey: 'average_class_mark' }
  ];
  const belowByStudent = new Map();
  evaluations.forEach((row) => {
    if (row.passesThreshold) return;
    if (!belowByStudent.has(row.studentRecordId)) belowByStudent.set(row.studentRecordId, []);
    belowByStudent.get(row.studentRecordId).push(row);
  });
  assert.deepEqual([...belowByStudent.keys()], ['S1']);
  assert.equal(belowByStudent.get('S1').length, 1);
  assert.equal(belowByStudent.get('S1')[0].metricKey, 'listening');
});

test('intersectStudentRecordIdSets keeps common ids', () => {
  const a = new Set(['S1', 'S2']);
  const b = new Set(['S2', 'S3']);
  const out = lowMarkService.intersectStudentRecordIdSets([a, b]);
  assert.deepEqual([...out], ['S2']);
});

test('sarExportJobService supports low_mark_review and cancel', async () => {
  const job = sarExportJobService.createJob({
    userId: 'U1',
    activeOrgId: 'ORG1',
    jobType: 'low_mark_review',
    totalItems: 2
  });
  assert.equal(job.jobType, 'low_mark_review');
  const fakeUser = { id: 'U1', activeOrgId: 'ORG1' };
  sarExportJobService.requestJobCancel(job.id, fakeUser);
  assert.equal(sarExportJobService.isJobCancelRequested(job.id), true);
  let caught = false;
  try {
    sarExportJobService.assertJobNotCancelled(job.id);
  } catch (err) {
    caught = true;
    assert.equal(err.code, 'JOB_CANCELLED');
  }
  assert.equal(caught, true);
});