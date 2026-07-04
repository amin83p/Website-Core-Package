const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SCOPE_MODES,
  buildSchoolListScope,
  resolveScopeModeFromName
} = require('../packages/school/MVC/services/school/schoolDataScopeBuilder');

function baseUser(overrides = {}) {
  return {
    id: 'USER_1',
    personId: 'PERSON_1',
    activeOrgId: 'ORG_1',
    ...overrides
  };
}

test('resolveScopeModeFromName maps scopes to expected modes', () => {
  assert.equal(resolveScopeModeFromName('ADMIN'), SCOPE_MODES.ORG_WIDE);
  assert.equal(resolveScopeModeFromName('ORGANIZATION'), SCOPE_MODES.ORG_WIDE);
  assert.equal(resolveScopeModeFromName('DEPARTMENT'), SCOPE_MODES.ASSIGNMENT);
  assert.equal(resolveScopeModeFromName('DIVISION'), SCOPE_MODES.ASSIGNMENT);
  assert.equal(resolveScopeModeFromName('OWNER'), SCOPE_MODES.OWNER);
  assert.equal(resolveScopeModeFromName('USER'), SCOPE_MODES.USER);
});

test('ADMIN and ORGANIZATION scopes are org-wide without owner or assignment filters', () => {
  const adminScope = buildSchoolListScope(baseUser(), { accessContext: { scopeId: 'SCP_ADMIN' } });
  assert.equal(adminScope.scopeMode, SCOPE_MODES.ORG_WIDE);
  assert.equal(adminScope.denyAll, false);
  assert.equal(adminScope.ownerScoped, false);
  assert.equal(adminScope.personId, null);

  const orgScope = buildSchoolListScope(baseUser(), { accessContext: { scopeId: 'SCP_ORG' } });
  assert.equal(orgScope.scopeMode, SCOPE_MODES.ORG_WIDE);
  assert.equal(orgScope.denyAll, false);
  assert.equal(orgScope.ownerScoped, false);
});

test('DEPARTMENT scope uses assignment mode with linked personId', () => {
  const scope = buildSchoolListScope(baseUser(), { accessContext: { scopeId: 'SCP_DEPT' } });
  assert.equal(scope.scopeMode, SCOPE_MODES.ASSIGNMENT);
  assert.equal(scope.personId, 'PERSON_1');
  assert.equal(scope.userId, 'USER_1');
  assert.equal(scope.denyAll, false);
});

test('DIVISION scope uses assignment mode with linked personId and userId', () => {
  const scope = buildSchoolListScope(baseUser(), { accessContext: { scopeId: 'SCP_DIV' } });
  assert.equal(scope.scopeMode, SCOPE_MODES.ASSIGNMENT);
  assert.equal(scope.personId, 'PERSON_1');
  assert.equal(scope.userId, 'USER_1');
  assert.equal(scope.denyAll, false);
});

test('OWNER scope uses creator userId only', () => {
  const scope = buildSchoolListScope(baseUser(), { accessContext: { scopeId: 'SCP_OWNER' } });
  assert.equal(scope.scopeMode, SCOPE_MODES.OWNER);
  assert.equal(scope.userId, 'USER_1');
  assert.equal(scope.ownerScoped, true);
  assert.equal(scope.personId, null);
});

test('USER scope denies all reads', () => {
  const scope = buildSchoolListScope(baseUser(), { accessContext: { scopeId: 'SCP_USER' } });
  assert.equal(scope.scopeMode, SCOPE_MODES.USER);
  assert.equal(scope.denyAll, true);
});
