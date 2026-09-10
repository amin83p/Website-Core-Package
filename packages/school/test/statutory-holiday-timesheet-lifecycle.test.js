'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const timesheetParametersPolicyService = require('../MVC/services/school/timesheetParametersPolicyService');
const statutoryHolidayTimesheetLifecycleService = require('../MVC/services/school/statutoryHolidayTimesheetLifecycleService');
const statutoryHolidayWorkSessionService = require('../MVC/services/school/statutoryHolidayWorkSessionService');

test('validatePolicyInput requires public activity when statutory holiday pay is enabled', () => {
  assert.throws(() => {
    timesheetParametersPolicyService.validatePolicyInput({
      emptyEnrollmentSessions: 'hide',
      statutoryHolidayPayEnabled: 'true',
      statutoryHolidayActivityId: '',
      payableHolidayType_National_Holiday: 'true',
      payableHolidayType_Observance_Paid: 'true'
    });
  }, /public statutory holiday activity/i);
});

test('stripStatHolidayEntries removes statutory holiday metadata rows', () => {
  const entries = [
    { sessionId: 'act-1', hours: 6 },
    { sessionId: 'stathol-H1-P1', isStatutoryHoliday: true, hours: 6 }
  ];
  const cleaned = statutoryHolidayTimesheetLifecycleService.stripStatHolidayEntries(entries);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].sessionId, 'act-1');
});

test('mergeStatHolidayRowsIntoEntries replaces stale statutory holiday rows', () => {
  const merged = statutoryHolidayTimesheetLifecycleService.mergeStatHolidayRowsIntoEntries({
    entries: [
      { sessionId: 'act-1' },
      { sessionId: 'stathol-H1-P1', isStatutoryHoliday: true, hours: 99 }
    ],
    statHolidayRows: [{
      sessionId: 'stathol-H1-P1',
      isStatutoryHoliday: true,
      hours: 6,
      statHolidayMeta: { holidayId: 'H1', calculatedHours: 6 }
    }],
    usesActivityMode: true,
    existingEntriesBySessionId: new Map()
  });
  assert.equal(merged.length, 2);
  const statRow = merged.find((row) => row.sessionId === 'stathol-H1-P1');
  assert.equal(statRow.hours, 0);
  assert.equal(statRow.statHolidayMeta.holidayId, 'H1');
});

test('assertStatHolidayPayConfigured rejects missing activity id', async () => {
  await assert.rejects(
    () => statutoryHolidayTimesheetLifecycleService.assertStatHolidayPayConfigured({
      orgId: 'ORG_1',
      policy: { statutoryHolidayPay: { enabled: true, activityId: '' } },
      reqUser: { id: 'U1', activeOrgId: 'ORG_1' }
    }),
    /requires a public statutory holiday activity/i
  );
});

test('clearStatHolidayForReturnedTimesheet strips rows and removes activity assignees', async () => {
  const originalRemove = statutoryHolidayWorkSessionService.removeStatHolidayWorkSessionsForTarget;
  let removeCalls = 0;
  statutoryHolidayWorkSessionService.removeStatHolidayWorkSessionsForTarget = async () => {
    removeCalls += 1;
    return { removedAssignees: 2, removedEntries: 0 };
  };
  try {
    const outcome = await statutoryHolidayTimesheetLifecycleService.clearStatHolidayForReturnedTimesheet({
      orgId: 'ORG_1',
      personId: 'P1',
      period: { id: 'PER_1', startDate: '2026-02-01', endDate: '2026-02-28' },
      policy: { statutoryHolidayPay: { enabled: true, activityId: 'ACT_STAT' } },
      reqUser: { id: 'U1' },
      entries: [
        { sessionId: 'act-1' },
        { sessionId: 'stathol-H1-P1', isStatutoryHoliday: true }
      ]
    });
    assert.equal(removeCalls, 1);
    assert.equal(outcome.entries.length, 1);
    assert.equal(outcome.removedAssignees, 2);
  } finally {
    statutoryHolidayWorkSessionService.removeStatHolidayWorkSessionsForTarget = originalRemove;
  }
});

test('import assembly no longer materializes statutory holiday rows', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../MVC/services/school/timesheetLiveAssemblyService.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /materializeStatHolidayForPersonPeriod/);
});

test('previewStatHolidayForTimesheet does not persist to activity', async () => {
  const originalMaterialize = statutoryHolidayWorkSessionService.materializeStatHolidayForPersonPeriod;
  let persistToActivity = null;
  statutoryHolidayWorkSessionService.materializeStatHolidayForPersonPeriod = async (options) => {
    persistToActivity = options.persistToActivity;
    return { rows: [], warnings: [], usesActivityMode: true, syncOutcome: null };
  };
  try {
    await statutoryHolidayTimesheetLifecycleService.previewStatHolidayForTimesheet({
      orgId: 'ORG_1',
      personId: 'P1',
      period: { id: 'PER_1', startDate: '2026-02-01', endDate: '2026-02-28' },
      policy: { statutoryHolidayPay: { enabled: true, activityId: 'ACT_STAT' } },
      reqUser: { id: 'U1' }
    });
    assert.equal(persistToActivity, false);
  } finally {
    statutoryHolidayWorkSessionService.materializeStatHolidayForPersonPeriod = originalMaterialize;
  }
});
