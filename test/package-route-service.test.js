const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

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

test('route service can mount package-root relative router modules', async () => {
  packageRouteService.resetMountedRoutes();
  const app = createAppStub();
  const summary = await packageRouteService.registerManifestRoutes({
    app,
    packageId: 'pte',
    packageRootDir: path.resolve(__dirname, '../packages'),
    manifestPath: path.resolve(__dirname, '../packages/pte/package.manifest.json'),
    manifest: {
      id: 'pte',
      name: 'PTE',
      version: '1.0.0',
      mountPath: '/pte',
      routes: [
        {
          id: 'pte-package-root-relative-fixture',
          method: 'USE',
          path: '/pte-fixture',
          router: 'test/fixtures/package-route.fixture.router.js',
          metadataOnly: false
        }
      ]
    }
  }, { logger: makeSilentLogger() });

  assert.equal(summary.requested, 1);
  assert.equal(summary.prepared, 1);
  assert.equal(summary.mounted, 1);
  assert.equal(summary.failed, 0);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0][0], '/pte-fixture');
  assert.equal(typeof app.calls[0][1], 'function');
});

test('route service does not bridge legacy relative core imports for uploaded package modules', async () => {
  packageRouteService.resetMountedRoutes();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-route-legacy-'));
  const packageRootDir = path.join(tempRoot, 'uploads', 'packages');
  const packageDir = path.join(packageRootDir, 'pte');
  const routeDir = path.join(packageDir, 'MVC', 'routes');
  const routeFile = path.join(routeDir, 'legacyBridgeRoute.js');
  const relativeCoreImport = '../../../../../MVC/services/adminChekersService';

  try {
    await fs.mkdir(routeDir, { recursive: true });
    await fs.writeFile(routeFile, `const coreSvc = require('${relativeCoreImport}');\nmodule.exports = (req, res, next) => { if (coreSvc) return next && next(); };`, 'utf8');

    const app = createAppStub();
    const summary = await packageRouteService.registerManifestRoutes({
      app,
      packageId: 'pte',
      packageRootDir,
      manifestPath: path.join(packageDir, 'package.manifest.json'),
      manifest: {
        id: 'pte',
        name: 'PTE',
        version: '1.0.0',
        mountPath: '/pte',
        routes: [
          {
            id: 'pte-legacy-bridge',
            method: 'USE',
            path: '/pte',
            router: 'MVC/routes/legacyBridgeRoute.js',
            metadataOnly: false
          }
        ]
      }
    }, { logger: makeSilentLogger() });

    assert.equal(summary.failed, 1);
    assert.equal(summary.mounted, 0);
    assert.equal(app.calls.length, 0);
    assert.match(summary.results[0].message, /Cannot find module|Failed to load router module/i);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
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
