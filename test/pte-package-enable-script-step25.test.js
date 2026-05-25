const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_ENABLE_SCRIPT = 'packages/pte/scripts/maintenance/enable-pte-package.js';

async function withTempRegistry(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pte-package-step25-'));
  const registryPath = path.join(tempRoot, 'packageRegistry.test.json');

  try {
    await callback({ registryPath });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

function runPackageEnableScript(args = [], registryPath = '') {
  return spawnSync(process.execPath, [PACKAGE_ENABLE_SCRIPT, ...args], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PACKAGE_REGISTRY_DATA_PATH: registryPath
    },
    encoding: 'utf8'
  });
}

test('package-local PTE enable script dry-run reads package manifest without writing registry', async () => {
  await withTempRegistry(async ({ registryPath }) => {
    const result = runPackageEnableScript(['--json'], registryPath);

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.apply, false);
    assert.equal(report.action, 'create');
    assert.equal(report.payload.packageId, 'pte');
    assert.equal(report.payload.enabled, true);
    assert.equal(report.payload.metadata.manifestPath, 'packages/pte/package.manifest.json');
    assert.equal(report.payload.metadata.activatedBy, PACKAGE_ENABLE_SCRIPT);
    assert.equal(report.payload.metadata.declarationCounts.views, 1);
    assert.equal(report.payload.metadata.declarationCounts.assets, 1);

    await assert.rejects(() => fs.stat(registryPath), { code: 'ENOENT' });
  });
});

test('package-local PTE enable script apply upserts registry idempotently', async () => {
  await withTempRegistry(async ({ registryPath }) => {
    const first = runPackageEnableScript(['--apply', '--json'], registryPath);
    assert.equal(first.status, 0, first.stderr);
    const firstReport = JSON.parse(first.stdout);
    assert.equal(firstReport.action, 'create');
    assert.equal(firstReport.result.packageId, 'pte');
    assert.equal(firstReport.result.enabled, true);
    assert.equal(firstReport.result.installStatus, 'enabled');
    assert.equal(firstReport.result.metadata.activatedBy, PACKAGE_ENABLE_SCRIPT);

    const second = runPackageEnableScript(['--apply', '--json'], registryPath);
    assert.equal(second.status, 0, second.stderr);
    const secondReport = JSON.parse(second.stdout);
    assert.equal(secondReport.action, 'update');
    assert.equal(secondReport.result.packageId, 'pte');
    assert.equal(secondReport.result.installedAt, firstReport.result.installedAt);

    const rows = JSON.parse(await fs.readFile(registryPath, 'utf8'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].packageId, 'pte');
    assert.equal(rows[0].metadata.activatedBy, PACKAGE_ENABLE_SCRIPT);
  });
});

test('package-local PTE enable script dry-run supports disable action', async () => {
  await withTempRegistry(async ({ registryPath }) => {
    const result = runPackageEnableScript(['--disable', '--json'], registryPath);

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.apply, false);
    assert.equal(report.action, 'disable');
    assert.equal(report.payload.packageId, 'pte');
    assert.equal(report.payload.enabled, false);
    assert.equal(report.payload.installStatus, 'disabled');
    assert.equal(report.packageAction, 'disable');

    await assert.rejects(() => fs.stat(registryPath), { code: 'ENOENT' });
  });
});

test('package-local PTE enable script dry-run supports remove action', async () => {
  await withTempRegistry(async ({ registryPath }) => {
    const result = runPackageEnableScript(['--remove', '--json'], registryPath);

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.apply, false);
    assert.equal(report.action, 'remove');
    assert.equal(report.payload.packageId, 'pte');
    assert.equal(report.payload.enabled, false);
    assert.equal(report.payload.installStatus, 'removed');
    assert.equal(report.packageAction, 'remove');

    await assert.rejects(() => fs.stat(registryPath), { code: 'ENOENT' });
  });
});
