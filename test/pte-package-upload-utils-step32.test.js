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
    source.includes("const { coreFilesService } = require('../services/pte/pteCoreDependencies');"),
    'pteUploadPathUtils should consume the package core dependency adapter.'
  );

  assert.ok(
    !source.includes('uploadFolderSettingsService'),
    'pteUploadPathUtils should not import uploadFolderSettingsService directly.'
  );
  assert.ok(
    !source.includes("resolveUploadFolder('pte.questionBank'"),
    'pteUploadPathUtils should not hard-code uploadFolderSettingsService resolveUploadFolder calls.'
  );
});

test('PTE core dependency bridge exposes coreFilesService', () => {
  const source = readText('packages/pte/MVC/services/pte/pteCoreDependencies.js');
  assert.ok(
    source.includes('coreFilesService'),
    'pteCoreDependencies should export coreFilesService for package upload helpers.'
  );
});

