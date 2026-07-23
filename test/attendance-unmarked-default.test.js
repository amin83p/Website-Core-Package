const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('attendance matrix payload defaults expected_missing to empty, keeps N/A', () => {
  const controller = read('packages/school/MVC/controllers/school/attendanceController.js');
  assert.match(controller, /normalizeAttendanceStatusForSave\(rosterRecord\.attendance,\s*''\)/);
  assert.match(controller, /expectedForSession \? '' :/);
  assert.match(controller, /expected_missing/);
  assert.match(controller, /NOT_APPLICABLE/);
  assert.doesNotMatch(
    controller,
    /expectedForSession \? attendanceMatrixMetricsService\.ATTENDANCE_STATUS\.ABSENT/
  );
});

test('grades matrix mirrors empty unmarked attendance default', () => {
  const controller = read('packages/school/MVC/controllers/school/gradesMatrixController.js');
  assert.match(controller, /normalizeAttendanceStatusForSave\(rosterRecord\.attendance,\s*''\)/);
  assert.match(controller, /expectedForSession \? '' :/);
  assert.doesNotMatch(
    controller,
    /expectedForSession \? attendanceMatrixMetricsService\.ATTENDANCE_STATUS\.ABSENT/
  );
});

test('viewer and hub show unmarked distinctly from N/A and absent', () => {
  const viewer = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');
  assert.match(viewer, /Not marked yet/);
  assert.match(viewer, /status === 'not_applicable'/);
  assert.match(viewer, /status === 'absent'/);

  const hub = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');
  assert.match(hub, /Not marked yet/);
  assert.match(hub, /value === 'not_applicable'/);
});

test('metrics export unmarked helpers', () => {
  const metrics = read('packages/school/MVC/services/school/attendanceMatrixMetricsService.js');
  assert.match(metrics, /isUnmarkedAttendanceStatus/);
  assert.match(metrics, /!isUnmarkedAttendanceStatus\(status\)/);

  const excel = read('packages/school/MVC/services/school/attendanceExcelExportService.js');
  assert.match(excel, /normalizeAttendanceStatusForSave\(status, ''\)/);
});
