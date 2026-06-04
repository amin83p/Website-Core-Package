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

test('BenchPath package pass7 migrates /benchpath mounting from hardcoded app route to package manifest route', () => {
  const appSource = readText('app.js');

  assert.equal(/app\.use\('\/benchpath',\s*require\('\.\/MVC\/routes\/benchpath\/benchpathMainRoute'\)\)/.test(appSource), false);

  const manifest = readJson('packages/benchpath/package.manifest.json');
  const benchpathUseRoutes = (manifest.routes || []).filter((route) => (
    String(route?.method || '').toUpperCase() === 'USE' && String(route?.path || '') === '/benchpath'
  ));

  assert.equal(benchpathUseRoutes.length >= 1, true);
  assert.equal(benchpathUseRoutes.some((route) => String(route?.router || '') === 'MVC/routes/benchpath/benchpathMainRoute.js'), true);
  assert.equal(benchpathUseRoutes.some((route) => route?.metadataOnly === false), true);
  assert.equal(benchpathUseRoutes.some((route) => route?.active !== false), true);
});

test('BenchPath package pass7 registry baseline enables package runtime loading', () => {
  const registry = readJson('data/packageRegistry.json');
  const manifest = readJson('packages/benchpath/package.manifest.json');
  const row = registry.find((item) => String(item?.packageId || '') === 'benchpath');

  assert.ok(row, 'BenchPath registry row should exist');
  assert.equal(row.enabled, true);
  assert.equal(row.installStatus, 'enabled');
  assert.equal(row.version, manifest.version);
  assert.equal(row.metadata?.mountPath, '/benchpath');
  assert.equal(row.metadata?.manifestPath, 'packages/benchpath/package.manifest.json');
  assert.equal(row.metadata?.declarationCounts?.routes, (manifest.routes || []).length);
  assert.equal(row.metadata?.declarationCounts?.sections, (manifest.sections || []).length);
  assert.equal(row.metadata?.declarationCounts?.symbols, (manifest.symbols || []).length);
  assert.equal(row.metadata?.declarationCounts?.queryExecutors, (manifest.queryExecutors || []).length);
  assert.equal(row.metadata?.declarationCounts?.dataEntities, (manifest.dataEntities || []).length);
});

test('BenchPath package pass7 package route can load for runtime router', () => {
  const router = require('../packages/benchpath/MVC/routes/benchpath/benchpathMainRoute');
  assert.equal(typeof router, 'function');
});
