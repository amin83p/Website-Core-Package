const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('PTE upload context middleware owns implementation through package adapters', () => {
  const source = readText('packages/pte/MVC/middleware/pteUploadContextMiddleware.js');

  assert.ok(
    source.includes("require('../services/pte/pteUploadContextDependencies')"),
    'pteUploadContextMiddleware should import the package upload-context adapter.'
  );

  assert.ok(
    !source.includes("require('../../../../MVC/middleware/pteUploadContextMiddleware')"),
    'pteUploadContextMiddleware should not delegate back to the core middleware.'
  );

  assert.ok(
    !source.includes("require('../services/pte/pteAttemptLedgerService')"),
    'pteUploadContextMiddleware should not import attempt ledger service directly.'
  );

  assert.ok(
    !source.includes("require('../utils/pteUploadPathUtils')"),
    'pteUploadContextMiddleware should not import upload path utils directly.'
  );

  assert.ok(
    source.includes('setQuestionBankContext') &&
      source.includes('setStudentContext') &&
      source.includes('setRuntimeAttemptContext'),
    'pteUploadContextMiddleware should expose the expected upload context middleware functions.'
  );
});
