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
  assert.match(controller, /filterMatrixPayloadForScope/);
});

test('attendance viewer contains no settings link or threshold tooltip', () => {
  const viewer = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');
  assert.match(viewer, /Attendance rollup/);
  assert.doesNotMatch(viewer, /CAN_VIEW_SCHOOL_SETTINGS/);
  assert.doesNotMatch(viewer, /canSeeThresholds/);
  assert.doesNotMatch(viewer, /Matrix Thresholds/);
});

test('attendance viewer hides manage buttons for limited access like master schedule', () => {
  const viewer = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');
  const controller = read('packages/school/MVC/controllers/school/attendanceController.js');
  assert.match(controller, /resolveAttendanceAccessForRequest/);
  assert.match(controller, /getAttendanceAccessForRequest/);
  assert.match(controller, /isAttendanceAdminViewer/);
  assert.match(viewer, /showAttendanceManageBtns/);
  assert.match(viewer, /manageBtns:\s*attManageBtns/);
  assert.match(viewer, /showAttendanceManageBtns\s*\?\s*\[/);
});

test('session manager shows Attendance matrix link for page access, not only policy admins', () => {
  const classCtrl = read('packages/school/MVC/controllers/school/classController.js');
  assert.match(classCtrl, /userCanOpenAttendanceMatrix/);
  assert.match(classCtrl, /canOpenAttendanceMatrix/);

  const sessionManager = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(sessionManager, /canOpenAttendanceMatrix/);
  assert.match(sessionManager, /id="linkAttendanceMatrix"/);
  assert.match(sessionManager, /session-panel-attendance[\s\S]*id="linkAttendanceMatrix"/);
  assert.match(sessionManager, /range=thisMonth/);
  assert.match(sessionManager, /session-panel-gradebook[\s\S]*id="linkGradesMatrix"/);
  assert.doesNotMatch(sessionManager, /session-manager-class-nav-toggle/);
  assert.doesNotMatch(sessionManager, /id="linkFinalGradesNav"/);
  assert.doesNotMatch(sessionManager, /Enrollment outcomes/);
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
  assert.match(matrixAccess, /buildAttendanceAccess/);
  assert.match(matrixAccess, /canOpenMatrix/);
  assert.match(settingsAccess, /SECTIONS\.SCHOOL_SETTINGS/);
  assert.match(settingsAccess, /OPERATIONS\.READ_ALL/);
  assert.match(settingsAccess, /OPERATIONS\.UPDATE/);
});

test('attendance matrix excuse marking follows access flags in controller and viewer', () => {
  const matrixAccess = read('packages/school/MVC/services/school/attendanceMatrixAccessService.js');
  const controller = read('packages/school/MVC/controllers/school/attendanceController.js');
  const viewer = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');

  assert.match(matrixAccess, /userCanMarkAttendanceExcused/);
  assert.match(matrixAccess, /canMarkExcused/);

  assert.match(controller, /canMarkAttendanceExcused/);
  assert.match(controller, /resolveAttendanceAccessForRequest/);
  assert.match(controller, /savedExcuseState/);
  assert.match(controller, /if \(canMarkAttendanceExcused\) \{[\s\S]*rosterRecord\.lateExcused/);
  assert.match(controller, /else \{[\s\S]*rosterRecord\.lateExcused = savedExcuseState\.lateExcused/);

  assert.match(viewer, /CAN_MARK_ATTENDANCE_EXCUSED/);
  assert.match(viewer, /attendanceCanMarkExcused/);
  assert.match(viewer, /syncExcuseNotesAccess/);
  assert.match(viewer, /if \(attendanceCanMarkExcused\(\)\) \{[\s\S]*payload\.lateExcused/);
  assert.match(viewer, /if \(!attendanceCanMarkExcused\(\)\) \{[\s\S]*wrapper\.classList\.add\('d-none'\)/);
});

test('attendance file uploads are gated only on SCHOOL_ATTENDANCES UPLOAD', () => {
  const routes = read('packages/school/MVC/routes/attendanceRoutes.js');
  const classRoutes = read('packages/school/MVC/routes/classRoutes.js');
  const accessService = read('packages/school/MVC/services/school/attendanceAccessService.js');
  const policy = read('packages/school/MVC/services/school/attendanceOperationPolicyService.js');
  const classController = read('packages/school/MVC/controllers/school/classController.js');
  const sessionManager = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  const viewer = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');

  assert.match(routes, /\/api\/files\/upload'[\s\S]*?requireAttendanceOperation\(OPERATIONS\.UPLOAD\)/);
  assert.doesNotMatch(routes, /\/api\/files\/upload'[\s\S]*?SCHOOL_SESSIONS[\s\S]*?OPERATIONS\.UPLOAD/);
  assert.doesNotMatch(accessService, /SECTIONS\.SCHOOL_SESSIONS[\s\S]*?OPERATIONS\.UPLOAD/);
  assert.doesNotMatch(policy, /sessionsUploadPolicy/);
  assert.match(classRoutes, /requireSessionFileUploadRouteAccess\(\)/);
  assert.match(classController, /assertSessionFileUploadAccess[\s\S]*canUploadFiles/);
  assert.match(classController, /ATTENDANCE_SESSION_UPLOAD_KINDS/);
  assert.match(sessionManager, /sessionCanUploadAttendanceFiles/);
  assert.match(sessionManager, /attendanceUploadDisabledAttr/);
  assert.match(viewer, /CAN_UPLOAD_ATTENDANCE_FILES/);
  assert.match(viewer, /allowUpload/);
});
