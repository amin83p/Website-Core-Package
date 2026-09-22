'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const timesheetParametersPolicyService = require('../MVC/services/school/timesheetParametersPolicyService');
const statutoryHolidayCalculationService = require('../MVC/services/school/statutoryHolidayCalculationService');
const statutoryHolidayEligibilityService = require('../MVC/services/school/statutoryHolidayEligibilityService');
const statutoryHolidaySchemeService = require('../MVC/services/school/statutoryHolidaySchemeService');
const { WorkdayHistory } = require('../MVC/services/school/timesheetWorkdayHistoryService');
const { buildLeaveBeforeAfterCheck } = statutoryHolidayEligibilityService;

function buildPolicy(overrides = {}) {
  return timesheetParametersPolicyService.resolvePolicy({
    statutoryHolidayPay: {
      enabled: true,
      minWorkdays: 1,
      weekdayOccurrencesRequired: 1,
      weekdayOccurrencesLookback: 9,
      earningsLookbackWeeks: 4,
      beforeAfterSearchDays: 14,
      disqualifyOnLeaveDuringHolidayWeek: false,
      disqualifyOnLeaveBeforeAfter: false,
      defaultSchemeId: 'equilibrium_school',
      departmentSchemeAssignments: {
        DEPT_LINC: 'linc',
        DEPT_EQ: 'equilibrium_school'
      },
      schemes: {
        equilibrium_school: { id: 'equilibrium_school', activityId: 'ACT_EQ' },
        linc: { id: 'linc', activityId: 'ACT_LINC', hourMode: 'most_recent' }
      },
      ...overrides
    }
  });
}

test('evaluateLincTrack rounds calculated hours when policy rounding is enabled', () => {
  const policy = buildPolicy({ roundCalculatedHours: true });
  const evaluation = statutoryHolidayCalculationService.evaluateLincTrack({
    holiday: { id: 'H1', date: '2026-01-01', title: 'New Year', type: 'National Holiday' },
    policy,
    workdayEntries: [
      { date: '2025-12-25', deliveryDepartmentId: 'DEPT_LINC', hours: 3.64, timesheetHours: 3.64 },
      { date: '2026-01-02', deliveryDepartmentId: 'DEPT_LINC', hours: 2, timesheetHours: 2 }
    ]
  });
  assert.equal(evaluation.calculatedHours, 4);
  assert.equal(evaluation.checks.calculatedHours.averageHours, 4);
});

test('evaluateEquilibriumTrack rounds calculated hours when policy rounding is enabled', () => {
  const policy = buildPolicy({ roundCalculatedHours: true });
  const evaluation = statutoryHolidayCalculationService.evaluateEquilibriumTrack({
    holiday: { id: 'H1', date: '2026-02-02', title: 'Holiday', type: 'National Holiday' },
    policy,
    workdayEntries: [
      { date: '2026-01-26', deliveryDepartmentId: 'DEPT_EQ', hours: 7.55, timesheetHours: 7.55 }
    ],
    leaveDates: new Set(),
    supplementalHoursByDate: new Map()
  });
  assert.equal(evaluation.calculatedHours, 8);
});

test('evaluateLincTrack qualifies independently of equilibrium eligibility gates', () => {
  const policy = buildPolicy();
  const evaluation = statutoryHolidayCalculationService.evaluateLincTrack({
    holiday: { id: 'H1', date: '2026-01-01', title: 'New Year', type: 'National Holiday' },
    policy,
    workdayEntries: [
      { date: '2025-12-25', deliveryDepartmentId: 'DEPT_LINC', hours: 4, timesheetHours: 4 },
      { date: '2026-01-02', deliveryDepartmentId: 'DEPT_LINC', hours: 2, timesheetHours: 2 }
    ]
  });
  assert.equal(evaluation.qualified, true);
  assert.equal(evaluation.calculatedHours, 4);
  assert.equal(evaluation.checks.trackType, 'linc');
});

test('buildLeaveBeforeAfterCheck skips after boundary in next month when policy enabled', () => {
  const workdayHistory = new WorkdayHistory(new Map([
    ['2026-01-30', 8],
    ['2026-02-03', 8]
  ]));
  const holidayDate = '2026-01-31';
  const leaveDates = new Set(['2026-02-03']);

  const strict = buildLeaveBeforeAfterCheck({
    date: holidayDate,
    workdayHistory,
    leaveDates,
    enforce: true,
    skipAfterBoundaryInNextMonth: false
  });
  assert.equal(strict.pass, false);
  assert.equal(strict.afterDate, '2026-02-03');
  assert.equal(strict.afterBoundarySkippedNextMonth, false);

  const lenient = buildLeaveBeforeAfterCheck({
    date: holidayDate,
    workdayHistory,
    leaveDates,
    enforce: true,
    skipAfterBoundaryInNextMonth: true
  });
  assert.equal(lenient.pass, true);
  assert.equal(lenient.afterBoundarySkippedNextMonth, true);
  assert.equal(lenient.afterDateIgnored, '2026-02-03');
  assert.equal(lenient.afterDate, '');
  assert.deepEqual(lenient.leaveDates, []);
  assert.equal(lenient.missingAfterBoundary, false);
});

test('buildLeaveBeforeAfterCheck waives missing after boundary when skip setting is on', () => {
  const workdayHistory = new WorkdayHistory(new Map([
    ['2026-09-29', 8]
  ]));
  const result = buildLeaveBeforeAfterCheck({
    date: '2026-09-30',
    workdayHistory,
    leaveDates: new Set(),
    enforce: true,
    skipAfterBoundaryInNextMonth: true
  });
  assert.equal(result.afterBoundaryWaivedNoWorkday, true);
  assert.equal(result.missingAfterBoundary, false);
  assert.equal(result.pass, true);
});

test('buildLeaveBeforeAfterCheck does not skip after boundary in same month', () => {
  const workdayHistory = new WorkdayHistory(new Map([
    ['2026-01-14', 8],
    ['2026-01-16', 8]
  ]));
  const leaveDates = new Set(['2026-01-16']);
  const result = buildLeaveBeforeAfterCheck({
    date: '2026-01-15',
    workdayHistory,
    leaveDates,
    enforce: true,
    skipAfterBoundaryInNextMonth: true
  });
  assert.equal(result.afterBoundarySkippedNextMonth, false);
  assert.equal(result.afterDate, '2026-01-16');
  assert.equal(result.pass, false);
});

test('evaluateLincTrack disqualifies on boundary leave when LINC guard is active', () => {
  const policy = buildPolicy({
    schemes: {
      equilibrium_school: { id: 'equilibrium_school', activityId: 'ACT_EQ' },
      linc: {
        id: 'linc',
        activityId: 'ACT_LINC',
        hourMode: 'most_recent',
        disqualifyOnLeaveBeforeAfter: true
      }
    }
  });
  const workdayEntries = [
    { date: '2025-12-25', deliveryDepartmentId: 'DEPT_LINC', hours: 4, timesheetHours: 4 },
    { date: '2026-01-02', deliveryDepartmentId: 'DEPT_LINC', hours: 2, timesheetHours: 2 }
  ];
  const holiday = { id: 'H1', date: '2026-01-01', title: 'New Year', type: 'National Holiday' };

  const disqualified = statutoryHolidayCalculationService.evaluateLincTrack({
    holiday,
    policy,
    workdayEntries,
    leaveDates: new Set(['2025-12-25'])
  });
  assert.equal(disqualified.calculatedHours, 4);
  assert.equal(disqualified.qualified, false);
  assert.equal(disqualified.checks.leaveBeforeAfter?.pass, false);
  assert.ok(disqualified.disqualifyReasons.some((reason) => reason.includes('adjacent payable workday')));

  const inactiveGuard = buildPolicy({
    schemes: {
      equilibrium_school: { id: 'equilibrium_school', activityId: 'ACT_EQ' },
      linc: {
        id: 'linc',
        activityId: 'ACT_LINC',
        hourMode: 'most_recent',
        disqualifyOnLeaveBeforeAfter: false
      }
    }
  });
  const stillQualified = statutoryHolidayCalculationService.evaluateLincTrack({
    holiday,
    policy: inactiveGuard,
    workdayEntries,
    leaveDates: new Set(['2025-12-25'])
  });
  assert.equal(stillQualified.qualified, true);
  assert.equal(stillQualified.checks.leaveBeforeAfter, undefined);

  const noLeaveConflict = statutoryHolidayCalculationService.evaluateLincTrack({
    holiday,
    policy,
    workdayEntries,
    leaveDates: new Set()
  });
  assert.equal(noLeaveConflict.qualified, true);
  assert.equal(noLeaveConflict.checks.leaveBeforeAfter?.pass, true);
});

test('evaluateEquilibriumTrack scopes workday history to equilibrium departments', () => {
  const policy = buildPolicy();
  const evaluation = statutoryHolidayCalculationService.evaluateEquilibriumTrack({
    holiday: { id: 'H1', date: '2026-02-02', title: 'Holiday', type: 'National Holiday' },
    policy,
    workdayEntries: [
      { date: '2026-01-26', deliveryDepartmentId: 'DEPT_EQ', hours: 8, timesheetHours: 8 },
      { date: '2026-01-26', deliveryDepartmentId: 'DEPT_LINC', hours: 8, timesheetHours: 8 }
    ],
    leaveDates: new Set(),
    supplementalHoursByDate: new Map()
  });
  assert.equal(evaluation.checks.trackType, 'equilibrium_school');
  assert.ok(evaluation.checks.minWorkdays);
});

test('clearStatHolidayForReturnedTimesheet removes assignees from every scheme activity', async () => {
  const statutoryHolidayTimesheetLifecycleService = require('../MVC/services/school/statutoryHolidayTimesheetLifecycleService');
  const statutoryHolidayWorkSessionService = require('../MVC/services/school/statutoryHolidayWorkSessionService');
  const policy = buildPolicy();
  const removed = [];
  const originalRemove = statutoryHolidayWorkSessionService.removeStatHolidayWorkSessionsForTarget;
  const originalClear = statutoryHolidayWorkSessionService.clearStatHolidayActivityLevelAttendees;
  statutoryHolidayWorkSessionService.removeStatHolidayWorkSessionsForTarget = async ({ activityId }) => {
    removed.push(activityId);
    return { removedAssignees: 1 };
  };
  statutoryHolidayWorkSessionService.clearStatHolidayActivityLevelAttendees = async ({ activityId }) => {
    removed.push(`clear:${activityId}`);
  };
  try {
    const outcome = await statutoryHolidayTimesheetLifecycleService.clearStatHolidayForReturnedTimesheet({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      period: { id: 'PER_1', startDate: '2026-01-01', endDate: '2026-01-15' },
      policy,
      entries: [{ sessionId: 'stathol-H1-PERSON_1', isStatutoryHoliday: true }]
    });
    assert.equal(outcome.entries.length, 0);
    assert.ok(removed.includes('ACT_EQ'));
    assert.ok(removed.includes('ACT_LINC'));
  } finally {
    statutoryHolidayWorkSessionService.removeStatHolidayWorkSessionsForTarget = originalRemove;
    statutoryHolidayWorkSessionService.clearStatHolidayActivityLevelAttendees = originalClear;
  }
});

test('calculateStatutoryHolidayForPeriod returns one row per built-in scheme', async () => {
  const leaveRequestService = require('../MVC/services/school/leaveRequestService');
  const timesheetWorkdayHistoryService = require('../MVC/services/school/timesheetWorkdayHistoryService');
  const statutoryHolidayEligibilityService = require('../MVC/services/school/statutoryHolidayEligibilityService');
  const originalLeave = leaveRequestService.getApprovedLeaveEventsForPerson;
  const originalHistory = timesheetWorkdayHistoryService.buildWorkdayHistory;
  leaveRequestService.getApprovedLeaveEventsForPerson = async () => [];
  timesheetWorkdayHistoryService.buildWorkdayHistory = async () => new timesheetWorkdayHistoryService.WorkdayHistory();

  try {
    const policy = buildPolicy();
    const context = await statutoryHolidayCalculationService.calculateStatutoryHolidayForPeriod({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-01-31',
      policy,
      holidays: [{
        id: 'H1',
        date: '2026-01-01',
        title: 'New Year',
        type: 'National Holiday'
      }],
      periodEntries: [
        { date: '2026-01-08', deliveryDepartmentId: 'DEPT_LINC', hours: 5, timesheetHours: 5 }
      ],
      reqUser: {}
    });
    assert.equal(context.rows.length, 2);
    const schemeIds = context.rows.map((row) => row.statHolidayMeta?.schemeId).sort();
    assert.deepEqual(schemeIds, ['equilibrium_school', 'linc']);
    const lincRow = context.rows.find((row) => row.statHolidayMeta?.schemeId === 'linc');
    assert.equal(lincRow.statHolidayMeta.calculatedHours, 5);
  } finally {
    leaveRequestService.getApprovedLeaveEventsForPerson = originalLeave;
    timesheetWorkdayHistoryService.buildWorkdayHistory = originalHistory;
  }
});

test('buildStatHolidayMetadataRowsFromEvaluations matches evaluation by scheme id', () => {
  const statutoryHolidayEligibilityService = require('../MVC/services/school/statutoryHolidayEligibilityService');
  const policy = buildPolicy();
  const rows = statutoryHolidayEligibilityService.buildStatHolidayMetadataRowsFromEvaluations({
    personId: 'PERSON_1',
    policy,
    evaluations: [
      {
        schemeId: 'equilibrium_school',
        holidayId: 'H1',
        date: '2026-01-01',
        title: 'New Year',
        qualified: false,
        calculatedHours: 0,
        checks: { trackType: 'equilibrium_school', minWorkdays: { pass: false } },
        disqualifyReasons: ['Needs 30 workdays']
      },
      {
        schemeId: 'linc',
        holidayId: 'H1',
        date: '2026-01-01',
        title: 'New Year',
        qualified: true,
        calculatedHours: 5,
        checks: { trackType: 'linc', departments: [{ departmentId: 'DEPT_LINC', hours: 5 }] },
        disqualifyReasons: []
      }
    ],
    activitySessions: [
      { statHolidayId: 'H1', statHolidaySchemeId: 'linc', date: '2026-01-01', className: 'New Year' }
    ]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].statHolidayMeta.schemeId, 'linc');
  assert.equal(rows[0].statHolidayMeta.checks.trackType, 'linc');
  assert.equal(rows[0].statHolidayMeta.calculatedHours, 5);
});

test('evaluateSchemeHolidayTrack dispatches by scheme id', () => {
  const policy = buildPolicy();
  const linc = statutoryHolidayCalculationService.evaluateSchemeHolidayTrack({
    schemeId: 'linc',
    holiday: { id: 'H1', date: '2026-01-01', title: 'New Year', type: 'National Holiday' },
    policy,
    workdayEntries: [
      { date: '2025-12-25', deliveryDepartmentId: 'DEPT_LINC', hours: 3, timesheetHours: 3 }
    ]
  });
  assert.equal(linc.checks.trackType, statutoryHolidaySchemeService.SCHEME_LINC);
});

test('resolveStatHolidayPlanningHours counts pending manual rows but not rejected', () => {
  const timesheetPrintService = require('../MVC/services/school/timesheetPrintService');
  const pending = {
    isManual: true,
    approvalStatus: 'pending_approval',
    requestedHours: 6,
    date: '2026-02-02',
    deliveryDepartmentId: 'DEPT_EQ'
  };
  assert.equal(timesheetPrintService.resolvePayableHours(pending), 0);
  assert.equal(timesheetPrintService.resolveStatHolidayPlanningHours(pending), 6);
  assert.equal(timesheetPrintService.resolveStatHolidayPlanningHours({
    ...pending,
    approvalStatus: 'rejected'
  }), 0);
});

test('buildSupplementalHoursByDate includes pending manual hours for stat holiday planning', () => {
  const map = statutoryHolidayEligibilityService.buildSupplementalHoursByDate([
    {
      isManual: true,
      approvalStatus: 'pending_approval',
      requestedHours: 5,
      date: '2026-02-16',
      deliveryDepartmentId: 'DEPT_EQ'
    }
  ]);
  assert.equal(map.get('2026-02-16'), 5);
});

test('filterEntriesForScheme includes pending manual rows for stat holiday planning', () => {
  const policy = buildPolicy();
  const rows = statutoryHolidaySchemeService.filterEntriesForScheme([
    {
      isManual: true,
      approvalStatus: 'pending_approval',
      requestedHours: 4,
      date: '2026-01-26',
      deliveryDepartmentId: 'DEPT_EQ',
      hours: 4
    }
  ], statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM, policy);
  assert.equal(rows.length, 1);
});

test('evaluateEquilibriumTrack uses pending manual hours in calculatedHours', () => {
  const policy = buildPolicy({ minWorkdays: 1, weekdayOccurrencesRequired: 1 });
  const evaluation = statutoryHolidayCalculationService.evaluateEquilibriumTrack({
    holiday: { id: 'H1', date: '2026-02-16', title: 'Family Day', type: 'National Holiday' },
    policy,
    workdayEntries: [
      {
        isManual: true,
        approvalStatus: 'pending_approval',
        requestedHours: 7.5,
        date: '2026-02-09',
        deliveryDepartmentId: 'DEPT_EQ',
        hours: 7.5,
        timesheetHours: 7.5
      }
    ],
    leaveDates: new Set(),
    supplementalHoursByDate: new Map()
  });
  assert.ok(evaluation.calculatedHours > 0);
  assert.equal(evaluation.calculatedHours, 7.5);
});

test('assemblePeriodWorkdayEntries includes frozen auto-pulled act sessions from timesheet entries', () => {
  const rows = statutoryHolidayEligibilityService.assemblePeriodWorkdayEntries([
    {
      sessionId: 'act-705736-ENT-705736-0029-526625',
      date: '2026-01-09',
      deliveryDepartmentId: 'DEPT_LINC',
      hours: 6,
      isManual: false
    },
    {
      sessionId: 'stathol-linc-797275-526625',
      date: '2026-01-01',
      isStatutoryHoliday: true,
      hours: 0
    }
  ], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionId, 'act-705736-ENT-705736-0029-526625');
});
