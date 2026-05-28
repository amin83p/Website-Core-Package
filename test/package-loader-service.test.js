const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const packageRegistryService = require('../MVC/services/packageRegistryService');
const packageLoaderService = require('../MVC/services/packageLoaderService');

function makeSilentLogger() {
  return {
    info() {},
    warn() {},
    success() {},
    error() {},
    debug() {}
  };
}

async function withTempPackageWorkspace(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-loader-'));
  const packageRootDir = path.join(tempRoot, 'packages');
  const registryPath = path.join(tempRoot, 'packageRegistry.test.json');
  const originalOverride = process.env.PACKAGE_REGISTRY_DATA_PATH;
  process.env.PACKAGE_REGISTRY_DATA_PATH = registryPath;

  try {
    await fs.mkdir(packageRootDir, { recursive: true });
    await callback({ tempRoot, packageRootDir, registryPath });
  } finally {
    if (originalOverride === undefined) delete process.env.PACKAGE_REGISTRY_DATA_PATH;
    else process.env.PACKAGE_REGISTRY_DATA_PATH = originalOverride;
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function writeManifest(packageRootDir, packageId, payload) {
  const dir = path.join(packageRootDir, packageId);
  await fs.mkdir(dir, { recursive: true });
  const manifestPath = path.join(dir, 'package.manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(payload, null, 2), 'utf8');
  return manifestPath;
}

test('loader returns empty summary when no enabled packages exist', async () => {
  await withTempPackageWorkspace(async ({ packageRootDir }) => {
    const summary = await packageLoaderService.loadEnabledPackages({
      backendMode: 'json',
      packageRootDir,
      logger: makeSilentLogger()
    });

    assert.equal(summary.enabledCount, 0);
    assert.equal(summary.loadedCount, 0);
    assert.equal(summary.failedCount, 0);
    assert.deepEqual(summary.loaded, []);
    assert.deepEqual(summary.failed, []);
  });
});

test('loader processes enabled package and executes registration hooks', async () => {
  await withTempPackageWorkspace(async ({ packageRootDir }) => {
    await writeManifest(packageRootDir, 'pte', {
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte'
    });
    await packageRegistryService.upsertPackageRegistry({
      packageId: 'pte',
      enabled: true,
      installStatus: 'enabled'
    }, { backendMode: 'json' });

    const calls = [];
    const hooks = {
      registerRoutes: async ({ packageId }) => calls.push(`routes:${packageId}`),
      registerViews: async ({ packageId }) => calls.push(`views:${packageId}`),
      registerAssets: async ({ packageId }) => calls.push(`assets:${packageId}`),
      registerRegistryData: async ({ packageId }) => calls.push(`registry:${packageId}`),
      registerUploadFolders: async ({ packageId }) => calls.push(`folders:${packageId}`),
      registerQueryExecutors: async ({ packageId }) => calls.push(`queries:${packageId}`)
    };

    const summary = await packageLoaderService.loadEnabledPackages({
      backendMode: 'json',
      packageRootDir,
      hooks,
      logger: makeSilentLogger()
    });

    assert.equal(summary.enabledCount, 1);
    assert.equal(summary.loadedCount, 1);
    assert.equal(summary.failedCount, 0);
    assert.equal(summary.loaded[0].packageId, 'pte');
    assert.deepEqual(calls, [
      'routes:pte',
      'views:pte',
      'assets:pte',
      'registry:pte',
      'folders:pte',
      'queries:pte'
    ]);
  });
});

test('loader prefers package runtime router for route/asset hooks when provided', async () => {
  await withTempPackageWorkspace(async ({ packageRootDir }) => {
    await writeManifest(packageRootDir, 'pte', {
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte'
    });
    await packageRegistryService.upsertPackageRegistry({
      packageId: 'pte',
      enabled: true,
      installStatus: 'enabled'
    }, { backendMode: 'json' });

    const runtimeRouter = { use() {} };
    const app = { use() {}, get() {}, set() {}, locals: { packageRuntimeRouter: runtimeRouter } };
    let routeAppRef = null;
    let viewAppRef = null;
    let assetAppRef = null;

    const hooks = {
      registerRoutes: async ({ app: hookApp }) => { routeAppRef = hookApp; },
      registerViews: async ({ app: hookApp }) => { viewAppRef = hookApp; },
      registerAssets: async ({ app: hookApp }) => { assetAppRef = hookApp; },
      registerRegistryData: async () => {},
      registerUploadFolders: async () => {},
      registerQueryExecutors: async () => {}
    };

    const summary = await packageLoaderService.loadEnabledPackages({
      backendMode: 'json',
      packageRootDir,
      app,
      packageRuntimeRouter: runtimeRouter,
      hooks,
      logger: makeSilentLogger()
    });

    assert.equal(summary.loadedCount, 1);
    assert.equal(routeAppRef, runtimeRouter);
    assert.equal(assetAppRef, runtimeRouter);
    assert.equal(viewAppRef, app);
  });
});

test('loader skips invalid package manifest without crashing when continueOnError=true', async () => {
  await withTempPackageWorkspace(async ({ packageRootDir }) => {
    await writeManifest(packageRootDir, 'school', {
      id: 'school'
    });
    await packageRegistryService.upsertPackageRegistry({
      packageId: 'school',
      enabled: true,
      installStatus: 'enabled'
    }, { backendMode: 'json' });

    const summary = await packageLoaderService.loadEnabledPackages({
      backendMode: 'json',
      packageRootDir,
      continueOnError: true,
      logger: makeSilentLogger()
    });

    assert.equal(summary.enabledCount, 1);
    assert.equal(summary.loadedCount, 0);
    assert.equal(summary.failedCount, 1);
    assert.equal(summary.failed[0].packageId, 'school');
    assert.match(String(summary.failed[0].message || ''), /required|manifest/i);
  });
});

test('loader auto-disables enabled package when manifest file is missing', async () => {
  await withTempPackageWorkspace(async ({ packageRootDir }) => {
    await packageRegistryService.upsertPackageRegistry({
      packageId: 'missing-pte',
      enabled: true,
      installStatus: 'enabled',
      metadata: {
        manifestPath: path.join(packageRootDir, 'missing-pte', 'package.manifest.json')
      }
    }, { backendMode: 'json' });

    const summary = await packageLoaderService.loadEnabledPackages({
      backendMode: 'json',
      packageRootDir,
      continueOnError: true,
      logger: makeSilentLogger()
    });

    const registryRow = await packageRegistryService.getPackageRegistryById('missing-pte', { backendMode: 'json' });

    assert.equal(summary.enabledCount, 1);
    assert.equal(summary.failedCount, 1);
    assert.equal(summary.failed[0].packageId, 'missing-pte');
    assert.equal(summary.failed[0].autoDisabled, true);
    assert.equal(Boolean(registryRow?.enabled), false);
    assert.equal(String(registryRow?.installStatus || ''), 'failed');
    assert.match(String(registryRow?.lastWarning || ''), /Auto-disabled at startup/i);
  });
});

test('loader uses manifestPath metadata when provided', async () => {
  await withTempPackageWorkspace(async ({ tempRoot, packageRootDir }) => {
    const externalDir = path.join(tempRoot, 'custom-manifests');
    await fs.mkdir(externalDir, { recursive: true });
    const customManifestPath = path.join(externalDir, 'credit.manifest.json');
    await fs.writeFile(customManifestPath, JSON.stringify({
      id: 'credit',
      name: 'Credit',
      version: '1.0.0',
      mountPath: '/credit'
    }, null, 2), 'utf8');

    await packageRegistryService.upsertPackageRegistry({
      packageId: 'credit',
      enabled: true,
      installStatus: 'enabled',
      metadata: {
        manifestPath: customManifestPath
      }
    }, { backendMode: 'json' });

    const summary = await packageLoaderService.loadEnabledPackages({
      backendMode: 'json',
      packageRootDir,
      logger: makeSilentLogger()
    });

    assert.equal(summary.enabledCount, 1);
    assert.equal(summary.loadedCount, 1);
    assert.equal(summary.loaded[0].packageId, 'credit');
    assert.equal(path.resolve(summary.loaded[0].manifestPath), path.resolve(customManifestPath));
  });
});
