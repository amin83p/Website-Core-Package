'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArchiveZipFileName,
  dateKeysOverlap,
  userRangeExtendsBeyondManifest,
  resolveArchiveRangeBoundsMs,
  timestampInArchiveRange,
  isActivityArchiveZipName
} = require('../MVC/services/logArchive/logArchiveRangeUtils');

test('parseArchiveZipFileName parses export file pattern', () => {
  const parsed = parseArchiveZipFileName('activity-archive_2026-04-29_2026-11-01_EXP-1793644720177-25vrcx.zip');
  assert.equal(parsed.startDate, '2026-04-29');
  assert.equal(parsed.endDate, '2026-11-01');
  assert.equal(parsed.exportId, 'EXP-1793644720177-25vrcx');
});

test('parseArchiveZipFileName rejects unrelated zip names', () => {
  assert.equal(parseArchiveZipFileName('backup.zip'), null);
  assert.equal(isActivityArchiveZipName('logs.zip'), false);
});

test('dateKeysOverlap detects inclusive overlap', () => {
  assert.equal(dateKeysOverlap('2026-05-01', '2026-05-31', '2026-04-29', '2026-05-15'), true);
  assert.equal(dateKeysOverlap('2026-06-01', '2026-06-30', '2026-04-29', '2026-05-15'), false);
});

test('userRangeExtendsBeyondManifest flags partial coverage', () => {
  assert.equal(userRangeExtendsBeyondManifest('2026-05-01', '2026-05-31', '2026-04-29', '2026-05-15'), true);
  assert.equal(userRangeExtendsBeyondManifest('2026-05-01', '2026-05-10', '2026-04-29', '2026-05-15'), false);
});

test('resolveArchiveRangeBoundsMs accepts YYYY-MM-DD keys in org timezone', () => {
  const bounds = resolveArchiveRangeBoundsMs('2026-04-29', '2026-04-30', 'America/Edmonton');
  assert.ok(Number.isFinite(bounds.dayStartMs));
  assert.ok(Number.isFinite(bounds.dayEndMs));
  assert.ok(bounds.dayEndMs > bounds.dayStartMs);
  assert.equal(timestampInArchiveRange('2026-04-29T20:10:06.737Z', bounds), true);
});
