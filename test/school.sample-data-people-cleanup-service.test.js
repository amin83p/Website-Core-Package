const test = require('node:test');
const assert = require('node:assert/strict');

const schoolSampleDataService = require('../MVC/services/school/schoolSampleDataService');
const schoolRepositories = require('../MVC/repositories/school');
const schoolDataService = require('../MVC/services/school/schoolDataService');
const dataServiceGlobal = require('../MVC/services/dataService');

function createRepoState() {
  return {
    students: [],
    teachers: [],
    staff: [],
    accounts: [],
    personsById: {}
  };
}

function installServiceStubs(state, options = {}) {
  const originals = {
    studentsList: schoolRepositories.students.list,
    studentsPurgeById: schoolRepositories.students.purgeById,
    teachersList: schoolRepositories.teachers.list,
    teachersPurgeById: schoolRepositories.teachers.purgeById,
    staffList: schoolRepositories.staff.list,
    staffPurgeById: schoolRepositories.staff.purgeById,
    accountsList: schoolRepositories.schoolAccounts.list,
    accountsPurgeById: schoolRepositories.schoolAccounts.purgeById,
    getDataById: dataServiceGlobal.getDataById,
    updateData: dataServiceGlobal.updateData,
    deleteData: dataServiceGlobal.deleteData
  };

  const removeById = (rows, id) => {
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) return false;
    const [removed] = rows.splice(index, 1);
    return removed || false;
  };

  schoolRepositories.students.list = async () => state.students;
  schoolRepositories.students.purgeById = async (id) => {
    if (typeof options.onPurgeStudent === 'function') return options.onPurgeStudent(id, state);
    return removeById(state.students, id);
  };
  schoolRepositories.teachers.list = async () => state.teachers;
  schoolRepositories.teachers.purgeById = async (id) => {
    if (typeof options.onPurgeTeacher === 'function') return options.onPurgeTeacher(id, state);
    return removeById(state.teachers, id);
  };
  schoolRepositories.staff.list = async () => state.staff;
  schoolRepositories.staff.purgeById = async (id) => {
    if (typeof options.onPurgeStaff === 'function') return options.onPurgeStaff(id, state);
    return removeById(state.staff, id);
  };
  schoolRepositories.schoolAccounts.list = async () => state.accounts;
  schoolRepositories.schoolAccounts.purgeById = async (id) => {
    if (typeof options.onPurgeAccount === 'function') return options.onPurgeAccount(id, state);
    return removeById(state.accounts, id);
  };

  dataServiceGlobal.getDataById = async (entityType, id) => {
    if (entityType !== 'persons') return null;
    return state.personsById[String(id)] || null;
  };
  dataServiceGlobal.updateData = async (entityType, id, patch) => {
    if (entityType !== 'persons') return null;
    const existing = state.personsById[String(id)];
    if (!existing) throw new Error('Person not found');
    state.personsById[String(id)] = { ...existing, ...patch };
    return state.personsById[String(id)];
  };
  dataServiceGlobal.deleteData = async (entityType, id) => {
    if (entityType !== 'persons') return null;
    if (typeof options.onDeletePerson === 'function') return options.onDeletePerson(id, state);
    const existing = state.personsById[String(id)];
    if (!existing) return false;
    delete state.personsById[String(id)];
    return existing;
  };

  return () => {
    schoolRepositories.students.list = originals.studentsList;
    schoolRepositories.students.purgeById = originals.studentsPurgeById;
    schoolRepositories.teachers.list = originals.teachersList;
    schoolRepositories.teachers.purgeById = originals.teachersPurgeById;
    schoolRepositories.staff.list = originals.staffList;
    schoolRepositories.staff.purgeById = originals.staffPurgeById;
    schoolRepositories.schoolAccounts.list = originals.accountsList;
    schoolRepositories.schoolAccounts.purgeById = originals.accountsPurgeById;
    dataServiceGlobal.getDataById = originals.getDataById;
    dataServiceGlobal.updateData = originals.updateData;
    dataServiceGlobal.deleteData = originals.deleteData;
  };
}

test('generate sample people assigns canonical school role tokens to person memberships', async () => {
  const originals = {
    globalAddData: dataServiceGlobal.addData,
    schoolFetchData: schoolDataService.fetchData,
    schoolAddData: schoolDataService.addData
  };
  const createdPersons = [];

  dataServiceGlobal.addData = async (entityType, payload) => {
    assert.equal(entityType, 'persons');
    const person = { ...payload, id: `P-${createdPersons.length + 1}` };
    createdPersons.push(person);
    return person;
  };
  schoolDataService.fetchData = async (entityType) => {
    if (entityType === 'departments') return [];
    return [];
  };
  schoolDataService.addData = async (entityType, payload) => ({
    ...payload,
    id: `${String(entityType || '').toUpperCase()}-${createdPersons.length}`
  });

  try {
    await schoolSampleDataService.generateSampleSchoolPeople({
      orgId: 'ORG-1',
      reqUser: {
        id: 'U-1',
        allowedOrgs: [{ orgId: 'ORG-1', name: 'Main School' }]
      },
      studentCount: 1,
      teacherCount: 1,
      staffCount: 1,
      createLinkedAccounts: false
    });

    assert.deepEqual(createdPersons.map((person) => person.organizations[0].roles[1]), [
      'school_student',
      'school_teacher',
      'school_staff'
    ]);
  } finally {
    dataServiceGlobal.addData = originals.globalAddData;
    schoolDataService.fetchData = originals.schoolFetchData;
    schoolDataService.addData = originals.schoolAddData;
  }
});

test('preview returns sample-only candidates and role diagnostics (active + archived role rows)', async () => {
  const state = createRepoState();
  state.students = [
    { id: 'STU-1', orgId: 'ORG-1', personId: 'P-1', localId: 'SMP-STU-1', academicStatus: 'Active', notes: 'Generated sample student.', studentAccountId: 'ACC-1' },
    { id: 'STU-2', orgId: 'ORG-1', personId: 'P-2', localId: 'REAL-02', academicStatus: 'Archived', notes: 'Normal student', studentAccountId: '' }
  ];
  state.teachers = [
    { id: 'TCH-1', orgId: 'ORG-1', personId: 'P-3', employeeNumber: 'SMP-TCH-7', status: 'Archived', notes: 'Generated sample teacher.', teacherAccountId: '' }
  ];
  state.staff = [
    { id: 'STF-1', orgId: 'ORG-1', personId: 'P-4', employeeNumber: 'SMP-STF-8', status: 'Active', notes: 'Generated sample staff.', staffAccountId: '' }
  ];
  state.accounts = [{ id: 'ACC-1', orgId: 'ORG-1', name: 'Student A Account', status: 'active' }];
  state.personsById = {
    'P-1': {
      id: 'P-1',
      active: true,
      name: { first: 'Stu', last: 'One' },
      contact: { email: 'stu1@example.com' },
      organizations: [{ orgId: 'ORG-1', roles: ['school_student', 'pte_student'] }]
    },
    'P-3': { id: 'P-3', active: true, name: { first: 'Teach', last: 'One' }, contact: { email: 'teach1@example.com' }, organizations: [] },
    'P-4': { id: 'P-4', active: false, name: { first: 'Staff', last: 'One' }, contact: { email: 'staff1@example.com' }, organizations: [] }
  };

  const restore = installServiceStubs(state);
  try {
    const preview = await schoolSampleDataService.buildSamplePeopleDeletePreview({ orgId: 'ORG-1', reqUser: { id: 'U-1' } });
    assert.equal(preview.summary.students, 1);
    assert.equal(preview.summary.teachers, 1);
    assert.equal(preview.summary.staff, 1);
    assert.equal(preview.summary.persons, 3);
    assert.equal(preview.groups.students[0].id, 'STU-1');
    assert.equal(preview.groups.teachers[0].statusKey, 'archived');
    const personP1 = preview.groups.persons.find((row) => row.id === 'P-1');
    assert.equal(personP1.hasOtherRoles, true);
    assert.ok(personP1.schoolRoles.includes('school_student'));
    assert.ok(personP1.otherRoles.includes('pte_student'));
  } finally {
    restore();
  }
});

test('execute rejects selected ids outside candidate set', async () => {
  const state = createRepoState();
  state.students = [{ id: 'STU-1', orgId: 'ORG-1', personId: 'P-1', localId: 'SMP-STU-1', academicStatus: 'Active', notes: 'Generated sample student.', studentAccountId: '' }];
  state.personsById = {
    'P-1': { id: 'P-1', active: true, name: { first: 'A', last: 'B' }, contact: {}, organizations: [] }
  };
  const restore = installServiceStubs(state);
  try {
    await assert.rejects(
      () => schoolSampleDataService.deleteSelectedSamplePeople({
        orgId: 'ORG-1',
        reqUser: { id: 'U-1' },
        studentIds: ['STU-404'],
        teacherIds: [],
        staffIds: [],
        personIds: []
      }),
      /no longer valid in the sample preview scope/i
    );
  } finally {
    restore();
  }
});

test('selected person with remaining non-school roles is retained with skipped reason', async () => {
  const state = createRepoState();
  state.students = [{ id: 'STU-1', orgId: 'ORG-1', personId: 'P-1', localId: 'SMP-STU-1', academicStatus: 'Active', notes: 'Generated sample student.', studentAccountId: '' }];
  state.personsById = {
    'P-1': {
      id: 'P-1',
      active: true,
      name: { first: 'A', last: 'B' },
      contact: {},
      organizations: [{ orgId: 'ORG-1', roles: ['school_student', 'pte_student'] }]
    }
  };
  const restore = installServiceStubs(state);
  try {
    const result = await schoolSampleDataService.deleteSelectedSamplePeople({
      orgId: 'ORG-1',
      reqUser: { id: 'U-1' },
      studentIds: ['STU-1'],
      teacherIds: [],
      staffIds: [],
      personIds: ['P-1']
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.summary.succeeded.students, 1);
    assert.equal(result.summary.skipped.persons, 1);
    assert.ok(state.personsById['P-1']);
    assert.ok(
      result.results.some((row) => row.group === 'persons'
        && row.id === 'P-1'
        && row.status === 'skipped'
        && /non-school roles detected/i.test(String(row.message || '')))
    );
  } finally {
    restore();
  }
});

test('selected person with only school-safe roles is deleted', async () => {
  const state = createRepoState();
  state.staff = [{ id: 'STF-1', orgId: 'ORG-1', personId: 'P-1', employeeNumber: 'SMP-STF-1', status: 'Active', notes: 'Generated sample staff.', staffAccountId: '' }];
  state.personsById = {
    'P-1': {
      id: 'P-1',
      active: true,
      name: { first: 'A', last: 'B' },
      contact: {},
      organizations: [{ orgId: 'ORG-1', roles: ['school-staff', 'school_teacher'] }]
    }
  };
  const restore = installServiceStubs(state);
  try {
    const result = await schoolSampleDataService.deleteSelectedSamplePeople({
      orgId: 'ORG-1',
      reqUser: { id: 'U-1' },
      studentIds: [],
      teacherIds: [],
      staffIds: ['STF-1'],
      personIds: ['P-1']
    });
    assert.equal(result.summary.succeeded.staff, 1);
    assert.equal(result.summary.succeeded.persons, 1);
    assert.equal(state.personsById['P-1'], undefined);
  } finally {
    restore();
  }
});

test('role normalization aliases and casing are canonicalized in person diagnostics', async () => {
  const state = createRepoState();
  state.staff = [{ id: 'STF-1', orgId: 'ORG-1', personId: 'P-1', employeeNumber: 'SMP-STF-1', status: 'Active', notes: 'Generated sample staff.', staffAccountId: '' }];
  state.personsById = {
    'P-1': {
      id: 'P-1',
      active: true,
      name: { first: 'A', last: 'B' },
      contact: {},
      organizations: [
        { orgId: 'ORG-1', roles: ['School-Staff', 'SCHOOL_staff', 'school teachers', ' MEMBER '] },
        { orgId: 'ORG-2', role: 'PTE-Student' }
      ]
    }
  };
  const restore = installServiceStubs(state);
  try {
    const preview = await schoolSampleDataService.buildSamplePeopleDeletePreview({ orgId: 'ORG-1', reqUser: { id: 'U-1' } });
    const person = preview.groups.persons.find((row) => row.id === 'P-1');
    assert.ok(person);
    assert.equal(person.hasOtherRoles, true);
    assert.ok(person.schoolRoles.includes('school_staff'));
    assert.ok(person.schoolRoles.includes('school_teacher'));
    assert.ok(person.schoolRoles.includes('member'));
    assert.ok(person.otherRoles.includes('pte_student'));
    assert.equal(person.schoolRoles.filter((token) => token === 'school_staff').length, 1);
  } finally {
    restore();
  }
});

test('if school role row deletion fails, person deletion is blocked and skipped', async () => {
  const state = createRepoState();
  state.students = [{ id: 'STU-1', orgId: 'ORG-1', personId: 'P-1', localId: 'SMP-STU-1', academicStatus: 'Active', notes: 'Generated sample student.', studentAccountId: '' }];
  state.personsById = {
    'P-1': { id: 'P-1', active: true, name: { first: 'A', last: 'B' }, contact: {}, organizations: [] }
  };
  const restore = installServiceStubs(state, {
    onPurgeStudent: async () => {
      throw new Error('Student purge failed');
    }
  });
  try {
    const result = await schoolSampleDataService.deleteSelectedSamplePeople({
      orgId: 'ORG-1',
      reqUser: { id: 'U-1' },
      studentIds: ['STU-1'],
      teacherIds: [],
      staffIds: [],
      personIds: ['P-1']
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.summary.failed.students, 1);
    assert.equal(result.summary.skipped.persons, 1);
    assert.ok(state.personsById['P-1']);
    assert.ok(result.results.some((row) => row.group === 'persons' && row.status === 'skipped' && /linked role rows could not be deleted/i.test(String(row.message || ''))));
  } finally {
    restore();
  }
});

test('person delete linked-user constraint is reported as partial', async () => {
  const state = createRepoState();
  state.students = [{ id: 'STU-1', orgId: 'ORG-1', personId: 'P-1', localId: 'SMP-STU-1', academicStatus: 'Active', notes: 'Generated sample student.', studentAccountId: '' }];
  state.personsById = {
    'P-1': { id: 'P-1', active: true, name: { first: 'A', last: 'B' }, contact: {}, organizations: [] }
  };
  const restore = installServiceStubs(state, {
    onDeletePerson: async () => {
      throw new Error('Cannot delete Person because linked User exists.');
    }
  });
  try {
    const result = await schoolSampleDataService.deleteSelectedSamplePeople({
      orgId: 'ORG-1',
      reqUser: { id: 'U-1' },
      studentIds: ['STU-1'],
      teacherIds: [],
      staffIds: [],
      personIds: ['P-1']
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.summary.failed.persons, 1);
    assert.ok(result.results.some((row) => row.group === 'persons' && /linked user/i.test(String(row.message || ''))));
  } finally {
    restore();
  }
});

test('selected missing person is reported as already absent after linked school row cleanup', async () => {
  const state = createRepoState();
  state.students = [{ id: 'STU-1', orgId: 'ORG-1', personId: 'P-MISSING', localId: 'SMP-STU-1', academicStatus: 'Active', notes: 'Generated sample student.', studentAccountId: '' }];
  const restore = installServiceStubs(state);
  try {
    const result = await schoolSampleDataService.deleteSelectedSamplePeople({
      orgId: 'ORG-1',
      reqUser: { id: 'U-1' },
      studentIds: ['STU-1'],
      teacherIds: [],
      staffIds: [],
      personIds: ['P-MISSING']
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.summary.succeeded.students, 1);
    assert.equal(result.summary.failed.persons, 0);
    assert.equal(result.summary.skipped.persons, 1);
    assert.ok(result.results.some((row) => row.group === 'persons'
      && row.id === 'P-MISSING'
      && row.status === 'skipped'
      && /already absent/i.test(String(row.message || ''))));
  } finally {
    restore();
  }
});

test('shared linked-account owner outside selection is skipped and reported', async () => {
  const state = createRepoState();
  state.students = [{ id: 'STU-1', orgId: 'ORG-1', personId: 'P-1', localId: 'SMP-STU-1', academicStatus: 'Active', notes: 'Generated sample student.', studentAccountId: 'ACC-1' }];
  state.teachers = [{ id: 'TCH-1', orgId: 'ORG-1', personId: 'P-2', employeeNumber: 'SMP-TCH-1', status: 'Active', notes: 'Generated sample teacher.', teacherAccountId: 'ACC-1' }];
  state.accounts = [{ id: 'ACC-1', orgId: 'ORG-1', name: 'Shared Account', status: 'active' }];
  state.personsById = {
    'P-1': { id: 'P-1', active: true, name: { first: 'S', last: 'One' }, contact: {}, organizations: [] },
    'P-2': { id: 'P-2', active: true, name: { first: 'T', last: 'One' }, contact: {}, organizations: [] }
  };

  let accountDeleteAttempts = 0;
  const restore = installServiceStubs(state, {
    onPurgeAccount: async (id) => {
      accountDeleteAttempts += 1;
      return { id };
    }
  });
  try {
    const result = await schoolSampleDataService.deleteSelectedSamplePeople({
      orgId: 'ORG-1',
      reqUser: { id: 'U-1' },
      studentIds: ['STU-1'],
      teacherIds: [],
      staffIds: [],
      personIds: ['P-1']
    });
    assert.equal(result.summary.failed.accounts, 1);
    assert.equal(accountDeleteAttempts, 0);
    assert.ok(result.results.some((row) => row.group === 'accounts' && /unselected role rows/i.test(String(row.message || ''))));
  } finally {
    restore();
  }
});
