'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const logArchiveDeleteService = require('../MVC/services/logArchive/logArchiveDeleteService');
const logArchiveRangeFetchService = require('../MVC/services/logArchive/logArchiveRangeFetchService');
const logArchiveRangeDeleteService = require('../MVC/services/logArchive/logArchiveRangeDeleteService');

const localProof = {
  archives: [{
    exportId: 'EXP-test',
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    counts: { logs: 100, actionStates: 50 }
  }]
};

test('validateDeleteOptions rejects when no collections selected', () => {
  assert.throws(
    () => logArchiveDeleteService.validateDeleteOptions({
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      includeLogs: false,
      includeActionStates: false
    }),
    (err) => err.code === 'NO_COLLECTIONS'
  );
});

test('deleteArchiveRangeRecords rejects when local counts are insufficient', async () => {
  const originalLogCount = logArchiveRangeFetchService.countLogsForRange;
  const originalStateCount = logArchiveRangeFetchService.countActionStatesForRange;
  logArchiveRangeFetchService.countLogsForRange = async () => 2;
  logArchiveRangeFetchService.countActionStatesForRange = async () => 0;

  try {
    await assert.rejects(
      () => logArchiveDeleteService.deleteArchiveRangeRecords({
        startDate: '2026-04-01',
        endDate: '2026-04-10',
        includeLogs: true,
        includeActionStates: false,
        localVerification: {
          archives: [{
            exportId: 'EXP-1',
            startDate: '2026-04-01',
            endDate: '2026-04-30',
            counts: { logs: 1, actionStates: 0 },
            hasLogsFile: false,
            hasActionStatesFile: false
          }]
        }
      }),
      (err) => err.code === 'LOCAL_COUNT_INSUFFICIENT'
    );
  } finally {
    logArchiveRangeFetchService.countLogsForRange = originalLogCount;
    logArchiveRangeFetchService.countActionStatesForRange = originalStateCount;
  }
});

test('deleteArchiveRangeRecords rejects without local verification payload', async () => {
  await assert.rejects(
    () => logArchiveDeleteService.deleteArchiveRangeRecords({
      startDate: '2026-04-01',
      endDate: '2026-04-10',
      includeLogs: true,
      includeActionStates: false
    }),
    (err) => err.code === 'LOCAL_PROOF_REQUIRED'
  );
});

test('deleteArchiveRangeRecords uses range delete when verification passes', async () => {
  const originalLogCount = logArchiveRangeFetchService.countLogsForRange;
  const originalStateCount = logArchiveRangeFetchService.countActionStatesForRange;
  const originalDeleteLogs = logArchiveRangeDeleteService.deleteLogsForArchiveRange;
  const originalDeleteStates = logArchiveRangeDeleteService.deleteActionStatesForArchiveRange;

  logArchiveRangeFetchService.countLogsForRange = async () => 2;
  logArchiveRangeFetchService.countActionStatesForRange = async () => 1;
  logArchiveRangeDeleteService.deleteLogsForArchiveRange = async () => 2;
  logArchiveRangeDeleteService.deleteActionStatesForArchiveRange = async () => 1;

  try {
    const result = await logArchiveDeleteService.deleteArchiveRangeRecords({
      startDate: '2026-04-01',
      endDate: '2026-04-10',
      includeLogs: true,
      includeActionStates: true,
      localVerification: localProof
    });
    assert.equal(result.deleted.logs, 2);
    assert.equal(result.deleted.actionStates, 1);
    assert.equal(result.verification.ok, true);
  } finally {
    logArchiveRangeFetchService.countLogsForRange = originalLogCount;
    logArchiveRangeFetchService.countActionStatesForRange = originalStateCount;
    logArchiveRangeDeleteService.deleteLogsForArchiveRange = originalDeleteLogs;
    logArchiveRangeDeleteService.deleteActionStatesForArchiveRange = originalDeleteStates;
  }
});

test('previewArchiveRangeDelete returns counts and optional verification', async () => {
  const originalLogs = logArchiveRangeFetchService.countLogsForRange;
  const originalStates = logArchiveRangeFetchService.countActionStatesForRange;
  logArchiveRangeFetchService.countLogsForRange = async () => 1;
  logArchiveRangeFetchService.countActionStatesForRange = async () => 0;

  try {
    const { preview, verification } = await logArchiveDeleteService.previewArchiveRangeDelete({
      startDate: '2026-04-01',
      endDate: '2026-04-05',
      includeLogs: true,
      includeActionStates: false,
      localVerification: localProof
    });
    assert.equal(preview.counts.logs, 1);
    assert.equal(verification.ok, true);
  } finally {
    logArchiveRangeFetchService.countLogsForRange = originalLogs;
    logArchiveRangeFetchService.countActionStatesForRange = originalStates;
  }
});
