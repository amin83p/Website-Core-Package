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
