const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const coreDependenciesPath = path.join(
  ROOT_DIR,
  'packages/pte/MVC/services/pte/pteCoreDependencies.js'
);
const coreDependenciesAdapterPath = path.join(
  ROOT_DIR,
  'packages/pte/MVC/services/pte/pteCoreDependenciesCoreAdapter.js'
);

test('PTE core dependencies should use the core dependency adapter', () => {
  const source = fs.readFileSync(coreDependenciesPath, 'utf8');
  assert.equal(
    source.includes("require('./pteCoreDependenciesCoreAdapter')"),
    true,
    'pteCoreDependencies should delegate via pteCoreDependenciesCoreAdapter.'
  );
  assert.equal(
    source.includes('../../../../MVC/'),
    false,
    'pteCoreDependencies should avoid direct deep core imports.'
  );
});

test('PTE core dependency adapter should expose stable utility exports', () => {
  const source = fs.readFileSync(coreDependenciesAdapterPath, 'utf8');
  const adapter = require(coreDependenciesAdapterPath);

  assert.equal(typeof adapter, 'object', 'core dependency adapter should export an object.');
  assert.equal(typeof adapter.adminChekersService, 'object', 'adminChekersService should be exported.');
  assert.equal(typeof adapter.activityQuotaLedgerService, 'object', 'activityQuotaLedgerService should be exported.');
  assert.equal(typeof adapter.coreFilesService, 'object', 'coreFilesService should be exported.');
  assert.equal(typeof adapter.settingService, 'object', 'settingService should be exported.');
  assert.equal(typeof adapter.dataService, 'object', 'dataService should be exported.');
  assert.equal(typeof adapter.normalizeQueryOptions, 'function', 'normalizeQueryOptions should be exported.');
  assert.equal(typeof adapter.resolveEntity, 'function', 'resolveEntity should be exported.');
  assert.equal(typeof adapter.applyGenericFilter, 'function', 'applyGenericFilter should be exported.');
  assert.equal(typeof adapter.idsEqual, 'function', 'idsEqual should be exported.');
  assert.equal(typeof adapter.toPublicId, 'function', 'toPublicId should be exported.');
  assert.equal(typeof adapter.paginate, 'function', 'paginate should be exported.');
  assert.equal(typeof adapter.buildDataServiceQuery, 'function', 'buildDataServiceQuery should be exported.');
  assert.equal(typeof adapter.inferSearchableFields, 'function', 'inferSearchableFields should be exported.');
  assert.equal(typeof adapter.isAjax, 'function', 'isAjax should be exported.');
  assert.equal(typeof adapter.assertCreateOrgContextOrThrow, 'function', 'assertCreateOrgContextOrThrow should be exported.');
  assert.equal(typeof adapter.decrypt, 'function', 'decrypt should be exported.');
  assert.equal(typeof adapter.runByRepositoryBackend, 'function', 'runByRepositoryBackend should be exported.');
  assert.equal(typeof adapter.getMongoCollection, 'function', 'getMongoCollection should be exported.');
});
