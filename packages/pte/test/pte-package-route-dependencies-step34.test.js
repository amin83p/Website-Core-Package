const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const pteRouteDepsPath = path.join(ROOT_DIR, 'packages/pte/MVC/routes/pteRouteDependencies.js');
const pteMainRoutePath = path.join(ROOT_DIR, 'packages/pte/MVC/routes/pteMainRoute.js');
const aiAssistRoutePath = path.join(ROOT_DIR, 'packages/pte/MVC/routes/aiAssistRoutes.js');

function read(relativePath) {
  return fs.readFileSync(relativePath, 'utf8');
}

test('PTE route dependencies shim exists', () => {
  assert.equal(fs.existsSync(pteRouteDepsPath), true, 'pteRouteDependencies.js should exist.');
});

test('PTE main route should use package-local route dependency shim', () => {
  const source = read(pteMainRoutePath);
  assert.equal(
    source.includes('require(\'./pteRouteDependencies\')'),
    true,
    'pteMainRoute should import requireAuth/requireAccess/trackActionState/sections from local dependency shim.'
  );
  assert.equal(
    source.includes('../../../../MVC/middleware/authMiddleware'),
    false,
    'pteMainRoute should no longer import auth middleware directly from core.'
  );
  assert.equal(
    source.includes('../../../../MVC/middleware/accessMiddleware'),
    false,
    'pteMainRoute should no longer import access middleware directly from core.'
  );
  assert.equal(
    source.includes('../../../../MVC/middleware/actionStateMiddleware'),
    false,
    'pteMainRoute should no longer import action state middleware directly from core.'
  );
  assert.equal(
    source.includes('../../../../config/accessConstants'),
    false,
    'pteMainRoute should no longer import access constants directly from core.'
  );
});

test('PTE AI Assist route should use package-local route dependency shim', () => {
  const source = read(aiAssistRoutePath);
  assert.equal(
    source.includes('require(\'./pteRouteDependencies\')'),
    true,
    'aiAssistRoutes should import requireAuth/requireAccess/trackActionState/sections from local dependency shim.'
  );
  assert.equal(
    source.includes('../../../../MVC/middleware/authMiddleware'),
    false,
    'aiAssistRoutes should no longer import auth middleware directly from core.'
  );
  assert.equal(
    source.includes('../../../../MVC/middleware/accessMiddleware'),
    false,
    'aiAssistRoutes should no longer import access middleware directly from core.'
  );
  assert.equal(
    source.includes('../../../../MVC/middleware/actionStateMiddleware'),
    false,
    'aiAssistRoutes should no longer import action state middleware directly from core.'
  );
  assert.equal(
    source.includes('../../../../config/accessConstants'),
    false,
    'aiAssistRoutes should no longer import access constants directly from core.'
  );
});

test('PTE route dependency shim exposes all required route boundary hooks', () => {
  const deps = require(pteRouteDepsPath);
  assert.equal(typeof deps.requireAuth, 'function', 'requireAuth should be exposed.');
  assert.equal(typeof deps.requireAccess, 'function', 'requireAccess should be exposed.');
  assert.equal(typeof deps.trackActionState, 'function', 'trackActionState should be exposed.');
  assert.equal(!!deps.SECTIONS, true, 'SECTIONS should be exposed.');
  assert.equal(!!deps.OPERATIONS, true, 'OPERATIONS should be exposed.');
});
