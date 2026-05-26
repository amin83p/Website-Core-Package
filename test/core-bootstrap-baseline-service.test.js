const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const coreBootstrapBaselineService = require('../MVC/services/coreBootstrapBaselineService');
const dataService = require('../MVC/services/dataService');
const systemSettingsRepository = require('../MVC/repositories/systemSettingsRepository');

function withTempRunPath() {
  const original = process.env.CORE_BOOTSTRAP_RUN_DATA_PATH;
  const tempPath = path.join(os.tmpdir(), `core-bootstrap-runs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`);
  process.env.CORE_BOOTSTRAP_RUN_DATA_PATH = tempPath;
  return () => {
    if (original === undefined) delete process.env.CORE_BOOTSTRAP_RUN_DATA_PATH;
    else process.env.CORE_BOOTSTRAP_RUN_DATA_PATH = original;
    try { fs.unlinkSync(tempPath); } catch (_) {}
  };
}

test('core bootstrap baseline bundle loads with expected security entities', async () => {
  const bundle = await coreBootstrapBaselineService.loadBaselineBundle();
  assert.equal(bundle.baselineId.length > 0, true);
  const entities = bundle.entities.map((row) => row.entityType);
  assert.deepEqual(entities, [
    'sections',
    'operations',
    'roles',
    'scopes',
    'symbols',
    'accesses',
    'accessPolicies'
  ]);
  assert.equal(typeof bundle.systemSettingsDefaults.payload, 'object');
});

test('preflight reports planned creates when target entities are empty', async () => {
  const restoreRunPath = withTempRunPath();
  const originalFetchData = dataService.fetchData;

  dataService.fetchData = async () => [];

  try {
    const report = await coreBootstrapBaselineService.preflight({ backendMode: 'json', actor: { id: 'TEST_USER' } });
    assert.equal(report.action, 'preflight');
    assert.equal(report.summary.baselineRows > 0, true);
    assert.equal(report.summary.plannedCreates, report.summary.baselineRows);
    assert.equal(report.summary.conflicts, 0);
    assert.equal(Boolean(report.run?.id), true);
  } finally {
    dataService.fetchData = originalFetchData;
    restoreRunPath();
  }
});

test('apply dry-run returns structured report without mutating repositories', async () => {
  const restoreRunPath = withTempRunPath();
  const originalFetchData = dataService.fetchData;
  const originalAddData = dataService.addData;
  const originalUpdateSettings = systemSettingsRepository.updateSettings;

  let addCalls = 0;
  let updateSettingsCalls = 0;

  dataService.fetchData = async () => [];
  dataService.addData = async () => {
    addCalls += 1;
    return {};
  };
  systemSettingsRepository.updateSettings = async () => {
    updateSettingsCalls += 1;
    return {};
  };

  try {
    const report = await coreBootstrapBaselineService.apply({ backendMode: 'json', actor: { id: 'TEST_USER' }, dryRun: true });
    assert.equal(report.action, 'apply-dry-run');
    assert.equal(report.summary.created > 0, true);
    assert.equal(report.summary.failed, 0);
    assert.equal(addCalls, 0);
    assert.equal(updateSettingsCalls, 0);
    assert.equal(Boolean(report.run?.id), true);
  } finally {
    dataService.fetchData = originalFetchData;
    dataService.addData = originalAddData;
    systemSettingsRepository.updateSettings = originalUpdateSettings;
    restoreRunPath();
  }
});
