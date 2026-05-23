const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('AI Assist provider key decrypt flow uses repository dependency adapter boundary', () => {
  const serviceSource = readText('packages/pte/MVC/services/pte/pteAiProviderDataService.js');
  const repositorySource = readText('packages/pte/MVC/repositories/pteAiProviderRepository.js');
  const dependencySource = readText('packages/pte/MVC/repositories/pteAiRepositoryDependencies.js');

  assert.ok(
    dependencySource.includes('decrypt'),
    'AI Assist repository dependency adapter should expose decrypt.'
  );

  assert.ok(
    repositorySource.includes('getDecryptedApiKeyById('),
    'AI provider repository should expose getDecryptedApiKeyById().'
  );

  assert.ok(
    repositorySource.includes('resolveApiKeyFromProviderRecord'),
    'Repository should include provider record decryption helper.'
  );

  assert.ok(
    serviceSource.includes('pteAiProviderRepository.getDecryptedApiKeyById'),
    'AI provider data service should load API keys through repository API.'
  );

  assert.ok(
    !serviceSource.includes("require('../../models/pte/pteAiProviderModel')"),
    'AI provider data service should not directly require core PTE provider model.'
  );

  assert.ok(
    !repositorySource.includes("require('../../../../MVC/utils/encyptors')"),
    'AI provider repository should receive decrypt via adapter, not via direct core import.'
  );
});
