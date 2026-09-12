'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const timesheetParametersPolicyService = require('../MVC/services/school/timesheetParametersPolicyService');
const {
  roundStatutoryHolidayHours,
  applyStatutoryHolidayHoursRounding,
  isStatutoryHolidayRoundingEnabled
} = require('../MVC/services/school/statutoryHolidayHoursRoundingService');

test('roundStatutoryHolidayHours snaps to whole, half, and next whole hour bands', () => {
  assert.equal(roundStatutoryHolidayHours(3.45), 3);
  assert.equal(roundStatutoryHolidayHours(3.44), 3);
  assert.equal(roundStatutoryHolidayHours(3.49), 3);
  assert.equal(roundStatutoryHolidayHours(3.5), 3.5);
  assert.equal(roundStatutoryHolidayHours(3.51), 4);
  assert.equal(roundStatutoryHolidayHours(3.55), 4);
  assert.equal(roundStatutoryHolidayHours(3.64), 4);
  assert.equal(roundStatutoryHolidayHours(3.65), 4);
  assert.equal(roundStatutoryHolidayHours(2.65), 3);
});

test('roundStatutoryHolidayHours returns zero for non-positive values', () => {
  assert.equal(roundStatutoryHolidayHours(0), 0);
  assert.equal(roundStatutoryHolidayHours(-1), 0);
  assert.equal(roundStatutoryHolidayHours('invalid'), 0);
});

test('applyStatutoryHolidayHoursRounding passes through when disabled', () => {
  assert.equal(applyStatutoryHolidayHoursRounding(3.64, { enabled: false }), 3.64);
  assert.equal(applyStatutoryHolidayHoursRounding(3.645, { enabled: false }), 3.65);
});

test('applyStatutoryHolidayHoursRounding rounds when enabled', () => {
  assert.equal(applyStatutoryHolidayHoursRounding(3.49, { enabled: true }), 3);
  assert.equal(applyStatutoryHolidayHoursRounding(3.5, { enabled: true }), 3.5);
  assert.equal(applyStatutoryHolidayHoursRounding(3.64, { enabled: true }), 4);
  assert.equal(applyStatutoryHolidayHoursRounding(3.67, { enabled: true }), 4);
});

test('isStatutoryHolidayRoundingEnabled reads policy flag', () => {
  assert.equal(isStatutoryHolidayRoundingEnabled({}), false);
  assert.equal(isStatutoryHolidayRoundingEnabled({
    statutoryHolidayPay: { roundCalculatedHours: true }
  }), true);
});

test('normalizePolicyFromForm round-trips statutoryHolidayRoundCalculatedHours', () => {
  const enabled = timesheetParametersPolicyService.normalizePolicyFromForm({
    emptyEnrollmentSessions: 'hide',
    statutoryHolidayRoundCalculatedHours: 'true'
  });
  assert.equal(enabled.statutoryHolidayPay.roundCalculatedHours, true);

  const disabled = timesheetParametersPolicyService.normalizePolicyFromForm({
    emptyEnrollmentSessions: 'hide',
    statutoryHolidayRoundCalculatedHours: 'false'
  });
  assert.equal(disabled.statutoryHolidayPay.roundCalculatedHours, false);
});
