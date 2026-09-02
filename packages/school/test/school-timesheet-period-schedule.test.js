const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const scheduleService = require('../MVC/services/school/timesheetPeriodScheduleService');
const eligibilityService = require('../MVC/services/school/timesheetPeriodEligibilityService');
const generationService = require('../MVC/services/school/timesheetPeriodGenerationService');
const schoolDataService = require('../MVC/services/school/schoolDataService');

test('resolveSubmissionDeadline uses two-day offset for weekend and Monday period ends', () => {
  assert.equal(scheduleService.resolveSubmissionDeadline('2026-02-15'), '2026-02-13');
  assert.equal(scheduleService.resolveSubmissionDeadline('2026-06-15'), '2026-06-12');
});

test('resolveSubmissionDeadline uses one-day offset for weekday period ends', () => {
  assert.equal(scheduleService.resolveSubmissionDeadline('2026-04-15'), '2026-04-14');
  assert.equal(scheduleService.resolveSubmissionDeadline('2026-03-31'), '2026-03-30');
});

test('resolveSubmissionDeadline walks weekend deadlines back to Friday', () => {
  assert.equal(scheduleService.resolveSubmissionDeadline('2026-01-31'), '2026-01-29');
});

test('buildBiMonthlyPeriods creates 24 periods for 2026 with correct month boundaries', () => {
  const periods = scheduleService.buildBiMonthlyPeriods({ orgId: '900000', year: 2026 });
  assert.equal(periods.length, 24);
  assert.equal(periods[0].name, '2026-JAN-01');
  assert.equal(periods[0].startDate, '2026-01-01');
  assert.equal(periods[0].endDate, '2026-01-15');
  assert.equal(periods[1].name, '2026-JAN-16');
  assert.equal(periods[1].startDate, '2026-01-16');
  assert.equal(periods[1].endDate, '2026-01-31');
  const febSecondHalf = periods.find((row) => row.id === 'TSP_2026_FEB_16');
  assert.equal(febSecondHalf.endDate, '2026-02-28');
  assert.equal(febSecondHalf.submissionDeadline, '2026-02-26');
});

test('buildMonthlyPeriods creates 12 full-month periods for 2026', () => {
  const periods = scheduleService.buildMonthlyPeriods({ orgId: '900000', year: 2026 });
  assert.equal(periods.length, 12);
  assert.equal(periods[0].id, 'TSP_2026_JAN');
  assert.equal(periods[0].startDate, '2026-01-01');
  assert.equal(periods[0].endDate, '2026-01-31');
  assert.equal(periods[11].id, 'TSP_2026_DEC');
  assert.equal(periods[11].startDate, '2026-12-01');
  assert.equal(periods[11].endDate, '2026-12-31');
});

test('buildBiWeeklyPeriods creates rolling 14-day blocks clipped to year end', () => {
  const periods = scheduleService.buildBiWeeklyPeriods({ orgId: '900000', year: 2026 });
  assert.equal(periods.length, 27);
  assert.equal(periods[0].startDate, '2026-01-01');
  assert.equal(periods[0].endDate, '2026-01-14');
  assert.equal(periods.at(-1).endDate, '2026-12-31');
});

test('buildWeeklyPeriods creates rolling 7-day blocks clipped to year end', () => {
  const periods = scheduleService.buildWeeklyPeriods({ orgId: '900000', year: 2026 });
  assert.equal(periods.length, 53);
  assert.equal(periods[0].startDate, '2026-01-01');
  assert.equal(periods[0].endDate, '2026-01-07');
  assert.equal(periods.at(-1).endDate, '2026-12-31');
});

test('buildPeriodsForYear dispatches cadence aliases', () => {
  const monthly = scheduleService.buildPeriodsForYear({ orgId: '900000', year: 2026, cadence: 'monthly' });
  const semiMonthly = scheduleService.buildPeriodsForYear({ orgId: '900000', year: 2026, cadence: 'semi-monthly' });
  const biWeekly = scheduleService.buildPeriodsForYear({ orgId: '900000', year: 2026, cadence: 'bi-weekly' });
  const weekly = scheduleService.buildPeriodsForYear({ orgId: '900000', year: 2026, cadence: 'weekly' });
  assert.equal(monthly.length, 12);
  assert.equal(semiMonthly.length, 24);
  assert.equal(biWeekly.length, 27);
  assert.equal(weekly.length, 53);
});

test('generateYearPeriods skips duplicate date ranges and creates only missing rows', async () => {
  const existing = [
    {
      id: 'TSP_EXISTING',
      orgId: '900000',
      startDate: '2026-01-01',
      endDate: '2026-01-15'
    }
  ];
  const createdRows = [];

  const originalFetch = schoolDataService.fetchData;
  const originalAdd = schoolDataService.addData;

  schoolDataService.fetchData = async (entityType, query) => {
    assert.equal(entityType, 'timesheetPeriods');
    assert.equal(query.orgId__eq, '900000');
    return existing.slice();
  };

  schoolDataService.addData = async (entityType, payload) => {
    assert.equal(entityType, 'timesheetPeriods');
    createdRows.push(payload);
    const saved = { ...payload, id: payload.id || `saved_${createdRows.length}` };
    existing.push(saved);
    return saved;
  };

  try {
    const summary = await generationService.generateYearPeriods({
      orgId: '900000',
      year: 2026,
      cadence: scheduleService.PERIOD_CADENCES.SEMI_MONTHLY,
      reqUser: { activeOrgId: '900000' }
    });

    assert.equal(summary.createdCount, 23);
    assert.equal(summary.skippedCount, 1);
    assert.equal(createdRows.length, 23);
    assert.equal(createdRows.some((row) => row.startDate === '2026-01-01' && row.endDate === '2026-01-15'), false);
    assert.equal(createdRows.some((row) => row.startDate === '2026-01-16' && row.endDate === '2026-01-31'), true);
  } finally {
    schoolDataService.fetchData = originalFetch;
    schoolDataService.addData = originalAdd;
  }
});

test('timesheet period routes expose generate-year API with inline mutation action-state fallback', () => {
  const routesSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/routes/timesheetPeriodRoutes.js'),
    'utf8'
  );
  assert.match(routesSource, /router\.post\('\/api\/generate-year'/);
  assert.match(routesSource, /ctrl\.generateYearPeriods/);
  assert.match(routesSource, /allowOperationTokenFallback:\s*true/);
  assert.match(routesSource, /allowInactiveTokenFallback:\s*true/);
});

test('timesheet period controller passes year filter data and uses generation service', () => {
  const controllerSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/controllers/school/timesheetPeriodController.js'),
    'utf8'
  );
  assert.match(controllerSource, /selectedYear/);
  assert.match(controllerSource, /availableYears/);
  assert.match(controllerSource, /timesheetPeriodGenerationService/);
  assert.match(controllerSource, /generateYearPeriods/);
});

test('timesheet period list view includes year filter and generate modal', () => {
  const viewSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/views/school/timesheetPeriod/timesheetPeriodList.ejs'),
    'utf8'
  );
  assert.match(viewSource, /topYearFilter/);
  assert.match(viewSource, /generateYearModal/);
  assert.match(viewSource, /api\/generate-year/);
});

test('resolvePeriodEligibility marks periods before start date as upcoming', () => {
  const period = {
    startDate: '2026-12-01',
    endDate: '2026-12-15',
    submissionDeadline: '2026-12-14',
    submissionDeadlineTime: '23:59'
  };
  const eligibility = eligibilityService.resolvePeriodEligibility(period, {
    today: '2026-11-30',
    orgTimeZone: 'America/Toronto'
  });
  assert.equal(eligibility.phase, 'upcoming');
  assert.equal(eligibility.canOpen, false);
  assert.equal(eligibility.canSubmit, false);
});

test('resolvePeriodEligibility allows active periods inside the submission window', () => {
  const period = {
    startDate: '2026-04-01',
    endDate: '2026-04-15',
    submissionDeadline: '2026-04-14',
    submissionDeadlineTime: '23:59'
  };
  const eligibility = eligibilityService.resolvePeriodEligibility(period, {
    today: '2026-04-10',
    orgTimeZone: 'America/Toronto',
    now: new Date('2026-04-10T15:00:00.000Z')
  });
  assert.equal(eligibility.phase, 'active');
  assert.equal(eligibility.canOpen, true);
  assert.equal(eligibility.canSubmit, true);
});

test('resolvePeriodEligibility blocks submit after deadline unless late submission is allowed', () => {
  const period = {
    startDate: '2026-04-01',
    endDate: '2026-04-15',
    submissionDeadline: '2026-04-14',
    submissionDeadlineTime: '23:59'
  };
  const blocked = eligibilityService.resolvePeriodEligibility(period, {
    today: '2026-04-15',
    orgTimeZone: 'America/Toronto',
    now: new Date('2026-04-15T12:00:00.000Z')
  });
  assert.equal(blocked.phase, 'deadline_passed');
  assert.equal(blocked.canOpen, true);
  assert.equal(blocked.canSubmit, false);

  const allowed = eligibilityService.resolvePeriodEligibility(period, {
    today: '2026-04-15',
    orgTimeZone: 'America/Toronto',
    now: new Date('2026-04-15T12:00:00.000Z'),
    allowLateSubmission: true
  });
  assert.equal(allowed.phase, 'active');
  assert.equal(allowed.canSubmit, true);
});

test('management viewers can preview upcoming periods for another teacher', () => {
  const period = {
    startDate: '2026-12-01',
    endDate: '2026-12-15',
    submissionDeadline: '2026-12-14',
    submissionDeadlineTime: '23:59'
  };
  const eligibility = eligibilityService.resolvePeriodEligibility(period, {
    today: '2026-11-20',
    isManagementViewer: true,
    viewingOtherTeacher: true
  });
  assert.equal(eligibility.phase, 'upcoming');
  assert.equal(eligibility.canOpen, true);
  assert.equal(eligibility.canSubmit, false);
});

test('timesheet controller enforces period eligibility in list, view, and save flows', () => {
  const controllerSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/controllers/school/timesheetController.js'),
    'utf8'
  );
  assert.match(controllerSource, /timesheetPeriodEligibilityService/);
  assert.match(controllerSource, /attachEligibilityToPeriodRow/);
  assert.match(controllerSource, /assertPeriodEligibility\(periodEligibility, 'open'\)/);
  assert.match(controllerSource, /assertPeriodEligibility\(periodEligibility, 'submit'\)/);
});

test('seeded 2026 timesheet periods file contains 24 org rows', () => {
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/school/timesheetPeriods.json'), 'utf8'));
  const orgRows = rows.filter((row) => String(row.orgId) === '900000' && String(row.startDate || '').startsWith('2026-'));
  assert.equal(orgRows.length, 24);
  const febFirstHalf = orgRows.find((row) => row.id === 'TSP_2026_FEB_01');
  assert.equal(febFirstHalf.submissionDeadline, '2026-02-13');
});
