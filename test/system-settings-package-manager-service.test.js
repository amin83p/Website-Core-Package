const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const PizZip = require('pizzip');

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

function createSignedPackageZip(manifest, extras = {}) {
  const zip = new PizZip();
  const folderName = String(extras.folderName || manifest.id);
  const prefix = `${folderName}/`;
  zip.file(`${prefix}package.manifest.json`, JSON.stringify(manifest, null, 2));
  zip.file(`${prefix}README.md`, '# package');
  if (extras.includeUnsafeEntry) {
    zip.file('../evil.txt', 'bad');
  }
  if (extras.includeSecondTopFolder) {
    zip.file('second-package/info.txt', 'other');
  }
  if (extras.omitManifest) {
    zip.remove(`${prefix}package.manifest.json`);
  }
  const zipBuffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const signatureBuffer = crypto.sign(null, zipBuffer, privateKey);
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  return {
    zipBuffer,
    signatureBuffer,
    publicKeyPem
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
      async rm() {},
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
    },
    packageDataLifecycleService: {
      async runPackageDataInstallLifecycle() {
        return {
          dataSummary: {
            migrations: { applied: 0, skipped: 0, failed: 0 },
            seeders: { applied: 0, skipped: 0, failed: 0 }
          },
          appliedSteps: [],
          skippedSteps: [],
          failedStep: null,
          rollbackApplied: false,
          warnings: []
        };
      },
      async runPackageDataUpgradeLifecycle() {
        return {
          dataSummary: {
            migrations: { applied: 0, skipped: 0, failed: 0 },
            seeders: { applied: 0, skipped: 0, failed: 0 }
          },
          appliedSteps: [],
          skippedSteps: [],
          failedStep: null,
          rollbackApplied: false,
          warnings: []
        };
      },
      async previewPackageDataUninstallImpact() {
        return {
          blocked: false,
          blockedReasons: [],
          modifiedRecords: [],
          dataImpact: {
            ownershipCount: 0,
            modifiedCount: 0
          },
          warnings: []
        };
      },
      async runPackageDataUninstallLifecycle(_context = {}, options = {}) {
        const cleanupMode = String(options.cleanupMode || '').toLowerCase() === 'keep-data' ? 'keep-data' : 'full';
        const destructive = cleanupMode === 'full';
        return {
          dataSummary: {
            migrations: { applied: destructive ? 1 : 0, skipped: destructive ? 0 : 1, failed: 0 },
            seeders: { applied: 0, skipped: 0, failed: 0 }
          },
          appliedSteps: destructive ? [{ stepId: 'sample', stepType: 'migration', direction: 'down', status: 'success', artifacts: {} }] : [],
          skippedSteps: destructive ? [] : [{ stepId: 'sample', stepType: 'migration', direction: 'down', status: 'skipped', reason: 'safe_mode_keep_data' }],
          failedStep: null,
          rollbackApplied: destructive,
          dataImpact: {
            ownershipCount: 1,
            modifiedCount: destructive ? 0 : 1
          },
          warnings: destructive ? [] : ['Keep-data uninstall mode was requested; package business data was retained.']
        };
      }
    },
    packageBuilderService: {
      async previewBuilderPayloadDeletionInventory() {
        return {
          payloadFound: true,
          orgRemapRequired: false,
          targetOrgId: '',
          tableRows: [
            { id: 'pteApplicants', entityType: 'pteApplicants', backendMode: 'json', estimatedRowCount: 2, selected: true }
          ],
          fileRows: [
            { id: 'ORG_900000/symbols/logo.png', exists: true, size: 1024, selected: true }
          ],
          warnings: []
        };
      },
      async applyBuilderPayloadIfPresent(_context = {}, options = {}) {
        return {
          applied: false,
          orgRemapRequired: false,
          targetOrgId: String(options.targetOrgId || '').replace(/^ORG_/i, ''),
          dataSummary: { entityCount: 0, upserted: 0 },
          fileSummary: { copied: 0 },
          warnings: []
        };
      },
      async removeBuilderPayloadIfPresent(_context = {}, options = {}) {
        const selectionTables = Array.isArray(options?.deleteSelection?.tables) ? options.deleteSelection.tables : ['pteApplicants'];
        const selectionFiles = Array.isArray(options?.deleteSelection?.files) ? options.deleteSelection.files : ['ORG_900000/symbols/logo.png'];
        return {
          applied: true,
          payloadFound: true,
          orgRemapRequired: false,
          targetOrgId: String(options.targetOrgId || '').replace(/^ORG_/i, ''),
          selectionApplied: {
            tablesSelected: selectionTables.length,
            filesSelected: selectionFiles.length
          },
          tableSummary: {
            total: 1,
            selected: selectionTables.length,
            deleted: selectionTables.length ? 1 : 0,
            retained: selectionTables.length ? 0 : 1,
            skipped: 0,
            failed: 0
          },
          rowSummary: { deleted: selectionTables.length ? 2 : 0, skipped: 0, failed: 0, skippedWithoutId: [] },
          fileSummary: { total: 1, selected: selectionFiles.length, deleted: selectionFiles.length ? 1 : 0, retained: selectionFiles.length ? 0 : 1, skipped: 0, failed: 0 },
          warnings: []
        };
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

async function createZipInstallDeps() {
  const setup = createBaseDeps();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-zip-install-test-'));
  const packageRootDir = path.join(tmpRoot, 'packages');
  await fs.mkdir(packageRootDir, { recursive: true });

  setup.deps.fs = fs;
  setup.deps.packageLoaderService.resolveManifestPath = async (packageId, row = {}, rootDir = '') => {
    const preferred = String(row?.metadata?.manifestPath || '').trim();
    if (preferred) {
      return path.isAbsolute(preferred) ? preferred : path.join(process.cwd(), preferred);
    }
    return path.join(rootDir || packageRootDir, packageId, 'package.manifest.json');
  };
  setup.cleanup = async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  };
  setup.packageRootDir = packageRootDir;
  setup.tmpRoot = tmpRoot;
  return setup;
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

test('enablePackage recovers from stale registry manifest path by local package-id discovery', async () => {
  const setup = createBaseDeps();
  setup.deps.fs.readdir = async () => [createDirent('pte')];
  setup.deps.fs.readFile = async () => JSON.stringify(createManifest({ id: 'pte', name: 'PTE', version: '1.0.1' }));
  setup.deps.packageLoaderService.resolveManifestPath = async () => '';
  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: false,
    installStatus: 'disabled',
    metadata: {
      packageName: 'PTE',
      manifestPath: 'packages/missing/package.manifest.json',
      mountPath: '/pte'
    }
  });
  const service = createService(setup.deps);
  const report = await service.enablePackage('pte', { backendMode: 'json' });

  assert.equal(report.action, 'enable');
  assert.equal(report.packageId, 'pte');
  assert.equal(report.registry.enabled, true);
  assert.equal(report.registry.manifestPath.includes('/pte/package.manifest.json') || report.registry.manifestPath.includes('\\pte\\package.manifest.json'), true);
});

test('enablePackage clears stale warning/error fields in registry payload', async () => {
  const setup = createBaseDeps();
  setup.deps.fs.readdir = async () => [createDirent('pte')];
  setup.deps.fs.readFile = async () => JSON.stringify(createManifest({ id: 'pte', name: 'PTE', version: '1.0.1' }));
  setup.deps.packageLoaderService.resolveManifestPath = async () => '';

  const originalUpsert = setup.deps.packageRegistryService.upsertPackageRegistry;
  const upsertCalls = [];
  setup.deps.packageRegistryService.upsertPackageRegistry = async (input = {}) => {
    upsertCalls.push({ ...input });
    return originalUpsert(input);
  };

  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: false,
    installStatus: 'failed',
    lastWarning: 'Auto-disabled at startup: No manifest file found for this enabled package.',
    lastError: 'Manifest missing',
    metadata: {
      packageName: 'PTE',
      manifestPath: 'packages/missing/package.manifest.json',
      mountPath: '/pte'
    }
  });

  const service = createService(setup.deps);
  const report = await service.enablePackage('pte', { backendMode: 'json' });

  const enableUpsert = upsertCalls[upsertCalls.length - 1] || {};
  assert.equal(report.registry.enabled, true);
  assert.equal(enableUpsert.packageId, 'pte');
  assert.equal(enableUpsert.lastWarning, '');
  assert.equal(enableUpsert.lastError, '');
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

test('installPackage returns data lifecycle summary fields', async () => {
  const setup = createBaseDeps();
  const service = createService(setup.deps);
  setup.deps.fs.readFile = async () => JSON.stringify(createManifest({ id: 'pte', name: 'PTE', version: '1.0.1' }));
  const report = await service.installPackage({
    installMethod: 'path',
    manifestPath: 'packages/pte/package.manifest.json'
  }, { backendMode: 'json' });

  assert.equal(report.action, 'install');
  assert.equal(typeof report.dataSummary, 'object');
  assert.equal(Array.isArray(report.appliedSteps), true);
  assert.equal(Array.isArray(report.skippedSteps), true);
});

test('installPackage succeeds with runtime USE declarations when routes mount is healthy', async () => {
  const setup = createBaseDeps();
  setup.deps.packageRegistryInstallerService.createLoaderHooks = () => ({
    async registerRoutes(context = {}) {
      const hasExpressAppContext = Boolean(context?.app && typeof context.app.use === 'function');
      return {
        requested: 1,
        prepared: 1,
        mounted: hasExpressAppContext ? 1 : 0,
        failed: 0,
        results: []
      };
    },
    async registerViews() { return { requested: 0, registered: 0, failed: 0 }; },
    async registerAssets() { return { requested: 0, mounted: 0, failed: 0 }; },
    async registerQueryExecutors() { return { requested: 0, registered: 0, failed: 0 }; }
  });
  const service = createService(setup.deps);
  const report = await service.installPackage({
    installMethod: 'json',
    manifestJson: JSON.stringify(createManifest({
      id: 'pte-runtime-ok',
      version: '1.0.0',
      mountPath: '/pte',
      routes: [createUseRouteDeclaration()]
    }))
  }, {
    backendMode: 'json',
    app: { use() {} }
  });

  assert.equal(report.action, 'install');
  assert.equal(report.packageId, 'pte-runtime-ok');
  assert.equal(report.runtime?.hooks?.routes?.mounted, 1);
});

test('installPackage accepts runtime route already-mounted skip as healthy', async () => {
  const setup = createBaseDeps();
  setup.deps.packageRegistryInstallerService.createLoaderHooks = () => ({
    async registerRoutes() {
      return {
        requested: 1,
        prepared: 1,
        mounted: 0,
        failed: 0,
        results: [
          {
            id: 'route-1',
            method: 'USE',
            path: '/pte',
            router: 'MVC/routes/pteMainRoute.js',
            metadataOnly: false,
            status: 'skipped',
            message: 'Route already mounted in this process.'
          }
        ]
      };
    },
    async registerViews() { return { requested: 0, registered: 0, failed: 0 }; },
    async registerAssets() { return { requested: 0, mounted: 0, failed: 0 }; },
    async registerQueryExecutors() { return { requested: 0, registered: 0, failed: 0 }; }
  });
  const service = createService(setup.deps);
  const report = await service.installPackage({
    installMethod: 'json',
    manifestJson: JSON.stringify(createManifest({
      id: 'pte-runtime-already-mounted',
      version: '1.0.0',
      mountPath: '/pte',
      routes: [createUseRouteDeclaration()]
    }))
  }, {
    backendMode: 'json',
    app: { use() {} }
  });

  assert.equal(report.action, 'install');
  assert.equal(report.packageId, 'pte-runtime-already-mounted');
  assert.equal(report.runtime?.hooks?.routes?.failed, 0);
});

test('installPackage prefers package runtime router for routes/assets when available', async () => {
  const setup = createBaseDeps();
  let routeAppRef = null;
  let viewAppRef = null;
  let assetAppRef = null;
  setup.deps.packageRegistryInstallerService.createLoaderHooks = () => ({
    async registerRoutes(context = {}) {
      routeAppRef = context?.app || null;
      return { requested: 1, prepared: 1, mounted: 1, failed: 0, results: [] };
    },
    async registerViews(context = {}) {
      viewAppRef = context?.app || null;
      return { requested: 0, registered: 0, failed: 0 };
    },
    async registerAssets(context = {}) {
      assetAppRef = context?.app || null;
      return { requested: 0, mounted: 0, failed: 0 };
    },
    async registerQueryExecutors() { return { requested: 0, registered: 0, failed: 0 }; }
  });
  const service = createService(setup.deps);
  const runtimeRouter = { use() {} };
  const app = { use() {}, get() {}, set() {}, locals: { packageRuntimeRouter: runtimeRouter } };

  const report = await service.installPackage({
    installMethod: 'json',
    manifestJson: JSON.stringify(createManifest({
      id: 'pte-runtime-container',
      version: '1.0.0',
      mountPath: '/pte',
      routes: [createUseRouteDeclaration()]
    }))
  }, {
    backendMode: 'json',
    app
  });

  assert.equal(routeAppRef, runtimeRouter);
  assert.equal(assetAppRef, runtimeRouter);
  assert.equal(viewAppRef, app);
  assert.equal(report.runtime?.mountTarget?.routes, 'packageRuntimeRouter');
  assert.equal(report.runtime?.mountTarget?.assets, 'packageRuntimeRouter');
  assert.equal(report.runtime?.mountTarget?.views, 'app');
});

test('installPackage fails and rolls back when runtime route mount health is not satisfied', async () => {
  const setup = createBaseDeps();
  setup.deps.packageRegistryInstallerService.createLoaderHooks = () => ({
    async registerRoutes() { return { requested: 1, prepared: 1, mounted: 0, failed: 1, results: [{ ok: false }] }; },
    async registerViews() { return { requested: 0, registered: 0, failed: 0 }; },
    async registerAssets() { return { requested: 0, mounted: 0, failed: 0 }; },
    async registerQueryExecutors() { return { requested: 0, registered: 0, failed: 0 }; }
  });
  const service = createService(setup.deps);

  await assert.rejects(
    () => service.installPackage({
      installMethod: 'json',
      manifestJson: JSON.stringify(createManifest({
        id: 'pte-runtime-fail',
        version: '1.0.0',
        mountPath: '/pte',
        routes: [createUseRouteDeclaration()]
      }))
    }, {
      backendMode: 'json',
      app: { use() {} }
    }),
    (error) => {
      assert.equal(error?.code, 'PACKAGE_RUNTIME_ROUTE_MOUNT_FAILED');
      assert.equal(Number(error?.details?.runtimeRoutes?.failed || 0) > 0, true);
      return true;
    }
  );

  const registryAfter = await setup.deps.packageRegistryService.getPackageRegistryById('pte-runtime-fail');
  assert.equal(registryAfter, null);
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

test('removePackage purges package folders from configured and default roots', async () => {
  const setup = createBaseDeps();
  const removedPaths = [];
  setup.deps.fs = {
    ...setup.deps.fs,
    async access() {},
    async rm(targetPath) {
      removedPaths.push(String(targetPath || ''));
    }
  };
  const service = createService(setup.deps);
  const customRoot = path.join(os.tmpdir(), `pkg-remove-root-${Date.now()}`);
  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: true,
    installStatus: 'enabled',
    metadata: { packageName: 'PTE', manifestPath: 'packages/pte/package.manifest.json', mountPath: '/pte' }
  });

  const report = await service.removePackage('pte', { backendMode: 'json', packageRootDir: customRoot });

  assert.equal(report.action, 'remove');
  assert.equal(Array.isArray(report.filePurgeSummary?.attemptedRoots), true);
  assert.equal(report.filePurgeSummary.attemptedRoots.some((root) => path.resolve(root) === path.resolve(customRoot)), true);
  assert.equal(report.filePurgeSummary.deletedPaths.some((targetPath) => path.resolve(targetPath) === path.resolve(path.join(customRoot, 'pte'))), true);
  assert.equal(report.filePurgeSummary.deletedPaths.some((targetPath) => path.resolve(targetPath) === path.resolve(path.join(process.cwd(), 'packages', 'pte'))), true);
  assert.equal(removedPaths.some((targetPath) => path.resolve(targetPath) === path.resolve(path.join(customRoot, 'pte'))), true);
});

test('removePackage keeps success and reports warning when package folder purge fails', async () => {
  const setup = createBaseDeps();
  const failRoot = path.join(os.tmpdir(), `pkg-remove-fail-${Date.now()}`);
  setup.deps.fs = {
    ...setup.deps.fs,
    async access() {},
    async rm(targetPath) {
      if (String(targetPath || '').toLowerCase().includes(path.resolve(failRoot).toLowerCase())) {
        throw new Error('simulated delete failure');
      }
    }
  };
  const service = createService(setup.deps);
  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: true,
    installStatus: 'enabled',
    metadata: { packageName: 'PTE', manifestPath: 'packages/pte/package.manifest.json', mountPath: '/pte' }
  });

  const report = await service.removePackage('pte', { backendMode: 'json', packageRootDir: failRoot });

  assert.equal(report.action, 'remove');
  assert.equal(Array.isArray(report.filePurgeSummary?.failedPaths), true);
  assert.equal(report.filePurgeSummary.failedPaths.length >= 1, true);
  assert.equal(report.warnings.some((msg) => /failed to delete package folder/i.test(String(msg || ''))), true);
  assert.equal(report.registry.removed, true);
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

test('enablePackage auto-disables package when runtime route mount health fails', async () => {
  const setup = createBaseDeps();
  setup.deps.packageLoaderService.readManifestFile = async () => createManifest({
    id: 'pte',
    version: '1.0.0',
    mountPath: '/pte',
    routes: [createUseRouteDeclaration()]
  });
  setup.deps.packageRegistryInstallerService.createLoaderHooks = () => ({
    async registerRoutes() { return { requested: 1, prepared: 1, mounted: 0, failed: 1, results: [] }; },
    async registerViews() { return { requested: 0, registered: 0, failed: 0 }; },
    async registerAssets() { return { requested: 0, mounted: 0, failed: 0 }; },
    async registerQueryExecutors() { return { requested: 0, registered: 0, failed: 0 }; }
  });
  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: false,
    installStatus: 'disabled',
    metadata: { packageName: 'PTE', manifestPath: 'packages/pte/package.manifest.json', mountPath: '/pte' }
  });
  const service = createService(setup.deps);

  await assert.rejects(
    () => service.enablePackage('pte', { backendMode: 'json', app: { use() {} } }),
    /PACKAGE_RUNTIME_ROUTE_MOUNT_FAILED|Runtime route mount/i
  );

  const registryAfter = await setup.deps.packageRegistryService.getPackageRegistryById('pte');
  assert.equal(registryAfter?.enabled, false);
});

test('syncPackage auto-disables package when runtime route mount health fails', async () => {
  const setup = createBaseDeps();
  setup.deps.packageLoaderService.readManifestFile = async () => createManifest({
    id: 'pte',
    version: '1.0.0',
    mountPath: '/pte',
    routes: [createUseRouteDeclaration()]
  });
  setup.deps.packageRegistryInstallerService.createLoaderHooks = () => ({
    async registerRoutes() { return { requested: 1, prepared: 1, mounted: 0, failed: 1, results: [] }; },
    async registerViews() { return { requested: 0, registered: 0, failed: 0 }; },
    async registerAssets() { return { requested: 0, mounted: 0, failed: 0 }; },
    async registerQueryExecutors() { return { requested: 0, registered: 0, failed: 0 }; }
  });
  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: true,
    installStatus: 'enabled',
    metadata: { packageName: 'PTE', manifestPath: 'packages/pte/package.manifest.json', mountPath: '/pte' }
  });
  const service = createService(setup.deps);

  await assert.rejects(
    () => service.syncPackage('pte', { backendMode: 'json', app: { use() {} } }),
    /PACKAGE_RUNTIME_ROUTE_MOUNT_FAILED|Runtime route mount/i
  );

  const registryAfter = await setup.deps.packageRegistryService.getPackageRegistryById('pte');
  assert.equal(registryAfter?.enabled, false);
});

test('removePackage defaults to full cleanup when uninstall preview reports modified records', async () => {
  const setup = createBaseDeps();
  const service = createService(setup.deps);
  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: true,
    installStatus: 'enabled',
    metadata: { packageName: 'PTE', manifestPath: 'packages/pte/package.manifest.json', mountPath: '/pte' }
  });

  const report = await service.removePackage('pte', {
    backendMode: 'json',
    preview: {
      blocked: true,
      blockedReasons: ['customized'],
      modifiedRecords: [{ entityType: 'sections', identityKey: 'name:PTE' }],
      previewTransactionId: 'TXN_PREVIEW'
    }
  });

  assert.equal(report.action, 'remove');
  assert.equal(report.registry.removed, true);
  assert.equal(report.dataSummary?.migrations?.applied >= 1, true);
  assert.equal(report.cleanupMode, 'full');
});

test('removePackage keeps legacy keep-data mode when explicitly requested', async () => {
  const setup = createBaseDeps();
  const service = createService(setup.deps);
  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: true,
    installStatus: 'enabled',
    metadata: { packageName: 'PTE', manifestPath: 'packages/pte/package.manifest.json', mountPath: '/pte' }
  });

  const report = await service.removePackage('pte', {
    backendMode: 'json',
    cleanupMode: 'keep-data',
    preview: {
      blocked: true,
      blockedReasons: ['customized'],
      modifiedRecords: [{ entityType: 'sections', identityKey: 'name:PTE' }],
      previewTransactionId: 'TXN_PREVIEW'
    }
  });
  assert.equal(report.cleanupMode, 'keep-data');
  assert.equal(report.dataSummary?.migrations?.skipped >= 1, true);
});

test('previewPackageUninstallImpact returns deletion inventory groups', async () => {
  const setup = createBaseDeps();
  const service = createService(setup.deps);
  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: true,
    installStatus: 'enabled',
    metadata: { packageName: 'PTE', manifestPath: 'packages/pte/package.manifest.json', mountPath: '/pte' }
  });

  const report = await service.previewPackageUninstallImpact('pte', { backendMode: 'json' });
  assert.equal(Array.isArray(report?.deletionInventory?.critical), true);
  assert.equal(Array.isArray(report?.deletionInventory?.tables), true);
  assert.equal(Array.isArray(report?.deletionInventory?.files), true);
  assert.equal(report?.deletionInventory?.tables?.[0]?.id, 'pteApplicants');
  assert.equal(report?.deletionInventory?.files?.[0]?.id, 'ORG_900000/symbols/logo.png');
});

test('removePackage forwards validated deleteSelection and returns inventory summary', async () => {
  const setup = createBaseDeps();
  const service = createService(setup.deps);
  let capturedDeleteSelection = null;
  setup.deps.packageBuilderService.removeBuilderPayloadIfPresent = async (_context = {}, options = {}) => {
    capturedDeleteSelection = options?.deleteSelection || null;
    return {
      applied: true,
      payloadFound: true,
      orgRemapRequired: false,
      targetOrgId: '',
      selectionApplied: { tablesSelected: 0, filesSelected: 1 },
      tableSummary: { total: 1, selected: 0, deleted: 0, retained: 1, skipped: 0, failed: 0 },
      rowSummary: { deleted: 0, skipped: 0, failed: 0, skippedWithoutId: [] },
      fileSummary: { total: 1, selected: 1, deleted: 1, retained: 0, skipped: 0, failed: 0 },
      warnings: []
    };
  };
  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: true,
    installStatus: 'enabled',
    metadata: { packageName: 'PTE', manifestPath: 'packages/pte/package.manifest.json', mountPath: '/pte' }
  });

  const report = await service.removePackage('pte', {
    backendMode: 'json',
    deleteSelection: {
      tables: [],
      files: ['ORG_900000/symbols/logo.png']
    }
  });

  assert.deepEqual(capturedDeleteSelection, {
    provided: true,
    tables: [],
    files: ['ORG_900000/symbols/logo.png']
  });
  assert.equal(report?.inventorySummary?.tables?.selected, 0);
  assert.equal(report?.inventorySummary?.tables?.retained, 1);
  assert.equal(report?.inventorySummary?.files?.selected, 1);
  assert.equal(report?.inventorySummary?.files?.deleted, 1);
});

test('previewPackageUninstallImpact blocks full cleanup when manifest is missing', async () => {
  const setup = createBaseDeps();
  const service = createService(setup.deps);
  setup.deps.packageLoaderService.resolveManifestPath = async () => '';
  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: true,
    installStatus: 'enabled',
    metadata: { packageName: 'PTE', manifestPath: 'packages/pte/package.manifest.json', mountPath: '/pte' }
  });

  const report = await service.previewPackageUninstallImpact('pte', { backendMode: 'json' });

  assert.equal(report.mode, 'blocked_missing_manifest');
  assert.equal(report.blocked, true);
  assert.equal(Array.isArray(report.warnings), true);
  assert.equal(report.blockedReasons.some((msg) => /manifest file was not found|full cleanup remove is blocked/i.test(String(msg || ''))), true);
});

test('removePackage blocks full cleanup when manifest is missing and leaves registry unchanged', async () => {
  const setup = createBaseDeps();
  const service = createService(setup.deps);
  setup.deps.packageLoaderService.resolveManifestPath = async () => '';
  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: true,
    installStatus: 'enabled',
    metadata: { packageName: 'PTE', manifestPath: 'packages/pte/package.manifest.json', mountPath: '/pte' }
  });

  await assert.rejects(
    () => service.removePackage('pte', { backendMode: 'json' }),
    /PACKAGE_REMOVE_MANIFEST_REQUIRED|full cleanup remove is blocked/i
  );
  const registryAfter = await setup.deps.packageRegistryService.getPackageRegistryById('pte');

  assert.equal(registryAfter?.enabled, true);
});

test('installPackage allows same-version reinstall only for missing-files recovery', async () => {
  const setup = createBaseDeps();
  const service = createService(setup.deps);
  setup.deps.packageLoaderService.resolveManifestPath = async () => '';
  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: false,
    installStatus: 'disabled',
    metadata: { packageName: 'PTE', manifestPath: 'packages/pte/package.manifest.json', mountPath: '/pte' }
  });

  const report = await service.installPackage({
    installMethod: 'json',
    manifestJson: JSON.stringify(createManifest({ id: 'pte', version: '1.0.0', mountPath: '/pte' }))
  }, { backendMode: 'json' });

  assert.equal(report.mode, 'reinstall_recovery');
  assert.equal(report.packageId, 'pte');
  assert.equal(report.registry.enabled, true);
});

test('installPackage rejects same-version reinstall when manifest is available', async () => {
  const setup = createBaseDeps();
  const service = createService(setup.deps);
  await setup.deps.packageRegistryService.upsertPackageRegistry({
    packageId: 'pte',
    version: '1.0.0',
    enabled: true,
    installStatus: 'enabled',
    metadata: { packageName: 'PTE', manifestPath: 'packages/pte/package.manifest.json', mountPath: '/pte' }
  });

  await assert.rejects(
    () => service.installPackage({
      installMethod: 'json',
      manifestJson: JSON.stringify(createManifest({ id: 'pte', version: '1.0.0', mountPath: '/pte' }))
    }, { backendMode: 'json' }),
    /must be newer/i
  );
});

test('installPackage requires target org when builder payload marks remap as required', async () => {
  const setup = createBaseDeps();
  const service = createService({
    ...setup.deps,
    packageBuilderService: {
      async applyBuilderPayloadIfPresent(_context = {}, options = {}) {
        if (!String(options?.targetOrgId || '').trim()) {
          const error = new Error('Target organization is required for this package install because exported data contains org-bound fields/URLs.');
          error.code = 'TARGET_ORG_REQUIRED';
          throw error;
        }
        return {
          applied: false,
          orgRemapRequired: true,
          targetOrgId: String(options.targetOrgId || '').replace(/^ORG_/i, ''),
          dataSummary: { entityCount: 0, upserted: 0 },
          fileSummary: { copied: 0 },
          warnings: []
        };
      }
    }
  });

  await assert.rejects(
    () => service.installPackage({
      installMethod: 'json',
      manifestJson: JSON.stringify(createManifest({ id: 'pte', version: '1.0.0', mountPath: '/pte' }))
    }, { backendMode: 'json' }),
    /Target organization is required/i
  );

  const report = await service.installPackage({
    installMethod: 'json',
    manifestJson: JSON.stringify(createManifest({ id: 'pte', version: '1.0.0', mountPath: '/pte' }))
  }, {
    backendMode: 'json',
    targetOrgId: 'ORG_900000'
  });
  assert.equal(report.packageId, 'pte');
  assert.equal(report.payloadSummary.orgRemapRequired, true);
  assert.equal(report.payloadSummary.targetOrgId, '900000');
});

test('installPackageZip verifies signature and installs package into packages directory', async () => {
  const setup = await createZipInstallDeps();
  const manifest = createManifest({ id: 'zip-addon', name: 'ZIP Addon', version: '1.0.0', mountPath: '/zip-addon' });
  const fixture = createSignedPackageZip(manifest);
  const service = createService(setup.deps);

  try {
    const report = await service.installPackageZip({
      zipBuffer: fixture.zipBuffer,
      signatureBuffer: fixture.signatureBuffer
    }, {
      backendMode: 'json',
      packageRootDir: setup.packageRootDir,
      trustedPublicKeys: [fixture.publicKeyPem]
    });

    assert.equal(report.action, 'install-zip');
    assert.equal(report.installMethod, 'zip');
    assert.equal(report.source, 'manual-zip');
    assert.equal(report.signature?.verified, true);
    assert.equal(report.registry.enabled, true);
    assert.equal(report.registry.installStatus, 'enabled');
    assert.equal(report.packageId, 'zip-addon');
    assert.equal(report.extractedPath.includes('packages/zip-addon'), true);

    const savedManifest = JSON.parse(
      await fs.readFile(path.join(setup.packageRootDir, 'zip-addon', 'package.manifest.json'), 'utf8')
    );
    assert.equal(savedManifest.id, 'zip-addon');
    assert.equal(savedManifest.version, '1.0.0');
  } finally {
    await setup.cleanup();
  }
});

test('installPackageZip rejects invalid signature', async () => {
  const setup = await createZipInstallDeps();
  const manifest = createManifest({ id: 'zip-addon-bad-sig', version: '1.0.0', mountPath: '/zip-addon-bad-sig' });
  const fixture = createSignedPackageZip(manifest);
  const service = createService(setup.deps);

  try {
    const wrongSignature = Buffer.from(fixture.signatureBuffer);
    wrongSignature[0] = wrongSignature[0] ^ 0xff;
    await assert.rejects(
      () => service.installPackageZip({
        zipBuffer: fixture.zipBuffer,
        signatureBuffer: wrongSignature
      }, {
        backendMode: 'json',
        packageRootDir: setup.packageRootDir,
        trustedPublicKeys: [fixture.publicKeyPem]
      }),
      /verification failed/i
    );
  } finally {
    await setup.cleanup();
  }
});

test('installPackageZip blocks same or older package versions', async () => {
  const setup = await createZipInstallDeps();
  const manifest = createManifest({ id: 'zip-addon-upgrade', version: '1.0.0', mountPath: '/zip-addon-upgrade' });
  const fixture = createSignedPackageZip(manifest);
  const service = createService(setup.deps);

  try {
    await service.installPackageZip({
      zipBuffer: fixture.zipBuffer,
      signatureBuffer: fixture.signatureBuffer
    }, {
      backendMode: 'json',
      packageRootDir: setup.packageRootDir,
      trustedPublicKeys: [fixture.publicKeyPem]
    });

    const sameVersionFixture = createSignedPackageZip(manifest);
    await assert.rejects(
      () => service.installPackageZip({
        zipBuffer: sameVersionFixture.zipBuffer,
        signatureBuffer: sameVersionFixture.signatureBuffer
      }, {
        backendMode: 'json',
        packageRootDir: setup.packageRootDir,
        trustedPublicKeys: [sameVersionFixture.publicKeyPem]
      }),
      /must be newer/i
    );
  } finally {
    await setup.cleanup();
  }
});

test('installPackageZip allows same-version reinstall only when package files are missing', async () => {
  const setup = await createZipInstallDeps();
  const manifest = createManifest({ id: 'zip-addon-recovery', version: '1.0.0', mountPath: '/zip-addon-recovery' });
  const fixture = createSignedPackageZip(manifest);
  const service = createService(setup.deps);

  try {
    await service.installPackageZip({
      zipBuffer: fixture.zipBuffer,
      signatureBuffer: fixture.signatureBuffer
    }, {
      backendMode: 'json',
      packageRootDir: setup.packageRootDir,
      trustedPublicKeys: [fixture.publicKeyPem]
    });

    await fs.rm(path.join(setup.packageRootDir, 'zip-addon-recovery'), { recursive: true, force: true });
    setup.deps.packageLoaderService.resolveManifestPath = async () => '';

    const sameVersionFixture = createSignedPackageZip(manifest);
    const report = await service.installPackageZip({
      zipBuffer: sameVersionFixture.zipBuffer,
      signatureBuffer: sameVersionFixture.signatureBuffer
    }, {
      backendMode: 'json',
      packageRootDir: setup.packageRootDir,
      trustedPublicKeys: [sameVersionFixture.publicKeyPem]
    });

    assert.equal(report.mode, 'reinstall_recovery');
    assert.equal(report.packageId, 'zip-addon-recovery');
    assert.equal(report.registry.enabled, true);
  } finally {
    await setup.cleanup();
  }
});

test('installPackageZip rejects invalid archive layout and folder-manifest mismatch', async () => {
  const setup = await createZipInstallDeps();
  const manifest = createManifest({ id: 'zip-addon-layout', version: '1.0.0', mountPath: '/zip-addon-layout' });
  const service = createService(setup.deps);

  try {
    const twoTopLevel = createSignedPackageZip(manifest, { includeSecondTopFolder: true });
    await assert.rejects(
      () => service.installPackageZip({
        zipBuffer: twoTopLevel.zipBuffer,
        signatureBuffer: twoTopLevel.signatureBuffer
      }, {
        backendMode: 'json',
        packageRootDir: setup.packageRootDir,
        trustedPublicKeys: [twoTopLevel.publicKeyPem]
      }),
      /exactly one top-level/i
    );

    const mismatch = createSignedPackageZip(manifest, { folderName: 'different-folder' });
    await assert.rejects(
      () => service.installPackageZip({
        zipBuffer: mismatch.zipBuffer,
        signatureBuffer: mismatch.signatureBuffer
      }, {
        backendMode: 'json',
        packageRootDir: setup.packageRootDir,
        trustedPublicKeys: [mismatch.publicKeyPem]
      }),
      /folder identity mismatch/i
    );
  } finally {
    await setup.cleanup();
  }
});

test('installPackageZip rejects unsafe ZIP entry traversal payloads', async () => {
  const setup = await createZipInstallDeps();
  const manifest = createManifest({ id: 'zip-addon-safe', version: '1.0.0', mountPath: '/zip-addon-safe' });
  const service = createService(setup.deps);

  try {
    const unsafe = createSignedPackageZip(manifest, { includeUnsafeEntry: true });
    await assert.rejects(
      () => service.installPackageZip({
        zipBuffer: unsafe.zipBuffer,
        signatureBuffer: unsafe.signatureBuffer
      }, {
        backendMode: 'json',
        packageRootDir: setup.packageRootDir,
        trustedPublicKeys: [unsafe.publicKeyPem]
      }),
      /unsafe path token/i
    );
  } finally {
    await setup.cleanup();
  }
});
