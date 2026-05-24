const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('PTE upload context middleware should delegate to core middleware implementation', () => {
  const middlewareSource = readText('packages/pte/MVC/middleware/pteUploadContextMiddleware.js');

  assert.equal(
    middlewareSource.includes("require('../../../../MVC/middleware/pteUploadContextMiddleware')"),
    true,
    'Upload context middleware should import from the core middleware package path.'
  );
});

test('Upload context adapter module remains available for compatibility', () => {
  const dependencySource = readText('packages/pte/MVC/services/pte/pteUploadContextDependencies.js');

  assert.equal(
    dependencySource.includes('module.exports'),
    true,
    'Upload context dependency adapter should still export an object.'
  );
});
