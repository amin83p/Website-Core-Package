const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const pteRouteDepsPath = path.join(ROOT_DIR, 'packages/pte/MVC/routes/pteRouteDependencies.js');
const pteRouteDepsServicePath = path.join(ROOT_DIR, 'packages/pte/MVC/services/pte/pteRouteDependencies.js');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('PTE route dependency shim should consume package route dependency adapter', () => {
  const source = readText(pteRouteDepsPath);

  assert.equal(
    source.includes('require(\'../services/pte/pteRouteDependencies\')'),
    true,
    'pteRouteDependencies should import from package route dependency service.'
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

test('PTE route dependency service adapter should export route boundary hooks', () => {
  const routeServiceDeps = require(pteRouteDepsServicePath);

  assert.equal(typeof routeServiceDeps.requireAuth, 'function', 'requireAuth should be exported.');
  assert.equal(typeof routeServiceDeps.requireAccess, 'function', 'requireAccess should be exported.');
  assert.equal(typeof routeServiceDeps.trackActionState, 'function', 'trackActionState should be exported.');
  assert.equal(typeof routeServiceDeps.SECTIONS, 'object', 'SECTIONS should be exported.');
  assert.equal(typeof routeServiceDeps.OPERATIONS, 'object', 'OPERATIONS should be exported.');
});
