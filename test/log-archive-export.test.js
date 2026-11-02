'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');

const logArchiveStateService = require('../MVC/services/logArchive/logArchiveStateService');
const logArchiveStatusService = require('../MVC/services/logArchive/logArchiveStatusService');
const {
  ARCHIVE_SCHEMA_VERSION,
  resolveArchiveRangeBoundsMs,
  timestampInArchiveRange
} = require('../MVC/services/logArchive/logArchiveExportService');

test('logArchiveStateService normalizes cursor fields', () => {
  const state = logArchiveStateService.normalizeState({
    lastExportEndDate: '2026-01-15',
    lastExportId: 'EXP-1',
    lastExportCounts: { logs: 3, actionStates: 1 }
  });
  assert.equal(state.lastExportEndDate, '2026-01-15');
  assert.equal(state.lastExportCounts.logs, 3);
});

test('logArchiveStatusService dayAfterDateKey advances calendar day', () => {
  assert.equal(logArchiveStatusService.dayAfterDateKey('2026-01-31'), '2026-02-01');
});

test('archive manifest schema version constant is stable', () => {
  assert.equal(ARCHIVE_SCHEMA_VERSION, 1);
});

test('resolveArchiveRangeBoundsMs accepts YYYY-MM-DD keys in org timezone', () => {
  const bounds = resolveArchiveRangeBoundsMs('2026-04-29', '2026-04-30', 'America/Edmonton');
  assert.ok(Number.isFinite(bounds.dayStartMs));
  assert.ok(Number.isFinite(bounds.dayEndMs));
  assert.ok(bounds.dayEndMs > bounds.dayStartMs);
  assert.equal(
    timestampInArchiveRange('2026-04-29T20:10:06.737Z', bounds),
    true
  );
});

test('sample archive zip layout parses manifest and ndjson', () => {
  const manifest = {
    schemaVersion: 1,
    exportId: 'EXP-test',
    range: { startDate: '2026-03-01', endDate: '2026-03-02' },
    counts: { logs: 1, actionStates: 0 }
  };
  const logsLine = JSON.stringify({
    id: 'L1',
    timestamp: '2026-03-01T10:00:00.000Z',
    sectionId: 'S1',
    operationId: 'OP1',
    userId: 'U1',
    status: 'success',
    details: { method: 'GET', url: '/logs' }
  });
  const zip = new PizZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('logs.ndjson', `${logsLine}\n`);
  zip.file('reference/sections.json', JSON.stringify([{ id: 'S1', name: 'Logs' }]));
  zip.file('reference/operations.json', JSON.stringify([{ id: 'OP1', name: 'READ' }]));
  const out = zip.generate({ type: 'nodebuffer' });
  const read = new PizZip(out);
  const parsedManifest = JSON.parse(read.file('manifest.json').asText());
  assert.equal(parsedManifest.exportId, 'EXP-test');
  const logRows = read.file('logs.ndjson').asText().trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(logRows.length, 1);
  assert.equal(logRows[0].id, 'L1');
});
