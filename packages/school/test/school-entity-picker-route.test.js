const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

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

function makeError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function withStubbedPickerRoute(callback) {
  const routePath = require.resolve('../MVC/routes/schoolEntityPickerRoutes');
  const controllerPath = require.resolve('../MVC/controllers/school/schoolEntityPickerController');
  const originals = new Map();
  [routePath, controllerPath].forEach((modulePath) => {
    if (!originals.has(modulePath)) originals.set(modulePath, require.cache[modulePath]);
    delete require.cache[modulePath];
  });

  const pickerServiceStub = {
    getRequiredAccessSections(target) {
      if (target === 'bad-target') throw makeError('Unsupported picker target: bad-target', 400, 'INVALID_PICKER_TARGET');
      return target === 'teachers'
        ? ['SCHOOL_DEPARTMENTS', 'SCHOOL_TEACHERS']
        : ['SCHOOL_DEPARTMENTS', 'SCHOOL_CLASSES', 'SCHOOL_STUDENTS', 'SCHOOL_ROLLING_ENROLLMENT'];
    },
    async listOptions({ query }) {
      if (query.level === 'bad-level') throw makeError('Unsupported picker level "bad-level"', 400, 'INVALID_PICKER_LEVEL');
      return {
        status: 'success',
        target: query.target || 'students',
        level: query.level || 'departments',
        breadcrumb: [],
        results: [{ id: 'ROW_1', type: 'department', label: 'Department', selectable: false, nextLevel: 'classes', counts: {}, meta: {} }],
        pagination: { currentPage: Number(query.page || 1), totalPages: 3, totalItems: 25, limit: Number(query.limit || 10) }
      };
    }
  };

  setRequireStub('../MVC/services/school/schoolEntityPickerService', pickerServiceStub, originals);
  setRequireStub('../MVC/services/school/schoolDataService', {
    buildRouteAccessContext(req) {
      return { scopeId: req.accessScope || '' };
    }
  }, originals);
  setRequireStub('../MVC/services/school/schoolCoreContracts', {
    requireCoreModule(name) {
      if (name === 'MVC/services/security/index') {
        return {
          async evaluateAccess({ user }) {
            return user?.allowAccess
              ? { allowed: true, limits: {}, scopeId: 'SCP_TEST' }
              : { allowed: false, reason: 'No picker access.', deniedCode: 'TEST_DENIED' };
          }
        };
      }
      throw new Error(`Unexpected core module: ${name}`);
    }
  }, originals);
  setRequireStub('../MVC/routes/schoolRouteDependencies', {
    requireAuth(req, res, next) {
      if (req.headers.authorization === 'Bearer allowed') {
        req.user = {
          id: 'USER_1',
          allowAccess: req.headers['x-allow-access'] === 'yes'
        };
        return next();
      }
      return res.status(401).json({ status: 'error', message: 'Authentication required.' });
    },
    trackActionState() {
      return (_req, _res, next) => next();
    },
    SECTIONS: { SCHOOL: 'SCHOOL', SCHOOL_DEPARTMENTS: 'SCHOOL_DEPARTMENTS' },
    OPERATIONS: { READ_ALL: 'READ_ALL' }
  }, originals);

  try {
    const router = require('../MVC/routes/schoolEntityPickerRoutes');
    return await callback(router);
  } finally {
    [routePath, controllerPath].forEach((modulePath) => {
      delete require.cache[modulePath];
    });
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

test('entity picker API returns options with pagination for allowed students target', async () => {
  await withStubbedPickerRoute(async (router) => {
    const app = express();
    app.use('/school/entity-picker', router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/school/entity-picker/api/options?target=students&level=departments&page=2&limit=5`, {
        headers: { authorization: 'Bearer allowed', 'x-allow-access': 'yes' }
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.status, 'success');
      assert.equal(body.target, 'students');
      assert.equal(body.level, 'departments');
      assert.deepEqual(body.pagination, { currentPage: 2, totalPages: 3, totalItems: 25, limit: 5 });
    });
  });
});

test('entity picker API returns teacher options when teacher access is allowed', async () => {
  await withStubbedPickerRoute(async (router) => {
    const app = express();
    app.use('/school/entity-picker', router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/school/entity-picker/api/options?target=teachers&level=teachers`, {
        headers: { authorization: 'Bearer allowed', 'x-allow-access': 'yes' }
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.target, 'teachers');
      assert.equal(body.level, 'teachers');
    });
  });
});

test('entity picker API rejects invalid target and invalid level with 400', async () => {
  await withStubbedPickerRoute(async (router) => {
    const app = express();
    app.use('/school/entity-picker', router);

    await withServer(app, async (baseUrl) => {
      const invalidTarget = await fetch(`${baseUrl}/school/entity-picker/api/options?target=bad-target`, {
        headers: { authorization: 'Bearer allowed', 'x-allow-access': 'yes' }
      });
      assert.equal(invalidTarget.status, 400);
      assert.equal((await invalidTarget.json()).code, 'INVALID_PICKER_TARGET');

      const invalidLevel = await fetch(`${baseUrl}/school/entity-picker/api/options?target=students&level=bad-level`, {
        headers: { authorization: 'Bearer allowed', 'x-allow-access': 'yes' }
      });
      assert.equal(invalidLevel.status, 400);
      assert.equal((await invalidLevel.json()).code, 'INVALID_PICKER_LEVEL');
    });
  });
});

test('entity picker API returns 403 when required read access is missing', async () => {
  await withStubbedPickerRoute(async (router) => {
    const app = express();
    app.use('/school/entity-picker', router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/school/entity-picker/api/options?target=students`, {
        headers: { authorization: 'Bearer allowed' }
      });
      assert.equal(response.status, 403);
      const body = await response.json();
      assert.equal(body.code, 'TEST_DENIED');
    });
  });
});
