const test = require('node:test');
const assert = require('node:assert/strict');

const weeklyReportsHubService = require('../MVC/services/school/weeklyReportsHubService');
const weeklyReportsEngagementService = require('../MVC/services/school/weeklyReportsEngagementService');
const attendanceMatrixMetricsService = require('../MVC/services/school/attendanceMatrixMetricsService');

const ST = attendanceMatrixMetricsService.ATTENDANCE_STATUS;

test('summarizeStudentAttendanceForWeeklyReport tracks excused late minutes', () => {
  const summary = weeklyReportsHubService.summarizeStudentAttendanceForWeeklyReport({
    records: [{
      expectedForSession: true,
      status: ST.LATE,
      lateMinutes: 12,
      lateExcused: true,
      earlyLeaveMinutes: 0
    }]
  });
  assert.equal(summary.lateCount, 1);
  assert.equal(summary.lateMinutes, 12);
  assert.equal(summary.lateExcusedCount, 1);
  assert.equal(summary.lateExcusedMinutes, 12);
});

test('summarizeStudentAttendanceForWeeklyReport splits ACF, absent, and N/A', () => {
  const summary = weeklyReportsHubService.summarizeStudentAttendanceForWeeklyReport({
    records: [
      { expectedForSession: true, status: ST.ACF, absenceExcused: false },
      { expectedForSession: true, status: ST.ACF, absenceExcused: true },
      { expectedForSession: true, status: ST.ABSENT, absenceExcused: true },
      { expectedForSession: true, status: ST.NOT_APPLICABLE }
    ]
  });
  assert.equal(summary.acfCount, 1);
  assert.equal(summary.acfExcusedCount, 1);
  assert.equal(summary.absenceExcusedCount, 1);
  assert.equal(summary.naCount, 1);
});

test('summarizeEngagementFromStudentMatrixRow computes attended minutes ratio', () => {
  const engagement = weeklyReportsEngagementService.summarizeEngagementFromStudentMatrixRow({
    records: [{
      expectedForSession: true,
      status: ST.PRESENT,
      scheduledMinutes: 60,
      lateMinutes: 0,
      earlyLeaveMinutes: 0
    }]
  }, {}, {});
  assert.equal(engagement.scheduledMinutes, 60);
  assert.ok(engagement.presentMinutes > 0);
  assert.equal(engagement.percent, 100);
});

test('formatStudentSessionLabel shows ACF instead of Absent', () => {
  const label = weeklyReportsHubService.formatStudentSessionLabel({
    status: ST.ACF,
    absenceExcused: false
  });
  assert.equal(label, 'ACF');
});

test('summarizeEngagementFromStudentMatrixRow gives ACF zero present minutes even when excused', () => {
  const engagement = weeklyReportsEngagementService.summarizeEngagementFromStudentMatrixRow({
    records: [
      { expectedForSession: true, status: ST.ACF, absenceExcused: true, scheduledMinutes: 60 },
      { expectedForSession: true, status: ST.PRESENT, scheduledMinutes: 60, lateMinutes: 0, earlyLeaveMinutes: 0 }
    ]
  }, {}, {});
  assert.equal(engagement.scheduledMinutes, 120);
  assert.equal(engagement.presentMinutes, 60);
  assert.equal(engagement.percent, 50);
});

test('summarizeEngagementFromStudentMatrixRow weights two absences and one late session', () => {
  const engagement = weeklyReportsEngagementService.summarizeEngagementFromStudentMatrixRow({
    records: [
      { expectedForSession: true, status: ST.ABSENT, scheduledMinutes: 60, lateMinutes: 0, earlyLeaveMinutes: 0 },
      { expectedForSession: true, status: ST.ABSENT, scheduledMinutes: 60, lateMinutes: 0, earlyLeaveMinutes: 0 },
      { expectedForSession: true, status: ST.LATE, scheduledMinutes: 60, lateMinutes: 12, earlyLeaveMinutes: 0 }
    ]
  }, {}, {});
  assert.equal(engagement.scheduledMinutes, 180);
  assert.equal(engagement.presentMinutes, 48);
  assert.equal(engagement.percent, 26.7);
});
