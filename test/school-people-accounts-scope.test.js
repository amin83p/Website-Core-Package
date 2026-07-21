const test = require('node:test');
const assert = require('node:assert/strict');

const { SCOPE_MODES, buildSchoolListScope } = require('../packages/school/MVC/services/school/schoolDataScopeBuilder');
const { __scopeTestHelpers } = require('../packages/school/MVC/repositories/school');

const { isRecordVisibleUnderScope, applyOrgScope } = __scopeTestHelpers;

function divisionScope(overrides = {}) {
  return {
    denyAll: false,
    canViewAll: false,
    activeOrgId: 'ORG_1',
    scopeMode: SCOPE_MODES.ASSIGNMENT,
    scopeName: 'DIVISION',
    personId: 'PERSON_1',
    userId: 'USER_1',
    linkedAccountIds: [],
    ...overrides
  };
}

test('division scope on teachers shows own person row or owner-created row only', () => {
  const scope = divisionScope();
  const rows = [
    { id: 'T1', orgId: 'ORG_1', personId: 'PERSON_1' },
    { id: 'T2', orgId: 'ORG_1', personId: 'PERSON_2', audit: { createUser: 'USER_1' } },
    { id: 'T3', orgId: 'ORG_1', personId: 'PERSON_2', audit: { createUser: 'OTHER' } }
  ];
  const visible = applyOrgScope(rows, scope, { assignmentScopeKind: 'personId' });
  assert.deepEqual(visible.map((row) => row.id).sort(), ['T1', 'T2']);
});

test('division scope on staff uses personId assignment kind', () => {
  const scope = divisionScope({ personId: 'PERSON_STAFF' });
  const rows = [
    { id: 'S1', orgId: 'ORG_1', personId: 'PERSON_STAFF' },
    { id: 'S2', orgId: 'ORG_1', personId: 'PERSON_OTHER' }
  ];
  const visible = applyOrgScope(rows, scope, { assignmentScopeKind: 'personId' });
  assert.deepEqual(visible.map((row) => row.id), ['S1']);
});

test('division scope on students uses personId assignment kind', () => {
  const scope = divisionScope({ personId: 'PERSON_STUDENT' });
  const rows = [
    { id: 'ST1', orgId: 'ORG_1', personId: 'PERSON_STUDENT' },
    { id: 'ST2', orgId: 'ORG_1', personId: 'PERSON_OTHER', ownerUserId: 'USER_1' },
    { id: 'ST3', orgId: 'ORG_1', personId: 'PERSON_OTHER' }
  ];
  const visible = applyOrgScope(rows, scope, { assignmentScopeKind: 'personId' });
  assert.deepEqual(visible.map((row) => row.id).sort(), ['ST1', 'ST2']);
});

test('division scope on school accounts shows linked party account or owner-created account', () => {
  const scope = divisionScope({ linkedAccountIds: ['ACC_LINKED'] });
  const rows = [
    { id: 'ACC_LINKED', orgId: 'ORG_1', name: 'My Teacher Account' },
    { id: 'ACC_CREATED', orgId: 'ORG_1', name: 'Created Account', audit: { createUser: 'USER_1' } },
    { id: 'ACC_OTHER', orgId: 'ORG_1', name: 'Other Account' }
  ];
  const visible = applyOrgScope(rows, scope, { assignmentScopeKind: 'partyAccounts' });
  assert.deepEqual(visible.map((row) => row.id).sort(), ['ACC_CREATED', 'ACC_LINKED']);
});

test('isRecordVisibleUnderScope allows assignment OR owner for division', () => {
  const scope = divisionScope();
  assert.equal(
    isRecordVisibleUnderScope({ personId: 'PERSON_1' }, scope, { assignmentScopeKind: 'personId' }),
    true
  );
  assert.equal(
    isRecordVisibleUnderScope({ personId: 'OTHER', audit: { createUser: 'USER_1' } }, scope, { assignmentScopeKind: 'personId' }),
    true
  );
  assert.equal(
    isRecordVisibleUnderScope({ personId: 'OTHER', audit: { createUser: 'OTHER_USER' } }, scope, { assignmentScopeKind: 'personId' }),
    false
  );
});

test('buildSchoolListScope for DIVISION includes userId for owner-inclusive reads', () => {
  const scope = buildSchoolListScope(
    { id: 'USER_1', personId: 'PERSON_1', activeOrgId: 'ORG_1' },
    { accessContext: { scopeId: 'SCP_DIV' } }
  );
  assert.equal(scope.scopeMode, SCOPE_MODES.ASSIGNMENT);
  assert.equal(scope.personId, 'PERSON_1');
  assert.equal(scope.userId, 'USER_1');
});

test('OWNER scope includes personId so subject-keyed rows can match', () => {
  const scope = buildSchoolListScope(
    { id: 'USER_ELLA', personId: 'PERSON_ELLA', activeOrgId: 'ORG_1' },
    { accessContext: { scopeId: 'SCP_OWNER' } }
  );
  assert.equal(scope.scopeMode, SCOPE_MODES.OWNER);
  assert.equal(scope.personId, 'PERSON_ELLA');
  assert.equal(scope.userId, 'USER_ELLA');
});

test('timesheet OWNER scope shows rows by teacherId even when owned by another user', () => {
  const scope = {
    denyAll: false,
    canViewAll: false,
    activeOrgId: 'ORG_1',
    scopeMode: SCOPE_MODES.OWNER,
    scopeName: 'OWNER',
    personId: 'PERSON_ELLA',
    userId: 'USER_ELLA'
  };
  const rows = [
    { id: 'TS_OWN', orgId: 'ORG_1', teacherId: 'PERSON_ELLA', status: 'submitted', audit: { createUser: 'OT_001' } },
    { id: 'TS_OTHER', orgId: 'ORG_1', teacherId: 'PERSON_OTHER', status: 'submitted', audit: { createUser: 'OT_001' } },
    { id: 'TS_CREATED', orgId: 'ORG_1', teacherId: 'PERSON_OTHER', status: 'draft', audit: { createUser: 'USER_ELLA' } }
  ];
  const visible = applyOrgScope(rows, scope, { assignmentScopeKind: 'teacherId' });
  assert.deepEqual(visible.map((row) => row.id).sort(), ['TS_CREATED', 'TS_OWN']);
});

test('timesheet ASSIGNMENT scope matches teacherId subject rows', () => {
  const scope = divisionScope({ personId: 'PERSON_ELLA' });
  const rows = [
    { id: 'TS1', orgId: 'ORG_1', teacherId: 'PERSON_ELLA', status: 'submitted' },
    { id: 'TS2', orgId: 'ORG_1', teacherId: 'PERSON_OTHER', status: 'submitted' }
  ];
  const visible = applyOrgScope(rows, scope, { assignmentScopeKind: 'teacherId' });
  assert.deepEqual(visible.map((row) => row.id), ['TS1']);
});
