const fs = require('fs');
const path = require('path');
const os = require('os');
const ejs = require('ejs');
const test = require('node:test');
const assert = require('node:assert/strict');

const systemSettingsController = require('../MVC/controllers/systemSettingsController');
const systemSettingsRepository = require('../MVC/repositories/systemSettingsRepository');
const dataBackendRuntimeService = require('../MVC/services/dataBackendRuntimeService');
const systemSettingsPackageManagerService = require('../MVC/services/systemSettingsPackageManagerService');
const localPackageSyncService = require('../MVC/services/localPackageSyncService');

function makeRenderResponse() {
  return {
    rendered: null,
    jsonPayload: null,
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    render(view, payload) {
      this.rendered = { view, payload };
      return this;
    },
    json(payload) {
      this.jsonPayload = payload;
      return this;
    }
  };
}

test('package manager page controller renders snapshot and action state', async () => {
  const originalGetSettings = systemSettingsRepository.getSettings;
  const originalRuntimeStatus = dataBackendRuntimeService.getPublicBackendStatus;
  const originalListSnapshot = systemSettingsPackageManagerService.listPackageSnapshot;
  const originalPackageStorageRoot = process.env.PACKAGE_STORAGE_ROOT;
  const res = makeRenderResponse();

  systemSettingsRepository.getSettings = async () => ({ app: {} });
  dataBackendRuntimeService.getPublicBackendStatus = () => ({ mode: 'json', mongo: { ready: false } });
  systemSettingsPackageManagerService.listPackageSnapshot = async () => ({
    localManifests: [
      { packageId: 'pte', version: '1.0.0', storedManifestPath: 'packages/pte/package.manifest.json', valid: true },
      { packageId: 'broken', storedManifestPath: 'packages/broken/package.manifest.json', valid: false, error: 'Invalid manifest' }
    ],
    installedPackages: [
      { packageId: 'pte', version: '1.0.0', enabled: true, installStatus: 'enabled', manifestPath: 'packages/pte/package.manifest.json' }
    ]
  });

  try {
    process.env.PACKAGE_STORAGE_ROOT = path.join(os.tmpdir(), 'railway-packages');
    await systemSettingsController.showPackageManagerPage(
      {
        user: { id: 'USER_1' },
        actionStateId: 'STATE_801',
        app: {
          locals: {
            packageLoadSummary: {
              failed: [{ packageId: 'pte', message: 'No manifest file found for this enabled package.' }]
            }
          }
        }
      },
      res
    );

    assert.equal(res.rendered?.view, 'systemSettings/packageManagerSettings');
    assert.equal(res.rendered?.payload?.title, 'Package Manager');
    assert.equal(res.rendered?.payload?.actionStateId, 'STATE_801');
    assert.equal(Array.isArray(res.rendered?.payload?.installedPackages), true);
    assert.equal(Array.isArray(res.rendered?.payload?.localManifestOptions), true);
    assert.equal(Array.isArray(res.rendered?.payload?.localManifestWarnings), true);
    assert.equal(res.rendered?.payload?.localManifestOptions.length, 1);
    assert.equal(typeof res.rendered?.payload?.zipTrustedKeysConfigured, 'boolean');
    assert.match(String(res.rendered?.payload?.packageStorageRoot || ''), /railway-packages/i);
    assert.equal(typeof res.rendered?.payload?.packageStorageRootSource, 'string');
    assert.equal(Array.isArray(res.rendered?.payload?.packageStorageRootWarnings), true);
    assert.equal(Array.isArray(res.rendered?.payload?.startupPackageWarnings), true);
    assert.equal(res.rendered?.payload?.startupPackageWarnings.length, 1);
    assert.match(String(res.rendered?.payload?.startupPackageWarnings?.[0] || ''), /^\[pte\]\s+/i);
  } finally {
    if (originalPackageStorageRoot === undefined) delete process.env.PACKAGE_STORAGE_ROOT;
    else process.env.PACKAGE_STORAGE_ROOT = originalPackageStorageRoot;
    systemSettingsRepository.getSettings = originalGetSettings;
    dataBackendRuntimeService.getPublicBackendStatus = originalRuntimeStatus;
    systemSettingsPackageManagerService.listPackageSnapshot = originalListSnapshot;
  }
});

test('local package sync page controller renders defaults and cache details', async () => {
  const originalGetSettings = systemSettingsRepository.getSettings;
  const originalRuntimeStatus = dataBackendRuntimeService.getPublicBackendStatus;
  const originalResolveLocalMode = localPackageSyncService.resolveLocalPackageMode;
  const originalResolvePaths = localPackageSyncService.resolveLocalSyncPaths;
  const originalReadCache = localPackageSyncService.readLocalPackageRegistryCache;
  const res = makeRenderResponse();

  systemSettingsRepository.getSettings = async () => ({ app: {} });
  dataBackendRuntimeService.getPublicBackendStatus = () => ({ mode: 'mongo', mongo: { ready: true } });
  localPackageSyncService.resolveLocalPackageMode = () => ({
    requested: true,
    enabled: true,
    production: false,
    productionLocked: false,
    localOnlyVarsPresent: true,
    localEnvKeys: ['PACKAGE_LOCAL_DEV_MODE']
  });
  localPackageSyncService.resolveLocalSyncPaths = () => ({
    targetRoot: 'C:/repo/packages'
  });
  localPackageSyncService.readLocalPackageRegistryCache = async () => ({
    filePath: 'C:/repo/data/localPackageRegistry.json',
    generatedAt: '2026-05-28T12:00:00.000Z',
    packages: []
  });

  try {
    await systemSettingsController.showPackageLocalSyncPage(
      {
        user: { id: 'USER_1' },
        actionStateId: 'STATE_LOCAL_SYNC_1'
      },
      res
    );

    assert.equal(res.rendered?.view, 'systemSettings/packageLocalSyncSettings');
    assert.equal(res.rendered?.payload?.title, 'Package Sync Locally');
    assert.equal(res.rendered?.payload?.localPackageDevModeEnabled, true);
    assert.equal(res.rendered?.payload?.targetRootDefault, 'C:/repo/packages');
    assert.equal(res.rendered?.payload?.localRegistryFilePath, 'C:/repo/data/localPackageRegistry.json');
    assert.equal(res.rendered?.payload?.actionStateId, 'STATE_LOCAL_SYNC_1');
  } finally {
    systemSettingsRepository.getSettings = originalGetSettings;
    dataBackendRuntimeService.getPublicBackendStatus = originalRuntimeStatus;
    localPackageSyncService.resolveLocalPackageMode = originalResolveLocalMode;
    localPackageSyncService.resolveLocalSyncPaths = originalResolvePaths;
    localPackageSyncService.readLocalPackageRegistryCache = originalReadCache;
  }
});

test('local package sync scan controller rejects when local mode is disabled', async () => {
  const originalResolveLocalMode = localPackageSyncService.resolveLocalPackageMode;
  const res = makeRenderResponse();

  try {
    localPackageSyncService.resolveLocalPackageMode = () => ({
      requested: false,
      enabled: false,
      production: false,
      productionLocked: false,
      localOnlyVarsPresent: false,
      localEnvKeys: []
    });
    await systemSettingsController.scanLocalPackagesFromManager(
      { body: {} },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonPayload?.status, 'error');
    assert.equal(res.jsonPayload?.code, 'LOCAL_PACKAGE_DEV_MODE_DISABLED');
  } finally {
    localPackageSyncService.resolveLocalPackageMode = originalResolveLocalMode;
  }
});

test('local package sync scan controller rejects in production even when local mode requested', async () => {
  const originalResolveLocalMode = localPackageSyncService.resolveLocalPackageMode;
  const res = makeRenderResponse();

  try {
    localPackageSyncService.resolveLocalPackageMode = () => ({
      requested: true,
      enabled: false,
      production: true,
      productionLocked: true,
      localOnlyVarsPresent: true,
      localEnvKeys: ['PACKAGE_LOCAL_DEV_MODE']
    });
    await systemSettingsController.scanLocalPackagesFromManager(
      { body: {} },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonPayload?.status, 'error');
    assert.equal(res.jsonPayload?.code, 'LOCAL_PACKAGE_SYNC_PRODUCTION_DISABLED');
  } finally {
    localPackageSyncService.resolveLocalPackageMode = originalResolveLocalMode;
  }
});

test('local package sync controller returns warning status on partial sync', async () => {
  const originalResolveLocalMode = localPackageSyncService.resolveLocalPackageMode;
  const originalSync = localPackageSyncService.syncMountedPackages;
  const res = makeRenderResponse();

  try {
    localPackageSyncService.resolveLocalPackageMode = () => ({
      requested: true,
      enabled: true,
      production: false,
      productionLocked: false,
      localOnlyVarsPresent: true,
      localEnvKeys: ['PACKAGE_LOCAL_DEV_MODE']
    });
    localPackageSyncService.syncMountedPackages = async () => ({
      status: 'partial',
      syncedCount: 1,
      failedCount: 1,
      cache: { filePath: 'data/localPackageRegistry.json' }
    });
    await systemSettingsController.syncLocalPackagesFromManager(
      {
        body: {
          targetRoot: 'C:/repo/packages',
          selectedPackageIds: ['pte']
        }
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonPayload?.status, 'warning');
    assert.match(String(res.jsonPayload?.message || ''), /Synced 1 package/i);
  } finally {
    localPackageSyncService.resolveLocalPackageMode = originalResolveLocalMode;
    localPackageSyncService.syncMountedPackages = originalSync;
  }
});

test('install package controller returns structured success and admin_required error shape', async () => {
  const originalInstall = systemSettingsPackageManagerService.installPackage;
  const res = makeRenderResponse();

  try {
    systemSettingsPackageManagerService.installPackage = async () => ({
      action: 'install',
      packageId: 'pte',
      warnings: []
    });
    await systemSettingsController.installPackageFromManager(
      {
        body: { installMethod: 'path', manifestPath: 'packages/pte/package.manifest.json' },
        user: { id: 'USER_2' },
        app: {}
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonPayload?.status, 'success');
    assert.equal(res.jsonPayload?.report?.packageId, 'pte');

    systemSettingsPackageManagerService.installPackage = async () => {
      const error = new Error('Admin approval required or session expired.');
      error.code = 'ADMIN_REQUIRED';
      throw error;
    };
    const res2 = makeRenderResponse();
    await systemSettingsController.installPackageFromManager(
      {
        body: { installMethod: 'path', manifestPath: 'packages/pte/package.manifest.json' },
        user: { id: 'USER_3' },
        app: {}
      },
      res2
    );
    assert.equal(res2.statusCode, 403);
    assert.equal(res2.jsonPayload?.status, 'admin_required');
  } finally {
    systemSettingsPackageManagerService.installPackage = originalInstall;
  }
});

test('install ZIP package controller returns structured success and admin_required error shape', async () => {
  const originalInstallZip = systemSettingsPackageManagerService.installPackageZip;
  const res = makeRenderResponse();

  try {
    systemSettingsPackageManagerService.installPackageZip = async () => ({
      action: 'install-zip',
      packageId: 'addon-pte',
      warnings: []
    });
    await systemSettingsController.installPackageZipFromManager(
      {
        files: {
          packageZip: [{ buffer: Buffer.from('zip') }],
          packageSig: [{ buffer: Buffer.from('sig') }]
        },
        user: { id: 'USER_ZIP_1' },
        app: {}
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonPayload?.status, 'success');
    assert.equal(res.jsonPayload?.report?.action, 'install-zip');

    systemSettingsPackageManagerService.installPackageZip = async () => {
      const error = new Error('Admin approval required or session expired.');
      error.code = 'ADMIN_REQUIRED';
      throw error;
    };
    const res2 = makeRenderResponse();
    await systemSettingsController.installPackageZipFromManager(
      {
        files: {
          packageZip: [{ buffer: Buffer.from('zip') }],
          packageSig: [{ buffer: Buffer.from('sig') }]
        },
        user: { id: 'USER_ZIP_2' },
        app: {}
      },
      res2
    );
    assert.equal(res2.statusCode, 403);
    assert.equal(res2.jsonPayload?.status, 'admin_required');
  } finally {
    systemSettingsPackageManagerService.installPackageZip = originalInstallZip;
  }
});

test('install ZIP package controller returns clear message when trusted key is missing', async () => {
  const originalInstallZip = systemSettingsPackageManagerService.installPackageZip;
  const res = makeRenderResponse();

  try {
    systemSettingsPackageManagerService.installPackageZip = async () => {
      const error = new Error('No trusted package public key is configured for ZIP install verification.');
      error.code = 'ZIP_SIGNATURE_NOT_CONFIGURED';
      throw error;
    };

    await systemSettingsController.installPackageZipFromManager(
      {
        files: {
          packageZip: [{ buffer: Buffer.from('zip') }],
          packageSig: [{ buffer: Buffer.from('sig') }]
        },
        user: { id: 'USER_ZIP_3' },
        app: {}
      },
      res
    );

    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonPayload?.status, 'error');
    assert.match(String(res.jsonPayload?.message || ''), /PACKAGE_INSTALL_ED25519_PUBLIC_KEYS/i);
  } finally {
    systemSettingsPackageManagerService.installPackageZip = originalInstallZip;
  }
});

test('install package controller returns structured payload import failure details', async () => {
  const originalInstall = systemSettingsPackageManagerService.installPackage;
  const res = makeRenderResponse();

  try {
    systemSettingsPackageManagerService.installPackage = async () => {
      const error = new Error('Builder payload import failed for pteApplicants#A1');
      error.code = 'BUILDER_PAYLOAD_IMPORT_FAILED';
      error.details = {
        entityType: 'pteApplicants',
        rowId: 'A1',
        operation: 'update',
        message: 'duplicate key conflict'
      };
      throw error;
    };

    await systemSettingsController.installPackageFromManager(
      {
        body: { installMethod: 'path', manifestPath: 'packages/pte/package.manifest.json' },
        user: { id: 'USER_IMPORT_FAIL_1' },
        app: {}
      },
      res
    );

    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonPayload?.status, 'error');
    assert.equal(res.jsonPayload?.code, 'BUILDER_PAYLOAD_IMPORT_FAILED');
    assert.equal(res.jsonPayload?.details?.entityType, 'pteApplicants');
  } finally {
    systemSettingsPackageManagerService.installPackage = originalInstall;
  }
});

test('install package controller maps runtime route mount failures to actionable message', async () => {
  const originalInstall = systemSettingsPackageManagerService.installPackage;
  const res = makeRenderResponse();

  try {
    systemSettingsPackageManagerService.installPackage = async () => {
      const error = new Error('Runtime route mount reported failed route declarations.');
      error.code = 'PACKAGE_RUNTIME_ROUTE_MOUNT_FAILED';
      error.details = {
        runtimeRoutes: { requested: 1, mounted: 0, failed: 1 }
      };
      throw error;
    };

    await systemSettingsController.installPackageFromManager(
      {
        body: { installMethod: 'path', manifestPath: 'packages/pte/package.manifest.json' },
        user: { id: 'USER_RUNTIME_FAIL_1' },
        app: {}
      },
      res
    );

    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonPayload?.status, 'error');
    assert.equal(res.jsonPayload?.code, 'PACKAGE_RUNTIME_ROUTE_MOUNT_FAILED');
    assert.match(String(res.jsonPayload?.message || ''), /runtime route mount failed/i);
  } finally {
    systemSettingsPackageManagerService.installPackage = originalInstall;
  }
});

test('remove package controller defaults to full cleanup mode and forwards preview token', async () => {
  const originalRemove = systemSettingsPackageManagerService.removePackage;
  const res = makeRenderResponse();
  let captured = null;

  try {
    systemSettingsPackageManagerService.removePackage = async (packageId, options) => {
      captured = { packageId, options };
      return { action: 'remove', packageId: 'pte' };
    };
    await systemSettingsController.removePackageFromManager(
      {
        params: { packageId: 'pte' },
        body: {
          previewTransactionId: 'TXN_1',
          deleteSelection: JSON.stringify({
            tables: ['pteApplicants'],
            files: ['ORG_900000/symbols/logo.png']
          })
        },
        user: { id: 'USER_7' },
        app: {}
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(captured?.packageId, 'pte');
    assert.equal(captured?.options?.force, false);
    assert.equal(captured?.options?.cleanupMode, 'full');
    assert.equal(captured?.options?.previewTransactionId, 'TXN_1');
    assert.deepEqual(captured?.options?.deleteSelection, {
      tables: ['pteApplicants'],
      files: ['ORG_900000/symbols/logo.png']
    });
  } finally {
    systemSettingsPackageManagerService.removePackage = originalRemove;
  }
});

test('uninstall preview controller returns success payload', async () => {
  const originalPreview = systemSettingsPackageManagerService.previewPackageUninstallImpact;
  const res = makeRenderResponse();

  try {
    systemSettingsPackageManagerService.previewPackageUninstallImpact = async () => ({
      packageId: 'pte',
      blocked: true,
      modifiedRecords: [{ entityType: 'sections', identityKey: 'name:PTE' }],
      previewTransactionId: 'TXN_PREVIEW_1',
      blockedReasons: ['customized records']
    });
    await systemSettingsController.uninstallPreviewPackageFromManager(
      {
        params: { packageId: 'pte' },
        user: { id: 'USER_8' },
        app: {}
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonPayload?.status, 'success');
    assert.equal(res.jsonPayload?.report?.previewTransactionId, 'TXN_PREVIEW_1');
  } finally {
    systemSettingsPackageManagerService.previewPackageUninstallImpact = originalPreview;
  }
});

test('package manager EJS compiles and includes expected controls', () => {
  const viewPath = path.join(process.cwd(), 'MVC', 'views', 'systemSettings', 'packageManagerSettings.ejs');
  const template = fs.readFileSync(viewPath, 'utf8');
  const render = ejs.compile(template, { filename: viewPath });
  const html = render({
    title: 'Package Manager',
    runtimeBackend: { mode: 'json', mongo: { ready: false } },
    installedPackages: [
      {
        packageId: 'pte',
        name: 'PTE',
        version: '1.0.0',
        enabled: true,
        installStatus: 'enabled',
        manifestPath: 'packages/pte/package.manifest.json',
        updatedAt: '2026-05-25T00:00:00.000Z',
        warnings: []
      }
    ],
    localManifestOptions: [
      {
        packageId: 'pte',
        version: '1.0.0',
        storedManifestPath: 'packages/pte/package.manifest.json'
      }
    ],
    localManifestWarnings: [],
    startupPackageWarnings: ['[pte] No manifest file found for this enabled package.'],
    actionStateId: 'STATE_VIEW',
    zipTrustedKeysConfigured: true,
    zipTrustedKeysCount: 1
  });

  assert.match(html, /Package Manager/);
  assert.match(html, /Install \/ Enable Package/);
  assert.match(html, /\/systemSettings\/packages\/install/);
  assert.match(html, /\/systemSettings\/packages\/install-zip/);
  assert.match(html, /ZIP Upload/);
  assert.match(html, /Trusted signature keys configured/i);
  assert.match(html, /Installed Packages/);
  assert.match(html, /Impact Preview/);
  assert.match(html, /Recent Lifecycle Transactions/);
  assert.match(html, /Startup Package Load Warnings \(Registry State Unchanged\)/i);
  assert.match(html, /showRemoveInventoryWizard/);
  assert.match(html, /Critical \(Always Removed\)/);
  assert.match(html, /Tables \(Selectable\)/);
  assert.match(html, /Files \(Selectable\)/);
  assert.match(html, /Step \$\{stepNumber\} of 3/);
  assert.match(html, /Select All/);
  assert.match(html, /Unselect All/);
  assert.match(html, /pkg-remove-wizard-check/);
  assert.match(html, /pkg-remove-wizard-toggle-btn/);
});

test('package manager EJS shows local sync button when local dev mode is enabled', () => {
  const viewPath = path.join(process.cwd(), 'MVC', 'views', 'systemSettings', 'packageManagerSettings.ejs');
  const template = fs.readFileSync(viewPath, 'utf8');
  const render = ejs.compile(template, { filename: viewPath });
  const html = render({
    title: 'Package Manager',
    runtimeBackend: { mode: 'json', mongo: { ready: false } },
    installedPackages: [],
    localManifestOptions: [],
    localManifestWarnings: [],
    actionStateId: 'STATE_VIEW_LOCAL',
    zipTrustedKeysConfigured: false,
    zipTrustedKeysCount: 0,
    localPackageDevModeEnabled: true
  });

  assert.match(html, /Package Sync Locally/);
  assert.match(html, /\/systemSettings\/packages\/local-sync/);
});

test('local package sync EJS compiles and includes sync actions', () => {
  const viewPath = path.join(process.cwd(), 'MVC', 'views', 'systemSettings', 'packageLocalSyncSettings.ejs');
  const template = fs.readFileSync(viewPath, 'utf8');
  const render = ejs.compile(template, { filename: viewPath });
  const html = render({
    title: 'Package Sync Locally',
    runtimeBackend: { mode: 'json' },
    localPackageDevModeEnabled: true,
    targetRootDefault: 'C:/repo/packages',
    localRegistryFilePath: 'data/localPackageRegistry.json',
    localRegistryGeneratedAt: '2026-05-28T12:00:00.000Z',
    actionStateId: 'STATE_LOCAL_SYNC_2'
  });

  assert.match(html, /Package Sync Locally/);
  assert.match(html, /Scan Railway Runtime/);
  assert.match(html, /RAILWAY_GATEWAY_BASE_URL/);
  assert.match(html, /Sync Selected Package/);
  assert.match(html, /\/systemSettings\/packages\/local-sync\/scan/);
  assert.match(html, /\/systemSettings\/packages\/local-sync\/sync/);
});
