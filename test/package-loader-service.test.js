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

function makeSpyLogger() {
  const events = { info: [], warn: [], success: [], error: [], debug: [] };
  return {
    events,
    info(...args) { events.info.push(args); },
    warn(...args) { events.warn.push(args); },
    success(...args) { events.success.push(args); },
    error(...args) { events.error.push(args); },
    debug(...args) { events.debug.push(args); }
  };
}

async function withTempPackageWorkspace(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-loader-'));
  const packageRootDir = path.join(tempRoot, 'packages');
  const registryPath = path.join(tempRoot, 'packageRegistry.test.json');
  const originalOverride = process.env.PACKAGE_REGISTRY_DATA_PATH;
  const originalLocalDevMode = process.env.PACKAGE_LOCAL_DEV_MODE;
  const originalLocalRegistryFile = process.env.PACKAGE_LOCAL_REGISTRY_FILE;
  const originalManifestRetryMs = process.env.PACKAGE_STARTUP_MANIFEST_RETRY_MS;
  const originalManifestRetryIntervalMs = process.env.PACKAGE_STARTUP_MANIFEST_RETRY_INTERVAL_MS;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.PACKAGE_REGISTRY_DATA_PATH = registryPath;
  process.env.PACKAGE_STARTUP_MANIFEST_RETRY_MS = '60';
  process.env.PACKAGE_STARTUP_MANIFEST_RETRY_INTERVAL_MS = '10';

  try {
    await fs.mkdir(packageRootDir, { recursive: true });
    await callback({ tempRoot, packageRootDir, registryPath });
  } finally {
    if (originalOverride === undefined) delete process.env.PACKAGE_REGISTRY_DATA_PATH;
    else process.env.PACKAGE_REGISTRY_DATA_PATH = originalOverride;
    if (originalLocalDevMode === undefined) delete process.env.PACKAGE_LOCAL_DEV_MODE;
    else process.env.PACKAGE_LOCAL_DEV_MODE = originalLocalDevMode;
    if (originalLocalRegistryFile === undefined) delete process.env.PACKAGE_LOCAL_REGISTRY_FILE;
    else process.env.PACKAGE_LOCAL_REGISTRY_FILE = originalLocalRegistryFile;
    if (originalManifestRetryMs === undefined) delete process.env.PACKAGE_STARTUP_MANIFEST_RETRY_MS;
    else process.env.PACKAGE_STARTUP_MANIFEST_RETRY_MS = originalManifestRetryMs;
    if (originalManifestRetryIntervalMs === undefined) delete process.env.PACKAGE_STARTUP_MANIFEST_RETRY_INTERVAL_MS;
    else process.env.PACKAGE_STARTUP_MANIFEST_RETRY_INTERVAL_MS = originalManifestRetryIntervalMs;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
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

function createUseRouteDeclaration(overrides = {}) {
  return {
    id: 'ROUTE_USE_1',
    method: 'USE',
    path: '/students',
    router: 'MVC/routes/pte/studentRoutes.js',
    active: true,
    ...overrides
  };
}

function createExpressLikeFunction() {
  const fn = function expressLike() {};
  fn.use = () => {};
  fn.get = () => {};
  fn.set = () => {};
  fn.locals = {};
  return fn;
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

test('loader keeps package enabled when manifest file is missing at startup', async () => {
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
    assert.equal(summary.failed[0].autoDisabled, false);
    assert.equal(Boolean(registryRow?.enabled), true);
    assert.equal(String(registryRow?.installStatus || ''), 'enabled');
  });
});

test('loader accepts function-based express app/runtime router contexts', async () => {
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

    const runtimeRouter = createExpressLikeFunction();
    const app = createExpressLikeFunction();
    app.locals.packageRuntimeRouter = runtimeRouter;

    let routeAppRef = null;
    let viewAppRef = null;
    let assetAppRef = null;

    const hooks = {
      registerRoutes: async ({ app: hookApp }) => { routeAppRef = hookApp; return { requested: 0, prepared: 0, mounted: 0, failed: 0, results: [] }; },
      registerViews: async ({ app: hookApp }) => { viewAppRef = hookApp; return { requested: 0, registered: 0, failed: 0 }; },
      registerAssets: async ({ app: hookApp }) => { assetAppRef = hookApp; return { requested: 0, mounted: 0, failed: 0 }; },
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

test('loader route health succeeds with function-based express context when USE route is mounted', async () => {
  await withTempPackageWorkspace(async ({ packageRootDir }) => {
    await writeManifest(packageRootDir, 'pte', {
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte',
      routes: [createUseRouteDeclaration()]
    });
    await packageRegistryService.upsertPackageRegistry({
      packageId: 'pte',
      enabled: true,
      installStatus: 'enabled'
    }, { backendMode: 'json' });

    const runtimeRouter = createExpressLikeFunction();
    const app = createExpressLikeFunction();
    app.locals.packageRuntimeRouter = runtimeRouter;

    const hooks = {
      registerRoutes: async ({ app: hookApp }) => ({
        requested: 1,
        prepared: 1,
        mounted: hookApp && typeof hookApp.use === 'function' ? 1 : 0,
        failed: 0,
        results: [{
          method: 'USE',
          path: '/students',
          status: hookApp && typeof hookApp.use === 'function' ? 'mounted' : 'prepared',
          message: hookApp && typeof hookApp.use === 'function' ? 'Mounted.' : 'No app context.'
        }]
      }),
      registerViews: async () => ({ requested: 0, registered: 0, failed: 0 }),
      registerAssets: async () => ({ requested: 0, mounted: 0, failed: 0 }),
      registerRegistryData: async () => {},
      registerUploadFolders: async () => {},
      registerQueryExecutors: async () => {}
    };

    const summary = await packageLoaderService.loadEnabledPackages({
      backendMode: 'json',
      packageRootDir,
      continueOnError: true,
      app,
      packageRuntimeRouter: runtimeRouter,
      hooks,
      logger: makeSilentLogger()
    });

    assert.equal(summary.loadedCount, 1);
    assert.equal(summary.failedCount, 0);
    assert.equal(summary.loaded[0].packageId, 'pte');
  });
});

test('loader retries missing manifest and succeeds if manifest appears in retry window', async () => {
  await withTempPackageWorkspace(async ({ packageRootDir }) => {
    await packageRegistryService.upsertPackageRegistry({
      packageId: 'delayed-pte',
      enabled: true,
      installStatus: 'enabled'
    }, { backendMode: 'json' });

    process.env.PACKAGE_STARTUP_MANIFEST_RETRY_MS = '450';
    process.env.PACKAGE_STARTUP_MANIFEST_RETRY_INTERVAL_MS = '50';

    const timer = setTimeout(() => {
      writeManifest(packageRootDir, 'delayed-pte', {
        id: 'delayed-pte',
        name: 'Delayed PTE',
        version: '1.0.0',
        mountPath: '/delayed-pte'
      }).catch(() => {});
    }, 140);

    const summary = await packageLoaderService.loadEnabledPackages({
      backendMode: 'json',
      packageRootDir,
      continueOnError: true,
      logger: makeSilentLogger()
    });
    clearTimeout(timer);

    const registryRow = await packageRegistryService.getPackageRegistryById('delayed-pte', { backendMode: 'json' });
    assert.equal(summary.loadedCount, 1);
    assert.equal(summary.failedCount, 0);
    assert.equal(summary.loaded[0].packageId, 'delayed-pte');
    assert.equal(Boolean(registryRow?.enabled), true);
    assert.equal(String(registryRow?.installStatus || ''), 'enabled');
  });
});

test('loader records startup failure after retry exhaustion without mutating registry state', async () => {
  await withTempPackageWorkspace(async ({ packageRootDir }) => {
    await packageRegistryService.upsertPackageRegistry({
      packageId: 'retry-missing',
      enabled: true,
      installStatus: 'enabled'
    }, { backendMode: 'json' });

    process.env.PACKAGE_STARTUP_MANIFEST_RETRY_MS = '160';
    process.env.PACKAGE_STARTUP_MANIFEST_RETRY_INTERVAL_MS = '40';

    const summary = await packageLoaderService.loadEnabledPackages({
      backendMode: 'json',
      packageRootDir,
      continueOnError: true,
      logger: makeSilentLogger()
    });

    const registryRow = await packageRegistryService.getPackageRegistryById('retry-missing', { backendMode: 'json' });
    assert.equal(summary.loadedCount, 0);
    assert.equal(summary.failedCount, 1);
    assert.equal(summary.failed[0].packageId, 'retry-missing');
    assert.match(String(summary.failed[0].message || ''), /No manifest file found/i);
    assert.equal(Boolean(registryRow?.enabled), true);
    assert.equal(String(registryRow?.installStatus || ''), 'enabled');
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

test('loader clears stale registry warnings/errors after successful startup load', async () => {
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
      installStatus: 'failed',
      lastWarning: 'Auto-disabled at startup: No manifest file found for this enabled package.',
      lastError: 'Missing manifest'
    }, { backendMode: 'json' });

    const summary = await packageLoaderService.loadEnabledPackages({
      backendMode: 'json',
      packageRootDir,
      logger: makeSilentLogger()
    });

    const registryRow = await packageRegistryService.getPackageRegistryById('pte', { backendMode: 'json' });
    assert.equal(summary.loadedCount, 1);
    assert.equal(Boolean(registryRow?.enabled), true);
    assert.equal(String(registryRow?.installStatus || ''), 'enabled');
    assert.equal(String(registryRow?.lastWarning || ''), '');
    assert.equal(String(registryRow?.lastError || ''), '');
  });
});

test('loader records runtime route-mount failure when active USE routes fail during startup', async () => {
  await withTempPackageWorkspace(async ({ packageRootDir }) => {
    await writeManifest(packageRootDir, 'pte', {
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte',
      routes: [createUseRouteDeclaration()]
    });
    await packageRegistryService.upsertPackageRegistry({
      packageId: 'pte',
      enabled: true,
      installStatus: 'enabled'
    }, { backendMode: 'json' });

    const hooks = {
      registerRoutes: async () => ({
        requested: 1,
        prepared: 1,
        mounted: 0,
        failed: 1,
        results: [{ method: 'USE', path: '/students', status: 'failed', message: 'Router export not found.' }]
      }),
      registerViews: async () => ({ requested: 0, registered: 0, failed: 0 }),
      registerAssets: async () => ({ requested: 0, mounted: 0, failed: 0 }),
      registerRegistryData: async () => {},
      registerUploadFolders: async () => {},
      registerQueryExecutors: async () => {}
    };
    const app = { use() {}, get() {}, set() {}, locals: { packageRuntimeRouter: { use() {} } } };

    const summary = await packageLoaderService.loadEnabledPackages({
      backendMode: 'json',
      packageRootDir,
      continueOnError: true,
      hooks,
      app,
      packageRuntimeRouter: app.locals.packageRuntimeRouter,
      logger: makeSilentLogger()
    });

    assert.equal(summary.loadedCount, 0);
    assert.equal(summary.failedCount, 1);
    assert.equal(summary.failed[0].packageId, 'pte');
    assert.equal(summary.failed[0].code, 'PACKAGE_RUNTIME_ROUTE_MOUNT_FAILED');
    assert.match(String(summary.failed[0].message || ''), /failed route declarations/i);
    assert.equal(Number(summary.failed[0]?.details?.expectedUseRoutes || 0), 1);
  });
});

test('loader records runtime route-mount failure when active USE routes report zero effective mounts', async () => {
  await withTempPackageWorkspace(async ({ packageRootDir }) => {
    await writeManifest(packageRootDir, 'pte', {
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte',
      routes: [createUseRouteDeclaration()]
    });
    await packageRegistryService.upsertPackageRegistry({
      packageId: 'pte',
      enabled: true,
      installStatus: 'enabled'
    }, { backendMode: 'json' });

    const hooks = {
      registerRoutes: async () => ({
        requested: 1,
        prepared: 1,
        mounted: 0,
        failed: 0,
        results: [{ method: 'USE', path: '/students', status: 'prepared', message: 'No app context.' }]
      }),
      registerViews: async () => ({ requested: 0, registered: 0, failed: 0 }),
      registerAssets: async () => ({ requested: 0, mounted: 0, failed: 0 }),
      registerRegistryData: async () => {},
      registerUploadFolders: async () => {},
      registerQueryExecutors: async () => {}
    };
    const app = { use() {}, get() {}, set() {}, locals: { packageRuntimeRouter: { use() {} } } };

    const summary = await packageLoaderService.loadEnabledPackages({
      backendMode: 'json',
      packageRootDir,
      continueOnError: true,
      hooks,
      app,
      packageRuntimeRouter: app.locals.packageRuntimeRouter,
      logger: makeSilentLogger()
    });

    assert.equal(summary.loadedCount, 0);
    assert.equal(summary.failedCount, 1);
    assert.equal(summary.failed[0].packageId, 'pte');
    assert.equal(summary.failed[0].code, 'PACKAGE_RUNTIME_ROUTE_MOUNT_FAILED');
    assert.match(String(summary.failed[0].message || ''), /zero mounted routes/i);
  });
});

test('loader accepts already-mounted skipped USE routes as effective startup mounts', async () => {
  await withTempPackageWorkspace(async ({ packageRootDir }) => {
    await writeManifest(packageRootDir, 'pte', {
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte',
      routes: [createUseRouteDeclaration()]
    });
    await packageRegistryService.upsertPackageRegistry({
      packageId: 'pte',
      enabled: true,
      installStatus: 'enabled'
    }, { backendMode: 'json' });

    const hooks = {
      registerRoutes: async () => ({
        requested: 1,
        prepared: 1,
        mounted: 0,
        failed: 0,
        results: [{ method: 'USE', path: '/students', status: 'skipped', message: 'Route already mounted in this process.' }]
      }),
      registerViews: async () => ({ requested: 0, registered: 0, failed: 0 }),
      registerAssets: async () => ({ requested: 0, mounted: 0, failed: 0 }),
      registerRegistryData: async () => {},
      registerUploadFolders: async () => {},
      registerQueryExecutors: async () => {}
    };
    const app = { use() {}, get() {}, set() {}, locals: { packageRuntimeRouter: { use() {} } } };

    const summary = await packageLoaderService.loadEnabledPackages({
      backendMode: 'json',
      packageRootDir,
      continueOnError: true,
      hooks,
      app,
      packageRuntimeRouter: app.locals.packageRuntimeRouter,
      logger: makeSilentLogger()
    });

    assert.equal(summary.loadedCount, 1);
    assert.equal(summary.failedCount, 0);
    assert.equal(summary.loaded[0].packageId, 'pte');
  });
});

test('loader ignores local sync mode in production and uses registry source', async () => {
  await withTempPackageWorkspace(async ({ tempRoot, packageRootDir }) => {
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

    const localCachePath = path.join(tempRoot, 'localPackageRegistry.json');
    await fs.writeFile(localCachePath, JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      packages: [
        {
          packageId: 'school',
          enabled: true,
          manifestPath: path.join(packageRootDir, 'school', 'package.manifest.json')
        }
      ]
    }, null, 2), 'utf8');

    process.env.NODE_ENV = 'production';
    process.env.PACKAGE_LOCAL_DEV_MODE = 'true';
    process.env.PACKAGE_LOCAL_REGISTRY_FILE = localCachePath;

    const logger = makeSpyLogger();
    const summary = await packageLoaderService.loadEnabledPackages({
      backendMode: 'json',
      packageRootDir,
      logger
    });

    assert.equal(summary.localDevMode, false);
    assert.equal(summary.source, 'registry');
    assert.equal(summary.loadedCount, 1);
    assert.equal(summary.loaded[0].packageId, 'pte');
    assert.equal(logger.events.warn.length > 0, true);
    assert.match(String(logger.events.warn[0]?.[1] || ''), /LOCAL_MODE_IGNORED_IN_PRODUCTION/i);
  });
});

test('loader uses local JSON cache as source in local dev mode', async () => {
  await withTempPackageWorkspace(async ({ tempRoot, packageRootDir }) => {
    await writeManifest(packageRootDir, 'pte', {
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte'
    });
    const localCachePath = path.join(tempRoot, 'localPackageRegistry.json');
    await fs.writeFile(localCachePath, JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      packages: [
        {
          packageId: 'pte',
          enabled: true,
          manifestPath: path.join(packageRootDir, 'pte', 'package.manifest.json')
        }
      ]
    }, null, 2), 'utf8');

    process.env.PACKAGE_LOCAL_DEV_MODE = 'true';
    process.env.PACKAGE_LOCAL_REGISTRY_FILE = localCachePath;

    const summary = await packageLoaderService.loadEnabledPackages({
      backendMode: 'mongo',
      packageRootDir,
      logger: makeSilentLogger()
    });

    assert.equal(summary.localDevMode, true);
    assert.equal(summary.source, 'local-cache');
    assert.equal(summary.enabledCount, 1);
    assert.equal(summary.loadedCount, 1);
    assert.equal(summary.failedCount, 0);
    assert.equal(summary.loaded[0].packageId, 'pte');
    assert.equal(path.resolve(summary.localRegistryFilePath), path.resolve(localCachePath));
    assert.equal(summary.localRegistryCacheExists, true);
  });
});

test('loader does not mutate DB package registry when local mode cache row fails to load', async () => {
  await withTempPackageWorkspace(async ({ tempRoot, packageRootDir }) => {
    await packageRegistryService.upsertPackageRegistry({
      packageId: 'missing-local',
      enabled: true,
      installStatus: 'enabled'
    }, { backendMode: 'json' });

    const localCachePath = path.join(tempRoot, 'localPackageRegistry.json');
    await fs.writeFile(localCachePath, JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      packages: [
        {
          packageId: 'missing-local',
          enabled: true,
          manifestPath: path.join(packageRootDir, 'missing-local', 'package.manifest.json')
        }
      ]
    }, null, 2), 'utf8');

    process.env.PACKAGE_LOCAL_DEV_MODE = 'true';
    process.env.PACKAGE_LOCAL_REGISTRY_FILE = localCachePath;

    const summary = await packageLoaderService.loadEnabledPackages({
      backendMode: 'json',
      packageRootDir,
      continueOnError: true,
      logger: makeSilentLogger()
    });

    const registryRow = await packageRegistryService.getPackageRegistryById('missing-local', { backendMode: 'json' });
    assert.equal(summary.localDevMode, true);
    assert.equal(summary.failedCount, 1);
    assert.equal(summary.failed[0].packageId, 'missing-local');
    assert.equal(summary.failed[0].autoDisabled, false);
    assert.equal(Boolean(registryRow?.enabled), true);
    assert.equal(String(registryRow?.installStatus || ''), 'enabled');
  });
});

test('loader in local mode warns and safely skips when local cache file is missing', async () => {
  await withTempPackageWorkspace(async ({ tempRoot, packageRootDir }) => {
    const localCachePath = path.join(tempRoot, 'does-not-exist.localPackageRegistry.json');
    process.env.PACKAGE_LOCAL_DEV_MODE = 'true';
    process.env.PACKAGE_LOCAL_REGISTRY_FILE = localCachePath;

    const logger = makeSpyLogger();
    const summary = await packageLoaderService.loadEnabledPackages({
      backendMode: 'json',
      packageRootDir,
      logger
    });

    assert.equal(summary.localDevMode, true);
    assert.equal(summary.source, 'local-cache');
    assert.equal(summary.localRegistryCacheExists, false);
    assert.equal(summary.enabledCount, 0);
    assert.equal(summary.loadedCount, 0);
    assert.equal(summary.failedCount, 0);
    assert.equal(logger.events.warn.length > 0, true);
    assert.match(String(logger.events.warn[0]?.[1] || ''), /LOCAL_CACHE_MISSING/i);
  });
});
