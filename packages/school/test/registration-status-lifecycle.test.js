const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schoolRepositories = require('../MVC/repositories/school');
const statusLifecycle = require('../MVC/services/school/registrationStatusLifecycleService');

function charge(overrides = {}) {
  return {
    id: 'TX-1',
    orgId: 'ORG-1',
    status: 'posted',
    transactionType: 'charge',
    effectiveDate: '2026-07-01',
    source: { idempotencyKey: 'REGTX|PROGRAM|SPR-1|LINE-1' },
    party: { studentId: 'STU-1', programId: 'PRG-1', feeCategory: 'general' },
    fee: { category: 'tuition', code: 'TUITION', label: 'Tuition' },
    amount: { value: 250, currency: 'CAD', direction: 'debit' },
    balanceEffect: 250,
    metadata: {
      accountId: 'ACC-1',
      registrationType: 'program',
      registrationId: 'SPR-1',
      draftLineId: 'LINE-1'
    },
    ...overrides
  };
}

function reversal(overrides = {}) {
  return {
    id: 'REV-1',
    orgId: 'ORG-1',
    status: 'posted',
    transactionType: 'reversal',
    effectiveDate: '2026-07-15',
    reversalOfTransactionId: 'TX-1',
    source: { idempotencyKey: 'REGREV|SPR-1|TX-1' },
    party: { studentId: 'STU-1', programId: 'PRG-1', feeCategory: 'general' },
    fee: { category: 'tuition', code: 'TUITION', label: 'Tuition' },
    amount: { value: 250, currency: 'CAD', direction: 'credit' },
    balanceEffect: -250,
    metadata: { accountId: 'ACC-1' },
    ...overrides
  };
}

function programRegistration(overrides = {}) {
  return {
    id: 'SPR-1',
    orgId: 'ORG-1',
    studentId: 'STU-1',
    personId: 'PER-1',
    programId: 'PRG-1',
    registrationDate: '2026-07-01',
    status: 'registered',
    transactionSummary: {
      transactionIds: ['TX-1'],
      postedTransactionIds: ['TX-1'],
      activePostingCycleNo: 1,
      postingCycles: [{
        cycleNo: 1,
        cycleId: 'PROGRAM-SPR-1-C1',
        status: 'posted',
        postedAt: '2026-07-01T12:00:00.000Z',
        transactionIds: ['TX-1'],
        reversalIds: []
      }]
    },
    ...overrides
  };
}

test('program cancellation previews and posts exact reversals before changing status', async () => {
  const originals = {
    getProgram: schoolRepositories.studentProgramRegistrations.getById,
    updateProgram: schoolRepositories.studentProgramRegistrations.update,
    listTerms: schoolRepositories.studentTermRegistrations.list,
    findPeriods: schoolRepositories.classEnrollmentPeriods.findByStudentId,
    getTransaction: schoolRepositories.globalTransactions.getById,
    listTransactions: schoolRepositories.globalTransactions.list,
    reverseTransaction: schoolRepositories.globalTransactions.reverseTransaction
  };
  let saved = null;
  let reverseCalls = 0;
  schoolRepositories.studentProgramRegistrations.getById = async () => programRegistration();
  schoolRepositories.studentProgramRegistrations.update = async (_id, payload) => { saved = payload; return payload; };
  schoolRepositories.studentTermRegistrations.list = async () => [];
  schoolRepositories.classEnrollmentPeriods.findByStudentId = async () => [];
  schoolRepositories.globalTransactions.getById = async (id) => id === 'REV-1' ? reversal() : charge();
  schoolRepositories.globalTransactions.list = async () => [];
  schoolRepositories.globalTransactions.reverseTransaction = async () => { reverseCalls += 1; return reversal(); };
  try {
    const preview = await statusLifecycle.previewTransition({
      registrationType: 'program',
      registrationId: 'SPR-1',
      targetStatus: 'cancelled',
      effectiveDate: '2026-07-15',
      reason: 'Student never attended',
      orgId: 'ORG-1'
    }, { requestingUser: { id: 'USR-1' } });
    assert.equal(preview.canApply, true);
    assert.equal(preview.adjustmentTotal, 250);
    assert.deepEqual(preview.sourceTransactions.map((row) => row.id), ['TX-1']);

    const result = await statusLifecycle.applyTransition({
      registrationType: 'program',
      registrationId: 'SPR-1',
      targetStatus: 'cancelled',
      effectiveDate: '2026-07-15',
      reason: 'Student never attended',
      orgId: 'ORG-1'
    }, { requestingUser: { id: 'USR-1' } });
    assert.equal(reverseCalls, 1);
    assert.equal(saved.status, 'cancelled');
    assert.equal(result.transactionSummary.postingCycles[0].status, 'reversed');
    assert.deepEqual(result.transactionSummary.reversalIds, ['REV-1']);
    assert.equal(result.transactionSummary.lifecycleStatusHistory[0].newStatus, 'cancelled');
  } finally {
    schoolRepositories.studentProgramRegistrations.getById = originals.getProgram;
    schoolRepositories.studentProgramRegistrations.update = originals.updateProgram;
    schoolRepositories.studentTermRegistrations.list = originals.listTerms;
    schoolRepositories.classEnrollmentPeriods.findByStudentId = originals.findPeriods;
    schoolRepositories.globalTransactions.getById = originals.getTransaction;
    schoolRepositories.globalTransactions.list = originals.listTransactions;
    schoolRepositories.globalTransactions.reverseTransaction = originals.reverseTransaction;
  }
});

test('program completion is blocked until active term and class children are resolved', async () => {
  const originals = {
    getProgram: schoolRepositories.studentProgramRegistrations.getById,
    listTerms: schoolRepositories.studentTermRegistrations.list,
    findPeriods: schoolRepositories.classEnrollmentPeriods.findByStudentId
  };
  schoolRepositories.studentProgramRegistrations.getById = async () => programRegistration();
  schoolRepositories.studentTermRegistrations.list = async () => [{ id: 'STR-1', status: 'registered' }];
  schoolRepositories.classEnrollmentPeriods.findByStudentId = async () => [{
    id: 'CEP-1', orgId: 'ORG-1', programId: 'PRG-1', classId: 'CLS-1', status: 'active'
  }];
  try {
    const preview = await statusLifecycle.previewTransition({
      registrationType: 'program',
      registrationId: 'SPR-1',
      targetStatus: 'completed',
      orgId: 'ORG-1'
    });
    assert.equal(preview.canApply, false);
    assert.deepEqual(preview.blockers.map((row) => row.registrationType).sort(), ['class', 'term']);
  } finally {
    schoolRepositories.studentProgramRegistrations.getById = originals.getProgram;
    schoolRepositories.studentTermRegistrations.list = originals.listTerms;
    schoolRepositories.classEnrollmentPeriods.findByStudentId = originals.findPeriods;
  }
});

test('terminal registrations cannot return to active or draft', async () => {
  const originalGet = schoolRepositories.studentProgramRegistrations.getById;
  schoolRepositories.studentProgramRegistrations.getById = async () => programRegistration({ status: 'cancelled' });
  try {
    await assert.rejects(() => statusLifecycle.previewTransition({
      registrationType: 'program',
      registrationId: 'SPR-1',
      targetStatus: 'registered',
      orgId: 'ORG-1'
    }), /Drafting and approval|Terminal registrations/);
  } finally {
    schoolRepositories.studentProgramRegistrations.getById = originalGet;
  }
});

test('draft registrations cannot bypass draft deletion or approval through terminal status actions', async () => {
  const originalGet = schoolRepositories.studentProgramRegistrations.getById;
  schoolRepositories.studentProgramRegistrations.getById = async () => programRegistration({ status: 'draft' });
  try {
    await assert.rejects(() => statusLifecycle.previewTransition({
      registrationType: 'program',
      registrationId: 'SPR-1',
      targetStatus: 'cancelled',
      orgId: 'ORG-1'
    }), /Only an active posted registration/);
  } finally {
    schoolRepositories.studentProgramRegistrations.getById = originalGet;
  }
});

test('routes and views require preview/apply and prevent generic class status bypass', () => {
  const programRoutes = fs.readFileSync(path.join(__dirname, '../MVC/routes/programRoutes.js'), 'utf8');
  const classRoutes = fs.readFileSync(path.join(__dirname, '../MVC/routes/classRoutes.js'), 'utf8');
  const classController = fs.readFileSync(path.join(__dirname, '../MVC/controllers/school/classRollingEnrollmentController.js'), 'utf8');
  const programView = fs.readFileSync(path.join(__dirname, '../MVC/views/school/program/programRegistrationDetails.ejs'), 'utf8');
  const termView = fs.readFileSync(path.join(__dirname, '../MVC/views/school/program/termRegistrationDetails.ejs'), 'utf8');
  const classView = fs.readFileSync(path.join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs'), 'utf8');

  assert.match(programRoutes, /registrations\/:id\/status\/preview/);
  assert.match(programRoutes, /registrations\/:id\/status\/apply[\s\S]*requireToken: true/);
  assert.match(programRoutes, /term-registrations\/:id\/status\/apply[\s\S]*requireToken: true/);
  assert.match(classRoutes, /enrollment-periods\/:periodId\/status\/apply/);
  const classStatusApplyRoute = classRoutes.slice(
    classRoutes.indexOf("router.post('/api/enrollment-periods/:periodId/status/apply'"),
    classRoutes.indexOf("router.post('/api/enrollment-periods/:periodId/reopen'")
  );
  assert.match(classStatusApplyRoute, /requireToken: true/);
  assert.doesNotMatch(classStatusApplyRoute, /allowInactiveTokenFallback/);
  assert.match(classController, /cannot be changed from the general edit action/);
  assert.match(classController, /Use the registration status preview and apply workflow/);
  assert.match(programView, /registrationStatusTransitionModal/);
  assert.match(termView, /registrationStatusTransitionModal/);
  assert.match(classView, /btn_previewClosePeriod/);
  assert.match(classView, /btn-row-archive/);
  assert.match(classView, /canReenter/);
  assert.match(classView, /status: 'draft'/);
  assert.match(classController, /ensureDraftTransactions/);
  assert.match(classController, /new enrollment draft was created/i);
});
