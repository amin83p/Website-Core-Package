const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('PTE upload context middleware uses package-local attempt ledger service', () => {
  const source = readText('packages/pte/MVC/middleware/pteUploadContextMiddleware.js');

  assert.ok(
    source.includes("require('../services/pte/pteUploadContextDependencies')"),
    'pteUploadContextMiddleware should import attempt ledger dependency through package adapter.'
  );

  assert.ok(
    !source.includes("require('../services/pte/pteAttemptLedgerService')"),
    'pteUploadContextMiddleware should not import attempt ledger service directly.'
  );

  assert.ok(
    !source.includes("require('../utils/pteUploadPathUtils')"),
    'pteUploadContextMiddleware should not import upload path utils directly.'
  );

  const dependencySource = readText('packages/pte/MVC/services/pte/pteUploadContextDependencies.js');

  assert.ok(
    dependencySource.includes('module.exports'),
    'Upload context dependency module should export upload context dependencies.'
  );

  assert.ok(
    dependencySource.includes("require('./pteAttemptLedgerService')"),
    'Upload context dependency module should import package-local attempt ledger service.'
  );

  assert.ok(
    dependencySource.includes("require('../utils/pteUploadPathUtils')"),
    'Upload context dependency module should import package-local upload utility.'
  );
});
