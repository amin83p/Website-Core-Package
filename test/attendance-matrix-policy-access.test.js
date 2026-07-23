/**
 * Matrix threshold numbers are admin-only: API omission + UI gating.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('matrix API only attaches attendancePolicy when user can manage policy', () => {
  const controller = read('packages/school/MVC/controllers/school/attendanceController.js');
  assert.match(controller, /userCanManageAttendanceMatrixPolicy\(req\.user/);
  assert.match(
    controller,
    /if\s*\(\s*canManageAttendanceMatrixPolicy\s*\)\s*\{\s*payload\.attendancePolicy\s*=\s*attendancePolicy/
  );
  // Scoring still resolves policy before the gated attach.
  assert.match(controller, /resolvePolicy\(classData,\s*orgPolicyLayer\)/);
  assert.match(controller, /computeStudentMatrixSummary\(\s*records,\s*classData,\s*orgPolicyCatalog\s*\)/);
});

test('attendance viewer hides rollup threshold tooltip for non-managers', () => {
  const viewer = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');
  assert.match(viewer, /CAN_MANAGE_ATTENDANCE_MATRIX_POLICY/);
  assert.match(viewer, /canSeeThresholds/);
  assert.match(viewer, /Attendance rollup/);
  assert.match(viewer, /Matrix Thresholds/);
});

test('session manager shows Attendance matrix link for page access, not only policy admins', () => {
  const classCtrl = read('packages/school/MVC/controllers/school/classController.js');
  assert.match(classCtrl, /userCanOpenAttendanceMatrix/);
  assert.match(classCtrl, /canOpenAttendanceMatrix/);
  assert.match(classCtrl, /userCanManageAttendanceMatrixPolicy/);
  assert.match(classCtrl, /canManageAttendanceMatrixPolicy/);

  const sessionManager = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(sessionManager, /canOpenAttendanceMatrix/);
  assert.match(sessionManager, /id="linkAttendanceMatrix"/);
  assert.doesNotMatch(
    sessionManager,
    /canManageAttendanceMatrixPolicy[\s\S]{0,80}linkAttendanceMatrix/
  );
  assert.match(sessionManager, /CAN_MANAGE_ATTENDANCE_MATRIX_POLICY/);
  assert.match(
    sessionManager,
    /CAN_MANAGE_ATTENDANCE_MATRIX_POLICY\s*!==\s*true/
  );
  assert.match(sessionManager, /attendanceMatrixThresholdHint/);
});

test('open-matrix helper is distinct from policy-admin manage helper', () => {
  const middleware = read('packages/school/MVC/middleware/attendanceMatrixPolicyAdminMiddleware.js');
  assert.match(middleware, /userCanOpenAttendanceMatrix/);
  assert.match(middleware, /userCanManageAttendanceMatrixPolicy/);
  assert.match(middleware, /evaluateAccess/);
  assert.match(middleware, /isAttendancesAdminViewerAsync/);
});
