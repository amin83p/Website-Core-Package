/**
 * Operational attendance pages do not expose School Settings controls or threshold numbers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('matrix API applies the authoritative catalog without exposing policy settings', () => {
  const controller = read('packages/school/MVC/controllers/school/attendanceController.js');
  assert.doesNotMatch(controller, /userCanViewSchoolSettings/);
  assert.doesNotMatch(controller, /payload\.attendancePolicy/);
  assert.match(controller, /getPolicyCatalogForOrg/);
  assert.match(controller, /resolvePolicy\(classData,\s*orgPolicyLayer\)/);
  assert.match(controller, /computeStudentMatrixSummary\(\s*records,\s*classData,\s*orgPolicyCatalog\s*\)/);
});

test('attendance viewer contains no settings link or threshold tooltip', () => {
  const viewer = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');
  assert.match(viewer, /Attendance rollup/);
  assert.doesNotMatch(viewer, /CAN_VIEW_SCHOOL_SETTINGS/);
  assert.doesNotMatch(viewer, /canSeeThresholds/);
  assert.doesNotMatch(viewer, /Matrix Thresholds/);
});

test('session manager shows Attendance matrix link for page access, not only policy admins', () => {
  const classCtrl = read('packages/school/MVC/controllers/school/classController.js');
  assert.match(classCtrl, /userCanOpenAttendanceMatrix/);
  assert.match(classCtrl, /canOpenAttendanceMatrix/);

  const sessionManager = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(sessionManager, /canOpenAttendanceMatrix/);
  assert.match(sessionManager, /id="linkAttendanceMatrix"/);
  assert.doesNotMatch(
    sessionManager,
    /canViewSchoolSettings[\s\S]{0,80}linkAttendanceMatrix/
  );
  assert.doesNotMatch(sessionManager, /attendanceMatrixThresholdHint/);
  assert.doesNotMatch(sessionManager, /\/school\/settings#/);
  assert.match(sessionManager, /__attendanceThresholdsEnabled/);
});

test('open-matrix access remains distinct from School Settings access', () => {
  const matrixAccess = read('packages/school/MVC/services/school/attendanceMatrixAccessService.js');
  const settingsAccess = read('packages/school/MVC/services/school/schoolSettingsAccessService.js');
  assert.match(matrixAccess, /userCanOpenAttendanceMatrix/);
  assert.match(matrixAccess, /SECTIONS\.SCHOOL_ATTENDANCES/);
  assert.match(matrixAccess, /isAttendancesAdminViewerAsync/);
  assert.match(settingsAccess, /SECTIONS\.SCHOOL_SETTINGS/);
  assert.match(settingsAccess, /OPERATIONS\.READ_ALL/);
  assert.match(settingsAccess, /OPERATIONS\.UPDATE/);
});
