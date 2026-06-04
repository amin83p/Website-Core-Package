const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageManifestService = require('../MVC/services/packageManifestService');
const enableScript = require('../scripts/packages/enable-ielts-package');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('IELTS package pass2 scaffold declares a valid package manifest', () => {
  const manifest = packageManifestService.validatePackageManifest(
    readJson('packages/ielts/package.manifest.json'),
    { knownIds: [] }
  );

  assert.equal(manifest.id, 'ielts');
  assert.equal(manifest.name, 'IELTS');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.mountPath, '/ielts');
  assert.equal(manifest.enabledByDefault, false);
  assert.equal(manifest.views.path, 'packages/ielts/MVC/views');
  assert.equal(manifest.views.namespace, 'ielts');
  assert.equal(manifest.assets.path, 'packages/ielts/public');
  assert.equal(manifest.assets.metadataOnly, true);
  assert.ok(manifest.routes.some((route) => (
    route.path === '/ielts'
    && route.router === 'MVC/routes/ieltsMainRoute.js'
    && route.metadataOnly === false
  )));
  assert.equal(manifest.queryExecutors.length, 6);
  assert.equal(manifest.dataEntities.length, 6);
  assert.ok(manifest.uploadFolders.some((folder) => folder.key === 'core.ielts'));
});

test('IELTS package pass2 support map uses PTE-style support rows', () => {
  const supportMap = readJson('packages/ielts/package.support-files.json');
  assert.equal(supportMap.packageId, 'ielts');
  assert.ok(Number(supportMap.step || 0) >= 2);
  assert.ok(['scaffolded', 'support-mirrored', 'mapped'].includes(supportMap.status));

  (supportMap.scripts || []).forEach((row) => {
    assert.equal(typeof row.source, 'string');
    assert.equal(typeof row.target, 'string');
    assert.equal(typeof row.category, 'string');
    assert.equal(row.status, 'root-active');
    assert.ok(row.target.startsWith('packages/ielts/'));
    assert.equal(fs.existsSync(path.join(ROOT_DIR, row.source)), true, `${row.source} should exist`);
    assert.equal(fs.existsSync(path.join(ROOT_DIR, row.target)), true, `${row.target} should exist`);
  });
});

test('IELTS package pass2 activation script builds dry-run registry payload', () => {
  const manifest = enableScript.loadIeltsManifest();
  const payload = enableScript.buildRegistryPayload(manifest, 'enable');

  assert.equal(payload.packageId, 'ielts');
  assert.equal(payload.enabled, true);
  assert.equal(payload.installStatus, 'enabled');
  assert.equal(payload.metadata.packageName, 'IELTS');
  assert.equal(payload.metadata.mountPath, '/ielts');
  assert.equal(payload.metadata.manifestPath, 'packages/ielts/package.manifest.json');
  assert.equal(payload.metadata.declarationCounts.routes, 1);
  assert.equal(payload.metadata.declarationCounts.views, 1);
  assert.equal(payload.metadata.declarationCounts.assets, 1);
  assert.equal(payload.metadata.declarationCounts.queryExecutors, 6);
});

test('IELTS package pass2 scaffold does not create package-local runtime data', () => {
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'data/ielts')), true);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'packages/ielts/data')), false);
});
