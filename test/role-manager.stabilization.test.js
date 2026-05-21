const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const ejs = require('ejs');

const roleModel = require('../MVC/models/roleModel');
const { SECTIONS, OPERATIONS } = require('../config/accessConstants');

function installRoleFileFixture(initialRows = []) {
  let rows = JSON.parse(JSON.stringify(initialRows));
  const originalReadFile = fs.promises.readFile;
  const originalWriteFile = fs.promises.writeFile;

  fs.promises.readFile = async () => JSON.stringify(rows);
  fs.promises.writeFile = async (_filePath, content) => {
    rows = JSON.parse(String(content || '[]'));
  };

  return {
    rows: () => rows,
    restore() {
      fs.promises.readFile = originalReadFile;
      fs.promises.writeFile = originalWriteFile;
    }
  };
}

function createHandler(name) {
  return (req, res) => {
    res.status(200).json({
      handler: name,
      userId: req.user?.id || '',
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

async function withStubbedRoleRoutes(callback) {
  const routePath = require.resolve('../MVC/routes/roleRoutes');
  const originals = new Map();
  if (!originals.has(routePath)) originals.set(routePath, require.cache[routePath]);
  delete require.cache[routePath];

  setRequireStub('../MVC/controllers/roleController', {
    listRoles: createHandler('list'),
    showAddRoleForm: createHandler('new-form'),
    addRole: createHandler('add'),
    showEditRoleForm: createHandler('edit-form'),
    editRole: createHandler('edit'),
    deleteRole: createHandler('delete')
  }, originals);

  setRequireStub('../MVC/controllers/rolesImportController', {
    startImport: createHandler('start'),
    streamImportStatus: createHandler('stream'),
    abortImport: createHandler('abort'),
    downloadImportReport: createHandler('report')
  }, originals);

  setRequireStub('../MVC/middleware/upload', () => ({
    single: () => (req, res, next) => next()
  }), originals);

  setRequireStub('../MVC/controllers/generalExportController', {
    performExport: createHandler('export')
  }, originals);

  setRequireStub('../MVC/middleware/adminApproval', (req, res, next) => next(), originals);

  setRequireStub('../MVC/middleware/authMiddleware', {
    requireAuth(req, res, next) {
      if (req.headers.authorization === 'Bearer allowed') {
        req.user = { id: 'user-1' };
        return next();
      }
      return res.status(401).json({ status: 'error', message: 'Authentication required.' });
    },
    softAuth(req, res, next) {
      return next();
    }
  }, originals);

  setRequireStub('../MVC/middleware/accessMiddleware', {
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
    }
  }, originals);

  setRequireStub('../MVC/middleware/actionStateMiddleware', {
    trackActionState: () => (req, res, next) => next()
  }, originals);

  try {
    const router = require('../MVC/routes/roleRoutes');
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

test('JSON role CRUD returns created, updated, and deleted rows', async () => {
  const fixture = installRoleFileFixture([
    {
      id: 'ROL1001',
      key: 'existing_role',
      label: 'Existing Role',
      description: '',
      domain: 'core',
      packageName: 'CORE',
      aliases: [],
      active: true,
      system: false,
      audit: {
        createUser: 'seed',
        createDateTime: '2026-01-01T00:00:00.000Z',
        lastUpdateUser: 'seed',
        lastUpdateDateTime: '2026-01-01T00:00:00.000Z'
      }
    }
  ]);

  try {
    const created = await roleModel.addRole({
      key: 'pte_public_candidate',
      label: 'PTE Public Candidate',
      description: 'Public PTE learner role.',
      domain: 'pte',
      packageName: 'PTE',
      aliases: ['pte-public-candidate'],
      active: true,
      system: false,
      audit: { createUser: 'tester' }
    });

    assert.equal(created.id, 'ROL1002');
    assert.equal(created.key, 'pte_public_candidate');
    assert.equal(created.audit.createUser, 'tester');
    assert.equal(fixture.rows().length, 2);

    const updated = await roleModel.updateRole('ROL1002', {
      label: 'Updated PTE Public Candidate',
      aliases: ['pte-public-candidate', 'public-pte-user'],
      audit: { lastUpdateUser: 'editor' }
    });

    assert.equal(updated.id, 'ROL1002');
    assert.equal(updated.label, 'Updated PTE Public Candidate');
    assert.deepEqual(updated.aliases, ['pte-public-candidate', 'public-pte-user']);
    assert.equal(updated.audit.createUser, 'tester');
    assert.equal(updated.audit.lastUpdateUser, 'editor');

    const deleted = await roleModel.deleteRole('ROL1002');

    assert.equal(deleted.id, 'ROL1002');
    assert.equal(deleted.key, 'pte_public_candidate');
    assert.equal(fixture.rows().length, 1);
    assert.equal(fixture.rows()[0].id, 'ROL1001');
  } finally {
    fixture.restore();
  }
});

test('Role import helper routes require auth and role import access', async () => {
  await withStubbedRoleRoutes(async (router) => {
    const app = express();
    app.use('/roles', router);

    await withServer(app, async (baseUrl) => {
      const endpoints = [
        { method: 'GET', path: '/roles/import/stream/job-1', handler: 'stream' },
        { method: 'POST', path: '/roles/import/abort/job-1', handler: 'abort' },
        { method: 'GET', path: '/roles/import/report/job-1', handler: 'report' }
      ];

      for (const endpoint of endpoints) {
        const unauthenticated = await fetch(`${baseUrl}${endpoint.path}`, {
          method: endpoint.method,
          redirect: 'manual'
        });
        assert.equal(unauthenticated.status, 401, `${endpoint.path} should reject guests`);

        const forbidden = await fetch(`${baseUrl}${endpoint.path}`, {
          method: endpoint.method,
          headers: { authorization: 'Bearer allowed' },
          redirect: 'manual'
        });
        assert.equal(forbidden.status, 403, `${endpoint.path} should require import access`);

        const allowed = await fetch(`${baseUrl}${endpoint.path}`, {
          method: endpoint.method,
          headers: {
            authorization: 'Bearer allowed',
            'x-allow-access': 'yes'
          },
          redirect: 'manual'
        });
        assert.equal(allowed.status, 200, `${endpoint.path} should reach its controller`);
        const body = await allowed.json();
        assert.equal(body.handler, endpoint.handler);
        assert.equal(body.userId, 'user-1');
        assert.deepEqual(body.accessCheck, {
          sectionId: SECTIONS.ROLES,
          operationId: OPERATIONS.IMPORT
        });
      }
    });
  });
});

test('Role Manager list and form views render with authenticated locals', async () => {
  const user = {
    id: 'user-1',
    username: 'role.admin',
    activeOrgId: 'ORG-1',
    allowedOrgs: [{ orgId: 'ORG-1', name: 'Main Org', roles: ['admin'] }]
  };

  const pagination = {
    currentPage: 1,
    totalPages: 1,
    totalItems: 1,
    limit: 20,
    startItem: 1,
    endItem: 1
  };

  const role = {
    id: 'ROL2001',
    key: 'pte_student_public',
    label: 'PTE Public Student',
    description: 'Public PTE learner.',
    domain: 'pte',
    packageName: 'PTE',
    aliases: ['pte-public-student'],
    active: true,
    system: false,
    audit: {
      createUser: 'tester',
      createDateTime: '2026-01-01T00:00:00.000Z',
      lastUpdateUser: 'tester',
      lastUpdateDateTime: '2026-01-01T00:00:00.000Z'
    }
  };

  const listHtml = await ejs.renderFile(path.join(__dirname, '../MVC/views/role/roles.ejs'), {
    title: 'Role Management',
    tableName: 'Roles_Management',
    newLabel: 'Add Role',
    newUrl: 'roles',
    print: true,
    roles: [role],
    pagination,
    filters: {},
    user,
    actionStateId: 'action-1',
    adminContext: { isRequestAdmin: true }
  });

  assert.match(listHtml, /Role Management/);
  assert.match(listHtml, /pte_student_public/);
  assert.match(listHtml, /PTE Public Student/);

  const formHtml = await ejs.renderFile(path.join(__dirname, '../MVC/views/role/roleForm.ejs'), {
    title: 'Edit Role',
    includeModal: true,
    role,
    user,
    actionStateId: 'action-2'
  });

  assert.match(formHtml, /Edit Role/);
  assert.match(formHtml, /pte_student_public/);
  assert.match(formHtml, /PTE Public Student/);
});
