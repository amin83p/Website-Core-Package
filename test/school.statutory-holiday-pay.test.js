'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const timesheetParametersPolicyService = require('../packages/school/MVC/services/school/timesheetParametersPolicyService');
const {
  WorkdayHistory,
  addDays,
  isPayableWorkdayEntry
} = require('../packages/school/MVC/services/school/timesheetWorkdayHistoryService');
const statutoryHolidayEligibilityService = require('../packages/school/MVC/services/school/statutoryHolidayEligibilityService');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function buildHistoryFromDates(dateHours = []) {
  const map = new Map();
  dateHours.forEach(({ date, hours }) => {
    map.set(date, Number(hours || 0));
  });
  return new WorkdayHistory(map);
}

function seedWeekdayHistory(history, weekday, beforeDate, count, hours = 8) {
  let cursor = addDays(beforeDate, -1);
  let added = 0;
  let guard = 0;
  while (added < count && guard < 400) {
    const parsed = new Date(`${cursor}T12:00:00Z`);
    if (parsed.getUTCDay() === weekday) {
      history.hoursByDate.set(cursor, hours);
      added += 1;
    }
    cursor = addDays(cursor, -1);
    guard += 1;
  }
}

test('statutory holiday policy defaults and validation are wired in settings', () => {
  const view = read('packages/school/MVC/views/school/settings/index.ejs');
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');

  assert.match(view, /statutoryHolidayPayEnabled/);
  assert.match(view, /payableHolidayType_Observance_Paid/);
  assert.match(controller, /statutoryHolidayEligibilityService/);
  assert.match(controller, /statHolidayWarnings/);

  const policy = timesheetParametersPolicyService.resolvePolicy({});
  assert.equal(policy.emptyEnrollmentSessions, 'hide');
  assert.equal(policy.statutoryHolidayPay.enabled, true);
  assert.equal(policy.statutoryHolidayPay.minWorkdays, 30);
  assert.deepEqual(policy.statutoryHolidayPay.payableHolidayTypes, ['National Holiday', 'Observance Paid']);

  const saved = timesheetParametersPolicyService.validatePolicyInput({
    emptyEnrollmentSessions: 'hide',
    statutoryHolidayPayEnabled: 'true',
    statutoryHolidayMinWorkdays: '25',
    payableHolidayType_National_Holiday: 'true',
    payableHolidayType_Observance_Paid: 'true'
  });
  assert.equal(saved.statutoryHolidayPay.minWorkdays, 25);
  assert.equal(saved.statutoryHolidayPay.enabled, true);
});

test('workday history counts workdays, weekday occurrences, and earnings ranges', () => {
  const history = buildHistoryFromDates([
    { date: '2026-01-05', hours: 8 },
    { date: '2026-01-12', hours: 8 },
    { date: '2026-01-19', hours: 8 },
    { date: '2026-01-26', hours: 8 }
  ]);

  assert.equal(history.countWorkdaysBefore('2026-02-02'), 4);
  assert.equal(history.countWeekdayOccurrences(1, '2026-02-02', 9), 4);
  assert.equal(history.totalHoursInRange('2026-01-05', '2026-01-26'), 32);
  assert.equal(history.workdayCountInRange('2026-01-05', '2026-01-26'), 4);
  assert.equal(history.lastWorkdayBefore('2026-02-02', 14), '2026-01-26');
  assert.equal(history.firstWorkdayAfter('2026-01-04', 14), '2026-01-05');
});

test('statutory holiday rows are excluded from payable workday lookback', () => {
  assert.equal(isPayableWorkdayEntry({ date: '2026-01-02', hours: 8, isStatutoryHoliday: true }), false);
  assert.equal(isPayableWorkdayEntry({ date: '2026-01-02', timesheetHours: 8 }), true);
  assert.equal(isPayableWorkdayEntry({ date: '2026-01-02', hours: 8, approvalStatus: 'unpaid' }), false);
});

test('30 workday threshold and 5-of-9 weekday rule pass and fail', () => {
  const policy = timesheetParametersPolicyService.resolvePolicy({});
  const holiday = { id: 'HOL-1', date: '2026-03-02', title: 'Family Day', type: 'National Holiday' };
  const history = buildHistoryFromDates([]);
  for (let i = 1; i <= 29; i += 1) {
    history.hoursByDate.set(addDays('2026-03-02', -i), 8);
  }

  const fail = statutoryHolidayEligibilityService.evaluateHolidayEligibility({
    holiday,
    policy,
    workdayHistory: history,
    leaveDates: new Set(),
    supplementalHoursByDate: new Map([['2026-03-02', 8]])
  });
  assert.equal(fail.checks.minWorkdays.pass, false);
  assert.equal(fail.qualified, false);

  history.hoursByDate.set(addDays('2026-03-02', -30), 8);
  seedWeekdayHistory(history, 1, '2026-03-02', 5, 8);
  const pass = statutoryHolidayEligibilityService.evaluateHolidayEligibility({
    holiday,
    policy,
    workdayHistory: history,
    leaveDates: new Set(),
    supplementalHoursByDate: new Map([['2026-03-02', 8]])
  });
  assert.equal(pass.checks.minWorkdays.pass, true);
  assert.equal(pass.checks.weekdayRule.pass, true);
  assert.equal(pass.checks.workdayMatch.pass, true);
  assert.equal(pass.qualified, true);
});

test('workday match passes when employee worked on the holiday itself', () => {
  const policy = timesheetParametersPolicyService.resolvePolicy({});
  const holiday = { id: 'HOL-2', date: '2026-07-01', title: 'Canada Day', type: 'National Holiday' };
  const history = buildHistoryFromDates([]);
  seedWeekdayHistory(history, 2, '2026-07-01', 4, 8);

  const failWeekday = statutoryHolidayEligibilityService.evaluateHolidayEligibility({
    holiday,
    policy,
    workdayHistory: history,
    leaveDates: new Set()
  });
  assert.equal(failWeekday.checks.weekdayRule.pass, false);
  assert.equal(failWeekday.checks.workdayMatch.pass, false);

  const passWorkedHoliday = statutoryHolidayEligibilityService.evaluateHolidayEligibility({
    holiday,
    policy,
    workdayHistory: history,
    leaveDates: new Set(),
    supplementalHoursByDate: new Map([['2026-07-01', 4]])
  });
  assert.equal(passWorkedHoliday.checks.workdayMatch.workedOnHoliday, true);
  assert.equal(passWorkedHoliday.checks.workdayMatch.pass, true);
});

test('leave during stat week and on adjacent workdays disqualifies pay', () => {
  const policy = timesheetParametersPolicyService.resolvePolicy({});
  const holiday = { id: 'HOL-3', date: '2026-09-07', title: 'Labour Day', type: 'National Holiday' };
  const history = buildHistoryFromDates([]);
  for (let i = 1; i <= 40; i += 1) {
    history.hoursByDate.set(addDays('2026-09-07', -i), 8);
  }
  seedWeekdayHistory(history, 1, '2026-09-07', 6, 8);

  const leaveDuringWeek = statutoryHolidayEligibilityService.evaluateHolidayEligibility({
    holiday,
    policy,
    workdayHistory: history,
    leaveDates: new Set(['2026-09-09']),
    supplementalHoursByDate: new Map([['2026-09-07', 8]])
  });
  assert.equal(leaveDuringWeek.checks.leaveDuringHolidayWeek.pass, false);
  assert.equal(leaveDuringWeek.qualified, false);

  const beforeDate = history.lastWorkdayBefore('2026-09-07', 14);
  const leaveBeforeAfter = statutoryHolidayEligibilityService.evaluateHolidayEligibility({
    holiday,
    policy,
    workdayHistory: history,
    leaveDates: new Set([beforeDate]),
    supplementalHoursByDate: new Map([['2026-09-07', 8]])
  });
  assert.equal(leaveBeforeAfter.checks.leaveBeforeAfter.pass, false);
  assert.equal(leaveBeforeAfter.qualified, false);
});

test('4-week average hours calculation and auto row generation', () => {
  const policy = timesheetParametersPolicyService.resolvePolicy({});
  const holiday = { id: 'HOL-4', date: '2026-12-25', title: 'Christmas Day', type: 'National Holiday' };
  const history = buildHistoryFromDates([]);
  for (let i = 1; i <= 40; i += 1) {
    history.hoursByDate.set(addDays('2026-12-25', -i), i % 2 === 0 ? 8 : 6);
  }
  seedWeekdayHistory(history, 5, '2026-12-25', 6, 8);

  const evaluation = statutoryHolidayEligibilityService.evaluateHolidayEligibility({
    holiday,
    policy,
    workdayHistory: history,
    leaveDates: new Set(),
    supplementalHoursByDate: new Map([['2026-12-25', 8]])
  });
  assert.equal(evaluation.checks.calculatedHours.pass, true);
  assert.ok(evaluation.calculatedHours > 0);
  assert.equal(evaluation.qualified, true);

  const row = statutoryHolidayEligibilityService.buildStatHolidayRow({
    evaluation,
    personId: 'TEACH-1'
  });
  assert.ok(row);
  assert.equal(row.isStatutoryHoliday, true);
  assert.equal(row.status, 'stat_holiday');
  assert.equal(row.sessionId, 'stathol-HOL-4-TEACH-1');
  assert.equal(row.hours, evaluation.calculatedHours);
});

test('manager override can force pay or disqualify statutory holiday rows', () => {
  const policy = timesheetParametersPolicyService.resolvePolicy({});
  const holiday = { id: 'HOL-5', date: '2026-05-18', title: 'Victoria Day', type: 'National Holiday' };
  const history = buildHistoryFromDates([{ date: '2026-05-01', hours: 8 }]);
  const evaluation = statutoryHolidayEligibilityService.evaluateHolidayEligibility({
    holiday,
    policy,
    workdayHistory: history,
    leaveDates: new Set()
  });
  assert.equal(evaluation.qualified, false);

  const forced = statutoryHolidayEligibilityService.buildStatHolidayRow({
    evaluation,
    personId: 'TEACH-2',
    existingEntry: {
      statHolidayOverride: { forcePay: true, hours: 7.5, reason: 'Override' }
    },
    allowManagerOverride: true
  });
  assert.ok(forced);
  assert.equal(forced.hours, 7.5);
  assert.equal(forced.statHolidayOverride.forcePay, true);

  const trusted = statutoryHolidayEligibilityService.buildTrustedStatHolidayEntry({
    entry: { sessionId: 'stathol-HOL-5-TEACH-2', statHolidayOverride: { forcePay: false } },
    trustedRow: forced,
    allowManagerOverride: true,
    actor: { id: 'MGR-1', name: 'Manager' }
  });
  assert.equal(trusted.isDeleted, true);
});

test('observance paid holiday type is supported in holiday management UI', () => {
  const holidaysView = read('packages/school/MVC/views/school/holiday/holidays.ejs');
  assert.match(holidaysView, /Observance Paid/);
});
