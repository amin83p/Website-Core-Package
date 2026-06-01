const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const packageModuleResolverService = require('../MVC/services/packageModuleResolverService');

async function withTempPackageFixture(run) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-module-resolver-'));
  const packageRootDir = path.join(tempRoot, 'packages');
  const packageRoot = path.join(packageRootDir, 'pte');
  const manifestPath = path.join(packageRoot, 'package.manifest.json');
  try {
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify({ id: 'pte', name: 'PTE', version: '1.0.0', mountPath: '/pte' }), 'utf8');
    await run({
      tempRoot,
      packageRootDir,
      packageRoot,
      context: {
        packageId: 'pte',
        packageRootDir,
        manifestPath
      }
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

test('module resolver maps package-root relative route paths to package-owned routes', async () => {
  await withTempPackageFixture(async ({ packageRoot, context }) => {
    const routePath = path.join(packageRoot, 'MVC/routes/pteMainRoute.js');
    await fs.mkdir(path.dirname(routePath), { recursive: true });
    await fs.writeFile(routePath, 'module.exports = function pteMainRoute() {};', 'utf8');

    const resolved = packageModuleResolverService.resolvePackageModulePath(
      'MVC/routes/pteMainRoute.js',
      context
    );

    assert.equal(resolved, routePath);
  });
});

test('module resolver maps package-root relative controller paths to package-owned controllers', async () => {
  await withTempPackageFixture(async ({ packageRoot, context }) => {
    const controllerPath = path.join(packageRoot, 'MVC/controllers/infoController.js');
    await fs.mkdir(path.dirname(controllerPath), { recursive: true });
    await fs.writeFile(controllerPath, 'module.exports = {};', 'utf8');

    const resolved = packageModuleResolverService.resolvePackageModulePath(
      'MVC/controllers/infoController.js',
      context
    );

    assert.equal(resolved, controllerPath);
  });
});

test('module resolver supports package-root relative fixture paths', async () => {
  await withTempPackageFixture(async ({ packageRoot, context }) => {
    const fixturePath = path.join(packageRoot, 'test/fixtures/package-route.fixture.router.js');
    await fs.mkdir(path.dirname(fixturePath), { recursive: true });
    await fs.writeFile(fixturePath, 'module.exports = function packageFixtureRouter() {};', 'utf8');

    const resolved = packageModuleResolverService.resolvePackageModulePath(
      'test/fixtures/package-route.fixture.router.js',
      context
    );

    assert.equal(resolved, fixturePath);
  });
});

test('module resolver supports configured package roots outside the project root', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-module-resolver-ext-'));
  try {
    const packageRoot = path.join(tempRoot, 'packages', 'external-pkg');
    const routePath = path.join(packageRoot, 'routes', 'externalRouter.js');
    const manifestPath = path.join(packageRoot, 'package.manifest.json');
    await fs.mkdir(path.dirname(routePath), { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify({ id: 'external-pkg' }), 'utf8');
    await fs.writeFile(routePath, 'module.exports = function externalRouter(_req, _res, next) { if (next) next(); };', 'utf8');

    const resolved = packageModuleResolverService.resolvePackageModulePath(
      'routes/externalRouter.js',
      {
        packageId: 'external-pkg',
        packageRootDir: path.join(tempRoot, 'packages'),
        manifestPath
      }
    );

    assert.equal(resolved, routePath);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test('module resolver rejects parent traversal in package declarations', () => {
  assert.throws(() => {
    packageModuleResolverService.resolvePackageModulePath('../app.js', {
      packageId: 'pte',
      packageRootDir: path.join(process.cwd(), 'packages'),
      manifestPath: path.join(process.cwd(), 'packages/pte/package.manifest.json')
    });
  }, /parent traversal/i);
});
