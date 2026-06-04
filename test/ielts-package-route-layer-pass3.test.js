const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const ROUTES_DIR = path.join(ROOT_DIR, 'packages/ielts/MVC/routes');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('IELTS package pass3 mirrors package route surface', () => {
  const mainRoute = path.join(ROUTES_DIR, 'ieltsMainRoute.js');
  const routes = path.join(ROUTES_DIR, 'ieltsRoutes.js');

  assert.equal(fs.existsSync(mainRoute), true);
  assert.equal(fs.existsSync(routes), true);

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'packages/ielts/package.manifest.json'), 'utf8'));
  assert.ok((manifest.routes || []).some((route) => (
    String(route?.method || '').toUpperCase() === 'USE'
    && route.path === '/ielts'
    && route.router === 'MVC/routes/ieltsMainRoute.js'
    && route.metadataOnly === false
  )));
});

test('IELTS package pass3 route copies bridge shared core dependencies through resolver', () => {
  const mainSource = read(path.join(ROUTES_DIR, 'ieltsMainRoute.js'));
  const routesSource = read(path.join(ROUTES_DIR, 'ieltsRoutes.js'));

  assert.match(mainSource, /ieltsCoreModuleResolver/);
  assert.match(routesSource, /ieltsCoreModuleResolver/);
  assert.match(routesSource, /requireCoreModule\('MVC\/controllers\/ielts\/ieltsController'\)/);
  assert.match(routesSource, /requireCoreModule\('MVC\/middleware\/authMiddleware'\)/);
  assert.doesNotMatch(routesSource, /require\('\.\.\/\.\.\/controllers\/ielts\//);
  assert.doesNotMatch(routesSource, /require\('\.\.\/\.\.\/middleware\//);
});

test('IELTS package pass3 package main route can be required while controllers remain root-active', () => {
  const router = require('../packages/ielts/MVC/routes/ieltsMainRoute');
  assert.equal(typeof router, 'function');
});
