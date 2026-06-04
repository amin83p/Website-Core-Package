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

test('BenchPath package pass3 mirrors root route files', () => {
  const rootRoutes = listFiles(ROOT_ROUTES_DIR);
  const packageRoutes = listFiles(PACKAGE_ROUTES_DIR);

  assert.equal(rootRoutes.length, 17);
  assert.deepEqual(packageRoutes, rootRoutes);

  rootRoutes.forEach((name) => {
    assert.equal(
      read(path.join(PACKAGE_ROUTES_DIR, name)),
      read(path.join(ROOT_ROUTES_DIR, name)),
      `${name} should match the root-active BenchPath route`
    );
  });
});

test('BenchPath package pass3 manifest exposes the package route mount', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'packages/benchpath/package.manifest.json'), 'utf8'));

  assert.ok((manifest.routes || []).some((route) => (
    String(route?.method || '').toUpperCase() === 'USE'
    && route.path === '/benchpath'
    && route.router === 'MVC/routes/benchpathMainRoute.js'
    && route.metadataOnly === false
  )));
});

test('BenchPath package pass3 keeps root app mount active before cutover', () => {
  const appSource = read(path.join(ROOT_DIR, 'app.js'));
  assert.match(appSource, /app\.use\('\/benchpath', require\('\.\/MVC\/routes\/benchpath\/benchpathMainRoute'\)\)/);
});
