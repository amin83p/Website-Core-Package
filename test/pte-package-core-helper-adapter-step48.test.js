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
    source.includes("require('../../services/pte/pteCoreDependencies')"),
    true,
    'pteCoreHelpersDependencies should consume the package core dependency adapter.'
  );
  assert.equal(
    source.includes('../../../../MVC/'),
    false,
    'pteCoreHelpersDependencies should not import core modules directly.'
  );
});

test('PTE helper core dependency adapter remains available for compatibility', () => {
  const source = fs.readFileSync(helperCoreDependenciesPath, 'utf8');
  assert.equal(
    source.includes("require('../../../../../MVC/controllers/pte/pteCoreHelpersCoreDependencies')"),
    true,
    'core helper adapter should delegate to the core controller helper adapter.'
  );
});

test('PTE upload path utility should consume package core dependency adapter', () => {
  const source = fs.readFileSync(uploadPathUtilsPath, 'utf8');
  assert.equal(
    source.includes("require('./pteUploadPathCoreDependencies')"),
    true,
    'pteUploadPathUtils should import the package upload path core dependency adapter.'
  );
  assert.equal(
    source.includes("require('../../../../MVC/utils/pteUploadPathUtils')"),
    false,
    'pteUploadPathUtils should not delegate back to the core utility directly.'
  );
  assert.equal(
    source.includes('uploadFolderSettingsService'),
    true,
    'pteUploadPathUtils should use uploadFolderSettingsService through the adapter.'
  );
});

test('PTE upload path core dependency adapter should export upload services', () => {
  const source = fs.readFileSync(uploadPathCoreDependenciesPath, 'utf8');
  assert.equal(
    source.includes("require('../services/pte/pteCoreDependencies')"),
    true,
    'upload path core adapter should delegate to pteCoreDependencies for upload services.'
  );
  assert.equal(
    source.includes('coreFilesService'),
    true,
    'upload path core adapter should export coreFilesService.'
  );
  assert.equal(
    source.includes('uploadFolderSettingsService'),
    true,
    'upload path core adapter should export uploadFolderSettingsService.'
  );
});
