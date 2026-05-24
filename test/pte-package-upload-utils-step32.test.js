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
    source.includes("require('../../../../MVC/utils/pteUploadPathUtils')"),
    'pteUploadPathUtils should delegate to the core upload path utility.'
  );

  assert.ok(
    !source.includes('coreFilesService'),
    'pteUploadPathUtils should not import coreFilesService directly.'
  );
});

test('PTE core dependency bridge exposes coreFilesService', () => {
  const source = readText('packages/pte/MVC/services/pte/pteCoreDependenciesCoreAdapter.js');
  assert.ok(
    source.includes('coreFilesService'),
    'pteCoreDependencies should export coreFilesService for package upload helpers.'
  );
});
