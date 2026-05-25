const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('PTE upload context middleware should own implementation through package adapter', () => {
  const middlewareSource = readText('packages/pte/MVC/middleware/pteUploadContextMiddleware.js');

  assert.ok(
    middlewareSource.includes("require('../services/pte/pteUploadContextDependencies')"),
    'PTE upload middleware should import the package upload-context dependency adapter.'
  );

  assert.ok(
    !middlewareSource.includes("require('../../../../MVC/middleware/pteUploadContextMiddleware')"),
    'PTE upload middleware should not be re-exported from core middleware path.'
  );
});

test('PTE upload middleware should use package bucket constants through upload utility', () => {
  const middlewareSource = readText('packages/pte/MVC/middleware/pteUploadContextMiddleware.js');
  assert.ok(
    middlewareSource.includes('pteUploadPathUtils.PTE_BUCKETS.'),
    'PTE upload middleware source should use PTE bucket constants from the package upload utility.'
  );
});
