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

test('preflightReset derives deletion candidates from baseline identities only', async () => {
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
      {
        entityType: 'sections',
        identityFields: ['id', 'name'],
        rows: [{ id: '1', name: 'Section One' }, { id: '2', name: 'Section Two' }]
      },
      {
        entityType: 'roles',
        identityFields: ['id', 'key'],
        rows: [{ id: '3', key: 'role_one' }]
      },
      { entityType: 'pteStudents' }
    ]
  });
  dataService.fetchData = async (entityType) => {
    fetchCalls.push(entityType);
    if (entityType === 'sections') return [{ id: '1', name: 'Section One' }, { id: '2', name: 'Section Two' }, { id: '9', name: 'Other' }];
    if (entityType === 'roles') return [{ id: '3', key: 'role_one' }, { id: '4', key: 'role_two' }];
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
    assert.equal(report.summary.totalDeleteCandidates, 3);
    assert.equal(report.summary.totalProtected, 0);
  } finally {
    coreBootstrapBaselineService.loadBaselineBundle = originalLoadBundle;
    dataService.fetchData = originalFetch;
    restoreRunPath();
  }
});

test('applyCoreReset rejects invalid confirmation token', async () => {
  await assert.rejects(
    () => coreResetRebootstrapService.applyCoreReset({
      backendMode: 'json',
      actor: { id: 'TEST_USER' },
      confirmToken: 'WRONG TOKEN'
    }),
    /Confirmation token mismatch/i
  );
});

test('applyCoreReset deletes only baseline-matched rows and preserves package-owned rows', async () => {
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
      {
        entityType: 'sections',
        identityFields: ['id', 'name'],
        rows: [{ id: 'SEC_1', name: 'One' }, { id: 'SEC_2', name: 'Two' }]
      },
      {
        entityType: 'accesses',
        identityFields: ['id', 'name', 'orgId'],
        rows: [{ id: 'ACC_1', name: 'Access One', orgId: '' }]
      }
    ]
  });
  dataService.fetchData = async (entityType) => {
    if (entityType === 'sections') {
      return [
        { id: 'SEC_1', name: 'One' },
        { id: 'SEC_2', name: 'Two', packageId: 'pte' },
        { id: 'SEC_3', name: 'Three' }
      ];
    }
    if (entityType === 'accesses') return [{ id: 'ACC_1', name: 'Access One', orgId: '' }];
    return [];
  };
  dataService.deleteData = async (entityType, id) => {
    deleted.push(`${entityType}:${id}`);
    return { ok: true };
  };
  coreBootstrapBaselineService.apply = async () => {
    bootstrapApplyCalls += 1;
    throw new Error('bootstrap apply must not be called in core reset');
  };

  try {
    const report = await coreResetRebootstrapService.applyCoreReset({
      backendMode: 'json',
      actor: { id: 'TEST_USER' },
      confirmToken: 'RESET CORE'
    });
    assert.equal(bootstrapApplyCalls, 0);
    assert.deepEqual(deleted, ['accesses:ACC_1', 'sections:SEC_1']);
    assert.equal(report.overallStatus, 'success');
    assert.equal(report.resetSummary.summary.deleted, 2);
    assert.equal(report.runIds.resetPreflightRunId !== '', true);
    assert.equal(Boolean(report.runIds.resetApplyRunId), true);
    assert.equal(report.warnings.some((row) => String(row).includes('owned by package "pte"')), true);
  } finally {
    coreBootstrapBaselineService.loadBaselineBundle = originalLoadBundle;
    dataService.fetchData = originalFetch;
    dataService.deleteData = originalDelete;
    coreBootstrapBaselineService.apply = originalBootstrapApply;
    restoreRunPath();
  }
});
