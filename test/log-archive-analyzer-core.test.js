'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const analyzerCore = require('../MVC/services/logArchive/logArchiveAnalyzerCore');

test('quickFilterZipNames returns overlapping export zips sorted by start date', () => {
  const names = [
    'activity-archive_2026-01-01_2026-03-31_EXP-a.zip',
    'activity-archive_2026-04-01_2026-06-30_EXP-b.zip',
    'other.zip',
    'activity-archive_2026-07-01_2026-09-30_EXP-c.zip'
  ];
  const hits = analyzerCore.quickFilterZipNames(names, '2026-03-15', '2026-06-15');
  assert.equal(hits.length, 2);
  assert.equal(hits[0].exportId, 'EXP-a');
  assert.equal(hits[1].exportId, 'EXP-b');
});

test('mergeArchivePayloads dedupes logs by id', () => {
  const merged = analyzerCore.mergeArchivePayloads([
    {
      manifest: { exportId: 'EXP-1', range: { startDate: '2026-01-01', endDate: '2026-01-31' }, timezone: 'UTC' },
      logs: [{ id: 'L1', timestamp: '2026-01-10T10:00:00.000Z', sectionId: 'S', operationId: 'O', status: 'success' }],
      actionStates: [],
      refs: { sections: [{ id: 'S', name: 'Sec' }], operations: [{ id: 'O', name: 'Op' }] }
    },
    {
      manifest: { exportId: 'EXP-2', range: { startDate: '2026-02-01', endDate: '2026-02-28' }, timezone: 'UTC' },
      logs: [
        { id: 'L1', timestamp: '2026-01-10T10:00:00.000Z', sectionId: 'S', operationId: 'O', status: 'success' },
        { id: 'L2', timestamp: '2026-02-10T10:00:00.000Z', sectionId: 'S', operationId: 'O', status: 'success' }
      ],
      actionStates: [],
      refs: { sections: [], operations: [] }
    }
  ]);
  assert.equal(merged.logs.length, 2);
  assert.equal(merged.manifest.mergedFrom.length, 2);
});

test('filterSourceRecords applies date and user filters', () => {
  const logs = [
    { id: 'L1', timestamp: '2026-04-10T10:00:00.000Z', userId: 'U1', sectionId: 'S', operationId: 'O', status: 'success' },
    { id: 'L2', timestamp: '2026-05-10T10:00:00.000Z', userId: 'U2', sectionId: 'S', operationId: 'O', status: 'success' }
  ];
  const filtered = analyzerCore.filterSourceRecords({
    logs,
    actionStates: [],
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    timezone: 'UTC',
    userIds: ['U1']
  });
  assert.equal(filtered.logs.length, 1);
  assert.equal(filtered.logs[0].id, 'L1');
});

test('exceedsEventLimit compares against maxMergeLimit', () => {
  assert.equal(analyzerCore.exceedsEventLimit(5001, 5000), true);
  assert.equal(analyzerCore.exceedsEventLimit(5000, 5000), false);
});

test('truncateRecordsToLimit keeps earliest logs and shortens effective end date', () => {
  const logs = [
    { id: 'L3', timestamp: '2026-03-15T12:00:00.000Z', sectionId: 'S', operationId: 'O', status: 'success' },
    { id: 'L1', timestamp: '2026-01-10T10:00:00.000Z', sectionId: 'S', operationId: 'O', status: 'success' },
    { id: 'L2', timestamp: '2026-02-10T10:00:00.000Z', sectionId: 'S', operationId: 'O', status: 'success' }
  ];
  const actionStates = [
    { id: 'A1', startedAt: '2026-01-11T10:00:00.000Z', userId: 'U1' },
    { id: 'A2', startedAt: '2026-03-20T10:00:00.000Z', userId: 'U1' }
  ];
  const result = analyzerCore.truncateRecordsToLimit({
    logs,
    actionStates,
    limit: 2,
    timezone: 'UTC',
    requestedStartDate: '2026-01-01',
    requestedEndDate: '2026-09-19'
  });
  assert.equal(result.truncated, true);
  assert.equal(result.matchedCount, 3);
  assert.equal(result.logs.length, 2);
  assert.equal(result.logs[0].id, 'L1');
  assert.equal(result.logs[1].id, 'L2');
  assert.equal(result.effectiveStartDate, '2026-01-10');
  assert.equal(result.effectiveEndDate, '2026-02-10');
  assert.equal(result.actionStates.length, 1);
  assert.equal(result.actionStates[0].id, 'A1');
});

test('truncateRecordsToLimit leaves data unchanged when under limit', () => {
  const logs = [
    { id: 'L1', timestamp: '2026-04-10T10:00:00.000Z', sectionId: 'S', operationId: 'O', status: 'success' }
  ];
  const result = analyzerCore.truncateRecordsToLimit({
    logs,
    actionStates: [{ id: 'A1', startedAt: '2026-04-11T10:00:00.000Z' }],
    limit: 5000,
    timezone: 'UTC',
    requestedStartDate: '2026-04-01',
    requestedEndDate: '2026-04-30'
  });
  assert.equal(result.truncated, false);
  assert.equal(result.logs.length, 1);
  assert.equal(result.effectiveStartDate, '2026-04-01');
  assert.equal(result.effectiveEndDate, '2026-04-30');
  assert.equal(result.actionStates.length, 1);
});

test('countTimelineEvents matches buildTimelineEvents length', () => {
  const manifest = { exportId: 'EXP-1' };
  const logs = [
    { id: 'L1', timestamp: '2026-04-10T10:00:00.000Z', userId: 'U1', sectionId: 'S1', operationId: 'OP1', status: 'success', details: {} }
  ];
  const refs = { sections: [{ id: 'S1', name: 'Section' }], operations: [{ id: 'OP1', name: 'SAVE' }] };
  const events = analyzerCore.buildTimelineEvents(manifest, logs, [], refs);
  assert.equal(analyzerCore.countTimelineEvents(manifest, logs, [], refs), events.length);
});
