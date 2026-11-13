const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isEnrollmentPeriodEligibleForScheduleSession,
  enrollmentPeriodOverlapsScheduleRange
} = require('../MVC/controllers/school/scheduleController');

test('completed rolling enrollment still covers sessions before effective end', () => {
  const period = {
    id: 'P1',
    studentId: 'S1',
    status: 'completed',
    startDate: '2025-09-01',
    endDate: '2025-11-30',
    completionDate: '2025-11-15'
  };
  const classRow = { registrationMode: 'rolling' };
  const studentToPersonMap = new Map([['S1', '489731']]);
  const eligible = isEnrollmentPeriodEligibleForScheduleSession({
    period,
    sessionDate: '2025-10-15',
    session: { date: '2025-10-15', startTime: '09:00', endTime: '10:00' },
    classRow,
    personId: '489731',
    studentToPersonMap
  });
  assert.equal(eligible, true);
});

test('withdrawn rolling enrollment still covers sessions inside window', () => {
  const period = {
    id: 'P2',
    studentId: 'S1',
    status: 'withdrawn',
    startDate: '2025-09-01',
    endDate: '2025-12-31',
    completionDate: '2025-11-20'
  };
  const classRow = { registrationMode: 'rolling' };
  const studentToPersonMap = new Map([['S1', '489731']]);
  const eligible = isEnrollmentPeriodEligibleForScheduleSession({
    period,
    sessionDate: '2025-11-10',
    classRow,
    personId: '489731',
    studentToPersonMap
  });
  assert.equal(eligible, true);
});

test('enrollmentPeriodOverlapsScheduleRange includes completed periods in range', () => {
  const period = {
    status: 'completed',
    startDate: '2025-09-01',
    endDate: '2025-11-30',
    completionDate: '2025-11-15'
  };
  assert.equal(enrollmentPeriodOverlapsScheduleRange(period, '2025-10-01', '2025-10-31'), true);
  assert.equal(enrollmentPeriodOverlapsScheduleRange(period, '2025-12-01', '2025-12-31'), false);
});
