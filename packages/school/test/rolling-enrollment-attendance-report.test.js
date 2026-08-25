const test = require('node:test');
const assert = require('node:assert/strict');

const reportService = require('../MVC/services/school/rollingEnrollmentAttendanceReportService');

const personId = 'PERSON_001';
const classData = { id: 'CLS_001' };

function session(id, date, rosterRow) {
  return {
    id,
    sessionId: id,
    date,
    startTime: '09:00',
    endTime: '10:00',
    status: 'scheduled',
    roster: rosterRow ? [{ personId, ...rosterRow }] : []
  };
}

test('resolveReportDate clamps to period window and today', () => {
  const period = { startDate: '2026-01-01', endDate: '2026-03-31' };
  assert.equal(reportService.resolveReportDate(period, '2025-12-01', '2026-02-15'), '2026-01-01');
  assert.equal(reportService.resolveReportDate(period, '2026-04-01', '2026-02-15'), '2026-02-15');
  assert.equal(reportService.resolveReportDate(period, '', '2026-05-01'), '2026-03-31');
});

test('buildShortcutMetadata exposes end date and enrollment targets', () => {
  assert.deepEqual(reportService.buildShortcutMetadata({
    endDate: '2026-06-30',
    targetSessionCount: 12,
    targetHours: 0
  }), {
    hasEndDate: true,
    endDate: '2026-06-30',
    targetSessionCount: 12,
    targetHours: 0
  });
  assert.deepEqual(reportService.buildShortcutMetadata({
    endDate: '',
    targetSessionCount: 0,
    targetHours: 8
  }), {
    hasEndDate: false,
    endDate: '',
    targetSessionCount: 0,
    targetHours: 8
  });
});

test('buildExtendedAttendanceMetrics respects reportDate boundary', () => {
  const period = {
    id: 'PER_001',
    classId: 'CLS_001',
    personId,
    startDate: '2026-01-01',
    endDate: '2026-03-31'
  };
  const sessions = [
    session('S1', '2026-01-05', { attendance: 'present' }),
    session('S2', '2026-02-10', { attendance: 'present' }),
    session('S3', '2026-03-15', { attendance: 'present' })
  ];
  const { summary } = reportService.buildExtendedAttendanceMetrics({
    period,
    sessions,
    studentPersonId: personId,
    classData,
    reportDate: '2026-02-15'
  });
  assert.equal(summary.totalSessionsToDate, 2);
  assert.equal(summary.presentOnly, 2);
});

test('buildExtendedAttendanceMetrics counts late, early leave, excused splits, and ACF', () => {
  const period = {
    personId,
    startDate: '2026-01-01',
    endDate: '2026-03-31'
  };
  const sessions = [
    session('S1', '2026-01-05', { attendance: 'present' }),
    session('S2', '2026-01-12', { attendance: 'late', lateMinutes: 5 }),
    session('S3', '2026-01-19', { attendance: 'present', earlyLeaveMinutes: 10, earlyLeaveExcused: true }),
    session('S4', '2026-01-26', { attendance: 'late', lateMinutes: 3, lateExcused: true }),
    session('S5', '2026-02-02', { attendance: 'absent', absenceExcused: true }),
    session('S6', '2026-02-09', { attendance: 'acf', absenceExcused: true }),
    session('S7', '2026-02-16', { attendance: 'absent' })
  ];
  const { summary } = reportService.buildExtendedAttendanceMetrics({
    period,
    sessions,
    studentPersonId: personId,
    classData
  });
  assert.equal(summary.totalSessionsToDate, 7);
  assert.equal(summary.presentOnly, 2);
  assert.equal(summary.lateSessions, 2);
  assert.equal(summary.earlyLeaveSessions, 1);
  assert.equal(summary.lateExcusedSessions, 1);
  assert.equal(summary.earlyLeaveExcusedSessions, 1);
  assert.equal(summary.absent, 2);
  assert.equal(summary.absentExcused, 1);
  assert.equal(summary.acf, 1);
  assert.equal(summary.acfExcused, 1);
});

test('buildExtendedAttendanceMetrics collects N/A reasons from marks and roster', () => {
  const period = {
    personId,
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    enrollmentSessionMarks: [
      { sessionId: 'S1', status: 'not_applicable', note: 'Holiday closure' }
    ]
  };
  const sessions = [
    session('S1', '2026-01-05', { attendance: 'present' }),
    session('S2', '2026-01-12', { attendance: 'not_applicable', notes: 'Student away', excuseRef: 'EXC-1' }),
    session('S3', '2026-04-01', { attendance: 'not_applicable', notes: 'Outside report window' })
  ];
  const { summary, naReasons } = reportService.buildExtendedAttendanceMetrics({
    period,
    sessions,
    studentPersonId: personId,
    classData,
    reportDate: '2026-03-31'
  });
  assert.equal(summary.notApplicableSessions, 1);
  assert.equal(naReasons.length, 2);
  assert.deepEqual(naReasons[0], {
    date: '2026-01-05',
    sessionId: 'S1',
    reason: 'Holiday closure',
    source: 'Enrollment mark'
  });
  assert.deepEqual(naReasons[1], {
    date: '2026-01-12',
    sessionId: 'S2',
    reason: 'Student away | EXC-1',
    source: 'Attendance roster'
  });
});

test('buildExtendedAttendanceMetrics counts unmarked sessions', () => {
  const period = { personId, startDate: '2026-01-01', endDate: '2026-03-31' };
  const sessions = [
    session('S1', '2026-01-05', { attendance: 'present' }),
    session('S2', '2026-01-12', {})
  ];
  const { summary } = reportService.buildExtendedAttendanceMetrics({
    period,
    sessions,
    studentPersonId: personId,
    classData
  });
  assert.equal(summary.totalSessionsToDate, 2);
  assert.equal(summary.unmarkedSessions, 1);
});
