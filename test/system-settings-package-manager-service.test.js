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
        const force = options.force === true;
        return {
          dataSummary: {
            migrations: { applied: force ? 1 : 0, skipped: force ? 0 : 1, failed: 0 },
            seeders: { applied: 0, skipped: 0, failed: 0 }
          },
          appliedSteps: force ? [{ stepId: 'sample', stepType: 'migration', direction: 'down', status: 'success', artifacts: {} }] : [],
          skippedSteps: force ? [] : [{ stepId: 'sample', stepType: 'migration', direction: 'down', status: 'skipped', reason: 'safe_mode_keep_data' }],
          failedStep: null,
          rollbackApplied: force,
          dataImpact: {
            ownershipCount: 1,
            modifiedCount: force ? 0 : 1
          },
          warnings: force ? [] : ['Safe uninstall mode keeps package business data.']
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

test('removePackage defaults to safe keep-data mode when uninstall preview reports modified records', async () => {
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
  assert.equal(report.dataSummary?.migrations?.skipped >= 1, true);
});

test('removePackage force mode requires confirmation token when preview has modifications', async () => {
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
    () => service.removePackage('pte', {
      backendMode: 'json',
      force: true,
      preview: {
        blocked: true,
        blockedReasons: ['customized'],
        modifiedRecords: [{ entityType: 'sections', identityKey: 'name:PTE' }],
        previewTransactionId: 'TXN_PREVIEW'
      },
      previewTransactionId: 'TXN_PREVIEW',
      forceToken: 'WRONG TOKEN'
    }),
    /token mismatch/i
  );
});

test('previewPackageUninstallImpact falls back to registry-only mode when manifest is missing', async () => {
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

  assert.equal(report.mode, 'registry_only_remove');
  assert.equal(report.blocked, false);
  assert.equal(Array.isArray(report.warnings), true);
  assert.equal(report.warnings.some((msg) => /manifest file was not found/i.test(String(msg || ''))), true);
});

test('removePackage succeeds in registry-only mode when manifest is missing', async () => {
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

  const report = await service.removePackage('pte', { backendMode: 'json' });
  const registryAfter = await setup.deps.packageRegistryService.getPackageRegistryById('pte');

  assert.equal(report.action, 'remove');
  assert.equal(report.mode, 'registry_only_remove');
  assert.equal(report.registry.removed, true);
  assert.equal(registryAfter, null);
  assert.equal(report.warnings.some((msg) => /declaration remove sync was skipped/i.test(String(msg || ''))), true);
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
