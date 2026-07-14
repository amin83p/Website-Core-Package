const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { SECTIONS, OPERATIONS } = require('../packages/school/config/accessConstants');
const {
  listCatalogEntries,
  getCatalogEntry,
  DELETE_STRATEGIES
} = require('../packages/school/MVC/config/schoolDataMaintenanceCatalog');

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

async function withStubbedMaintenanceRoutes(callback) {
  const routePath = require.resolve('../packages/school/MVC/routes/schoolDataMaintenanceRoutes');
  const originals = new Map();
  if (!originals.has(routePath)) originals.set(routePath, require.cache[routePath]);
  delete require.cache[routePath];

  setRequireStub('../packages/school/MVC/controllers/school/schoolDataMaintenanceController', {
    showPage: (req, res) => res.status(200).json({ handler: 'show-page', userId: req.user?.id || '' }),
    getSummary: (req, res) => res.status(200).json({ handler: 'summary', userId: req.user?.id || '' }),
    listRows: (req, res) => res.status(200).json({ handler: 'list-rows', userId: req.user?.id || '' }),
    previewDelete: (req, res) => res.status(200).json({ handler: 'delete-preview', userId: req.user?.id || '' }),
    deleteSelected: (req, res) => res.status(200).json({ handler: 'delete', userId: req.user?.id || '' }),
    clearAll: (req, res) => res.status(200).json({ handler: 'clear-all', userId: req.user?.id || '' })
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
    const router = require('../packages/school/MVC/routes/schoolDataMaintenanceRoutes');
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

test('maintenance catalog covers registry entities and withdrawals', () => {
  const entries = listCatalogEntries();
  const entityTypes = new Set(entries.map((row) => row.entityType));
  assert.ok(entityTypes.has('students'));
  assert.ok(entityTypes.has('reportInstances'));
  assert.ok(entityTypes.has('withdrawals'));
  assert.ok(entityTypes.has('globalTransactions'));
  assert.equal(getCatalogEntry('feeDefinitions'), null, 'aliases should not be duplicated');
});

test('classifyRowForDelete protects head school accounts', () => {
  const service = require('../packages/school/MVC/services/school/schoolDataMaintenanceService');
  const blocked = service.classifyRowForDelete('schoolAccounts', {
    id: 'ACC-1',
    headCategory: 'assets'
  });
  assert.equal(blocked.canDelete, false);

  const allowed = service.classifyRowForDelete('schoolAccounts', {
    id: 'ACC-2',
    headCategory: 'none'
  });
  assert.equal(allowed.canDelete, true);
});

test('deleteSelectedRows uses purge strategy for students', async () => {
  const servicePath = require.resolve('../packages/school/MVC/services/school/schoolDataMaintenanceService');
  const repoPath = require.resolve('../packages/school/MVC/repositories/school');
  const dataPath = require.resolve('../packages/school/MVC/services/school/schoolDataService');
  const originals = new Map();

  const purgeCalls = [];
  setRequireStub('../packages/school/MVC/repositories/school', {
    students: {
      purgeById: async (id) => {
        purgeCalls.push(id);
        return true;
      }
    }
  }, originals);

  setRequireStub('../packages/school/MVC/services/school/schoolDataService', {
    getDataById: async (_type, id) => ({ id, orgId: 'ORG-1', localId: 'STU-1' })
  }, originals);

  delete require.cache[servicePath];
  const service = require('../packages/school/MVC/services/school/schoolDataMaintenanceService');

  const result = await service.deleteSelectedRows({
    entityType: 'students',
    orgId: 'ORG-1',
    ids: ['STU-1'],
    reqUser: { activeOrgId: 'ORG-1' }
  });

  assert.equal(result.summary.success, 1);
  assert.deepEqual(purgeCalls, ['STU-1']);

  delete require.cache[servicePath];
  originals.forEach((original, resolved) => {
    if (original) require.cache[resolved] = original;
    else delete require.cache[resolved];
  });
});

test('deleteSelectedRows cascades class session assets before remove', async () => {
  const servicePath = require.resolve('../packages/school/MVC/services/school/schoolDataMaintenanceService');
  const cascadePath = require.resolve('../packages/school/MVC/services/school/classDeleteCascadeService');
  const originals = new Map();
  const calls = [];

  setRequireStub('../packages/school/MVC/repositories/school', {
    classes: {
      remove: async (id) => {
        calls.push(`remove:${id}`);
        return true;
      }
    }
  }, originals);

  setRequireStub('../packages/school/MVC/services/school/schoolDataService', {
    getDataById: async () => ({ id: 'CLS-1', orgId: 'ORG-1', title: 'Math' })
  }, originals);

  setRequireStub('../packages/school/MVC/services/school/classDeleteCascadeService', {
    cascadeDeleteClassSessionAssets: async (classId) => {
      calls.push(`cascade:${classId}`);
      return { deletedCaseCount: 0, errors: [] };
    }
  }, originals);

  delete require.cache[servicePath];
  const service = require('../packages/school/MVC/services/school/schoolDataMaintenanceService');
  await service.deleteSelectedRows({
    entityType: 'classes',
    orgId: 'ORG-1',
    ids: ['CLS-1'],
    reqUser: { activeOrgId: 'ORG-1' }
  });

  assert.deepEqual(calls, ['cascade:CLS-1', 'remove:CLS-1']);

  delete require.cache[servicePath];
  delete require.cache[cascadePath];
  originals.forEach((original, resolved) => {
    if (original) require.cache[resolved] = original;
    else delete require.cache[resolved];
  });
});

test('listCollectionRows filters rows to active org', async () => {
  const servicePath = require.resolve('../packages/school/MVC/services/school/schoolDataMaintenanceService');
  const originals = new Map();

  setRequireStub('../packages/school/MVC/services/school/schoolDataService', {
    fetchData: async () => ([
      { id: 'R-1', orgId: 'ORG-1', status: 'active' },
      { id: 'R-2', orgId: 'ORG-OTHER', status: 'active' }
    ])
  }, originals);

  setRequireStub('../packages/school/MVC/repositories/school', {
    reportInstances: {
      count: async () => 2
    }
  }, originals);

  delete require.cache[servicePath];
  const service = require('../packages/school/MVC/services/school/schoolDataMaintenanceService');
  const payload = await service.listCollectionRows({
    entityType: 'reportInstances',
    orgId: 'ORG-1',
    reqUser: { activeOrgId: 'ORG-1' }
  });

  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].id, 'R-1');

  delete require.cache[servicePath];
  originals.forEach((original, resolved) => {
    if (original) require.cache[resolved] = original;
    else delete require.cache[resolved];
  });
});

test('maintenance mutating routes require auth, access, and admin verification', async () => {
  await withStubbedMaintenanceRoutes(async (router) => {
    const app = express();
    app.use(express.json());
    app.use('/school/data-maintenance', router);

    await withServer(app, async (baseUrl) => {
      const endpoints = [
        { path: '/school/data-maintenance/api/reportInstances/delete', handler: 'delete' },
        { path: '/school/data-maintenance/api/reportInstances/clear-all', handler: 'clear-all' }
      ];

      for (const endpoint of endpoints) {
        const unauthenticated = await fetch(`${baseUrl}${endpoint.path}`, { method: 'POST' });
        assert.equal(unauthenticated.status, 401, `${endpoint.path} should reject guests`);

        const unverified = await fetch(`${baseUrl}${endpoint.path}`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer allowed',
            'x-allow-access': 'yes'
          }
        });
        assert.equal(unverified.status, 403, `${endpoint.path} should require admin verification`);

        const allowed = await fetch(`${baseUrl}${endpoint.path}`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer allowed',
            'x-allow-access': 'yes',
            'x-admin-verified': 'yes',
            'content-type': 'application/json'
          },
          body: JSON.stringify({ ids: ['R-1'] })
        });
        assert.equal(allowed.status, 200, `${endpoint.path} should reach controller`);
        const body = await allowed.json();
        assert.equal(body.handler, endpoint.handler);
        assert.equal(body.userId, 'user-1');
      }
    });
  });
});

test('maintenance read routes require auth and access only', async () => {
  await withStubbedMaintenanceRoutes(async (router) => {
    const app = express();
    app.use('/school/data-maintenance', router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/school/data-maintenance/api/summary`, {
        headers: {
          authorization: 'Bearer allowed',
          'x-allow-access': 'yes'
        }
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.handler, 'summary');
    });
  });
});

test('pay rates catalog entry is list-only unsupported delete', () => {
  const entry = getCatalogEntry('payRates');
  assert.ok(entry);
  assert.equal(entry.deleteStrategy, DELETE_STRATEGIES.UNSUPPORTED);
  assert.equal(entry.listOnly, true);
});
