const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const AI_REPOSITORY_FILES = [
  'packages/pte/MVC/repositories/pteAiProviderRepository.js',
  'packages/pte/MVC/repositories/pteAiScoringSettingRepository.js',
  'packages/pte/MVC/repositories/pteAiTokenUsageRepository.js'
];

const DIRECT_CORE_PATTERNS = [
  "'../../../../MVC/utils/queryEngine",
  '"../../../../MVC/utils/queryEngine',
  "'../../../../MVC/repositories/contracts/crudRepositoryContract",
  '"../../../../MVC/repositories/contracts/crudRepositoryContract',
  "'../../../../MVC/repositories/backend/repositoryBackendSelector",
  '"../../../../MVC/repositories/backend/repositoryBackendSelector',
  "'../../../../MVC/infrastructure/mongo/mongoConnection",
  '"../../../../MVC/infrastructure/mongo/mongoConnection',
  "'../../../../MVC/utils/idAdapter",
  '"../../../../MVC/utils/idAdapter',
  "'../../../../MVC/repositories/backend/mongoRepositoryUtils",
  '"../../../../MVC/repositories/backend/mongoRepositoryUtils',
  "'../../../../MVC/services/actionStateChangeTrackerService",
  '"../../../../MVC/services/actionStateChangeTrackerService'
];

test('AI Assist repositories use package-local repository dependency adapter', () => {
  const adapterSource = readText('packages/pte/MVC/repositories/pteAiRepositoryDependencies.js');
  assert.ok(adapterSource.includes('module.exports ='), 'AI repository dependency adapter should export helper facade.');

  AI_REPOSITORY_FILES.forEach((relativePath) => {
    const source = readText(relativePath);
    assert.ok(
      source.includes('./pteAiRepositoryDependencies'),
      `${relativePath} should import package-local dependency adapter.`
    );

    DIRECT_CORE_PATTERNS.forEach((pattern) => {
      assert.ok(
        !source.includes(pattern),
        `${relativePath} should not directly require ${pattern}`
      );
    });
  });

  assert.ok(
    adapterSource.includes('actionStateChangeTrackerService'),
    'AI repository dependency adapter should expose action state change tracker.'
  );
});
