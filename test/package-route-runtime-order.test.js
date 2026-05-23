const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const express = require('express');

const packageLoaderService = require('../MVC/services/packageLoaderService');
const packageRegistryInstallerService = require('../MVC/services/packageRegistryInstallerService');
const packageRegistryService = require('../MVC/services/packageRegistryService');
const packageRouteService = require('../MVC/services/packageRouteService');

function makeSilentLogger() {
  return {
    info() {},
    warn() {},
    success() {},
    error() {},
    debug() {}
  };
}

async function withTempPackageWorkspace(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-route-order-'));
  const packageRootDir = path.join(tempRoot, 'packages');
  const registryPath = path.join(tempRoot, 'packageRegistry.test.json');
  const originalOverride = process.env.PACKAGE_REGISTRY_DATA_PATH;
  process.env.PACKAGE_REGISTRY_DATA_PATH = registryPath;

  try {
    await fs.mkdir(packageRootDir, { recursive: true });
    await callback({ packageRootDir });
  } finally {
    if (originalOverride === undefined) delete process.env.PACKAGE_REGISTRY_DATA_PATH;
    else process.env.PACKAGE_REGISTRY_DATA_PATH = originalOverride;
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function writeManifest(packageRootDir, packageId, payload) {
  const dir = path.join(packageRootDir, packageId);
  await fs.mkdir(dir, { recursive: true });
  const manifestPath = path.join(dir, 'package.manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(payload, null, 2), 'utf8');
  return manifestPath;
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('package-loaded USE routes are reachable before the final 404 fallback', async () => {
  await withTempPackageWorkspace(async ({ packageRootDir }) => {
    packageRouteService.resetMountedRoutes();
    await writeManifest(packageRootDir, 'runtime-order', {
      id: 'runtime-order',
      name: 'Runtime Order',
      version: '1.0.0',
      mountPath: '/runtime-package',
      routes: [
        {
          id: 'runtime-package-root',
          method: 'USE',
          path: '/runtime-package',
          router: 'test/fixtures/package-route.fixture.responding-router.js',
          metadataOnly: false,
          active: true
        }
      ]
    });
    await packageRegistryService.upsertPackageRegistry({
      packageId: 'runtime-order',
      enabled: true,
      installStatus: 'enabled'
    }, { backendMode: 'json' });

    const app = express();
    const summary = await packageLoaderService.loadEnabledPackages({
      app,
      backendMode: 'json',
      packageRootDir,
      hooks: packageRegistryInstallerService.createLoaderHooks({
        backendMode: 'json',
        logger: makeSilentLogger()
      }),
      logger: makeSilentLogger()
    });

    app.use((_req, res) => {
      res.status(404).type('text/plain').send('not found');
    });

    const { server, baseUrl } = await listen(app);
    try {
      const mounted = await fetch(`${baseUrl}/runtime-package/ping`);
      assert.equal(mounted.status, 200);
      assert.deepEqual(await mounted.json(), {
        ok: true,
        source: 'package-route-fixture'
      });

      const missing = await fetch(`${baseUrl}/missing-package-route`);
      assert.equal(missing.status, 404);
      assert.equal(await missing.text(), 'not found');
      assert.equal(summary.enabledCount, 1);
      assert.equal(summary.loadedCount, 1);
    } finally {
      await closeServer(server);
      packageRouteService.resetMountedRoutes();
    }
  });
});

test('app startup registers 404 after package loader runtime route registration', async () => {
  const appSource = await fs.readFile(path.join(__dirname, '../app.js'), 'utf8');
  const loaderIndex = appSource.indexOf('packageLoaderService.loadEnabledPackages');
  const notFoundIndex = appSource.indexOf('registerNotFoundHandler();');

  assert.notEqual(loaderIndex, -1);
  assert.notEqual(notFoundIndex, -1);
  assert.ok(
    notFoundIndex > loaderIndex,
    'registerNotFoundHandler() must run after packageLoaderService.loadEnabledPackages(...)'
  );
});

test('PTE manifest remains metadata-only while hardcoded /pte routing is active', async () => {
  const raw = await fs.readFile(path.join(__dirname, '../packages/pte/package.manifest.json'), 'utf8');
  const manifest = JSON.parse(raw);
  const pteRuntimeRoutes = (manifest.routes || []).filter((row) => (
    String(row?.method || 'USE').toUpperCase() === 'USE'
    && row?.path === '/pte'
  ));

  assert.equal(pteRuntimeRoutes.length, 1);
  assert.equal(pteRuntimeRoutes[0].metadataOnly, true);
});
