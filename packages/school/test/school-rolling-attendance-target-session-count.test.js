const test = require('node:test');
const assert = require('node:assert/strict');

const applicabilityService = require('../MVC/services/school/classEnrollmentSessionApplicabilityService');
const attendanceMatrixMetricsService = require('../MVC/services/school/attendanceMatrixMetricsService');

const personId = 'PERSON_001';
const studentToPersonMap = new Map([['STUDENT_001', personId]]);
const targetPeriod = {
  id: 'PERIOD_001',
  studentId: 'STUDENT_001',
  status: 'active',
  startDate: '2026-02-01',
  endDate: '2026-02-15',
  targetSessionCount: 4,
  sessionCountPolicy: 'all_non_na'
};

function attendance(sessionId, date, status, rosterExtra = {}) {
  return {
    sessionId,
    date,
    status: 'completed',
    roster: [{ personId, attendance: status, ...rosterExtra }]
  };
}

test('target session count uses recorded non-N/A attendance after the start date', () => {
  const sessions = [
    attendance('SES_BEFORE', '2026-01-31', attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT),
    attendance('SES_PRESENT', '2026-02-01', attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT),
    attendance('SES_NA', '2026-02-08', attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE),
    attendance('SES_FORCE_NA', '2026-02-24', attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT),
    attendance('SES_APPROVED_LEAVE', '2026-02-25', attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT),
    attendance('SES_ABSENT', '2026-03-01', attendanceMatrixMetricsService.ATTENDANCE_STATUS.ABSENT),
    attendance('SES_EXCUSED', '2026-03-08', attendanceMatrixMetricsService.ATTENDANCE_STATUS.ABSENT, { absenceExcused: true }),
    attendance('SES_LATE', '2026-03-15', attendanceMatrixMetricsService.ATTENDANCE_STATUS.LATE),
    attendance('SES_AFTER_TARGET', '2026-03-22', attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT)
  ];

  const result = applicabilityService.resolveRollingEnrollmentApplicability({
    sessions,
    periodRows: [targetPeriod],
    studentToPersonMap,
    forceNotApplicableSessionKeys: new Set(['SES_FORCE_NA']),
    approvedLeaveKeys: new Set([
      applicabilityService.buildApplicabilityKey(personId, sessions[4])
    ])
  });
  const summary = result.summariesByPeriodId.get(targetPeriod.id);
  const afterTarget = applicabilityService.getApplicabilityState(
    result.stateByKey,
    personId,
    sessions[8]
  );

  assert.equal(summary.consumedCount, 4);
  assert.equal(summary.remainingCount, 0);
  assert.deepEqual(summary.completionCandidate, { sessionId: 'SES_LATE', date: '2026-03-15' });
  assert.equal(afterTarget.expected, false);
  assert.equal(afterTarget.reason, 'session_cap_reached');
});

test('a target session enrollment ignores its stored end date until it completes', () => {
  assert.equal(applicabilityService.periodEffectiveEndDate(targetPeriod), '9999-12-31');
  assert.equal(applicabilityService.periodCoversSession(targetPeriod, {
    sessionId: 'SES_LATER',
    date: '2026-06-01'
  }), true);
});

test('automatic completion reopens after a counted attendance correction', () => {
  const autoCompleted = {
    ...targetPeriod,
    status: 'completed',
    completionDate: '2026-03-08',
    completionSessionId: 'SES_EXCUSED',
    completionReason: applicabilityService.TARGET_SESSION_COMPLETION_REASON
  };
  const reopen = applicabilityService.buildSessionCappedEnrollmentCompletionPatch(autoCompleted, {
    targetSessionCount: 4,
    completionCandidate: null
  }, 'USER_001');
  const manual = applicabilityService.buildSessionCappedEnrollmentCompletionPatch({
    ...autoCompleted,
    completionReason: 'manual_completion'
  }, {
    targetSessionCount: 4,
    completionCandidate: null
  }, 'USER_001');

  assert.deepEqual(reopen, {
    status: 'active',
    completionDate: '',
    completionSessionId: '',
    completionReason: '',
    updatedBy: 'USER_001'
  });
  assert.equal(manual, null);
});

test('ACF attendance counts toward rolling enrollment target like absent', () => {
  const period = {
    id: 'PERIOD_ACF',
    studentId: 'STUDENT_001',
    status: 'active',
    startDate: '2026-02-01',
    endDate: '2026-02-15',
    targetSessionCount: 2,
    sessionCountPolicy: 'all_non_na'
  };
  const sessions = [
    attendance('SES_ACF', '2026-02-01', attendanceMatrixMetricsService.ATTENDANCE_STATUS.ACF),
    attendance('SES_PRESENT', '2026-02-08', attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT),
    attendance('SES_AFTER', '2026-02-15', attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT)
  ];
  const result = applicabilityService.resolveRollingEnrollmentApplicability({
    sessions,
    periodRows: [period],
    studentToPersonMap
  });
  const summary = result.summariesByPeriodId.get(period.id);
  assert.equal(summary.consumedCount, 2);
  assert.equal(summary.remainingCount, 0);
  assert.deepEqual(summary.completionCandidate, { sessionId: 'SES_PRESENT', date: '2026-02-08' });
});

function attendanceWithHours(sessionId, date, status, durationHours = 3) {
  return {
    sessionId,
    date,
    status: 'completed',
    durationHours,
    roster: [{ personId, attendance: status }]
  };
}

test('hour target enrollment consumes session hours until target is reached', () => {
  const hourPeriod = {
    id: 'PERIOD_HOURS',
    studentId: 'STUDENT_001',
    status: 'active',
    startDate: '2026-02-01',
    endDate: '',
    targetHours: 6,
    sessionCountPolicy: 'all_non_na'
  };
  const sessions = [
    attendanceWithHours('SES_001', '2026-02-01', attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT, 3),
    attendanceWithHours('SES_002', '2026-02-08', attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT, 3),
    attendanceWithHours('SES_003', '2026-02-15', attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT, 3)
  ];
  const result = applicabilityService.resolveRollingEnrollmentApplicability({
    sessions,
    periodRows: [hourPeriod],
    studentToPersonMap
  });
  const summary = result.summariesByPeriodId.get(hourPeriod.id);
  const afterTarget = applicabilityService.getApplicabilityState(
    result.stateByKey,
    personId,
    sessions[2]
  );

  assert.equal(summary.consumedCount, 2);
  assert.equal(summary.consumedHours, 6);
  assert.equal(summary.remainingHours, 0);
  assert.deepEqual(summary.completionCandidate, { sessionId: 'SES_002', date: '2026-02-08' });
  assert.equal(afterTarget.expected, false);
  assert.equal(afterTarget.reason, 'hour_cap_reached');
});

test('hour target enrollment ignores stored end date until completion', () => {
  const hourPeriod = {
    id: 'PERIOD_HOURS_END',
    studentId: 'STUDENT_001',
    status: 'active',
    startDate: '2026-02-01',
    endDate: '2026-02-15',
    targetHours: 6,
    sessionCountPolicy: 'all_non_na'
  };
  assert.equal(applicabilityService.periodEffectiveEndDate(hourPeriod), '9999-12-31');
  assert.equal(applicabilityService.periodCoversSession(hourPeriod, {
    sessionId: 'SES_LATER',
    date: '2026-06-01'
  }), true);
});

function unmarkedSession(sessionId, date, extra = {}) {
  return {
    sessionId,
    date,
    status: 'scheduled',
    roster: [],
    ...extra
  };
}

test('session cap expects only the next unmarked sessions after the start date', () => {
  const period = {
    ...targetPeriod,
    id: 'PERIOD_WINDOW',
    startDate: '2026-10-20',
    targetSessionCount: 10
  };
  const sessions = [];
  for (let index = 0; index < 12; index += 1) {
    const day = 20 + index;
    sessions.push(unmarkedSession(`SES_${index + 1}`, `2026-10-${String(day).padStart(2, '0')}`));
  }
  sessions.unshift(unmarkedSession('SES_BEFORE', '2026-10-19'));

  const result = applicabilityService.resolveRollingEnrollmentApplicability({
    sessions,
    periodRows: [period],
    studentToPersonMap
  });

  sessions.slice(1, 11).forEach((session) => {
    const state = applicabilityService.getApplicabilityState(result.stateByKey, personId, session);
    assert.equal(state.expected, true, session.sessionId);
  });
  const beyond = applicabilityService.getApplicabilityState(result.stateByKey, personId, sessions[11]);
  const further = applicabilityService.getApplicabilityState(result.stateByKey, personId, sessions[12]);
  assert.equal(beyond.expected, false);
  assert.equal(beyond.reason, 'session_cap_reached');
  assert.equal(further.expected, false);
  assert.equal(further.reason, 'session_cap_reached');
  const before = applicabilityService.getApplicabilityState(result.stateByKey, personId, sessions[0]);
  assert.equal(before, null);
  const summary = result.summariesByPeriodId.get(period.id);
  assert.equal(summary.consumedCount, 0);
  assert.equal(summary.reservedCount, 10);
  assert.equal(summary.completionCandidate, null);
});

test('a not-applicable session extends the session cap window by one', () => {
  const period = {
    ...targetPeriod,
    id: 'PERIOD_NA_EXTEND',
    startDate: '2026-10-20',
    targetSessionCount: 2
  };
  const sessions = [
    unmarkedSession('SES_1', '2026-10-20'),
    attendance('SES_NA', '2026-10-21', attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE),
    unmarkedSession('SES_2', '2026-10-22'),
    unmarkedSession('SES_3', '2026-10-23')
  ];
  const result = applicabilityService.resolveRollingEnrollmentApplicability({
    sessions,
    periodRows: [period],
    studentToPersonMap
  });
  assert.equal(applicabilityService.getApplicabilityState(result.stateByKey, personId, sessions[0]).expected, true);
  assert.equal(applicabilityService.getApplicabilityState(result.stateByKey, personId, sessions[1]).expected, false);
  assert.equal(applicabilityService.getApplicabilityState(result.stateByKey, personId, sessions[1]).reason, 'manual_not_applicable');
  assert.equal(applicabilityService.getApplicabilityState(result.stateByKey, personId, sessions[2]).expected, true);
  const extended = applicabilityService.getApplicabilityState(result.stateByKey, personId, sessions[3]);
  assert.equal(extended.expected, false);
  assert.equal(extended.reason, 'session_cap_reached');
});

test('hour cap expects sessions until allocated hours reach the target and N/A adds those hours back', () => {
  const period = {
    id: 'PERIOD_HOUR_WINDOW',
    studentId: 'STUDENT_001',
    status: 'active',
    startDate: '2026-10-20',
    targetHours: 4
  };
  const sessions = [
    unmarkedSession('SES_1', '2026-10-20', { durationHours: 2 }),
    attendanceWithHours('SES_NA', '2026-10-21', attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE, 2),
    unmarkedSession('SES_2', '2026-10-22', { durationHours: 2 }),
    unmarkedSession('SES_3', '2026-10-23', { durationHours: 2 }),
    unmarkedSession('SES_4', '2026-10-24', { durationHours: 2 })
  ];
  const result = applicabilityService.resolveRollingEnrollmentApplicability({
    sessions,
    periodRows: [period],
    studentToPersonMap
  });
  assert.equal(applicabilityService.getApplicabilityState(result.stateByKey, personId, sessions[0]).expected, true);
  assert.equal(applicabilityService.getApplicabilityState(result.stateByKey, personId, sessions[1]).reason, 'manual_not_applicable');
  assert.equal(applicabilityService.getApplicabilityState(result.stateByKey, personId, sessions[2]).expected, true);
  const beyond = applicabilityService.getApplicabilityState(result.stateByKey, personId, sessions[3]);
  assert.equal(beyond.expected, false);
  assert.equal(beyond.reason, 'hour_cap_reached');
  assert.equal(applicabilityService.getApplicabilityState(result.stateByKey, personId, sessions[4]).reason, 'hour_cap_reached');
  const summary = result.summariesByPeriodId.get(period.id);
  assert.equal(summary.consumedHours, 0);
  assert.equal(summary.reservedHours, 4);
  assert.equal(summary.completionCandidate, null);
});

test('sanitizeSessionCapFields rejects both session and hour targets', () => {
  assert.throws(() => {
    applicabilityService.sanitizeSessionCapFields({
      targetSessionCount: 5,
      targetHours: 20
    });
  }, /not both/);
});
