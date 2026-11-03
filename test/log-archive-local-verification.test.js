'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mergeArchiveCoverage,
  verifyLocalArchiveAgainstDelete
} = require('../MVC/services/logArchive/logArchiveLocalVerificationService');

test('verifyLocalArchiveAgainstDelete rejects missing local proof', () => {
  const result = verifyLocalArchiveAgainstDelete({
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    includeLogs: true,
    includeActionStates: false,
    serverCounts: { logs: 5, actionStates: 0 },
    localVerification: { archives: [] }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'LOCAL_PROOF_REQUIRED');
});

test('verifyLocalArchiveAgainstDelete rejects coverage gap', () => {
  const result = verifyLocalArchiveAgainstDelete({
    startDate: '2026-04-01',
    endDate: '2026-05-31',
    includeLogs: true,
    includeActionStates: false,
    serverCounts: { logs: 2, actionStates: 0 },
    localVerification: {
      archives: [{
        exportId: 'EXP-1',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        counts: { logs: 100, actionStates: 0 }
      }]
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'LOCAL_COVERAGE_GAP');
});

test('verifyLocalArchiveAgainstDelete allows delete subset inside archive range', () => {
  const result = verifyLocalArchiveAgainstDelete({
    startDate: '2026-04-10',
    endDate: '2026-04-20',
    includeLogs: true,
    includeActionStates: true,
    serverCounts: { logs: 3, actionStates: 1 },
    localVerification: {
      archives: [{
        exportId: 'EXP-1',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        counts: { logs: 50, actionStates: 10 }
      }]
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.coveredRange.startDate, '2026-04-01');
  assert.equal(result.coveredRange.endDate, '2026-04-30');
});

test('mergeArchiveCoverage merges multiple archives', () => {
  const merged = mergeArchiveCoverage([
    { exportId: 'A', startDate: '2026-03-01', endDate: '2026-03-31', counts: { logs: 10, actionStates: 1 } },
    { exportId: 'B', startDate: '2026-04-01', endDate: '2026-04-30', counts: { logs: 20, actionStates: 2 } }
  ]);
  assert.equal(merged.coveredRange.startDate, '2026-03-01');
  assert.equal(merged.coveredRange.endDate, '2026-04-30');
  assert.equal(merged.localCounts.logs, 30);
  assert.equal(merged.localCounts.actionStates, 3);
});

test('verifyLocalArchiveAgainstDelete allows delete when ndjson backup attested despite manifest count gap', () => {
  const result = verifyLocalArchiveAgainstDelete({
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    includeLogs: true,
    includeActionStates: false,
    serverCounts: { logs: 40, actionStates: 0 },
    localVerification: {
      archives: [{
        exportId: 'EXP-1',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        counts: { logs: 10, actionStates: 0 },
        hasLogsFile: true,
        hasActionStatesFile: false
      }]
    }
  });
  assert.equal(result.ok, true);
});

test('verifyLocalArchiveAgainstDelete rejects insufficient local log counts', () => {
  const result = verifyLocalArchiveAgainstDelete({
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    includeLogs: true,
    includeActionStates: false,
    serverCounts: { logs: 40, actionStates: 0 },
    localVerification: {
      archives: [{
        exportId: 'EXP-1',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        counts: { logs: 10, actionStates: 0 }
      }]
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'LOCAL_COUNT_INSUFFICIENT');
});
