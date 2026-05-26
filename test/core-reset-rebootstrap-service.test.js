const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const dataService = require('../MVC/services/dataService');
const coreBootstrapBaselineService = require('../MVC/services/coreBootstrapBaselineService');
const coreResetRebootstrapService = require('../MVC/services/coreResetRebootstrapService');

function withTempRunPath() {
  const original = process.env.CORE_BOOTSTRAP_RUN_DATA_PATH;
  const tempPath = path.join(os.tmpdir(), `core-reset-runs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`);
  process.env.CORE_BOOTSTRAP_RUN_DATA_PATH = tempPath;
  return () => {
    if (original === undefined) delete process.env.CORE_BOOTSTRAP_RUN_DATA_PATH;
    else process.env.CORE_BOOTSTRAP_RUN_DATA_PATH = original;
    try { fs.unlinkSync(tempPath); } catch (_) {}
  };
}

test('preflightReset derives purge scope from bootstrap manifest entities only', async () => {
  const restoreRunPath = withTempRunPath();
  const originalLoadBundle = coreBootstrapBaselineService.loadBaselineBundle;
  const originalFetch = dataService.fetchData;

  const fetchCalls = [];
  coreBootstrapBaselineService.loadBaselineBundle = async () => ({
    baselineId: 'core-bootstrap-security-baseline',
    baselineVersion: '1.0.0',
    manifestHash: 'HASH_1',
    sourceRoot: 'data/bootstrap/core',
    entities: [
      { entityType: 'sections' },
      { entityType: 'roles' },
      { entityType: 'pteStudents' }
    ]
  });
  dataService.fetchData = async (entityType) => {
    fetchCalls.push(entityType);
    if (entityType === 'sections') return [{ id: '1' }, { id: '2' }];
    if (entityType === 'roles') return [{ id: '3' }];
    return [];
  };

  try {
    const report = await coreResetRebootstrapService.preflightReset({ backendMode: 'json', actor: { id: 'TEST_USER' } });
    assert.equal(report.action, 'reset-preflight');
    assert.deepEqual(fetchCalls, ['roles', 'sections']);
    assert.deepEqual(
      report.entities.map((row) => row.entityType),
      ['roles', 'sections']
    );
    assert.equal(report.summary.totalRows, 3);
  } finally {
    coreBootstrapBaselineService.loadBaselineBundle = originalLoadBundle;
    dataService.fetchData = originalFetch;
    restoreRunPath();
  }
});

test('applyResetAndBootstrap rejects invalid confirmation token', async () => {
  await assert.rejects(
    () => coreResetRebootstrapService.applyResetAndBootstrap({
      backendMode: 'json',
      actor: { id: 'TEST_USER' },
      confirmToken: 'WRONG TOKEN'
    }),
    /Confirmation token mismatch/i
  );
});

test('applyResetAndBootstrap purges scoped entities then runs bootstrap apply', async () => {
  const restoreRunPath = withTempRunPath();
  const originalLoadBundle = coreBootstrapBaselineService.loadBaselineBundle;
  const originalFetch = dataService.fetchData;
  const originalDelete = dataService.deleteData;
  const originalBootstrapApply = coreBootstrapBaselineService.apply;

  const deleted = [];
  let bootstrapApplyCalls = 0;

  coreBootstrapBaselineService.loadBaselineBundle = async () => ({
    baselineId: 'core-bootstrap-security-baseline',
    baselineVersion: '1.0.0',
    manifestHash: 'HASH_2',
    sourceRoot: 'data/bootstrap/core',
    entities: [
      { entityType: 'sections' },
      { entityType: 'accesses' }
    ]
  });
  dataService.fetchData = async (entityType) => {
    if (entityType === 'sections') return [{ id: 'SEC_1' }, { id: 'SEC_2' }];
    if (entityType === 'accesses') return [{ id: 'ACC_1' }];
    return [];
  };
  dataService.deleteData = async (entityType, id) => {
    deleted.push(`${entityType}:${id}`);
    return { ok: true };
  };
  coreBootstrapBaselineService.apply = async () => {
    bootstrapApplyCalls += 1;
    return {
      action: 'apply',
      summary: { failed: 0, created: 10 },
      run: { id: 'BOOTSTRAP_RUN_1' },
      baseline: { id: 'core-bootstrap-security-baseline', version: '1.0.0', manifestHash: 'HASH_2' }
    };
  };

  try {
    const report = await coreResetRebootstrapService.applyResetAndBootstrap({
      backendMode: 'json',
      actor: { id: 'TEST_USER' },
      confirmToken: 'RESET CORE'
    });
    assert.equal(bootstrapApplyCalls, 1);
    assert.deepEqual(deleted, ['accesses:ACC_1', 'sections:SEC_1', 'sections:SEC_2']);
    assert.equal(report.overallStatus, 'success');
    assert.equal(report.resetSummary.summary.deleted, 3);
    assert.equal(report.runIds.bootstrapRunId, 'BOOTSTRAP_RUN_1');
    assert.equal(Boolean(report.runIds.resetApplyRunId), true);
  } finally {
    coreBootstrapBaselineService.loadBaselineBundle = originalLoadBundle;
    dataService.fetchData = originalFetch;
    dataService.deleteData = originalDelete;
    coreBootstrapBaselineService.apply = originalBootstrapApply;
    restoreRunPath();
  }
});
