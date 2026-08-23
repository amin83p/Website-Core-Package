const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function findByName(rows, name) {
  return rows.find((row) => String(row?.name || '') === name);
}

function baseHealthInput(overrides = {}) {
  return {
    runtime: { kind: 'server', nodeEnv: 'production', isProduction: true },
    navigation: { loadMs: 2000, domContentLoadedMs: 1000, responseMs: 500 },
    resources: { slowest: [{ name: '/scripts/main.js', durationMs: 900 }] },
    consoleEntries: [],
    requestEntries: [],
    presenceEndpointPath: '/debug/client-diagnostics/page-presence',
    ...overrides
  };
}

test('PAGE_DIAGNOSTICS is declared as a core access section and symbol', () => {
  const { SECTIONS } = require('../config/accessConstants');
  assert.equal(SECTIONS.PAGE_DIAGNOSTICS, 'PAGE_DIAGNOSTICS');

  for (const file of ['data/sections.json', 'data/bootstrap/core/sections.json']) {
    const rows = readJson(file);
    const section = findByName(rows, 'PAGE_DIAGNOSTICS');
    const parent = findByName(rows, 'SYSTEM_LOGGING');

    assert.ok(section, `${file} should include PAGE_DIAGNOSTICS`);
    assert.equal(section.id, '862452');
    assert.equal(section.category, 'LOGGING');
    assert.equal(section.navigatorSection, false);
    assert.equal(section.trackState, true);
    assert.deepEqual((section.operations || []).map((op) => op.id), ['OP1003']);
    assert.ok((parent.subsections || []).some((row) => String(row.id) === '862452'));
  }

  for (const file of ['data/symbols.json', 'data/bootstrap/core/symbols.json']) {
    const rows = readJson(file);
    const symbol = findByName(rows, 'PAGE_DIAGNOSTICS');
    assert.ok(symbol, `${file} should include PAGE_DIAGNOSTICS symbol`);
    assert.equal(symbol.id, 'SYM_SYSTEM_090');
    assert.equal(symbol.value, 'bi bi-speedometer2');
  }
});

test('layout only loads page diagnostics for the page diagnostics permission flag', () => {
  const layout = read('MVC/views/layouts/layout.ejs');
  assert.match(layout, /canUsePageDiagnostics/);
  assert.match(layout, /__PAGE_DIAGNOSTICS__/);
  assert.match(layout, /\/debug\/client-diagnostics\/page-presence/);
  assert.match(layout, /pageDiagnosticsRuntime/);
  assert.match(layout, /runtime:/);
  assert.match(layout, /\/scripts\/pageDiagnosticsHealth\.js/);
  assert.match(layout, /\/scripts\/pageDiagnostics\.js/);
  assert.ok(layout.indexOf('/scripts/pageDiagnosticsHealth.js') < layout.indexOf('/scripts/pageDiagnostics.js'));
  assert.ok(layout.indexOf('/scripts/pageDiagnostics.js') < layout.indexOf('/scripts/main.js'));
  assert.doesNotMatch(layout, /RAILWAY_PROJECT_ID|RAILWAY_SERVICE_ID|RAILWAY_DEPLOYMENT_ID|RAILWAY_REPLICA_ID/);
});

test('page diagnostics client keeps diagnostics local and fetches only page presence', () => {
  const source = read('public/scripts/pageDiagnostics.js');
  assert.match(source, /window\.onerror/);
  assert.match(source, /unhandledrejection/);
  assert.match(source, /installFetchCapture/);
  assert.match(source, /evaluateCurrentHealth/);
  assert.match(source, /page-diagnostics-health-card/);
  assert.match(source, /data-page-diagnostics-health/);
  assert.doesNotMatch(source, /method:\s*['"]POST['"]/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test('page diagnostics health is green when server signals are healthy', () => {
  const health = require('../public/scripts/pageDiagnosticsHealth');
  const result = health.evaluatePageHealth(baseHealthInput());
  assert.equal(result.status, 'green');
  assert.equal(result.label, 'Perfect');
  assert.equal(result.runtimeLabel, 'Server');
});

test('page diagnostics health is yellow for degraded timing, warnings, and client errors', () => {
  const health = require('../public/scripts/pageDiagnosticsHealth');

  assert.equal(health.evaluatePageHealth(baseHealthInput({
    navigation: { loadMs: 3000, domContentLoadedMs: 1000, responseMs: 500 }
  })).status, 'yellow');

  assert.equal(health.evaluatePageHealth(baseHealthInput({
    consoleEntries: [{ level: 'warn', message: 'Deprecated call' }]
  })).status, 'yellow');

  assert.equal(health.evaluatePageHealth(baseHealthInput({
    requestEntries: [{ ok: false, status: 404, url: '/missing', durationMs: 80 }]
  })).status, 'yellow');
});

test('page diagnostics health is red for errors, failed requests, and critical timing', () => {
  const health = require('../public/scripts/pageDiagnosticsHealth');

  assert.equal(health.evaluatePageHealth(baseHealthInput({
    consoleEntries: [{ level: 'error', message: 'Boom' }]
  })).status, 'red');

  assert.equal(health.evaluatePageHealth(baseHealthInput({
    requestEntries: [{ ok: false, status: 500, url: '/api/fail', durationMs: 120 }]
  })).status, 'red');

  assert.equal(health.evaluatePageHealth(baseHealthInput({
    navigation: { loadMs: 6000, domContentLoadedMs: 1000, responseMs: 500 }
  })).status, 'red');
});

test('page diagnostics health uses more forgiving local thresholds', () => {
  const health = require('../public/scripts/pageDiagnosticsHealth');
  const timing = {
    navigation: { loadMs: 3500, domContentLoadedMs: 2200, responseMs: 1200 },
    resources: { slowest: [{ name: '/scripts/main.js', durationMs: 1800 }] }
  };

  assert.equal(health.evaluatePageHealth(baseHealthInput({
    runtime: { kind: 'local', nodeEnv: 'development', isProduction: false },
    ...timing
  })).status, 'green');

  assert.equal(health.evaluatePageHealth(baseHealthInput({
    runtime: { kind: 'railway', nodeEnv: 'production', isProduction: true },
    ...timing
  })).status, 'yellow');
});

test('page diagnostics presence endpoint failures are yellow unless server-side', () => {
  const health = require('../public/scripts/pageDiagnosticsHealth');

  assert.equal(health.evaluatePageHealth(baseHealthInput({
    presenceError: 'Forbidden',
    presenceErrorStatus: 403
  })).status, 'yellow');

  assert.equal(health.evaluatePageHealth(baseHealthInput({
    presenceError: 'Server failed',
    presenceErrorStatus: 503
  })).status, 'red');
});

test('page path sanitizer strips query and rejects non-path values', () => {
  const { sanitizeCurrentPath, isHtmlNavigationRequest } = require('../MVC/utils/pagePathUtils');
  assert.equal(sanitizeCurrentPath('/school/classes/1?token=hidden#tab'), '/school/classes/1');
  assert.equal(sanitizeCurrentPath('https://example.test/dashboard?q=secret'), '/dashboard');
  assert.equal(sanitizeCurrentPath('not-a-path'), '');
  assert.equal(isHtmlNavigationRequest({
    method: 'GET',
    originalUrl: '/dashboard?x=1',
    headers: { accept: 'text/html' }
  }), true);
  assert.equal(isHtmlNavigationRequest({
    method: 'GET',
    originalUrl: '/scripts/main.js',
    headers: { accept: '*/*' }
  }), false);
});

test('page diagnostics seed script declares guarded core Mongo repair targets', () => {
  const source = read('scripts/seed-page-diagnostics-section.js');
  assert.match(source, /SECTION_ID = '862452'/);
  assert.match(source, /SECTION_NAME = 'PAGE_DIAGNOSTICS'/);
  assert.match(source, /SYMBOL_ID = 'SYM_SYSTEM_090'/);
  assert.match(source, /SYSTEM_LOGGING/);
  assert.match(source, /Duplicate PAGE_DIAGNOSTICS sections found/);
  assert.match(source, /Default mode is dry-run/);

  const pkg = readJson('package.json');
  assert.equal(pkg.scripts['core:page-diagnostics:seed'], 'node scripts/seed-page-diagnostics-section.js');
  assert.equal(pkg.scripts['core:page-diagnostics:seed:apply'], 'node scripts/seed-page-diagnostics-section.js --apply');
});
