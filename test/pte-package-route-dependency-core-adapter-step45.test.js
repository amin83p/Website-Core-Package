const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const pteRouteDepsServicePath = path.join(ROOT_DIR, 'packages/pte/MVC/services/pte/pteRouteDependencies.js');
const pteRouteCoreDepsPath = path.join(ROOT_DIR, 'packages/pte/MVC/services/pte/pteRouteCoreDependencies.js');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('PTE route dependency service should be a package adapter', () => {
  const source = readText(pteRouteDepsServicePath);

  assert.equal(
    source.includes('./pteRouteCoreDependencies'),
    true,
    'pteRouteDependencies should delegate to local route core adapter file.'
  );
  assert.equal(
    source.includes('../../../../MVC/middleware/authMiddleware'),
    false,
    'pteRouteDependencies should not import auth middleware directly from core.'
  );
  assert.equal(
    source.includes('../../../../MVC/middleware/accessMiddleware'),
    false,
    'pteRouteDependencies should not import access middleware directly from core.'
  );
  assert.equal(
    source.includes('../../../../MVC/middleware/actionStateMiddleware'),
    false,
    'pteRouteDependencies should not import action state middleware directly from core.'
  );
  assert.equal(
    source.includes('../../../../config/accessConstants'),
    false,
    'pteRouteDependencies should not import access constants directly from core config.'
  );
});

test('PTE route core adapter should re-export route boundary hooks from core', () => {
  const source = readText(pteRouteCoreDepsPath);
  const routeDeps = require(pteRouteDepsServicePath);

  assert.equal(source.includes('require(\'../../../../MVC/middleware/authMiddleware\')'), true);
  assert.equal(source.includes('require(\'../../../../MVC/middleware/accessMiddleware\')'), true);
  assert.equal(source.includes('require(\'../../../../MVC/middleware/actionStateMiddleware\')'), true);
  assert.equal(source.includes('require(\'../../../../config/accessConstants\')'), true);
  assert.equal(typeof routeDeps.requireAuth, 'function', 'requireAuth should be exported.');
  assert.equal(typeof routeDeps.requireAccess, 'function', 'requireAccess should be exported.');
  assert.equal(typeof routeDeps.trackActionState, 'function', 'trackActionState should be exported.');
  assert.equal(typeof routeDeps.SECTIONS, 'object', 'SECTIONS should be exported.');
  assert.equal(typeof routeDeps.OPERATIONS, 'object', 'OPERATIONS should be exported.');
});
