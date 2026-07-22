'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const funderService = require('../packages/school/MVC/services/school/rollingEnrollmentFunderService');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('normalizeEnrollmentFunderSelection maps empty and self to Self Fund', () => {
  assert.deepEqual(funderService.normalizeEnrollmentFunderSelection({}), {
    funderId: 'self',
    funderType: 'self'
  });
  assert.deepEqual(funderService.normalizeEnrollmentFunderSelection({ funderId: 'self' }), {
    funderId: 'self',
    funderType: 'self'
  });
  assert.deepEqual(funderService.normalizeEnrollmentFunderSelection({ funderId: '  SELF  ' }), {
    funderId: 'self',
    funderType: 'self'
  });
});

test('normalizeEnrollmentFunderSelection maps registered funder ids', () => {
  assert.deepEqual(
    funderService.normalizeEnrollmentFunderSelection({ funderId: 'FUN_123', funderType: 'ignored' }),
    { funderId: 'FUN_123', funderType: 'funder' }
  );
});

test('resolveEnrollmentBillingAccountId uses student account for Self Fund', () => {
  assert.equal(
    funderService.resolveEnrollmentBillingAccountId({
      funderId: 'self',
      student: { studentAccountId: 'ACC_STU_1' },
      chargeable: true
    }),
    'ACC_STU_1'
  );
});

test('resolveEnrollmentBillingAccountId uses funder account for registered funder', () => {
  assert.equal(
    funderService.resolveEnrollmentBillingAccountId({
      funderId: 'FUN_1',
      student: { studentAccountId: 'ACC_STU_1' },
      funderRecord: { id: 'FUN_1', status: 'active', funderAccountId: 'ACC_FUN_1' },
      chargeable: true
    }),
    'ACC_FUN_1'
  );
});

test('resolveEnrollmentBillingAccountId rejects chargeable funder without linked account', () => {
  assert.throws(
    () => funderService.resolveEnrollmentBillingAccountId({
      funderId: 'FUN_1',
      student: { studentAccountId: 'ACC_STU_1' },
      funderRecord: { id: 'FUN_1', status: 'active', funderAccountId: '' },
      chargeable: true
    }),
    /no linked financial account/i
  );
});

test('appendStudentDetailToDraftMemos adds student detail once', () => {
  const items = [{ memo: 'Class fee' }, { memo: 'Class fee | Student: Ada (STU_1)' }];
  const out = funderService.appendStudentDetailToDraftMemos(items, {
    studentId: 'STU_1',
    studentLabel: 'Ada'
  });
  assert.equal(out[0].memo, 'Class fee | Student: Ada (STU_1)');
  assert.equal(out[1].memo, 'Class fee | Student: Ada (STU_1)');
});

test('resolveEnrollmentFunderLabel prefers known funder name and Self Fund default', () => {
  const labels = new Map([['FUN_1', 'WCB Alberta']]);
  assert.equal(
    funderService.resolveEnrollmentFunderLabel({ funderId: 'self', funderType: 'self' }, labels),
    'Self Fund'
  );
  assert.equal(
    funderService.resolveEnrollmentFunderLabel({ funderId: 'FUN_1', funderType: 'funder' }, labels),
    'WCB Alberta'
  );
  assert.equal(
    funderService.resolveEnrollmentFunderLabel({ funderId: 'LEGACY', funderType: 'agency' }, labels),
    'agency / LEGACY'
  );
});

test('rolling enrollment New modal uses Funder select and removes free-text funder fields', () => {
  const view = read('packages/school/MVC/views/school/class/rollingEnrollment.ejs');
  assert.match(view, /id="inp_funder"/);
  assert.match(view, /Self Fund/);
  assert.match(view, /id="edit_funder"/);
  assert.match(view, /id="reentry_funder"/);
  assert.doesNotMatch(view, /id="inp_funderId"/);
  assert.doesNotMatch(view, /id="inp_funderType"/);
  assert.doesNotMatch(view, /id="inp_authorizationRef"/);
  assert.doesNotMatch(view, /Authorization Ref/);
  assert.match(view, /<th>Funder<\/th>/);
  assert.doesNotMatch(view, /Funder \(Type \/ ID\)/);
  assert.doesNotMatch(view, /Auth Ref/);
});

test('rolling enrollment New status options are Active, To be Confirmed, Waiting list', () => {
  const view = read('packages/school/MVC/views/school/class/rollingEnrollment.ejs');
  const statusBlock = view.match(/id="inp_status"[\s\S]*?<\/select>/)?.[0] || '';
  assert.match(statusBlock, /value="active"/);
  assert.match(statusBlock, /value="to_be_confirmed"/);
  assert.match(statusBlock, /To be Confirmed/);
  assert.match(statusBlock, /value="waiting_list"/);
  assert.match(statusBlock, /Waiting list/);
  assert.doesNotMatch(statusBlock, /value="planned"/);
  assert.doesNotMatch(statusBlock, /value="draft"/);

  const model = read('packages/school/MVC/models/school/classEnrollmentPeriodModel.js');
  assert.match(model, /'to_be_confirmed'/);
  assert.match(model, /'waiting_list'/);
});

test('rolling enrollment controller loads funder options and threads billingAccountId', () => {
  const controller = read('packages/school/MVC/controllers/school/classRollingEnrollmentController.js');
  assert.match(controller, /rollingEnrollmentFunderService/);
  assert.match(controller, /loadActiveFunderOptions/);
  assert.match(controller, /funderOptions/);
  assert.match(controller, /billingAccountId/);
  assert.match(controller, /enrichStudentMemo/);
  assert.match(controller, /normalizeEnrollmentFunderSelection/);
});

test('collectAttachedEnrollmentTransactionIds reads draft and posted ids', () => {
  assert.deepEqual(funderService.collectAttachedEnrollmentTransactionIds({}), []);
  assert.deepEqual(
    funderService.collectAttachedEnrollmentTransactionIds({
      transactionSummary: {
        postedTransactionIds: ['TX_1', 'TX_1'],
        draftTransactionIds: ['TX_DRAFT'],
        transactionIds: ['TX_LEGACY']
      }
    }),
    ['TX_1', 'TX_DRAFT', 'TX_LEGACY']
  );
});

test('assertEnrollmentFunderChangeAllowed allows empty summary and same funder', () => {
  assert.doesNotThrow(() => {
    funderService.assertEnrollmentFunderChangeAllowed(
      { funderId: 'self', funderType: 'self' },
      { funderId: 'FUN_NEW' }
    );
  });
  assert.doesNotThrow(() => {
    funderService.assertEnrollmentFunderChangeAllowed(
      {
        funderId: 'FUN_1',
        funderType: 'funder',
        transactionSummary: { postedTransactionIds: ['TX_1'] }
      },
      { funderId: 'FUN_1', funderType: 'funder' }
    );
  });
});

test('assertEnrollmentFunderChangeAllowed blocks funder change when transactions are attached', () => {
  assert.throws(
    () => funderService.assertEnrollmentFunderChangeAllowed(
      {
        funderId: 'self',
        funderType: 'self',
        transactionSummary: { postedTransactionIds: ['TX_1'] }
      },
      { funderId: 'FUN_2' }
    ),
    /already has financial transactions/i
  );
  assert.throws(
    () => funderService.assertEnrollmentFunderChangeAllowed(
      {
        funderId: 'FUN_1',
        funderType: 'funder',
        transactionSummary: { draftTransactionIds: ['TX_DRAFT'] }
      },
      { funderId: 'self' }
    ),
    /already has financial transactions/i
  );
});

test('rolling enrollment locks edit funder when transactions are attached', () => {
  const controller = read('packages/school/MVC/controllers/school/classRollingEnrollmentController.js');
  assert.match(controller, /assertEnrollmentFunderChangeAllowed/);
  assert.equal(
    (controller.match(/assertEnrollmentFunderChangeAllowed/g) || []).length,
    3
  );

  const view = read('packages/school/MVC/views/school/class/rollingEnrollment.ejs');
  assert.match(view, /setEditFunderLocked/);
  assert.match(view, /enrollmentHasAttachedTransactions/);
  assert.match(view, /edit_funder_help/);
  assert.match(view, /Funder is locked because this enrollment already has financial transactions/);
});
