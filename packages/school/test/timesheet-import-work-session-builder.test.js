'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const builder = require('../MVC/services/school/timesheetImportWorkSessionBuilderService');

const ACTIVITY = {
  id: 'ACT_IMPORT',
  orgId: 'ORG_1',
  status: 'posted',
  paid: true,
  evaluationType: 'attendance',
  title: 'Import Activity'
};

test('stackCompiledRowsByDate stacks start and end times within each day', () => {
  const stacked = builder.stackCompiledRowsByDate([
    { date: '2026-03-01', hours: 2, className: 'A' },
    { date: '2026-03-01', hours: 1.5, className: 'B' },
    { date: '2026-03-02', hours: 3, className: 'C' }
  ]);

  assert.equal(stacked.length, 3);
  assert.equal(stacked[0].startTime, '00:00');
  assert.equal(stacked[0].endTime, '02:00');
  assert.equal(stacked[1].startTime, '02:00');
  assert.equal(stacked[1].endTime, '03:30');
  assert.equal(stacked[2].startTime, '00:00');
  assert.equal(stacked[2].endTime, '03:00');
});

test('stackCompiledRowsByDate chains three same-day rows from 00:00', () => {
  const stacked = builder.stackCompiledRowsByDate([
    { date: '2026-01-09', hours: 3, className: 'ELA', sourceRowNumber: 10 },
    { date: '2026-01-09', hours: 4, className: 'LINC', sourceRowNumber: 11 },
    { date: '2026-01-09', hours: 1, className: 'ELA One on One', sourceRowNumber: 12 }
  ]);

  assert.equal(stacked.length, 3);
  assert.equal(stacked[0].className, 'ELA');
  assert.equal(stacked[0].startTime, '00:00');
  assert.equal(stacked[0].endTime, '03:00');
  assert.equal(stacked[1].className, 'LINC');
  assert.equal(stacked[1].startTime, '03:00');
  assert.equal(stacked[1].endTime, '07:00');
  assert.equal(stacked[2].className, 'ELA One on One');
  assert.equal(stacked[2].startTime, '07:00');
  assert.equal(stacked[2].endTime, '08:00');
});

test('stackCompiledRowsByDate normalizes mixed date formats on the same day', () => {
  const stacked = builder.stackCompiledRowsByDate([
    { date: '2026-01-09', hours: 2, className: 'A', sourceRowNumber: 1 },
    { date: '2026-01-09T00:00:00.000Z', hours: 1, className: 'B', sourceRowNumber: 2 }
  ]);

  assert.equal(stacked.length, 2);
  assert.equal(stacked[0].startTime, '00:00');
  assert.equal(stacked[0].endTime, '02:00');
  assert.equal(stacked[1].startTime, '02:00');
  assert.equal(stacked[1].endTime, '03:00');
});

test('stackCompiledRowsByDate reorders same-day rows by sourceRowNumber', () => {
  const stacked = builder.stackCompiledRowsByDate([
    { date: '2026-01-09', hours: 1, className: 'Third', sourceRowNumber: 30 },
    { date: '2026-01-09', hours: 2, className: 'First', sourceRowNumber: 10 },
    { date: '2026-01-09', hours: 1.5, className: 'Second', sourceRowNumber: 20 }
  ]);

  assert.deepEqual(stacked.map((row) => row.className), ['First', 'Second', 'Third']);
  assert.equal(stacked[0].startTime, '00:00');
  assert.equal(stacked[0].endTime, '02:00');
  assert.equal(stacked[1].startTime, '02:00');
  assert.equal(stacked[1].endTime, '03:30');
  assert.equal(stacked[2].startTime, '03:30');
  assert.equal(stacked[2].endTime, '04:30');
});

test('stackCompiledRowsByDate rejects more than 24 hours on one day', () => {
  assert.throws(
    () => builder.stackCompiledRowsByDate([
      { date: '2026-01-09', hours: 12, sourceRowNumber: 1 },
      { date: '2026-01-09', hours: 13, sourceRowNumber: 2 }
    ]),
    /exceeds 24 hours in one day/
  );
});

test('buildCompletedAssignee marks attendance activities attended', () => {
  const assignee = builder.buildCompletedAssignee({
    activity: ACTIVITY,
    personId: 'PERSON_1',
    personRole: 'teacher',
    hours: 2,
    notes: 'Notes'
  });
  assert.equal(assignee.status, 'attended');
  assert.equal(assignee.paidHours, 2);
  assert.deepEqual(assignee.roles, ['teacher']);
});

test('buildCompletedAssignee marks completion activities completed', () => {
  const assignee = builder.buildCompletedAssignee({
    activity: { ...ACTIVITY, evaluationType: 'completion' },
    personId: 'PERSON_1',
    personRole: 'staff',
    hours: 1
  });
  assert.equal(assignee.completionStatus, 'completed');
  assert.equal(assignee.status, 'attended');
  assert.deepEqual(assignee.roles, ['staff']);
});

test('buildImportWorkSessionEntryDrafts stamp import trace metadata', () => {
  const drafts = builder.buildImportWorkSessionEntryDrafts({
    compiledRows: [{ date: '2026-03-01', hours: 2, className: 'Math', comment: 'Prep' }],
    activity: ACTIVITY,
    personId: 'PERSON_1',
    personRole: 'teacher',
    periodId: 'PER_A',
    batchId: 'BATCH_1',
    sourceFileName: 'march.xlsx'
  });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].legacyImportBatchId, 'BATCH_1');
  assert.equal(drafts[0].legacyImportSourceFileName, 'march.xlsx');
  assert.equal(drafts[0].assignees[0].legacyImportBatchId, 'BATCH_1');
  assert.match(drafts[0].notes, /Prep/);
});

test('filterImportWorkSessionsForTarget removes person entries inside period dates', () => {
  const entries = [
    {
      date: '2026-01-15',
      durationHours: 30,
      assignees: [{ personId: 'PERSON_1', paidHours: 30 }]
    },
    {
      date: '2026-01-09',
      durationHours: 6,
      assignees: [{ personId: 'PERSON_1', paidHours: 6 }]
    },
    {
      date: '2026-01-15',
      durationHours: 6,
      assignees: [{ personId: 'PERSON_2', paidHours: 6 }]
    }
  ];
  const kept = builder.filterImportWorkSessionsForTarget(entries, ACTIVITY, {
    personId: 'PERSON_1',
    periodStartDate: '2026-01-01',
    periodEndDate: '2026-01-15'
  });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].assignees[0].personId, 'PERSON_2');
});

test('isImportWorkSessionEntryForTarget ignores entries outside period dates', () => {
  assert.equal(builder.isImportWorkSessionEntryForTarget({
    date: '2025-12-31',
    assignees: [{ personId: 'PERSON_1', status: 'attended', paid: true, paidHours: 6 }]
  }, ACTIVITY, {
    personId: 'PERSON_1',
    periodStartDate: '2026-01-01',
    periodEndDate: '2026-01-15'
  }), false);
});

test('isImportWorkSessionEntryForTarget matches legacyImportPersonId without assignee eligibility', () => {
  assert.equal(builder.isImportWorkSessionEntryForTarget({
    date: '2026-01-09',
    legacyImportPersonId: 'PERSON_1',
    legacyImportPeriodId: 'PER_A',
    assignees: [{ personId: 'PERSON_1', status: 'attended', completionStatus: 'pending' }]
  }, { ...ACTIVITY, evaluationType: 'completion' }, {
    personId: 'PERSON_1',
    periodId: 'PER_A',
    periodStartDate: '2026-01-01',
    periodEndDate: '2026-01-15'
  }), true);
});

test('countOrphanImportWorkSessionsByPerson groups stamped sessions by person', async () => {
  const activityService = require('../MVC/services/school/activityService');
  const originalGetActivity = activityService.getActivity;
  activityService.getActivity = async () => ({
    id: 'ACT_IMPORT',
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    entries: [
      {
        date: '2026-01-09',
        legacyImportPersonId: 'PERSON_1',
        legacyImportPeriodId: 'PER_A',
        assignees: [{ personId: 'PERSON_1', status: 'attended', paid: true }]
      },
      {
        date: '2026-01-10',
        legacyImportPersonId: 'PERSON_1',
        legacyImportPeriodId: 'PER_A',
        assignees: [{ personId: 'PERSON_1', status: 'attended', paid: true }]
      },
      {
        date: '2026-01-11',
        legacyImportPersonId: 'PERSON_2',
        legacyImportPeriodId: 'PER_A',
        assignees: [{ personId: 'PERSON_2', status: 'attended', paid: true }]
      }
    ]
  });
  try {
    const counts = await builder.countOrphanImportWorkSessionsByPerson({
      orgId: 'ORG_1',
      periodId: 'PER_A',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-01-15',
      importActivityId: 'ACT_IMPORT',
      reqUser: {}
    });
    assert.equal(counts.get('PERSON_1'), 2);
    assert.equal(counts.get('PERSON_2'), 1);
  } finally {
    activityService.getActivity = originalGetActivity;
  }
});

test('activityQualifiesForImportCleanup matches import-titled activities', () => {
  assert.equal(builder.activityQualifiesForImportCleanup({
    id: 'ACT_OLD',
    title: 'Historical Timesheet Import 2026'
  }, [], 'ACT_NEW'), true);
});

test('buildImportActivitySessionIds builds act session ids', () => {
  const ids = builder.buildImportActivitySessionIds({
    activityId: '566641',
    personId: '526625',
    entryIds: ['ENT-566641-0007']
  });
  assert.equal(ids.has('act-566641-ENT-566641-0007-526625'), true);
});

test('passesImportActivitySessionGuard excludes orphan import activity sessions', () => {
  const liveAssembly = require('../MVC/services/school/timesheetLiveAssemblyService');
  const allowed = new Set(['act-566641-ENT-566641-0007-526625']);
  assert.equal(liveAssembly.passesImportActivitySessionGuard({
    sessionId: 'act-566641-ENT-566641-0006-526625',
    className: 'Historical Timesheet Import 2026: LINC',
    hours: 30
  }, {
    activityId: 'ACT_NEW',
    personId: '526625',
    allowedSessionIds: allowed
  }), false);
  assert.equal(liveAssembly.passesImportActivitySessionGuard({
    sessionId: 'act-566641-ENT-566641-0007-526625',
    className: 'Historical Timesheet Import 2026: LINC',
    hours: 6
  }, {
    activityId: 'ACT_NEW',
    personId: '526625',
    allowedSessionIds: allowed
  }), true);
});

test('parseActivityEntryIdFromSessionId extracts entry id from act session id', () => {
  assert.equal(builder.parseActivityEntryIdFromSessionId(
    'act-566641-ENT-566641-0007-526625',
    { activityId: '566641', personId: '526625' }
  ), 'ENT-566641-0007');
});

test('extractActivityEntryIdsFromTimesheetEntries collects act entry ids', () => {
  const ids = builder.extractActivityEntryIdsFromTimesheetEntries([
    { sessionId: 'act-ACT_IMPORT-ENT-1-PERSON_1' },
    { sessionId: 'stat-holiday-2026-03-10' }
  ], { activityId: 'ACT_IMPORT', personId: 'PERSON_1' });
  assert.deepEqual(ids, ['ENT-1']);
});

test('buildImportWorkSessionEntryDrafts carries stacked titles and clock times', () => {
  const drafts = builder.buildImportWorkSessionEntryDrafts({
    compiledRows: [
      { date: '2026-01-09', hours: 3, className: 'ELA', sourceRowNumber: 1 },
      { date: '2026-01-09', hours: 4, className: 'LINC', sourceRowNumber: 2 },
      { date: '2026-01-09', hours: 1, className: 'ELA One on One', sourceRowNumber: 3 }
    ],
    activity: ACTIVITY,
    personId: 'PERSON_1',
    personRole: 'teacher',
    periodId: 'PER_A',
    batchId: 'BATCH_1',
    sourceFileName: 'january.xlsx'
  });

  assert.equal(drafts.length, 3);
  assert.equal(drafts[0].title, 'ELA');
  assert.equal(drafts[0].startTime, '00:00');
  assert.equal(drafts[0].endTime, '03:00');
  assert.equal(drafts[1].title, 'LINC');
  assert.equal(drafts[1].startTime, '03:00');
  assert.equal(drafts[1].endTime, '07:00');
  assert.equal(drafts[2].title, 'ELA One on One');
  assert.equal(drafts[2].startTime, '07:00');
  assert.equal(drafts[2].endTime, '08:00');
  assert.equal(drafts[2].durationHours, 1);
});

test('recomputeActivityLockedFromEntries clears legacy summary fields when import sessions are removed', () => {
  const activityService = require('../MVC/services/school/activityService');
  const activity = {
    id: '566641',
    title: 'Historical Timesheet Import 2026',
    date: '2026-01-09',
    startTime: '00:00',
    endTime: '06:00',
    durationHours: 30,
    totalDurationHours: 30,
    entries: [{
      entryId: 'ENT-1',
      date: '2026-01-09',
      durationHours: 30,
      assignees: [{ personId: '526625', paidHours: 30, status: 'attended' }]
    }]
  };

  const payload = builder.recomputeActivityLockedFromEntries(activity, []);

  assert.deepEqual(payload.entries, []);
  assert.equal(payload.durationHours, 0);
  assert.equal(payload.totalDurationHours, 0);
  assert.equal(payload.date, '');
  assert.deepEqual(activityService.getActivityEntries(payload), []);
});
