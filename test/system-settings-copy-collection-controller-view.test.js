const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const test = require('node:test');
const assert = require('node:assert/strict');

const systemSettingsController = require('../MVC/controllers/systemSettingsController');
const systemSettingsRepository = require('../MVC/repositories/systemSettingsRepository');
const dataBackendRuntimeService = require('../MVC/services/dataBackendRuntimeService');
const jsonToMongoMigrationService = require('../MVC/services/migration/jsonToMongoMigrationService');

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

test('copy-collection page controller renders source collection context', async () => {
  const originalGetSettings = systemSettingsRepository.getSettings;
  const originalRuntimeStatus = dataBackendRuntimeService.getPublicBackendStatus;
  const originalListCollections = jsonToMongoMigrationService.listCopyEligibleCollections;
  const res = makeRenderResponse();

  systemSettingsRepository.getSettings = async () => ({ app: {} });
  dataBackendRuntimeService.getPublicBackendStatus = () => ({
    mode: 'mongo',
    mongo: { ready: true, source: 'env' }
  });
  jsonToMongoMigrationService.listCopyEligibleCollections = async () => ({
    sourceDbName: 'sourceDb',
    collections: ['users', 'roles']
  });

  try {
    await systemSettingsController.showDataMigrationCopyCollectionPage(
      { user: { id: 'USER_1' }, actionStateId: 'STATE_101' },
      res
    );

    assert.equal(res.rendered?.view, 'systemSettings/dataMigrationCopyCollection');
    assert.equal(res.rendered?.payload?.title, 'Copy Single Collection');
    assert.equal(res.rendered?.payload?.sourceDbName, 'sourceDb');
    assert.deepEqual(res.rendered?.payload?.collections, ['users', 'roles']);
    assert.equal(res.rendered?.payload?.actionStateId, 'STATE_101');
  } finally {
    systemSettingsRepository.getSettings = originalGetSettings;
    dataBackendRuntimeService.getPublicBackendStatus = originalRuntimeStatus;
    jsonToMongoMigrationService.listCopyEligibleCollections = originalListCollections;
  }
});

test('copy-collection page EJS compiles with expected inputs', () => {
  const viewPath = path.join(process.cwd(), 'MVC', 'views', 'systemSettings', 'dataMigrationCopyCollection.ejs');
  const template = fs.readFileSync(viewPath, 'utf8');
  const render = ejs.compile(template, { filename: viewPath });
  const html = render({
    title: 'Copy Single Collection',
    runtimeBackend: { mode: 'mongo', mongo: { ready: true } },
    sourceDbName: 'sourceDb',
    collections: ['users', 'roles'],
    loadWarning: '',
    actionStateId: 'STATE_1'
  });

  assert.match(html, /Copy Single Collection/);
  assert.match(html, /Destination Mongo URI/);
  assert.match(html, /Overwrite Destination Collection/);
});
