const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schoolRepositories = require('../MVC/repositories/school');
const registrationIntegrityService = require('../MVC/services/school/registrationIntegrityService');
const classEnrollmentReadService = require('../MVC/services/school/classEnrollmentReadService');
const withdrawalRepository = require('../MVC/repositories/school/withdrawalRepository');
const schoolDataService = require('../MVC/services/school/schoolDataService');
const termRegistrationViewService = require('../MVC/services/school/termRegistrationViewService');

const ORG_ID = 'ORG-900001';
const TERM_REG_ID = 'STR-900001';

function buildDraftRegistration(overrides = {}) {
  return {
    id: TERM_REG_ID,
    orgId: ORG_ID,
    studentId: 'STU-900001',
    programId: 'PRG-900001',
    termId: 'TERM-900001',
    status: 'draft',
    transactionSummary: { transactionIds: [], postedCount: 0 },
    academicSummary: { entryIds: [], entryCount: 0 },
    ...overrides
  };
}

test('assertTermDraftDeletionAllowed rejects non-draft registrations', async () => {
  await assert.rejects(
    () => registrationIntegrityService.assertTermDraftDeletionAllowed(
      buildDraftRegistration({ status: 'registered' }),
      { activeOrgId: ORG_ID }
    ),
    /Only draft term registrations can be deleted/
  );
});

test('assertTermDraftDeletionAllowed rejects drafts with active posted finance', async () => {
  const originalFindReversal = schoolRepositories.globalTransactions.findReversalByTransactionId;
  const originalGetTx = schoolRepositories.globalTransactions.getById;
  const originalGetLedger = schoolRepositories.academicLedger.getById;

  schoolRepositories.globalTransactions.findReversalByTransactionId = async () => null;
  schoolRepositories.globalTransactions.getById = async () => ({ id: 'TX-1', status: 'posted' });
  schoolRepositories.academicLedger.getById = async () => null;

  try {
    await assert.rejects(
      () => registrationIntegrityService.assertTermDraftDeletionAllowed(
        buildDraftRegistration({
          transactionSummary: { transactionIds: ['TX-1'], postedCount: 0 }
        }),
        { activeOrgId: ORG_ID }
      ),
      /active finance postings still exist/
    );
  } finally {
    schoolRepositories.globalTransactions.findReversalByTransactionId = originalFindReversal;
    schoolRepositories.globalTransactions.getById = originalGetTx;
    schoolRepositories.academicLedger.getById = originalGetLedger;
  }
});

test('assertTermDraftDeletionAllowed allows drafts with stale voided academic entry ids', async () => {
  const originalFindReversal = schoolRepositories.globalTransactions.findReversalByTransactionId;
  const originalGetTx = schoolRepositories.globalTransactions.getById;
  const originalGetLedger = schoolRepositories.academicLedger.getById;
  const originalDiscover = classEnrollmentReadService.discoverClassEnrollmentRowsByRegistrationId;
  const originalWithdrawalList = withdrawalRepository.list;

  schoolRepositories.globalTransactions.findReversalByTransactionId = async () => null;
  schoolRepositories.globalTransactions.getById = async () => null;
  schoolRepositories.academicLedger.getById = async () => ({ id: 'LEDGER/1', status: 'void' });
  classEnrollmentReadService.discoverClassEnrollmentRowsByRegistrationId = async () => ({ source: 'canonical', rows: [] });
  withdrawalRepository.list = async () => [];

  try {
    await registrationIntegrityService.assertTermDraftDeletionAllowed(
      buildDraftRegistration({
        academicSummary: {
          entryIds: ['LEDGER/1'],
          entryCount: 0,
          voidedEntryIds: ['LEDGER/1']
        }
      }),
      { activeOrgId: ORG_ID, reqUser: { id: 'USR-1' } }
    );
  } finally {
    schoolRepositories.globalTransactions.findReversalByTransactionId = originalFindReversal;
    schoolRepositories.globalTransactions.getById = originalGetTx;
    schoolRepositories.academicLedger.getById = originalGetLedger;
    classEnrollmentReadService.discoverClassEnrollmentRowsByRegistrationId = originalDiscover;
    withdrawalRepository.list = originalWithdrawalList;
  }
});

test('assertTermDraftDeletionAllowed rejects drafts with active academic ledger entries', async () => {
  const originalFindReversal = schoolRepositories.globalTransactions.findReversalByTransactionId;
  const originalGetTx = schoolRepositories.globalTransactions.getById;
  const originalGetLedger = schoolRepositories.academicLedger.getById;

  schoolRepositories.globalTransactions.findReversalByTransactionId = async () => null;
  schoolRepositories.globalTransactions.getById = async () => null;
  schoolRepositories.academicLedger.getById = async () => ({ id: 'LEDGER/2', status: 'posted' });

  try {
    await assert.rejects(
      () => registrationIntegrityService.assertTermDraftDeletionAllowed(
        buildDraftRegistration({
          academicSummary: { entryIds: ['LEDGER/2'], entryCount: 1 }
        }),
        { activeOrgId: ORG_ID }
      ),
      /active academic ledger entries still exist/
    );
  } finally {
    schoolRepositories.globalTransactions.findReversalByTransactionId = originalFindReversal;
    schoolRepositories.globalTransactions.getById = originalGetTx;
    schoolRepositories.academicLedger.getById = originalGetLedger;
  }
});

test('assertTermDraftDeletionAllowed rejects drafts with linked class enrollments', async () => {
  const originalDiscover = classEnrollmentReadService.discoverClassEnrollmentRowsByRegistrationId;
  const originalFindReversal = schoolRepositories.globalTransactions.findReversalByTransactionId;
  const originalGetTx = schoolRepositories.globalTransactions.getById;
  const originalGetLedger = schoolRepositories.academicLedger.getById;

  classEnrollmentReadService.discoverClassEnrollmentRowsByRegistrationId = async () => ({
    source: 'canonical',
    rows: [{ classId: 'CLASS/1', enrollmentId: 'CEP/1' }]
  });
  schoolRepositories.globalTransactions.findReversalByTransactionId = async () => null;
  schoolRepositories.globalTransactions.getById = async () => null;
  schoolRepositories.academicLedger.getById = async () => null;

  try {
    await assert.rejects(
      () => registrationIntegrityService.assertTermDraftDeletionAllowed(
        buildDraftRegistration(),
        { activeOrgId: ORG_ID, reqUser: { id: 'USR-1' } }
      ),
      /class enrollments are linked/
    );
  } finally {
    classEnrollmentReadService.discoverClassEnrollmentRowsByRegistrationId = originalDiscover;
    schoolRepositories.globalTransactions.findReversalByTransactionId = originalFindReversal;
    schoolRepositories.globalTransactions.getById = originalGetTx;
    schoolRepositories.academicLedger.getById = originalGetLedger;
  }
});

test('deleteDraftTermRegistration removes draft via repository deleteDraftRegistration', async () => {
  const originalGetByIdInOrg = schoolRepositories.studentTermRegistrations.getByIdInOrg;
  const originalGetById = schoolRepositories.studentTermRegistrations.getById;
  const originalDiscover = classEnrollmentReadService.discoverClassEnrollmentRowsByRegistrationId;
  const originalWithdrawalList = withdrawalRepository.list;
  const originalDeleteDraft = schoolRepositories.studentTermRegistrations.deleteDraftRegistration;
  const originalFindReversal = schoolRepositories.globalTransactions.findReversalByTransactionId;
  const originalGetTx = schoolRepositories.globalTransactions.getById;
  const originalGetLedger = schoolRepositories.academicLedger.getById;

  const registration = buildDraftRegistration();
  let deletedId = '';

  schoolRepositories.studentTermRegistrations.getByIdInOrg = async () => registration;
  schoolRepositories.studentTermRegistrations.getById = async () => registration;
  classEnrollmentReadService.discoverClassEnrollmentRowsByRegistrationId = async () => ({ source: 'canonical', rows: [] });
  withdrawalRepository.list = async () => [];
  schoolRepositories.globalTransactions.findReversalByTransactionId = async () => null;
  schoolRepositories.globalTransactions.getById = async () => null;
  schoolRepositories.academicLedger.getById = async () => null;
  schoolRepositories.studentTermRegistrations.deleteDraftRegistration = async (id) => {
    deletedId = id;
    return { id, deleted: true };
  };

  try {
    const result = await registrationIntegrityService.deleteDraftTermRegistration(TERM_REG_ID, {
      activeOrgId: ORG_ID,
      reqUser: { id: 'USR-1' }
    });
    assert.equal(result.registrationId, TERM_REG_ID);
    assert.equal(deletedId, TERM_REG_ID);
  } finally {
    schoolRepositories.studentTermRegistrations.getByIdInOrg = originalGetByIdInOrg;
    schoolRepositories.studentTermRegistrations.getById = originalGetById;
    classEnrollmentReadService.discoverClassEnrollmentRowsByRegistrationId = originalDiscover;
    withdrawalRepository.list = originalWithdrawalList;
    schoolRepositories.globalTransactions.findReversalByTransactionId = originalFindReversal;
    schoolRepositories.globalTransactions.getById = originalGetTx;
    schoolRepositories.academicLedger.getById = originalGetLedger;
    schoolRepositories.studentTermRegistrations.deleteDraftRegistration = originalDeleteDraft;
  }
});

test('schoolDataService still blocks generic studentTermRegistrations delete', async () => {
  await assert.rejects(
    () => schoolDataService.deleteData('studentTermRegistrations', TERM_REG_ID, { id: 'USR-1' }),
    /cannot be deleted from this service/
  );
});

test('termRegistrationController rollback route deletes drafts instead of no-op', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/termRegistrationController.js'),
    'utf8'
  );
  assert.match(source, /deleteDraftTermRegistration/);
  assert.match(source, /Draft term registration deleted/);
  assert.doesNotMatch(source, /Registration is already in draft/);
  assert.match(source, /rollbackTermRegistrationSideEffects/);
  assert.match(source, /entryIds: \[\]/);
  assert.match(source, /transactionIds: \[\]/);
});

test('registrationIntegrityService deletes drafts through repository deleteDraftRegistration', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../MVC/services/school/registrationIntegrityService.js'),
    'utf8'
  );
  assert.match(source, /deleteDraftRegistration/);
  assert.doesNotMatch(source, /deleteData\('studentTermRegistrations'/);
});

test('termRegistrationViewService exposes canDeleteDraft and canRollback separately', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../MVC/services/school/termRegistrationViewService.js'),
    'utf8'
  );
  assert.match(source, /canDeleteDraft:/);
  assert.match(source, /canRollback: \['registered', 'error'\]/);
  assert.doesNotMatch(source, /canRollback: \['registered', 'draft', 'error'\]/);
});

test('term registration views use Delete Draft copy for draft records', () => {
  const details = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/program/termRegistrationDetails.ejs'),
    'utf8'
  );
  const list = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/program/termRegistrationList.ejs'),
    'utf8'
  );
  const form = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/program/termRegistrationForm.ejs'),
    'utf8'
  );

  assert.match(details, /Delete Draft/);
  assert.match(details, /btnDeleteDraftRegistration/);
  assert.doesNotMatch(details, /Cancel Draft/);

  assert.match(list, /delete-draft-btn/);
  assert.match(list, /Delete Draft/);
  assert.doesNotMatch(list, /Cancel Draft/);

  assert.match(form, /data-delete-term-registration/);
  assert.match(form, /Delete Draft/);
  assert.doesNotMatch(form, /Cancel Draft/);
});
