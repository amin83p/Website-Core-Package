const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('person schedule includes session context menu and modal hooks', () => {
  const view = read('packages/school/MVC/views/school/schedule/personSchedule.ejs');
  assert.match(view, /id="scheduleSessionContextMenu"/);
  assert.match(view, /id="scheduleSessionAttendanceModal"/);
  assert.match(view, /id="scheduleSessionEnrollmentModal"/);
  assert.match(view, /bindScheduleSessionContextMenu/);
  assert.match(view, /\/school\/schedules\/api\/session-attendance-list/);
  assert.match(view, /\/school\/schedules\/api\/session-enrollment-list/);
  assert.match(view, /buildScheduleSessionStatusMenuItems/);
  assert.match(view, /scheduleBuildAttendanceMarkHtml/);
  assert.match(view, /btn_scheduleSessionEnrollmentRefreshCurrent/);
  assert.match(view, /attendanceMarkAppearanceClient\.js/);
  assert.match(view, /data-event-type="class_session"/);
});

test('schedule routes register session context list APIs', () => {
  const routes = read('packages/school/MVC/routes/scheduleRoutes.js');
  assert.match(routes, /\/api\/session-attendance-list/);
  assert.match(routes, /\/api\/session-enrollment-list/);
  assert.match(routes, /getSessionAttendanceList/);
  assert.match(routes, /getSessionEnrollmentList/);
});

test('schedule session context service exports list builders', () => {
  const servicePath = path.join(root, 'packages/school/MVC/services/school/scheduleSessionContextService.js');
  assert.equal(fs.existsSync(servicePath), true);
  const service = require(servicePath);
  assert.equal(typeof service.buildSessionAttendanceList, 'function');
  assert.equal(typeof service.buildSessionEnrollmentList, 'function');
  assert.equal(typeof service.buildSessionSummary, 'function');
});

test('attendance data API accepts sessionIds filter', () => {
  const controller = read('packages/school/MVC/controllers/school/attendanceController.js');
  assert.match(controller, /filterSessionIds: req\.query\?\.sessionIds/);
  const viewer = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');
  assert.match(viewer, /params\.set\('sessionIds'/);
});

test('served session-calendar.css includes schedule session context menu styles', () => {
  const css = read('public/styles/session-calendar.css');
  assert.match(css, /\.schedule-session-context-menu\b/);
  assert.match(css, /\.schedule-session-context-action\b/);
  assert.match(css, /\.schedule-session-context-status-chip\b/);
});
