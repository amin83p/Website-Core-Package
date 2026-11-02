'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const trackActivityCore = require('../MVC/services/security/trackActivityCore');
const { buildHourlyTimelineFromLogs } = require('../MVC/services/security/trackActivityHourlyTimeline');

function buildLocalEvents(session, rawQuery, lookups) {
  const tz = session.manifest?.timezone || 'UTC';
  const filters = trackActivityCore.parseTimelineFilters(rawQuery, tz);
  return trackActivityCore.buildEventsFromSourceRecords({
    logs: session.logs,
    actionStates: session.actionStates,
    filters,
    timezone: tz,
    lookups,
    userRows: []
  });
}

test('hourly timeline and events align on fixture archive', () => {
  const session = {
    manifest: { timezone: 'UTC', exportId: 'EXP-TEST', reportRange: { startDate: '2026-04-09', endDate: '2026-04-09' } },
    reportSetup: { startDate: '2026-04-09', endDate: '2026-04-09', userIds: ['U1'], selectedUsers: [{ id: 'U1', label: 'User One' }] },
    logs: [{
      id: 'L1',
      timestamp: '2026-04-09T12:00:00.000Z',
      sectionId: 'S1',
      operationId: 'OP1',
      userId: 'U1',
      status: 'SUCCESS',
      details: { method: 'GET' }
    }],
    actionStates: [],
    refs: { sections: [{ id: 'S1', name: 'Security' }], operations: [{ id: 'OP1', name: 'READ' }] }
  };

  const lookups = {
    sections: session.refs.sections,
    operations: session.refs.operations,
    organizations: []
  };

  const startMs = Date.parse('2026-04-09T00:00:00.000Z');
  const endMs = Date.parse('2026-04-09T23:59:59.999Z');
  const rawQuery = { startAtMs: startMs, endAtMs: endMs, userId: 'U1', zoomLevel: 'hourly' };

  const timeline = buildHourlyTimelineFromLogs({
    logs: session.logs,
    rawQuery,
    timezone: 'UTC',
    lookups,
    presetFilters: trackActivityCore.parseTimelineFilters(rawQuery, 'UTC')
  });

  const built = buildLocalEvents(session, rawQuery, lookups);
  assert.equal(timeline.summary.totalRequests, 1);
  assert.equal(built.events.length, 1);
});
