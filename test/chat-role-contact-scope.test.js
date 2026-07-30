const test = require('node:test');
const assert = require('node:assert/strict');

const {
  READ_ONLY_REASON,
  buildRequesterContext,
  evaluateTargetContact
} = require('../MVC/services/chatContactScopeService');

const REGISTRY = {
  roles: [
    {
      id: 'ROL-SCHOOL-STUDENT',
      key: 'school_student',
      label: 'School Student',
      domain: 'school',
      packageName: 'SCHOOL',
      aliases: ['school-students'],
      active: true,
      system: true
    },
    {
      id: 'ROL-SCHOOL-TEACHER',
      key: 'school_teacher',
      label: 'School Teacher',
      domain: 'school',
      packageName: 'SCHOOL',
      aliases: ['schoolteachers'],
      active: true,
      system: true
    },
    {
      id: 'ROL-PTE-STUDENT',
      key: 'pte_student',
      label: 'PTE Student',
      domain: 'pte',
      packageName: 'PTE',
      aliases: ['ptestudent'],
      active: true,
      system: true
    },
    {
      id: 'ROL-CREDIT-CUSTOMER',
      key: 'credit_customer',
      label: 'Credit Customer',
      domain: 'credit',
      packageName: 'CREDIT',
      aliases: [],
      active: true,
      system: true
    },
    {
      id: 'ROL-FUTURE',
      key: 'future_reviewer',
      label: 'Future Reviewer',
      domain: 'future',
      packageName: 'FUTURE',
      aliases: ['future-reviewers'],
      active: false,
      system: true
    },
    {
      id: 'ROL-ADMIN',
      key: 'admin',
      label: 'Admin',
      domain: 'core',
      packageName: 'CORE',
      aliases: ['admins'],
      active: true,
      system: false
    }
  ],
  systemRoleAlias: {
    'school-students': 'school_student',
    schoolteachers: 'school_teacher',
    ptestudent: 'pte_student',
    'future-reviewers': 'future_reviewer'
  }
};

function membership(orgId, roles, memberStatus = 'active') {
  return {
    orgId,
    name: `Organization ${orgId}`,
    roles,
    role: roles[0] || 'member',
    memberStatus
  };
}

function person(id, organizations, overrides = {}) {
  return {
    id,
    active: true,
    organizations,
    ...overrides
  };
}

function user(id, personId, overrides = {}) {
  return {
    id,
    personId,
    active: true,
    status: 'active',
    ...overrides
  };
}

function contextFor(requesterPerson, overrides = {}) {
  return buildRequesterContext({
    requestingUser: {
      id: 'USER-REQUESTER',
      personId: requesterPerson?.id,
      activeOrgId: 'ORG-1',
      ...overrides
    },
    requesterPerson,
    registry: REGISTRY
  });
}

test('all canonical and alias roles in one package domain can contact each other', () => {
  const context = contextFor(person('PERSON-1', [
    membership('ORG-1', ['member', 'school-students'])
  ]));
  const decision = evaluateTargetContact(
    context,
    user('USER-2', 'PERSON-2', { roles: ['pte_student'] }),
    person('PERSON-2', [membership('ORG-1', ['member', 'schoolteachers'])])
  );

  assert.equal(context.eligible, true);
  assert.deepEqual(context.roleScope.packageDomains, ['school']);
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.matchingDomains, ['school']);
  assert.deepEqual(decision.targetRoleScope.packageRoles.map((role) => role.key), ['school_teacher']);
});

test('multiple package domains create a union without allowing unrelated packages or organizations', () => {
  const context = contextFor(person('PERSON-1', [
    membership('ORG-1', ['member', 'school_student', 'pte_student'])
  ]));

  const pteDecision = evaluateTargetContact(
    context,
    user('USER-PTE', 'PERSON-PTE'),
    person('PERSON-PTE', [membership('ORG-1', ['member', 'pte_student'])])
  );
  const creditDecision = evaluateTargetContact(
    context,
    user('USER-CREDIT', 'PERSON-CREDIT'),
    person('PERSON-CREDIT', [membership('ORG-1', ['member', 'credit_customer'])])
  );
  const otherOrgDecision = evaluateTargetContact(
    context,
    user('USER-OTHER', 'PERSON-OTHER'),
    person('PERSON-OTHER', [membership('ORG-2', ['member', 'school_teacher'])])
  );

  assert.equal(pteDecision.allowed, true);
  assert.equal(creditDecision.allowed, false);
  assert.equal(otherOrgDecision.allowed, false);
});

test('plain members see only plain members and unknown roles fail closed', () => {
  const context = contextFor(person('PERSON-1', [
    membership('ORG-1', ['member', 'admin'])
  ]));
  const plainDecision = evaluateTargetContact(
    context,
    user('USER-PLAIN', 'PERSON-PLAIN'),
    person('PERSON-PLAIN', [membership('ORG-1', ['member'])])
  );
  const packageDecision = evaluateTargetContact(
    context,
    user('USER-SCHOOL', 'PERSON-SCHOOL'),
    person('PERSON-SCHOOL', [membership('ORG-1', ['member', 'school_teacher'])])
  );
  const unknownDecision = evaluateTargetContact(
    context,
    user('USER-UNKNOWN', 'PERSON-UNKNOWN'),
    person('PERSON-UNKNOWN', [membership('ORG-1', ['member', 'mystery_operator'])])
  );

  assert.equal(context.roleScope.isPlain, true);
  assert.equal(plainDecision.allowed, true);
  assert.equal(packageDecision.allowed, false);
  assert.equal(unknownDecision.allowed, false);
  assert.deepEqual(unknownDecision.targetRoleScope.unknownTokens, ['mystery_operator']);
});

test('inactive memberships, Persons, and Users never become contacts', () => {
  const context = contextFor(person('PERSON-1', [
    membership('ORG-1', ['member', 'school_student'])
  ]));
  const inactiveMembership = evaluateTargetContact(
    context,
    user('USER-2', 'PERSON-2'),
    person('PERSON-2', [membership('ORG-1', ['member', 'school_teacher'], 'inactive')])
  );
  const inactivePerson = evaluateTargetContact(
    context,
    user('USER-3', 'PERSON-3'),
    person('PERSON-3', [membership('ORG-1', ['member', 'school_teacher'])], { active: false })
  );
  const inactiveUser = evaluateTargetContact(
    context,
    user('USER-4', 'PERSON-4', { status: 'suspended', active: false }),
    person('PERSON-4', [membership('ORG-1', ['member', 'school_teacher'])])
  );

  assert.equal(inactiveMembership.allowed, false);
  assert.equal(inactivePerson.allowed, false);
  assert.equal(inactiveUser.allowed, false);
});

test('disabled registered package roles remain package classifications', () => {
  const context = contextFor(person('PERSON-1', [
    membership('ORG-1', ['member', 'future-reviewers'])
  ]));
  const samePackage = evaluateTargetContact(
    context,
    user('USER-2', 'PERSON-2'),
    person('PERSON-2', [membership('ORG-1', ['member', 'future_reviewer'])])
  );
  const plain = evaluateTargetContact(
    context,
    user('USER-3', 'PERSON-3'),
    person('PERSON-3', [membership('ORG-1', ['member'])])
  );

  assert.equal(context.roleScope.isPlain, false);
  assert.deepEqual(context.roleScope.packageDomains, ['future']);
  assert.equal(samePackage.allowed, true);
  assert.equal(plain.allowed, false);
});

test('only the virtual Root bypasses role and organization scope', () => {
  const rootContext = buildRequesterContext({
    requestingUser: {
      id: 'ROOT_001',
      isVirtualSuperAdmin: true,
      activeOrgId: 'SYSTEM'
    },
    requesterPerson: null,
    registry: REGISTRY
  });
  const systemAdminContext = buildRequesterContext({
    requestingUser: {
      id: 'SYSTEM-ADMIN',
      isSystemAdmin: true,
      activeOrgId: 'SYSTEM',
      personId: 'PERSON-ADMIN'
    },
    requesterPerson: person('PERSON-ADMIN', []),
    registry: REGISTRY
  });
  const rootDecision = evaluateTargetContact(
    rootContext,
    user('USER-REMOTE', 'PERSON-REMOTE'),
    person('PERSON-REMOTE', [membership('ORG-9', ['member', 'credit_customer'])])
  );

  assert.equal(rootContext.bypass, true);
  assert.equal(rootDecision.allowed, true);
  assert.equal(systemAdminContext.eligible, false);
  assert.match(READ_ONLY_REASON, /read-only/i);
});
