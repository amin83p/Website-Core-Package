const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schoolRepositories = require('../MVC/repositories/school');
const financeLifecycle = require('../MVC/services/school/registrationFinanceLifecycleService');
const {
  normalizeTransactionSummary,
  beginPostingCycle,
  updatePostingCycle
} = require('../MVC/models/school/registrationTransactionSummary');
const globalTransactionModel = require('../MVC/models/school/globalTransactionLedgerModel');
const withdrawalPolicy = require('../MVC/services/school/withdrawal/withdrawalPolicyService');

function originalTransaction(overrides = {}) {
  return {
    id: 'TX-1', orgId: 'ORG-1', status: 'posted',
    transactionType: 'charge',
    party: { studentId: 'STU-1', programId: 'PRG-1', feeCategory: 'general' },
    amount: { value: 125.5, currency: 'CAD', direction: 'debit' },
    balanceEffect: 125.5,
    metadata: { accountId: 'ACC-1' },
    ...overrides
  };
}

function reversalTransaction(overrides = {}) {
  return {
    id: 'REV-1', orgId: 'ORG-1', status: 'posted', reversalOfTransactionId: 'TX-1',
    amount: { value: 125.5, currency: 'CAD', direction: 'credit' },
    balanceEffect: -125.5,
    metadata: { accountId: 'ACC-1' },
    ...overrides
  };
}

test('legacy transaction summary normalizes to a canonical posting cycle', () => {
  const summary = normalizeTransactionSummary({
    transactionIds: ['TX-1'], reversalIds: ['REV-1'], approvedAt: '2026-07-01T00:00:00.000Z'
  }, { registrationType: 'term', registrationId: 'STR-1' });
  assert.equal(summary.postingCycles.length, 1);
  assert.equal(summary.postingCycles[0].cycleId, 'TERM-STR-1-C1');
  assert.equal(summary.postingCycles[0].status, 'reversed');
  assert.deepEqual(summary.postingCycles[0].transactionIds, ['TX-1']);
});

test('registration lifecycle history is bounded and sanitizes its financial snapshot', () => {
  const summary = normalizeTransactionSummary({
    lifecycleStatusHistory: [{
      actor: ' USR-1 ',
      timestamp: '2026-07-15T12:00:00.000Z',
      reason: ' Completed ',
      oldStatus: 'REGISTERED',
      newStatus: 'COMPLETED',
      effectiveDate: '2026-07-15',
      postingCycle: '2',
      financialSnapshot: {
        transactionIds: ['TX-1', 'TX-1'],
        reversalIds: ['REV-1'],
        total: '125.506'
      }
    }]
  });
  assert.deepEqual(summary.lifecycleStatusHistory[0], {
    actor: 'USR-1',
    timestamp: '2026-07-15T12:00:00.000Z',
    reason: 'Completed',
    oldStatus: 'registered',
    newStatus: 'completed',
    effectiveDate: '2026-07-15',
    postingCycle: 2,
    financialSnapshot: {
      transactionIds: ['TX-1'],
      reversalIds: ['REV-1'],
      total: 125.51
    }
  });
});

test('a returned-to-draft cycle allocates a new cycle while retaining stable transaction identity', () => {
  const first = beginPostingCycle({}, { registrationType: 'program', registrationId: 'SPR-1' });
  const firstPosted = updatePostingCycle(first.summary, first.cycle.cycleNo, {
    status: 'returned_to_draft', transactionIds: ['TX-1'], reversalIds: []
  }, { registrationType: 'program', registrationId: 'SPR-1' });
  const second = beginPostingCycle(firstPosted, { registrationType: 'program', registrationId: 'SPR-1' });
  const baseItem = { source: { eventId: 'FEE-DR', idempotencyKey: 'FEE|DR' }, metadata: {} };
  const firstScoped = financeLifecycle.scopePostingItems([baseItem], {
    registrationType: 'program', registrationId: 'SPR-1', cycle: first.cycle
  })[0];
  const secondScoped = financeLifecycle.scopePostingItems([baseItem], {
    registrationType: 'program', registrationId: 'SPR-1', cycle: second.cycle
  })[0];
  assert.equal(second.cycle.cycleNo, 2);
  assert.equal(firstScoped.source.idempotencyKey, secondScoped.source.idempotencyKey);
  assert.equal(secondScoped.metadata.postingCycleId, second.cycle.cycleId);
  assert.notEqual(firstScoped.metadata.postingCycleId, secondScoped.metadata.postingCycleId);
});

test('reversal validation checks amount, currency, direction, account, organization, and balance effect', () => {
  assert.deepEqual(financeLifecycle.validateReversalPair(originalTransaction(), reversalTransaction()), []);
  const issues = financeLifecycle.validateReversalPair(originalTransaction(), reversalTransaction({
    orgId: 'ORG-2',
    amount: { value: 100, currency: 'USD', direction: 'debit' },
    balanceEffect: 100,
    metadata: { accountId: 'ACC-2' }
  }));
  assert.ok(issues.some((issue) => /organization/.test(issue)));
  assert.ok(issues.some((issue) => /account/.test(issue)));
  assert.ok(issues.some((issue) => /amount/.test(issue)));
  assert.ok(issues.some((issue) => /currency/.test(issue)));
  assert.ok(issues.some((issue) => /direction/.test(issue)));
  assert.ok(issues.some((issue) => /balance effect/.test(issue)));
});

test('reconcileTransactions reuses a valid existing reversal without creating another', async () => {
  const originalList = schoolRepositories.globalTransactions.list;
  const originalGet = schoolRepositories.globalTransactions.getById;
  const originalReverse = schoolRepositories.globalTransactions.reverseTransaction;
  let reverseCalls = 0;
  schoolRepositories.globalTransactions.getById = async () => originalTransaction();
  schoolRepositories.globalTransactions.list = async () => [reversalTransaction()];
  schoolRepositories.globalTransactions.reverseTransaction = async () => { reverseCalls += 1; return reversalTransaction(); };
  try {
    const result = await financeLifecycle.reconcileTransactions({ transactionIds: ['TX-1'], registrationId: 'SPR-1' });
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.reversalIds, ['REV-1']);
    assert.equal(reverseCalls, 0);
  } finally {
    schoolRepositories.globalTransactions.list = originalList;
    schoolRepositories.globalTransactions.getById = originalGet;
    schoolRepositories.globalTransactions.reverseTransaction = originalReverse;
  }
});

test('postCycleTransactions reuses a matching posted row on same-cycle retry', async () => {
  const originalList = schoolRepositories.globalTransactions.list;
  const originalCreate = schoolRepositories.globalTransactions.create;
  const expected = {
    orgId: 'ORG-1', status: 'posted',
    transactionType: 'charge',
    source: { idempotencyKey: 'REGCYCLE|PROGRAM-SPR-1-C1|FEE|DR' },
    party: { studentId: 'STU-1', programId: 'PRG-1', feeCategory: 'general' },
    amount: { value: 125.5, currency: 'CAD', direction: 'debit' },
    metadata: { accountId: 'ACC-1', registrationType: 'program', registrationId: 'SPR-1' }
  };
  const existing = { ...expected, id: 'TX-1' };
  let createCalls = 0;
  schoolRepositories.globalTransactions.list = async () => [existing];
  schoolRepositories.globalTransactions.create = async () => { createCalls += 1; return []; };
  try {
    const rows = await financeLifecycle.postCycleTransactions([expected]);
    assert.deepEqual(rows.map((row) => row.id), ['TX-1']);
    assert.equal(createCalls, 0);
  } finally {
    schoolRepositories.globalTransactions.list = originalList;
    schoolRepositories.globalTransactions.create = originalCreate;
  }
});

test('syncDraftTransactions updates an owned draft row when its amount changes', async () => {
  const originalList = schoolRepositories.globalTransactions.list;
  const originalCreate = schoolRepositories.globalTransactions.create;
  const originalUpdate = schoolRepositories.globalTransactions.update;
  const originalTransition = schoolRepositories.globalTransactions.transitionRegistrationTransactions;
  const stableKey = 'REGTX|PROGRAM|SPR-1|LINE-1';
  const existing = originalTransaction({
    id: 'TX-EDIT-1',
    status: 'draft',
    postedAt: '',
    source: {
      module: 'school_program_registration',
      eventType: 'program_registration_charge',
      eventId: 'REGTX-PROGRAM-SPR-1-LINE-1',
      idempotencyKey: stableKey
    },
    metadata: {
      accountId: 'ACC-1',
      registrationType: 'program',
      registrationId: 'SPR-1',
      draftLineId: 'LINE-1',
      registrationLifecycle: { draftLineId: 'LINE-1', statusHistory: [] }
    }
  });
  const desired = {
    ...existing,
    id: undefined,
    amount: { ...existing.amount, value: 175.25 },
    balanceEffect: existing.balanceEffect,
    memo: 'Corrected draft amount'
  };
  let updatePayload = null;
  let createCalls = 0;
  schoolRepositories.globalTransactions.list = async () => [existing];
  schoolRepositories.globalTransactions.create = async () => { createCalls += 1; return []; };
  schoolRepositories.globalTransactions.update = async (id, payload) => {
    updatePayload = payload;
    return { ...existing, ...payload, id };
  };
  schoolRepositories.globalTransactions.transitionRegistrationTransactions = async () => {
    throw new Error('No draft transaction should be voided.');
  };
  try {
    const result = await financeLifecycle.syncDraftTransactions([desired], {
      registrationType: 'program',
      registrationId: 'SPR-1',
      orgId: 'ORG-1',
      currentDraftTransactionIds: ['TX-EDIT-1'],
      cycle: { cycleNo: 1, cycleId: 'PROGRAM-SPR-1-C1' }
    });
    assert.equal(createCalls, 0);
    assert.equal(updatePayload.amount.value, 175.25);
    assert.equal(updatePayload.balanceEffect, 175.25);
    assert.equal(result.rows[0].id, 'TX-EDIT-1');
    assert.equal(result.rows[0].amount.value, 175.25);
  } finally {
    schoolRepositories.globalTransactions.list = originalList;
    schoolRepositories.globalTransactions.create = originalCreate;
    schoolRepositories.globalTransactions.update = originalUpdate;
    schoolRepositories.globalTransactions.transitionRegistrationTransactions = originalTransition;
  }
});

test('syncDraftTransactions still rejects a draft row owned by another registration', async () => {
  const originalList = schoolRepositories.globalTransactions.list;
  const originalUpdate = schoolRepositories.globalTransactions.update;
  const stableKey = 'REGTX|PROGRAM|SPR-1|LINE-1';
  const expected = originalTransaction({
    status: 'draft',
    postedAt: '',
    source: {
      module: 'school_program_registration',
      eventType: 'program_registration_charge',
      eventId: 'REGTX-PROGRAM-SPR-1-LINE-1',
      idempotencyKey: stableKey
    },
    metadata: {
      accountId: 'ACC-1',
      registrationType: 'program',
      registrationId: 'SPR-1',
      draftLineId: 'LINE-1'
    }
  });
  let updateCalls = 0;
  schoolRepositories.globalTransactions.list = async () => [{
    ...expected,
    id: 'TX-WRONG-OWNER',
    metadata: { ...expected.metadata, registrationId: 'SPR-OTHER' }
  }];
  schoolRepositories.globalTransactions.update = async () => { updateCalls += 1; };
  try {
    await assert.rejects(
      financeLifecycle.syncDraftTransactions([expected], {
        registrationType: 'program',
        registrationId: 'SPR-1',
        orgId: 'ORG-1',
        cycle: { cycleNo: 1, cycleId: 'PROGRAM-SPR-1-C1' }
      }),
      /belongs to another registration/
    );
    assert.equal(updateCalls, 0);
  } finally {
    schoolRepositories.globalTransactions.list = originalList;
    schoolRepositories.globalTransactions.update = originalUpdate;
  }
});

test('postAcademicEntriesIdempotently reuses a posted same-cycle ledger entry', async () => {
  const originalList = schoolRepositories.academicLedger.list;
  let postCalls = 0;
  schoolRepositories.academicLedger.list = async () => [{
    id: 'LEDGER-1', status: 'posted', source: { idempotencyKey: 'REGCYCLE|PROGRAM-SPR-1-C1|academic' }
  }];
  try {
    const rows = await financeLifecycle.postAcademicEntriesIdempotently({
      source: { idempotencyKey: 'REGCYCLE|PROGRAM-SPR-1-C1|academic' },
      post: async () => { postCalls += 1; return []; }
    });
    assert.deepEqual(rows.map((row) => row.id), ['LEDGER-1']);
    assert.equal(postCalls, 0);
  } finally {
    schoolRepositories.academicLedger.list = originalList;
  }
});

test('legacy reversed term summaries retain their immutable posted reversal pair when the draft is voided', async () => {
  const originalGet = schoolRepositories.globalTransactions.getById;
  schoolRepositories.globalTransactions.getById = async (id) => id === 'REV-1' ? reversalTransaction() : originalTransaction();
  try {
    const result = await financeLifecycle.settleSummaryForVoid(
      { transactionIds: [], reversalIds: ['REV-1'] },
      { registrationType: 'term', registrationId: 'STR-1' }
    );
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.summary.transactionIds, []);
    assert.deepEqual(result.summary.postingCycles[0].transactionIds, ['TX-1']);
    assert.deepEqual(result.summary.reversalIds, ['REV-1']);
  } finally {
    schoolRepositories.globalTransactions.getById = originalGet;
  }
});

test('registration charge transitions preserve one id and append an auditable status history', () => {
  const draft = originalTransaction({
    status: 'draft',
    postedAt: '',
    metadata: {
      accountId: 'ACC-1',
      registrationType: 'program',
      registrationId: 'SPR-1',
      draftLineId: 'LINE-1'
    }
  });
  const posted = globalTransactionModel.transitionRegistrationTransactionRow(draft, {
    registrationType: 'program', registrationId: 'SPR-1', orgId: 'ORG-1',
    fromStatus: 'draft', toStatus: 'posted', actor: 'USR-1', reason: 'Approved',
    cycleNo: 1, transitionedAt: '2026-07-01T12:00:00.000Z'
  });
  const returned = globalTransactionModel.transitionRegistrationTransactionRow(posted, {
    registrationType: 'program', registrationId: 'SPR-1', orgId: 'ORG-1',
    fromStatus: 'posted', toStatus: 'draft', actor: 'USR-1', reason: 'Correction',
    cycleNo: 1, transitionedAt: '2026-07-02T12:00:00.000Z'
  });
  const voided = globalTransactionModel.transitionRegistrationTransactionRow(returned, {
    registrationType: 'program', registrationId: 'SPR-1', orgId: 'ORG-1',
    fromStatus: 'draft', toStatus: 'voided', actor: 'USR-1', reason: 'Draft deleted',
    cycleNo: 1, transitionedAt: '2026-07-03T12:00:00.000Z'
  });
  assert.equal(posted.id, 'TX-1');
  assert.equal(returned.id, 'TX-1');
  assert.equal(voided.id, 'TX-1');
  assert.equal(returned.status, 'draft');
  assert.equal(voided.status, 'voided');
  assert.equal(returned.postedAt, '');
  assert.equal(voided.metadata.registrationLifecycle.statusHistory.length, 3);
  assert.equal(returned.metadata.registrationLifecycle.statusHistory[1].postedSnapshot.amount.value, 125.5);
});

test('legacy ownership backfill requires exact organization, party, account, amount, currency, and direction', () => {
  const legacy = originalTransaction({ metadata: { accountId: 'ACC-1' } });
  const expectation = {
    orgId: 'ORG-1',
    party: { studentId: 'STU-1', programId: 'PRG-1' },
    amount: { value: 125.5, currency: 'CAD', direction: 'debit' },
    metadata: { accountId: 'ACC-1', draftLineId: 'LINE-1' }
  };
  const adopted = globalTransactionModel.applyRegistrationOwnershipBackfill(legacy, {
    registrationType: 'program',
    registrationId: 'SPR-1',
    orgId: 'ORG-1',
    expectation,
    actor: 'USR-1',
    cycleNo: 1
  });
  assert.equal(adopted.metadata.registrationType, 'program');
  assert.equal(adopted.metadata.registrationId, 'SPR-1');
  assert.throws(() => globalTransactionModel.applyRegistrationOwnershipBackfill(legacy, {
    registrationType: 'program',
    registrationId: 'SPR-1',
    orgId: 'ORG-1',
    expectation: { ...expectation, amount: { ...expectation.amount, value: 99 } }
  }), /amount mismatch/);
});

test('class rollback/delete controller contract permits rollback and soft-voids drafts', () => {
  const controller = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/classRollingEnrollmentController.js'),
    'utf8'
  );
  const deleteService = fs.readFileSync(
    path.join(__dirname, '../MVC/services/school/classEnrollmentDeleteService.js'),
    'utf8'
  );
  const model = fs.readFileSync(
    path.join(__dirname, '../MVC/models/school/classEnrollmentPeriodModel.js'),
    'utf8'
  );
  assert.match(controller, /allowPostedRollback: true/);
  assert.match(controller, /settleSummaryForVoid/);
  assert.match(controller, /buildVoidPatch\(periodRow/);
  assert.match(deleteService, /allowPostedRollback/);
  assert.match(model, /postingCycles: normalized\.postingCycles/);
  assert.match(model, /draftTransactionIds: normalized\.draftTransactionIds/);
  assert.match(model, /reversalIds: normalized\.reversalIds/);
});

test('global transaction repository exposes JSON and Mongo lifecycle parity with conditional updates', () => {
  const repository = fs.readFileSync(
    path.join(__dirname, '../MVC/repositories/school/index.js'),
    'utf8'
  );
  const transitionBlock = repository.slice(
    repository.indexOf('globalTransactions.transitionRegistrationTransactions'),
    repository.indexOf('globalTransactions.backfillRegistrationTransactionOwnership')
  );
  const backfillBlock = repository.slice(
    repository.indexOf('globalTransactions.backfillRegistrationTransactionOwnership'),
    repository.indexOf('globalTransactions.reverseTransaction')
  );
  assert.match(transitionBlock, /json: async \(\) => globalTransactionLedgerModel\.transitionRegistrationTransactions/);
  assert.match(transitionBlock, /mongo: async \(\) =>/);
  assert.match(transitionBlock, /withMongoTransaction/);
  assert.match(transitionBlock, /status: transition\.fromStatus/);
  assert.match(transitionBlock, /'metadata\.registrationType': transition\.registrationType/);
  assert.match(transitionBlock, /'metadata\.registrationId': transition\.registrationId/);
  assert.match(backfillBlock, /json: async \(\) => globalTransactionLedgerModel\.backfillRegistrationTransactionOwnership/);
  assert.match(backfillBlock, /withMongoTransaction/);
  assert.match(backfillBlock, /orgId: input\.orgId/);
});

test('withdrawal services settle finance before terminal status and reuse academic entries on retries', () => {
  [
    'programWithdrawalService.js',
    'termWithdrawalService.js',
    'classWithdrawalService.js'
  ].forEach((filename) => {
    const source = fs.readFileSync(
      path.join(__dirname, '../MVC/services/school/withdrawal', filename),
      'utf8'
    );
    const settlementIndex = source.indexOf('settleRefund');
    const withdrawnIndex = source.lastIndexOf("status: 'withdrawn'");
    assert.ok(settlementIndex >= 0, filename + ' must settle a refund or retained amount');
    assert.ok(withdrawnIndex > settlementIndex, filename + ' must not mark withdrawn before settlement');
    assert.match(source, /postAcademicEntriesIdempotently/);
    assert.match(source, /Financial settlement is incomplete/);
  });
});

test('withdrawal policy retains full, partial, prorated, and no-refund outcomes', () => {
  const term = {
    classesStartDate: '2026-01-10',
    classesEndDate: '2026-05-10',
    addDropDeadline: '2026-01-17',
    withdrawWithoutPenaltyDeadline: '2026-02-01',
    withdrawDeadline: '2026-04-15'
  };
  assert.deepEqual(
    withdrawalPolicy.calculateRefundPercentage('2026-01-05', term),
    { percentage: 100, policy: 'full_refund', reason: 'Before classes start' }
  );
  assert.equal(withdrawalPolicy.calculateRefundPercentage('2026-01-25', term).policy, 'partial_refund');
  const prorated = withdrawalPolicy.calculateRefundPercentage('2026-03-01', term);
  assert.equal(prorated.policy, 'prorated_refund');
  assert.ok(prorated.percentage > 0 && prorated.percentage < 100);
  assert.equal(withdrawalPolicy.calculateRefundPercentage('2026-04-20', term).policy, 'no_refund');
});

test('statements default to posted rows and hide reversal pairs unless explicitly requested', () => {
  const controller = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/transactionsManagerController.js'),
    'utf8'
  );
  assert.match(controller, /statuses: statuses\.length \? statuses : \['posted'\]/);
  assert.match(controller, /includeReversalsRaw[\s\S]*: false/);
  assert.match(controller, /if \(!statementFilters\.includeReversals\)/);
  assert.match(controller, /reversalOfTransactionId/);
});

test('registration details expose lifecycle counts and do not duplicate materialized draft rows', () => {
  [
    'programRegistrationViewService.js',
    'termRegistrationViewService.js'
  ].forEach((filename) => {
    const source = fs.readFileSync(
      path.join(__dirname, '../MVC/services/school', filename),
      'utf8'
    );
    assert.match(source, /resolveFinanceLifecycleState/);
    assert.match(source, /state: financeState/);
    assert.match(source, /draft: draftTransactions/);
    assert.match(source, /voided: voidedTransactions/);
    assert.match(source, /metadata\?\.globalTransactionId/);
    assert.match(source, /recordedTransactionIds\.has/);
  });
});
