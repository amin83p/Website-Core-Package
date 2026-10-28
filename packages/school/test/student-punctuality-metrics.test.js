const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildStudentPunctualityFromMatrixRow,
  mergeStudentPunctualitySummaries,
  getPunctualityLabel
} = require('../MVC/services/school/studentPunctualityMetricsService');
const attendanceMatrixMetricsService = require('../MVC/services/school/attendanceMatrixMetricsService');

const ST = attendanceMatrixMetricsService.ATTENDANCE_STATUS;

function matrixRow(records) {
  return { records };
}

function record(status, timing = {}) {
  return {
    expectedForSession: true,
    status,
    lateMinutes: timing.lateMinutes || 0,
    earlyLeaveMinutes: timing.earlyLeaveMinutes || 0,
    lateExcused: timing.lateExcused || false,
    earlyLeaveExcused: timing.earlyLeaveExcused || false
  };
}

test('on-time present sessions yield 100% punctuality', () => {
  const summary = buildStudentPunctualityFromMatrixRow(matrixRow([
    record(ST.PRESENT),
    record(ST.PRESENT)
  ]), { classData: {}, orgPolicyLayer: {} });
  assert.equal(summary.attendedSessions, 2);
  assert.equal(summary.onTimeSessions, 2);
  assert.equal(summary.punctualityPercent, 100);
  assert.equal(summary.punctualityLabel, 'Excellent punctuality');
});

test('late minutes count as timing issues', () => {
  const summary = buildStudentPunctualityFromMatrixRow(matrixRow([
    record(ST.PRESENT),
    record(ST.LATE, { lateMinutes: 5 })
  ]), { classData: {}, orgPolicyLayer: {} });
  assert.equal(summary.attendedSessions, 2);
  assert.equal(summary.onTimeSessions, 1);
  assert.equal(summary.totalIssueSessions, 1);
  assert.equal(summary.punctualityPercent, 50);
});

test('no attended sessions returns N/A label', () => {
  const summary = buildStudentPunctualityFromMatrixRow(matrixRow([
    record(ST.ABSENT)
  ]), { classData: {}, orgPolicyLayer: {} });
  assert.equal(summary.attendedSessions, 0);
  assert.equal(summary.punctualityPercent, 'N/A');
  assert.equal(summary.punctualityLabel, 'Not available');
});

test('mergeStudentPunctualitySummaries recomputes percent across classes', () => {
  const left = buildStudentPunctualityFromMatrixRow(matrixRow([record(ST.PRESENT)]), {});
  const right = buildStudentPunctualityFromMatrixRow(matrixRow([
    record(ST.LATE, { lateMinutes: 10 })
  ]), {});
  const merged = mergeStudentPunctualitySummaries(left, right);
  assert.equal(merged.attendedSessions, 2);
  assert.equal(merged.onTimeSessions, 1);
  assert.equal(merged.punctualityPercent, 50);
});

test('getPunctualityLabel thresholds', () => {
  assert.match(getPunctualityLabel(96, 3), /Excellent/);
  assert.match(getPunctualityLabel(88, 3), /Good/);
  assert.match(getPunctualityLabel(75, 3), /Needs attention/);
  assert.match(getPunctualityLabel(50, 3), /concern/);
});
