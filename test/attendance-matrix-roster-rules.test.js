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

test('not_applicable is not converted by late or early thresholds', () => {
  const out = applyAttendanceMatrixRosterRules(
    { attendance: 'N/A', lateMinutes: 100, earlyLeaveMinutes: 100 },
    policy
  );
  assert.equal(out.attendance, 'not_applicable');
  assert.equal(out.lateMinutes, 0);
  assert.equal(out.earlyLeaveMinutes, 0);
});

test('acf with late minutes stays acf (not converted to late)', () => {
  const out = applyAttendanceMatrixRosterRules(
    { attendance: 'acf', lateMinutes: 5, earlyLeaveMinutes: 0 },
    policy
  );
  assert.equal(out.attendance, 'acf');
  assert.equal(out.lateMinutes, 5);
});

test('empty unmarked attendance stays empty when under thresholds', () => {
  const out = applyAttendanceMatrixRosterRules(
    { attendance: '', lateMinutes: 5, earlyLeaveMinutes: 0 },
    policy
  );
  assert.equal(out.attendance, '');
  assert.equal(out.lateMinutes, 5);
});

test('empty unmarked attendance becomes absent at late threshold', () => {
  const out = applyAttendanceMatrixRosterRules(
    { attendance: '', lateMinutes: 30, earlyLeaveMinutes: 0 },
    policy
  );
  assert.equal(out.attendance, 'absent');
});

test('disabled thresholds keep timing records attended and convert legacy absent to late', () => {
  const disabledPolicy = { ...policy, thresholdsEnabled: false };
  const out = applyAttendanceMatrixRosterRules(
    { attendance: 'absent', lateMinutes: 179, earlyLeaveMinutes: 0 },
    disabledPolicy
  );
  assert.equal(out.attendance, 'late');
  assert.equal(out.lateMinutes, 179);
});

test('disabled thresholds use present when late status is disabled', () => {
  const disabledPolicy = { ...policy, thresholdsEnabled: false };
  const out = applyAttendanceMatrixRosterRules(
    { attendance: 'absent', lateMinutes: 179, earlyLeaveMinutes: 0 },
    disabledPolicy,
    ['present', 'absent', 'not_applicable']
  );
  assert.equal(out.attendance, 'present');
});

test('disabled thresholds preserve true absent, ACF, N/A, and unmarked rows', () => {
  const disabledPolicy = { ...policy, thresholdsEnabled: false };
  assert.equal(
    applyAttendanceMatrixRosterRules(
      { attendance: 'absent', lateMinutes: 0, earlyLeaveMinutes: 0 },
      disabledPolicy
    ).attendance,
    'absent'
  );
  assert.equal(
    applyAttendanceMatrixRosterRules(
      { attendance: 'acf', lateMinutes: 5, earlyLeaveMinutes: 0 },
      disabledPolicy
    ).attendance,
    'acf'
  );
  assert.equal(
    applyAttendanceMatrixRosterRules(
      { attendance: 'excused', lateMinutes: 5, earlyLeaveMinutes: 0 },
      disabledPolicy
    ).attendance,
    'excused'
  );
  assert.equal(
    applyAttendanceMatrixRosterRules(
      { attendance: 'N/A', lateMinutes: 5, earlyLeaveMinutes: 5 },
      disabledPolicy
    ).attendance,
    'not_applicable'
  );
  assert.equal(
    applyAttendanceMatrixRosterRules(
      { attendance: '', lateMinutes: 5, earlyLeaveMinutes: 0 },
      disabledPolicy
    ).attendance,
    ''
  );
});
