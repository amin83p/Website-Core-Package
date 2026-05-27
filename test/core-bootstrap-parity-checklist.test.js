const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');

const CORE_SECTION_CATEGORIES = new Set(['SYSTEM', 'SECURITY', 'LOGGING', 'GENERAL', 'DATA', 'ORGANIZATION']);
const ACTIVITY_QUOTA_SYMBOLS = [
  'ACTIVITY_QUOTA',
  'ACTIVITY_QUOTA_OVERVIEW',
  'ACTIVITY_QUOTA_LEDGER',
  'ACTIVITY_QUOTA_RULES',
  'ACTIVITY_QUOTA_ADD_CREDIT',
  'ACTIVITY_QUOTA_PACKAGE',
  'ACTIVITY_QUOTA_CREDIT_CHECK',
  'ACTIVITY_QUOTA_PACKAGE_MANAGER'
];

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
    'MVC/services/coreResetRebootstrapService.js',
    'MVC/views/systemSettings/coreBootstrapSettings.ejs',
    'MVC/views/systemSettings/coreResetSettings.ejs',
    'test/system-settings-core-bootstrap-route.contract.test.js',
    'test/system-settings-core-reset-route.contract.test.js'
  ];

  for (const rel of requiredPaths) {
    assert.equal(exists(rel), true, `expected file to exist: ${rel}`);
  }

  const manifestPath = path.join(process.cwd(), 'data', 'bootstrap', 'core', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(Array.isArray(manifest.assets), true, 'expected manifest.assets array');
  assert.equal(manifest.assets.length >= 1, true, 'expected curated bootstrap assets');
});

test('core-category sections in live data are included in baseline', () => {
  const liveSections = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'sections.json'), 'utf8'));
  const baselineSections = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'bootstrap', 'core', 'sections.json'), 'utf8'));

  const liveCore = liveSections.filter((row) => CORE_SECTION_CATEGORIES.has(String(row?.category || '').toUpperCase()));
  const baselineIds = new Set(baselineSections.map((row) => String(row?.id || '').trim()));

  for (const row of liveCore) {
    const id = String(row?.id || '').trim();
    assert.equal(baselineIds.has(id), true, `missing core section in baseline: ${row?.name || id}`);
  }
});

test('SYSTEM_SECTIONS contains SCOPES exactly once in live and baseline', () => {
  function assertScopeLink(rows = [], label = '') {
    const systemSections = rows.find((row) => String(row?.name || '').trim().toUpperCase() === 'SYSTEM_SECTIONS');
    const scopes = rows.find((row) => String(row?.name || '').trim().toUpperCase() === 'SCOPES');
    assert.ok(systemSections, `${label}: SYSTEM_SECTIONS is missing`);
    assert.ok(scopes, `${label}: SCOPES is missing`);

    const scopeId = String(scopes.id || '').trim();
    const refs = Array.isArray(systemSections.subsections) ? systemSections.subsections : [];
    const linked = refs
      .map((row) => String((row && typeof row === 'object' ? row.id : row) || '').trim())
      .filter((id) => id === scopeId);
    assert.equal(linked.length, 1, `${label}: SYSTEM_SECTIONS must reference SCOPES exactly once`);
  }

  const liveSections = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'sections.json'), 'utf8'));
  const baselineSections = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'bootstrap', 'core', 'sections.json'), 'utf8'));
  assertScopeLink(liveSections, 'live sections');
  assertScopeLink(baselineSections, 'baseline sections');
});

test('baseline includes activity quota symbols and no non-core package roles', () => {
  const baselineSymbols = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'bootstrap', 'core', 'symbols.json'), 'utf8'));
  const symbolNames = new Set(baselineSymbols.map((row) => String(row?.name || '').trim().toUpperCase()));

  for (const symbolName of ACTIVITY_QUOTA_SYMBOLS) {
    assert.equal(symbolNames.has(symbolName), true, `missing activity quota symbol in baseline: ${symbolName}`);
  }

  const baselineRoles = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'bootstrap', 'core', 'roles.json'), 'utf8'));
  for (const row of baselineRoles) {
    const packageName = String(row?.packageName || '').trim().toUpperCase();
    assert.equal(packageName, 'CORE', `baseline role must be CORE-owned: ${row?.key || row?.id}`);
  }
});

test('core baseline sync check script is clean when baseline is in sync', () => {
  const scriptPath = path.join(process.cwd(), 'scripts', 'core', 'sync-core-bootstrap-baseline.js');
  const run = spawnSync(process.execPath, [scriptPath], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(run.status, 0, `expected baseline check status 0 but got ${run.status}\n${run.stdout}\n${run.stderr}`);

  const parsed = JSON.parse(String(run.stdout || '{}'));
  assert.equal(parsed.mode, 'check');
  assert.equal(parsed.hasDrift, false, 'baseline check should report no drift after sync');
});
