const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageManifestService = require('../MVC/services/packageManifestService');

const ROOT_DIR = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'packages/benchpath/package.manifest.json');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8'));
}

test('BenchPath package pass5 manifest declares current sections and symbols', () => {
  const manifest = packageManifestService.validatePackageManifest(
    JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')),
    { knownIds: [] }
  );
  const sectionNames = new Set((manifest.sections || []).map((row) => row.name));
  const symbolNames = new Set((manifest.symbols || []).map((row) => row.name));

  assert.equal(manifest.sections.length, 15);
  assert.equal(manifest.symbols.length, 15);
  assert.equal(sectionNames.has('BENCHPATH'), true);
  assert.equal(sectionNames.has('BENCHPATH_TASK_AUTHORING'), true);
  assert.equal(symbolNames.has('BENCHPATH'), true);
  assert.equal(symbolNames.has('BENCHPATH_REFERENCE'), true);

  const imageSymbol = manifest.symbols.find((row) => String(row?.value || '').includes('/uploads/GLOBAL/symbols/'));
  assert.ok(imageSymbol, 'BenchPath image symbol should stay in GLOBAL symbol storage');
});

test('BenchPath package pass5 manifest declares data entities and query executors', () => {
  const manifest = readJson('packages/benchpath/package.manifest.json');
  const entityTypes = new Set((manifest.dataEntities || []).map((row) => row.entityType));
  const queryEntities = new Set((manifest.queryExecutors || []).map((row) => row.entity));

  assert.equal(manifest.dataEntities.length, 13);
  assert.equal(manifest.queryExecutors.length, 13);
  assert.equal(entityTypes.has('benchpathSources'), true);
  assert.equal(entityTypes.has('benchpathSourceFragments'), true);
  assert.equal(entityTypes.has('benchpathTasks'), true);
  assert.equal(queryEntities.has('benchpath.sources'), true);
  assert.equal(queryEntities.has('benchpath.sourceFragments'), true);
  assert.equal(queryEntities.has('benchpath.tasks'), true);

  (manifest.dataEntities || []).forEach((row) => {
    assert.equal(Array.isArray(row.backendModes), true);
    assert.equal(row.backendModes.includes('json'), true);
    assert.equal(row.backendModes.includes('mongo'), true);
    assert.equal(String(row.storageTarget || '').startsWith('data/benchpath/'), true);
    assert.equal(fs.existsSync(path.join(ROOT_DIR, row.storageTarget)), true, `${row.storageTarget} should exist`);
  });
});

test('BenchPath package pass5 manifest declares generated report upload folder', () => {
  const manifest = readJson('packages/benchpath/package.manifest.json');
  const reportFolder = (manifest.uploadFolders || []).find((row) => row.key === 'generated.benchpathReports');

  assert.ok(reportFolder);
  assert.equal(reportFolder.relativePath, 'benchpath/reports');
});
