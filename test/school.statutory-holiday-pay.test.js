'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const timesheetParametersPolicyService = require('../packages/school/MVC/services/school/timesheetParametersPolicyService');
const {
  WorkdayHistory,
  addDays,
  isPayableWorkdayEntry,
  buildWorkdayHistory
} = require('../packages/school/MVC/services/school/timesheetWorkdayHistoryService');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const statutoryHolidayEligibilityService = require('../packages/school/MVC/services/school/statutoryHolidayEligibilityService');
const holidayModel = require('../packages/school/MVC/models/school/holidayModel');

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

function seedAfterHolidayBoundary(history, holidayDate, days = 7, hours = 8) {
  for (let i = 1; i <= days; i += 1) {
    history.hoursByDate.set(addDays(holidayDate, i), hours);
  }
}

test('statutory holiday policy defaults and validation are wired in settings', () => {
  const view = read('packages/school/MVC/views/school/settings/index.ejs');
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');

  assert.match(view, /statutoryHolidayPayEnabled/);
  assert.match(view, /counted across all saved timesheet history/);
  assert.match(view, /payableHolidayType_Observance_Paid/);
  assert.doesNotMatch(view, /Use synthetic timesheet rows \(legacy\)/);
  assert.match(view, /Select public activity/);
  assert.match(controller, /statutoryHolidayEligibilityService/);
  assert.match(controller, /statutoryHolidayTimesheetLifecycleService/);
  assert.match(controller, /statHolidayWarnings/);
  assert.match(controller, /previewStatHolidayForTimesheet/);
  assert.match(controller, /applyStatHolidayOnTimesheetSubmit/);
  assert.match(controller, /clearStatHolidayForReturnedTimesheet/);

  const policy = timesheetParametersPolicyService.resolvePolicy({});
  assert.equal(policy.emptyEnrollmentSessions, 'hide');
  assert.equal(policy.statutoryHolidayPay.enabled, true);
  assert.equal(policy.statutoryHolidayPay.minWorkdays, 30);
  assert.equal(policy.statutoryHolidayPay.disqualifyOnLeaveDuringHolidayWeek, false);
  assert.deepEqual(policy.statutoryHolidayPay.payableHolidayTypes, ['National Holiday', 'Observance Paid']);

  const saved = timesheetParametersPolicyService.validatePolicyInput({
    emptyEnrollmentSessions: 'hide',
    statutoryHolidayPayEnabled: 'true',
    statutoryHolidayActivityId: 'ACT_STAT',
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
  seedAfterHolidayBoundary(history, '2026-03-02');
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

test('holiday attendance passes without payable hours when no leave on holiday date', () => {
  const policy = timesheetParametersPolicyService.resolvePolicy({});
  const holiday = { id: 'HOL-ATT', date: '2026-02-16', title: 'Family Day', type: 'National Holiday' };
  const history = buildHistoryFromDates([]);
  for (let i = 1; i <= 40; i += 1) {
    history.hoursByDate.set(addDays('2026-02-16', -i), 8);
  }
  seedWeekdayHistory(history, 1, '2026-02-16', 6, 8);
  seedAfterHolidayBoundary(history, '2026-02-16');

  const evaluation = statutoryHolidayEligibilityService.evaluateHolidayEligibility({
    holiday,
    policy,
    workdayHistory: history,
    leaveDates: new Set()
  });

  assert.equal(evaluation.checks.holidayAttendance.pass, true);
  assert.equal(evaluation.checks.workdayMatch.regularWorkday, true);
  assert.equal(evaluation.checks.workdayMatch.workedOnHoliday, false);
  assert.equal(evaluation.qualified, true);
});

test('mid-week leave does not disqualify when holiday-week rule is off by default', () => {
  const policy = timesheetParametersPolicyService.resolvePolicy({});
  const holiday = { id: 'HOL-3', date: '2026-09-07', title: 'Labour Day', type: 'National Holiday' };
  const history = buildHistoryFromDates([]);
  for (let i = 1; i <= 40; i += 1) {
    history.hoursByDate.set(addDays('2026-09-07', -i), 8);
  }
  seedWeekdayHistory(history, 1, '2026-09-07', 6, 8);
  seedAfterHolidayBoundary(history, '2026-09-07');

  const leaveDuringWeek = statutoryHolidayEligibilityService.evaluateHolidayEligibility({
    holiday,
    policy,
    workdayHistory: history,
    leaveDates: new Set(['2026-09-09'])
  });
  assert.equal(leaveDuringWeek.checks.leaveDuringHolidayWeek, undefined);
  assert.equal(leaveDuringWeek.qualified, true);

  const strictPolicy = timesheetParametersPolicyService.resolvePolicy({
    statutoryHolidayPay: {
      disqualifyOnLeaveDuringHolidayWeek: true
    }
  });
  const strictLeaveDuringWeek = statutoryHolidayEligibilityService.evaluateHolidayEligibility({
    holiday,
    policy: strictPolicy,
    workdayHistory: history,
    leaveDates: new Set(['2026-09-09'])
  });
  assert.equal(strictLeaveDuringWeek.checks.leaveDuringHolidayWeek.pass, false);
  assert.equal(strictLeaveDuringWeek.qualified, false);

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
  seedAfterHolidayBoundary(history, '2026-12-25');

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

  const disqualifiedRow = statutoryHolidayEligibilityService.buildStatHolidayRow({
    evaluation,
    personId: 'TEACH-2'
  });
  assert.ok(disqualifiedRow);
  assert.equal(disqualifiedRow.hours, 0);
  assert.equal(disqualifiedRow.status, 'stat_holiday_not_qualified');

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
  assert.notEqual(trusted.isDeleted, true);
  assert.equal(trusted.hours, 0);
  assert.equal(trusted.status, 'stat_holiday_not_qualified');
});

test('holiday model persists statutoryHolidayPayable when provided', () => {
  const withPayable = holidayModel.sanitizeHolidayInput({
    orgId: 'ORG-1',
    date: '2026-04-06',
    title: 'Stat Holiday',
    type: 'School Break',
    notes: '',
    statutoryHolidayPayable: true
  });
  assert.equal(withPayable.statutoryHolidayPayable, true);

  const withoutPayable = holidayModel.sanitizeHolidayInput({
    orgId: 'ORG-1',
    date: '2026-04-06',
    title: 'Stat Holiday',
    type: 'School Break',
    notes: ''
  });
  assert.equal(withoutPayable.statutoryHolidayPayable, undefined);
});

test('per-holiday statutoryHolidayPayable flag overrides type-based payability', () => {
  const payableTypes = ['National Holiday', 'Observance Paid'];

  assert.equal(
    statutoryHolidayEligibilityService.isPayableHoliday(
      { type: 'School Break', statutoryHolidayPayable: true },
      payableTypes
    ),
    true
  );
  assert.equal(
    statutoryHolidayEligibilityService.isPayableHoliday(
      { type: 'National Holiday', statutoryHolidayPayable: false },
      payableTypes
    ),
    false
  );
  assert.equal(
    statutoryHolidayEligibilityService.isPayableHoliday(
      { type: 'National Holiday' },
      payableTypes
    ),
    true
  );
  assert.equal(
    statutoryHolidayEligibilityService.isPayableHoliday(
      { type: 'School Break' },
      payableTypes
    ),
    false
  );
});

test('Step 5 resolves after-boundary workday when post-holiday payable days are in workday history', () => {
  const policy = timesheetParametersPolicyService.resolvePolicy({});
  const holiday = { id: 'HOL-VIC', date: '2026-05-18', title: 'Victoria Day', type: 'National Holiday' };
  const history = buildHistoryFromDates([]);
  for (let i = 1; i <= 40; i += 1) {
    history.hoursByDate.set(addDays('2026-05-18', -i), 8);
  }
  history.hoursByDate.set('2026-05-19', 8);
  seedWeekdayHistory(history, 1, '2026-05-18', 6, 8);

  const evaluation = statutoryHolidayEligibilityService.evaluateHolidayEligibility({
    holiday,
    policy,
    workdayHistory: history,
    leaveDates: new Set()
  });
  assert.ok(evaluation.checks.leaveBeforeAfter.beforeDate);
  assert.equal(evaluation.checks.leaveBeforeAfter.afterDate, '2026-05-19');
  assert.equal(evaluation.checks.leaveBeforeAfter.boundariesResolved, true);
  assert.equal(evaluation.checks.leaveBeforeAfter.pass, true);
});

test('Step 5 fails when after-boundary workday cannot be resolved and rule is enabled', () => {
  const policy = timesheetParametersPolicyService.resolvePolicy({});
  const holiday = { id: 'HOL-VIC-2', date: '2026-05-18', title: 'Victoria Day', type: 'National Holiday' };
  const history = buildHistoryFromDates([]);
  for (let i = 1; i <= 40; i += 1) {
    history.hoursByDate.set(addDays('2026-05-18', -i), 8);
  }
  seedWeekdayHistory(history, 1, '2026-05-18', 6, 8);

  const evaluation = statutoryHolidayEligibilityService.evaluateHolidayEligibility({
    holiday,
    policy,
    workdayHistory: history,
    leaveDates: new Set()
  });
  assert.equal(evaluation.checks.leaveBeforeAfter.afterDate, '');
  assert.equal(evaluation.checks.leaveBeforeAfter.missingAfterBoundary, true);
  assert.equal(evaluation.checks.leaveBeforeAfter.boundariesResolved, false);
  assert.equal(evaluation.checks.leaveBeforeAfter.pass, false);
});

test('buildWorkdayHistory useFullHistory counts payable workdays before the old lookback window', async () => {
  const originalFetch = schoolDataService.fetchData;

  schoolDataService.fetchData = async () => [{
    orgId: 'ORG_1',
    teacherId: 'PERSON_1',
    status: 'processed',
    entries: [
      { date: '2025-11-05', timesheetHours: 8 },
      { date: '2026-01-10', timesheetHours: 8 }
    ]
  }];

  try {
    const windowed = await buildWorkdayHistory({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      endDate: '2026-03-21',
      lookbackDays: 90,
      useFullHistory: false,
      reqUser: {}
    });
    const full = await buildWorkdayHistory({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      endDate: '2026-03-21',
      lookbackDays: 90,
      useFullHistory: true,
      reqUser: {}
    });

    const holidayDate = '2026-02-16';
    assert.equal(windowed.countWorkdaysBefore(holidayDate), 1);
    assert.equal(full.countWorkdaysBefore(holidayDate), 2);
  } finally {
    schoolDataService.fetchData = originalFetch;
  }
});

test('Step 1 minWorkdays counts payable workdays more than 90 days before the holiday', () => {
  const policy = timesheetParametersPolicyService.resolvePolicy({});
  const holiday = { id: 'HOL-HIST', date: '2026-02-16', title: 'Family Day', type: 'National Holiday' };
  const history = buildHistoryFromDates([]);
  for (let i = 1; i <= 25; i += 1) {
    history.hoursByDate.set(addDays('2026-02-16', -i), 8);
  }
  for (let i = 91; i <= 100; i += 1) {
    history.hoursByDate.set(addDays('2026-02-16', -i), 8);
  }

  const evaluation = statutoryHolidayEligibilityService.evaluateHolidayEligibility({
    holiday,
    policy,
    workdayHistory: history,
    leaveDates: new Set()
  });

  assert.equal(evaluation.checks.minWorkdays.actual, 35);
  assert.equal(evaluation.checks.minWorkdays.pass, true);
});

test('assemblePeriodWorkdayEntries excludes stat-holiday-stamped activity supplemental rows', () => {
  const liveSessions = [
    { sessionId: 'act-STAT-ENT-1-PERSON_1', date: '2026-02-16', hours: 6, statHolidayId: 'H1', statHolidayPersonId: 'PERSON_1' },
    { sessionId: 'act-WORK-ENT-2-PERSON_1', date: '2026-02-10', hours: 8 }
  ];
  const assembled = statutoryHolidayEligibilityService.assemblePeriodWorkdayEntries([], liveSessions);
  assert.equal(assembled.length, 1);
  assert.equal(assembled[0].sessionId, 'act-WORK-ENT-2-PERSON_1');
});

test('excluding stat-holiday activity supplemental rows prevents worked-on-holiday contamination', () => {
  const policy = timesheetParametersPolicyService.resolvePolicy({});
  const holiday = { id: 'HOL-FAMILY', date: '2026-02-16', title: 'Family Day', type: 'National Holiday' };
  const history = buildHistoryFromDates([]);
  for (let i = 1; i <= 28; i += 1) {
    history.hoursByDate.set(addDays('2026-02-16', -i), 8);
  }
  const staleActivityRow = {
    sessionId: 'act-STAT-ENT-1-PERSON_1',
    date: '2026-02-16',
    hours: 6,
    statHolidayId: 'HOL-FAMILY',
    statHolidayPersonId: 'PERSON_1'
  };
  const assembled = statutoryHolidayEligibilityService.assemblePeriodWorkdayEntries([], [staleActivityRow]);
  assert.equal(assembled.length, 0);

  const excludedSupplemental = new Map();
  const evaluation = statutoryHolidayEligibilityService.evaluateHolidayEligibility({
    holiday,
    policy,
    workdayHistory: history,
    leaveDates: new Set(),
    supplementalHoursByDate: excludedSupplemental
  });
  assert.equal(evaluation.checks.workdayMatch.workedOnHoliday, false);
});

test('assemblePeriodWorkdayEntries includes manual rows and live sessions minus deleted auto', () => {
  const liveSessions = [
    { sessionId: 'SES-1', date: '2026-05-15', hours: 8 },
    { sessionId: 'SES-2', date: '2026-05-19', hours: 8 }
  ];
  const existingEntries = [
    { sessionId: 'SES-0', date: '2026-05-14', hours: 4, isManual: true },
    { sessionId: 'SES-1', isDeleted: true }
  ];
  const assembled = statutoryHolidayEligibilityService.assemblePeriodWorkdayEntries(existingEntries, liveSessions);
  assert.equal(assembled.length, 2);
  assert.ok(assembled.some((row) => row.sessionId === 'SES-0'));
  assert.ok(assembled.some((row) => row.sessionId === 'SES-2'));
  assert.ok(!assembled.some((row) => row.sessionId === 'SES-1'));
});

test('print summaries distinguish manager override from stale activity hours and keep zero calculated hours', () => {
  const timesheetPrintService = require('../packages/school/MVC/services/school/timesheetPrintService');
  const [overrideSummary] = timesheetPrintService.buildStatutoryHolidayPrintSummaries([{
    sessionId: 'stathol-H1-PERSON_1',
    date: '2026-02-16',
    className: 'Family Day',
    payableHours: 6,
    statHolidayOverride: { forcePay: true, hours: 6 },
    statHolidayMeta: { qualified: false, calculatedHours: 0 }
  }]);
  const [staleSummary] = timesheetPrintService.buildStatutoryHolidayPrintSummaries([{
    sessionId: 'stathol-H1-PERSON_1',
    date: '2026-02-16',
    className: 'Family Day',
    payableHours: 6,
    statHolidayMeta: {
      qualified: false,
      calculatedHours: 0,
      checks: {
        calculatedHours: { pass: false, averageHours: 0, totalHours: 0, workdayCount: 0 }
      }
    }
  }]);
  assert.equal(overrideSummary.payStatusLabel, 'Manager override');
  assert.equal(staleSummary.payStatusLabel, 'Activity hours without auto-qualification');
  assert.equal(staleSummary.calculatedHours, 0);
});

test('observance paid holiday type is supported in holiday management UI', () => {
  const holidaysView = read('packages/school/MVC/views/school/holiday/holidays.ejs');
  assert.match(holidaysView, /Observance Paid/);
  assert.match(holidaysView, /hol_statutory_payable/);
  assert.match(holidaysView, /statutoryHolidayPayable/);
});
