const test = require('node:test');
const assert = require('node:assert/strict');
const weeklyReportsEngagementService = require('../packages/school/MVC/services/school/weeklyReportsEngagementService');
const attendanceMatrixMetricsService = require('../packages/school/MVC/services/school/attendanceMatrixMetricsService');

test('summarizeEngagementFromMatrix sums present and scheduled minutes for expected cells', () => {
  const matrix = [{
    records: [
      {
        expectedForSession: true,
        status: attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT,
        scheduledMinutes: 60
      },
      {
        expectedForSession: true,
        status: attendanceMatrixMetricsService.ATTENDANCE_STATUS.ABSENT,
        scheduledMinutes: 60
      },
      {
        expectedForSession: false,
        status: attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT,
        scheduledMinutes: 60
      }
    ]
  }];
  const result = weeklyReportsEngagementService.summarizeEngagementFromMatrix(matrix, {}, {});
  assert.equal(result.scheduledMinutes, 120);
  assert.equal(result.presentMinutes, 60);
  assert.equal(result.percent, 50);
});

test('summarizeEngagementFromMatrix returns null percent when no scheduled minutes', () => {
  const result = weeklyReportsEngagementService.summarizeEngagementFromMatrix([], {}, {});
  assert.equal(result.scheduledMinutes, 0);
  assert.equal(result.presentMinutes, 0);
  assert.equal(result.percent, null);
});

test('summarizeEngagementFromMatrix exempts N/A from numerator and denominator', () => {
  const matrix = [{
    records: [
      {
        expectedForSession: true,
        status: attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT,
        scheduledMinutes: 60
      },
      {
        expectedForSession: true,
        status: attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE,
        scheduledMinutes: 60
      }
    ]
  }];
  const result = weeklyReportsEngagementService.summarizeEngagementFromMatrix(matrix, {}, {});
  assert.equal(result.scheduledMinutes, 60);
  assert.equal(result.presentMinutes, 60);
  assert.equal(result.percent, 100);
});

test('summarizeEngagementFromMatrix counts unmarked as zero attendance but includes session span in denominator', () => {
  const matrix = [{
    records: [
      {
        expectedForSession: true,
        status: attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT,
        scheduledMinutes: 60
      },
      {
        expectedForSession: true,
        status: '',
        scheduledMinutes: 60
      }
    ]
  }];
  const result = weeklyReportsEngagementService.summarizeEngagementFromMatrix(matrix, {}, {});
  assert.equal(result.scheduledMinutes, 120);
  assert.equal(result.presentMinutes, 60);
  assert.equal(result.percent, 50);
});

test('mergeEngagementTotals combines class summaries into aggregate percent', () => {
  const first = { presentMinutes: 60, scheduledMinutes: 120, percent: 50 };
  const second = { presentMinutes: 30, scheduledMinutes: 60, percent: 50 };
  const merged = weeklyReportsEngagementService.mergeEngagementTotals(
    weeklyReportsEngagementService.mergeEngagementTotals({ presentMinutes: 0, scheduledMinutes: 0, percent: null }, first),
    second
  );
  assert.equal(merged.presentMinutes, 90);
  assert.equal(merged.scheduledMinutes, 180);
  assert.equal(merged.percent, 50);
});

test('per-class engagement breakdown merges to the same aggregate as list teacher groups', () => {
  const classes = [
    { classId: 'class-a', presentMinutes: 60, scheduledMinutes: 120, percent: 50 },
    { classId: 'class-b', presentMinutes: 30, scheduledMinutes: 60, percent: 50 }
  ];
  let totals = { presentMinutes: 0, scheduledMinutes: 0, percent: null };
  classes.forEach(function (row) {
    totals = weeklyReportsEngagementService.mergeEngagementTotals(totals, row);
  });
  assert.equal(classes.length, 2);
  assert.equal(classes[0].classId, 'class-a');
  assert.equal(classes[1].classId, 'class-b');
  assert.equal(totals.presentMinutes, 90);
  assert.equal(totals.scheduledMinutes, 180);
  assert.equal(totals.percent, 50);
});

test('summarizeEngagementFromMatrix counts partial presence for late minutes', () => {
  const matrix = [{
    records: [{
      expectedForSession: true,
      status: attendanceMatrixMetricsService.ATTENDANCE_STATUS.LATE,
      scheduledMinutes: 60,
      lateMinutes: 15
    }]
  }];
  const result = weeklyReportsEngagementService.summarizeEngagementFromMatrix(matrix, {}, {});
  assert.equal(result.scheduledMinutes, 60);
  assert.ok(result.presentMinutes > 0 && result.presentMinutes < 60);
  assert.ok(result.percent > 0 && result.percent < 100);
});
