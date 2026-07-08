const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const servicePath = path.resolve(__dirname, '../packages/school/MVC/services/school/schoolLinkedPersonProfileService.js');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const schoolPersonAccessService = require('../packages/school/MVC/services/school/schoolPersonAccessService');
const { requireCoreModule } = require('../packages/school/MVC/services/school/schoolCoreContracts');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const coreDataService = requireCoreModule('MVC/services/dataService');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function reloadService() {
  delete require.cache[servicePath];
  return require(servicePath);
}

function mockAdminAccess(allowed = true) {
  const originalSync = adminChekersService.isAdminForRequest;
  const originalAsync = adminChekersService.isAdminForRequestAsync;
  adminChekersService.isAdminForRequest = () => allowed;
  adminChekersService.isAdminForRequestAsync = async () => allowed;
  return () => {
    adminChekersService.isAdminForRequest = originalSync;
    adminChekersService.isAdminForRequestAsync = originalAsync;
  };
}

const reqUser = {
  id: 'USR-1',
  activeOrgId: 'ORG-1',
  allowedOrgs: [{ orgId: 'ORG-1', name: 'Test Org', roles: ['member', 'admin'] }]
};

test('toProfileDto maps person fields for modal consumption', () => {
  const service = reloadService();
  const dto = service.toProfileDto({
    id: 'PER-1',
    active: true,
    name: { first: 'Ada', middle: 'M', last: 'Lovelace', preferred: 'Ada L' },
    demographics: { gender: 'female', dateOfBirth: '1815-12-10' },
    contact: {
      emails: [{ type: 'primary', email: 'ada@example.com', isPrimary: true }],
      phones: [{ type: 'mobile', number: '555-0100' }]
    },
    addresses: [{ type: 'home', line1: '1 Main', city: 'London', province: 'ON', postalCode: 'N1N1N1' }],
    notes: 'Note',
    organizations: [{ orgId: 'ORG-1', roles: ['school_student'] }]
  });

  assert.equal(dto.id, 'PER-1');
  assert.equal(dto.firstName, 'Ada');
  assert.equal(dto.gender, 'female');
  assert.equal(dto.dateOfBirth, '1815-12-10');
  assert.equal(dto.emails[0].email, 'ada@example.com');
  assert.equal(dto.phones[0].number, '555-0100');
  assert.equal(dto.addresses[0].city, 'London');
  assert.equal(dto.organizations.length, 1);
});

test('assertLinkedPersonAccess rejects mismatched personId on edit link', async () => {
  const service = reloadService();
  const restoreAdmin = mockAdminAccess(true);
  const originalGetStudent = schoolDataService.getDataById;
  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'students' && id === 'STU-1') {
      return { id: 'STU-1', orgId: 'ORG-1', personId: 'PER-OTHER' };
    }
    return null;
  };
  try {
    await assert.rejects(
      () => service.assertLinkedPersonAccess({
        reqUser,
        personId: 'PER-1',
        linkType: 'student',
        linkId: 'STU-1',
        operation: 'UPDATE'
      }),
      /does not match/
    );
  } finally {
    schoolDataService.getDataById = originalGetStudent;
    restoreAdmin();
  }
});

test('assertLinkedPersonAccess allows create-mode eligible person', async () => {
  const service = reloadService();
  const restoreAdmin = mockAdminAccess(true);
  const originalGetPerson = schoolPersonAccessService.getPersonById;
  schoolPersonAccessService.getPersonById = async () => ({ id: 'PER-1', organizations: [] });
  try {
    const result = await service.assertLinkedPersonAccess({
      reqUser,
      personId: 'PER-1',
      linkType: 'student',
      linkId: '',
      operation: 'CREATE'
    });
    assert.equal(result.personId, 'PER-1');
    assert.equal(result.linkId, '');
  } finally {
    schoolPersonAccessService.getPersonById = originalGetPerson;
    restoreAdmin();
  }
});

test('updateLinkedPersonProfile preserves organizations and validates required profile fields', async () => {
  const service = reloadService();
  const restoreAdmin = mockAdminAccess(true);
  const originalGetStudent = schoolDataService.getDataById;
  const originalGetPerson = schoolPersonAccessService.getPersonById;
  const originalGetById = coreDataService.getDataById;
  const originalUpdate = coreDataService.updateData;

  const existingPerson = {
    id: 'PER-1',
    active: true,
    name: { first: 'Old', last: 'Name' },
    demographics: { gender: 'male', dateOfBirth: '2000-01-01' },
    contact: { emails: [{ type: 'primary', email: 'old@example.com', isPrimary: true }], phones: [] },
    addresses: [],
    organizations: [{ orgId: 'ORG-1', roles: ['member', 'school_student'], name: 'Test Org' }],
    manualTags: ['vip'],
    tags: ['vip'],
    avatarUrl: 'avatar.png',
    audit: { createUser: 'SYS', createDateTime: '2020-01-01T00:00:00.000Z' }
  };

  let storedPerson = JSON.parse(JSON.stringify(existingPerson));

  schoolDataService.getDataById = async (entityType, id) => {
    if (entityType === 'students' && id === 'STU-1') {
      return { id: 'STU-1', orgId: 'ORG-1', personId: 'PER-1' };
    }
    return null;
  };
  schoolPersonAccessService.getPersonById = async () => storedPerson;
  coreDataService.getDataById = async () => storedPerson;
  coreDataService.updateData = async (_type, _id, updates) => {
    storedPerson = { ...storedPerson, ...updates };
    return storedPerson;
  };

  try {
    await assert.rejects(
      () => service.updateLinkedPersonProfile({
        reqUser,
        personId: 'PER-1',
        linkType: 'student',
        linkId: 'STU-1',
        body: {
          firstName: 'New',
          lastName: 'Name',
          gender: '',
          dateOfBirth: '2000-01-01',
          emails: JSON.stringify([{ type: 'primary', email: 'new@example.com', isPrimary: true }]),
          phones: '[]',
          addresses: '[]',
          active: 'true'
        }
      }),
      /Gender is required/
    );

    const result = await service.updateLinkedPersonProfile({
      reqUser,
      personId: 'PER-1',
      linkType: 'student',
      linkId: 'STU-1',
      body: {
        firstName: 'New',
        lastName: 'Name',
        gender: 'female',
        dateOfBirth: '2001-02-03',
        emails: JSON.stringify([{ type: 'primary', email: 'new@example.com', isPrimary: true }]),
        phones: JSON.stringify([{ type: 'mobile', number: '555-9999' }]),
        addresses: JSON.stringify([{ type: 'home', line1: '9 Queen', city: 'Toronto', province: 'ON', postalCode: 'M5V2T6' }]),
        active: 'true',
        notes: 'Updated'
      }
    });

    assert.equal(result.displayName, 'New Name');
    assert.equal(result.person.gender, 'female');
    assert.equal(result.organizations[0].orgId, 'ORG-1');
    assert.deepEqual(result.organizations[0].roles, ['member', 'school_student']);
  } finally {
    schoolDataService.getDataById = originalGetStudent;
    schoolPersonAccessService.getPersonById = originalGetPerson;
    coreDataService.getDataById = originalGetById;
    coreDataService.updateData = originalUpdate;
    restoreAdmin();
  }
});

test('identity routes and forms expose linked person profile integration', () => {
  const routes = read('packages/school/MVC/routes/schoolIdentityRoutes.js');
  assert.match(routes, /linked-person\/:personId/);
  assert.match(routes, /linkedPersonCtrl\.getLinkedPersonProfile/);
  assert.match(routes, /linkedPersonCtrl\.patchLinkedPersonProfile/);

  const studentForm = read('packages/school/MVC/views/school/student/studentForm.ejs');
  const teacherForm = read('packages/school/MVC/views/school/teacher/teacherForm.ejs');
  const staffForm = read('packages/school/MVC/views/school/staff/staffForm.ejs');
  assert.match(studentForm, /btnEditPersonProfile/);
  assert.match(studentForm, /include\('\.\.\/partials\/personProfileEditModal'\)/);
  assert.match(teacherForm, /btnEditPersonProfile/);
  assert.match(staffForm, /btnEditPersonProfile/);
  assert.match(read('public/scripts/schoolPersonProfileModal.js'), /SchoolPersonProfileModal/);
});
