const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageManifestService = require('../MVC/services/packageManifestService');
const packageRegistryInstallerService = require('../MVC/services/packageRegistryInstallerService');

const ROOT_DIR = path.resolve(__dirname, '..');
const CURRENT_VIEW_ROOT = path.join(ROOT_DIR, 'MVC/views/pte');
const PACKAGE_VIEW_ROOT = path.join(ROOT_DIR, 'packages/pte/MVC/views/pte');
const CURRENT_SCRIPT = path.join(ROOT_DIR, 'public/scripts/ptePracticeCoachRules.js');
const PACKAGE_SCRIPT = path.join(ROOT_DIR, 'packages/pte/public/scripts/ptePracticeCoachRules.js');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function normalizePackageViewForComparison(source = '') {
  return String(source || '')
    .replaceAll(
      "include('../../../../../../MVC/views/partials/",
      "include('../../partials/"
    );
}

function listFiles(rootDir) {
  const found = [];

  function visit(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        return;
      }
      if (entry.isFile()) {
        found.push(path.relative(rootDir, fullPath).replace(/\\/g, '/'));
      }
    });
  }

  visit(rootDir);
  return found.sort();
}

function makeSilentLogger() {
  return {
    info() {},
    warn() {},
    success() {},
    error() {},
    debug() {}
  };
}

function createAppStub(initialViews = '') {
  const settings = { views: initialViews };
  const calls = [];
  return {
    calls,
    get(key) {
      return settings[key];
    },
    set(key, value) {
      settings[key] = value;
    },
    use(...args) {
      calls.push(args);
    }
  };
}

test('PTE package view tree mirrors current PTE views', () => {
  const currentFiles = listFiles(CURRENT_VIEW_ROOT);
  const packageFiles = listFiles(PACKAGE_VIEW_ROOT);

  assert.deepEqual(packageFiles, currentFiles);
  currentFiles.forEach((relativeFile) => {
    assert.equal(
      normalizePackageViewForComparison(readText(path.join(PACKAGE_VIEW_ROOT, relativeFile))),
      readText(path.join(CURRENT_VIEW_ROOT, relativeFile)),
      `${relativeFile} should match the current PTE view copy`
    );
  });
});

test('PTE package public script mirrors current PTE public script', () => {
  assert.equal(fs.existsSync(PACKAGE_SCRIPT), true);
  assert.equal(readText(PACKAGE_SCRIPT), readText(CURRENT_SCRIPT));
});

test('PTE manifest points view and asset declarations at package-owned paths', () => {
  const manifest = packageManifestService.validatePackageManifest(
    JSON.parse(readText(path.join(ROOT_DIR, 'packages/pte/package.manifest.json'))),
    { knownIds: [] }
  );

  assert.equal(manifest.views.path, 'packages/pte/MVC/views');
  assert.equal(manifest.assets.path, 'packages/pte/public/scripts');
  assert.equal(manifest.assets.publicPath, '/scripts');
  assert.equal(manifest.assets.metadataOnly, true);
});

test('PTE package view root registers while package assets remain metadata-only', async () => {
  const manifest = packageManifestService.validatePackageManifest(
    JSON.parse(readText(path.join(ROOT_DIR, 'packages/pte/package.manifest.json'))),
    { knownIds: [] }
  );
  const app = createAppStub(path.join(ROOT_DIR, 'MVC/views'));
  const hooks = packageRegistryInstallerService.createLoaderHooks({
    logger: makeSilentLogger()
  });

  const viewSummary = await hooks.registerViews({ app, packageId: 'pte', manifest });
  const assetSummary = await hooks.registerAssets({ app, packageId: 'pte', manifest });

  assert.equal(viewSummary.failed, 0);
  assert.equal(viewSummary.registered, 1);
  assert.ok(app.get('views').some((viewRoot) => path.resolve(viewRoot) === path.join(ROOT_DIR, 'packages/pte/MVC/views')));

  assert.equal(assetSummary.failed, 0);
  assert.equal(assetSummary.prepared, 1);
  assert.equal(assetSummary.mounted, 0);
  assert.equal(assetSummary.results[0].metadataOnly, true);
  assert.equal(app.calls.length, 0);
});
