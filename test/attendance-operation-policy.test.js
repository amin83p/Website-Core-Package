const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const POLICY_PATH = path.join(ROOT_DIR, 'packages/school/MVC/services/school/attendanceOperationPolicyService.js');

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
  extraPaths.forEach((modulePath) => delete require.cache[modulePath]);
  originals.forEach((entry, resolved) => {
    if (entry) require.cache[resolved] = entry;
    else delete require.cache[resolved];
  });
}

test('normalizeScopeMode maps attendance scope ids', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);
  assert.equal(policy.normalizeScopeMode('SCP_OWNER'), 'owner');
  assert.equal(policy.normalizeScopeMode('SCP_DEPT'), 'department');
  assert.equal(policy.normalizeScopeMode('SCP_ORG'), 'organization');
  assert.equal(policy.normalizeScopeMode('SCP_ADMIN'), 'admin');
});

test('canViewRollupsAtScope excludes USER and OWNER', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);
  assert.equal(policy.canViewRollupsAtScope('SCP_OWNER'), false);
  assert.equal(policy.canViewRollupsAtScope('SCP_USER'), false);
  assert.equal(policy.canViewRollupsAtScope('SCP_DEPT'), true);
  assert.equal(policy.canViewRollupsAtScope('SCP_ORG'), true);
});

test('deriveAccessFlags splits READ, READ_ALL, UPDATE, and export permissions', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);

  const readOnlyDept = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'SCP_DEPT' },
    readAll: { allowed: true, scopeId: 'SCP_DEPT' },
    update: { allowed: false, scopeId: null },
    del: { allowed: false, scopeId: null },
    upload: { allowed: false, scopeId: null },
    export: { allowed: true, scopeId: 'SCP_DEPT' },
    print: { allowed: true, scopeId: 'SCP_DEPT' }
  }, {});

  assert.equal(readOnlyDept.canOpenMatrix, true);
  assert.equal(readOnlyDept.canViewRosterFields, true);
  assert.equal(readOnlyDept.canEditRoster, false);
  assert.equal(readOnlyDept.canViewRollups, true);
  assert.equal(readOnlyDept.canViewChangeHistory, false);
  assert.equal(readOnlyDept.canExportExcel, true);
  assert.equal(readOnlyDept.canPrintMatrix, true);
});

test('deriveAccessFlags allows excuse marks at ORGANIZATION UPDATE scope', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);
  const flags = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'SCP_ORG' },
    readAll: { allowed: true, scopeId: 'SCP_ORG' },
    update: { allowed: true, scopeId: 'SCP_ORG' },
    del: { allowed: false, scopeId: null },
    upload: { allowed: true, scopeId: 'SCP_ORG' },
    export: { allowed: true, scopeId: 'SCP_ORG' },
    print: { allowed: true, scopeId: 'SCP_ORG' }
  }, {});

  assert.equal(flags.canMarkExcused, true);
  assert.equal(flags.canOverrideSessionLock, false);
});

test('deriveAccessFlags grants locked-session override at ADMIN UPDATE scope', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);
  const flags = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'SCP_ADMIN' },
    readAll: { allowed: true, scopeId: 'SCP_ADMIN' },
    update: { allowed: true, scopeId: 'SCP_ADMIN' },
    del: { allowed: false, scopeId: null },
    upload: { allowed: true, scopeId: 'SCP_ADMIN' },
    export: { allowed: true, scopeId: 'SCP_ADMIN' },
    print: { allowed: true, scopeId: 'SCP_ADMIN' }
  }, {});

  assert.equal(flags.canOverrideSessionLock, true);
});

test('deriveAccessFlags requires SCHOOL_ATTENDANCES UPLOAD for canUploadFiles', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);

  const withoutAttendanceUpload = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'SCP_ORG' },
    readAll: { allowed: true, scopeId: 'SCP_ORG' },
    update: { allowed: true, scopeId: 'SCP_ORG' },
    del: { allowed: false, scopeId: null },
    upload: { allowed: false, scopeId: null },
    export: { allowed: true, scopeId: 'SCP_ORG' },
    print: { allowed: true, scopeId: 'SCP_ORG' }
  }, {});

  assert.equal(withoutAttendanceUpload.canUploadFiles, false);

  const withAttendanceUpload = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'SCP_ORG' },
    readAll: { allowed: true, scopeId: 'SCP_ORG' },
    update: { allowed: true, scopeId: 'SCP_ORG' },
    del: { allowed: false, scopeId: null },
    upload: { allowed: true, scopeId: 'SCP_ORG' },
    export: { allowed: true, scopeId: 'SCP_ORG' },
    print: { allowed: true, scopeId: 'SCP_ORG' }
  }, {});

  assert.equal(withAttendanceUpload.canUploadFiles, true);
});

test('applyOperationPolicy rejects USER scope even when central access allows', async () => {
  const originals = new Map();
  try {
    stubModule('../packages/school/MVC/services/school/schoolAdminAccessService', {
      isAttendancesAdminViewerAsync: async () => false
    }, originals);

    delete require.cache[POLICY_PATH];
    const policy = require(POLICY_PATH);
    const result = await policy.applyOperationPolicy({
      user: { id: 'USER-1', activeOrgId: 'ORG-1' },
      operationId: 'READ',
      evaluation: { allowed: true, scopeId: 'SCP_USER' }
    });

    assert.equal(result.allowed, false);
    assert.match(result.reason, /USER scope/i);
  } finally {
    restoreModules(originals, [POLICY_PATH]);
  }
});

test('resolveAttendanceDateWindow uses 3 months for OWNER and 12 for DEPT', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);
  const anchor = new Date('2026-09-06T12:00:00.000Z');
  const ownerWindow = policy.resolveAttendanceDateWindow('SCP_OWNER', anchor);
  const deptWindow = policy.resolveAttendanceDateWindow('SCP_DEPT', anchor);
  assert.equal(ownerWindow.months, 3);
  assert.equal(deptWindow.months, 12);
  assert.ok(ownerWindow.startDate > deptWindow.startDate);
});
