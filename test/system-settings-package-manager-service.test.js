const test = require('node:test');
const assert = require('node:assert/strict');

const { createService } = require('../MVC/services/systemSettingsPackageManagerService');

function createDirent(name) {
  return {
    name,
    isDirectory: () => true
  };
}

function createManifest(overrides = {}) {
  return {
    id: 'pte',
    name: 'PTE',
    version: '1.0.0',
    mountPath: '/pte',
    routes: [],
    queryExecutors: [],
    views: {},
    assets: {},
    operations: [],
    roles: [],
    sections: [],
    symbols: [],
    accesses: [],
    uploadFolders: [],
    quotaDefinitions: [],
    settings: [],
    menuEntries: [],
    dashboardEntries: [],
    seeders: [],
    migrations: [],
    dependencies: [],
    ...overrides
  };
}

function createBaseDeps() {
  const registry = new Map();
  const manifest = createManifest();
  const declarationCalls = [];
  let navigationRefreshCount = 0;

  const deps = {
    fs: {
      async readdir() {
        return [];
      },
      async access() {},
      async readFile() {
        return JSON.stringify(manifest);
      }
    },
    packageManifestService: {
      validatePackageManifest(raw) {
        if (!raw || typeof raw !== 'object') throw new Error('Invalid manifest object');
        if (!raw.id || !raw.name || !raw.version || !raw.mountPath) {
          throw new Error('Invalid manifest shape');
        }
        return raw;
      }
    },
    packageRegistryService: {
      async listPackageRegistry() {
        return [...registry.values()].map((row) => ({ ...row }));
      },
      async getPackageRegistryById(packageId) {
        return registry.get(String(packageId || '').toLowerCase()) || null;
      },
      async upsertPackageRegistry(input = {}) {
        const row = {
          id: input.packageId,
          packageId: input.packageId,
          version: input.version || '',
          enabled: input.enabled === true,
          installStatus: input.installStatus || (input.enabled ? 'enabled' : 'disabled'),
          metadata: input.metadata || {},
          updatedAt: new Date().toISOString()
        };
        registry.set(row.packageId, row);
        return { ...row };
      },
      async setPackageEnabled(packageId, enabled) {
        const key = String(packageId || '').toLowerCase();
        const current = registry.get(key) || { packageId: key, id: key, version: '', metadata: {} };
        const next = {
          ...current,
          enabled: enabled === true,
          installStatus: enabled ? 'enabled' : 'disabled',
          updatedAt: new Date().toISOString()
        };
        registry.set(key, next);
        return { ...next };
      },
      async removePackageRegistry(packageId) {
        const key = String(packageId || '').toLowerCase();
        const existed = registry.has(key);
        registry.delete(key);
        return existed;
      }
    },
    packageRegistryInstallerService: {
      async installPackageRegistryDeclarations(context = {}) {
        declarationCalls.push({ type: 'install', packageId: context.packageId });
        return {
          packageId: context.packageId,
          entities: {},
          uploadFolders: {},
          results: []
        };
      },
      async removePackageRegistryDeclarations(context = {}, options = {}) {
        declarationCalls.push({ type: `remove:${options.action || 'disable'}`, packageId: context.packageId });
        return {
          packageId: context.packageId,
          entities: {},
          uploadFolders: {},
          results: []
        };
      },
      createLoaderHooks() {
        return {
          async registerRoutes() { return { requested: 0, mounted: 0, failed: 0 }; },
          async registerViews() { return { requested: 0, registered: 0, failed: 0 }; },
          async registerAssets() { return { requested: 0, mounted: 0, failed: 0 }; },
          async registerQueryExecutors() { return { requested: 0, registered: 0, failed: 0 }; }
        };
      }
    },
    packageLoaderService: {
      async resolveManifestPath(packageId) {
        return `C:/repo/packages/${packageId}/package.manifest.json`;
      },
      async readManifestFile() {
        return createManifest();
      }
    },
    packageNavigationService: {
      async refreshNavigationRegistry() {
        navigationRefreshCount += 1;
        return { packages: [...registry.values()] };
      }
    }
  };

  return {
    deps,
    registry,
    declarationCalls: () => declarationCalls,
    navigationRefreshCount: () => navigationRefreshCount
  };
}

test('listPackageSnapshot includes discovered local manifests and installed rows', async () => {
  const setup = createBaseDeps();
  setup.deps.fs.readdir = async () => [createDirent('pte')];
  setup.deps.fs.readFile = async () => JSON.stringify(createManifest({ id: 'pte', name: 'PTE' }));
  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: true,
    installStatus: 'enabled',
    metadata: {
      packageName: 'PTE',
      manifestPath: 'packages/pte/package.manifest.json',
      mountPath: '/pte'
    }
  });
  const service = createService(setup.deps);
  const snapshot = await service.listPackageSnapshot({ backendMode: 'json' });

  assert.equal(snapshot.localManifests.length, 1);
  assert.equal(snapshot.localManifests[0].packageId, 'pte');
  assert.equal(snapshot.installedPackages.length, 1);
  assert.equal(snapshot.installedPackages[0].packageId, 'pte');
  assert.equal(snapshot.installedPackages[0].enabled, true);
});

test('installPackage rejects invalid manifest JSON payload', async () => {
  const setup = createBaseDeps();
  const service = createService(setup.deps);
  await assert.rejects(
    () => service.installPackage({
      installMethod: 'json',
      manifestJson: '{ invalid json ]'
    }, { backendMode: 'json' }),
    /invalid/i
  );
});

test('pausePackage is idempotent and returns restart recommendation', async () => {
  const setup = createBaseDeps();
  const service = createService(setup.deps);
  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: true,
    installStatus: 'enabled',
    metadata: {
      packageName: 'PTE',
      manifestPath: 'packages/pte/package.manifest.json',
      mountPath: '/pte'
    }
  });

  const first = await service.pausePackage('pte', { backendMode: 'json' });
  const second = await service.pausePackage('pte', { backendMode: 'json' });

  assert.equal(first.action, 'pause');
  assert.equal(first.restartRecommended, true);
  assert.equal(first.registry.enabled, false);
  assert.equal(second.action, 'pause');
  assert.equal(second.registry.enabled, false);
  assert.equal(setup.declarationCalls().some((row) => row.type === 'remove:disable'), true);
});

test('removePackage is idempotent and refreshes navigation', async () => {
  const setup = createBaseDeps();
  const service = createService(setup.deps);
  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: false,
    installStatus: 'disabled',
    metadata: { packageName: 'PTE', manifestPath: 'packages/pte/package.manifest.json', mountPath: '/pte' }
  });

  const first = await service.removePackage('pte', { backendMode: 'json' });
  const second = await service.removePackage('pte', { backendMode: 'json' });

  assert.equal(first.action, 'remove');
  assert.equal(first.registry.removed, true);
  assert.equal(first.restartRecommended, true);
  assert.equal(second.action, 'remove');
  assert.equal(second.registry.removed, false);
  assert.equal(setup.navigationRefreshCount() >= 2, true);
});

test('syncPackage installs declarations and refreshes navigation', async () => {
  const setup = createBaseDeps();
  const service = createService(setup.deps);
  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: true,
    installStatus: 'enabled',
    metadata: { packageName: 'PTE', manifestPath: 'packages/pte/package.manifest.json', mountPath: '/pte' }
  });

  const report = await service.syncPackage('pte', { backendMode: 'json' });

  assert.equal(report.action, 'sync');
  assert.equal(report.packageId, 'pte');
  assert.equal(setup.declarationCalls().some((row) => row.type === 'install'), true);
  assert.equal(setup.navigationRefreshCount() >= 1, true);
});
