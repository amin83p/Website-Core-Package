const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const CORE_ENABLE_SCRIPT = 'scripts/packages/enable-pte-package.js';

async function withTempRegistry(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pte-package-core-script-'));
  const registryPath = path.join(tempRoot, 'packageRegistry.test.json');

  try {
    await callback({ registryPath });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

function runCoreEnableScript(args = [], registryPath = '') {
  return spawnSync(process.execPath, [CORE_ENABLE_SCRIPT, ...args], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PACKAGE_REGISTRY_DATA_PATH: registryPath
    },
    encoding: 'utf8'
  });
}

test('core PTE enable script dry-run supports disable action', async () => {
  await withTempRegistry(async ({ registryPath }) => {
    const result = runCoreEnableScript(['--disable', '--json'], registryPath);

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.apply, false);
    assert.equal(report.action, 'disable');
    assert.equal(report.packageAction, 'disable');
    assert.equal(report.payload.packageId, 'pte');
    assert.equal(report.payload.enabled, false);
    assert.equal(report.payload.installStatus, 'disabled');

    await assert.rejects(() => fs.stat(registryPath), { code: 'ENOENT' });
  });
});

test('core PTE enable script dry-run supports remove action', async () => {
  await withTempRegistry(async ({ registryPath }) => {
    const result = runCoreEnableScript(['--remove', '--json'], registryPath);

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.apply, false);
    assert.equal(report.action, 'remove');
    assert.equal(report.packageAction, 'remove');
    assert.equal(report.payload.packageId, 'pte');
    assert.equal(report.payload.enabled, false);
    assert.equal(report.payload.installStatus, 'removed');

    await assert.rejects(() => fs.stat(registryPath), { code: 'ENOENT' });
  });
});
