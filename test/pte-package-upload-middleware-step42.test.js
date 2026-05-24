const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('PTE upload context middleware should delegate to core middleware file', () => {
  const middlewareSource = readText('packages/pte/MVC/middleware/pteUploadContextMiddleware.js');

  assert.ok(
    middlewareSource.includes("require('../../../../MVC/middleware/pteUploadContextMiddleware')"),
    'PTE upload middleware should be re-exported from core middleware path.'
  );
});

test('PTE upload middleware should still expose expected bucket constants via core utility', () => {
  const middlewareSource = readText('packages/pte/MVC/middleware/pteUploadContextMiddleware.js');
  assert.ok(
    !middlewareSource.includes('pteUploadPathUtils.PTE_BUCKETS.'),
    'PTE upload middleware source should not inline package bucket constants when delegating.'
  );
});
