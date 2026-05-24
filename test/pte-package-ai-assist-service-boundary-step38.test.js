const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function assertNoCorePath(source, fileLabel, patterns) {
  patterns.forEach((pattern) => {
    assert.ok(!source.includes(pattern), `${fileLabel} should not import core via ${pattern}`);
  });
}

const FILES = {
  providerService: 'packages/pte/MVC/services/pte/pteAiProviderDataService.js',
  scoringSettingsService: 'packages/pte/MVC/services/pte/pteAiScoringSettingsDataService.js',
  tokenUsageService: 'packages/pte/MVC/services/pte/pteAiTokenUsageDataService.js',
  aiProviderFacade: 'packages/pte/MVC/services/pte/ai/aiProviderService.js',
  providers: [
    'packages/pte/MVC/services/pte/ai/providers/openaiService.js',
    'packages/pte/MVC/services/pte/ai/providers/googleGeminiService.js',
    'packages/pte/MVC/services/pte/ai/providers/googleVertexService.js',
    'packages/pte/MVC/services/pte/ai/providers/azureOpenAIService.js',
    'packages/pte/MVC/services/pte/ai/providers/anthropicService.js'
  ]
};

const CORE_IMPORT_PATTERNS = [
  '../../../../../MVC',
  '../../../../MVC',
  '../../../../../config',
  '../../../../config',
  '/package'
];

test('AI Assist service boundary keeps module-level dependencies local', () => {
  const providerSource = readText(FILES.providerService);
  const scoringSource = readText(FILES.scoringSettingsService);
  const usageSource = readText(FILES.tokenUsageService);

  assert.ok(
    providerSource.includes("require('./pteCoreDependencies')"),
    'AI provider data service should import package-local core dependency adapter.'
  );
  assert.ok(
    scoringSource.includes("require('./pteCoreDependencies')"),
    'AI scoring settings service should import package-local core dependency adapter.'
  );
  assert.ok(
    usageSource.includes("require('./pteCoreDependencies')"),
    'AI token usage service should import package-local core dependency adapter.'
  );

  assertNoCorePath(providerSource, FILES.providerService, CORE_IMPORT_PATTERNS);
  assertNoCorePath(scoringSource, FILES.scoringSettingsService, CORE_IMPORT_PATTERNS);
  assertNoCorePath(usageSource, FILES.tokenUsageService, CORE_IMPORT_PATTERNS);

  assert.ok(
    providerSource.includes('getDecryptedApiKeyById'),
    'AI provider service should request decrypted API key through repository API.'
  );
});

test('AI Assist runtime service and providers do not import core project paths', () => {
  const aiProviderFacadeSource = readText(FILES.aiProviderFacade);
  assertNoCorePath(aiProviderFacadeSource, FILES.aiProviderFacade, CORE_IMPORT_PATTERNS);
  assert.ok(
    aiProviderFacadeSource.includes("require('./providers"),
    'AI provider facade should reference package-local provider implementations.'
  );

  FILES.providers.forEach((relativePath) => {
    const source = readText(relativePath);
    assertNoCorePath(source, relativePath, CORE_IMPORT_PATTERNS);
    assert.ok(
      source.includes('fetch('),
      `${relativePath} should remain self-contained runtime logic using fetch API.`
    );
  });
});
