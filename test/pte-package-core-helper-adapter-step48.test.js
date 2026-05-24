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
});

test('PTE upload path utility should delegate to core utility', () => {
  const source = fs.readFileSync(uploadPathUtilsPath, 'utf8');
  assert.equal(
    source.includes("require('../../../../MVC/utils/pteUploadPathUtils')"),
    true,
    'pteUploadPathUtils should delegate to the core utility directly.'
  );
  assert.equal(
    source.includes('coreFilesService'),
    false,
    'pteUploadPathUtils should not import coreFilesService directly.'
  );
});

test('PTE upload path core dependency adapter should export coreFilesService', () => {
  const source = fs.readFileSync(uploadPathCoreDependenciesPath, 'utf8');
  assert.equal(
    source.includes("require('../services/pte/pteCoreDependencies')"),
    true,
    'upload path core adapter should delegate to pteCoreDependencies for coreFilesService.'
  );
  assert.equal(
    source.includes('coreFilesService'),
    true,
    'upload path core adapter should export coreFilesService.'
  );
});
