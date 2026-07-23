const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeSessionCredit,
  computeStudentMatrixSummary,
  resolvePolicy,
  scheduledMinutesFromSession,
  parseTimeToMinutes,
  normalizeAttendanceStatusForSave,
  normalizeEnabledAttendanceStatuses,
  resolveEnabledAttendanceStatuses,
  assertAttendanceStatusAllowedForSave,
  coerceAttendanceStatusToEnabled,
  ALL_ATTENDANCE_STATUSES_ORDERED
} = require('../packages/school/MVC/services/school/attendanceMatrixMetricsService');

const policy180 = {
  scheduledMinutes: 180,
  disqualifyLateMinutes: 30,
  disqualifyEarlyLeaveMinutes: 30,
  disqualifyCombinedMissedMinutes: null
};

test('parseTimeToMinutes', () => {
  assert.equal(parseTimeToMinutes('15:30'), 15 * 60 + 30);
  assert.equal(parseTimeToMinutes('9:05'), 9 * 60 + 5);
  assert.equal(parseTimeToMinutes(''), null);
  assert.equal(parseTimeToMinutes('25:00'), null);
});

test('scheduledMinutesFromSession uses start/end then durationHours then fallback', () => {
  assert.equal(
    scheduledMinutesFromSession(
      { startTime: '15:30', endTime: '18:30', durationHours: 9 },
      60
    ),
    180
  );
  assert.equal(scheduledMinutesFromSession({ durationHours: 2.5 }, 100), 150);
  assert.equal(scheduledMinutesFromSession({}, 90), 90);
  assert.equal(scheduledMinutesFromSession({ startTime: 'bad' }, 45), 45);
});

test('computeSessionCredit uses per-record scheduledMinutes when set', () => {
  const w = 10;
  const r = computeSessionCredit(
    { status: 'late', lateMinutes: 15, earlyLeaveMinutes: 0, scheduledMinutes: 120 },
    w,
    policy180
  );
  const expected = 10 * (105 / 120);
  assert.ok(Math.abs(r.credit - expected) < 1e-9);
});

test('resolvePolicy merges class attendancePolicy', () => {
  const p = resolvePolicy({
    attendancePolicy: {
      scheduledMinutes: 120,
      disqualifyLateMinutes: 20,
      disqualifyEarlyLeaveMinutes: 25,
      disqualifyCombinedMissedMinutes: 40
    }
  });
  assert.equal(p.scheduledMinutes, 120);
  assert.equal(p.disqualifyLateMinutes, 20);
  assert.equal(p.disqualifyEarlyLeaveMinutes, 25);
  assert.equal(p.disqualifyCombinedMissedMinutes, 40);
});

test('resolvePolicy org layer applies; class overrides per field', () => {
  const org = {
    scheduledMinutes: 200,
    disqualifyLateMinutes: 40,
    disqualifyEarlyLeaveMinutes: 35,
    disqualifyCombinedMissedMinutes: 50
  };
  const p = resolvePolicy(
    { attendancePolicy: { scheduledMinutes: 120 } },
    org
  );
  assert.equal(p.scheduledMinutes, 120);
  assert.equal(p.disqualifyLateMinutes, 40);
  assert.equal(p.disqualifyEarlyLeaveMinutes, 35);
  assert.equal(p.disqualifyCombinedMissedMinutes, 50);
});

test('absent and N/A yield zero credit', () => {
  const w = 10;
  assert.equal(computeSessionCredit({ status: 'absent' }, w, policy180).credit, 0);
  assert.equal(computeSessionCredit({ status: 'N/A' }, w, policy180).credit, 0);
});

test('excused yields full session weight', () => {
  const w = 10;
  assert.equal(computeSessionCredit({ status: 'excused' }, w, policy180).credit, w);
});

test('present on time yields full session weight', () => {
  const w = 10;
  const r = computeSessionCredit(
    { status: 'present', lateMinutes: 0, earlyLeaveMinutes: 0 },
    w,
    policy180
  );
  assert.equal(r.credit, w);
});

test('late 15 min proportional credit (10 sessions × 10% weight)', () => {
  const w = 10;
  const r = computeSessionCredit(
    { status: 'late', lateMinutes: 15, earlyLeaveMinutes: 0 },
    w,
    policy180
  );
  const expected = 10 * (165 / 180);
  assert.ok(Math.abs(r.credit - expected) < 1e-9);
});

test('late >= 30 disqualifies session', () => {
  const w = 10;
  const r = computeSessionCredit(
    { status: 'late', lateMinutes: 35, earlyLeaveMinutes: 0 },
    w,
    policy180
  );
  assert.equal(r.credit, 0);
  assert.equal(r.disqualified, true);
});

test('early leave >= 30 disqualifies session', () => {
  const w = 10;
  const r = computeSessionCredit(
    { status: 'present', lateMinutes: 0, earlyLeaveMinutes: 40 },
    w,
    policy180
  );
  assert.equal(r.credit, 0);
  assert.equal(r.disqualified, true);
});

test('combined missed minutes threshold', () => {
  const w = 10;
  const pol = { ...policy180, disqualifyCombinedMissedMinutes: 45 };
  const ok = computeSessionCredit(
    { status: 'present', lateMinutes: 20, earlyLeaveMinutes: 15 },
    w,
    pol
  );
  assert.ok(ok.credit > 0);
  const bad = computeSessionCredit(
    { status: 'present', lateMinutes: 25, earlyLeaveMinutes: 25 },
    w,
    pol
  );
  assert.equal(bad.credit, 0);
  assert.equal(bad.disqualified, true);
});

test('rollup: 10 sessions all present = 100%', () => {
  const records = Array.from({ length: 10 }, () => ({
    status: 'present',
    lateMinutes: 0,
    earlyLeaveMinutes: 0
  }));
  const s = computeStudentMatrixSummary(records, {});
  assert.equal(s.totalPresentSessions, 10);
  assert.equal(s.totalAbsentSessions, 0);
  assert.equal(s.performancePercent, 100);
});

test('rollup: user example mix across 5 sessions', () => {
  const records = [
    { status: 'present', lateMinutes: 0, earlyLeaveMinutes: 0 },
    { status: 'late', lateMinutes: 15, earlyLeaveMinutes: 0 },
    { status: 'late', lateMinutes: 35, earlyLeaveMinutes: 0 },
    { status: 'present', lateMinutes: 0, earlyLeaveMinutes: 20 },
    { status: 'present', lateMinutes: 0, earlyLeaveMinutes: 40 }
  ];
  const s = computeStudentMatrixSummary(records, {});
  const w = 100 / 5;
  const c1 = w;
  const c2 = w * (165 / 180);
  const c3 = 0;
  const c4 = w * (160 / 180);
  const c5 = 0;
  const sum = c1 + c2 + c3 + c4 + c5;
  assert.ok(Math.abs(s.performancePercentRaw - sum) < 1e-6);
  assert.equal(s.disqualifiedSessionCount, 2);
});

test('N/A aliases normalize to not_applicable', () => {
  assert.equal(normalizeAttendanceStatusForSave('N/A'), 'not_applicable');
  assert.equal(normalizeAttendanceStatusForSave('na'), 'not_applicable');
  assert.equal(normalizeAttendanceStatusForSave('not applicable'), 'not_applicable');
});

test('rollup excludes not_applicable from denominator and reports N/A count', () => {
  const records = [
    { status: 'present', lateMinutes: 0, earlyLeaveMinutes: 0 },
    { status: 'not_applicable', lateMinutes: 0, earlyLeaveMinutes: 0 },
    { status: 'absent', lateMinutes: 0, earlyLeaveMinutes: 0 }
  ];
  const s = computeStudentMatrixSummary(records, {});
  assert.equal(s.totalEligibleSessions, 2);
  assert.equal(s.totalNotApplicableSessions, 1);
  assert.equal(s.totalPresentSessions, 1);
  assert.equal(s.totalAbsentSessions, 1);
  assert.equal(s.performancePercent, 50);
});

test('rollup excludes unmarked empty status from denominator and does not count as absent', () => {
  const records = [
    { status: 'present', lateMinutes: 0, earlyLeaveMinutes: 0 },
    { status: '', lateMinutes: 0, earlyLeaveMinutes: 0 },
    { status: 'absent', lateMinutes: 0, earlyLeaveMinutes: 0 },
    { status: 'not_applicable', lateMinutes: 0, earlyLeaveMinutes: 0 }
  ];
  const s = computeStudentMatrixSummary(records, {});
  assert.equal(s.totalEligibleSessions, 2);
  assert.equal(s.totalNotApplicableSessions, 1);
  assert.equal(s.totalPresentSessions, 1);
  assert.equal(s.totalAbsentSessions, 1);
  assert.equal(s.performancePercent, 50);
  const emptyCredit = computeSessionCredit({ status: '' }, 50, policy180);
  assert.equal(emptyCredit.reason, 'no_record');
  assert.equal(emptyCredit.credit, 0);
});

test('ACF aliases normalize and yield zero credit like absent', () => {
  assert.equal(normalizeAttendanceStatusForSave('acf'), 'acf');
  assert.equal(normalizeAttendanceStatusForSave('ACF'), 'acf');
  assert.equal(normalizeAttendanceStatusForSave('absent_camera_off'), 'acf');
  const credit = computeSessionCredit({ status: 'acf' }, 25, policy180);
  assert.equal(credit.credit, 0);
  assert.equal(credit.reason, 'acf');
});

test('rollup counts ACF in totalAbsentSessions', () => {
  const records = [
    { status: 'present', lateMinutes: 0, earlyLeaveMinutes: 0 },
    { status: 'acf', lateMinutes: 0, earlyLeaveMinutes: 0 },
    { status: 'absent', lateMinutes: 0, earlyLeaveMinutes: 0 }
  ];
  const s = computeStudentMatrixSummary(records, {});
  assert.equal(s.totalEligibleSessions, 3);
  assert.equal(s.totalPresentSessions, 1);
  assert.equal(s.totalAbsentSessions, 2);
  assert.equal(s.performancePercent, Math.round((100 / 3) * 100) / 100);
});

test('resolveEnabledAttendanceStatuses defaults to all when missing', () => {
  assert.deepEqual(resolveEnabledAttendanceStatuses({}), [...ALL_ATTENDANCE_STATUSES_ORDERED]);
  assert.deepEqual(resolveEnabledAttendanceStatuses({ enabledAttendanceStatuses: [] }), [...ALL_ATTENDANCE_STATUSES_ORDERED]);
});

test('normalizeEnabledAttendanceStatuses always keeps present, absent, and N/A', () => {
  const result = normalizeEnabledAttendanceStatuses(['late', 'acf', 'bogus']);
  assert.deepEqual(result, ['present', 'late', 'absent', 'acf', 'not_applicable']);
  assert.ok(result.includes('present'));
  assert.ok(result.includes('absent'));
  assert.ok(result.includes('not_applicable'));
  assert.ok(!result.includes('excused'));
});

test('assertAttendanceStatusAllowedForSave rejects disabled statuses', () => {
  const enabled = ['present', 'absent', 'late'];
  assert.equal(
    assertAttendanceStatusAllowedForSave({ status: 'late', enabledStatuses: enabled }),
    'late'
  );
  assert.throws(
    () => assertAttendanceStatusAllowedForSave({ status: 'acf', enabledStatuses: enabled }),
    /not enabled for this class/i
  );
});

test('assertAttendanceStatusAllowedForSave always allows N/A and historical values', () => {
  const enabled = ['present', 'absent'];
  assert.equal(
    assertAttendanceStatusAllowedForSave({
      status: 'not_applicable',
      enabledStatuses: enabled
    }),
    'not_applicable'
  );
  assert.equal(
    assertAttendanceStatusAllowedForSave({
      status: 'acf',
      enabledStatuses: enabled,
      previousStatus: 'acf'
    }),
    'acf'
  );
});

test('assertAttendanceStatusAllowedForSave allows empty unmarked status', () => {
  assert.equal(
    assertAttendanceStatusAllowedForSave({
      status: '',
      enabledStatuses: ['present', 'absent']
    }),
    ''
  );
  assert.equal(
    assertAttendanceStatusAllowedForSave({
      status: null,
      enabledStatuses: ['present', 'absent'],
      previousStatus: 'present'
    }),
    ''
  );
});

test('coerceAttendanceStatusToEnabled maps disabled late to absent but keeps N/A', () => {
  const enabled = ['present', 'absent', 'not_applicable'];
  assert.equal(coerceAttendanceStatusToEnabled('late', enabled), 'absent');
  assert.equal(coerceAttendanceStatusToEnabled('not_applicable', enabled), 'not_applicable');
  assert.equal(coerceAttendanceStatusToEnabled('present', enabled), 'present');
  assert.equal(coerceAttendanceStatusToEnabled('', enabled), '');
});
