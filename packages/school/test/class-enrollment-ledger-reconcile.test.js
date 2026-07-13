const test = require('node:test');
const assert = require('node:assert/strict');

const {
  rollingClassEnrolledIdempotencyKey,
  entryMatchesRollingClassEnrollmentLedger
} = require('../MVC/services/school/registrationIntegrityService');

test('rollingClassEnrolledIdempotencyKey builds stable rolling enrollment key', () => {
  assert.equal(
    rollingClassEnrolledIdempotencyKey('CEP/42'),
    'rolling|cep|CEP/42|class_enrolled'
  );
});

test('entryMatchesRollingClassEnrollmentLedger matches period idempotency key', () => {
  const row = {
    id: 'LEDGER/1',
    entryType: 'class_enrolled',
    status: 'posted',
    classId: 'CLASS/9',
    studentId: 'STU/1',
    source: { idempotencyKey: 'rolling|cep|CEP/42|class_enrolled' }
  };
  assert.equal(entryMatchesRollingClassEnrollmentLedger(row, { periodId: 'CEP/42' }), true);
  assert.equal(entryMatchesRollingClassEnrollmentLedger(row, { periodId: 'CEP/99' }), false);
});

test('entryMatchesRollingClassEnrollmentLedger ignores void entries', () => {
  const row = {
    entryType: 'class_enrolled',
    status: 'void',
    classId: 'CLASS/9',
    source: { idempotencyKey: 'rolling|cep|CEP/42|class_enrolled' }
  };
  assert.equal(entryMatchesRollingClassEnrollmentLedger(row, { periodId: 'CEP/42' }), false);
});
