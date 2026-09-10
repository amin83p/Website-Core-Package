'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const timesheetParametersPolicyService = require('../MVC/services/school/timesheetParametersPolicyService');
const statutoryHolidayEligibilityService = require('../MVC/services/school/statutoryHolidayEligibilityService');
const statutoryHolidayWorkSessionService = require('../MVC/services/school/statutoryHolidayWorkSessionService');
const timesheetLiveAssemblyService = require('../MVC/services/school/timesheetLiveAssemblyService');
const leaveRequestService = require('../MVC/services/school/leaveRequestService');
const timesheetWorkdayHistoryService = require('../MVC/services/school/timesheetWorkdayHistoryService');
const activityService = require('../MVC/services/school/activityService');
const dataService = require('../MVC/services/school/schoolDataService');
const timesheetLegacyImportService = require('../MVC/services/school/timesheetLegacyImportService');

test('timesheet parameters policy stores statutoryHolidayPay.activityId', () => {
  const normalized = timesheetParametersPolicyService.validatePolicyInput({
    emptyEnrollmentSessions: 'hide',
    statutoryHolidayPayEnabled: 'true',
    statutoryHolidayActivityId: 'ACT_STAT',
    statutoryHolidayMinWorkdays: '30',
    statutoryHolidayWeekdayOccurrencesRequired: '5',
    statutoryHolidayWeekdayOccurrencesLookback: '9',
    statutoryHolidayEarningsLookbackWeeks: '4',
    statutoryHolidayBeforeAfterSearchDays: '14',
    payableHolidayType_National_Holiday: 'true',
    payableHolidayType_Observance_Paid: 'true'
  });
  assert.equal(normalized.statutoryHolidayPay.activityId, 'ACT_STAT');
  assert.equal(
    statutoryHolidayEligibilityService.resolveStatHolidayActivityId(normalized),
    'ACT_STAT'
  );
});

test('validatePolicyInput preserves statutoryHolidayPay when re-validating stored policy shape', () => {
  const normalized = timesheetParametersPolicyService.validatePolicyInput({
    emptyEnrollmentSessions: 'hide',
    statutoryHolidayPayEnabled: 'true',
    statutoryHolidayActivityId: 'ACT_STAT',
    statutoryHolidayMinWorkdays: '25',
    statutoryHolidayWeekdayOccurrencesRequired: '5',
    statutoryHolidayWeekdayOccurrencesLookback: '9',
    statutoryHolidayEarningsLookbackWeeks: '4',
    statutoryHolidayBeforeAfterSearchDays: '14',
    statutoryHolidayDisqualifyOnLeaveDuringHolidayWeek: 'true',
    payableHolidayType_National_Holiday: 'true',
    payableHolidayType_Observance_Paid: 'true'
  });
  const roundTrip = timesheetParametersPolicyService.validatePolicyInput(normalized);
  assert.equal(roundTrip.statutoryHolidayPay.activityId, 'ACT_STAT');
  assert.equal(roundTrip.statutoryHolidayPay.minWorkdays, 25);
  assert.equal(roundTrip.statutoryHolidayPay.disqualifyOnLeaveDuringHolidayWeek, true);
});

test('buildStatHolidayWarning returns null when force pay override applies', () => {
  const evaluation = {
    holidayId: 'H1',
    date: '2025-11-11',
    title: 'Remembrance Day',
    qualified: false,
    calculatedHours: 0,
    checks: {},
    disqualifyReasons: ['No payable workdays in the earnings lookback window.']
  };
  const warning = statutoryHolidayEligibilityService.buildStatHolidayWarning({
    evaluation,
    existingEntry: {
      statHolidayOverride: { forcePay: true, hours: 6 }
    },
    allowManagerOverride: true
  });
  assert.equal(warning, null);
});

test('buildStatHolidayWarning returns reasons when pay is blocked', () => {
  const evaluation = {
    holidayId: 'H1',
    date: '2025-11-11',
    title: 'Remembrance Day',
    qualified: false,
    calculatedHours: 0,
    checks: {},
    disqualifyReasons: ['No payable workdays in the earnings lookback window.']
  };
  const warning = statutoryHolidayEligibilityService.buildStatHolidayWarning({
    evaluation,
    existingEntry: null,
    allowManagerOverride: true
  });
  assert.ok(warning);
  assert.equal(warning.holidayId, 'H1');
  assert.match(warning.reasons.join(' '), /No payable workdays/i);
});

test('syncStatHolidayWorkSessionsForPersonPeriod upserts assignee on shared day entry', async () => {
  const activity = {
    id: 'ACT_STAT',
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    evaluationType: 'attendance',
    visibilityScope: 'school',
    title: 'Stat Holiday Pay',
    departmentId: 'DEPT_1',
    departmentName: 'Instruction',
    entries: [{
      entryId: 'ENT-ACT_STAT-0001',
      date: '2025-11-11',
      startTime: '08:00',
      endTime: '20:00',
      durationHours: 12,
      status: 'posted',
      statHolidayId: 'H1',
      assignees: [],
      excludedPersonIds: []
    }]
  };
  const originalEligible = activityService.isPersonEligibleForActivity;
  const originalGetActivity = activityService.getActivity;
  const originalUpdate = dataService.updateData;
  let maintenanceArgs = null;

  activityService.isPersonEligibleForActivity = () => true;
  activityService.getActivity = async () => ({ ...activity, entries: [...activity.entries] });
  dataService.updateData = async (entityType, id, payload, reqUser, options) => {
    maintenanceArgs = { entityType, id, payload, options };
    return payload;
  };

  try {
    const outcome = await statutoryHolidayWorkSessionService.syncStatHolidayWorkSessionsForPersonPeriod({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      personName: 'Teacher',
      personRole: 'teacher',
      period: { id: 'PER_1', startDate: '2025-11-01', endDate: '2025-11-30' },
      activity,
      payItems: [{
        evaluation: {
          holidayId: 'H1',
          date: '2025-11-11',
          title: 'Remembrance Day'
        },
        hours: 6
      }],
      reqUser: {}
    });

    assert.equal(outcome.rowCount, 1);
    assert.equal(maintenanceArgs?.entityType, 'activities');
    assert.equal(maintenanceArgs?.id, 'ACT_STAT');
    assert.equal(maintenanceArgs?.options?.maintenanceActivityEntries, true);
    assert.equal(maintenanceArgs?.payload?.entries?.length, 1);
    const entry = maintenanceArgs?.payload?.entries?.[0];
    assert.equal(entry.statHolidayId, 'H1');
    assert.equal(entry.durationHours, 12);
    assert.equal(entry.startTime, '08:00');
    assert.equal(entry.endTime, '20:00');
    assert.equal(entry.assignees?.length, 1);
    assert.equal(entry.assignees?.[0]?.paidHours, 6);
    assert.equal(entry.assignees?.[0]?.statHolidayPersonId, 'PERSON_1');
    assert.equal(activity.departmentId, 'DEPT_1');
  } finally {
    activityService.isPersonEligibleForActivity = originalEligible;
    activityService.getActivity = originalGetActivity;
    dataService.updateData = originalUpdate;
  }
});

test('materializeStatHolidayForPersonPeriod skips activity sync when persistToActivity is false', async () => {
  const originalLeave = leaveRequestService.getApprovedLeaveEventsForPerson;
  const originalHistory = timesheetWorkdayHistoryService.buildWorkdayHistory;
  const originalResolveActivity = timesheetLegacyImportService.resolvePublicStatHolidayActivity;
  const originalUpdate = dataService.updateData;
  let updateCalled = false;

  leaveRequestService.getApprovedLeaveEventsForPerson = async () => [];
  timesheetWorkdayHistoryService.buildWorkdayHistory = async () => new timesheetWorkdayHistoryService.WorkdayHistory();
  timesheetLegacyImportService.resolvePublicStatHolidayActivity = async () => ({
    id: 'ACT_STAT',
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    visibilityScope: 'school',
    entries: []
  });
  dataService.updateData = async () => {
    updateCalled = true;
    return {};
  };

  try {
    const outcome = await statutoryHolidayWorkSessionService.materializeStatHolidayForPersonPeriod({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      period: { id: 'PER_1', startDate: '2026-02-01', endDate: '2026-02-28' },
      policy: {
        statutoryHolidayPay: {
          enabled: true,
          activityId: 'ACT_STAT',
          minWorkdays: 30,
          weekdayOccurrencesRequired: 5,
          weekdayOccurrencesLookback: 9,
          earningsLookbackWeeks: 4,
          beforeAfterSearchDays: 14,
          payableHolidayTypes: ['National Holiday']
        }
      },
      holidays: [{
        id: 'H1',
        date: '2026-02-16',
        title: 'Family Day',
        type: 'National Holiday'
      }],
      reqUser: {},
      persistToActivity: false
    });
    assert.equal(outcome.syncOutcome, null);
    assert.equal(updateCalled, false);
  } finally {
    leaveRequestService.getApprovedLeaveEventsForPerson = originalLeave;
    timesheetWorkdayHistoryService.buildWorkdayHistory = originalHistory;
    timesheetLegacyImportService.resolvePublicStatHolidayActivity = originalResolveActivity;
    dataService.updateData = originalUpdate;
  }
});

test('materializeStatHolidayForPersonPeriod skips activity sync before period start date', async () => {
  const originalLeave = leaveRequestService.getApprovedLeaveEventsForPerson;
  const originalHistory = timesheetWorkdayHistoryService.buildWorkdayHistory;
  const originalResolveActivity = timesheetLegacyImportService.resolvePublicStatHolidayActivity;
  const originalUpdate = dataService.updateData;
  let updateCalled = false;

  leaveRequestService.getApprovedLeaveEventsForPerson = async () => [];
  timesheetWorkdayHistoryService.buildWorkdayHistory = async () => new timesheetWorkdayHistoryService.WorkdayHistory();
  timesheetLegacyImportService.resolvePublicStatHolidayActivity = async () => ({
    id: 'ACT_STAT',
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    visibilityScope: 'school',
    entries: []
  });
  dataService.updateData = async () => {
    updateCalled = true;
    return {};
  };

  try {
    const outcome = await statutoryHolidayWorkSessionService.materializeStatHolidayForPersonPeriod({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      period: { id: 'PER_FUTURE', startDate: '2099-01-01', endDate: '2099-01-15' },
      policy: {
        statutoryHolidayPay: {
          enabled: true,
          activityId: 'ACT_STAT',
          minWorkdays: 30,
          weekdayOccurrencesRequired: 5,
          weekdayOccurrencesLookback: 9,
          earningsLookbackWeeks: 4,
          beforeAfterSearchDays: 14,
          payableHolidayTypes: ['National Holiday']
        }
      },
      holidays: [{
        id: 'H1',
        date: '2099-01-01',
        title: 'Future Holiday',
        type: 'National Holiday'
      }],
      reqUser: {},
      persistToActivity: true
    });
    assert.equal(outcome.syncOutcome, null);
    assert.equal(updateCalled, false);
    assert.equal(
      statutoryHolidayWorkSessionService.shouldPersistStatHolidayToSharedActivity(
        { startDate: '2099-01-01' },
        true
      ),
      false
    );
  } finally {
    leaveRequestService.getApprovedLeaveEventsForPerson = originalLeave;
    timesheetWorkdayHistoryService.buildWorkdayHistory = originalHistory;
    timesheetLegacyImportService.resolvePublicStatHolidayActivity = originalResolveActivity;
    dataService.updateData = originalUpdate;
  }
});

test('removeStatHolidayTargetFromEntries preserves day entry when assignee is removed', () => {
  const entries = [{
    entryId: 'ENT-1',
    date: '2025-11-11',
    startTime: '08:00',
    endTime: '20:00',
    durationHours: 12,
    statHolidayId: 'H1',
    assignees: [{
      personId: 'PERSON_1',
      statHolidayId: 'H1',
      statHolidayPeriodId: 'PER_1',
      statHolidayPersonId: 'PERSON_1',
      paidHours: 6
    }]
  }];
  const cleanup = statutoryHolidayWorkSessionService.removeStatHolidayTargetFromEntries(entries, {
    personId: 'PERSON_1',
    periodId: 'PER_1',
    periodStartDate: '2025-11-01',
    periodEndDate: '2025-11-30'
  });
  assert.equal(cleanup.removedAssignees, 1);
  assert.equal(cleanup.removedEntries, 0);
  assert.equal(cleanup.entries.length, 1);
  assert.deepEqual(cleanup.entries[0].assignees, []);
});

test('cleanupStatHolidayWorkSessionsOnImportDelete removes assignee from statutory holiday activity', async () => {
  const activity = {
    id: 'ACT_STAT',
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    title: 'Stat Holiday Pay',
    departmentId: 'DEPT_1',
    evaluationType: 'attendance',
    entries: [{
      entryId: 'ENT-ACT_STAT-0001',
      date: '2026-02-16',
      startTime: '08:00',
      endTime: '20:00',
      durationHours: 12,
      statHolidayId: 'H1',
      assignees: [{
        personId: 'PERSON_1',
        statHolidayId: 'H1',
        statHolidayPeriodId: 'PER_1',
        statHolidayPersonId: 'PERSON_1',
        paidHours: 6
      }]
    }]
  };
  const originalGetActivity = activityService.getActivity;
  const originalUpdate = dataService.updateData;
  let maintenanceArgs = null;

  activityService.getActivity = async () => ({ ...activity, entries: [...activity.entries] });
  dataService.updateData = async (entityType, id, payload, reqUser, options) => {
    maintenanceArgs = { entityType, id, payload, options };
    return payload;
  };

  try {
    const outcome = await statutoryHolidayWorkSessionService.cleanupStatHolidayWorkSessionsOnImportDelete({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      period: { id: 'PER_1', startDate: '2026-02-01', endDate: '2026-02-28' },
      policy: {
        statutoryHolidayPay: {
          enabled: true,
          activityId: 'ACT_STAT'
        }
      },
      reqUser: {}
    });

    assert.equal(outcome.removedAssignees, 1);
    assert.equal(outcome.removedEntries, 0);
    assert.equal(outcome.activityId, 'ACT_STAT');
    assert.equal(maintenanceArgs?.entityType, 'activities');
    assert.equal(maintenanceArgs?.payload?.entries?.[0]?.assignees?.length, 0);
  } finally {
    activityService.getActivity = originalGetActivity;
    dataService.updateData = originalUpdate;
  }
});

test('buildStatHolidayPayItems pays manual override when auto calculation is zero', () => {
  const evaluation = {
    holidayId: 'H1',
    date: '2025-11-11',
    title: 'Remembrance Day',
    qualified: false,
    calculatedHours: 0
  };
  const existingByHolidayId = statutoryHolidayEligibilityService.buildOverrideLookup([], {
    H1: { forcePay: true, hours: 7.5, reason: 'Manager entered hours' }
  });
  const items = statutoryHolidayEligibilityService.buildStatHolidayPayItems({
    evaluations: [evaluation],
    existingByHolidayId,
    allowManagerOverride: true
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].hours, 7.5);
  assert.equal(items[0].payResolution.shouldPay, true);
});

test('buildStatutoryHolidayTimesheetContext populates warnings when pay is blocked', async () => {
  const originalLeave = leaveRequestService.getApprovedLeaveEventsForPerson;
  const originalHistory = timesheetWorkdayHistoryService.buildWorkdayHistory;

  leaveRequestService.getApprovedLeaveEventsForPerson = async () => [];
  timesheetWorkdayHistoryService.buildWorkdayHistory = async () => new timesheetWorkdayHistoryService.WorkdayHistory();

  try {
    const context = await statutoryHolidayEligibilityService.buildStatutoryHolidayTimesheetContext({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodStartDate: '2025-11-01',
      periodEndDate: '2025-11-30',
      policy: {
        statutoryHolidayPay: {
          enabled: true,
          activityId: 'ACT_STAT',
          minWorkdays: 30,
          weekdayOccurrencesRequired: 5,
          weekdayOccurrencesLookback: 9,
          earningsLookbackWeeks: 4,
          beforeAfterSearchDays: 14,
          payableHolidayTypes: ['National Holiday']
        }
      },
      holidays: [{
        id: 'H1',
        date: '2025-11-11',
        title: 'Remembrance Day',
        type: 'National Holiday'
      }],
      allowManagerOverride: true,
      reqUser: {}
    });

    assert.equal(context.warnings.length, 1);
    assert.equal(context.warnings[0].holidayId, 'H1');
    assert.equal(context.usesActivityMode, true);
    assert.match(context.warnings[0].reasons.join(' '), /No payable workdays/i);
  } finally {
    leaveRequestService.getApprovedLeaveEventsForPerson = originalLeave;
    timesheetWorkdayHistoryService.buildWorkdayHistory = originalHistory;
  }
});

test('activity mode zeroes metadata stathol rows so act sessions are not double-counted', () => {
  const statholRow = {
    sessionId: 'stathol-H1-PERSON_1',
    date: '2025-11-11',
    hours: 6,
    timesheetHours: 6,
    durationHours: 6,
    isStatutoryHoliday: true
  };
  const zeroedMetadataRow = {
    ...statholRow,
    hours: 0,
    timesheetHours: 0,
    durationHours: 0
  };
  const activityRow = {
    sessionId: 'act-ACT_STAT-ENT-ACT_STAT-0001-PERSON_1',
    date: '2025-11-11',
    hours: 6,
    timesheetHours: 6,
    isSchoolActivity: true,
    statHolidayId: 'H1'
  };

  const withoutActivityMode = timesheetLiveAssemblyService.calculateTimesheetTotal([
    statholRow,
    activityRow
  ]);
  const withActivityMode = timesheetLiveAssemblyService.calculateTimesheetTotal([
    zeroedMetadataRow,
    activityRow
  ]);

  assert.equal(withoutActivityMode, 12);
  assert.equal(withActivityMode, 6);
});

test('normalizeStatHolidayOverrideMap converts import payload rows', () => {
  const map = statutoryHolidayWorkSessionService.normalizeStatHolidayOverrideMap([
    { holidayId: 'H1', hours: 5.5, reason: 'Manual import override' }
  ]);
  assert.equal(map.H1.forcePay, true);
  assert.equal(map.H1.hours, 5.5);
  assert.match(map.H1.reason, /Manual import override/);
});
