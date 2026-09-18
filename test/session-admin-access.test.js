const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT_DIR = path.resolve(__dirname, '..');
const ROUTES_PATH = path.join(ROOT_DIR, 'MVC/routes/sessionRoutes.js');
const CONTROLLER_PATH = path.join(ROOT_DIR, 'MVC/controllers/sessionController.js');
const DATA_SERVICE_PATH = path.join(ROOT_DIR, 'MVC/services/dataService.js');
const ADMIN_AUTH_PATH = path.join(ROOT_DIR, 'MVC/services/adminAuthorityService.js');
const SESSION_SERVICE_PATH = path.join(ROOT_DIR, 'MVC/services/SessionService.js');

function stubModule(modulePath, exportsValue, originals) {
  const resolved = require.resolve(modulePath);
  if (!originals.has(resolved)) originals.set(resolved, require.cache[resolved]);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue
  };
}

function restoreModules(originals, extraPaths = []) {
  extraPaths.forEach((modulePath) => delete require.cache[require.resolve(modulePath)]);
  originals.forEach((entry, resolved) => {
    if (entry) require.cache[resolved] = entry;
    else delete require.cache[resolved];
  });
}

function loadController(originals, { isAdmin = false } = {}) {
  stubModule(ADMIN_AUTH_PATH, {
    isAdminForRequestAsync: async () => isAdmin,
    resolveAdminAuthorityAsync: async () => ({ isRequestAdmin: isAdmin })
  }, originals);
  stubModule(DATA_SERVICE_PATH, {
    fetchDataPaged: async () => {
      throw new Error('fetchDataPaged should not run for denied listSessions');
    },
    getDataById: async (collection, id) => {
      if (collection === 'sessions') {
        return { id, userId: 'USER_OTHER', status: 'active' };
      }
      if (collection === 'users') {
        return { id: 'USER_OTHER', username: 'other', email: 'other@test' };
      }
      return null;
    }
  }, originals);
  stubModule(SESSION_SERVICE_PATH, {
    terminateSession: async () => true,
    cleanupExpiredSessions: async () => {}
  }, originals);
  delete require.cache[CONTROLLER_PATH];
  return require(CONTROLLER_PATH);
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    render() {
      return this;
    },
    redirect() {
      return this;
    }
  };
}

test('sessionRoutes gates admin list with requireFamilyAAdmin and leaves mySessions on requireAuth', () => {
  const source = fs.readFileSync(ROUTES_PATH, 'utf8');
  assert.match(source, /requireFamilyAAdmin\(SECTIONS\.SESSIONS, OPERATIONS\.READ_ALL\)/);
  assert.match(source, /router\.get\('\/',[\s\S]*requireFamilyAAdmin/);
  assert.match(source, /router\.get\('\/mySessions', requireAuth, controller\.listMySessions\)/);
  assert.doesNotMatch(source, /router\.get\('\/mySessions'[\s\S]*requireFamilyAAdmin/);
});

test('accessConstants defines SESSIONS section id for login session manager', () => {
  const { SECTIONS } = require('../config/accessConstants');
  assert.equal(SECTIONS.SESSIONS, '980387');
});

test('listSessions returns 403 for non-admin before loading sessions', async () => {
  const originals = new Map();
  const controller = loadController(originals, { isAdmin: false });
  const res = mockRes();
  await controller.listSessions(
    { user: { id: 'USER_1' }, headers: {}, query: {} },
    res
  );
  assert.equal(res.statusCode, 403);
  restoreModules(originals, [CONTROLLER_PATH]);
});

test('terminateSession allows owner to revoke own session without admin bypass', async () => {
  const originals = new Map();
  stubModule(ADMIN_AUTH_PATH, {
    isAdminForRequestAsync: async () => false
  }, originals);
  let terminatedId = '';
  stubModule(DATA_SERVICE_PATH, {
    getDataById: async (collection, id) => (
      collection === 'sessions'
        ? { id, userId: 'USER_1', status: 'active' }
        : null
    )
  }, originals);
  stubModule(SESSION_SERVICE_PATH, {
    terminateSession: async (id) => {
      terminatedId = id;
    }
  }, originals);
  delete require.cache[CONTROLLER_PATH];
  const controller = require(CONTROLLER_PATH);
  const res = mockRes();
  await controller.terminateSession(
    { user: { id: 'USER_1' }, params: { id: 'SES-1' }, headers: { 'x-ajax-request': '1' } },
    res
  );
  assert.equal(terminatedId, 'SES-1');
  assert.equal(res.body?.status, 'success');
  restoreModules(originals, [CONTROLLER_PATH]);
});

test('terminateSession denies non-owner non-admin', async () => {
  const originals = new Map();
  const controller = loadController(originals, { isAdmin: false });
  const res = mockRes();
  await controller.terminateSession(
    {
      user: { id: 'USER_1', activeOrgId: 'ORG-1' },
      params: { id: 'SES-9' },
      headers: { 'x-ajax-request': '1' }
    },
    res
  );
  assert.equal(res.statusCode, 403);
  restoreModules(originals, [CONTROLLER_PATH]);
});

test('terminateSession allows Family A admin to revoke another user session', async () => {
  const originals = new Map();
  const controller = loadController(originals, { isAdmin: true });
  let terminatedId = '';
  stubModule(SESSION_SERVICE_PATH, {
    terminateSession: async (id) => {
      terminatedId = id;
    }
  }, originals);
  delete require.cache[CONTROLLER_PATH];
  const freshController = require(CONTROLLER_PATH);
  const res = mockRes();
  await freshController.terminateSession(
    {
      user: { id: 'USER_ADMIN', activeOrgId: 'ORG-1' },
      params: { id: 'SES-9' },
      headers: { 'x-ajax-request': '1' }
    },
    res
  );
  assert.equal(terminatedId, 'SES-9');
  assert.equal(res.body?.status, 'success');
  restoreModules(originals, [CONTROLLER_PATH]);
});
