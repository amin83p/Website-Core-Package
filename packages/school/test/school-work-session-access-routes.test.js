const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('activity work-session routes allow SCHOOL_WORK_SESSIONS with SCHOOL_ACTIVITIES fallback', () => {
  const routeSource = read('packages/school/MVC/routes/activityRoutes.js');

  assert.match(routeSource, /requireAccessAny/);
  assert.match(routeSource, /WORK_SESSION_ACCESS_SECTIONS/);
  assert.match(routeSource, /SECTIONS\.SCHOOL_WORK_SESSIONS/);
  assert.match(routeSource, /SECTIONS\.SCHOOL_ACTIVITIES/);
  assert.match(routeSource, /WORK_SESSION_TRACK_SECTION\s*=\s*SECTIONS\.SCHOOL_WORK_SESSIONS/);
  assert.match(routeSource, /\/:activityId\/work-sessions\/:entryId\/manage[\s\S]*?requireAccessAny\(WORK_SESSION_ACCESS_SECTIONS,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /\/:activityId\/work-sessions\/:entryId\/complete[\s\S]*?requireAccessAny\(WORK_SESSION_ACCESS_SECTIONS,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routeSource, /\/:activityId\/work-sessions\/:entryId[\s\S]*?requireAccessAny\(WORK_SESSION_ACCESS_SECTIONS,\s*OPERATIONS\.DELETE\)/);
});

test('work session explorer routes are gated on SCHOOL_WORK_SESSIONS', () => {
  const routeSource = read('packages/school/MVC/routes/workSessionRoutes.js');
  const mainRouteSource = read('packages/school/MVC/routes/schoolMainRoute.js');

  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_WORK_SESSIONS,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /ctrl\.showWorkSessionExplorerPage/);
  assert.match(routeSource, /ctrl\.getWorkSessionsApi/);
  assert.match(mainRouteSource, /router\.use\('\/work-sessions',\s*require\('\.\/workSessionRoutes'\)\)/);
});

test('activity work session admin check supports work sessions or activities admin', () => {
  const serviceSource = read('packages/school/MVC/services/school/activityWorkSessionService.js');
  const adminSource = read('packages/school/MVC/services/school/schoolAdminAccessService.js');

  assert.match(serviceSource, /isWorkSessionsAdminViewer\(reqUser, operationId\)/);
  assert.match(serviceSource, /isActivitiesAdminViewer\(reqUser, operationId\)/);
  assert.match(adminSource, /function isWorkSessionsAdminViewer/);
  assert.match(adminSource, /SECTIONS\.SCHOOL_WORK_SESSIONS/);
});
