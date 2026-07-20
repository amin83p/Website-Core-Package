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

function attendance(sessionId, date, status) {
  return {
    sessionId,
    date,
    status: 'completed',
    roster: [{ personId, attendance: status }]
  };
}

test('target session count uses recorded non-N/A attendance after the start date', () => {
  const sessions = [
    attendance('SES_BEFORE', '2026-01-31', attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT),
    attendance('SES_PRESENT', '2026-02-01', attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT),
    attendance('SES_NA', '2026-02-08', attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE),
    { sessionId: 'SES_BLANK', date: '2026-02-15', status: 'completed', roster: [{ personId, attendance: '' }] },
    { sessionId: 'SES_MISSING', date: '2026-02-22', status: 'completed', roster: [] },
    attendance('SES_FORCE_NA', '2026-02-24', attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT),
    attendance('SES_APPROVED_LEAVE', '2026-02-25', attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT),
    attendance('SES_ABSENT', '2026-03-01', attendanceMatrixMetricsService.ATTENDANCE_STATUS.ABSENT),
    attendance('SES_EXCUSED', '2026-03-08', attendanceMatrixMetricsService.ATTENDANCE_STATUS.EXCUSED),
    attendance('SES_LATE', '2026-03-15', attendanceMatrixMetricsService.ATTENDANCE_STATUS.LATE),
    attendance('SES_AFTER_TARGET', '2026-03-22', attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT)
  ];

  const result = applicabilityService.resolveRollingEnrollmentApplicability({
    sessions,
    periodRows: [targetPeriod],
    studentToPersonMap,
    forceNotApplicableSessionKeys: new Set(['SES_FORCE_NA']),
    approvedLeaveKeys: new Set([
      applicabilityService.buildApplicabilityKey(personId, sessions[6])
    ])
  });
  const summary = result.summariesByPeriodId.get(targetPeriod.id);
  const afterTarget = applicabilityService.getApplicabilityState(
    result.stateByKey,
    personId,
    sessions[10]
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
