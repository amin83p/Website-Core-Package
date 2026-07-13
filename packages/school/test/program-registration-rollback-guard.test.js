const test = require('node:test');
const assert = require('node:assert/strict');

const schoolRepositories = require('../MVC/repositories/school');
const registrationIntegrityService = require('../MVC/services/school/registrationIntegrityService');
const programRegistrationViewService = require('../MVC/services/school/programRegistrationViewService');

const { isBlockingClassEnrollmentForProgramRollback } = schoolRepositories.__scopeTestHelpers;

const ORG_ID = 'ORG-900000';
const STUDENT_ID = 'STU-50124';
const PROGRAM_ID = 'PRG-232974';
const PROGRAM_REG_ID = 'SPR-845201';

function buildRegistration(overrides = {}) {
  return {
    id: PROGRAM_REG_ID,
    orgId: ORG_ID,
    studentId: STUDENT_ID,
    programId: PROGRAM_ID,
    status: 'registered',
    registrationDate: '2026-01-15',
    transactionSummary: { transactionIds: [], postedCount: 0 },
    academicSummary: { entryIds: [], entryCount: 0 },
    ...overrides
  };
}

test('isBlockingClassEnrollmentForProgramRollback includes active enrollments', () => {
  assert.equal(isBlockingClassEnrollmentForProgramRollback('active'), true);
  assert.equal(isBlockingClassEnrollmentForProgramRollback('planned'), true);
  assert.equal(isBlockingClassEnrollmentForProgramRollback('draft'), true);
  assert.equal(isBlockingClassEnrollmentForProgramRollback('completed'), true);
});

test('isBlockingClassEnrollmentForProgramRollback excludes terminal enrollments', () => {
  assert.equal(isBlockingClassEnrollmentForProgramRollback('withdrawn'), false);
  assert.equal(isBlockingClassEnrollmentForProgramRollback('cancelled'), false);
  assert.equal(isBlockingClassEnrollmentForProgramRollback('archived'), false);
  assert.equal(isBlockingClassEnrollmentForProgramRollback('error'), false);
});

test('assertProgramRollbackAllowed allows rollback without dependents', async () => {
  const originalTermCount = schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId;
  const originalClassCount = schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram;

  schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId = async () => 0;
  schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram = async () => 0;

  try {
    await assert.doesNotReject(() => registrationIntegrityService.assertProgramRollbackAllowed(
      buildRegistration(),
      ORG_ID
    ));
  } finally {
    schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId = originalTermCount;
    schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram = originalClassCount;
  }
});

test('assertProgramRollbackAllowed blocks rollback when term registrations exist', async () => {
  const originalTermCount = schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId;
  const originalTermFind = schoolRepositories.studentTermRegistrations.findActiveByProgramRegistrationId;
  const originalClassCount = schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram;

  schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId = async () => 1;
  schoolRepositories.studentTermRegistrations.findActiveByProgramRegistrationId = async () => ([
    { id: 'STR-100', termId: 'TRM-1', status: 'registered' }
  ]);
  schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram = async () => 0;

  try {
    await assert.rejects(
      () => registrationIntegrityService.assertProgramRollbackAllowed(buildRegistration(), ORG_ID),
      /term registrations exist/
    );
  } finally {
    schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId = originalTermCount;
    schoolRepositories.studentTermRegistrations.findActiveByProgramRegistrationId = originalTermFind;
    schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram = originalClassCount;
  }
});

test('assertProgramRollbackAllowed blocks rollback when class enrollments exist', async () => {
  const originalTermCount = schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId;
  const originalClassCount = schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram;
  const originalClassFind = schoolRepositories.classEnrollmentPeriods.findBlockingByStudentAndProgram;

  schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId = async () => 0;
  schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram = async () => 1;
  schoolRepositories.classEnrollmentPeriods.findBlockingByStudentAndProgram = async () => ([
    { id: 'CEP-100', classId: 'CLS-609077', status: 'active' }
  ]);

  try {
    await assert.rejects(
      () => registrationIntegrityService.assertProgramRollbackAllowed(buildRegistration(), ORG_ID),
      /class enrollments exist under this program/
    );
  } finally {
    schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId = originalTermCount;
    schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram = originalClassCount;
    schoolRepositories.classEnrollmentPeriods.findBlockingByStudentAndProgram = originalClassFind;
  }
});

test('assertProgramRollbackAllowed allows rollback when only withdrawn class enrollments remain', async () => {
  const originalTermCount = schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId;
  const originalClassCount = schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram;

  schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId = async () => 0;
  schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram = async () => 0;

  try {
    await assert.doesNotReject(() => registrationIntegrityService.assertProgramRollbackAllowed(
      buildRegistration(),
      ORG_ID
    ));
  } finally {
    schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId = originalTermCount;
    schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram = originalClassCount;
  }
});

test('buildRegistrationSummaries sets canRollback false when class enrollments exist', async () => {
  const originalProgramList = schoolRepositories.studentProgramRegistrations.list;
  const originalTermList = schoolRepositories.studentTermRegistrations.list;
  const originalClassList = schoolRepositories.classEnrollmentPeriods.list;
  const originalTxnList = schoolRepositories.globalTransactions.list;
  const originalLedgerList = schoolRepositories.academicLedger.list;
  const dataService = require('../MVC/services/school/schoolDataService');
  const originalFetch = dataService.fetchData;
  const schoolPersonAccessService = require('../MVC/services/school/schoolPersonAccessService');
  const originalPersonMap = schoolPersonAccessService.buildPersonByIdMap;

  schoolRepositories.studentProgramRegistrations.list = async () => ([buildRegistration()]);
  schoolRepositories.studentTermRegistrations.list = async () => ([]);
  schoolRepositories.classEnrollmentPeriods.list = async () => ([{
    id: 'CEP-100',
    orgId: ORG_ID,
    studentId: STUDENT_ID,
    programId: PROGRAM_ID,
    classId: 'CLS-609077',
    status: 'active'
  }]);
  schoolRepositories.globalTransactions.list = async () => ([]);
  schoolRepositories.academicLedger.list = async () => ([]);
  dataService.fetchData = async (type) => {
    if (type === 'students') {
      return [{ id: STUDENT_ID, personId: 'PER-1', orgId: ORG_ID }];
    }
    if (type === 'programs') {
      return [{ id: PROGRAM_ID, code: 'LINC', name: 'LINC Program', orgId: ORG_ID }];
    }
    return [];
  };
  schoolPersonAccessService.buildPersonByIdMap = async () => new Map();

  try {
    const rows = await programRegistrationViewService.buildRegistrationSummaries(
      { id: 'USR-1', activeOrgId: ORG_ID },
      ORG_ID,
      { registrationId: PROGRAM_REG_ID, limit: 1 }
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].classEnrollmentsCount, 1);
    assert.equal(rows[0].termRegistrationsCount, 0);
    assert.equal(rows[0].canRollback, false);
  } finally {
    schoolRepositories.studentProgramRegistrations.list = originalProgramList;
    schoolRepositories.studentTermRegistrations.list = originalTermList;
    schoolRepositories.classEnrollmentPeriods.list = originalClassList;
    schoolRepositories.globalTransactions.list = originalTxnList;
    schoolRepositories.academicLedger.list = originalLedgerList;
    dataService.fetchData = originalFetch;
    schoolPersonAccessService.buildPersonByIdMap = originalPersonMap;
  }
});
