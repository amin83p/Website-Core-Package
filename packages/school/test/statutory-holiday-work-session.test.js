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

test('validatePolicyInput persists statutory holiday day mapping year and activity', () => {
  const normalized = timesheetParametersPolicyService.validatePolicyInput({
    emptyEnrollmentSessions: 'hide',
    statutoryHolidayPayEnabled: 'true',
    statutoryHolidayActivityId: 'ACT_MAIN',
    statutoryHolidayMappingYear: '2027',
    statutoryHolidayMappingActivityId: 'ACT_MAP'
  });
  assert.equal(normalized.statutoryHolidayPay.activityId, 'ACT_MAIN');
  assert.equal(normalized.statutoryHolidayPay.mappingYear, '2027');
  assert.equal(normalized.statutoryHolidayPay.mappingActivityId, 'ACT_MAP');
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

test('materializeStatHolidayForPersonPeriod with persistToActivity false does not block on missing day shells', async () => {
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
          schemes: {
            equilibrium_school: { id: 'equilibrium_school', activityId: 'ACT_STAT' },
            linc: { id: 'linc', activityId: 'ACT_LINC' }
          },
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
    assert.equal(outcome.syncOutcome?.blocked, false);
    assert.equal(outcome.syncOutcome?.missingDayEntries?.length, 2);
    assert.equal(outcome.blockingErrors?.length || 0, 0);
    assert.equal(updateCalled, false);
    assert.equal(outcome.rows.length, 2);
  } finally {
    leaveRequestService.getApprovedLeaveEventsForPerson = originalLeave;
    timesheetWorkdayHistoryService.buildWorkdayHistory = originalHistory;
    timesheetLegacyImportService.resolvePublicStatHolidayActivity = originalResolveActivity;
    dataService.updateData = originalUpdate;
  }
});

test('materializeStatHolidayForPersonPeriod with persistToActivity false and mapped day entry skips sync without blocking', async () => {
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
    entries: [{
      entryId: 'ENT-ACT_STAT-0001',
      date: '2026-02-16',
      startTime: '08:00',
      endTime: '20:00',
      durationHours: 12,
      status: 'posted',
      statHolidayId: 'H1',
      assignees: []
    }]
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
    assert.equal(outcome.syncOutcome?.blocked, false);
    assert.equal(outcome.syncOutcome?.missingDayEntries?.length || 0, 0);
    assert.equal(outcome.blockingErrors?.length || 0, 0);
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
    entries: [{
      entryId: 'ENT-ACT_STAT-0001',
      date: '2099-01-01',
      startTime: '08:00',
      endTime: '20:00',
      durationHours: 12,
      status: 'posted',
      statHolidayId: 'H1',
      assignees: []
    }]
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
    assert.equal(outcome.syncOutcome?.blocked, false);
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

test('stripStatHolidayAssigneesFromEntries removes all stat-holiday assignees from activity day entries', () => {
  const entries = [{
    entryId: 'ENT-1',
    date: '2026-02-16',
    statHolidayId: 'H1',
    assignees: [{
      personId: 'PERSON_1',
      personName: 'Amin Paknejad',
      statHolidayId: 'H1',
      statHolidayPersonId: 'PERSON_1',
      paidHours: 6
    }]
  }, {
    entryId: 'ENT-2',
    date: '2026-03-01',
    assignees: [{ personId: 'PERSON_2', paidHours: 8 }]
  }];
  const cleanup = statutoryHolidayWorkSessionService.stripStatHolidayAssigneesFromEntries(entries);
  assert.equal(cleanup.removedAssignees, 1);
  assert.equal(cleanup.entries.length, 2);
  assert.deepEqual(cleanup.entries[0].assignees, []);
  assert.equal(cleanup.entries[1].assignees.length, 1);
});

test('stripStatHolidayAssigneesFromEntries strips unstamped assignees when stripAllActivityAssignees is set', () => {
  const entries = [{
    entryId: 'ENT-1',
    date: '2026-02-16',
    assignees: [{
      personId: 'PERSON_1',
      personName: 'Amin Paknejad',
      paidHours: 6
    }]
  }];
  const cleanup = statutoryHolidayWorkSessionService.stripStatHolidayAssigneesFromEntries(entries, {
    stripAllActivityAssignees: true
  });
  assert.equal(cleanup.removedAssignees, 1);
  assert.deepEqual(cleanup.entries[0].assignees, []);
});

test('stripStatHolidayAssigneesFromEntries can target one person only', () => {
  const entries = [{
    entryId: 'ENT-1',
    date: '2026-02-16',
    statHolidayId: 'H1',
    assignees: [
      {
        personId: 'PERSON_1',
        statHolidayId: 'H1',
        statHolidayPersonId: 'PERSON_1',
        paidHours: 6
      },
      {
        personId: 'PERSON_2',
        statHolidayId: 'H1',
        statHolidayPersonId: 'PERSON_2',
        paidHours: 4
      }
    ]
  }];
  const cleanup = statutoryHolidayWorkSessionService.stripStatHolidayAssigneesFromEntries(entries, {
    personId: 'PERSON_1'
  });
  assert.equal(cleanup.removedAssignees, 1);
  assert.equal(cleanup.entries[0].assignees.length, 1);
  assert.equal(cleanup.entries[0].assignees[0].personId, 'PERSON_2');
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

test('buildOverrideLookup parses dashed holiday ids from stathol session ids', () => {
  const existingByHolidayId = statutoryHolidayEligibilityService.buildOverrideLookup([
    {
      sessionId: 'stathol-HOL-23623-PERSON_1',
      isStatutoryHoliday: true,
      statHolidayOverride: { forcePay: true, hours: 8, reason: 'Manager adjusted' }
    }
  ], null, { personId: 'PERSON_1' });
  const items = statutoryHolidayEligibilityService.buildStatHolidayPayItems({
    evaluations: [{
      holidayId: 'HOL-23623',
      date: '2026-01-01',
      title: "New Year's Day",
      qualified: false,
      calculatedHours: 0
    }],
    existingByHolidayId,
    allowManagerOverride: true
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].hours, 8);
});

test('buildOverrideLookup merges act row override via same-date stathol peer', () => {
  const existingByHolidayId = statutoryHolidayEligibilityService.buildOverrideLookup([
    {
      sessionId: 'stathol-797275-PERSON_1',
      date: '2026-01-01',
      isStatutoryHoliday: true,
      statHolidayMeta: { holidayId: '797275', qualified: false, calculatedHours: 0 }
    },
    {
      sessionId: 'act-353390-ENT-353390-0010-PERSON_1',
      date: '2026-01-01',
      statHolidayOverride: { forcePay: true, hours: 7.65, reason: 'Manager adjusted statutory holiday hours' }
    }
  ], null, { personId: 'PERSON_1' });
  const items = statutoryHolidayEligibilityService.buildStatHolidayPayItems({
    evaluations: [{
      holidayId: '797275',
      date: '2026-01-01',
      title: "New Year's Day",
      qualified: false,
      calculatedHours: 0
    }],
    existingByHolidayId,
    allowManagerOverride: true
  });
  assert.equal(items[0].hours, 7.65);
  assert.equal(items[0].payResolution.shouldPay, true);
});

test('buildOverrideLookup merges override from activity row statHolidayId', () => {
  const existingByHolidayId = statutoryHolidayEligibilityService.buildOverrideLookup([
    {
      sessionId: 'act-ACT-ENT-PERSON_1',
      statHolidayId: 'HOL-23623',
      statHolidayOverride: { forcePay: true, hours: 6.5, reason: 'Manager adjusted' }
    }
  ], null, { personId: 'PERSON_1' });
  const items = statutoryHolidayEligibilityService.buildStatHolidayPayItems({
    evaluations: [{
      holidayId: 'HOL-23623',
      date: '2026-01-01',
      title: "New Year's Day",
      qualified: false,
      calculatedHours: 0
    }],
    existingByHolidayId,
    allowManagerOverride: true
  });
  assert.equal(items[0].hours, 6.5);
});

test('buildStatHolidayPayItems applies qualified override hours without forcePay', () => {
  const evaluation = {
    holidayId: 'H1',
    date: '2025-11-11',
    title: 'Remembrance Day',
    qualified: true,
    calculatedHours: 7.5
  };
  const existingByHolidayId = statutoryHolidayEligibilityService.buildOverrideLookup([
    {
      sessionId: 'stathol-H1-PERSON_1',
      isStatutoryHoliday: true,
      statHolidayMeta: { holidayId: 'H1' },
      statHolidayOverride: { hours: 8, reason: 'Manager adjusted qualified holiday' }
    }
  ]);
  const items = statutoryHolidayEligibilityService.buildStatHolidayPayItems({
    evaluations: [evaluation],
    existingByHolidayId,
    allowManagerOverride: true
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].hours, 8);
  assert.equal(items[0].payResolution.shouldPay, true);
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

    assert.ok(context.warnings.length >= 1);
    assert.equal(context.rows.length, 2);
    assert.equal(context.warnings[0].holidayId, 'H1');
    assert.equal(context.usesActivityMode, true);
    assert.match(context.warnings[0].reasons.join(' '), /No payable workdays|No payable LINC/i);
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

test('findStatHolidayDayEntry accepts sole unstamped work session on holiday date', () => {
  const entries = [{
    entryId: 'ENT-WINTER',
    date: '2026-01-01',
    startTime: '08:00',
    endTime: '20:00',
    durationHours: 12,
    assignees: []
  }];
  assert.equal(
    statutoryHolidayWorkSessionService.findStatHolidayDayEntry(entries, { holidayId: 'H-WINTER', date: '2026-01-01' })?.entryId,
    'ENT-WINTER'
  );
});

test('findStatHolidayDayEntry requires matching statHolidayId and ignores unstamped same-date entries', () => {
  const entries = [{
    entryId: 'ENT-IMPORT',
    date: '2026-02-16',
    durationHours: 95.79,
    assignees: [{ personId: 'PERSON_1', paidHours: 95.79 }]
  }, {
    entryId: 'ENT-HOLIDAY',
    date: '2026-02-16',
    statHolidayId: 'H1',
    durationHours: 12,
    assignees: []
  }];
  assert.equal(
    statutoryHolidayWorkSessionService.findStatHolidayDayEntry(entries, { holidayId: 'H1', date: '2026-02-16' })?.entryId,
    'ENT-HOLIDAY'
  );
  assert.equal(
    statutoryHolidayWorkSessionService.findStatHolidayDayEntry(entries, { holidayId: 'H2', date: '2026-02-16' }),
    null
  );
});

test('syncStatHolidayWorkSessionsForPersonPeriod normalizes corrupted day entry duration and paidHours', async () => {
  const activity = {
    id: 'ACT_STAT',
    orgId: 'ORG_1',
    status: 'posted',
    paid: false,
    evaluationType: 'attendance',
    visibilityScope: 'school',
    title: 'Stat Holiday Pay',
    departmentId: 'DEPT_1',
    entries: [{
      entryId: 'ENT-ACT_STAT-0002',
      date: '2026-02-16',
      startTime: '08:00',
      endTime: '20:00',
      durationHours: 95.79,
      status: 'posted',
      statHolidayId: 'H1',
      assignees: []
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
    await statutoryHolidayWorkSessionService.syncStatHolidayWorkSessionsForPersonPeriod({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      personName: 'Teacher',
      personRole: 'teacher',
      period: { id: 'PER_1', startDate: '2026-02-01', endDate: '2026-02-28' },
      activity,
      payItems: [{
        evaluation: { holidayId: 'H1', date: '2026-02-16', title: 'Family Day' },
        hours: 6
      }],
      reqUser: {}
    });
    const entry = maintenanceArgs?.payload?.entries?.[0];
    assert.equal(entry.durationHours, 12);
    assert.equal(entry.assignees?.[0]?.paidHours, 6);
    assert.equal(entry.assignees?.[0]?.startTime, '08:00');
    assert.equal(entry.assignees?.[0]?.endTime, '14:00');
  } finally {
    activityService.isPersonEligibleForActivity = originalEligible;
    activityService.getActivity = originalGetActivity;
    dataService.updateData = originalUpdate;
  }
});

test('resolveActivityTimesheetEntryHours ignores inflated durationHours for stat holiday assignees', () => {
  const activity = { paid: false, evaluationType: 'attendance' };
  const entry = {
    date: '2026-02-16',
    durationHours: 95.79,
    statHolidayId: 'H1'
  };
  const assignee = {
    personId: 'PERSON_1',
    statHolidayId: 'H1',
    statHolidayPersonId: 'PERSON_1',
    paidHours: 6
  };
  assert.equal(activityService.resolveActivityTimesheetEntryHours(activity, assignee, entry), 6);
  assert.equal(
    activityService.resolveActivityTimesheetEntryHours(activity, { ...assignee, paidHours: 0 }, entry),
    0
  );
});

test('removeStatHolidayTargetFromEntries removes assignee matched by personId without statHolidayPersonId', () => {
  const entries = [{
    entryId: 'ENT-1',
    date: '2026-02-16',
    statHolidayId: 'H1',
    assignees: [{
      personId: 'PERSON_1',
      statHolidayId: 'H1',
      paidHours: 6
    }]
  }];
  const cleanup = statutoryHolidayWorkSessionService.removeStatHolidayTargetFromEntries(entries, {
    personId: 'PERSON_1',
    periodId: 'PER_1',
    periodStartDate: '2026-02-01',
    periodEndDate: '2026-02-28'
  });
  assert.equal(cleanup.removedAssignees, 1);
  assert.deepEqual(cleanup.entries[0].assignees, []);
});

test('countStatHolidayAssigneesForPersonPeriod counts stamped assignees in date range', () => {
  const count = statutoryHolidayWorkSessionService.countStatHolidayAssigneesForPersonPeriod({
    entries: [{
      date: '2026-02-16',
      assignees: [{ personId: 'PERSON_1', statHolidayId: 'H1', paidHours: 6 }]
    }, {
      date: '2026-03-01',
      assignees: [{ personId: 'PERSON_1', statHolidayId: 'H2', paidHours: 6 }]
    }],
    personId: 'PERSON_1',
    periodStartDate: '2026-02-01',
    periodEndDate: '2026-02-28'
  });
  assert.equal(count, 1);
});

test('normalizeStatHolidayOverrideMap converts import payload rows', () => {
  const map = statutoryHolidayWorkSessionService.normalizeStatHolidayOverrideMap([
    { holidayId: 'H1', hours: 5.5, reason: 'Manual import override' }
  ]);
  const key = 'equilibrium_school|H1';
  assert.equal(map[key].forcePay, true);
  assert.equal(map[key].hours, 5.5);
  assert.match(map[key].reason, /Manual import override/);
});

test('getTimesheetEntriesForPerson returns one stat-holiday row when only one day entry has assignee', async () => {
  const statHolidayActivity = {
    id: 'ACT_STAT',
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    evaluationType: 'attendance',
    visibilityScope: 'school',
    title: 'Stat Holiday Pay',
    departmentId: 'DEPT_1',
    attendees: [{
      personId: 'PERSON_1',
      statHolidayId: 'H1',
      paidHours: 6
    }],
    entries: [
      { entryId: 'ENT-1', date: '2026-02-03', statHolidayId: 'H0', durationHours: 12, assignees: [] },
      {
        entryId: 'ENT-2',
        date: '2026-02-16',
        statHolidayId: 'H1',
        durationHours: 12,
        assignees: [{
          personId: 'PERSON_1',
          statHolidayId: 'H1',
          statHolidayPersonId: 'PERSON_1',
          paidHours: 6,
          paid: true,
          status: 'attended'
        }]
      },
      { entryId: 'ENT-3', date: '2026-02-17', statHolidayId: 'H2', durationHours: 12, assignees: [] },
      { entryId: 'ENT-4', date: '2026-03-10', statHolidayId: 'H3', durationHours: 12, assignees: [] },
      { entryId: 'ENT-5', date: '2026-04-01', statHolidayId: 'H4', durationHours: 12, assignees: [] }
    ]
  };
  const originalFetchData = dataService.fetchData;
  const originalFetchAll = dataService.fetchAllData;
  dataService.fetchData = async (entityType) => (
    entityType === 'activities' ? [statHolidayActivity] : []
  );
  dataService.fetchAllData = async () => [];
  try {
    const rows = await activityService.getTimesheetEntriesForPerson({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      periodStartDate: '2026-02-01',
      periodEndDate: '2026-02-28',
      reqUser: { activeOrgId: 'ORG_1' }
    });
    const statRows = rows.filter((row) => row.statHolidayId);
    assert.equal(statRows.length, 1);
    assert.equal(statRows[0].statHolidayId, 'H1');
    assert.equal(statRows[0].date, '2026-02-16');
    assert.equal(statRows[0].hours, 6);
  } finally {
    dataService.fetchData = originalFetchData;
    dataService.fetchAllData = originalFetchAll;
  }
});

test('syncStatHolidayWorkSessionsForPersonPeriod does not propagate assignee to other stat-holiday day slots', async () => {
  const activity = {
    id: 'ACT_STAT',
    orgId: 'ORG_1',
    status: 'posted',
    paid: false,
    evaluationType: 'attendance',
    visibilityScope: 'school',
    title: 'Stat Holiday Pay',
    departmentId: 'DEPT_1',
    entries: [
      { entryId: 'ENT-1', date: '2026-02-03', statHolidayId: 'H0', durationHours: 12, assignees: [] },
      { entryId: 'ENT-2', date: '2026-02-16', statHolidayId: 'H1', durationHours: 12, assignees: [] },
      { entryId: 'ENT-3', date: '2026-02-17', statHolidayId: 'H2', durationHours: 12, assignees: [] }
    ]
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
    await statutoryHolidayWorkSessionService.syncStatHolidayWorkSessionsForPersonPeriod({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      personName: 'Teacher',
      personRole: 'teacher',
      period: { id: 'PER_1', startDate: '2026-02-01', endDate: '2026-02-28' },
      activity,
      payItems: [{
        evaluation: { holidayId: 'H1', date: '2026-02-16', title: 'Family Day' },
        hours: 6
      }],
      reqUser: {}
    });
    const entries = maintenanceArgs?.payload?.entries || [];
    const familyDay = entries.find((entry) => entry.entryId === 'ENT-2');
    const otherSlots = entries.filter((entry) => entry.entryId !== 'ENT-2');
    assert.equal(familyDay?.assignees?.length, 1);
    assert.equal(familyDay.assignees[0].personId, 'PERSON_1');
    otherSlots.forEach((entry) => {
      assert.deepEqual(entry.assignees, []);
    });
    assert.deepEqual(maintenanceArgs?.payload?.attendees, []);
  } finally {
    activityService.isPersonEligibleForActivity = originalEligible;
    activityService.getActivity = originalGetActivity;
    dataService.updateData = originalUpdate;
  }
});

test('syncStatHolidayWorkSessionsForPersonPeriod upserts 0-hour assignee for unqualified holiday', async () => {
  const activity = {
    id: 'ACT_STAT',
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    evaluationType: 'attendance',
    visibilityScope: 'school',
    title: 'Stat Holiday Pay',
    departmentId: 'DEPT_1',
    entries: [{
      entryId: 'ENT-ACT_STAT-0001',
      date: '2026-01-01',
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
      period: { id: 'PER_1', startDate: '2026-01-01', endDate: '2026-01-15' },
      activity,
      payItems: [{
        evaluation: { holidayId: 'H1', date: '2026-01-01', title: "New Year's Day" },
        hours: 0
      }],
      reqUser: {}
    });
    assert.equal(outcome.rowCount, 1);
    assert.equal(maintenanceArgs?.payload?.entries?.[0]?.assignees?.[0]?.paidHours, 0);
    assert.match(maintenanceArgs?.payload?.entries?.[0]?.assignees?.[0]?.notes || '', /not qualified/i);
  } finally {
    activityService.isPersonEligibleForActivity = originalEligible;
    activityService.getActivity = originalGetActivity;
    dataService.updateData = originalUpdate;
  }
});

test('ensureStatHolidayDayEntriesForPayItems creates missing holiday day shells', async () => {
  const activity = {
    id: 'ACT_STAT',
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    visibilityScope: 'school',
    title: 'Stat Holiday Pay',
    entries: []
  };
  const originalGetActivity = activityService.getActivity;
  const originalUpdate = dataService.updateData;
  let maintenanceArgs = null;

  activityService.getActivity = async () => ({
    ...activity,
    entries: maintenanceArgs?.payload?.entries || []
  });
  dataService.updateData = async (entityType, id, payload, reqUser, options) => {
    maintenanceArgs = { entityType, id, payload, options };
    return payload;
  };

  try {
    const outcome = await statutoryHolidayWorkSessionService.ensureStatHolidayDayEntriesForPayItems({
      activity,
      payItems: [{
        evaluation: { holidayId: 'H1', date: '2026-01-01', title: "New Year's Day" },
        hours: 0
      }],
      reqUser: {}
    });
    assert.equal(outcome.changed, true);
    assert.equal(outcome.createdEntryIds.length, 1);
    const created = maintenanceArgs?.payload?.entries?.find((entry) => entry.date === '2026-01-01');
    assert.equal(created?.statHolidayId, 'H1');
    assert.equal(created?.startTime, '08:00');
    assert.equal(created?.endTime, '20:00');
    assert.deepEqual(created?.assignees, []);
  } finally {
    activityService.getActivity = originalGetActivity;
    dataService.updateData = originalUpdate;
  }
});

test('materializeStatHolidayForPersonPeriod auto-provisions shells and syncs assignees for both schemes', async () => {
  const originalLeave = leaveRequestService.getApprovedLeaveEventsForPerson;
  const originalHistory = timesheetWorkdayHistoryService.buildWorkdayHistory;
  const originalResolveActivity = timesheetLegacyImportService.resolvePublicStatHolidayActivity;
  const originalEligible = activityService.isPersonEligibleForActivity;
  const originalGetActivity = activityService.getActivity;
  const originalUpdate = dataService.updateData;
  const activityStore = new Map([
    ['ACT_EQ', { id: 'ACT_EQ', orgId: 'ORG_1', status: 'posted', paid: true, evaluationType: 'attendance', visibilityScope: 'school', title: 'Equilibrium Stat', entries: [] }],
    ['ACT_LINC', { id: 'ACT_LINC', orgId: 'ORG_1', status: 'posted', paid: true, evaluationType: 'attendance', visibilityScope: 'school', title: 'LINC Stat', entries: [] }]
  ]);
  const updateCalls = [];

  leaveRequestService.getApprovedLeaveEventsForPerson = async () => [];
  timesheetWorkdayHistoryService.buildWorkdayHistory = async () => new timesheetWorkdayHistoryService.WorkdayHistory();
  timesheetLegacyImportService.resolvePublicStatHolidayActivity = async ({ activityId }) => {
    const key = String(activityId || '').trim();
    return activityStore.get(key) || activityStore.get('ACT_EQ');
  };
  activityService.isPersonEligibleForActivity = () => true;
  activityService.getActivity = async (activityId) => {
    const key = String(activityId || '').trim();
    const row = activityStore.get(key);
    return row ? { ...row, entries: [...row.entries] } : null;
  };
  dataService.updateData = async (entityType, id, payload) => {
    updateCalls.push({ entityType, id });
    const key = String(id || '').trim();
    if (activityStore.has(key)) {
      activityStore.set(key, { ...activityStore.get(key), entries: payload.entries || [] });
    }
    return payload;
  };

  try {
    const outcome = await statutoryHolidayWorkSessionService.materializeStatHolidayForPersonPeriod({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      personName: 'Teacher',
      personRole: 'teacher',
      period: { id: 'PER_1', startDate: '2020-01-01', endDate: '2020-01-15' },
      policy: {
        statutoryHolidayPay: {
          enabled: true,
          schemes: {
            equilibrium_school: { id: 'equilibrium_school', activityId: 'ACT_EQ' },
            linc: { id: 'linc', activityId: 'ACT_LINC', hourMode: 'most_recent' }
          },
          departmentSchemeAssignments: { DEPT_LINC: 'linc' },
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
        date: '2020-01-01',
        title: "New Year's Day",
        type: 'National Holiday'
      }],
      periodEntries: [{
        date: '2020-01-08',
        deliveryDepartmentId: 'DEPT_LINC',
        hours: 6,
        timesheetHours: 6
      }],
      reqUser: {},
      persistToActivity: true
    });
    assert.equal(outcome.blockingErrors?.length || 0, 0);
    assert.equal(outcome.rows.length, 2);
    assert.equal(outcome.syncOutcomes?.length, 2);
    assert.ok(updateCalls.length >= 2);
    const eqEntry = activityStore.get('ACT_EQ')?.entries?.find((entry) => entry.date === '2020-01-01');
    const lincEntry = activityStore.get('ACT_LINC')?.entries?.find((entry) => entry.date === '2020-01-01');
    assert.equal(eqEntry?.assignees?.length, 1);
    assert.equal(eqEntry?.assignees?.[0]?.paidHours, 0);
    assert.equal(lincEntry?.assignees?.length, 1);
    assert.equal(lincEntry?.assignees?.[0]?.paidHours, 6);
    assert.equal(lincEntry?.assignees?.[0]?.statHolidaySchemeId, 'linc');
  } finally {
    leaveRequestService.getApprovedLeaveEventsForPerson = originalLeave;
    timesheetWorkdayHistoryService.buildWorkdayHistory = originalHistory;
    timesheetLegacyImportService.resolvePublicStatHolidayActivity = originalResolveActivity;
    activityService.isPersonEligibleForActivity = originalEligible;
    activityService.getActivity = originalGetActivity;
    dataService.updateData = originalUpdate;
  }
});

test('syncStatHolidayWorkSessionsForPersonPeriod blocks when mapped day entry is missing', async () => {
  const activity = {
    id: 'ACT_STAT',
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    evaluationType: 'attendance',
    visibilityScope: 'school',
    title: 'Stat Holiday Pay',
    departmentId: 'DEPT_1',
    entries: []
  };
  const originalEligible = activityService.isPersonEligibleForActivity;
  const originalGetActivity = activityService.getActivity;
  const originalUpdate = dataService.updateData;
  let updateCalled = false;

  activityService.isPersonEligibleForActivity = () => true;
  activityService.getActivity = async () => ({ ...activity, entries: [] });
  dataService.updateData = async (...args) => {
    updateCalled = true;
    return args[2];
  };

  try {
    const outcome = await statutoryHolidayWorkSessionService.syncStatHolidayWorkSessionsForPersonPeriod({
      orgId: 'ORG_1',
      personId: 'PERSON_1',
      personName: 'Teacher',
      personRole: 'teacher',
      period: { id: 'PER_1', startDate: '2026-01-01', endDate: '2026-01-15' },
      activity,
      payItems: [{
        evaluation: { holidayId: 'H1', date: '2026-01-01', title: "New Year's Day" },
        hours: 0
      }],
      reqUser: {}
    });
    assert.equal(outcome.blocked, true);
    assert.equal(outcome.missingDayEntries?.length, 1);
    assert.equal(outcome.missingDayEntries?.[0]?.holidayId, 'H1');
    assert.equal(updateCalled, false);
  } finally {
    activityService.isPersonEligibleForActivity = originalEligible;
    activityService.getActivity = originalGetActivity;
    dataService.updateData = originalUpdate;
  }
});

test('collectMissingStatHolidayDayEntries and buildStatHolidayBlockingErrors describe missing sessions', () => {
  const missing = statutoryHolidayWorkSessionService.collectMissingStatHolidayDayEntries([], [{
    evaluation: { holidayId: 'H1', date: '2026-01-01', title: "New Year's Day" },
    hours: 0
  }]);
  assert.equal(missing.length, 1);
  const errors = statutoryHolidayWorkSessionService.buildStatHolidayBlockingErrors(missing);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Map holiday day work sessions in Settings/i);
});

test('dedupeStatHolidayActivitySessionsForPerson keeps highest-hours row per statHolidayId and date', () => {
  const rows = [
    { sessionId: 'act-1', statHolidayId: 'H1', date: '2026-02-16', hours: 60, timesheetHours: 60 },
    { sessionId: 'act-2', statHolidayId: 'H1', date: '2026-02-16', hours: 6, timesheetHours: 6 },
    { sessionId: 'act-3', statHolidayId: 'H2', date: '2026-03-01', hours: 8, timesheetHours: 8 },
    { sessionId: 'act-regular', date: '2026-03-02', hours: 2, timesheetHours: 2 }
  ];
  const deduped = activityService.dedupeStatHolidayActivitySessionsForPerson(rows);
  assert.equal(deduped.length, 3);
  const familyDay = deduped.find((row) => row.statHolidayId === 'H1');
  assert.equal(familyDay.sessionId, 'act-1');
  assert.equal(familyDay.hours, 60);
});
