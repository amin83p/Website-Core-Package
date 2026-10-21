const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const classEnrollmentReadService = require('../MVC/services/school/classEnrollmentReadService');
const applicabilityService = require('../MVC/services/school/classEnrollmentSessionApplicabilityService');

test('periodOverlapsWindow respects periodEffectiveEndDate for early completion', () => {
  const period = {
    status: 'completed',
    startDate: '2026-07-01',
    endDate: '2026-10-09',
    targetSessionCount: 46,
    completionDate: '2026-07-15',
    completionReason: applicabilityService.TARGET_SESSION_COMPLETION_REASON
  };
  const statuses = new Set(['active', 'planned', 'completed', 'withdrawn']);
  assert.equal(applicabilityService.periodEffectiveEndDate(period), '2026-07-15');
  assert.equal(
    classEnrollmentReadService.periodOverlapsWindow(period, '2026-07-10', '2026-07-20', statuses),
    true
  );
  assert.equal(
    classEnrollmentReadService.periodOverlapsWindow(period, '2026-08-01', '2026-08-31', statuses),
    false
  );
});

test('attendance matrix rolling roster uses enrollment window overlap not applicability personIds', () => {
  const attendanceController = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/attendanceController.js'),
    'utf8'
  );
  const attendanceView = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/attendance/attendanceViewer.ejs'),
    'utf8'
  );

  assert.match(attendanceController, /listPersonIdsOverlappingEnrollmentWindow/);
  assert.match(attendanceController, /ROLLING_ATTENDANCE_WINDOW_STATUSES/);
  assert.doesNotMatch(
    attendanceController,
    /rollingApplicability\.personIds\.forEach/
  );
  assert.match(attendanceView, /attendanceRecordHasNotes/);
  assert.match(attendanceView, /rosterStudentNotes/);
  assert.match(attendanceView, /excuseRef/);
});
