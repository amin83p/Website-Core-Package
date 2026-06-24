const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function resolveRepoRoot() {
  const directRoot = path.resolve(__dirname, '..');
  if (fs.existsSync(path.join(directRoot, 'app.js'))) {
    return directRoot;
  }

  const fallbackRoot = path.resolve(__dirname, '..', '..', '..');
  if (fs.existsSync(path.join(fallbackRoot, 'app.js'))) {
    return fallbackRoot;
  }

  throw new Error('Unable to resolve repository root for pte course picker tests.');
}

const REPO_ROOT = resolveRepoRoot();
const pteCourseDataService = require(path.join(REPO_ROOT, 'packages/pte/MVC/services/pte/pteCourseDataService.js'));
const pteApplicantRepository = require(path.join(REPO_ROOT, 'packages/pte/MVC/repositories/pteApplicantRepository.js'));
const adminChekersService = require(path.join(REPO_ROOT, 'MVC/services/adminChekersService.js'));
const dataService = require(path.join(REPO_ROOT, 'MVC/services/dataService.js'));
const settingService = require(path.join(REPO_ROOT, 'MVC/services/settingService.js'));

const originals = {
  isSuperAdmin: adminChekersService.isSuperAdmin,
  isOrgAdmin: adminChekersService.isOrgAdmin,
  isAdminForRequestAsync: adminChekersService.isAdminForRequestAsync,
  fetchData: dataService.fetchData,
  getValue: settingService.getValue,
  listApplicants: pteApplicantRepository.list,
  countApplicants: pteApplicantRepository.count
};

function restore() {
  adminChekersService.isSuperAdmin = originals.isSuperAdmin;
  adminChekersService.isOrgAdmin = originals.isOrgAdmin;
  adminChekersService.isAdminForRequestAsync = originals.isAdminForRequestAsync;
  dataService.fetchData = originals.fetchData;
  settingService.getValue = originals.getValue;
  pteApplicantRepository.list = originals.listApplicants;
  pteApplicantRepository.count = originals.countApplicants;
}

test.afterEach(() => {
  restore();
});

function createApplicantRows() {
  return [
    {
      id: 'APP-1',
      orgId: 'ORG-1',
      status: 'active',
      personRoleToken: 'PTE_Student',
      personId: 'P-1',
      userId: 'U-1',
      applicantId: 'APPL-1'
    },
    {
      id: 'APP-2',
      orgId: 'ORG-1',
      status: 'active',
      personRoleToken: 'PTE_Student_Public',
      personId: 'P-2',
      userId: 'U-2',
      applicantId: 'APPL-2'
    },
    {
      id: 'APP-3',
      orgId: 'ORG-1',
      status: 'active',
      personRoleToken: 'pte_teacher',
      personId: 'P-3',
      userId: 'U-3',
      applicantId: 'APPL-3'
    },
    {
      id: 'APP-4',
      orgId: 'ORG-1',
      status: 'active',
      personRoleToken: 'pte_student',
      personId: 'P-4',
      userId: 'U-4',
      applicantId: 'APPL-4'
    }
  ];
}

function createPersonRows() {
  return [
    { id: 'P-1', name: { first: 'Alice', last: 'Student' } },
    {
      id: 'P-2',
      name: { first: 'Public', last: 'Applicant' },
      organizations: [{ orgId: 'ORG-1', roles: ['pte_student'] }]
    },
    {
      id: 'P-3',
      name: { first: 'Teacher', last: 'Candidate' },
      organizations: [{ orgId: 'ORG-1', roles: ['pte_student'] }]
    },
    { id: 'P-4', name: { first: 'Lower', last: 'Case' } }
  ];
}

function createUserRows() {
  return [
    { id: 'U-1', email: 'alice@example.com' },
    { id: 'U-2', email: 'public@example.com', organizations: [{ orgId: 'ORG-1', roles: ['pte_student'] }] },
    { id: 'U-3', email: 'teacher@example.com', organizations: [{ orgId: 'ORG-1', roles: ['pte_student'] }] },
    { id: 'U-4', email: 'lower@example.com' }
  ];
}

function installCommonStubs() {
  adminChekersService.isSuperAdmin = () => false;
  adminChekersService.isOrgAdmin = () => false;
  adminChekersService.isAdminForRequestAsync = async (_user, sectionId) => String(sectionId || '') === 'PTE_COURSES';
  settingService.getValue = () => 20;

  const personRows = createPersonRows();
  const userRows = createUserRows();
  dataService.fetchData = async (entityType) => {
    if (entityType === 'persons') return personRows;
    if (entityType === 'users') return userRows;
    return [];
  };
}

function assertStrictStudentIds(resultRows = []) {
  const ids = resultRows.map((row) => row.id);
  assert.deepEqual(ids, ['APP-1', 'APP-4']);
  assert.equal(ids.includes('APP-2'), false);
  assert.equal(ids.includes('APP-3'), false);
}

test('listPickerStudents simple paginated path keeps only strict pte_student applicants', async () => {
  installCommonStubs();
  let capturedCountOptions = null;
  let capturedListOptions = null;

  pteApplicantRepository.count = async (options = {}) => {
    capturedCountOptions = options;
    return 4;
  };
  pteApplicantRepository.list = async (options = {}) => {
    capturedListOptions = options;
    return createApplicantRows();
  };

  const result = await pteCourseDataService.listPickerStudents(
    {},
    { id: 'USR-1', activeOrgId: 'ORG-1' },
    {},
    { paginated: true, pagination: { page: 1, limit: 50 } }
  );

  assert.equal(capturedCountOptions?.query?.personRoleToken__eq, 'PTE_Student');
  assert.equal(capturedListOptions?.query?.personRoleToken__eq, 'PTE_Student');
  assertStrictStudentIds(result.rows);
});

test('listPickerStudents complex filter path also excludes public/non-student applicants', async () => {
  installCommonStubs();
  let countCalled = false;
  let listOptions = null;

  pteApplicantRepository.count = async () => {
    countCalled = true;
    return 0;
  };
  pteApplicantRepository.list = async (options = {}) => {
    listOptions = options;
    return createApplicantRows();
  };

  const result = await pteCourseDataService.listPickerStudents(
    { id__in: 'APP-1,APP-2,APP-3,APP-4' },
    { id: 'USR-1', activeOrgId: 'ORG-1' },
    {},
    { paginated: true, pagination: { page: 1, limit: 50 } }
  );

  assert.equal(countCalled, false);
  assert.deepEqual(listOptions?.query || {}, {});
  assertStrictStudentIds(result.rows);
});
