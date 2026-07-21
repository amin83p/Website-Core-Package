const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
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
    getRowJson: (req, res) => res.status(200).json({ handler: 'row-json', userId: req.user?.id || '' }),
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
  assert.ok(entityTypes.has('classSessions'));
  assert.ok(entityTypes.has('attendanceMatrixPolicy'));
  assert.ok(entityTypes.has('conductRatingScalePolicy'));
  assert.ok(entityTypes.has('studentEnrollments'));
  assert.ok(entityTypes.has('teacherSchedules'));
  assert.equal(getCatalogEntry('feeDefinitions'), null, 'aliases should not be duplicated');

  const schoolDataServicePath = require.resolve('../packages/school/MVC/services/school/schoolDataService');
  const schoolDataServiceSource = fs.readFileSync(schoolDataServicePath, 'utf8');
  const registryStart = schoolDataServiceSource.indexOf('const SCHOOL_ENTITY_REGISTRY');
  const registryEnd = schoolDataServiceSource.indexOf('});', registryStart);
  assert.ok(registryStart >= 0 && registryEnd > registryStart);
  const registryBlock = schoolDataServiceSource.slice(registryStart, registryEnd);
  const registryKeys = [...registryBlock.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*):\s*\{/gm)].map((match) => match[1]);
  const aliasKeys = new Set(
    [...registryBlock.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*):\s*\{\s*alias:/gm)].map((match) => match[1])
  );
  registryKeys.forEach((key) => {
    if (aliasKeys.has(key)) return;
    assert.ok(entityTypes.has(key), `catalog should include registry entity ${key}`);
  });
});

test('class session composite ids round-trip', () => {
  const service = require('../packages/school/MVC/services/school/schoolDataMaintenanceService');
  const composite = service.buildClassSessionCompositeId('CLS-1', 'SES-9');
  assert.equal(composite, 'CLS-1::SES-9');
  assert.deepEqual(service.parseClassSessionCompositeId(composite), {
    classId: 'CLS-1',
    sessionId: 'SES-9'
  });
  assert.equal(service.parseClassSessionCompositeId('bad-id'), null);
});

test('class session maintenance delete removes one session from class', async () => {
  const servicePath = require.resolve('../packages/school/MVC/services/school/schoolDataMaintenanceService');
  const originals = new Map();
  const saved = [];
  const classes = [{ id: 'CLS-1', orgId: 'ORG-1', title: 'Math', sessions: [] }];
  const sessionsByClass = new Map([
    ['CLS-1', [
      { sessionId: 'SES-1', date: '2026-01-01', status: 'planned' },
      { sessionId: 'SES-2', date: '2026-01-02', status: 'planned' }
    ]]
  ]);

  setRequireStub('../packages/school/MVC/services/school/schoolDataService', {
    fetchData: async (entityType) => (entityType === 'classes' ? classes : []),
    getDataById: async (_type, id) => classes.find((row) => row.id === id) || null,
    getClassSessions: async (classId) => sessionsByClass.get(String(classId)) || [],
    saveClassSessions: async (classId, sessions) => {
      saved.push({ classId, sessions });
      sessionsByClass.set(String(classId), sessions);
      return sessions;
    },
    getTeacherIndex: async () => ({}),
    getStudentIndex: async () => ({})
  }, originals);
  setRequireStub('../packages/school/MVC/repositories/school', {}, originals);
  setRequireStub('../packages/school/MVC/repositories/school/withdrawalRepository', {}, originals);
  setRequireStub('../packages/school/MVC/services/school/classDeleteCascadeService', {
    cascadeDeleteClassSessionAssets: async () => ({})
  }, originals);
  setRequireStub('../packages/school/MVC/models/school/attendanceMatrixPolicyModel', {
    hasStoredPolicyForOrg: async () => false,
    getStoredPolicyRowForOrg: async () => null,
    removePolicyForOrg: async () => ({ removed: 0 }),
    orgKey: (id) => String(id || '')
  }, originals);
  setRequireStub('../packages/school/MVC/models/school/conductRatingScalePolicyModel', {
    hasStoredPolicyForOrg: async () => false,
    getStoredPolicyRowForOrg: async () => null,
    removePolicyForOrg: async () => ({ removed: 0 }),
    orgKey: (id) => String(id || '')
  }, originals);

  delete require.cache[servicePath];
  const service = require('../packages/school/MVC/services/school/schoolDataMaintenanceService');
  const result = await service.deleteSelectedRows({
    entityType: 'classSessions',
    orgId: 'ORG-1',
    ids: ['CLS-1::SES-1'],
    reqUser: { activeOrgId: 'ORG-1' }
  });

  assert.equal(result.summary.success, 1);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].sessions.map((row) => row.sessionId), ['SES-2']);

  delete require.cache[servicePath];
  originals.forEach((original, resolved) => {
    if (original) require.cache[resolved] = original;
    else delete require.cache[resolved];
  });
});

test('attendance matrix policy maintenance delete clears org override', async () => {
  const servicePath = require.resolve('../packages/school/MVC/services/school/schoolDataMaintenanceService');
  const originals = new Map();
  const removeCalls = [];

  setRequireStub('../packages/school/MVC/services/school/schoolDataService', {
    getDataById: async () => null,
    fetchData: async () => [],
    getTeacherIndex: async () => ({}),
    getStudentIndex: async () => ({})
  }, originals);
  setRequireStub('../packages/school/MVC/repositories/school', {}, originals);
  setRequireStub('../packages/school/MVC/repositories/school/withdrawalRepository', {}, originals);
  setRequireStub('../packages/school/MVC/services/school/classDeleteCascadeService', {
    cascadeDeleteClassSessionAssets: async () => ({})
  }, originals);
  setRequireStub('../packages/school/MVC/models/school/attendanceMatrixPolicyModel', {
    hasStoredPolicyForOrg: async () => true,
    getStoredPolicyRowForOrg: async (orgId) => ({
      id: orgId,
      orgId,
      status: 'stored',
      scheduledMinutes: 180
    }),
    removePolicyForOrg: async (orgId) => {
      removeCalls.push(orgId);
      return { removed: 1 };
    },
    orgKey: (id) => String(id || '')
  }, originals);
  setRequireStub('../packages/school/MVC/models/school/conductRatingScalePolicyModel', {
    hasStoredPolicyForOrg: async () => false,
    getStoredPolicyRowForOrg: async () => null,
    removePolicyForOrg: async () => ({ removed: 0 }),
    orgKey: (id) => String(id || '')
  }, originals);

  delete require.cache[servicePath];
  const service = require('../packages/school/MVC/services/school/schoolDataMaintenanceService');
  const result = await service.deleteSelectedRows({
    entityType: 'attendanceMatrixPolicy',
    orgId: 'ORG-1',
    ids: ['ORG-1'],
    reqUser: { activeOrgId: 'ORG-1' }
  });

  assert.equal(result.summary.success, 1);
  assert.deepEqual(removeCalls, ['ORG-1']);

  delete require.cache[servicePath];
  originals.forEach((original, resolved) => {
    if (original) require.cache[resolved] = original;
    else delete require.cache[resolved];
  });
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

test('academic ledger maintenance purge only allows void entries', () => {
  const service = require('../packages/school/MVC/services/school/schoolDataMaintenanceService');

  assert.equal(service.classifyRowForDelete('academicLedger', { status: 'void' }).canDelete, true);
  for (const status of ['posted', 'draft', '', 'VOIDED']) {
    const result = service.classifyRowForDelete('academicLedger', { status });
    assert.equal(result.canDelete, false, (status || 'blank') + ' should be protected');
    assert.match(result.reason, /Only void academic ledger entries/);
  }
});

test('academic ledger mixed maintenance delete purges only void rows', async () => {
  const servicePath = require.resolve('../packages/school/MVC/services/school/schoolDataMaintenanceService');
  const originals = new Map();
  const rows = new Map([
    ['ALD-VOID', { id: 'ALD-VOID', orgId: 'ORG-1', status: 'void' }],
    ['ALD-POSTED', { id: 'ALD-POSTED', orgId: 'ORG-1', status: 'posted' }],
    ['ALD-DRAFT', { id: 'ALD-DRAFT', orgId: 'ORG-1', status: 'draft' }],
    ['ALD-OTHER', { id: 'ALD-OTHER', orgId: 'ORG-2', status: 'void' }]
  ]);
  const purgeCalls = [];

  setRequireStub('../packages/school/MVC/repositories/school', {
    academicLedger: {
      maintenancePurgeById: async (id) => {
        purgeCalls.push(id);
        return rows.get(id);
      }
    }
  }, originals);
  setRequireStub('../packages/school/MVC/services/school/schoolDataService', {
    getDataById: async (_type, id) => rows.get(id) || null
  }, originals);

  delete require.cache[servicePath];
  const service = require('../packages/school/MVC/services/school/schoolDataMaintenanceService');
  const result = await service.deleteSelectedRows({
    entityType: 'academicLedger',
    orgId: 'ORG-1',
    ids: ['ALD-VOID', 'ALD-POSTED', 'ALD-DRAFT', 'ALD-OTHER'],
    reqUser: { activeOrgId: 'ORG-1' }
  });

  assert.deepEqual(purgeCalls, ['ALD-VOID']);
  assert.equal(result.summary.success, 1);
  assert.equal(result.summary.skipped, 2);
  assert.equal(result.summary.error, 1);

  delete require.cache[servicePath];
  originals.forEach((original, resolved) => {
    if (original) require.cache[resolved] = original;
    else delete require.cache[resolved];
  });
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
    getDataById: async () => ({ id: 'CLS-1', orgId: 'ORG-1', title: 'Math', status: 'void' })
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

test('getCollectionRow returns complete nested record only within active organization', async () => {
  const servicePath = require.resolve('../packages/school/MVC/services/school/schoolDataMaintenanceService');
  const originals = new Map();
  const rows = new Map([
    ['R-1', { id: 'R-1', orgId: 'ORG-1', nested: { html: '<script>alert(1)</script>' }, values: [1, 2] }],
    ['R-2', { id: 'R-2', orgId: 'ORG-2', nested: { value: true } }]
  ]);

  setRequireStub('../packages/school/MVC/services/school/schoolDataService', {
    getDataById: async (_type, id) => rows.get(id) || null
  }, originals);
  setRequireStub('../packages/school/MVC/repositories/school', {
    reportInstances: {}
  }, originals);

  delete require.cache[servicePath];
  const service = require('../packages/school/MVC/services/school/schoolDataMaintenanceService');
  const found = await service.getCollectionRow({
    entityType: 'reportInstances',
    id: 'R-1',
    orgId: 'ORG-1',
    reqUser: { activeOrgId: 'ORG-1' }
  });
  assert.equal(found.collectionLabel, 'Report Instances');
  assert.deepEqual(found.record.nested, { html: '<script>alert(1)</script>' });
  assert.deepEqual(found.record.values, [1, 2]);

  assert.equal(await service.getCollectionRow({
    entityType: 'reportInstances',
    id: 'R-2',
    orgId: 'ORG-1',
    reqUser: { activeOrgId: 'ORG-1' }
  }), null);
  assert.equal(await service.getCollectionRow({
    entityType: 'notInCatalog',
    id: 'R-1',
    orgId: 'ORG-1',
    reqUser: { activeOrgId: 'ORG-1' }
  }), null);

  delete require.cache[servicePath];
  originals.forEach((original, resolved) => {
    if (original) require.cache[resolved] = original;
    else delete require.cache[resolved];
  });
});

test('data maintenance exposes a protected, text-only JSON record viewer', () => {
  const view = fs.readFileSync(require.resolve('../packages/school/MVC/views/school/dataMaintenance/index.ejs'), 'utf8');
  const routes = fs.readFileSync(require.resolve('../packages/school/MVC/routes/schoolDataMaintenanceRoutes.js'), 'utf8');
  const controller = fs.readFileSync(require.resolve('../packages/school/MVC/controllers/school/schoolDataMaintenanceController.js'), 'utf8');
  assert.ok(controller.includes('includeModal: true'));
  assert.ok(routes.includes('/api/:entityType/rows/:id'));
  assert.ok(routes.includes('ctrl.getRowJson'));
  assert.ok(routes.includes('allowOperationTokenFallback: true'));
  assert.ok(routes.includes('allowInactiveTokenFallback: true'));
  assert.ok(routes.includes('keepActive: true'));
  assert.ok(routes.includes('requireToken: false, keepActive: true'));
  assert.ok(controller.includes("actionStateId: req.actionStateId || ''"));
  assert.match(view, /class="btn btn-outline-primary btn-sm btn-view-json"/);
  assert.ok(view.includes('document.body.appendChild(recordJsonModalEl)'));
  assert.ok(view.includes('deleteModal = getMaintenanceModal(deleteConfirmModalEl)'));
  assert.ok(view.includes('clearAllModal = getMaintenanceModal(clearAllConfirmModalEl)'));
  assert.ok(view.includes('window.showMessageModal'));
  assert.ok(view.includes('window.requestProtectedAction'));
  assert.ok(view.includes('hideModalBeforeAdminVerification(deleteModal, deleteConfirmModalEl)'));
  assert.ok(view.includes('hideModalBeforeAdminVerification(clearAllModal, clearAllConfirmModalEl)'));
  assert.equal(view.includes('window.ensureAdminVerification'), false);
  assert.ok(view.includes('let actionStateId'));
  assert.ok(view.includes('if (payload.actionStateId) actionStateId'));
  assert.ok(view.includes('formatMessageMarkup(rawMessage)'));
  assert.ok(view.includes('loadRowsWithWaiting'));
  assert.ok(view.includes('loadSummaryWithWaiting'));
  assert.ok(view.includes('bootDataMaintenancePage'));
  assert.ok(view.includes('DOMContentLoaded'));
  assert.ok(view.includes('window.showLoading'));
  assert.ok(view.includes('Loading Collections'));
  assert.ok(view.includes('Deleting Selected Records'));
  assert.ok(view.includes('deleteLoadingToken'));
  assert.ok(view.includes('clearLoadingToken'));
  assert.ok(view.includes('recordJsonCodeEl.textContent = state.displayedJson'));
  assert.ok(view.includes('JSON.stringify(payload.record, null, 2)'));
  assert.ok(view.includes('navigator.clipboard.writeText(state.displayedJson)'));
  assert.equal(view.includes('recordJsonCodeEl.innerHTML'), false);
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

test('index catalog entries are list-only', () => {
  for (const entityType of ['studentEnrollments', 'teacherSchedules']) {
    const entry = getCatalogEntry(entityType);
    assert.ok(entry, entityType);
    assert.equal(entry.listOnly, true);
    assert.equal(entry.deleteStrategy, DELETE_STRATEGIES.UNSUPPORTED);
    assert.equal(entry.supportsClearAll, false);
  }
});
