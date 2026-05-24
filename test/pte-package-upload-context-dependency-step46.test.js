const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('PTE upload context middleware should consume package dependency facade', () => {
  const middlewareSource = readText('packages/pte/MVC/middleware/pteUploadContextMiddleware.js');
  const dependencySource = readText('packages/pte/MVC/services/pte/pteUploadContextDependencies.js');

  assert.equal(
    middlewareSource.includes('require(\'../services/pte/pteUploadContextDependencies\')'),
    true,
    'Upload context middleware should import from package upload-context dependency adapter.'
  );

  assert.equal(
    dependencySource.includes("require('./pteAttemptLedgerService')"),
    true,
    'Upload context dependency adapter should re-export package attempt-ledger service dependency.'
  );

  assert.equal(
    dependencySource.includes("require('../utils/pteUploadPathUtils')"),
    true,
    'Upload context dependency adapter should re-export package upload utils dependency.'
  );

  assert.equal(
    dependencySource.includes('module.exports'),
    true,
    'Upload context dependency adapter should export an object.'
  );
});
