const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const applicabilityService = require('../MVC/services/school/classEnrollmentSessionApplicabilityService');

const studentToPersonMap = new Map([['STU_1', 'PER_1']]);

function windowFor(date, period = {}) {
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
    allowedStatuses: applicabilityService.OPEN_OR_HISTORICAL_STATUSES
  });
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
});
