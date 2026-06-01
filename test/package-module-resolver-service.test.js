const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const packageModuleResolverService = require('../MVC/services/packageModuleResolverService');

const ROOT_DIR = path.resolve(__dirname, '..');
const PTE_CONTEXT = {
  packageId: 'pte',
  packageRootDir: path.join(ROOT_DIR, 'packages'),
  manifestPath: path.join(ROOT_DIR, 'packages/pte/package.manifest.json')
};

test('module resolver resolves canonical package route paths', () => {
  const resolved = packageModuleResolverService.resolvePackageModulePath(
    'MVC/routes/pteMainRoute.js',
    PTE_CONTEXT
  );

  assert.equal(resolved, path.join(ROOT_DIR, 'packages/pte/MVC/routes/pteMainRoute.js'));
});

test('module resolver resolves canonical package controller paths', () => {
  const resolved = packageModuleResolverService.resolvePackageModulePath(
    'MVC/controllers/infoController.js',
    PTE_CONTEXT
  );

  assert.equal(resolved, path.join(ROOT_DIR, 'packages/pte/MVC/controllers/infoController.js'));
});

test('module resolver supports future package-root relative route paths', () => {
  const resolved = packageModuleResolverService.resolvePackageModulePath(
    'test/fixtures/package-route.fixture.router.js',
    PTE_CONTEXT
  );

  assert.equal(resolved, path.join(ROOT_DIR, 'packages/pte/test/fixtures/package-route.fixture.router.js'));
});

test('module resolver supports configured package roots outside the project root', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pkg-module-resolver-'));
  try {
    const packageRoot = path.join(tempRoot, 'packages', 'external-pkg');
    const routePath = path.join(packageRoot, 'routes', 'externalRouter.js');
    await fs.mkdir(path.dirname(routePath), { recursive: true });
    await fs.writeFile(routePath, 'module.exports = function externalRouter(_req, _res, next) { if (next) next(); };', 'utf8');

    const resolved = packageModuleResolverService.resolvePackageModulePath(
      'routes/externalRouter.js',
      {
        packageId: 'external-pkg',
        packageRootDir: path.join(tempRoot, 'packages'),
        manifestPath: path.join(packageRoot, 'package.manifest.json')
      }
    );

    assert.equal(resolved, routePath);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test('module resolver rejects parent traversal in package declarations', () => {
  assert.throws(() => {
    packageModuleResolverService.resolvePackageModulePath('../app.js', PTE_CONTEXT);
  }, /parent traversal/i);
});
