const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('attendance routes expose active classes endpoint with attendance read-all access', () => {
  const routeSource = read('packages/school/MVC/routes/attendanceRoutes.js');

  assert.match(routeSource, /router\.get\('\/api\/active-classes'/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_ATTENDANCES,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /trackActionState\(SECTIONS\.SCHOOL_ATTENDANCES,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /ctrl\.listActiveAttendanceClasses/);
});

test('attendance controller returns active class rows for the active org', () => {
  const controllerSource = read('packages/school/MVC/controllers/school/attendanceController.js');

  assert.match(controllerSource, /async function listActiveAttendanceClasses\(req,\s*res\)/);
  assert.match(controllerSource, /schoolDataService\.fetchData\('classes'/);
  assert.match(controllerSource, /filter\(\(row\) => classBelongsToActiveOrg\(row,\s*activeOrgId\)\)/);
  assert.match(controllerSource, /filter\(isActiveAttendanceClass\)/);
  assert.match(controllerSource, /status === 'active'/);
  assert.match(controllerSource, /listActiveAttendanceClasses,/);
});

test('master academia attendance workspace has all-active-classes button and batch render flow', () => {
  const viewSource = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');

  assert.match(viewSource, /id="hubAttendanceLoadActiveClasses"[^>]*>[\s\S]*All Active Classes/);
  assert.match(viewSource, /async function loadAllActiveHubAttendanceClasses\(\)/);
  assert.match(viewSource, /fetch\('\/school\/attendances\/api\/active-classes'/);
  assert.match(viewSource, /loadHubAttendanceMatrixForClass\(classRow,\s*startDate,\s*endDate\)/);
  assert.match(viewSource, /hubAttendanceState\.batch\s*=/);
  assert.match(viewSource, /function renderHubAttendanceBatch\(results\)/);
  assert.match(viewSource, /renderHubAttendanceBatch\(hubAttendanceState\.batch\)/);
  assert.match(viewSource, /activeBatchClassKey/);
  assert.match(viewSource, /id="hubAttendanceClassTabs"/);
  assert.match(viewSource, /hub-schedule-tabs/);
  assert.match(viewSource, /data-hub-attendance-class-tab/);
  assert.match(viewSource, /hub-schedule-person-tab/);
});
