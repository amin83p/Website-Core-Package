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
    source.includes("require('../services/pte/pteAttemptLedgerService')"),
    'pteUploadContextMiddleware should import attempt ledger from package local service shim.'
  );

  assert.ok(
    !source.includes("require('../../../../MVC/services/pte/pteAttemptLedgerService')"),
    'pteUploadContextMiddleware should not directly import core attempt ledger service.'
  );
});
