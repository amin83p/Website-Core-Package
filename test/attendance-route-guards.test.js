const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('attendance routes apply attendance policy guards instead of raw requireAccess', () => {
  const routes = read('packages/school/MVC/routes/attendanceRoutes.js');
  assert.match(routes, /requireAttendanceOperation/);
  assert.match(routes, /router\.get\('\/'[\s\S]*?requireAttendanceOperation\(OPERATIONS\.READ\)/);
  assert.match(routes, /\/api\/data'[\s\S]*?requireAttendanceOperation\(OPERATIONS\.READ_ALL\)/);
  assert.match(routes, /\/api\/active-classes'[\s\S]*?requireAttendanceOperation\(OPERATIONS\.READ_ALL\)/);
  assert.match(routes, /\/api\/rollups'[\s\S]*?requireAttendanceOperation\(OPERATIONS\.READ_ALL\)/);
  assert.match(routes, /\/api\/export\.xlsx'[\s\S]*?requireAttendanceOperation\(OPERATIONS\.EXPORT\)/);
  assert.match(routes, /\/api\/update-roster-cell'[\s\S]*?requireAttendanceOperation\(OPERATIONS\.UPDATE\)/);
  assert.doesNotMatch(routes, /router\.get\('\/'[\s\S]*?requireAccess\(SECTIONS\.SCHOOL_ATTENDANCES,\s*OPERATIONS\.READ\)/);
});

test('attendance route guard rejects USER scope after central access allows', async () => {
  const originals = new Map();
  const guardPath = path.join(ROOT_DIR, 'packages/school/MVC/routes/attendanceRouteGuards.js');
  const policyPath = path.join(ROOT_DIR, 'packages/school/MVC/services/school/attendanceOperationPolicyService.js');
  const adminPath = path.join(ROOT_DIR, 'MVC/services/adminAuthorityService.js');
  const bootstrapPath = path.join(ROOT_DIR, 'MVC/services/firstRunBootstrapService.js');
  const accessPath = path.join(ROOT_DIR, 'MVC/services/security/index.js');
  const schoolAdminPath = path.join(ROOT_DIR, 'packages/school/MVC/services/school/schoolAdminAccessService.js');

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
      isAttendancesAdminViewerAsync: async () => false
    });

    delete require.cache[require.resolve(policyPath)];
    delete require.cache[require.resolve(guardPath)];
    const { requireAttendanceOperation } = require(guardPath);

    const middleware = requireAttendanceOperation('READ');
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

test('dashboard section access for SCHOOL_ATTENDANCES uses canOpenMatrix policy', () => {
  const dashboard = read('MVC/controllers/dashboardController.js');
  assert.match(dashboard, /SCHOOL_ATTENDANCES[\s\S]*?userCanOpenAttendanceMatrix/);
});
