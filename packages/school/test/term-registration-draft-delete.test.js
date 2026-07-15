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

test('deleteDraftTermRegistration returns unexpected posted charges to draft and voids the same ids', async () => {
  const originals = {
    getByIdInOrg: schoolRepositories.studentTermRegistrations.getByIdInOrg,
    getById: schoolRepositories.studentTermRegistrations.getById,
    update: schoolRepositories.studentTermRegistrations.update,
    discover: classEnrollmentReadService.discoverClassEnrollmentRowsByRegistrationId,
    withdrawalList: withdrawalRepository.list,
    transactionList: schoolRepositories.globalTransactions.list,
    transactionGet: schoolRepositories.globalTransactions.getById,
    transition: schoolRepositories.globalTransactions.transitionRegistrationTransactions,
    ledgerGet: schoolRepositories.academicLedger.getById
  };
  const registration = buildDraftRegistration({ transactionSummary: { transactionIds: ['TX-1'], postedCount: 0 } });
  const transitions = [];
  let saved = null;
  schoolRepositories.studentTermRegistrations.getByIdInOrg = async () => registration;
  schoolRepositories.studentTermRegistrations.getById = async () => registration;
  schoolRepositories.studentTermRegistrations.update = async (_id, payload) => { saved = payload; return payload; };
  classEnrollmentReadService.discoverClassEnrollmentRowsByRegistrationId = async () => ({ rows: [] });
  withdrawalRepository.list = async () => [];
  schoolRepositories.globalTransactions.list = async () => [];
  schoolRepositories.globalTransactions.getById = async () => ({
    id: 'TX-1', orgId: ORG_ID, status: 'posted',
    transactionType: 'charge',
    amount: { value: 100, currency: 'CAD', direction: 'debit' },
    balanceEffect: 100,
    metadata: {
      accountId: 'ACC-1',
      registrationType: 'term',
      registrationId: TERM_REG_ID
    }
  });
  schoolRepositories.globalTransactions.transitionRegistrationTransactions = async (input) => {
    transitions.push({ fromStatus: input.fromStatus, toStatus: input.toStatus, ids: input.transactionIds });
    return input.transactionIds.map((id) => ({ id, status: input.toStatus }));
  };
  schoolRepositories.academicLedger.getById = async () => null;
  try {
    await registrationIntegrityService.deleteDraftTermRegistration(TERM_REG_ID, {
      activeOrgId: ORG_ID, reqUser: { id: 'USR-1' }
    });
    assert.deepEqual(transitions, [
      { fromStatus: 'posted', toStatus: 'draft', ids: ['TX-1'] },
      { fromStatus: 'draft', toStatus: 'voided', ids: ['TX-1'] }
    ]);
    assert.equal(saved.status, 'void');
    assert.deepEqual(saved.transactionSummary.transactionIds, []);
    assert.deepEqual(saved.transactionSummary.draftTransactionIds, []);
    assert.deepEqual(saved.transactionSummary.reversalIds, []);
  } finally {
    schoolRepositories.studentTermRegistrations.getByIdInOrg = originals.getByIdInOrg;
    schoolRepositories.studentTermRegistrations.getById = originals.getById;
    schoolRepositories.studentTermRegistrations.update = originals.update;
    classEnrollmentReadService.discoverClassEnrollmentRowsByRegistrationId = originals.discover;
    withdrawalRepository.list = originals.withdrawalList;
    schoolRepositories.globalTransactions.list = originals.transactionList;
    schoolRepositories.globalTransactions.getById = originals.transactionGet;
    schoolRepositories.globalTransactions.transitionRegistrationTransactions = originals.transition;
    schoolRepositories.academicLedger.getById = originals.ledgerGet;
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

test('deleteDraftTermRegistration voids the draft through repository update', async () => {
  const originalGetByIdInOrg = schoolRepositories.studentTermRegistrations.getByIdInOrg;
  const originalGetById = schoolRepositories.studentTermRegistrations.getById;
  const originalDiscover = classEnrollmentReadService.discoverClassEnrollmentRowsByRegistrationId;
  const originalWithdrawalList = withdrawalRepository.list;
  const originalUpdate = schoolRepositories.studentTermRegistrations.update;
  const originalFindReversal = schoolRepositories.globalTransactions.findReversalByTransactionId;
  const originalGetTx = schoolRepositories.globalTransactions.getById;
  const originalGetLedger = schoolRepositories.academicLedger.getById;

  const registration = buildDraftRegistration();
  let updatedPayload = null;

  schoolRepositories.studentTermRegistrations.getByIdInOrg = async () => registration;
  schoolRepositories.studentTermRegistrations.getById = async () => registration;
  classEnrollmentReadService.discoverClassEnrollmentRowsByRegistrationId = async () => ({ source: 'canonical', rows: [] });
  withdrawalRepository.list = async () => [];
  schoolRepositories.globalTransactions.findReversalByTransactionId = async () => null;
  schoolRepositories.globalTransactions.getById = async () => null;
  schoolRepositories.academicLedger.getById = async () => null;
  schoolRepositories.studentTermRegistrations.update = async (id, payload) => {
    updatedPayload = { id, payload };
    return payload;
  };

  try {
    const result = await registrationIntegrityService.deleteDraftTermRegistration(TERM_REG_ID, {
      activeOrgId: ORG_ID,
      reqUser: { id: 'USR-1' }
    });
    assert.equal(result.registrationId, TERM_REG_ID);
    assert.equal(result.operation, 'void');
    assert.equal(updatedPayload.id, TERM_REG_ID);
    assert.equal(updatedPayload.payload.status, 'void');
    assert.equal(updatedPayload.payload.statusBeforeVoid, 'draft');
  } finally {
    schoolRepositories.studentTermRegistrations.getByIdInOrg = originalGetByIdInOrg;
    schoolRepositories.studentTermRegistrations.getById = originalGetById;
    classEnrollmentReadService.discoverClassEnrollmentRowsByRegistrationId = originalDiscover;
    withdrawalRepository.list = originalWithdrawalList;
    schoolRepositories.globalTransactions.findReversalByTransactionId = originalFindReversal;
    schoolRepositories.globalTransactions.getById = originalGetTx;
    schoolRepositories.academicLedger.getById = originalGetLedger;
    schoolRepositories.studentTermRegistrations.update = originalUpdate;
  }
});

test('termRegistrationController rollback route deletes drafts instead of no-op', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/termRegistrationController.js'),
    'utf8'
  );
  assert.match(source, /deleteDraftTermRegistration/);
  assert.match(source, /Draft term registration voided/);
  assert.doesNotMatch(source, /Registration is already in draft/);
  assert.match(source, /rollbackTermRegistrationSideEffects/);
  assert.match(source, /entryIds: \[\]/);
  assert.match(source, /transactionIds: \[\]/);
});

test('registrationIntegrityService voids drafts through repository update', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../MVC/services/school/registrationIntegrityService.js'),
    'utf8'
  );
  assert.match(source, /studentTermRegistrations\.update/);
  assert.match(source, /buildVoidPatch/);
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
