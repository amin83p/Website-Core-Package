const test = require('node:test');
const assert = require('node:assert/strict');

const dataService = require('../MVC/services/dataService');
const personRepository = require('../MVC/repositories/personRepository');
const userRepository = require('../MVC/repositories/userRepository');
const organizationRepository = require('../MVC/repositories/organizationRepository');
const personController = require('../MVC/controllers/personController');
const organizationController = require('../MVC/controllers/organizationController');
const organizationPurgeService = require('../MVC/services/organizationPurgeService');
const publicRegistrationService = require('../MVC/services/person/publicRegistrationService');
const packagePersonDependencyGuardService = require('../MVC/services/packagePersonDependencyGuardService');
const { createPtePublicJoinService } = require('../packages/pte/MVC/services/pte/ptePublicJoinService');

function createRestoreStack() {
  const restorers = [];
  return {
    stub(target, methodName, replacement) {
      const original = target[methodName];
      target[methodName] = replacement;
      restorers.push(() => {
        target[methodName] = original;
      });
    },
    restoreAll() {
      while (restorers.length) restorers.pop()();
    }
  };
}

function buildRegistryFixture() {
  return {
    roles: [
      {
        key: 'school_student',
        label: 'School Student',
        domain: 'school',
        packageName: 'SCHOOL',
        aliases: ['school-student'],
        active: true,
        system: true
      },
      {
        key: 'pte_student',
        label: 'PTE Student',
        domain: 'pte',
        packageName: 'PTE',
        aliases: ['pte-student'],
        active: true,
        system: true
      },
      {
        key: 'pte_student_public',
        label: 'PTE Student Public',
        domain: 'pte',
        packageName: 'PTE',
        aliases: ['pte-student-public'],
        active: true,
        system: true
      },
      {
        key: 'pte_teacher',
        label: 'PTE Teacher',
        domain: 'pte',
        packageName: 'PTE',
        aliases: ['pte-teacher'],
        active: true,
        system: true
      },
      {
        key: 'credit_customer',
        label: 'Credit Customer',
        domain: 'credit',
        packageName: 'CREDIT',
        aliases: ['credit-customer'],
        active: true,
        system: true
      },
      {
        key: 'future_member',
        label: 'Future Member',
        domain: 'future',
        packageName: 'FUTURE',
        aliases: ['future-member'],
        active: false,
        system: true
      },
      {
        key: 'core_service',
        label: 'Core Service',
        domain: 'core',
        packageName: 'CORE',
        aliases: [],
        active: true,
        system: true
      },
      {
        key: 'reviewer',
        label: 'Reviewer',
        domain: 'core',
        packageName: 'CORE',
        aliases: [],
        active: true,
        system: false
      }
    ],
    systemRoleAlias: {
      ptestudent: 'pte_student',
      schoolstudent: 'school_student'
    }
  };
}

test('registry guard detects package system roles, aliases, inactive memberships, and inactive role definitions', async () => {
  const registry = buildRegistryFixture();
  const person = {
    id: 'P-ROLE-1',
    organizations: [
      {
        orgId: 'ORG-1',
        name: 'Learning Org',
        memberStatus: 'inactive',
        roles: [
          'member',
          'school-student',
          'ptestudent',
          'pte_student_public',
          'pte-teacher',
          'credit_customer',
          'future-member'
        ]
      }
    ]
  };

  const assignments = packagePersonDependencyGuardService.collectPackageSystemRoleAssignments(person, registry);
  assert.deepEqual(assignments.map((row) => row.roleKey), [
    'school_student',
    'pte_student',
    'pte_student_public',
    'pte_teacher',
    'credit_customer',
    'future_member'
  ]);
  assert.ok(assignments.every((row) => row.memberStatus === 'inactive'));

  const blocks = await packagePersonDependencyGuardService.collectPersonDeleteBlocks(person, {
    roleRegistry: registry
  });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].statusCode, 409);
  assert.equal(blocks[0].code, 'PERSON_PACKAGE_ROLE_CONFLICT');
  assert.match(blocks[0].message, /PTE Student/);
  assert.match(blocks[0].message, /Learning Org/);
});

test('registry guard allows core, manual, member, and unknown non-system roles', async () => {
  const person = {
    id: 'P-ROLE-2',
    organizations: [{
      orgId: 'ORG-1',
      roles: ['member', 'reviewer', 'core_service', 'custom_local_role']
    }]
  };

  const blocks = await packagePersonDependencyGuardService.collectPersonDeleteBlocks(person, {
    roleRegistry: buildRegistryFixture()
  });
  assert.deepEqual(blocks, []);
});

test('central dataService deletion rejects a PTE role before linked-user lookup or repository removal', async () => {
  const stack = createRestoreStack();
  let linkedUserChecked = false;
  let removed = false;

  stack.stub(personRepository, 'getById', async () => ({
    id: 'P-PTE-1',
    organizations: [{ orgId: 'ORG-1', name: 'PTE Org', roles: ['member', 'pte_student'] }]
  }));
  stack.stub(userRepository, 'existsByPersonId', async () => {
    linkedUserChecked = true;
    return false;
  });
  stack.stub(personRepository, 'remove', async () => {
    removed = true;
  });

  try {
    await assert.rejects(
      () => dataService.deleteData('persons', 'P-PTE-1', { id: 'ADMIN' }),
      (error) => (
        error?.statusCode === 409
        && error?.code === 'PERSON_PACKAGE_ROLE_CONFLICT'
        && /pte_student/i.test(String(error?.message || ''))
      )
    );
    assert.equal(linkedUserChecked, false);
    assert.equal(removed, false);
  } finally {
    stack.restoreAll();
  }
});

test('central dataService deletion still removes a person without package roles or linked users', async () => {
  const stack = createRestoreStack();
  let removed = false;

  stack.stub(personRepository, 'getById', async () => ({
    id: 'P-PLAIN-1',
    organizations: [{ orgId: 'ORG-1', roles: ['member', 'reviewer'] }]
  }));
  stack.stub(userRepository, 'existsByPersonId', async () => false);
  stack.stub(personRepository, 'remove', async () => {
    removed = true;
    return { id: 'P-PLAIN-1' };
  });

  try {
    const result = await dataService.deleteData('persons', 'P-PLAIN-1', { id: 'ADMIN' });
    assert.equal(removed, true);
    assert.deepEqual(result, { id: 'P-PLAIN-1' });
  } finally {
    stack.restoreAll();
  }
});

test('Persons AJAX delete preserves the error response shape and returns 409', async () => {
  const stack = createRestoreStack();
  const response = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };

  stack.stub(dataService, 'getDataById', async () => ({
    id: 'P-PTE-2',
    organizations: [{ orgId: 'ORG-1', roles: ['pte_student'] }]
  }));
  stack.stub(dataService, 'deleteData', async () => {
    const error = new Error('PTE package role must be removed.');
    error.statusCode = 409;
    throw error;
  });

  try {
    await personController.deletePerson({
      params: { id: 'P-PTE-2' },
      user: { id: 'ADMIN' },
      headers: { 'x-ajax-request': '1' }
    }, response);
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.payload, {
      status: 'error',
      message: 'PTE package role must be removed.'
    });
  } finally {
    stack.restoreAll();
  }
});

test('organization purge preflight blocks package-role persons before any deletion', async () => {
  const stack = createRestoreStack();
  let personDeleteCalled = false;
  let organizationDeleteCalled = false;

  stack.stub(organizationRepository, 'getById', async () => ({
    id: 'ORG-PURGE-1',
    identity: { displayName: 'Protected Org' }
  }));
  stack.stub(personRepository, 'findByOrganizationId', async () => [{
    id: 'P-PURGE-1',
    name: { first: 'Protected', last: 'Student' },
    organizations: [{
      orgId: 'ORG-PURGE-1',
      name: 'Protected Org',
      roles: ['member', 'pte_student']
    }]
  }]);
  stack.stub(userRepository, 'findByPersonId', async () => []);
  stack.stub(dataService, 'deleteData', async () => {
    personDeleteCalled = true;
  });
  stack.stub(organizationRepository, 'remove', async () => {
    organizationDeleteCalled = true;
  });

  try {
    await assert.rejects(
      () => organizationPurgeService.executeOrganizationPurge('ORG-PURGE-1', { id: 'ADMIN' }, {
        confirmName: 'Protected Org'
      }),
      (error) => error?.statusCode === 409 && /organization purge blocked/i.test(error.message)
    );
    assert.equal(personDeleteCalled, false);
    assert.equal(organizationDeleteCalled, false);
  } finally {
    stack.restoreAll();
  }
});

test('organization purge controller preserves a package conflict as HTTP 409', async () => {
  const stack = createRestoreStack();
  const response = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
  stack.stub(organizationPurgeService, 'executeOrganizationPurge', async () => {
    const error = new Error('Organization purge blocked by package roles.');
    error.code = 'PERSON_PACKAGE_ROLE_CONFLICT';
    error.statusCode = 409;
    throw error;
  });

  try {
    await organizationController.purgeOrganization({
      params: { id: 'ORG-1' },
      body: { confirmName: 'Org One' },
      user: { id: 'ADMIN' }
    }, response);
    assert.equal(response.statusCode, 409);
    assert.equal(response.payload.status, 'error');
    assert.equal(response.payload.code, 'PERSON_PACKAGE_ROLE_CONFLICT');
  } finally {
    stack.restoreAll();
  }
});

test('transient person rollback removes package roles before guarded deletion', async () => {
  const stack = createRestoreStack();
  const calls = [];
  const person = {
    id: 'P-ROLLBACK-1',
    organizations: [{
      orgId: 'ORG-1',
      roles: ['member', 'pte_student_public'],
      role: 'member',
      roleKey: 'pte_student_public'
    }]
  };

  stack.stub(dataService, 'updateData', async (entityType, id, payload) => {
    calls.push({ operation: 'update', entityType, id, payload });
    return payload;
  });
  stack.stub(dataService, 'deleteData', async (entityType, id) => {
    calls.push({ operation: 'delete', entityType, id });
    return { id };
  });

  try {
    await publicRegistrationService.rollbackTransientPerson(person, { id: 'SYSTEM' });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].operation, 'update');
    assert.deepEqual(calls[0].payload.organizations[0].roles, ['member']);
    assert.equal(calls[0].payload.organizations[0].roleKey, undefined);
    assert.equal(calls[1].operation, 'delete');
  } finally {
    stack.restoreAll();
  }
});

test('failed PTE guest applicant creation uses rollback helper after deleting the temporary user', async () => {
  const calls = [];
  const publicRegistrationMock = {
    resolveFreeOrgSettingId: () => 900000,
    resolveOrgNameById: async () => 'PTE Public',
    async registerPublicPersonAndUser() {
      return {
        person: {
          id: 'P-PTE-ROLLBACK',
          organizations: [{ orgId: 900000, roles: ['member', 'pte_student_public'] }]
        },
        user: { id: 'U-PTE-ROLLBACK' },
        systemUserContext: { id: 'SYSTEM' }
      };
    },
    async rollbackTransientPerson(person) {
      calls.push(`rollback:${person.id}`);
    }
  };
  const service = createPtePublicJoinService({
    publicRegistrationService: publicRegistrationMock,
    dataService: {
      async deleteData(entityType, id) {
        calls.push(`delete:${entityType}:${id}`);
      }
    },
    pteStudentDataService: {
      PERSON_ORG_ROLE_PUBLIC_TOKEN: 'pte_student_public',
      async createPublicApplicantFromJoin() {
        throw new Error('Applicant creation failed.');
      }
    }
  });

  await assert.rejects(
    () => service.registerGuestPtePublic({ firstName: 'Rollback' }),
    /Applicant creation failed/
  );
  assert.deepEqual(calls, [
    'delete:users:U-PTE-ROLLBACK',
    'rollback:P-PTE-ROLLBACK'
  ]);
});
