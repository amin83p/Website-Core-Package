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
      { packageId: 'pte', packageName: 'PTE', version: '1.0.0', storedManifestPath: 'packages/pte/package.manifest.json', valid: true, manifestResolved: true },
      { packageId: 'broken', storedManifestPath: 'packages/broken/package.manifest.json', valid: false, manifestResolved: false, error: 'Invalid manifest' }
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
    assert.equal(res.rendered?.payload?.packages.length, 2);
    assert.equal(res.rendered?.payload?.packageWarnings.length, 1);
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
  let capturedPreflightInput = null;
  let capturedBuildInput = null;

  try {
    dataBackendRuntimeService.getPublicBackendStatus = () => ({ mode: 'json' });
    systemSettingsPackageBuilderService.preflightBuild = async (input) => {
      capturedPreflightInput = input;
      return ({
      package: { packageId: 'pte' },
      originOrgId: 'ORG_900000',
      selectedDataEntities: [{ entityType: 'pteApplicants' }]
      });
    };
    systemSettingsPackageBuilderService.buildPackage = async (input) => {
      capturedBuildInput = input;
      return ({
      packageId: 'pte',
      version: '1.0.1',
      artifacts: { zip: 'install_packages/pte-1.0.1-xxx.zip' }
      });
    };

    const preflightRes = makeRenderResponse();
    await systemSettingsController.preflightPackageBuilder(
      {
        body: {
          packageId: 'pte',
          originOrgId: 'ORG_900000',
          selectedDataEntities: 'pteApplicants',
          fileFieldSelection: JSON.stringify({ pteApplicants: ['avatarUrl'] })
        },
        user: { id: 'USER_PRE_1' }
      },
      preflightRes
    );
    assert.equal(preflightRes.statusCode, 200);
    assert.equal(preflightRes.jsonPayload?.status, 'success');
    assert.equal(preflightRes.jsonPayload?.report?.package?.packageId, 'pte');
    assert.deepEqual(capturedPreflightInput?.fileFieldSelection, { pteApplicants: ['avatarUrl'] });

    const buildRes = makeRenderResponse();
    await systemSettingsController.buildPackageFromBuilder(
      {
        body: {
          packageId: 'pte',
          version: '1.0.1',
          originOrgId: 'ORG_900000',
          fileFieldSelection: { pteApplicants: ['avatarUrl'] }
        },
        user: { id: 'USER_BUILD_1' }
      },
      buildRes
    );
    assert.equal(buildRes.statusCode, 200);
    assert.equal(buildRes.jsonPayload?.status, 'success');
    assert.equal(buildRes.jsonPayload?.report?.version, '1.0.1');
    assert.deepEqual(capturedBuildInput?.fileFieldSelection, { pteApplicants: ['avatarUrl'] });
  } finally {
    dataBackendRuntimeService.getPublicBackendStatus = originalRuntimeStatus;
    systemSettingsPackageBuilderService.preflightBuild = originalPreflight;
    systemSettingsPackageBuilderService.buildPackage = originalBuild;
  }
});

test('package builder controllers reject missing origin org', async () => {
  const originalRuntimeStatus = dataBackendRuntimeService.getPublicBackendStatus;
  const originalPreflight = systemSettingsPackageBuilderService.preflightBuild;
  const originalBuild = systemSettingsPackageBuilderService.buildPackage;
  try {
    dataBackendRuntimeService.getPublicBackendStatus = () => ({ mode: 'json' });
    systemSettingsPackageBuilderService.preflightBuild = async () => {
      throw new Error('Origin organization is required. Select an origin org before preflight/build.');
    };
    systemSettingsPackageBuilderService.buildPackage = async () => {
      throw new Error('Origin organization is required. Select an origin org before preflight/build.');
    };

    const preflightRes = makeRenderResponse();
    await systemSettingsController.preflightPackageBuilder(
      { body: { packageId: 'pte' }, user: { id: 'USER_PRE_2' } },
      preflightRes
    );
    assert.equal(preflightRes.statusCode, 400);
    assert.equal(preflightRes.jsonPayload?.status, 'error');
    assert.match(String(preflightRes.jsonPayload?.message || ''), /origin organization is required/i);

    const buildRes = makeRenderResponse();
    await systemSettingsController.buildPackageFromBuilder(
      { body: { packageId: 'pte', version: '1.0.1' }, user: { id: 'USER_BUILD_2' } },
      buildRes
    );
    assert.equal(buildRes.statusCode, 400);
    assert.equal(buildRes.jsonPayload?.status, 'error');
    assert.match(String(buildRes.jsonPayload?.message || ''), /origin organization is required/i);
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
      { packageId: 'pte', version: '1.0.0', storedManifestPath: 'packages/pte/package.manifest.json', valid: true, manifestResolved: true },
      { packageId: 'broken', version: '1.0.0', storedManifestPath: 'packages/broken/package.manifest.json', valid: false, manifestResolved: false, warning: 'Manifest missing' }
    ],
    packageWarnings: [{ packageId: 'broken', warning: 'Manifest missing' }],
    organizations: [{ id: 'ORG_900000', name: 'Primary Org' }],
    actionStateId: 'STATE_VIEW_BUILDER'
  });

  assert.match(html, /Package Builder/);
  assert.match(html, /Build Signed Package/);
  assert.match(html, /\/systemSettings\/package-builder\/preflight/);
  assert.match(html, /\/systemSettings\/package-builder\/build/);
  assert.match(html, /Target Version/);
  assert.match(html, /Origin Org/);
  assert.match(html, /Package-Owned Tables \/ Collections/);
  assert.match(html, /File Fields By Table/);
  assert.match(html, /Add All Detected/);
  assert.match(html, /Clear Selected/);
  assert.match(html, /builderAddAllFileFieldsBtn/);
  assert.match(html, /builderClearSelectedFileFieldsBtn/);
  assert.match(html, /builder-file-field-picker/);
  assert.match(html, /builder-file-field-add-btn/);
  assert.match(html, /builder-file-field-remove-btn/);
  assert.match(html, /Remap path map: org fields/);
  assert.match(html, /Org paths:/);
  assert.match(html, /Upload URL paths:/);
  assert.match(html, /addSelectedFileField/);
  assert.match(html, /removeSelectedFileField/);
  assert.match(html, /getFileFieldSelection/);
  assert.match(html, /Manual File\/Folder Refs/);
  assert.match(html, /Published Artifacts/);
  assert.match(html, /Package Storage Root/);
  assert.match(html, /Unavailable: Missing\/Invalid Manifest/);

  const packageIdx = html.indexOf('Package-Owned Tables / Collections');
  const fileFieldsIdx = html.indexOf('File Fields By Table');
  const versionIdx = html.indexOf('Target Version');
  const manualIdx = html.indexOf('Manual File/Folder Refs (one per line)');
  assert.ok(packageIdx > -1 && fileFieldsIdx > packageIdx);
  assert.ok(versionIdx > fileFieldsIdx);
  assert.ok(manualIdx > versionIdx);
});
