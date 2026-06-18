/**
 * Roster rules: auto-late when minutes set; threshold → absent.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { applyAttendanceMatrixRosterRules, resolvePolicy } = require('../packages/school/MVC/services/school/attendanceMatrixMetricsService');

const policy = resolvePolicy({}, {
  scheduledMinutes: 180,
  disqualifyLateMinutes: 30,
  disqualifyEarlyLeaveMinutes: 25,
  disqualifyCombinedMissedMinutes: 60
});

test('present + late minutes becomes late', () => {
  const out = applyAttendanceMatrixRosterRules(
    { attendance: 'present', lateMinutes: 5, earlyLeaveMinutes: 0 },
    policy
  );
  assert.equal(out.attendance, 'late');
  assert.equal(out.lateMinutes, 5);
});

test('late minutes at threshold becomes absent', () => {
  const out = applyAttendanceMatrixRosterRules(
    { attendance: 'late', lateMinutes: 30, earlyLeaveMinutes: 0 },
    policy
  );
  assert.equal(out.attendance, 'absent');
});

test('combined late + early over threshold becomes absent', () => {
  const policyComb = resolvePolicy({}, {
    scheduledMinutes: 180,
    disqualifyLateMinutes: 100,
    disqualifyEarlyLeaveMinutes: 100,
    disqualifyCombinedMissedMinutes: 40
  });
  const out = applyAttendanceMatrixRosterRules(
    { attendance: 'present', lateMinutes: 25, earlyLeaveMinutes: 20 },
    policyComb
  );
  assert.equal(out.attendance, 'absent');
});
