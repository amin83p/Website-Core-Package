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
