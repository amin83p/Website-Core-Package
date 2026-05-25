const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

const registryShimRows = [
  {
    rootFile: 'MVC/services/pte/questionTypeRegistry.js',
    packageFile: 'packages/pte/MVC/services/pte/questionTypeRegistry.js',
    expectedRequire: '../../../packages/pte/MVC/services/pte/questionTypeRegistry'
  },
  {
    rootFile: 'MVC/services/pte/pteScoringRubricRegistry.js',
    packageFile: 'packages/pte/MVC/services/pte/pteScoringRubricRegistry.js',
    expectedRequire: '../../../packages/pte/MVC/services/pte/pteScoringRubricRegistry'
  }
];

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8').trim();
}

test('root PTE scoring registry services are pure compatibility shims', () => {
  registryShimRows.forEach((row) => {
    const expectedShim = `module.exports = require('${row.expectedRequire}');`;
    assert.equal(readText(row.rootFile), expectedShim, `${row.rootFile} should delegate to package service`);
  });
});

test('root PTE scoring registry shims export package-owned modules', () => {
  registryShimRows.forEach((row) => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const rootService = require(path.join(ROOT_DIR, row.rootFile));
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const packageService = require(path.join(ROOT_DIR, row.packageFile));

    assert.equal(rootService, packageService, `${row.rootFile} should export ${row.packageFile}`);
  });
});

test('package PTE scoring registries no longer delegate back to root services', () => {
  registryShimRows.forEach((row) => {
    const packageSource = readText(row.packageFile);
    assert.doesNotMatch(packageSource, /MVC\/services\/pte/);
    assert.doesNotMatch(packageSource, /MVC\\services\\pte/);
    assert.doesNotMatch(packageSource, /module\.exports\s*=\s*require/);
  });
});
