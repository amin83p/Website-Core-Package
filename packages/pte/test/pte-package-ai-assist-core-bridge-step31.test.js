const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const AI_SERVICE_FILES = [
  'packages/pte/MVC/services/pte/pteAiProviderDataService.js',
  'packages/pte/MVC/services/pte/pteAiScoringSettingsDataService.js',
  'packages/pte/MVC/services/pte/pteAiTokenUsageDataService.js'
];

const AI_CONTROLLER_FILES = [
  'packages/pte/MVC/controllers/aiProviderController.js',
  'packages/pte/MVC/controllers/aiTokenUsageController.js'
];

const DIRECT_CORE_PATTERNS = [
  "'../../../../MVC/services/adminChekersService",
  '"../../../../MVC/services/adminChekersService"',
  "'../../../../../MVC/services/adminChekersService",
  '"../../../../../MVC/services/adminChekersService"',
  "'../../../../MVC/services/activityQuotaLedgerService",
  '"../../../../MVC/services/activityQuotaLedgerService"',
  "'../../../../../MVC/services/activityQuotaLedgerService",
  '"../../../../../MVC/services/activityQuotaLedgerService"',
  "'../../../../MVC/services/settingService",
  '"../../../../MVC/services/settingService"',
  "'../../../../../MVC/services/settingService",
  '"../../../../../MVC/services/settingService"',
  "'../../../../MVC/services/dataService",
  '"../../../../MVC/services/dataService"',
  "'../../../../../MVC/services/dataService",
  '"../../../../../MVC/services/dataService"',
  "'../../../../MVC/utils/queryOptionsAdapter",
  '"../../../../MVC/utils/queryOptionsAdapter"',
  "'../../../../../MVC/utils/queryOptionsAdapter",
  '"../../../../../MVC/utils/queryOptionsAdapter"',
  "'../../../../MVC/utils/entityResolver",
  '"../../../../MVC/utils/entityResolver"',
  "'../../../../../MVC/utils/entityResolver",
  '"../../../../../MVC/utils/entityResolver"',
  "'../../../../MVC/utils/queryEngine",
  '"../../../../MVC/utils/queryEngine"',
  "'../../../../../MVC/utils/queryEngine",
  '"../../../../../MVC/utils/queryEngine"',
  "'../../../../MVC/utils/idAdapter",
  '"../../../../MVC/utils/idAdapter"',
  "'../../../../../MVC/utils/idAdapter",
  '"../../../../../MVC/utils/idAdapter"',
  "'../../../../MVC/utils/orgContextUtils",
  '"../../../../MVC/utils/orgContextUtils"',
  "'../../../../../MVC/utils/orgContextUtils",
  '"../../../../../MVC/utils/orgContextUtils"',
  "'../../../../MVC/utils/encyptors",
  '"../../../../MVC/utils/encyptors"',
  "'../../../../../MVC/utils/encyptors",
  '"../../../../../MVC/utils/encyptors"',
  "'../../../../MVC/repositories/backend/repositoryBackendSelector",
  '"../../../../MVC/repositories/backend/repositoryBackendSelector"',
  "'../../../../../MVC/repositories/backend/repositoryBackendSelector",
  '"../../../../../MVC/repositories/backend/repositoryBackendSelector"',
  "'../../../../MVC/infrastructure/mongo/mongoConnection",
  '"../../../../MVC/infrastructure/mongo/mongoConnection"',
  "'../../../../../MVC/infrastructure/mongo/mongoConnection",
  '"../../../../../MVC/infrastructure/mongo/mongoConnection"',
  "'../../../../MVC/utils/generalTools",
  '"../../../../MVC/utils/generalTools"',
  "'../../../../MVC/utils/paginationHelper",
  '"../../../../MVC/utils/paginationHelper"'
];

test('AI Assist services and controllers use package-local core adapters', () => {
  const dependencySource = readText('packages/pte/MVC/services/pte/pteCoreDependencies.js');
  assert.ok(dependencySource.includes('module.exports ='));

  AI_SERVICE_FILES.forEach((relativePath) => {
    const source = readText(relativePath);
    assert.ok(
      source.includes('./pteCoreDependencies'),
      `${relativePath} should use the package-local core dependency adapter.`
    );
    DIRECT_CORE_PATTERNS.forEach((pattern) => {
      assert.ok(
        !source.includes(pattern),
        `${relativePath} should not contain direct root core require for ${pattern}`
      );
    });
  });

  AI_CONTROLLER_FILES.forEach((relativePath) => {
    const source = readText(relativePath);
    assert.ok(
      source.includes('./pte/coreHelpers') || source.includes('./coreHelpers'),
      `${relativePath} should use the package-local controller core helper.`
    );
    assert.ok(
      source.includes('isAjax'),
      `${relativePath} should use isAjax from the package-local core helper.`
    );
    assert.ok(
      !source.includes('function isAjax('),
      `${relativePath} should not define a local isAjax helper.`
    );
    assert.ok(
      !source.includes("require('../../../../MVC/utils/paginationHelper"),
      `${relativePath} should not require paginationHelper directly.`
    );
    assert.ok(
      !source.includes('require(\"../../../../MVC/utils/paginationHelper'),
      `${relativePath} should not require paginationHelper directly.`
    );
  });

  const controllersHelperSource = readText('packages/pte/MVC/controllers/pte/coreHelpers.js');
  assert.ok(
    controllersHelperSource.includes('module.exports ='),
    'AI controller core helper should export package helper facade.'
  );
});
