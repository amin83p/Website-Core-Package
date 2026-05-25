const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CURRENT_SERVICE_ROOT = path.join(ROOT_DIR, 'MVC/services/pte');
const PACKAGE_SERVICE_ROOT = path.join(ROOT_DIR, 'packages/pte/MVC/services/pte');

function listJsFiles(rootDir) {
  const found = [];

  function visit(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        return;
      }
      if (entry.isFile() && entry.name.endsWith('.js')) {
        found.push(path.relative(rootDir, fullPath).replace(/\\/g, '/'));
      }
    });
  }

  visit(rootDir);
  return found.sort();
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function expectedShimRequirePath(relativeFile) {
  const packageShimPath = path.join(PACKAGE_SERVICE_ROOT, relativeFile);
  const currentServicePath = path.join(CURRENT_SERVICE_ROOT, relativeFile).replace(/\.js$/, '');
  let relativeRequirePath = path.relative(path.dirname(packageShimPath), currentServicePath).replace(/\\/g, '/');
  if (!relativeRequirePath.startsWith('.')) {
    relativeRequirePath = `./${relativeRequirePath}`;
  }
  return relativeRequirePath;
}

const packageOwnedServices = new Set([
  'questionTypeRegistry.js',
  'pteScoringRubricRegistry.js',
  'pteAiProviderDataService.js',
  'pteAiScoringSettingsDataService.js',
  'pteAiTokenUsageDataService.js',
  'ai/aiProviderService.js',
  'ai/providers/openaiService.js',
  'ai/providers/azureOpenAIService.js',
  'ai/providers/googleGeminiService.js',
  'ai/providers/googleVertexService.js',
  'ai/providers/anthropicService.js'
]);

const packageOnlyServiceAdapters = new Set([
  'pteCoreDependencies.js',
  'pteCoreDependenciesCoreAdapter.js',
  'pteRouteCoreDependencies.js',
  'pteRouteDependencies.js',
  'pteUploadCategoryRegistration.js',
  'pteUploadContextDependencies.js'
]);

test('PTE package service shims mirror the current recursive PTE service tree', () => {
  const currentFiles = listJsFiles(CURRENT_SERVICE_ROOT);
  const packageFiles = listJsFiles(PACKAGE_SERVICE_ROOT)
    .filter((relativeFile) => !packageOnlyServiceAdapters.has(relativeFile));

  assert.deepEqual(packageFiles, currentFiles);
});

test('PTE package service shims delegate to current MVC service modules', () => {
  listJsFiles(CURRENT_SERVICE_ROOT).forEach((relativeFile) => {
    if (packageOwnedServices.has(relativeFile)) {
      return;
    }

    const packageShimPath = path.join(PACKAGE_SERVICE_ROOT, relativeFile);
    const source = readText(packageShimPath);
    const expectedRequire = expectedShimRequirePath(relativeFile);

    assert.ok(
      source.includes(`require('${expectedRequire}')`),
      `${relativeFile} should delegate to ${expectedRequire}`
    );
  });
});

test('PTE package-owned AI Assist services are not simple shims', () => {
  packageOwnedServices.forEach((relativeFile) => {
    const packageServicePath = path.join(PACKAGE_SERVICE_ROOT, relativeFile);
    const source = readText(packageServicePath);
    const expectedRequire = expectedShimRequirePath(relativeFile);

    assert.ok(
      !source.includes(`require('${expectedRequire}')`),
      `${relativeFile} should not delegate to ${expectedRequire}`
    );
  });
});

test('representative PTE package service shims export the current services', () => {
  [
    'ptePublicJoinService.js',
    'pteScoringEngineService.js'
  ].forEach((relativeFile) => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const packageService = require(path.join(PACKAGE_SERVICE_ROOT, relativeFile));
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const currentService = require(path.join(CURRENT_SERVICE_ROOT, relativeFile));
    assert.equal(packageService, currentService, `${relativeFile} should export the current service`);
  });
});
