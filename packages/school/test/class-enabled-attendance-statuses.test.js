const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const attendanceMatrixMetricsService = require('../MVC/services/school/attendanceMatrixMetricsService');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('class form exposes Attendance Statuses tab and hidden field', () => {
  const form = read('MVC/views/school/class/classForm.ejs');
  assert.match(form, /tab-attendance-statuses/);
  assert.match(form, /Attendance Statuses/);
  assert.match(form, /hid_enabledAttendanceStatuses/);
  assert.match(form, /att-status-optional/);
  assert.match(form, /enabledAttendanceStatuses/);
});

test('getClassTemplate includes enabledAttendanceStatuses', () => {
  const controller = read('MVC/controllers/school/classController.js');
  assert.match(controller, /enabledAttendanceStatuses:\s*attendanceMatrixMetricsService\.resolveEnabledAttendanceStatuses\(classData\)/);
  assert.match(controller, /enabledAttendanceStatuses,/);
});

test('session manager and attendance matrix consume enabledAttendanceStatuses', () => {
  const sessionManager = read('MVC/views/school/class/sessionManager.ejs');
  const attendanceViewer = read('MVC/views/school/attendance/attendanceViewer.ejs');
  const attendanceController = read('MVC/controllers/school/attendanceController.js');

  assert.match(sessionManager, /resolvedEnabledAttendanceStatuses/);
  assert.match(sessionManager, /isAttendanceStatusShown/);
  assert.match(attendanceViewer, /getMatrixEnabledAttendanceStatuses/);
  assert.match(attendanceViewer, /syncModalAttendanceOptions/);
  assert.match(attendanceController, /enabledAttendanceStatuses/);
  assert.match(attendanceController, /assertAttendanceStatusAllowedForSave/);
});

test('copy-from-class apply path syncs attendance status checkboxes', () => {
  const form = read('MVC/views/school/class/classForm.ejs');
  assert.match(form, /syncAttendanceStatusCheckboxesFromList/);
  assert.match(form, /source\?\.enabledAttendanceStatuses/);
});

test('resolver helpers remain the single source of truth for class status lists', () => {
  const enabled = attendanceMatrixMetricsService.normalizeEnabledAttendanceStatuses(['excused']);
  assert.deepEqual(enabled, ['present', 'excused', 'absent', 'not_applicable']);
  assert.equal(
    attendanceMatrixMetricsService.resolveEnabledAttendanceStatuses({
      enabledAttendanceStatuses: ['present', 'absent', 'acf']
    }).includes('acf'),
    true
  );
  assert.equal(
    attendanceMatrixMetricsService.MANDATORY_ATTENDANCE_STATUSES.includes('not_applicable'),
    true
  );
});
