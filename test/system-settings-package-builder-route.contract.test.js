const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { SECTIONS, OPERATIONS } = require('../config/accessConstants');

function createHandler(name) {
  return (req, res) => {
    res.status(200).json({
      handler: name,
      actionState: req.actionState || null,
      accessCheck: req.accessCheck || null
    });
  };
}

function setRequireStub(modulePath, exportsValue, originals) {
  const resolved = require.resolve(modulePath);
  if (!originals.has(resolved)) originals.set(resolved, require.cache[resolved]);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue
  };
}

async function withStubbedSystemSettingsRoutes(callback) {
  const routePath = require.resolve('../MVC/routes/systemSettingsRoutes');
  const originals = new Map();
  if (!originals.has(routePath)) originals.set(routePath, require.cache[routePath]);
  delete require.cache[routePath];

  const controllerStub = new Proxy({}, {
    get: (_target, prop) => createHandler(String(prop))
  });
  const uploadStub = () => ({
    array: () => (_req, _res, next) => next(),
    single: () => (_req, _res, next) => next()
  });
  uploadStub.cleanupUploadedFileOnFail = (_req, _res, next) => next();

  setRequireStub('../MVC/controllers/systemSettingsController', controllerStub, originals);
  setRequireStub('../MVC/middleware/upload', uploadStub, originals);
  setRequireStub('../MVC/middleware/authMiddleware', {
    requireAuth(req, res, next) {
      if (req.headers.authorization === 'Bearer allowed') {
        req.user = { id: 'USER_1' };
        return next();
      }
      return res.status(401).json({ status: 'error', message: 'Authentication required.' });
    }
  }, originals);
  setRequireStub('../MVC/middleware/accessMiddleware', {
    requireAccess(sectionId, operationId) {
      return (req, res, next) => {
        req.accessCheck = { sectionId, operationId };
        if (req.headers['x-allow-access'] === 'yes') return next();
        return res.status(403).json({ status: 'access_required' });
      };
    }
  }, originals);
  setRequireStub('../MVC/middleware/actionStateMiddleware', {
    trackActionState(sectionId, operationId, options = {}) {
      return (req, res, next) => {
        const token = req.body?.actionStateId || req.query?.actionStateId || req.headers['x-action-state-id'];
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && options.requireToken === true && !token) {
          return res.status(403).json({ status: 'token_required', message: 'Missing Action State Token.' });
        }
        req.actionState = {
          sectionId,
          operationId,
          requireToken: options.requireToken === true,
          actionStateId: token || ''
        };
        return next();
      };
    }
  }, originals);
  setRequireStub('../MVC/middleware/adminApproval', (req, res, next) => {
    if (req.headers['x-admin-verified'] === 'yes') return next();
    return res.status(403).json({ status: 'admin_required', message: 'Admin approval required or session expired.' });
  }, originals);
  setRequireStub('../MVC/services/security/index', {
    async evaluateAccess() {
      return { allowed: true, limits: {}, scopeId: 'GLOBAL' };
    }
  }, originals);

  try {
    const router = require('../MVC/routes/systemSettingsRoutes');
    return await callback(router);
  } finally {
    delete require.cache[routePath];
    originals.forEach((original, resolved) => {
      if (original) require.cache[resolved] = original;
      else delete require.cache[resolved];
    });
  }
}

async function withServer(app, callback) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('package builder GET route reaches controller with dedicated section access', async () => {
  await withStubbedSystemSettingsRoutes(async (router) => {
    const app = express();
    app.use('/systemSettings', router);
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/systemSettings/package-builder`, {
        method: 'GET',
        headers: { authorization: 'Bearer allowed', 'x-allow-access': 'yes' }
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.handler, 'showPackageBuilderPage');
      assert.equal(body.actionState.requireToken, false);
      assert.deepEqual(body.accessCheck, {
        sectionId: SECTIONS.SYSTEM_PACKAGE_BUILDER,
        operationId: OPERATIONS.UPDATE
      });
    });
  });
});

test('package builder preflight/build POST routes require token and admin approval', async () => {
  await withStubbedSystemSettingsRoutes(async (router) => {
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use('/systemSettings', router);

    await withServer(app, async (baseUrl) => {
      const missingToken = await fetch(`${baseUrl}/systemSettings/package-builder/preflight`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer allowed',
          'x-allow-access': 'yes',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ packageId: 'pte' }).toString()
      });
      assert.equal(missingToken.status, 403);
      assert.equal((await missingToken.json()).status, 'token_required');

      const missingAdmin = await fetch(`${baseUrl}/systemSettings/package-builder/build`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer allowed',
          'x-allow-access': 'yes',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ packageId: 'pte', version: '1.0.1', actionStateId: 'STATE_1' }).toString()
      });
      assert.equal(missingAdmin.status, 403);
      assert.equal((await missingAdmin.json()).status, 'admin_required');

      const allowed = await fetch(`${baseUrl}/systemSettings/package-builder/build`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer allowed',
          'x-allow-access': 'yes',
          'x-admin-verified': 'yes',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ packageId: 'pte', version: '1.0.1', actionStateId: 'STATE_2' }).toString()
      });
      assert.equal(allowed.status, 200);
      const body = await allowed.json();
      assert.equal(body.handler, 'buildPackageFromBuilder');
      assert.equal(body.actionState.requireToken, true);
      assert.equal(body.actionState.actionStateId, 'STATE_2');
      assert.deepEqual(body.accessCheck, {
        sectionId: SECTIONS.SYSTEM_PACKAGE_BUILDER,
        operationId: OPERATIONS.UPDATE
      });
    });
  });
});
