const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { SECTIONS, OPERATIONS } = require('../packages/school/config/accessConstants');

function createHandler(name) {
  return (req, res) => {
    res.status(200).json({
      handler: name,
      userId: req.user?.id || '',
      accessCheck: req.accessCheck || null,
      actionState: req.actionState || null
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

async function withStubbedSampleDataRoutes(callback) {
  const routePath = require.resolve('../packages/school/MVC/routes/sampleDataRoutes');
  const originals = new Map();
  if (!originals.has(routePath)) originals.set(routePath, require.cache[routePath]);
  delete require.cache[routePath];

  setRequireStub('../packages/school/MVC/controllers/school/schoolSampleDataController', {
    showForm: createHandler('show-form'),
    generate: createHandler('generate'),
    clearTransactionalData: createHandler('clear-transactional'),
    listClearTransactionalPreview: createHandler('clear-transactional-preview'),
    listPeopleDeletePreview: createHandler('people-delete-preview'),
    deleteSelectedSamplePeople: createHandler('people-delete')
  }, originals);

  setRequireStub('../packages/school/MVC/routes/schoolRouteDependencies', {
    requireAuth(req, res, next) {
      if (req.headers.authorization === 'Bearer allowed') {
        req.user = { id: 'user-1', activeOrgId: 'ORG-1' };
        return next();
      }
      return res.status(401).json({ status: 'error', message: 'Authentication required.' });
    },
    requireAccess(sectionId, operationId) {
      return (req, res, next) => {
        req.accessCheck = { sectionId, operationId };
        if (req.headers['x-allow-access'] === 'yes') return next();
        return res.status(403).json({
          status: 'access_required',
          sectionId,
          operationId
        });
      };
    },
    trackActionState: (sectionId, operationId, options = {}) => (req, _res, next) => {
      req.actionState = {
        sectionId,
        operationId,
        requireToken: options.requireToken === true
      };
      next();
    },
    SECTIONS,
    OPERATIONS
  }, originals);

  setRequireStub('../packages/school/MVC/services/school/schoolCoreContracts', {
    requireCoreModule(modulePath) {
      if (modulePath === 'MVC/middleware/adminApproval') {
        return (req, res, next) => {
          if (req.headers['x-admin-verified'] === 'yes') return next();
          return res.status(403).json({
            status: 'admin_required',
            message: 'Admin approval required or session expired.'
          });
        };
      }
      throw new Error(`Unexpected core module stub request: ${modulePath}`);
    }
  }, originals);

  try {
    const router = require('../packages/school/MVC/routes/sampleDataRoutes');
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
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('sample data mutating routes require auth, access, and admin verification', async () => {
  await withStubbedSampleDataRoutes(async (router) => {
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use('/school/sample-data', router);

    await withServer(app, async (baseUrl) => {
      const endpoints = [
        { path: '/school/sample-data/', handler: 'generate' },
        { path: '/school/sample-data/clear-transactional', handler: 'clear-transactional' },
        { path: '/school/sample-data/people-delete', handler: 'people-delete' }
      ];

      for (const endpoint of endpoints) {
        const unauthenticated = await fetch(`${baseUrl}${endpoint.path}`, {
          method: 'POST',
          redirect: 'manual'
        });
        assert.equal(unauthenticated.status, 401, `${endpoint.path} should reject guests`);

        const unverified = await fetch(`${baseUrl}${endpoint.path}`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer allowed',
            'x-allow-access': 'yes'
          },
          redirect: 'manual'
        });
        assert.equal(unverified.status, 403, `${endpoint.path} should require admin verification`);
        const unverifiedBody = await unverified.json();
        assert.equal(unverifiedBody.status, 'admin_required');

        const allowed = await fetch(`${baseUrl}${endpoint.path}`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer allowed',
            'x-allow-access': 'yes',
            'x-admin-verified': 'yes'
          },
          redirect: 'manual'
        });
        assert.equal(allowed.status, 200, `${endpoint.path} should reach its controller`);
        const body = await allowed.json();
        assert.equal(body.handler, endpoint.handler);
        assert.equal(body.userId, 'user-1');
        assert.deepEqual(body.accessCheck, {
          sectionId: SECTIONS.SCHOOL_SAMPLE_DATA,
          operationId: OPERATIONS.CREATE
        });
        assert.equal(body.actionState.requireToken, true);
      }
    });
  });
});

test('sample people delete preview remains authenticated and access-checked only', async () => {
  await withStubbedSampleDataRoutes(async (router) => {
    const app = express();
    app.use('/school/sample-data', router);

    await withServer(app, async (baseUrl) => {
      const unauthenticated = await fetch(`${baseUrl}/school/sample-data/people-delete-preview`, {
        method: 'GET',
        redirect: 'manual'
      });
      assert.equal(unauthenticated.status, 401);

      const allowed = await fetch(`${baseUrl}/school/sample-data/people-delete-preview`, {
        method: 'GET',
        headers: {
          authorization: 'Bearer allowed',
          'x-allow-access': 'yes'
        },
        redirect: 'manual'
      });
      assert.equal(allowed.status, 200);
      const body = await allowed.json();
      assert.equal(body.handler, 'people-delete-preview');
      assert.equal(body.userId, 'user-1');
      assert.deepEqual(body.accessCheck, {
        sectionId: SECTIONS.SCHOOL_SAMPLE_DATA,
        operationId: OPERATIONS.CREATE
      });
      assert.equal(body.actionState.requireToken, false);
    });
  });
});

test('org workspace reset preview remains authenticated and access-checked only', async () => {
  await withStubbedSampleDataRoutes(async (router) => {
    const app = express();
    app.use('/school/sample-data', router);

    await withServer(app, async (baseUrl) => {
      const unauthenticated = await fetch(`${baseUrl}/school/sample-data/clear-transactional-preview`, {
        method: 'GET',
        redirect: 'manual'
      });
      assert.equal(unauthenticated.status, 401);

      const allowed = await fetch(`${baseUrl}/school/sample-data/clear-transactional-preview`, {
        method: 'GET',
        headers: {
          authorization: 'Bearer allowed',
          'x-allow-access': 'yes'
        },
        redirect: 'manual'
      });
      assert.equal(allowed.status, 200);
      const body = await allowed.json();
      assert.equal(body.handler, 'clear-transactional-preview');
      assert.equal(body.userId, 'user-1');
      assert.deepEqual(body.accessCheck, {
        sectionId: SECTIONS.SCHOOL_SAMPLE_DATA,
        operationId: OPERATIONS.CREATE
      });
      assert.equal(body.actionState.requireToken, false);
    });
  });
});

test('sample data generator form includes org workspace reset master checkbox fields', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const formPath = path.join(__dirname, '../packages/school/MVC/views/school/sampleData/generatorForm.ejs');
  const html = fs.readFileSync(formPath, 'utf8');
  [
    'masterDefinitions_classes',
    'masterDefinitions_examDefinitions',
    'masterDefinitions_schoolAccounts',
    'appendMasterDefinitionParams',
    'btnPreviewOrgWorkspaceReset',
    'clear-transactional-preview',
    'Reset Org Workspace'
  ].forEach((needle) => {
    assert.ok(html.includes(needle), `expected sample data form to include ${needle}`);
  });
});
