const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const packageLoaderService = require('../MVC/services/packageLoaderService');
const packageRegistryService = require('../MVC/services/packageRegistryService');
const packageRouteService = require('../MVC/services/packageRouteService');

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

    const first = spawnSync(process.execPath, ['scripts/packages/enable-pte-package.js', '--apply', '--json'], {
      cwd: ROOT_DIR,
      env,
      encoding: 'utf8'
    });
    assert.equal(first.status, 0, first.stderr);
    const firstReport = JSON.parse(first.stdout);
    assert.equal(firstReport.action, 'create');
    assert.equal(firstReport.result.packageId, 'pte');
    assert.equal(firstReport.result.enabled, true);
    assert.equal(firstReport.result.installStatus, 'enabled');
    assert.equal(firstReport.result.metadata.manifestPath, 'packages/pte/package.manifest.json');
    assert.equal(firstReport.result.metadata.declarationCounts.views, 1);
    assert.equal(firstReport.result.metadata.declarationCounts.assets, 1);

    const second = spawnSync(process.execPath, ['scripts/packages/enable-pte-package.js', '--apply', '--json'], {
      cwd: ROOT_DIR,
      env,
      encoding: 'utf8'
    });
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

test('enabled PTE package loads from registry while keeping /pte route metadata-only', async () => {
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
    assert.equal(routeSummary.mounted, 0);
    assert.equal(routeSummary.failed, 0);
    assert.equal(app.calls.length, 0);
    assert.ok(routeSummary.results.every((row) => row.metadataOnly === true));
  });
});
