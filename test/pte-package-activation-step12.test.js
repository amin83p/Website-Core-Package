const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const packageLoaderService = require('../MVC/services/packageLoaderService');
const packageRegistryService = require('../MVC/services/packageRegistryService');
const packageRouteService = require('../MVC/services/packageRouteService');
const coreEnableScript = require('../scripts/packages/enable-pte-package');

const ROOT_DIR = path.resolve(__dirname, '..');

function makeSilentLogger() {
  return {
    info() {},
    warn() {},
    success() {},
    error() {},
    debug() {}
  };
}

function runCoreEnableScript(args = [], env = {}) {
  const spawnResult = spawnSync(process.execPath, ['scripts/packages/enable-pte-package.js', ...args], {
    cwd: ROOT_DIR,
    env,
    encoding: 'utf8'
  });

  if (spawnResult.status !== null) {
    return {
      status: spawnResult.status,
      stderr: spawnResult.stderr,
      stdout: spawnResult.stdout
    };
  }

  const spawnErrorCode = String(spawnResult?.error?.code || '').toUpperCase();
  if (spawnErrorCode !== 'EPERM') {
    return {
      status: spawnResult.status,
      stderr: spawnResult.stderr,
      stdout: spawnResult.stdout
    };
  }

  const previousRegistryPath = process.env.PACKAGE_REGISTRY_DATA_PATH;
  const previousDataBackend = process.env.DATA_BACKEND;
  process.env.PACKAGE_REGISTRY_DATA_PATH = String(env.PACKAGE_REGISTRY_DATA_PATH || '');
  if (!process.env.DATA_BACKEND) process.env.DATA_BACKEND = 'json';

  return coreEnableScript.runEnablePtePackage(args, { emit: false })
    .then((report) => {
      const payload = JSON.stringify(report, null, 2);
      return { status: 0, stderr: '', stdout: payload };
    })
    .catch((error) => ({ status: 1, stderr: String(error?.message || error), stdout: '' }))
    .finally(() => {
      if (previousRegistryPath === undefined) delete process.env.PACKAGE_REGISTRY_DATA_PATH;
      else process.env.PACKAGE_REGISTRY_DATA_PATH = previousRegistryPath;
      if (previousDataBackend === undefined) delete process.env.DATA_BACKEND;
      else process.env.DATA_BACKEND = previousDataBackend;
    });
}

function createAppStub() {
  const calls = [];
  return {
    calls,
    use(...args) {
      calls.push(args);
    }
  };
}

async function withTempRegistry(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pte-package-step12-'));
  const registryPath = path.join(tempRoot, 'packageRegistry.test.json');
  const originalOverride = process.env.PACKAGE_REGISTRY_DATA_PATH;
  process.env.PACKAGE_REGISTRY_DATA_PATH = registryPath;

  try {
    await callback({ registryPath });
  } finally {
    if (originalOverride === undefined) delete process.env.PACKAGE_REGISTRY_DATA_PATH;
    else process.env.PACKAGE_REGISTRY_DATA_PATH = originalOverride;
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    packageRouteService.resetMountedRoutes();
  }
}

test('PTE enable script apply creates an enabled registry row and is idempotent', async () => {
  await withTempRegistry(async ({ registryPath }) => {
    const env = {
      ...process.env,
      PACKAGE_REGISTRY_DATA_PATH: registryPath
    };

    const first = await runCoreEnableScript(['--apply', '--json'], env);
    assert.equal(first.status, 0, first.stderr);
    const firstReport = JSON.parse(first.stdout);
    assert.equal(firstReport.action, 'create');
    assert.equal(firstReport.result.packageId, 'pte');
    assert.equal(firstReport.result.enabled, true);
    assert.equal(firstReport.result.installStatus, 'enabled');
    assert.equal(firstReport.result.metadata.manifestPath, 'packages/pte/package.manifest.json');
    assert.equal(firstReport.result.metadata.declarationCounts.views, 1);
    assert.equal(firstReport.result.metadata.declarationCounts.assets, 1);

    const second = await runCoreEnableScript(['--apply', '--json'], env);
    assert.equal(second.status, 0, second.stderr);
    const secondReport = JSON.parse(second.stdout);
    assert.equal(secondReport.action, 'update');
    assert.equal(secondReport.result.packageId, 'pte');
    assert.equal(secondReport.result.installedAt, firstReport.result.installedAt);

    const rows = JSON.parse(await fs.readFile(registryPath, 'utf8'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].packageId, 'pte');
  });
});

test('PTE enable script apply supports disable and remove lifecycle actions', async () => {
  await withTempRegistry(async ({ registryPath }) => {
    const env = {
      ...process.env,
      PACKAGE_REGISTRY_DATA_PATH: registryPath
    };

    const enableRun = await runCoreEnableScript(['--apply', '--json'], env);
    assert.equal(enableRun.status, 0, enableRun.stderr);

    const disableRun = await runCoreEnableScript(['--apply', '--disable', '--json'], env);
    assert.equal(disableRun.status, 0, disableRun.stderr);
    const disableReport = JSON.parse(disableRun.stdout);
    assert.equal(disableReport.action, 'disable');
    assert.equal(disableReport.packageAction, 'disable');
    assert.equal(disableReport.result.packageId, 'pte');
    assert.equal(disableReport.result.enabled, false);
    assert.equal(disableReport.result.installStatus, 'disabled');
    assert.equal(disableReport.declarationSummary.packageId, 'pte');

    const removeRun = await runCoreEnableScript(['--apply', '--remove', '--json'], env);
    assert.equal(removeRun.status, 0, removeRun.stderr);
    const removeReport = JSON.parse(removeRun.stdout);
    assert.equal(removeReport.action, 'remove');
    assert.equal(removeReport.packageAction, 'remove');
    assert.equal(removeReport.result, true);
    assert.equal(removeReport.declarationSummary.packageId, 'pte');

    const rows = JSON.parse(await fs.readFile(registryPath, 'utf8'));
    assert.equal(rows.length, 0);
  });
});

test('enabled PTE package loads from registry and mounts /pte runtime route', async () => {
  await withTempRegistry(async () => {
    packageRouteService.resetMountedRoutes();
    await packageRegistryService.upsertPackageRegistry({
      packageId: 'pte',
      version: '1.0.0',
      enabled: true,
      installStatus: 'enabled',
      metadata: {
        packageName: 'PTE',
        mountPath: '/pte',
        manifestPath: 'packages/pte/package.manifest.json'
      }
    }, { backendMode: 'json' });

    const app = createAppStub();
    const routeHooks = packageRouteService.createLoaderHooks({
      logger: makeSilentLogger()
    });
    let routeSummary = null;
    const summary = await packageLoaderService.loadEnabledPackages({
      app,
      backendMode: 'json',
      hooks: {
        registerRoutes: async (context) => {
          routeSummary = await routeHooks.registerRoutes(context);
          return routeSummary;
        }
      },
      logger: makeSilentLogger()
    });

    assert.equal(summary.enabledCount, 1);
    assert.equal(summary.loadedCount, 1);
    assert.equal(summary.failedCount, 0);
    assert.equal(summary.loaded[0].packageId, 'pte');
    assert.equal(routeSummary.packageId, 'pte');
    assert.equal(routeSummary.requested, 6);
    assert.equal(routeSummary.mounted, 1);
    assert.equal(routeSummary.failed, 0);
    assert.equal(app.calls.length, 1);
  });
});
