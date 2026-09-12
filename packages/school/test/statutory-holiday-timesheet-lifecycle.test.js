'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const timesheetParametersPolicyService = require('../MVC/services/school/timesheetParametersPolicyService');
const statutoryHolidayTimesheetLifecycleService = require('../MVC/services/school/statutoryHolidayTimesheetLifecycleService');
const statutoryHolidayWorkSessionService = require('../MVC/services/school/statutoryHolidayWorkSessionService');
const statutoryHolidayEligibilityService = require('../MVC/services/school/statutoryHolidayEligibilityService');

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

test('mergeStatHolidayRowsIntoEntries prefers incoming client override over stale DB snapshot', () => {
  const merged = statutoryHolidayTimesheetLifecycleService.mergeStatHolidayRowsIntoEntries({
    entries: [
      { sessionId: 'act-1' },
      {
        sessionId: 'stathol-H1-P1',
        isStatutoryHoliday: true,
        statHolidayOverride: { hours: 8, reason: 'Manager adjusted' }
      }
    ],
    statHolidayRows: [{
      sessionId: 'stathol-H1-P1',
      isStatutoryHoliday: true,
      hours: 6,
      statHolidayMeta: { holidayId: 'H1', calculatedHours: 6 }
    }],
    usesActivityMode: false,
    existingEntriesBySessionId: new Map([
      ['stathol-H1-P1', {
        sessionId: 'stathol-H1-P1',
        statHolidayOverride: { hours: 6, reason: 'Old override' }
      }]
    ])
  });
  const statRow = merged.find((row) => row.sessionId === 'stathol-H1-P1');
  assert.equal(statRow.statHolidayOverride.hours, 8);
  assert.equal(statRow.statHolidayOverride.reason, 'Manager adjusted');
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
  const originalClearAttendees = statutoryHolidayWorkSessionService.clearStatHolidayActivityLevelAttendees;
  let removeCalls = 0;
  let clearAttendeeCalls = 0;
  statutoryHolidayWorkSessionService.removeStatHolidayWorkSessionsForTarget = async () => {
    removeCalls += 1;
    return { removedAssignees: 2, removedEntries: 0 };
  };
  statutoryHolidayWorkSessionService.clearStatHolidayActivityLevelAttendees = async () => {
    clearAttendeeCalls += 1;
    return { cleared: true };
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
    assert.equal(clearAttendeeCalls, 1);
    assert.equal(outcome.entries.length, 1);
    assert.equal(outcome.removedAssignees, 2);
  } finally {
    statutoryHolidayWorkSessionService.removeStatHolidayWorkSessionsForTarget = originalRemove;
    statutoryHolidayWorkSessionService.clearStatHolidayActivityLevelAttendees = originalClearAttendees;
  }
});

test('import assembly no longer materializes statutory holiday rows', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../MVC/services/school/timesheetLiveAssemblyService.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /materializeStatHolidayForPersonPeriod/);
});

test('timesheet editor save payload includes statutory holiday override fields', () => {
  const editorSource = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/timesheet/timesheetEditor.ejs'),
    'utf8'
  );
  assert.match(editorSource, /if \(e\.statHolidayOverride\) \{[\s\S]*row\.statHolidayOverride = e\.statHolidayOverride/);
  assert.match(editorSource, /if \(e\.statHolidayMeta\) row\.statHolidayMeta = e\.statHolidayMeta/);
  assert.match(editorSource, /btnStatHolidayCalcAdjust/);
});

test('timesheet editor restores saved statutory holiday overrides and linked activity rows', () => {
  const editorSource = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/timesheet/timesheetEditor.ejs'),
    'utf8'
  );
  assert.match(editorSource, /savedStatHolidayBySessionId/);
  assert.match(editorSource, /rehydrateSavedStatHolidayEntries/);
  assert.match(editorSource, /resolveStatHolidayOverrideHours/);
  assert.match(editorSource, /ensureLinkedActivityStatHolidayEntry/);
  assert.match(editorSource, /statHolidayOverrideModal\?\.hide\(\)/);
  assert.match(editorSource, /statHolidaySavedStateHydrated/);
});

test('timesheet editor supports manager edits for unqualified statutory holidays', () => {
  const editorSource = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/timesheet/timesheetEditor.ejs'),
    'utf8'
  );
  assert.match(editorSource, /function resolveOrEnsureStatHolidayActiveEntry/);
  assert.match(editorSource, /resolveOrEnsureStatHolidayActiveEntry\(sessionId\)/);
  assert.match(editorSource, /buildStatHolidayManagerActionButtonsHtml/);
  assert.match(editorSource, /holidayOnlyActBtns[\s\S]*buildStatHolidayManagerActionButtonsHtml/);
  assert.match(editorSource, /onclick="openStatHolidayOverrideModal\('\$\{safeSessionId\}'\)"/);
  assert.match(editorSource, /buildStatHolidayMetadataSessionId/);
  assert.match(editorSource, /id="statHolidayOverrideHours"/);
});

test('timesheet editor calculation modal supports compact reasons-only view and override copy', () => {
  const editorSource = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/timesheet/timesheetEditor.ejs'),
    'utf8'
  );
  assert.match(editorSource, /function shouldShowStatHolidayCalculationSteps/);
  assert.match(editorSource, /function hasStatHolidayManagerOverrideEffect/);
  assert.match(editorSource, /function buildStatHolidayOverrideNoticeHtml/);
  assert.match(editorSource, /payBlockedReason === 'exceeds_max_payable_hours'/);
  assert.match(editorSource, /if \(!showCalculationSteps && !qualified\)/);
  assert.match(editorSource, /stepsEl\.classList\.add\('d-none'\)/);
  assert.match(editorSource, /buildStatHolidayOverrideNoticeHtml\(override, payableHoursNum\)/);
  assert.match(editorSource, /Manager adjustment:<\/strong> Payable hours set to/);
  assert.match(editorSource, /Manager decision:<\/strong> Statutory holiday pay was disqualified/);
  assert.doesNotMatch(editorSource, /forced\/adjusted statutory pay/);
});

test('timesheet editor status chip resolves metadata session for calculation modal', () => {
  const editorSource = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/timesheet/timesheetEditor.ejs'),
    'utf8'
  );
  assert.match(editorSource, /function resolveStatHolidayModalEntry/);
  assert.match(editorSource, /function resolveStatHolidayCalculationModalEntry/);
  assert.match(editorSource, /const entry = resolveStatHolidayCalculationModalEntry\(normalizedSessionId\)/);
  assert.match(editorSource, /function resolveStatHolidayChipSessionId/);
  assert.match(editorSource, /chipSessionId = resolveStatHolidayChipSessionId\(entry\)/);
  assert.match(editorSource, /findStatHolidayMetadataEntryByDate\(entry\?\.date, schemeId, holidayId\)/);
  assert.match(editorSource, /hydrateSavedStatHolidayMetadataIntoActiveEntries/);
  assert.match(editorSource, /const STAT_HOLIDAY_PREVIEW_ROWS/);
  assert.match(editorSource, /function rememberPreviewStatHolidayRows/);
  assert.match(editorSource, /function attachPreviewStatHolidayMetadataToActiveEntries/);
  assert.match(editorSource, /function resolveStatHolidayStoredEntry/);
  assert.match(editorSource, /resolveStatHolidayStoredEntry\(\{ sessionId: normalized \}\)/);
  assert.match(editorSource, /findStatHolidayWarningForContext/);
  assert.match(editorSource, /buildLincStatHolidayCalculationStepsHtml/);
  assert.match(editorSource, /STAT_HOLIDAY_SCHEME_LINC/);
  assert.match(editorSource, /function shouldSuppressStatHolidayMetadataEntry/);
  assert.match(editorSource, /!shouldSuppressStatHolidayMetadataEntry\(e\)/);
  assert.match(editorSource, /function resolveStatHolidayStatusEntriesForDate/);
});

test('timesheet editor uses scheme-strict stat holiday modals and single-scheme override dialog', () => {
  const editorSource = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/timesheet/timesheetEditor.ejs'),
    'utf8'
  );
  assert.match(editorSource, /function resolveStatHolidaySchemeContext/);
  assert.match(editorSource, /function entryMatchesStatHolidayScheme/);
  assert.match(editorSource, /function resolveStatHolidayHolidayId/);
  assert.doesNotMatch(editorSource, /metaByAssigneeKey\.set\(`\$\{holidayId\}\|\$\{date\}`/);
  assert.doesNotMatch(editorSource, /metaByAssigneeKey\.get\(`\$\{holidayId\}\|\$\{date\}`/);
  assert.match(editorSource, /id="statHolidayOverrideHours"/);
  assert.match(editorSource, /applyStatHolidayOverrideToEntry\(metadataEntry, result\.hours, result\.reason\)/);
  assert.doesNotMatch(editorSource, /function listStatHolidaySchemeTargets/);
  assert.doesNotMatch(editorSource, /function applyStatHolidayOverridesForHoliday/);
  assert.doesNotMatch(editorSource, /Set hours/);
  assert.match(editorSource, /if \(targetSchemeId\) \{[\s\S]*return rows\.find/);
  assert.match(editorSource, /schemeCandidates = targetSchemeId[\s\S]*\? \[targetSchemeId\]/);
  assert.match(editorSource, /findStatHolidayMetadataEntryByDate\(entry\?\.date, entrySchemeId, resolveStatHolidayHolidayId\(entry\)\)/);
  assert.match(editorSource, /function hydrateStatHolidayActivityRowsFromPreview/);
  assert.match(editorSource, /function hydrateStatHolidayFieldsFromLiveSessions/);
});

test('timesheet editor department totals skip activity-mode statutory holiday metadata rows', () => {
  const editorSource = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/timesheet/timesheetEditor.ejs'),
    'utf8'
  );
  assert.match(editorSource, /renderDepartmentTotals[\s\S]*shouldSuppressStatHolidayMetadataEntry\(entry\)/);
  assert.match(editorSource, /renderDepartmentTotals[\s\S]*resolveTimesheetRowHours\(entry\)/);
  assert.match(editorSource, /applyStatHolidayOverrideToEntry[\s\S]*STATUTORY_HOLIDAY_USES_ACTIVITY[\s\S]*metadataEntry\.hours = 0/);
});

test('timesheet editor enriches activity rows with preview statutory holiday metadata', () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/timesheetController.js'),
    'utf8'
  );
  assert.match(controllerSource, /function supplementHolidaysFromActivitySessions/);
  assert.match(controllerSource, /function enrichLiveSessionsWithStatHolidayMeta/);
  assert.match(controllerSource, /statHolidayPreviewRows/);
  assert.match(controllerSource, /holidaysForStatHolidayPreview/);
  assert.match(controllerSource, /buildStatHolidayMetadataRowsForActivitySessions/);
});

test('buildStatHolidayMetadataRowsFromEvaluations builds metadata rows for activity sessions', () => {
  const rows = statutoryHolidayEligibilityService.buildStatHolidayMetadataRowsFromEvaluations({
    evaluations: [{
      holidayId: '797275',
      date: '2026-01-01',
      title: "New Year's Day",
      qualified: true,
      calculatedHours: 7.5,
      checks: { minWorkdays: { pass: true, actual: 40, required: 30 } },
      disqualifyReasons: []
    }],
    personId: '526625',
    activitySessions: [{
      sessionId: 'act-353390-ENT-353390-0010-526625',
      date: '2026-01-01',
      statHolidayId: '797275',
      className: "New Year's Day"
    }]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionId, 'stathol-797275-526625');
  assert.equal(rows[0].statHolidayMeta.holidayId, '797275');
  assert.ok(rows[0].statHolidayMeta.checks);
});

test('timesheet editor skips statutory holiday preview for draft timesheets', () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/timesheetController.js'),
    'utf8'
  );
  assert.match(controllerSource, /isDraftTimesheet/);
  assert.match(controllerSource, /if \(!isDraftTimesheet\) \{[\s\S]*previewStatHolidayForTimesheet/);
  assert.doesNotMatch(controllerSource, /!useFrozenSnapshot && !isDraftTimesheet/);
  assert.match(controllerSource, /statHolidayPreviewOnly:\s*status === 'draft'/);

  const editorSource = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/timesheet/timesheetEditor.ejs'),
    'utf8'
  );
  assert.match(editorSource, /STAT_HOLIDAY_PREVIEW_ONLY[\s\S]*renderStatHolidayWarningsPanel/);
  assert.match(editorSource, /if \(STAT_HOLIDAY_PREVIEW_ONLY\) \{\s*panel\.classList\.add\('d-none'\)/);
  assert.match(editorSource, /STAT_HOLIDAY_PREVIEW_ONLY && isStatHolidayRelatedEntry\(ls\)/);
  assert.match(editorSource, /openStatHolidayCalculationModal[\s\S]*if \(STAT_HOLIDAY_PREVIEW_ONLY\) return/);
});

test('saveTimesheet applies statutory holiday override hours to activity rows', () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/timesheetController.js'),
    'utf8'
  );
  assert.match(controllerSource, /statHolidayOverrideBySchemeHoliday/);
  assert.match(controllerSource, /allowStatHolidayOverride && statHolidayOverride/);
});

test('saveTimesheet skips prior-period reconciliation gate on reviewer edits', () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/timesheetController.js'),
    'utf8'
  );
  assert.match(controllerSource, /if \(nextStatus === 'submitted' && !reviewerEdit\) \{[\s\S]*resolvePriorReconciliationContext/);
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
