const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

const serviceShimRows = [
  {
    rootFile: 'MVC/services/pte/questionBankAiPromptRegistry.js',
    packageFile: 'packages/pte/MVC/services/pte/questionBankAiPromptRegistry.js',
    expectedRequire: '../../../packages/pte/MVC/services/pte/questionBankAiPromptRegistry'
  },
  {
    rootFile: 'MVC/services/pte/questionBankAiAutofillService.js',
    packageFile: 'packages/pte/MVC/services/pte/questionBankAiAutofillService.js',
    expectedRequire: '../../../packages/pte/MVC/services/pte/questionBankAiAutofillService'
  }
];

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8').trim();
}

test('root PTE question-bank AI services are pure compatibility shims', () => {
  serviceShimRows.forEach((row) => {
    const expectedShim = `module.exports = require('${row.expectedRequire}');`;
    assert.equal(readText(row.rootFile), expectedShim, `${row.rootFile} should delegate to package service`);
  });
});

test('root PTE question-bank AI shims export package-owned modules', () => {
  serviceShimRows.forEach((row) => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const rootService = require(path.join(ROOT_DIR, row.rootFile));
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const packageService = require(path.join(ROOT_DIR, row.packageFile));

    assert.equal(rootService, packageService, `${row.rootFile} should export ${row.packageFile}`);
  });
});

test('package PTE question-bank AI services no longer delegate back to root services', () => {
  serviceShimRows.forEach((row) => {
    const packageSource = readText(row.packageFile);
    assert.doesNotMatch(packageSource, /MVC\/services\/pte/);
    assert.doesNotMatch(packageSource, /MVC\\services\\pte/);
    assert.doesNotMatch(packageSource, /module\.exports\s*=\s*require/);
  });
});

test('package PTE question-bank AI autofill uses the package core dependency facade', () => {
  const source = readText('packages/pte/MVC/services/pte/questionBankAiAutofillService.js');
  assert.match(source, /require\('\.\/pteCoreDependencies'\)/);
  assert.doesNotMatch(source, /require\('\.\.\/settingService'\)/);
  assert.doesNotMatch(source, /require\('\.\.\/coreFilesService'\)/);
  assert.doesNotMatch(source, /require\('\.\.\/\.\.\/utils\/uploadModeUtils'\)/);
});
