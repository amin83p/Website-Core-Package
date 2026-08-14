const test = require('node:test');
const assert = require('node:assert/strict');

const { createSchoolEntityPickerService } = require('../MVC/services/school/schoolEntityPickerService');

function buildService(fixtures = {}) {
  const data = {
    departments: [
      { id: 'DEP_LANG', orgId: 'ORG_1', code: 'LANG', name: 'Language', status: 'active' },
      { id: 'DEP_JOB', orgId: 'ORG_1', code: 'JOB', name: 'Employment', status: 'active' },
      { id: 'DEP_ARCH', orgId: 'ORG_1', code: 'OLD', name: 'Archived', status: 'archived' },
      { id: 'DEP_OTHER', orgId: 'ORG_2', code: 'OTH', name: 'Other Org', status: 'active' }
    ],
    classes: [
      { id: 'CLS_A', orgId: 'ORG_1', title: 'CLB 4 Morning', deliveryDepartmentId: 'DEP_LANG', deliveryDepartmentName: 'Language', status: 'active', registrationMode: 'rolling' },
      { id: 'CLS_B', orgId: 'ORG_1', title: 'CLB 5 Afternoon', deliveryDepartmentId: 'DEP_LANG', deliveryDepartmentName: 'Language', status: 'active', registrationMode: 'term_based' },
      { id: 'CLS_VOID', orgId: 'ORG_1', title: 'Old Class', deliveryDepartmentId: 'DEP_LANG', status: 'void' },
      { id: 'CLS_JOB', orgId: 'ORG_1', title: 'Resume Workshop', deliveryDepartmentId: 'DEP_JOB', status: 'active' }
    ],
    students: [
      { id: 'STU_1', orgId: 'ORG_1', personId: 'PER_1', customStudentId: 'S-001', academicStatus: 'Active', feeCategory: 'domestic' },
      { id: 'STU_2', orgId: 'ORG_1', personId: 'PER_2', customStudentId: 'S-002', academicStatus: 'Archived' },
      { id: 'STU_3', orgId: 'ORG_1', personId: 'PER_3', customStudentId: 'S-003', academicStatus: 'Active' }
    ],
    teachers: [
      { id: 'TCH_1', orgId: 'ORG_1', personId: 'PER_T1', departmentId: 'DEP_LANG', status: 'Active', employeeNumber: 'E-1' },
      { id: 'TCH_2', orgId: 'ORG_1', personId: 'PER_T2', departmentId: 'DEP_JOB', status: 'Active', employeeNumber: 'E-2' },
      { id: 'TCH_3', orgId: 'ORG_1', personId: 'PER_T3', departmentId: 'DEP_LANG', status: 'Archived' }
    ],
    ...(fixtures.data || {})
  };
  const people = new Map(Object.entries({
    PER_1: { id: 'PER_1', name: { first: 'Ava', last: 'Stone' }, contact: { emails: [{ email: 'ava@example.test', isPrimary: true }] } },
    PER_2: { id: 'PER_2', name: { first: 'Archived', last: 'Learner' } },
    PER_3: { id: 'PER_3', name: { first: 'Noah', last: 'Lee' } },
    PER_T1: { id: 'PER_T1', name: { first: 'Mira', last: 'Patel' }, contact: { emails: [{ email: 'mira@example.test', isPrimary: true }] } },
    PER_T2: { id: 'PER_T2', name: { first: 'Sam', last: 'Rivera' } },
    PER_T3: { id: 'PER_T3', name: { first: 'Old', last: 'Teacher' } },
    ...(fixtures.people || {})
  }));
  const enrollmentByClass = {
    CLS_A: ['STU_1', 'STU_2'],
    CLS_B: ['STU_3'],
    CLS_JOB: [],
    ...(fixtures.enrollmentByClass || {})
  };

  return createSchoolEntityPickerService({
    schoolDataService: {
      async fetchAllData(entityType) {
        return data[entityType] || [];
      }
    },
    classEnrollmentReadService: {
      async listActiveStudentIdsForClass({ classId }) {
        return { source: 'canonical', studentIds: new Set(enrollmentByClass[classId] || []) };
      }
    },
    schoolPersonAccessService: {
      async buildPersonByIdMap({ personIds }) {
        return new Map((personIds || []).map((personId) => [personId, people.get(personId)]).filter((entry) => entry[1]));
      },
      formatPersonName(person, fallback) {
        const first = person?.name?.first || '';
        const last = person?.name?.last || '';
        return `${first} ${last}`.trim() || fallback;
      },
      readPersonEmail(person) {
        return person?.contact?.emails?.[0]?.email || '';
      }
    }
  });
}

const reqUser = { id: 'USER_1', activeOrgId: 'ORG_1' };

test('school entity picker lists department cards for the active organization', async () => {
  const service = buildService();
  const payload = await service.listOptions({ query: { target: 'students', level: 'departments' }, reqUser });

  assert.equal(payload.status, 'success');
  assert.equal(payload.target, 'students');
  assert.equal(payload.level, 'departments');
  assert.deepEqual(payload.results.map((row) => row.id), ['DEP_JOB', 'DEP_LANG']);
  assert.equal(payload.results.every((row) => row.type === 'department' && row.nextLevel === 'classes'), true);

  const teacherPayload = await service.listOptions({ query: { target: 'teachers', level: 'departments' }, reqUser });
  assert.equal(teacherPayload.results.every((row) => row.type === 'department' && row.nextLevel === 'teachers'), true);
});

test('student target lists department classes with canonical roster counts', async () => {
  const service = buildService();
  const payload = await service.listOptions({
    query: { target: 'students', level: 'classes', departmentId: 'DEP_LANG' },
    reqUser
  });

  assert.deepEqual(payload.results.map((row) => row.id), ['CLS_A', 'CLS_B']);
  assert.equal(payload.results.find((row) => row.id === 'CLS_A')?.counts.students, 2);
  assert.equal(payload.results.find((row) => row.id === 'CLS_B')?.counts.students, 1);
  assert.equal(payload.results.some((row) => row.id === 'CLS_VOID'), false);
});

test('student target lists only visible canonical students for a class with selection context', async () => {
  const service = buildService();
  const payload = await service.listOptions({
    query: { target: 'students', level: 'students', departmentId: 'DEP_LANG', classId: 'CLS_A' },
    reqUser
  });

  assert.deepEqual(payload.results.map((row) => row.id), ['STU_1']);
  const student = payload.results[0];
  assert.equal(student.label, 'Ava Stone');
  assert.equal(student.meta.email, 'ava@example.test');
  assert.deepEqual(student.meta.selectedFrom, [{
    departmentId: 'DEP_LANG',
    departmentName: 'LANG - Language',
    classId: 'CLS_A',
    classTitle: 'CLB 4 Morning'
  }]);
});

test('teacher target filters terminal teacher rows by default department and paginates', async () => {
  const service = buildService();
  const payload = await service.listOptions({
    query: { target: 'teachers', level: 'teachers', departmentId: 'DEP_LANG', page: 1, limit: 1 },
    reqUser
  });

  assert.equal(payload.pagination.totalItems, 1);
  assert.equal(payload.pagination.limit, 1);
  assert.deepEqual(payload.results.map((row) => row.id), ['TCH_1']);
  assert.equal(payload.results[0].label, 'Mira Patel');
  assert.deepEqual(payload.results[0].meta.selectedFrom, [{
    departmentId: 'DEP_LANG',
    departmentName: 'LANG - Language'
  }]);
});

test('service rejects archived or void hierarchy records for direct API calls', async () => {
  const service = buildService();

  await assert.rejects(
    () => service.listOptions({ query: { target: 'students', level: 'classes', departmentId: 'DEP_ARCH' }, reqUser }),
    /Department was not found/
  );
  await assert.rejects(
    () => service.listOptions({ query: { target: 'students', level: 'students', departmentId: 'DEP_LANG', classId: 'CLS_VOID' }, reqUser }),
    /Class was not found/
  );
  await assert.rejects(
    () => service.listOptions({ query: { target: 'teachers', level: 'teachers', departmentId: 'DEP_ARCH' }, reqUser }),
    /Department was not found/
  );
});

test('service rejects invalid targets and levels with 400 errors', async () => {
  const service = buildService();
  await assert.rejects(
    () => service.listOptions({ query: { target: 'nonsense' }, reqUser }),
    /Unsupported picker target/
  );
  await assert.rejects(
    () => service.listOptions({ query: { target: 'students', level: 'teachers' }, reqUser }),
    /Unsupported picker level/
  );
});
