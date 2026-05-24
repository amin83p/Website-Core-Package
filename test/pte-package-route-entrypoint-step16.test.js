const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageModuleResolverService = require('../MVC/services/packageModuleResolverService');
const packageRouteService = require('../MVC/services/packageRouteService');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

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

test('PTE manifest points the package route declaration at the package entrypoint shim', () => {
  const manifest = JSON.parse(readText('packages/pte/package.manifest.json'));
  const route = (manifest.routes || []).find((row) => (
    String(row?.method || 'USE').toUpperCase() === 'USE'
    && row?.path === '/pte'
  ));

  assert.ok(route);
  assert.equal(route.router, 'MVC/routes/pteMainRoute.js');
  assert.equal(route.metadataOnly, true);
});

test('PTE package route entrypoint is package-owned while remaining subroute shims delegate to current MVC routes', () => {
  const packageRoute = require('../packages/pte/MVC/routes/pteMainRoute');
  const currentRoute = require('../MVC/routes/pte/pteMainRoute');

  assert.notEqual(packageRoute, currentRoute);
  assert.equal(typeof packageRoute, 'function');
  assert.equal(typeof currentRoute, 'function');

  const packageOwnedRoutes = new Set([
    'attemptRoutes.js',
    'courseRoutes.js',
    'feedbackRoutes.js',
    'practiceRoutes.js',
    'publicApplicantRoutes.js',
    'questionBankRoutes.js',
    'studentRoutes.js',
    'scoringRoutes.js',
    'teacherRoutes.js',
    'testRoutes.js'
  ]);

  [
    'aiAssistRoutes.js',
    'attemptRoutes.js',
    'courseRoutes.js',
    'feedbackRoutes.js',
    'practiceRoutes.js',
    'publicApplicantRoutes.js',
    'questionBankRoutes.js',
    'scoringRoutes.js',
    'studentRoutes.js',
    'teacherRoutes.js',
    'testRoutes.js'
  ].forEach((fileName) => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const packageSubroute = require(`../packages/pte/MVC/routes/${fileName}`);
    if (packageOwnedRoutes.has(fileName)) {
      assert.notEqual(typeof packageSubroute, 'undefined', `${fileName} should resolve to package-owned route implementation`);
      return;
    }
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const currentSubroute = require(`../MVC/routes/pte/${fileName}`);
    assert.equal(packageSubroute, currentSubroute, `${fileName} should remain a compatibility shim`);
  });
});

test('package resolver resolves the PTE route entrypoint from package root first', () => {
  const resolved = packageModuleResolverService.resolvePackageModulePath(
    'MVC/routes/pteMainRoute.js',
    {
      packageId: 'pte',
      packageRootDir: path.join(ROOT_DIR, 'packages'),
      manifestPath: path.join(ROOT_DIR, 'packages/pte/package.manifest.json')
    }
  );

  assert.equal(resolved, path.join(ROOT_DIR, 'packages/pte/MVC/routes/pteMainRoute.js'));
});

test('PTE package route remains metadata-only and is not dynamically mounted', async () => {
  packageRouteService.resetMountedRoutes();
  const manifest = JSON.parse(readText('packages/pte/package.manifest.json'));
  const app = createAppStub();
  const summary = await packageRouteService.registerManifestRoutes({
    app,
    packageId: 'pte',
    packageRootDir: path.join(ROOT_DIR, 'packages'),
    manifestPath: path.join(ROOT_DIR, 'packages/pte/package.manifest.json'),
    manifest
  }, { logger: makeSilentLogger() });

  assert.equal(summary.packageId, 'pte');
  assert.equal(summary.requested, manifest.routes.length);
  assert.equal(summary.mounted, 0);
  assert.equal(summary.failed, 0);
  assert.equal(app.calls.length, 0);
});
