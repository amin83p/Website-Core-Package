const test = require('node:test');
const assert = require('node:assert/strict');

const packageRouteService = require('../MVC/services/packageRouteService');

function createAppStub() {
  const calls = [];
  return {
    calls,
    use(...args) {
      calls.push(args);
    }
  };
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

test('route service prepares metadata-only declarations without mounting runtime routes', async () => {
  packageRouteService.resetMountedRoutes();
  const app = createAppStub();
  const summary = await packageRouteService.registerManifestRoutes({
    app,
    packageId: 'alpha',
    manifest: {
      id: 'alpha',
      name: 'Alpha',
      version: '1.0.0',
      mountPath: '/alpha',
      routes: [
        {
          id: 'alpha-root',
          method: 'USE',
          path: '/alpha',
          router: 'test/fixtures/package-route.fixture.router.js',
          metadataOnly: true
        },
        {
          id: 'alpha-info',
          method: 'GET',
          path: '/alpha/info',
          controller: 'MVC/controllers/alpha/infoController.showInfo',
          metadataOnly: false
        },
        {
          id: 'alpha-disabled',
          method: 'POST',
          path: '/alpha/disabled',
          controller: 'MVC/controllers/alpha/infoController.saveInfo',
          active: false
        }
      ]
    }
  }, { logger: makeSilentLogger() });

  assert.equal(summary.packageId, 'alpha');
  assert.equal(summary.requested, 3);
  assert.equal(summary.prepared, 2);
  assert.equal(summary.mounted, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(app.calls.length, 0);
  assert.equal(summary.results.some((row) => row.status === 'prepared'), true);
});

test('route service mounts active USE routes and avoids duplicate mount in the same process', async () => {
  packageRouteService.resetMountedRoutes();
  const app = createAppStub();

  const baseContext = {
    app,
    packageId: 'beta',
    manifest: {
      id: 'beta',
      name: 'Beta',
      version: '1.0.0',
      mountPath: '/beta',
      routes: [
        {
          id: 'beta-root',
          method: 'USE',
          path: '/beta',
          router: 'test/fixtures/package-route.fixture.router.js',
          metadataOnly: false
        }
      ]
    }
  };

  const first = await packageRouteService.registerManifestRoutes(baseContext, {
    logger: makeSilentLogger()
  });
  const second = await packageRouteService.registerManifestRoutes(baseContext, {
    logger: makeSilentLogger()
  });

  assert.equal(first.requested, 1);
  assert.equal(first.prepared, 1);
  assert.equal(first.mounted, 1);
  assert.equal(first.failed, 0);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0][0], '/beta');
  assert.equal(typeof app.calls[0][1], 'function');

  assert.equal(second.requested, 1);
  assert.equal(second.prepared, 1);
  assert.equal(second.mounted, 0);
  assert.equal(second.skipped, 1);
  assert.equal(app.calls.length, 1);
});

test('route service reports invalid declarations as failures without throwing', async () => {
  packageRouteService.resetMountedRoutes();
  const summary = await packageRouteService.registerManifestRoutes({
    packageId: 'gamma',
    manifest: {
      id: 'gamma',
      name: 'Gamma',
      version: '1.0.0',
      mountPath: '/gamma',
      routes: [
        null,
        {
          method: 'INVALID',
          path: '/gamma/invalid'
        },
        {
          method: 'USE',
          path: 'gamma-no-leading-slash',
          router: 'test/fixtures/package-route.fixture.router.js'
        }
      ]
    }
  }, { logger: makeSilentLogger() });

  assert.equal(summary.requested, 3);
  assert.equal(summary.prepared, 0);
  assert.equal(summary.mounted, 0);
  assert.equal(summary.failed, 3);
  assert.equal(summary.results.every((row) => row.status === 'failed'), true);
});
