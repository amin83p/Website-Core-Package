'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Staging = require('../MVC/services/logArchive/logArchiveStagingCore');

test('createNdjsonChunkWriter splits at maxLines', () => {
  const writer = Staging.createNdjsonChunkWriter({
    maxLines: 3,
    fileNameAtIndex: Staging.logChunkFileName
  });
  const flushed = writer.appendRows([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].fileName, 'logs-000001.ndjson');
  assert.equal(flushed[0].lineCount, 3);
  const done = writer.finish();
  assert.equal(done.flushed.length, 1);
  assert.equal(done.flushed[0].lineCount, 1);
  assert.equal(writer.files.length, 2);
});

test('createBoundsTracker computes effective archive dates', () => {
  const tracker = Staging.createBoundsTracker();
  tracker.add({ timestamp: '2024-06-15T12:00:00.000Z' });
  tracker.add({ timestamp: '2024-06-20T08:00:00.000Z' });
  const snap = tracker.snapshot('UTC', '2024-01-01', '2024-12-31');
  assert.equal(snap.count, 2);
  assert.equal(snap.effectiveStartDate, '2024-06-15');
  assert.equal(snap.effectiveEndDate, '2024-06-20');
});

test('paginateArray respects offset and limit', () => {
  const items = [10, 20, 30, 40, 50];
  assert.deepEqual(Staging.paginateArray(items, 1, 2), [20, 30]);
  assert.deepEqual(Staging.paginateArray(items, 0, 0), items);
});

test('parseNdjsonText skips bad lines', () => {
  const rows = Staging.parseNdjsonText('{"a":1}\nnot-json\n{"b":2}\n');
  assert.deepEqual(rows, [{ a: 1 }, { b: 2 }]);
});
