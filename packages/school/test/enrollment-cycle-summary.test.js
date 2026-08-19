const test = require('node:test');
const assert = require('node:assert/strict');

const summaryService = require('../MVC/services/school/enrollmentCycleSummaryService');
const attendanceMatrixMetricsService = require('../MVC/services/school/attendanceMatrixMetricsService');

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

test('buildPeriodAttendanceSummary counts consumed sessions and excused splits', () => {
  const period = {
    id: 'PER_001',
    classId: 'CLS_001',
    personId,
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    targetSessionCount: 10
  };
  const sessions = [
    session('S1', '2026-01-05', { attendance: 'present' }),
    session('S2', '2026-01-12', { attendance: 'late', lateMinutes: 5 }),
    session('S3', '2026-01-19', { attendance: 'absent', absenceExcused: true }),
    session('S4', '2026-01-26', { attendance: 'acf' }),
    session('S5', '2026-02-02', { attendance: 'not_applicable' }),
    session('S6', '2026-04-01', { attendance: 'present' })
  ];
  const summary = summaryService.buildPeriodAttendanceSummary({
    period,
    sessions,
    studentPersonId: personId,
    classData
  });
  assert.equal(summary.consumedSessions, 4);
  assert.equal(summary.present, 2);
  assert.equal(summary.absent, 1);
  assert.equal(summary.absentExcused, 1);
  assert.equal(summary.acf, 1);
  assert.equal(summary.notApplicableSessions, 1);
  assert.equal(summary.remainingSessions, 6);
});

test('buildPeriodAttendanceSummary excludes sessions outside date window', () => {
  const period = {
    personId,
    startDate: '2026-02-01',
    endDate: '2026-02-28'
  };
  const sessions = [
    session('S1', '2026-01-15', { attendance: 'present' }),
    session('S2', '2026-02-10', { attendance: 'present' })
  ];
  const summary = summaryService.buildPeriodAttendanceSummary({
    period,
    sessions,
    studentPersonId: personId,
    classData
  });
  assert.equal(summary.consumedSessions, 1);
  assert.equal(summary.present, 1);
});

test('computeRemainingCap uses hour targets when session cap is unset', () => {
  const period = { targetHours: 4 };
  const summary = { consumedHours: 1.5, targetHours: 4 };
  const remaining = summaryService.computeRemainingCap({ period, summary });
  assert.equal(remaining.remainingHours, 2.5);
  assert.equal(remaining.remainingSessions, 0);
});

test('listSessionsInEnrollmentWindow for cap enrollment includes sessions after start with no end', () => {
  const period = {
    startDate: '2026-01-01',
    targetSessionCount: 5
  };
  const sessions = [
    session('S1', '2025-12-15', {}),
    session('S2', '2026-01-10', {}),
    session('S3', '2026-06-01', {})
  ];
  const window = summaryService.listSessionsInEnrollmentWindow(period, sessions);
  assert.deepEqual(window.map((row) => row.id), ['S2', 'S3']);
});

test('filterEnrollmentMarksFromBoundary keeps marks on or after boundary', () => {
  const marks = [
    { sessionId: 'S1', status: 'not_applicable' },
    { sessionId: 'S2', status: 'not_applicable' }
  ];
  const sessions = [
    session('S1', '2026-01-05', {}),
    session('S2', '2026-02-01', {})
  ];
  const filtered = summaryService.filterEnrollmentMarksFromBoundary(marks, sessions, '2026-02-01');
  assert.deepEqual(filtered.map((row) => row.sessionId), ['S2']);
});
