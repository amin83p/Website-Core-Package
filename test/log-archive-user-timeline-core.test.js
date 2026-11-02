'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Timeline = require('../MVC/services/logArchive/logArchiveUserTimelineCore');

test('computeCalendarWindows splits report into 3-day windows', () => {
  const windows = Timeline.computeCalendarWindows('2024-06-01', '2024-06-07', 'UTC', 3);
  assert.equal(windows.length, 3);
  assert.deepEqual(windows[0], {
    startDate: '2024-06-01',
    endDate: '2024-06-03',
    startMs: windows[0].startMs,
    endMs: windows[0].endMs
  });
  assert.equal(windows[1].startDate, '2024-06-04');
  assert.equal(windows[2].startDate, '2024-06-07');
});

test('advanceWindow clamps index', () => {
  const windows = [{ id: 1 }, { id: 2 }];
  assert.equal(Timeline.advanceWindow(windows, 0, -1), 0);
  assert.equal(Timeline.advanceWindow(windows, 0, 1), 1);
  assert.equal(Timeline.advanceWindow(windows, 1, 1), 1);
});

test('computeDayColumnLayout maps single event to mid spine', () => {
  const layout = Timeline.computeDayColumnLayout([
    { id: 'e1', occurredAtMs: 1000, operationName: 'Op', statusRaw: 'ok' }
  ]);
  assert.equal(layout.markers.length, 1);
  assert.equal(layout.markers[0].yRatio, 0.5);
});

test('layoutWindowColumns includes empty days in window', () => {
  const events = [
    { id: 'e1', occurredAtMs: Date.parse('2024-06-02T12:00:00.000Z'), operationName: 'A' }
  ];
  const columns = Timeline.layoutWindowColumns(events, {
    startDate: '2024-06-01',
    endDate: '2024-06-03'
  }, 'UTC');
  assert.equal(columns.length, 3);
  assert.equal(columns[0].dateKey, '2024-06-01');
  assert.equal(columns[0].markers.length, 0);
  assert.equal(columns[1].markers.length, 1);
});

test('layoutEqualSpacedBatch uses equal y ratios in time order', () => {
  const layout = Timeline.layoutEqualSpacedBatch([
    { id: 'c', occurredAtMs: 3000, operationName: 'C' },
    { id: 'a', occurredAtMs: 1000, operationName: 'A' },
    { id: 'b', occurredAtMs: 2000, operationName: 'B' }
  ]);
  assert.equal(layout.markers.length, 3);
  assert.deepEqual(layout.markers.map((m) => m.eventId), ['a', 'b', 'c']);
  assert.deepEqual(layout.markers.map((m) => m.yRatio), [0, 0.5, 1]);
});

test('layoutEqualSpacedBatch single event is centered', () => {
  const layout = Timeline.layoutEqualSpacedBatch([
    { id: 'only', occurredAtMs: 5000, operationName: 'Only' }
  ]);
  assert.equal(layout.markers.length, 1);
  assert.equal(layout.markers[0].yRatio, 0.5);
});

test('layoutBatchedEqualSpacedTimelines splits range into 3-day batches', () => {
  const t1 = Date.parse('2024-06-01T10:00:00.000Z');
  const t2 = Date.parse('2024-06-04T10:00:00.000Z');
  const t3 = Date.parse('2024-06-07T10:00:00.000Z');
  const batches = Timeline.layoutBatchedEqualSpacedTimelines([
    { id: 'e1', occurredAtMs: t1 },
    { id: 'e2', occurredAtMs: t2 },
    { id: 'e3', occurredAtMs: t3 }
  ], '2024-06-01', '2024-06-07', 'UTC', 3);
  assert.equal(batches.length, 3);
  assert.equal(batches[0].events.length, 1);
  assert.equal(batches[0].events[0].id, 'e1');
  assert.equal(batches[1].events.length, 1);
  assert.equal(batches[1].events[0].id, 'e2');
  assert.equal(batches[2].events.length, 1);
  assert.equal(batches[2].events[0].id, 'e3');
});
