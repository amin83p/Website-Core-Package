const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');

const serviceShimRows = [
  {
    rootFile: 'MVC/services/pte/pteAiProviderDataService.js',
    packageFile: 'packages/pte/MVC/services/pte/pteAiProviderDataService.js',
    expectedRequire: '../../../packages/pte/MVC/services/pte/pteAiProviderDataService'
  },
  {
    rootFile: 'MVC/services/pte/pteAiScoringSettingsDataService.js',
    packageFile: 'packages/pte/MVC/services/pte/pteAiScoringSettingsDataService.js',
    expectedRequire: '../../../packages/pte/MVC/services/pte/pteAiScoringSettingsDataService'
  },
  {
    rootFile: 'MVC/services/pte/pteAiTokenUsageDataService.js',
    packageFile: 'packages/pte/MVC/services/pte/pteAiTokenUsageDataService.js',
    expectedRequire: '../../../packages/pte/MVC/services/pte/pteAiTokenUsageDataService'
  },
  {
    rootFile: 'MVC/services/pte/ai/aiProviderService.js',
    packageFile: 'packages/pte/MVC/services/pte/ai/aiProviderService.js',
    expectedRequire: '../../../../packages/pte/MVC/services/pte/ai/aiProviderService'
  },
  {
    rootFile: 'MVC/services/pte/ai/providers/anthropicService.js',
    packageFile: 'packages/pte/MVC/services/pte/ai/providers/anthropicService.js',
    expectedRequire: '../../../../../packages/pte/MVC/services/pte/ai/providers/anthropicService'
  },
  {
    rootFile: 'MVC/services/pte/ai/providers/azureOpenAIService.js',
    packageFile: 'packages/pte/MVC/services/pte/ai/providers/azureOpenAIService.js',
    expectedRequire: '../../../../../packages/pte/MVC/services/pte/ai/providers/azureOpenAIService'
  },
  {
    rootFile: 'MVC/services/pte/ai/providers/googleGeminiService.js',
    packageFile: 'packages/pte/MVC/services/pte/ai/providers/googleGeminiService.js',
    expectedRequire: '../../../../../packages/pte/MVC/services/pte/ai/providers/googleGeminiService'
  },
  {
    rootFile: 'MVC/services/pte/ai/providers/googleVertexService.js',
    packageFile: 'packages/pte/MVC/services/pte/ai/providers/googleVertexService.js',
    expectedRequire: '../../../../../packages/pte/MVC/services/pte/ai/providers/googleVertexService'
  },
  {
    rootFile: 'MVC/services/pte/ai/providers/openaiService.js',
    packageFile: 'packages/pte/MVC/services/pte/ai/providers/openaiService.js',
    expectedRequire: '../../../../../packages/pte/MVC/services/pte/ai/providers/openaiService'
  }
];

const repositoryShimRows = [
  {
    rootFile: 'MVC/repositories/pteAiProviderRepository.js',
    packageFile: 'packages/pte/MVC/repositories/pteAiProviderRepository.js',
    expectedRequire: '../../packages/pte/MVC/repositories/pteAiProviderRepository'
  },
  {
    rootFile: 'MVC/repositories/pteAiScoringSettingRepository.js',
    packageFile: 'packages/pte/MVC/repositories/pteAiScoringSettingRepository.js',
    expectedRequire: '../../packages/pte/MVC/repositories/pteAiScoringSettingRepository'
  },
  {
    rootFile: 'MVC/repositories/pteAiTokenUsageRepository.js',
    packageFile: 'packages/pte/MVC/repositories/pteAiTokenUsageRepository.js',
    expectedRequire: '../../packages/pte/MVC/repositories/pteAiTokenUsageRepository'
  }
];

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8').trim();
}

test('root PTE AI Assist services are pure compatibility shims to package-owned services', () => {
  serviceShimRows.forEach((row) => {
    const expectedShim = `module.exports = require('${row.expectedRequire}');`;
    assert.equal(readText(row.rootFile), expectedShim, `${row.rootFile} should delegate to package service`);
  });
});

test('root PTE AI Assist service shims export package-owned service modules', () => {
  serviceShimRows.forEach((row) => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const rootService = require(path.join(ROOT_DIR, row.rootFile));
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const packageService = require(path.join(ROOT_DIR, row.packageFile));

    assert.equal(rootService, packageService, `${row.rootFile} should export ${row.packageFile}`);
  });
});

test('root PTE AI Assist repositories are pure compatibility shims to package-owned repositories', () => {
  repositoryShimRows.forEach((row) => {
    const expectedShim = `module.exports = require('${row.expectedRequire}');`;
    assert.equal(readText(row.rootFile), expectedShim, `${row.rootFile} should delegate to package repository`);
  });
});

test('root PTE AI Assist repository shims export package-owned repository modules', () => {
  repositoryShimRows.forEach((row) => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const rootRepository = require(path.join(ROOT_DIR, row.rootFile));
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const packageRepository = require(path.join(ROOT_DIR, row.packageFile));

    assert.equal(rootRepository, packageRepository, `${row.rootFile} should export ${row.packageFile}`);
  });
});
