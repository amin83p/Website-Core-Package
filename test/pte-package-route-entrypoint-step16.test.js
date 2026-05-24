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
  assert.equal(route.metadataOnly, false);
});

test('PTE current MVC route files are pure compatibility shims to package-owned routes', () => {
  const routeFiles = [
    'aiAssistRoutes.js',
    'attemptRoutes.js',
    'courseRoutes.js',
    'feedbackRoutes.js',
    'practiceRoutes.js',
    'pteMainRoute.js',
    'publicApplicantRoutes.js',
    'questionBankRoutes.js',
    'scoringRoutes.js',
    'studentRoutes.js',
    'teacherRoutes.js',
    'testRoutes.js'
  ];

  routeFiles.forEach((fileName) => {
    const moduleName = fileName.replace(/\.js$/, '');
    const expectedShim = `module.exports = require('../../../packages/pte/MVC/routes/${moduleName}');`;
    const currentSource = readText(`MVC/routes/pte/${fileName}`).trim();
    assert.equal(currentSource, expectedShim, `${fileName} should be a pure compatibility shim`);

    // eslint-disable-next-line global-require, import/no-dynamic-require
    const packageRoute = require(`../packages/pte/MVC/routes/${fileName}`);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const currentRoute = require(`../MVC/routes/pte/${fileName}`);
    assert.equal(currentRoute, packageRoute, `${fileName} should export the package-owned route module`);
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

test('PTE package route is mount-ready from manifest entries', async () => {
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
  assert.equal(summary.mounted, 1);
  assert.equal(summary.failed, 0);
  assert.equal(app.calls.length, 1);
  assert.equal(summary.results.some((row) => row.status === 'mounted'), true);
});
