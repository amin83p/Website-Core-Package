const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const helperDependenciesPath = path.join(
  ROOT_DIR,
  'packages/pte/MVC/controllers/pte/pteCoreHelpersDependencies.js'
);
const helperCoreDependenciesPath = path.join(
  ROOT_DIR,
  'packages/pte/MVC/controllers/pte/pteCoreHelpersCoreDependencies.js'
);
const uploadPathUtilsPath = path.join(
  ROOT_DIR,
  'packages/pte/MVC/utils/pteUploadPathUtils.js'
);
const uploadPathCoreDependenciesPath = path.join(
  ROOT_DIR,
  'packages/pte/MVC/utils/pteUploadPathCoreDependencies.js'
);

test('PTE helper dependency adapter split', () => {
  const source = fs.readFileSync(helperDependenciesPath, 'utf8');
  assert.equal(
    source.includes("require('./pteCoreHelpersCoreDependencies')"),
    true,
    'pteCoreHelpersDependencies should consume the helper core dependency adapter.'
  );
  assert.equal(
    source.includes('../../../../MVC/'),
    false,
    'pteCoreHelpersDependencies should not import core modules directly.'
  );
});

test('PTE helper core dependency adapter should delegate to core pte dependencies', () => {
  const source = fs.readFileSync(helperCoreDependenciesPath, 'utf8');
  assert.equal(
    source.includes("require('../services/pte/pteCoreDependencies')"),
    true,
    'core helper adapter should delegate to pteCoreDependencies.'
  );

  const adapter = require(helperCoreDependenciesPath);
  assert.equal(typeof adapter.paginate, 'function', 'paginate should be exported');
  assert.equal(typeof adapter.buildDataServiceQuery, 'function', 'buildDataServiceQuery should be exported');
  assert.equal(typeof adapter.inferSearchableFields, 'function', 'inferSearchableFields should be exported');
  assert.equal(typeof adapter.isAjax, 'function', 'isAjax should be exported');
  assert.equal(typeof adapter.adminChekersService, 'object', 'adminChekersService should be exported');
  assert.equal(typeof adapter.toPublicId, 'function', 'toPublicId should be exported');
});

test('PTE upload path utility should consume upload path core dependency adapter', () => {
  const source = fs.readFileSync(uploadPathUtilsPath, 'utf8');
  assert.equal(
    source.includes("require('./pteUploadPathCoreDependencies')"),
    true,
    'pteUploadPathUtils should consume pteUploadPathCoreDependencies.'
  );
  assert.equal(
    source.includes('../services/pte/pteCoreDependencies'),
    false,
    'pteUploadPathUtils should not import pteCoreDependencies directly.'
  );
});

test('PTE upload path core dependency adapter should export coreFilesService', () => {
  const source = fs.readFileSync(uploadPathCoreDependenciesPath, 'utf8');
  assert.equal(
    source.includes("require('../services/pte/pteCoreDependencies')"),
    true,
    'upload path core adapter should delegate to pteCoreDependencies for coreFilesService.'
  );

  const adapter = require(uploadPathCoreDependenciesPath);
  assert.equal(typeof adapter.coreFilesService, 'object', 'coreFilesService should be exported.');
});
