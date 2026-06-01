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

