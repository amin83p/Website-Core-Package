const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const test = require('node:test');
const assert = require('node:assert/strict');

const uploadFolderSettingsService = require('../MVC/services/uploadFolderSettingsService');
const systemSettingsRoutes = require('../MVC/routes/systemSettingsRoutes');
const systemSettingsController = require('../MVC/controllers/systemSettingsController');
const systemSettingsRepository = require('../MVC/repositories/systemSettingsRepository');

function findRouteLayer(routePath, method) {
  return systemSettingsRoutes.stack.find((layer) => (
    layer.route?.path === routePath
    && layer.route?.methods?.[method] === true
  ));
}

function makeRedirectResponse() {
  return {
    redirectedTo: '',
    redirect(statusOrPath, maybePath) {
      this.redirectedTo = typeof maybePath === 'string' ? maybePath : statusOrPath;
      return this;
    }
  };
}

function makeRenderResponse() {
  return {
    rendered: null,
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    render(view, payload) {
      this.rendered = { view, payload };
      return this;
    }
  };
}

test('upload folder registry exposes package metadata and supports package filter', () => {
  const all = uploadFolderSettingsService.getUploadFolderDefinitions();
  const pteOnly = uploadFolderSettingsService.getUploadFolderDefinitions({ packageName: 'PTE' });
  const packageOptions = uploadFolderSettingsService.getUploadFolderPackageOptions();

  assert.ok(all.some((row) => row.key === 'core.emailTemplates' && row.packageName === 'CORE'));
  assert.ok(all.some((row) => row.packageName === 'PTE'));
  assert.ok(pteOnly.length > 0);
  assert.ok(pteOnly.every((row) => row.packageName === 'PTE'));
  assert.ok(packageOptions.some((row) => row.id === 'CORE'));
  assert.ok(packageOptions.some((row) => row.id === 'PTE'));
});

test('upload folder validation rejects unsafe templates', () => {
  const definition = uploadFolderSettingsService.getUploadFolderDefinitions()
    .find((row) => row.key === 'core.fileManager');
  assert.ok(definition, 'expected core.fileManager definition');

  assert.throws(() => uploadFolderSettingsService.validateTemplateForDefinition(definition, 'C:/temp/path'), /relative/i);
  assert.throws(
    () => uploadFolderSettingsService.validateTemplateForDefinition(definition, '/uploads/GLOBAL/misc'),
    /(uploads prefix|relative to the scoped upload folder)/i
  );
  assert.throws(() => uploadFolderSettingsService.validateTemplateForDefinition(definition, 'ORG_123/misc'), /ORG scope folders/i);
});

test('default-file-path routes are registered and legacy upload-folders routes still exist', () => {
  const canonicalGet = findRouteLayer('/default-file-paths', 'get');
  const canonicalPost = findRouteLayer('/default-file-paths', 'post');
  const legacyGet = findRouteLayer('/upload-folders', 'get');
  const legacyPost = findRouteLayer('/upload-folders', 'post');

  assert.ok(canonicalGet, 'expected GET /default-file-paths');
  assert.ok(canonicalPost, 'expected POST /default-file-paths');
  assert.ok(legacyGet, 'expected GET /upload-folders');
  assert.ok(legacyPost, 'expected POST /upload-folders');

  assert.equal(canonicalGet.route.stack.at(-1)?.handle, systemSettingsController.showDefaultFilePathSettings);
  assert.equal(canonicalPost.route.stack.at(-1)?.handle, systemSettingsController.updateDefaultFilePathSettings);
  assert.equal(legacyGet.route.stack.at(-1)?.handle, systemSettingsController.redirectUploadFolderSettingsGet);
  assert.equal(legacyPost.route.stack.at(-1)?.handle, systemSettingsController.redirectUploadFolderSettingsPost);
});

test('legacy upload-folder redirects point to canonical route', async () => {
  const getRes = makeRedirectResponse();
  await systemSettingsController.redirectUploadFolderSettingsGet(
    { query: { package: 'PTE' } },
    getRes
  );
  assert.equal(getRes.redirectedTo, '/systemSettings/default-file-paths?package=PTE');

  const postRes = makeRedirectResponse();
  await systemSettingsController.redirectUploadFolderSettingsPost({}, postRes);
  assert.equal(postRes.redirectedTo, '/systemSettings/default-file-paths');
});

test('default file paths page renders filtered package view model', async () => {
  const originalGetSettings = systemSettingsRepository.getSettings;
  const res = makeRenderResponse();
  systemSettingsRepository.getSettings = async () => ({
    app: {
      uploadFolders: uploadFolderSettingsService.getDefaultUploadFolders()
    }
  });

  try {
    await systemSettingsController.showDefaultFilePathSettings(
      { query: { package: 'PTE' }, user: { id: 'USER_001' }, actionStateId: 'STATE_001' },
      res
    );

    assert.equal(res.rendered?.view, 'systemSettings/defaultFilePathSettings');
    assert.equal(res.rendered?.payload?.title, 'Default File Paths');
    assert.equal(res.rendered?.payload?.selectedPackage, 'PTE');
    assert.ok(
      Array.isArray(res.rendered?.payload?.definitions)
      && res.rendered.payload.definitions.every((row) => row.packageName === 'PTE')
    );
  } finally {
    systemSettingsRepository.getSettings = originalGetSettings;
  }
});

test('default file paths EJS compiles with package filter locals', () => {
  const viewPath = path.join(process.cwd(), 'MVC', 'views', 'systemSettings', 'defaultFilePathSettings.ejs');
  const template = fs.readFileSync(viewPath, 'utf8');
  const render = ejs.compile(template, { filename: viewPath });
  const html = render({
    title: 'Default File Paths',
    actionStateId: 'STATE_001',
    selectedPackage: 'PTE',
    groups: uploadFolderSettingsService.GROUPS,
    packageOptions: uploadFolderSettingsService.getUploadFolderPackageOptions(),
    definitions: uploadFolderSettingsService.getUploadFolderDefinitions({ packageName: 'PTE' })
  });

  assert.match(html, /Default File Paths/);
  assert.match(html, /Package/);
});
