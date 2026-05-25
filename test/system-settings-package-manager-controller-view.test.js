const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const test = require('node:test');
const assert = require('node:assert/strict');

const systemSettingsController = require('../MVC/controllers/systemSettingsController');
const systemSettingsRepository = require('../MVC/repositories/systemSettingsRepository');
const dataBackendRuntimeService = require('../MVC/services/dataBackendRuntimeService');
const systemSettingsPackageManagerService = require('../MVC/services/systemSettingsPackageManagerService');

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
    await systemSettingsController.showPackageManagerPage(
      { user: { id: 'USER_1' }, actionStateId: 'STATE_801' },
      res
    );

    assert.equal(res.rendered?.view, 'systemSettings/packageManagerSettings');
    assert.equal(res.rendered?.payload?.title, 'Package Manager');
    assert.equal(res.rendered?.payload?.actionStateId, 'STATE_801');
    assert.equal(Array.isArray(res.rendered?.payload?.installedPackages), true);
    assert.equal(Array.isArray(res.rendered?.payload?.localManifestOptions), true);
    assert.equal(Array.isArray(res.rendered?.payload?.localManifestWarnings), true);
    assert.equal(res.rendered?.payload?.localManifestOptions.length, 1);
  } finally {
    systemSettingsRepository.getSettings = originalGetSettings;
    dataBackendRuntimeService.getPublicBackendStatus = originalRuntimeStatus;
    systemSettingsPackageManagerService.listPackageSnapshot = originalListSnapshot;
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
    actionStateId: 'STATE_VIEW'
  });

  assert.match(html, /Package Manager/);
  assert.match(html, /Install \/ Enable Package/);
  assert.match(html, /\/systemSettings\/packages\/install/);
  assert.match(html, /\/systemSettings\/packages\/install-zip/);
  assert.match(html, /ZIP Upload/);
  assert.match(html, /Installed Packages/);
});
