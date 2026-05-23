const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const packageViewAssetService = require('../MVC/services/packageViewAssetService');
const packageRegistryInstallerService = require('../MVC/services/packageRegistryInstallerService');
const packageManifestService = require('../MVC/services/packageManifestService');

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
  const settings = {
    views: initialViews
  };
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

test('view declarations append package view roots without replacing existing core view root', async () => {
  const coreViews = path.resolve(__dirname, '../MVC/views');
  const app = createAppStub(coreViews);
  const summary = await packageViewAssetService.registerManifestViews({
    app,
    packageId: 'pte',
    manifest: {
      id: 'pte',
      views: {
        id: 'pte-views',
        root: 'MVC/views',
        path: 'MVC/views/pte'
      }
    }
  }, { logger: makeSilentLogger() });

  assert.equal(summary.requested, 1);
  assert.equal(summary.prepared, 1);
  assert.equal(summary.registered, 1);
  assert.equal(summary.failed, 0);
  assert.deepEqual(app.get('views'), [
    coreViews,
    path.resolve(__dirname, '../MVC/views/pte')
  ]);
});

test('asset declarations mount static middleware and skip duplicate mounts', async () => {
  try {
    packageViewAssetService.resetMountedAssets();
    const assetRoot = path.resolve(__dirname, '../public/scripts');
    const app = createAppStub();
    const staticCalls = [];
    const staticFactory = (root) => {
      staticCalls.push(root);
      return function packageAssetStaticMiddleware(_req, _res, next) {
        if (typeof next === 'function') next();
      };
    };
    const context = {
      app,
      packageId: 'alpha',
      manifest: {
        id: 'alpha',
        assets: {
          id: 'alpha-assets',
          path: assetRoot,
          publicPath: '/package-assets/alpha'
        }
      }
    };

    const first = await packageViewAssetService.registerManifestAssets(context, {
      logger: makeSilentLogger(),
      staticFactory
    });
    const second = await packageViewAssetService.registerManifestAssets(context, {
      logger: makeSilentLogger(),
      staticFactory
    });

    assert.equal(first.requested, 1);
    assert.equal(first.prepared, 1);
    assert.equal(first.mounted, 1);
    assert.equal(first.failed, 0);
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0][0], '/package-assets/alpha');
    assert.equal(staticCalls[0], assetRoot);

    assert.equal(second.mounted, 0);
    assert.equal(second.skipped, 1);
    assert.equal(app.calls.length, 1);
  } finally {
    packageViewAssetService.resetMountedAssets();
  }
});

test('metadata-only PTE assets are prepared but not mounted', async () => {
  const raw = await fs.readFile(path.resolve(__dirname, '../packages/pte/package.manifest.json'), 'utf8');
  const manifest = packageManifestService.validatePackageManifest(JSON.parse(raw), { knownIds: [] });
  const app = createAppStub(path.resolve(__dirname, '../MVC/views'));
  const hooks = packageRegistryInstallerService.createLoaderHooks({
    logger: makeSilentLogger()
  });

  const viewSummary = await hooks.registerViews({ app, packageId: 'pte', manifest });
  const assetSummary = await hooks.registerAssets({ app, packageId: 'pte', manifest });

  assert.equal(viewSummary.packageId, 'pte');
  assert.equal(viewSummary.requested, 1);
  assert.equal(viewSummary.prepared, 1);
  assert.equal(viewSummary.failed, 0);
  assert.equal(Array.isArray(app.get('views')), true);
  assert.ok(app.get('views').some((viewRoot) => path.basename(viewRoot) === 'pte'));

  assert.equal(assetSummary.packageId, 'pte');
  assert.equal(assetSummary.requested, 1);
  assert.equal(assetSummary.prepared, 1);
  assert.equal(assetSummary.mounted, 0);
  assert.equal(assetSummary.failed, 0);
  assert.equal(app.calls.length, 0);
  assert.equal(assetSummary.results[0].metadataOnly, true);
});
