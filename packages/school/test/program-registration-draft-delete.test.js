const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schoolRepositories = require('../MVC/repositories/school');
const registrationIntegrityService = require('../MVC/services/school/registrationIntegrityService');
const withdrawalRepository = require('../MVC/repositories/school/withdrawalRepository');
const programRegistrationViewService = require('../MVC/services/school/programRegistrationViewService');

const ORG_ID = 'ORG-900001';
const PROGRAM_REG_ID = 'SPR-900001';

function buildDraftRegistration(overrides = {}) {
  return {
    id: PROGRAM_REG_ID,
    orgId: ORG_ID,
    studentId: 'STU-900001',
    personId: 'PER-900001',
    programId: 'PRG-900001',
    status: 'draft',
    transactionSummary: { transactionIds: [], postedCount: 0 },
    academicSummary: { entryIds: [], entryCount: 0 },
    ...overrides
  };
}

test('assertProgramDraftDeletionAllowed rejects non-draft registrations', async () => {
  await assert.rejects(
    () => registrationIntegrityService.assertProgramDraftDeletionAllowed(
      buildDraftRegistration({ status: 'registered' }),
      { activeOrgId: ORG_ID }
    ),
    /Only draft program registrations can be deleted/
  );
});

test('deleteDraftProgramRegistration returns unexpected posted charges to draft and voids the same ids', async () => {
  const originals = {
    getByIdInOrg: schoolRepositories.studentProgramRegistrations.getByIdInOrg,
    getById: schoolRepositories.studentProgramRegistrations.getById,
    update: schoolRepositories.studentProgramRegistrations.update,
    termCount: schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId,
    classCount: schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram,
    withdrawalList: withdrawalRepository.list,
    transactionList: schoolRepositories.globalTransactions.list,
    transactionGet: schoolRepositories.globalTransactions.getById,
    transition: schoolRepositories.globalTransactions.transitionRegistrationTransactions,
    ledgerGet: schoolRepositories.academicLedger.getById
  };
  const registration = buildDraftRegistration({ transactionSummary: { transactionIds: ['TX-1'], postedCount: 0 } });
  const transitions = [];
  let saved = null;
  schoolRepositories.studentProgramRegistrations.getByIdInOrg = async () => registration;
  schoolRepositories.studentProgramRegistrations.getById = async () => registration;
  schoolRepositories.studentProgramRegistrations.update = async (_id, payload) => { saved = payload; return payload; };
  schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId = async () => 0;
  schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram = async () => 0;
  withdrawalRepository.list = async () => [];
  schoolRepositories.globalTransactions.list = async () => [];
  schoolRepositories.globalTransactions.getById = async () => ({
    id: 'TX-1', orgId: ORG_ID, status: 'posted',
    transactionType: 'charge',
    amount: { value: 100, currency: 'CAD', direction: 'debit' },
    balanceEffect: 100,
    metadata: {
      accountId: 'ACC-1',
      registrationType: 'program',
      registrationId: PROGRAM_REG_ID
    }
  });
  schoolRepositories.globalTransactions.transitionRegistrationTransactions = async (input) => {
    transitions.push({ fromStatus: input.fromStatus, toStatus: input.toStatus, ids: input.transactionIds });
    return input.transactionIds.map((id) => ({ id, status: input.toStatus }));
  };
  schoolRepositories.academicLedger.getById = async () => null;
  try {
    await registrationIntegrityService.deleteDraftProgramRegistration(PROGRAM_REG_ID, {
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
    schoolRepositories.studentProgramRegistrations.getByIdInOrg = originals.getByIdInOrg;
    schoolRepositories.studentProgramRegistrations.getById = originals.getById;
    schoolRepositories.studentProgramRegistrations.update = originals.update;
    schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId = originals.termCount;
    schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram = originals.classCount;
    withdrawalRepository.list = originals.withdrawalList;
    schoolRepositories.globalTransactions.list = originals.transactionList;
    schoolRepositories.globalTransactions.getById = originals.transactionGet;
    schoolRepositories.globalTransactions.transitionRegistrationTransactions = originals.transition;
    schoolRepositories.academicLedger.getById = originals.ledgerGet;
  }
});

test('assertProgramDraftDeletionAllowed rejects drafts with active academic ledger entries', async () => {
  const originalFindReversal = schoolRepositories.globalTransactions.findReversalByTransactionId;
  const originalGetTx = schoolRepositories.globalTransactions.getById;
  const originalGetLedger = schoolRepositories.academicLedger.getById;

  schoolRepositories.globalTransactions.findReversalByTransactionId = async () => null;
  schoolRepositories.globalTransactions.getById = async () => null;
  schoolRepositories.academicLedger.getById = async () => ({ id: 'LEDGER/2', status: 'posted' });

  try {
    await assert.rejects(
      () => registrationIntegrityService.assertProgramDraftDeletionAllowed(
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

test('assertProgramDraftDeletionAllowed rejects drafts with dependent term registrations', async () => {
  const originalCount = schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId;
  const originalFind = schoolRepositories.studentTermRegistrations.findActiveByProgramRegistrationId;
  const originalFindReversal = schoolRepositories.globalTransactions.findReversalByTransactionId;
  const originalGetTx = schoolRepositories.globalTransactions.getById;
  const originalGetLedger = schoolRepositories.academicLedger.getById;

  schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId = async () => 1;
  schoolRepositories.studentTermRegistrations.findActiveByProgramRegistrationId = async () => [{ id: 'STR-1' }];
  schoolRepositories.globalTransactions.findReversalByTransactionId = async () => null;
  schoolRepositories.globalTransactions.getById = async () => null;
  schoolRepositories.academicLedger.getById = async () => null;

  try {
    await assert.rejects(
      () => registrationIntegrityService.assertProgramDraftDeletionAllowed(
        buildDraftRegistration(),
        { activeOrgId: ORG_ID }
      ),
      /term registrations exist/
    );
  } finally {
    schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId = originalCount;
    schoolRepositories.studentTermRegistrations.findActiveByProgramRegistrationId = originalFind;
    schoolRepositories.globalTransactions.findReversalByTransactionId = originalFindReversal;
    schoolRepositories.globalTransactions.getById = originalGetTx;
    schoolRepositories.academicLedger.getById = originalGetLedger;
  }
});

test('deleteDraftProgramRegistration voids the draft through repository update', async () => {
  const originalGetByIdInOrg = schoolRepositories.studentProgramRegistrations.getByIdInOrg;
  const originalGetById = schoolRepositories.studentProgramRegistrations.getById;
  const originalCount = schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId;
  const originalClassCount = schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram;
  const originalWithdrawalList = withdrawalRepository.list;
  const originalUpdate = schoolRepositories.studentProgramRegistrations.update;
  const originalFindReversal = schoolRepositories.globalTransactions.findReversalByTransactionId;
  const originalGetTx = schoolRepositories.globalTransactions.getById;
  const originalGetLedger = schoolRepositories.academicLedger.getById;

  const registration = buildDraftRegistration();
  let updatedPayload = null;

  schoolRepositories.studentProgramRegistrations.getByIdInOrg = async () => registration;
  schoolRepositories.studentProgramRegistrations.getById = async () => registration;
  schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId = async () => 0;
  schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram = async () => 0;
  withdrawalRepository.list = async () => [];
  schoolRepositories.globalTransactions.findReversalByTransactionId = async () => null;
  schoolRepositories.globalTransactions.getById = async () => null;
  schoolRepositories.academicLedger.getById = async () => null;
  schoolRepositories.studentProgramRegistrations.update = async (id, payload) => {
    updatedPayload = { id, payload };
    return payload;
  };

  try {
    const result = await registrationIntegrityService.deleteDraftProgramRegistration(PROGRAM_REG_ID, {
      activeOrgId: ORG_ID,
      reqUser: { id: 'USR-1' }
    });
    assert.equal(result.registrationId, PROGRAM_REG_ID);
    assert.equal(result.operation, 'void');
    assert.equal(updatedPayload.id, PROGRAM_REG_ID);
    assert.equal(updatedPayload.payload.status, 'void');
    assert.equal(updatedPayload.payload.statusBeforeVoid, 'draft');
    assert.equal(updatedPayload.payload.voidedBy, 'USR-1');
  } finally {
    schoolRepositories.studentProgramRegistrations.getByIdInOrg = originalGetByIdInOrg;
    schoolRepositories.studentProgramRegistrations.getById = originalGetById;
    schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId = originalCount;
    schoolRepositories.classEnrollmentPeriods.countBlockingByStudentAndProgram = originalClassCount;
    withdrawalRepository.list = originalWithdrawalList;
    schoolRepositories.globalTransactions.findReversalByTransactionId = originalFindReversal;
    schoolRepositories.globalTransactions.getById = originalGetTx;
    schoolRepositories.academicLedger.getById = originalGetLedger;
    schoolRepositories.studentProgramRegistrations.update = originalUpdate;
  }
});

test('programRegistrationController rollback route deletes drafts instead of no-op', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/programRegistrationController.js'),
    'utf8'
  );
  assert.match(source, /deleteDraftProgramRegistration/);
  assert.match(source, /Draft program registration voided/);
  assert.doesNotMatch(source, /Registration is already in draft/);
  assert.match(source, /rollbackProgramRegistrationSideEffects/);
});

test('registrationIntegrityService voids program drafts through repository update', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../MVC/services/school/registrationIntegrityService.js'),
    'utf8'
  );
  assert.match(source, /studentProgramRegistrations\.update/);
  assert.match(source, /buildVoidPatch/);
  assert.match(source, /assertProgramDraftDeletionAllowed/);
  assert.match(source, /deleteDraftProgramRegistration/);
});

test('programRegistrationViewService exposes canDeleteDraft and canRollback separately', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../MVC/services/school/programRegistrationViewService.js'),
    'utf8'
  );
  assert.match(source, /canDeleteDraft:/);
  assert.match(source, /rollbackEligibleStatus = \['registered', 'error'\]/);
  assert.doesNotMatch(source, /rollbackEligibleStatus = \['registered', 'draft', 'error'\]/);
});

test('program registration views use Delete Draft copy for draft records', () => {
  const details = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/program/programRegistrationDetails.ejs'),
    'utf8'
  );
  const list = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/program/programRegistrationList.ejs'),
    'utf8'
  );
  const batch = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/program/programRegistrationBatch.ejs'),
    'utf8'
  );

  assert.match(details, /Delete Draft/);
  assert.match(details, /btnDeleteDraftRegistration/);
  assert.doesNotMatch(details, /Cancel Draft/);

  assert.match(list, /delete-draft-btn/);
  assert.match(list, /Delete Draft/);
  assert.doesNotMatch(list, /Cancel Draft/);

  assert.match(batch, /data-delete-draft-registration/);
  assert.match(batch, /Delete Draft/);
  assert.doesNotMatch(batch, /Cancel Draft/);
});
