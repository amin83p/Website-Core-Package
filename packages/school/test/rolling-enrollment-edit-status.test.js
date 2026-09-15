const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const applicabilityService = require('../MVC/services/school/classEnrollmentSessionApplicabilityService');
const attendanceMatrixMetricsService = require('../MVC/services/school/attendanceMatrixMetricsService');

const viewSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs'),
  'utf8'
);
const controllerSource = fs.readFileSync(
  path.join(__dirname, '../MVC/controllers/school/classRollingEnrollmentController.js'),
  'utf8'
);

const personId = 'PERSON_001';
const studentToPersonMap = new Map([['STUDENT_001', personId]]);
const targetPeriod = {
  id: 'PERIOD_001',
  studentId: 'STUDENT_001',
  status: 'active',
  startDate: '2026-02-01',
  endDate: '2026-02-28'
};

function session(sessionId, date, attendanceStatus) {
  return {
    sessionId,
    date,
    status: 'completed',
    roster: [{ personId, attendance: attendanceStatus }]
  };
}

test('periodHasNonNaAttendanceMarkings is false for blank or N/A only markings', () => {
  const sessions = [
    session('SES_NA', '2026-02-01', attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE),
    { sessionId: 'SES_BLANK', date: '2026-02-08', status: 'completed', roster: [{ personId, attendance: '' }] }
  ];
  assert.equal(applicabilityService.periodHasNonNaAttendanceMarkings({
    period: targetPeriod,
    sessions,
    studentToPersonMap
  }), false);
});

test('periodHasNonNaAttendanceMarkings is true when any non-N/A attendance exists', () => {
  const sessions = [
    session('SES_PRESENT', '2026-02-01', attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT),
    session('SES_NA', '2026-02-08', attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE)
  ];
  assert.equal(applicabilityService.periodHasNonNaAttendanceMarkings({
    period: targetPeriod,
    sessions,
    studentToPersonMap
  }), true);
});

test('edit modal status options match enrollment modal open statuses plus close', () => {
  const editStatusBlock = viewSource.slice(
    viewSource.indexOf('id="edit_status"'),
    viewSource.indexOf('id="wrap_edit_statusReadonly"')
  );
  assert.match(editStatusBlock, /value="active"/);
  assert.match(editStatusBlock, /value="to_be_confirmed"/);
  assert.match(editStatusBlock, /value="waiting_list"/);
  assert.match(editStatusBlock, /value="close"/);
  assert.doesNotMatch(editStatusBlock, /value="draft"/);
  assert.doesNotMatch(editStatusBlock, /value="planned"/);
  assert.doesNotMatch(editStatusBlock, /value="error"/);
});

test('edit modal close reasons include withdrawn cancelled archived and completed', () => {
  assert.match(viewSource, /id="edit_closeReason"/);
  assert.match(viewSource, /value="withdrawn"/);
  assert.match(viewSource, /value="cancelled"/);
  assert.match(viewSource, /value="archived"/);
  assert.match(viewSource, /value="completed"/);
  assert.match(viewSource, /function syncEditStatusUi\(/);
  assert.match(viewSource, /hasNonNaAttendanceMarkings/);
  assert.match(viewSource, /function previewEditClosePeriod\(/);
});

test('close period modal includes withdrawn and skips preview for withdrawn', () => {
  const closeStatusBlock = viewSource.slice(
    viewSource.indexOf('id="close_status"'),
    viewSource.indexOf('id="close_reasonEnd"')
  );
  assert.match(closeStatusBlock, /value="withdrawn"/);
  assert.match(viewSource, /function syncCloseModalUi\(/);
  assert.match(viewSource, /payload\.targetStatus === 'withdrawn'/);
  assert.match(viewSource, /\/enrollment-periods\/\$\{encodeURIComponent\(periodId\)\}\/close/);
});

test('editClassEnrollmentPeriod allows open status transitions with attendance guard', () => {
  assert.match(controllerSource, /OPEN_EDITABLE_STATUSES/);
  assert.match(controllerSource, /periodHasNonNaAttendanceMarkings/);
  assert.match(controllerSource, /Cannot change to Waiting List or To Be Confirmed when attendance has been recorded/);
});

test('closeClassEnrollmentPeriod supports withdrawn close workflow', () => {
  assert.match(controllerSource, /async function closeClassEnrollmentPeriod/);
  assert.match(controllerSource, /closeClassEnrollmentPeriod\(periodId, \{\s*status: 'withdrawn'/);
  assert.match(controllerSource, /Enrollment marked as withdrawn/);
});

test('rolling enrollment view includes undo close workflow', () => {
  assert.match(viewSource, /id="undoClosePeriodModal"/);
  assert.match(viewSource, /btn-row-undo-close/);
  assert.match(viewSource, /undo-close\/preview/);
  assert.match(viewSource, /undo-close/);
});
