'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHourlyTimelineFromLogs } = require('../MVC/services/security/trackActivityHourlyTimeline');

test('buildHourlyTimelineFromLogs counts logs in hourly buckets', () => {
  const timezone = 'UTC';
  const startMs = Date.parse('2026-04-09T00:00:00.000Z');
  const endMs = Date.parse('2026-04-09T23:59:59.999Z');
  const logs = [
    {
      id: 'L1',
      timestamp: '2026-04-09T12:00:00.000Z',
      sectionId: 'S1',
      operationId: 'OP1',
      userId: 'U1',
      status: 'SUCCESS',
      details: { url: '/practice/attempt/1' }
    },
    {
      id: 'L2',
      timestamp: '2026-04-09T12:05:00.000Z',
      sectionId: 'S1',
      operationId: 'OP1',
      userId: 'U1',
      status: 'SUCCESS',
      details: {}
    }
  ];

  const payload = buildHourlyTimelineFromLogs({
    logs,
    rawQuery: {
      startAtMs: startMs,
      endAtMs: endMs,
      userId: 'U1',
      zoomLevel: 'hourly'
    },
    timezone,
    lookups: {
      sections: [{ id: 'S1', name: 'Security' }],
      operations: [{ id: 'OP1', name: 'READ' }]
    }
  });

  assert.equal(payload.zoomLevel, 'hourly');
  assert.ok(Array.isArray(payload.dayTimelines));
  assert.equal(payload.summary.totalRequests, 2);
  assert.ok(payload.summary.totalAttempts >= 1);
  const day = payload.dayTimelines[0];
  assert.ok(day);
  const hour12 = day.chunks.find((c) => c.hour === 12);
  assert.equal(hour12.requestCount, 2);
});
