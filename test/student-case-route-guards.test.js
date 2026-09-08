const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('student case routes apply policy guards instead of raw requireAccess', () => {
  const routes = read('packages/school/MVC/routes/sessionStudentCaseRoutes.js');
  const classRoutes = read('packages/school/MVC/routes/classRoutes.js');
  assert.match(routes, /requireStudentCaseOperation/);
  assert.match(routes, /router\.get\('\/'[\s\S]*?requireStudentCaseOperation\(OPERATIONS\.READ\)/);
  assert.doesNotMatch(routes, /router\.get\('\/'[\s\S]*?requireCaseSectionOperationAny\(\[OPERATIONS\.READ, OPERATIONS\.READ_ALL\]\)/);
  assert.doesNotMatch(routes, /requireAccess\(SECTIONS\.SCHOOL_SESSION_STUDENT_CASES/);
  assert.match(classRoutes, /\/cases'[\s\S]*?requireStudentCaseOperation\(OPERATIONS\.READ_ALL\)/);
  assert.match(classRoutes, /\/cases\/:caseId'[\s\S]*?requireStudentCaseOperation\(OPERATIONS\.UPDATE\)/);
});

test('student case route guard rejects USER scope after central access allows', async () => {
  const guardPath = path.join(ROOT_DIR, 'packages/school/MVC/routes/sessionStudentCaseRouteGuards.js');
  const policyPath = path.join(ROOT_DIR, 'packages/school/MVC/services/school/studentCaseOperationPolicyService.js');
  const adminPath = path.join(ROOT_DIR, 'MVC/services/adminAuthorityService.js');
  const bootstrapPath = path.join(ROOT_DIR, 'MVC/services/firstRunBootstrapService.js');
  const accessPath = path.join(ROOT_DIR, 'MVC/services/security/index.js');
  const schoolAdminPath = path.join(ROOT_DIR, 'packages/school/MVC/services/school/schoolAdminAccessService.js');
  const originals = new Map();

  function stub(modulePath, exportsValue) {
    const resolved = require.resolve(modulePath);
    if (!originals.has(resolved)) originals.set(resolved, require.cache[resolved]);
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports: exportsValue
    };
  }

  try {
    stub(adminPath, { isSuperAdmin: () => false });
    stub(bootstrapPath, { isBypassAllowed: async () => false });
    stub(accessPath, {
      evaluateAccess: async () => ({ allowed: true, scopeId: 'SCP_USER', limits: {} })
    });
    stub(schoolAdminPath, {
      isAdminForRequestAsync: async () => false
    });

    delete require.cache[require.resolve(guardPath)];
    delete require.cache[require.resolve(policyPath)];
    const { requireStudentCaseOperation } = require(guardPath);

    const middleware = requireStudentCaseOperation('READ');
    const req = { user: { id: 'USR-1', activeOrgId: 'ORG-1' }, ip: '127.0.0.1', headers: {} };
    let statusCode = 200;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json() {},
      render() {}
    };
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  } finally {
    originals.forEach((entry, resolved) => {
      if (entry) require.cache[resolved] = entry;
      else delete require.cache[resolved];
    });
    delete require.cache[require.resolve(guardPath)];
    delete require.cache[require.resolve(policyPath)];
  }
});

test('dashboard section access for SCHOOL_SESSION_STUDENT_CASES uses student case policy', () => {
  const dashboard = read('MVC/controllers/dashboardController.js');
  assert.match(dashboard, /SCHOOL_SESSION_STUDENT_CASES[\s\S]*?userCanOpenStudentCaseSection/);
});
