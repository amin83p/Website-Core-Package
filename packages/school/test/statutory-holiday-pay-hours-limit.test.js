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
    checks: { calculatedHours: { pass: true, averageHours: calculatedHours } },
    disqualifyReasons: []
  };
}

const blockedRow = statutoryHolidayEligibilityService.buildStatHolidayRow({
  evaluation: buildEvaluation(30),
  personId: 'PERSON-1'
});
assert.ok(blockedRow, 'stat holiday row with 30 calculated hours should still be returned');
assert.strictEqual(blockedRow.hours, 0);
assert.strictEqual(blockedRow.status, 'stat_holiday_not_qualified');
assert.strictEqual(blockedRow.statHolidayMeta.payBlockedReason, 'exceeds_max_payable_hours');

const validRow = statutoryHolidayEligibilityService.buildStatHolidayRow({
  evaluation: buildEvaluation(6),
  personId: 'PERSON-1'
});
assert.ok(validRow);
assert.strictEqual(validRow.hours, 6);
assert.strictEqual(validRow.date, '2026-01-01');
assert.strictEqual(validRow.status, 'stat_holiday');

const disqualifiedRow = statutoryHolidayEligibilityService.buildStatHolidayRow({
  evaluation: {
    holidayId: 'HOL-2',
    date: '2026-04-06',
    title: 'Stat Holiday',
    qualified: false,
    calculatedHours: 0,
    checks: { minWorkdays: { pass: false, actual: 0, required: 30 } },
    disqualifyReasons: ['Needs 30 workdays (has 0).']
  },
  personId: 'PERSON-1'
});
assert.ok(disqualifiedRow);
assert.strictEqual(disqualifiedRow.hours, 0);
assert.strictEqual(disqualifiedRow.status, 'stat_holiday_not_qualified');
assert.strictEqual(disqualifiedRow.statHolidayMeta.payBlockedReason, 'not_qualified');

console.log('statutory-holiday-pay-hours-limit.test.js passed');
