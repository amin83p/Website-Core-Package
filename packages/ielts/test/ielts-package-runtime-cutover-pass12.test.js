const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('IELTS package pass12 migrates /ielts mounting from hardcoded app route to package manifest route', () => {
  const appSource = readText('app.js');

  assert.equal(/app\.use\('\/ielts',\s*require\('\.\/MVC\/routes\/ielts\/ieltsMainRoute'\)\)/.test(appSource), false);

  const manifest = readJson('packages/ielts/package.manifest.json');
  const ieltsUseRoutes = (manifest.routes || []).filter((route) => (
    String(route?.method || '').toUpperCase() === 'USE' && String(route?.path || '') === '/ielts'
  ));

  assert.equal(ieltsUseRoutes.length >= 1, true);
  assert.equal(ieltsUseRoutes.some((route) => String(route?.router || '') === 'MVC/routes/ieltsMainRoute.js'), true);
  assert.equal(ieltsUseRoutes.some((route) => route?.metadataOnly === false), true);
  assert.equal(ieltsUseRoutes.some((route) => route?.active !== false), true);
});

test('IELTS package pass12 registry baseline enables package runtime loading', () => {
  const registry = readJson('data/packageRegistry.json');
  const manifest = readJson('packages/ielts/package.manifest.json');
  const row = registry.find((item) => String(item?.packageId || '') === 'ielts');

  assert.ok(row, 'IELTS registry row should exist');
  assert.equal(row.enabled, true);
  assert.equal(row.installStatus, 'enabled');
  assert.equal(row.version, manifest.version);
  assert.equal(row.metadata?.mountPath, '/ielts');
  assert.equal(row.metadata?.manifestPath, 'packages/ielts/package.manifest.json');
  assert.equal(row.metadata?.declarationCounts?.routes, (manifest.routes || []).length);
  assert.equal(row.metadata?.declarationCounts?.sections, (manifest.sections || []).length);
  assert.equal(row.metadata?.declarationCounts?.symbols, (manifest.symbols || []).length);
  assert.equal(row.metadata?.declarationCounts?.queryExecutors, (manifest.queryExecutors || []).length);
});
