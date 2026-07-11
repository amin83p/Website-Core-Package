const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

process.env.MAIN_SECRET_KEY ||= '0123456789abcdef0123456789abcdef';
process.env.SESSION_SECRET ||= 'fedcba9876543210fedcba9876543210';
process.env.SESSION_ENCRYPTION_KEY ||= '00112233445566778899aabbccddeeff';
process.env.ACTION_STATE_KEY ||= 'ffeeddccbbaa99887766554433221100';
process.env.DATA_BACKEND = 'json';
process.env.DATA_BACKEND_STRICT = 'false';

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('student overview routes and controller are wired in academic ledger module', () => {
  const routes = readText('packages/school/MVC/routes/academicLedgerRoutes.js');
  const controller = readText('packages/school/MVC/controllers/school/academicLedgerController.js');
  const view = readText('packages/school/MVC/views/school/academicLedger/studentOverview.ejs');
  const ledgerList = readText('packages/school/MVC/views/school/academicLedger/ledgerList.ejs');
  const studentStatement = readText('packages/school/MVC/views/school/academicLedger/studentStatement.ejs');

  assert.match(routes, /router\.get\('\/student-overview'/);
  assert.match(routes, /router\.get\('\/student-overview\/:studentId'/);
  assert.match(routes, /ctrl\.showStudentOverview\b/);
  assert.match(routes, /ctrl\.showStudentOverviewForStudent/);
  assert.match(controller, /studentAcademicOverviewService/);
  assert.match(controller, /exports\.showStudentOverview\b/);
  assert.match(controller, /exports\.showStudentOverviewForStudent/);
  assert.match(view, /btnPickOverviewStudent/);
  assert.match(view, /Program Registrations/);
  assert.match(view, /Term Registrations/);
  assert.match(view, /Class Enrollments/);
  assert.match(ledgerList, /student-overview/);
  assert.match(studentStatement, /student-overview/);
});

test('term registration summaries support studentId filter', async () => {
  const termRegistrationViewService = require('../packages/school/MVC/services/school/termRegistrationViewService');
  const schoolRepositories = require('../packages/school/MVC/repositories/school');
  const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
  const schoolPersonAccessService = require('../packages/school/MVC/services/school/schoolPersonAccessService');

  const originalTermList = schoolRepositories.studentTermRegistrations.list;
  const originalFetchData = schoolDataService.fetchData;
  const originalBuildPersonMap = schoolPersonAccessService.buildPersonByIdMap;

  const registrations = [
    {
      id: 'STR-1',
      orgId: 'ORG-1',
      studentId: 'STU-1',
      personId: 'P-1',
      programId: 'PRG-1',
      termId: 'TRM-1',
      registrationDate: '2026-07-01',
      status: 'registered',
      transactionSummary: {},
      academicSummary: {}
    },
    {
      id: 'STR-2',
      orgId: 'ORG-1',
      studentId: 'STU-2',
      personId: 'P-2',
      programId: 'PRG-1',
      termId: 'TRM-2',
      registrationDate: '2026-07-02',
      status: 'registered',
      transactionSummary: {},
      academicSummary: {}
    }
  ];

  try {
    schoolRepositories.studentTermRegistrations.list = async () => registrations;
    schoolDataService.fetchData = async (entityType) => {
      if (entityType === 'students') {
        return [
          { id: 'STU-1', personId: 'P-1' },
          { id: 'STU-2', personId: 'P-2' }
        ];
      }
      if (entityType === 'programs') return [{ id: 'PRG-1', code: 'ENG', name: 'English' }];
      if (entityType === 'terms') {
        return [
          { id: 'TRM-1', code: 'F26', name: 'Fall 2026' },
          { id: 'TRM-2', code: 'S27', name: 'Spring 2027' }
        ];
      }
      return [];
    };
    schoolPersonAccessService.buildPersonByIdMap = async () => new Map([
      ['P-1', { name: { first: 'Ada', last: 'Lovelace' } }],
      ['P-2', { name: { first: 'Alan', last: 'Turing' } }]
    ]);

    const rows = await termRegistrationViewService.buildRegistrationSummaries(
      { activeOrgId: 'ORG-1' },
      'ORG-1',
      { filters: { studentId: 'STU-1' } }
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'STR-1');
    assert.equal(rows[0].studentId, 'STU-1');
  } finally {
    schoolRepositories.studentTermRegistrations.list = originalTermList;
    schoolDataService.fetchData = originalFetchData;
    schoolPersonAccessService.buildPersonByIdMap = originalBuildPersonMap;
  }
});

test('studentAcademicOverviewService returns program, term, and class sections with detail URLs', async () => {
  const studentAcademicOverviewService = require('../packages/school/MVC/services/school/studentAcademicOverviewService');
  const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
  const programRegistrationViewService = require('../packages/school/MVC/services/school/programRegistrationViewService');
  const termRegistrationViewService = require('../packages/school/MVC/services/school/termRegistrationViewService');
  const programWithdrawalService = require('../packages/school/MVC/services/school/withdrawal/programWithdrawalService');
  const schoolPersonAccessService = require('../packages/school/MVC/services/school/schoolPersonAccessService');

  const originalGetById = schoolDataService.getDataById;
  const originalFetchData = schoolDataService.fetchData;
  const originalGetPeriods = schoolDataService.getClassEnrollmentPeriodsByStudentId;
  const originalProgramSummaries = programRegistrationViewService.buildRegistrationSummaries;
  const originalTermSummaries = termRegistrationViewService.buildRegistrationSummaries;
  const originalWithdrawalStatus = programWithdrawalService.getStudentWithdrawalStatus;
  const originalGetPerson = schoolPersonAccessService.getPersonById;

  try {
    schoolDataService.getDataById = async (entityType, id) => {
      if (entityType === 'students' && id === 'STU-1') {
        return { id: 'STU-1', orgId: 'ORG-1', personId: 'P-1', studentNumber: 'S001' };
      }
      return null;
    };
    schoolDataService.fetchData = async (entityType) => {
      if (entityType === 'programs') return [{ id: 'PRG-1', code: 'ENG', name: 'English', orgId: 'ORG-1' }];
      if (entityType === 'terms') return [{ id: 'TRM-1', code: 'F26', name: 'Fall 2026', orgId: 'ORG-1' }];
      if (entityType === 'classes') return [{ id: 'CLS-1', title: 'Math 101', orgId: 'ORG-1', subjects: [{ subjectId: 'SUB-1', code: 'MATH' }] }];
      if (entityType === 'subjects') return [{ id: 'SUB-1', code: 'MATH', name: 'Mathematics' }];
      return [];
    };
    schoolDataService.getClassEnrollmentPeriodsByStudentId = async () => ([
      {
        id: 'CEP-1',
        orgId: 'ORG-1',
        studentId: 'STU-1',
        classId: 'CLS-1',
        programId: 'PRG-1',
        termId: 'TRM-1',
        authorizationRef: 'STR-1',
        startDate: '2026-07-01',
        endDate: '2026-12-31',
        status: 'active'
      }
    ]);
    programRegistrationViewService.buildRegistrationSummaries = async () => ([
      {
        id: 'SPR-1',
        studentId: 'STU-1',
        programId: 'PRG-1',
        programLabel: 'ENG - English',
        status: 'registered',
        verificationStatus: 'verified',
        statusBadgeClass: 'bg-success',
        registrationDate: '2026-06-01',
        termRegistrationsCount: 1,
        finance: { posted: 1, expected: 1 },
        academic: { posted: 1, expected: 1 },
        note: ''
      }
    ]);
    termRegistrationViewService.buildRegistrationSummaries = async () => ([
      {
        id: 'STR-1',
        studentId: 'STU-1',
        programId: 'PRG-1',
        termId: 'TRM-1',
        programLabel: 'ENG - English',
        termLabel: 'F26 - Fall 2026',
        status: 'registered',
        verificationStatus: 'verified',
        statusBadgeClass: 'bg-success',
        registrationDate: '2026-07-01',
        classCount: 1,
        selectedCredits: 3,
        finance: { posted: 1, expected: 1 },
        academic: { posted: 1, expected: 1 }
      }
    ]);
    programWithdrawalService.getStudentWithdrawalStatus = async () => ({
      warnings: [],
      reviewRequired: false
    });
    schoolPersonAccessService.getPersonById = async () => ({ name: { first: 'Ada', last: 'Lovelace' } });

    const overview = await studentAcademicOverviewService.buildStudentAcademicOverview({
      reqUser: { activeOrgId: 'ORG-1' },
      activeOrgId: 'ORG-1',
      studentId: 'STU-1'
    });

    assert.equal(overview.student.id, 'STU-1');
    assert.equal(overview.summary.programCount, 1);
    assert.equal(overview.summary.termCount, 1);
    assert.equal(overview.summary.classCount, 1);
    assert.equal(overview.programs[0].detailUrl, '/school/programs/registrations/SPR-1');
    assert.equal(overview.terms[0].detailUrl, '/school/programs/term-registrations/STR-1');
    assert.equal(overview.classes[0].editUrl, '/school/classes/edit/CLS-1');
    assert.equal(overview.classes[0].classTitle, 'Math 101');
    assert.equal(overview.classes[0].termRegistrationId, 'STR-1');
  } finally {
    schoolDataService.getDataById = originalGetById;
    schoolDataService.fetchData = originalFetchData;
    schoolDataService.getClassEnrollmentPeriodsByStudentId = originalGetPeriods;
    programRegistrationViewService.buildRegistrationSummaries = originalProgramSummaries;
    termRegistrationViewService.buildRegistrationSummaries = originalTermSummaries;
    programWithdrawalService.getStudentWithdrawalStatus = originalWithdrawalStatus;
    schoolPersonAccessService.getPersonById = originalGetPerson;
  }
});

test('registration sort helper prioritizes active statuses before withdrawn records', () => {
  const { sortRegistrationRows } = require('../packages/school/MVC/services/school/studentAcademicOverviewService');
  const sorted = sortRegistrationRows([
    { id: 'B', status: 'withdrawn', registrationDate: '2026-08-01' },
    { id: 'A', status: 'registered', registrationDate: '2026-07-01' }
  ]);
  assert.equal(sorted[0].id, 'A');
  assert.equal(sorted[1].id, 'B');
});
