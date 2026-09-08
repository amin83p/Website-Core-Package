'use strict';

const assert = require('assert');
const statutoryHolidayEligibilityService = require('../MVC/services/school/statutoryHolidayEligibilityService');

function buildEvaluation(calculatedHours) {
  return {
    holidayId: 'HOL-1',
    date: '2026-01-01',
    title: "New Year's Day",
    qualified: true,
    calculatedHours,
    checks: {},
    disqualifyReasons: []
  };
}

assert.strictEqual(
  statutoryHolidayEligibilityService.buildStatHolidayRow({
    evaluation: buildEvaluation(30),
    personId: 'PERSON-1'
  }),
  null,
  'stat holiday row with 30 calculated hours should be skipped'
);

const validRow = statutoryHolidayEligibilityService.buildStatHolidayRow({
  evaluation: buildEvaluation(6),
  personId: 'PERSON-1'
});
assert.ok(validRow);
assert.strictEqual(validRow.hours, 6);
assert.strictEqual(validRow.date, '2026-01-01');

console.log('statutory-holiday-pay-hours-limit.test.js passed');
