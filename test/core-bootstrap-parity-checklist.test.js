const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

function exists(relativePath) {
  return fs.existsSync(path.join(process.cwd(), relativePath));
}

test('core bootstrap parity checklist files exist', () => {
  const requiredPaths = [
    'data/bootstrap/core/manifest.json',
    'data/bootstrap/core/assets/logo/Logo1.png',
    'data/bootstrap/core/assets/logo/icon.svg',
    'data/bootstrap/core/assets/symbols/bmc_qr_1772825486683.png',
    'data/bootstrap/core/sections.json',
    'data/bootstrap/core/operations.json',
    'data/bootstrap/core/roles.json',
    'data/bootstrap/core/scopes.json',
    'data/bootstrap/core/symbols.json',
    'data/bootstrap/core/accesses.json',
    'data/bootstrap/core/accessPolicies.json',
    'data/bootstrap/core/systemSettings.defaults.json',
    'MVC/services/coreBootstrapBaselineService.js',
    'MVC/views/systemSettings/coreBootstrapSettings.ejs',
    'test/system-settings-core-bootstrap-route.contract.test.js'
  ];

  for (const rel of requiredPaths) {
    assert.equal(exists(rel), true, `expected file to exist: ${rel}`);
  }

  const manifestPath = path.join(process.cwd(), 'data', 'bootstrap', 'core', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(Array.isArray(manifest.assets), true, 'expected manifest.assets array');
  assert.equal(manifest.assets.length >= 1, true, 'expected curated bootstrap assets');
});
