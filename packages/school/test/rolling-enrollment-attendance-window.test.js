const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const applicabilityService = require('../MVC/services/school/classEnrollmentSessionApplicabilityService');

const studentToPersonMap = new Map([['STU_1', 'PER_1']]);

function windowFor(date, period = {}, allowedStatuses = applicabilityService.ROLLING_ATTENDANCE_WINDOW_STATUSES) {
  return applicabilityService.resolveRollingEnrollmentWindowForPerson({
    periodRows: [{
      id: 'PERIOD_1',
      orgId: 'ORG_1',
      studentId: 'STU_1',
      status: 'active',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      ...period
    }],
    studentToPersonMap,
    personId: 'PER_1',
    session: { sessionId: `SES_${date}`, date },
    activeOrgId: 'ORG_1',
    allowedStatuses
  });
}

function manualCloseSnapshot(endDate = '2026-10-09') {
  return {
    transactionSummary: {
      lastCloseSnapshot: {
        closedEndDate: endDate,
        closedAt: '2026-10-13T12:00:00.000Z',
        closedStatus: 'withdrawn'
      }
    }
  };
}

test('rolling attendance window includes enrollment boundaries and excludes dates outside them', () => {
  assert.equal(windowFor('2026-07-01').withinEnrollmentWindow, true);
  assert.equal(windowFor('2026-07-31').withinEnrollmentWindow, true);
  assert.equal(windowFor('2026-06-30').withinEnrollmentWindow, false);
  assert.equal(windowFor('2026-08-01').withinEnrollmentWindow, false);
});

test('rolling attendance window supports open-ended and completion-shortened enrollments', () => {
  assert.equal(windowFor('2027-01-15', { endDate: '' }).withinEnrollmentWindow, true);
  assert.equal(windowFor('2026-07-10', { completionDate: '2026-07-10' }).withinEnrollmentWindow, true);
  assert.equal(windowFor('2026-07-11', { completionDate: '2026-07-10' }).withinEnrollmentWindow, false);
});

test('manual close before session target keeps enrollment window open past close date', () => {
  const period = {
    status: 'completed',
    startDate: '2026-07-01',
    endDate: '2026-10-15',
    targetSessionCount: 46,
    ...manualCloseSnapshot('2026-10-15')
  };
  assert.equal(applicabilityService.isManualCloseBeforeCapTargetSatisfied(period), true);
  assert.equal(applicabilityService.isEnrollmentCapTargetSatisfied(period), false);
  assert.equal(applicabilityService.periodEffectiveEndDate(period), '9999-12-31');
  const windowNovember = applicabilityService.resolveRollingEnrollmentWindowForPerson({
    periodRows: [{
      id: 'PERIOD_1',
      orgId: 'ORG_1',
      studentId: 'STU_1',
      ...period
    }],
    studentToPersonMap,
    personId: 'PER_1',
    session: { sessionId: 'SES_NOV', date: '2026-11-05' },
    activeOrgId: 'ORG_1',
    allowedStatuses: applicabilityService.ROLLING_ATTENDANCE_WINDOW_STATUSES
  });
  assert.equal(windowNovember.withinEnrollmentWindow, true);
  assert.equal(period.status, 'completed');
});

test('manual completed close with future end date keeps attendance through enrollment end despite earlier completionDate', () => {
  const period = {
    status: 'completed',
    endDate: '2026-10-09',
    targetSessionCount: 46,
    completionDate: '2026-10-01',
    ...manualCloseSnapshot('2026-10-09')
  };
  assert.equal(windowFor('2026-10-05', period).withinEnrollmentWindow, true);
  assert.equal(windowFor('2026-10-09', period).withinEnrollmentWindow, true);
  assert.equal(windowFor('2026-10-10', period).withinEnrollmentWindow, false);
  assert.equal(applicabilityService.periodEffectiveEndDate(period), '2026-10-09');
});

test('withdrawn manual close with snapshot keeps attendance through chosen end date', () => {
  const period = {
    status: 'withdrawn',
    endDate: '2026-10-09',
    targetSessionCount: 46,
    completionDate: '2026-10-01',
    ...manualCloseSnapshot('2026-10-09')
  };
  assert.equal(windowFor('2026-10-05', period).withinEnrollmentWindow, true);
  assert.equal(windowFor('2026-10-10', period).withinEnrollmentWindow, false);
});

test('withdrawn without close snapshot does not extend attendance window', () => {
  const period = {
    status: 'withdrawn',
    endDate: '2026-06-01',
    startDate: '2026-07-01'
  };
  assert.equal(windowFor('2026-07-15', period).withinEnrollmentWindow, false);
});

test('manual scheduled close keeps enrollment window through end date when session cap blocks applicability', () => {
  const period = {
    status: 'withdrawn',
    endDate: '2026-10-09',
    startDate: '2026-07-01',
    targetSessionCount: 3,
    completionDate: '2026-10-01',
    ...manualCloseSnapshot('2026-10-09')
  };
  const sessions = [
    { sessionId: 'SES_1', date: '2026-10-01', roster: [{ personId: 'PER_1', attendance: 'present' }] },
    { sessionId: 'SES_2', date: '2026-10-02', roster: [{ personId: 'PER_1', attendance: 'present' }] },
    { sessionId: 'SES_3', date: '2026-10-03', roster: [{ personId: 'PER_1', attendance: 'present' }] },
    { sessionId: 'SES_4', date: '2026-10-05', roster: [] }
  ];
  const result = applicabilityService.resolveRollingEnrollmentApplicability({
    sessions,
    periodRows: [{ id: 'PERIOD_1', orgId: 'ORG_1', studentId: 'STU_1', ...period }],
    studentToPersonMap,
    activeOrgId: 'ORG_1',
    allowedStatuses: applicabilityService.ROLLING_ATTENDANCE_WINDOW_STATUSES
  });
  const sessionWithinCloseWindow = sessions[3];
  const windowWithinClose = applicabilityService.resolveRollingEnrollmentWindowForPerson({
    periodRows: [{ id: 'PERIOD_1', orgId: 'ORG_1', studentId: 'STU_1', ...period }],
    studentToPersonMap,
    personId: 'PER_1',
    session: sessionWithinCloseWindow,
    activeOrgId: 'ORG_1',
    allowedStatuses: applicabilityService.ROLLING_ATTENDANCE_WINDOW_STATUSES
  });
  const stateWithinClose = applicabilityService.getApplicabilityState(
    result.stateByKey,
    'PER_1',
    sessionWithinCloseWindow
  );
  assert.equal(windowWithinClose.withinEnrollmentWindow, true);
  assert.equal(stateWithinClose?.expected, false);
  assert.equal(stateWithinClose?.reason, 'session_cap_reached');
});

test('automatic target completion still ends attendance at completion date', () => {
  const period = {
    status: 'completed',
    endDate: '2026-10-09',
    targetSessionCount: 46,
    completionDate: '2026-10-01',
    completionReason: applicabilityService.TARGET_SESSION_COMPLETION_REASON,
    ...manualCloseSnapshot('2026-10-09')
  };
  assert.equal(applicabilityService.periodEffectiveEndDate(period), '2026-10-01');
  assert.equal(windowFor('2026-10-05', period).withinEnrollmentWindow, false);
});

test('attendance mutations and the matrix use the enrollment-window guard', () => {
  const attendanceController = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/attendanceController.js'),
    'utf8'
  );
  const sessionController = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/classController.js'),
    'utf8'
  );
  const attendanceView = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/attendance/attendanceViewer.ejs'),
    'utf8'
  );

  assert.match(attendanceController, /resolveRollingEnrollmentWindowForPerson/);
  assert.match(attendanceController, /withinEnrollmentWindow/);
  assert.match(attendanceController, /Attendance cannot be updated because this student was not enrolled/);
  assert.equal((attendanceController.match(/await assertAttendanceEnrollmentWindow\(/g) || []).length, 3);
  assert.match(sessionController, /async function assertSessionRosterEnrollmentWindows/);
  assert.match(sessionController, /await assertSessionRosterEnrollmentWindows\(/);
  assert.match(attendanceView, /cell_modal_enrollment_notice/);
  assert.match(attendanceView, /const outsideEnrollmentWindow = record\.withinEnrollmentWindow === false/);
  assert.match(attendanceView, /!outsideEnrollmentWindow && !makeupRequired/);
  assert.match(attendanceView, /N\/A - not enrolled for this session/);
  assert.match(attendanceController, /ROLLING_ATTENDANCE_WINDOW_STATUSES/);
  assert.match(attendanceController, /isManualScheduledCloseForAttendance/);
  assert.match(sessionController, /ROLLING_ATTENDANCE_WINDOW_STATUSES/);
});
