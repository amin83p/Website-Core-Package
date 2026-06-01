const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('school package pass6 migrates /school mounting from hardcoded app route to package manifest route', () => {
  const appSource = readText('app.js');

  assert.equal(/app\.use\('\/school',\s*require\('\.\/MVC\/routes\/school\/schoolMainRoute'\)\)/.test(appSource), false);

  const manifest = JSON.parse(readText('packages/school/package.manifest.json'));
  const schoolUseRoutes = (manifest.routes || []).filter((route) => (
    String(route?.method || '').toUpperCase() === 'USE' && String(route?.path || '') === '/school'
  ));

  assert.equal(schoolUseRoutes.length >= 1, true);
  assert.equal(schoolUseRoutes.some((route) => String(route?.router || '') === 'MVC/routes/schoolMainRoute.js'), true);
  assert.equal(schoolUseRoutes.some((route) => route?.metadataOnly === false), true);
  assert.equal(schoolUseRoutes.some((route) => route?.active !== false), true);
});
