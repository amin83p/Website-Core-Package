const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const POLICY_PATH = path.join(ROOT_DIR, 'packages/school/MVC/services/school/studentCaseOperationPolicyService.js');

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

test('normalizeScopeMode maps student case scope ids', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);
  assert.equal(policy.normalizeScopeMode('SCP_OWNER'), 'owner');
  assert.equal(policy.normalizeScopeMode('SCP_DEPT'), 'department');
  assert.equal(policy.normalizeScopeMode('SCP_ORG'), 'organization');
  assert.equal(policy.normalizeScopeMode('SCP_ADMIN'), 'admin');
  assert.equal(policy.normalizeScopeMode('SCP_USER'), 'user');
});

test('canReadAtScope rejects USER scope', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);
  assert.equal(policy.canReadAtScope('SCP_USER'), false);
  assert.equal(policy.canReadAtScope('SCP_OWNER'), true);
  assert.equal(policy.canReadAtScope('SCP_DEPT'), true);
});

test('deriveAccessFlags splits READ, READ_ALL, mutation, and CONFIGURE permissions', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);

  const readOnlyDept = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'SCP_DEPT' },
    readAll: { allowed: true, scopeId: 'SCP_DEPT' },
    create: { allowed: false, scopeId: null },
    update: { allowed: false, scopeId: null },
    resolve: { allowed: false, scopeId: null },
    del: { allowed: false, scopeId: null },
    configure: { allowed: false, scopeId: null }
  }, {});

  assert.equal(readOnlyDept.canOpenList, true);
  assert.equal(readOnlyDept.canViewCases, true);
  assert.equal(readOnlyDept.canCreateCases, false);
  assert.equal(readOnlyDept.canUpdateCases, false);
  assert.equal(readOnlyDept.canResolveCases, false);
  assert.equal(readOnlyDept.canDeleteCases, false);
  assert.equal(readOnlyDept.canConfigureRouting, false);
});

test('deriveAccessFlags allows RESOLVE without UPDATE at department scope', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);
  const flags = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'SCP_DEPT' },
    readAll: { allowed: false, scopeId: null },
    create: { allowed: false, scopeId: null },
    update: { allowed: false, scopeId: null },
    resolve: { allowed: true, scopeId: 'SCP_DEPT' },
    del: { allowed: false, scopeId: null },
    configure: { allowed: false, scopeId: null }
  }, {});

  assert.equal(flags.canResolveCases, true);
  assert.equal(flags.canUpdateCases, false);
  assert.equal(flags.canOpenList, true);
  assert.equal(flags.canViewCases, false);
});

test('deriveAccessFlags splits READ page shell from READ_ALL list data', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);

  const readOnly = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'SCP_DEPT' },
    readAll: { allowed: false, scopeId: null },
    create: { allowed: false, scopeId: null },
    update: { allowed: false, scopeId: null },
    resolve: { allowed: false, scopeId: null },
    del: { allowed: false, scopeId: null },
    configure: { allowed: false, scopeId: null }
  }, {});

  assert.equal(readOnly.canOpenList, true);
  assert.equal(readOnly.canViewCases, false);
});

test('deriveAccessFlags grants OWNER READ_ALL list visibility', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);
  assert.equal(policy.canReadAllAtScope('SCP_OWNER'), true);

  const ownerReadAll = policy.deriveAccessFlags({
    read: { allowed: false, scopeId: null },
    readAll: { allowed: true, scopeId: 'SCP_OWNER' },
    create: { allowed: false, scopeId: null },
    update: { allowed: false, scopeId: null },
    resolve: { allowed: false, scopeId: null },
    del: { allowed: false, scopeId: null },
    configure: { allowed: false, scopeId: null }
  }, {});

  assert.equal(ownerReadAll.canViewCases, true);
  assert.equal(ownerReadAll.canOpenList, false);
});

test('deriveAccessFlags restricts CONFIGURE routing to ADMIN scope', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);

  const orgConfigure = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'SCP_ORG' },
    readAll: { allowed: true, scopeId: 'SCP_ORG' },
    create: { allowed: false, scopeId: null },
    update: { allowed: false, scopeId: null },
    resolve: { allowed: false, scopeId: null },
    del: { allowed: false, scopeId: null },
    configure: { allowed: true, scopeId: 'SCP_ORG' }
  }, {});

  const adminConfigure = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'SCP_ADMIN' },
    readAll: { allowed: true, scopeId: 'SCP_ADMIN' },
    create: { allowed: false, scopeId: null },
    update: { allowed: false, scopeId: null },
    resolve: { allowed: false, scopeId: null },
    del: { allowed: false, scopeId: null },
    configure: { allowed: true, scopeId: 'SCP_ADMIN' }
  }, {});

  assert.equal(orgConfigure.canConfigureRouting, false);
  assert.equal(adminConfigure.canConfigureRouting, true);
});

test('deriveAccessFlags exposes ADMIN locked-case override flags', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);

  const adminUpdate = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'SCP_ADMIN' },
    readAll: { allowed: true, scopeId: 'SCP_ADMIN' },
    create: { allowed: false, scopeId: null },
    update: { allowed: true, scopeId: 'SCP_ADMIN' },
    resolve: { allowed: false, scopeId: null },
    del: { allowed: false, scopeId: null },
    configure: { allowed: false, scopeId: null }
  }, {});

  const adminDelete = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'SCP_ADMIN' },
    readAll: { allowed: true, scopeId: 'SCP_ADMIN' },
    create: { allowed: false, scopeId: null },
    update: { allowed: false, scopeId: null },
    resolve: { allowed: false, scopeId: null },
    del: { allowed: true, scopeId: 'SCP_ADMIN' },
    configure: { allowed: false, scopeId: null }
  }, {});

  assert.equal(adminUpdate.canOverrideLockedCaseEdit, true);
  assert.equal(adminUpdate.canOverrideLockedCaseDelete, false);
  assert.equal(adminDelete.canOverrideLockedCaseDelete, true);
});

test('applyOperationPolicy rejects USER scope for READ', async () => {
  delete require.cache[POLICY_PATH];
  const originals = new Map();
  stubModule('../packages/school/MVC/services/school/schoolAdminAccessService', {
    async isAdminForRequestAsync() {
      return false;
    }
  }, originals);
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);

  const result = await policy.applyOperationPolicy({
    user: { id: 'USR_1' },
    operationId: 'READ',
    evaluation: { allowed: true, scopeId: 'SCP_USER' }
  });

  restoreModules(originals, [POLICY_PATH]);
  assert.equal(result.allowed, false);
  assert.match(result.reason || '', /USER scope/i);
});

test('applyOperationPolicy allows admin bypass on SCHOOL_SESSION_STUDENT_CASES', async () => {
  delete require.cache[POLICY_PATH];
  const originals = new Map();
  stubModule('../packages/school/MVC/services/school/schoolAdminAccessService', {
    async isAdminForRequestAsync(user, sectionId, operationId) {
      assert.equal(sectionId, 'SCHOOL_SESSION_STUDENT_CASES');
      assert.equal(operationId, 'UPDATE');
      return true;
    }
  }, originals);
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);

  const result = await policy.applyOperationPolicy({
    user: { id: 'USR_1', activeOrgId: 'ORG_1' },
    operationId: 'UPDATE',
    evaluation: { allowed: false, scopeId: null }
  });

  restoreModules(originals, [POLICY_PATH]);
  assert.equal(result.allowed, true);
  assert.equal(result.adminBypass, true);
});
