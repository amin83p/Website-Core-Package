const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const test = require('node:test');
const assert = require('node:assert/strict');

const systemSettingsController = require('../MVC/controllers/systemSettingsController');
const systemSettingsRepository = require('../MVC/repositories/systemSettingsRepository');
const dataBackendRuntimeService = require('../MVC/services/dataBackendRuntimeService');
const systemSettingsPackageBuilderService = require('../MVC/services/systemSettingsPackageBuilderService');
const dataService = require('../MVC/services/dataService');

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

test('package builder page controller renders package rows and action state', async () => {
  const originalGetSettings = systemSettingsRepository.getSettings;
  const originalRuntimeStatus = dataBackendRuntimeService.getPublicBackendStatus;
  const originalDiscover = systemSettingsPackageBuilderService.discoverLocalPackages;
  const originalFetchData = dataService.fetchData;
  const res = makeRenderResponse();

  try {
    systemSettingsRepository.getSettings = async () => ({ app: {} });
    dataBackendRuntimeService.getPublicBackendStatus = () => ({ mode: 'json', mongo: { ready: false } });
    systemSettingsPackageBuilderService.discoverLocalPackages = async () => ([
      { packageId: 'pte', packageName: 'PTE', version: '1.0.0', storedManifestPath: 'packages/pte/package.manifest.json', valid: true },
      { packageId: 'broken', storedManifestPath: 'packages/broken/package.manifest.json', valid: false, error: 'Invalid manifest' }
    ]);
    dataService.fetchData = async () => ([
      { id: 'ORG_900000', name: 'Primary Org' }
    ]);

    await systemSettingsController.showPackageBuilderPage(
      { user: { id: 'USER_1' }, actionStateId: 'STATE_901' },
      res
    );

    assert.equal(res.rendered?.view, 'systemSettings/packageBuilderSettings');
    assert.equal(res.rendered?.payload?.title, 'Package Builder');
    assert.equal(res.rendered?.payload?.actionStateId, 'STATE_901');
    assert.equal(Array.isArray(res.rendered?.payload?.packages), true);
    assert.equal(Array.isArray(res.rendered?.payload?.packageWarnings), true);
    assert.equal(Array.isArray(res.rendered?.payload?.organizations), true);
    assert.equal(res.rendered?.payload?.packages.length, 1);
  } finally {
    systemSettingsRepository.getSettings = originalGetSettings;
    dataBackendRuntimeService.getPublicBackendStatus = originalRuntimeStatus;
    systemSettingsPackageBuilderService.discoverLocalPackages = originalDiscover;
    dataService.fetchData = originalFetchData;
  }
});

test('package builder preflight/build controllers return structured payloads', async () => {
  const originalRuntimeStatus = dataBackendRuntimeService.getPublicBackendStatus;
  const originalPreflight = systemSettingsPackageBuilderService.preflightBuild;
  const originalBuild = systemSettingsPackageBuilderService.buildPackage;

  try {
    dataBackendRuntimeService.getPublicBackendStatus = () => ({ mode: 'json' });
    systemSettingsPackageBuilderService.preflightBuild = async () => ({
      package: { packageId: 'pte' },
      selectedDataEntities: [{ entityType: 'pteApplicants' }]
    });
    systemSettingsPackageBuilderService.buildPackage = async () => ({
      packageId: 'pte',
      version: '1.0.1',
      artifacts: { zip: 'install_packages/pte-1.0.1-xxx.zip' }
    });

    const preflightRes = makeRenderResponse();
    await systemSettingsController.preflightPackageBuilder(
      {
        body: { packageId: 'pte', selectedDataEntities: 'pteApplicants' },
        user: { id: 'USER_PRE_1' }
      },
      preflightRes
    );
    assert.equal(preflightRes.statusCode, 200);
    assert.equal(preflightRes.jsonPayload?.status, 'success');
    assert.equal(preflightRes.jsonPayload?.report?.package?.packageId, 'pte');

    const buildRes = makeRenderResponse();
    await systemSettingsController.buildPackageFromBuilder(
      {
        body: { packageId: 'pte', version: '1.0.1' },
        user: { id: 'USER_BUILD_1' }
      },
      buildRes
    );
    assert.equal(buildRes.statusCode, 200);
    assert.equal(buildRes.jsonPayload?.status, 'success');
    assert.equal(buildRes.jsonPayload?.report?.version, '1.0.1');
  } finally {
    dataBackendRuntimeService.getPublicBackendStatus = originalRuntimeStatus;
    systemSettingsPackageBuilderService.preflightBuild = originalPreflight;
    systemSettingsPackageBuilderService.buildPackage = originalBuild;
  }
});

test('package builder EJS compiles and includes expected controls', () => {
  const viewPath = path.join(process.cwd(), 'MVC', 'views', 'systemSettings', 'packageBuilderSettings.ejs');
  const template = fs.readFileSync(viewPath, 'utf8');
  const render = ejs.compile(template, { filename: viewPath });
  const html = render({
    title: 'Package Builder',
    runtimeBackend: { mode: 'json' },
    packageStorageRoot: '/tmp/pkgs',
    packages: [
      { packageId: 'pte', version: '1.0.0', storedManifestPath: 'packages/pte/package.manifest.json', valid: true }
    ],
    packageWarnings: [],
    organizations: [{ id: 'ORG_900000', name: 'Primary Org' }],
    actionStateId: 'STATE_VIEW_BUILDER'
  });

  assert.match(html, /Package Builder/);
  assert.match(html, /Build Signed Package/);
  assert.match(html, /\/systemSettings\/package-builder\/preflight/);
  assert.match(html, /\/systemSettings\/package-builder\/build/);
  assert.match(html, /Target Version/);
  assert.match(html, /Manual File\/Folder Refs/);
});
