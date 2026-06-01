const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('school package pass7 starts route implementation ownership with package-owned schoolRoutes', () => {
  const routeSource = read('packages/school/MVC/routes/schoolRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/schoolRoutes')"), false);
  assert.match(routeSource, /const\s+\{\s*requireAuth,\s*SECTIONS\s*\}\s*=\s*require\('\.\/schoolRouteDependencies'\)/);
  assert.match(routeSource, /router\.get\('\/'/);
  assert.match(routeSource, /dashboard\/section-nav/);
  assert.match(routeSource, /encodeURIComponent\(SECTIONS\.SCHOOL\)/);
});

test('school package pass7 keeps transactionDefinitionRoutes as package-owned alias', () => {
  const routeSource = read('packages/school/MVC/routes/transactionDefinitionRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/transactionDefinitionRoutes')"), false);
  assert.match(routeSource, /module\.exports\s*=\s*require\('\.\/transactionTemplateRoutes'\)/);
});

test('school package pass7 owns gradesMatrixRoutes implementation', () => {
  const routeSource = read('packages/school/MVC/routes/gradesMatrixRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/gradesMatrixRoutes')"), false);
  assert.match(routeSource, /const\s+ctrl\s*=\s*require\('\.\.\/controllers\/school\/gradesMatrixController'\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_GRADEBOOK,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /trackActionState\(SECTIONS\.SCHOOL_GRADEBOOK,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /ctrl\.showGradesMatrixPage/);
  assert.match(routeSource, /ctrl\.getGradesMatrixData/);
});

test('school package pass7 owns sessionRoutes implementation', () => {
  const routeSource = read('packages/school/MVC/routes/sessionRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/sessionRoutes')"), false);
  assert.match(routeSource, /const\s+ctrl\s*=\s*require\('\.\.\/controllers\/school\/sessionController'\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_SESSIONS,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /trackActionState\(SECTIONS\.SCHOOL_SESSIONS,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /ctrl\.showSessionListPage/);
  assert.match(routeSource, /ctrl\.getSessionsApi/);
});

test('school package pass7 owns sessionStatusRoutes implementation', () => {
  const routeSource = read('packages/school/MVC/routes/sessionStatusRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/sessionStatusRoutes')"), false);
  assert.match(routeSource, /const\s+ctrl\s*=\s*require\('\.\.\/controllers\/school\/sessionStatusController'\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_SESSION_STATUSES,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_SESSION_STATUSES,\s*OPERATIONS\.CREATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_SESSION_STATUSES,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_SESSION_STATUSES,\s*OPERATIONS\.DELETE\)/);
  assert.match(routeSource, /ctrl\.listSessionStatuses/);
  assert.match(routeSource, /ctrl\.saveSessionStatus/);
  assert.match(routeSource, /ctrl\.deleteSessionStatus/);
});
