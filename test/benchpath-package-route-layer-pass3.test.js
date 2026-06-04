const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const ROOT_ROUTES_DIR = path.join(ROOT_DIR, 'MVC/routes/benchpath');
const PACKAGE_ROUTES_DIR = path.join(ROOT_DIR, 'packages/benchpath/MVC/routes/benchpath');

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('BenchPath package pass3 mirrors root route file inventory', () => {
  const rootRoutes = listFiles(ROOT_ROUTES_DIR);
  const packageRoutes = listFiles(PACKAGE_ROUTES_DIR);

  assert.equal(rootRoutes.length, 17);
  assert.deepEqual(packageRoutes, rootRoutes);
});

test('BenchPath package pass3 manifest exposes the package route mount', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'packages/benchpath/package.manifest.json'), 'utf8'));

  assert.ok((manifest.routes || []).some((route) => (
    String(route?.method || '').toUpperCase() === 'USE'
    && route.path === '/benchpath'
    && route.router === 'MVC/routes/benchpath/benchpathMainRoute.js'
    && route.metadataOnly === false
  )));
});

test('BenchPath package route mount is no longer hardcoded after cutover', () => {
  const appSource = read(path.join(ROOT_DIR, 'app.js'));
  assert.equal(/app\.use\('\/benchpath',\s*require\('\.\/MVC\/routes\/benchpath\/benchpathMainRoute'\)\)/.test(appSource), false);
});

test('BenchPath package routes bridge shared core dependencies through resolver', () => {
  const routeFiles = listFiles(PACKAGE_ROUTES_DIR);
  const packageSources = routeFiles.map((name) => read(path.join(PACKAGE_ROUTES_DIR, name))).join('\n');

  assert.match(packageSources, /benchpathCoreModuleResolver/);
  assert.match(packageSources, /requireCoreModule\('MVC\/middleware\/authMiddleware'\)/);
  assert.match(packageSources, /requireCoreModule\('MVC\/middleware\/accessMiddleware'\)/);
  assert.match(packageSources, /requireCoreModule\('MVC\/middleware\/actionStateMiddleware'\)/);
  assert.match(packageSources, /requireCoreModule\('config\/accessConstants'\)/);
  assert.doesNotMatch(packageSources, /require\('\.\.\/\.\.\/middleware\//);
  assert.doesNotMatch(packageSources, /require\('\.\.\/\.\.\/\.\.\/config\//);
});
