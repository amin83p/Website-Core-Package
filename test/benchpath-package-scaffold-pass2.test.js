const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageManifestService = require('../MVC/services/packageManifestService');
const enableScript = require('../scripts/packages/enable-benchpath-package');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('BenchPath package pass2 scaffold declares a valid package manifest', () => {
  const manifest = packageManifestService.validatePackageManifest(
    readJson('packages/benchpath/package.manifest.json'),
    { knownIds: [] }
  );

  assert.equal(manifest.id, 'benchpath');
  assert.equal(manifest.name, 'BenchPath');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.mountPath, '/benchpath');
  assert.equal(manifest.enabledByDefault, false);
  assert.equal(manifest.views.path, 'packages/benchpath/MVC/views');
  assert.equal(manifest.views.namespace, 'benchpath');
  assert.equal(manifest.assets.path, 'packages/benchpath/public');
  assert.equal(manifest.assets.metadataOnly, true);
  assert.ok(manifest.routes.some((route) => (
    route.path === '/benchpath'
    && route.router === 'MVC/routes/benchpath/benchpathMainRoute.js'
    && route.metadataOnly === false
  )));
  assert.equal(manifest.queryExecutors.length, 0);
  assert.equal(manifest.dataEntities.length, 0);
  assert.ok(manifest.uploadFolders.some((folder) => folder.key === 'generated.benchpathReports'));
});

test('BenchPath package pass2 support map uses PTE-style support rows', () => {
  const supportMap = readJson('packages/benchpath/package.support-files.json');
  assert.equal(supportMap.packageId, 'benchpath');
  assert.ok(Number(supportMap.step || 0) >= 2);
  assert.ok(['scaffolded', 'support-mirrored', 'mapped'].includes(supportMap.status));

  [...(supportMap.scripts || []), ...(supportMap.docs || []), ...(supportMap.tests || [])].forEach((row) => {
    assert.equal(typeof row.source, 'string');
    assert.equal(typeof row.target, 'string');
    assert.equal(typeof row.category, 'string');
    assert.equal(row.status, 'root-active');
    assert.ok(row.target.startsWith('packages/benchpath/'));
    assert.equal(fs.existsSync(path.join(ROOT_DIR, row.source)), true, `${row.source} should exist`);
    assert.equal(fs.existsSync(path.join(ROOT_DIR, row.target)), true, `${row.target} should exist`);
  });
});

test('BenchPath package pass2 activation script builds dry-run registry payload', () => {
  const manifest = enableScript.loadBenchpathManifest();
  const payload = enableScript.buildRegistryPayload(manifest, 'enable');

  assert.equal(payload.packageId, 'benchpath');
  assert.equal(payload.enabled, true);
  assert.equal(payload.installStatus, 'enabled');
  assert.equal(payload.metadata.packageName, 'BenchPath');
  assert.equal(payload.metadata.mountPath, '/benchpath');
  assert.equal(payload.metadata.manifestPath, 'packages/benchpath/package.manifest.json');
  assert.equal(payload.metadata.declarationCounts.routes, 1);
  assert.equal(payload.metadata.declarationCounts.views, 1);
  assert.equal(payload.metadata.declarationCounts.assets, 1);
  assert.equal(payload.metadata.declarationCounts.uploadFolders, 1);
  assert.equal(payload.metadata.declarationCounts.queryExecutors, 0);
});

test('BenchPath package pass2 scaffold does not create package-local runtime data', () => {
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'data/benchpath')), true);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'packages/benchpath/data')), false);
});
