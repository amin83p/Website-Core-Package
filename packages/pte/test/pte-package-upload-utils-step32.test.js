const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('PTE upload path utility uses package core file service adapter', () => {
  const source = readText('packages/pte/MVC/utils/pteUploadPathUtils.js');

  assert.ok(
    source.includes("require('./pteUploadPathCoreDependencies')"),
    'pteUploadPathUtils should consume the package upload-path core dependency adapter.'
  );

  assert.ok(
    !source.includes("require('../../../../MVC/utils/pteUploadPathUtils')"),
    'pteUploadPathUtils should not delegate back to the core upload path utility.'
  );

  assert.ok(
    source.includes('uploadFolderSettingsService'),
    'pteUploadPathUtils should use the core upload folder service through the adapter.'
  );

  assert.ok(
    source.includes('PTE_BUCKETS') && source.includes('buildAttemptCategory'),
    'pteUploadPathUtils should own the PTE bucket and category helpers.'
  );
});

test('PTE core dependency bridge exposes upload-related core services', () => {
  const source = readText('packages/pte/MVC/services/pte/pteCoreDependenciesCoreAdapter.js');
  assert.ok(
    source.includes('coreFilesService'),
    'pteCoreDependencies should export coreFilesService for package upload helpers.'
  );
  assert.ok(
    source.includes('uploadFolderSettingsService'),
    'pteCoreDependencies should export uploadFolderSettingsService for package upload helpers.'
  );
});
