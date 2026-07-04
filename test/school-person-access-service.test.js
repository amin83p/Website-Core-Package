const test = require('node:test');
const assert = require('node:assert/strict');

const { requireCoreModule, constants } = require('../packages/school/MVC/services/school/schoolCoreContracts');
const dataService = requireCoreModule('MVC/services/dataService');
const personAccess = require('../packages/school/MVC/services/school/schoolPersonAccessService');

const originalFetchData = dataService.fetchData;
const originalGetDataById = dataService.getDataById;
const originalUpdateData = dataService.updateData;

function schoolUser() {
  return {
    id: 'USER_SCHOOL_ONLY',
    activeOrgId: 'ORG_1',
    activeProfile: {
      active: true,
      orgId: 'ORG_1',
      adminCategories: ['SCHOOL']
    }
  };
}

const personRows = [
  {
    id: 'PER_STUDENT',
    name: { first: 'Student', last: 'One' },
    organizations: [{ orgId: 'ORG_1', memberStatus: 'active', roles: ['member', 'school_student'] }]
  },
  {
    id: 'PER_TEACHER',
    firstName: 'Teacher',
    lastName: 'One',
    organizations: [{ orgId: 'ORG_1', memberStatus: 'active', roles: ['member', 'school_teacher'] }]
  },
  {
    id: 'PER_OTHER_ORG',
    name: { first: 'Other', last: 'Org' },
    organizations: [{ orgId: 'ORG_2', memberStatus: 'active', roles: ['member', 'school_student'] }]
  },
  {
    id: 'PER_INACTIVE',
    name: { first: 'Inactive', last: 'Person' },
    organizations: [{ orgId: 'ORG_1', memberStatus: 'inactive', roles: ['member', 'school_staff'] }]
  }
];

function withPatchedDataService(fn) {
  return async () => {
    dataService.fetchData = async (entityType, _query, requestingUser) => {
      if (entityType === 'persons') {
        assert.equal(requestingUser, constants.SYSTEM_CONTEXT);
        return personRows;
      }
      return [];
    };
    dataService.getDataById = async (entityType, id, requestingUser) => {
      assert.equal(requestingUser, constants.SYSTEM_CONTEXT);
      if (entityType === 'organizations' && id === 'ORG_1') return { id: 'ORG_1', name: 'School Org' };
      return null;
    };
    const updates = [];
    dataService.updateData = async (entityType, id, payload, requestingUser) => {
      updates.push({ entityType, id, payload, requestingUser });
      return { id, ...payload };
    };
    try {
      await fn(updates);
    } finally {
      dataService.fetchData = originalFetchData;
      dataService.getDataById = originalGetDataById;
      dataService.updateData = originalUpdateData;
    }
  };
}

test('school person access lists active org persons without core persons user access', withPatchedDataService(async () => {
  const rows = await personAccess.listActiveOrgPersons({
    reqUser: schoolUser(),
    requireSchoolRole: true
  });

  assert.deepEqual(rows.map((row) => row.id), ['PER_STUDENT', 'PER_TEACHER']);
}));

test('school person access applies role filters and exact single-person lookup', withPatchedDataService(async () => {
  const teachers = await personAccess.listActiveOrgPersons({
    reqUser: schoolUser(),
    requireSchoolRole: true,
    allowedSchoolRoles: ['teacher']
  });
  assert.deepEqual(teachers.map((row) => row.id), ['PER_TEACHER']);

  const sameOrgPerson = await personAccess.getPersonById({ reqUser: schoolUser(), personId: 'PER_STUDENT' });
  assert.equal(sameOrgPerson.id, 'PER_STUDENT');

  const otherOrgPerson = await personAccess.getPersonById({ reqUser: schoolUser(), personId: 'PER_OTHER_ORG' });
  assert.equal(otherOrgPerson, null);
}));

test('school person access updates school role memberships through system context', withPatchedDataService(async (updates) => {
  const result = await personAccess.ensurePersonHasSchoolRole({
    reqUser: schoolUser(),
    personId: 'PER_STUDENT',
    orgId: 'ORG_1',
    role: 'staff'
  });

  assert.equal(result.changed, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].entityType, 'persons');
  assert.equal(updates[0].id, 'PER_STUDENT');
  assert.equal(updates[0].requestingUser, constants.SYSTEM_CONTEXT);
  assert.ok(updates[0].payload.organizations[0].roles.includes('school_staff'));
}));
