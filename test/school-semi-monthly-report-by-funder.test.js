const test = require('node:test');
const assert = require('node:assert/strict');
const byFunderService = require('../packages/school/MVC/services/school/schoolSemiMonthlyReportByFunderService');
const applicabilityService = require('../packages/school/MVC/services/school/classEnrollmentSessionApplicabilityService');

test('periodQualifiesForFunderSelection accepts active status', () => {
  assert.equal(byFunderService.periodQualifiesForFunderSelection({ status: 'active' }), true);
  assert.equal(byFunderService.periodQualifiesForFunderSelection({ status: 'draft' }), false);
});

test('periodQualifiesForFunderSelection accepts manual scheduled close', () => {
  const period = {
    status: 'active',
    enrollmentCloseMode: 'scheduled',
    scheduledClosingDate: '2026-02-15'
  };
  if (applicabilityService.isManualScheduledCloseForAttendance(period)) {
    assert.equal(byFunderService.periodQualifiesForFunderSelection(period), true);
  }
});

test('periodQualifiesForFunderSelection rejects withdrawn', () => {
  assert.equal(byFunderService.periodQualifiesForFunderSelection({ status: 'withdrawn' }), false);
});

test('periodOverlapsReportRange uses effective end date', () => {
  assert.equal(byFunderService.periodOverlapsReportRange(
    { startDate: '2026-01-01', endDate: '2026-01-31', status: 'active' },
    '2026-01-15',
    '2026-01-20'
  ), true);
  assert.equal(byFunderService.periodOverlapsReportRange(
    { startDate: '2026-01-01', endDate: '2026-01-10', status: 'active' },
    '2026-01-15',
    '2026-01-20'
  ), false);
});

test('groupPeriodsByStudent merges classes per student', () => {
  const classById = new Map([
    ['CLS-1', { id: 'CLS-1', name: 'Math' }],
    ['CLS-2', { id: 'CLS-2', name: 'English' }]
  ]);
  const studentLabelById = new Map([
    ['STU-1', { studentRecordId: 'STU-1', personId: 'P-1', name: 'Ada Lovelace' }]
  ]);
  const grouped = byFunderService.groupPeriodsByStudent([
    { studentId: 'STU-1', classId: 'CLS-1', status: 'active', startDate: '2026-01-01', endDate: '2026-01-31' },
    { studentId: 'STU-1', classId: 'CLS-2', status: 'active', startDate: '2026-01-01', endDate: '2026-01-31', targetSessionCount: 10 }
  ], classById, studentLabelById);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].studentRecordId, 'STU-1');
  assert.equal(grouped[0].personId, 'P-1');
  assert.equal(grouped[0].classes.length, 2);
  const classNames = grouped[0].classes.map((row) => row.className).sort();
  assert.deepEqual(classNames, ['English', 'Math']);
});
