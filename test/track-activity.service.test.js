const test = require('node:test');
const assert = require('node:assert/strict');

const dataService = require('../MVC/services/dataService');
const trackActivityService = require('../MVC/services/security/trackActivityService');

test('buildDefaultPageFilters returns datetime-local defaults and preserves filters', () => {
  const filters = trackActivityService.buildDefaultPageFilters({
    source: 'action_state',
    q: 'hello'
  }, 'UTC');

  assert.match(filters.startAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.match(filters.endAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(filters.source, 'action_state');
  assert.equal(filters.q, 'hello');
});

test('parseTimelineFilters trims over-range queries to max 7 days', () => {
  const parsed = trackActivityService.parseTimelineFilters({
    startAt: '2026-01-01T00:00',
    endAt: '2026-02-01T00:00'
  }, 'UTC');

  assert.equal(parsed.rangeTrimmed, true);
  assert.ok(parsed.endAtMs - parsed.startAtMs <= (7 * 24 * 60 * 60 * 1000));
});

test('fetchTrackActivityTimeline uses log-canonical stream and action-state enrichment', async () => {
  const originalFetchData = dataService.fetchData;
  const originalGetDataById = dataService.getDataById;

  dataService.fetchData = async (entityType, query = {}) => {
    const type = String(entityType || '');
    if (type === 'sections') {
      return [{ id: 'S1', name: 'PTE Practice' }];
    }
    if (type === 'operations') {
      return [{ id: 'OP1', name: 'CREATE' }];
    }
    if (type === 'organizations') {
      return [{ id: 'ORG1', identity: { displayName: 'Org One' }, timezone: 'UTC' }];
    }
    if (type === 'logs') {
      return [
        {
          id: 'L1',
          timestamp: '2026-04-10T10:02:00.000Z',
          sectionId: 'S1',
          operationId: 'OP1',
          userId: 'U1',
          orgId: 'ORG1',
          status: 'SUCCESS',
          requestId: 'REQ-1',
          details: {
            method: 'POST',
            url: '/pte/practice/start',
            actor: {
              userId: 'U1',
              username: 'amin',
              displayName: 'Amin',
              orgId: 'ORG1'
            }
          }
        },
        {
          id: 'L2',
          timestamp: '2026-04-10T10:08:00.000Z',
          sectionId: 'S1',
          operationId: 'OP1',
          userId: 'U1',
          orgId: 'ORG1',
          status: 'FAILURE',
          details: {
            method: 'POST',
            url: '/pte/practice/start',
            actor: {
              userId: 'U1',
              username: 'amin',
              displayName: 'Amin',
              orgId: 'ORG1'
            }
          }
        }
      ];
    }
    if (type === 'actionStates') {
      return [
        {
          id: 'A1',
          userId: 'U1',
          sectionId: 'S1',
          operationId: 'OP1',
          status: 'completed',
          startedAt: '2026-04-10T10:01:00.000Z',
          requestId: 'REQ-1',
          initialContext: { requestId: 'REQ-1', orgId: 'ORG1', method: 'POST', url: '/pte/practice/start' }
        },
        {
          id: 'A2',
          userId: 'U1',
          sectionId: 'S1',
          operationId: 'OP1',
          status: 'completed',
          startedAt: '2026-04-10T10:09:00.000Z',
          initialContext: { orgId: 'ORG1', method: 'POST', url: '/pte/practice/start' }
        }
      ];
    }
    if (type === 'users') {
      const inToken = String(query?.id__in || '').trim();
      if (!inToken) return [];
      return [{ id: 'U1', username: 'amin', displayName: 'Amin', primaryOrgId: 'ORG1' }];
    }
    return [];
  };

  dataService.getDataById = async () => ({ id: 'ORG1', timezone: 'UTC' });

  try {
    const payload = await trackActivityService.fetchTrackActivityTimeline({
      startAt: '2026-04-10T00:00',
      endAt: '2026-04-10T23:59',
      zoomLevel: '30m'
    }, { id: 'ROOT_001', activeOrgId: 'ORG1' });

    assert.equal(payload.summary.totalEvents, 2);
    assert.equal(payload.summary.actionStateLinkedCount, 2);
    assert.equal(payload.summary.successCount, 1);
    assert.equal(payload.summary.failureCount, 1);
    assert.ok(Array.isArray(payload.lanes));
    assert.ok(payload.lanes.length >= 1);

    const firstLane = payload.lanes[0];
    assert.ok(Array.isArray(firstLane.buckets));
    assert.ok(firstLane.buckets.length >= 1);
    assert.ok(firstLane.buckets.some((bucket) => Number(bucket.linkedActionStates || 0) > 0));
  } finally {
    dataService.fetchData = originalFetchData;
    dataService.getDataById = originalGetDataById;
  }
});

test('fetchTrackActivityDetails masks sensitive keys by default', async () => {
  const originalFetchData = dataService.fetchData;
  const originalGetDataById = dataService.getDataById;

  dataService.fetchData = async (entityType, query = {}) => {
    const type = String(entityType || '');
    if (type === 'sections') return [{ id: 'S1', name: 'Security' }];
    if (type === 'operations') return [{ id: 'OP1', name: 'READ' }];
    if (type === 'organizations') return [{ id: 'ORG1', identity: { displayName: 'Org One' }, timezone: 'UTC' }];
    if (type === 'logs') {
      return [{
        id: 'L9',
        timestamp: '2026-04-10T10:02:00.000Z',
        sectionId: 'S1',
        operationId: 'OP1',
        userId: 'U1',
        orgId: 'ORG1',
        status: 'SUCCESS',
        details: {
          method: 'GET',
          url: '/logs',
          password: 'secret-raw',
          ip: '1.2.3.4',
          actor: { userId: 'U1', orgId: 'ORG1' }
        }
      }];
    }
    if (type === 'actionStates') return [];
    if (type === 'users') {
      const inToken = String(query?.id__in || '').trim();
      if (!inToken) return [];
      return [{ id: 'U1', username: 'amin', displayName: 'Amin', primaryOrgId: 'ORG1' }];
    }
    return [];
  };

  dataService.getDataById = async () => ({ id: 'ORG1', timezone: 'UTC' });

  try {
    const timeline = await trackActivityService.fetchTrackActivityTimeline({
      startAt: '2026-04-10T00:00',
      endAt: '2026-04-10T23:59',
      zoomLevel: 'event'
    }, { id: 'U1', activeOrgId: 'ORG1', role: 'student' });

    const eventId = timeline.eventRows[0]?.eventId;
    assert.ok(eventId);

    const detail = await trackActivityService.fetchTrackActivityDetails({
      kind: 'event',
      eventId,
      startAt: '2026-04-10T00:00',
      endAt: '2026-04-10T23:59'
    }, { id: 'U1', activeOrgId: 'ORG1', role: 'student' });

    assert.equal(detail.found, true);
    assert.equal(detail.canReveal, false);
    assert.equal(detail.event.details.password, '[MASKED]');
    assert.equal(detail.event.details.ip, '[MASKED]');
  } finally {
    dataService.fetchData = originalFetchData;
    dataService.getDataById = originalGetDataById;
  }
});

test('sanitizeCsvCellForSpreadsheet prefixes dangerous formulas', () => {
  assert.equal(trackActivityService.sanitizeCsvCellForSpreadsheet('=2+2'), '\t=2+2');
  assert.equal(trackActivityService.sanitizeCsvCellForSpreadsheet('@cmd'), '\t@cmd');
  assert.equal(trackActivityService.sanitizeCsvCellForSpreadsheet('  =SUM(A1:A2)'), '\t  =SUM(A1:A2)');
  assert.equal(trackActivityService.sanitizeCsvCellForSpreadsheet('hello'), 'hello');
});

test('non-admin scope is forced to self user and rejects foreign user filter', async () => {
  const originalFetchData = dataService.fetchData;
  const originalGetDataById = dataService.getDataById;

  dataService.fetchData = async (entityType, query = {}) => {
    const type = String(entityType || '');
    if (type === 'sections') return [{ id: 'S1', name: 'Track Activity' }];
    if (type === 'operations') return [{ id: 'OP1', name: 'READ' }];
    if (type === 'organizations') return [{ id: 'ORG1', identity: { displayName: 'Org One' }, timezone: 'UTC' }];
    if (type === 'logs') {
      return [{
        id: 'L1',
        timestamp: '2026-04-10T10:00:00.000Z',
        sectionId: 'S1',
        operationId: 'OP1',
        userId: 'U_SELF',
        orgId: 'ORG1',
        status: 'SUCCESS',
        details: { method: 'GET', url: '/security/track-activity' }
      }];
    }
    if (type === 'actionStates') return [];
    if (type === 'users') {
      const inToken = String(query?.id__in || '').trim();
      if (!inToken) return [];
      return [{ id: 'U_SELF', username: 'self', displayName: 'Self User', primaryOrgId: 'ORG1' }];
    }
    return [];
  };
  dataService.getDataById = async () => ({ id: 'ORG1', timezone: 'UTC' });

  try {
    const ok = await trackActivityService.fetchTrackActivityTimeline({
      startAt: '2026-04-10T00:00',
      endAt: '2026-04-10T23:59'
    }, { id: 'U_SELF', role: 'student', activeOrgId: 'ORG1' });
    assert.equal(ok.summary.totalEvents, 1);

    await assert.rejects(
      () => trackActivityService.fetchTrackActivityTimeline({
        startAt: '2026-04-10T00:00',
        endAt: '2026-04-10T23:59',
        userId: 'U_OTHER'
      }, { id: 'U_SELF', role: 'student', activeOrgId: 'ORG1' }),
      /outside your access scope/i
    );
  } finally {
    dataService.fetchData = originalFetchData;
    dataService.getDataById = originalGetDataById;
  }
});

test('fetchTrackActivityHourlyTimeline builds 24 chunks with request and attempt totals', async () => {
  const originalFetchData = dataService.fetchData;
  const originalGetDataById = dataService.getDataById;

  dataService.fetchData = async (entityType) => {
    const type = String(entityType || '');
    if (type === 'sections') return [{ id: 'S1', name: 'PTE Practice Attempts' }];
    if (type === 'operations') return [{ id: 'OP1', name: 'CREATE' }];
    if (type === 'organizations') return [{ id: 'ORG1', identity: { displayName: 'Org One' }, timezone: 'UTC' }];
    if (type === 'logs') {
      return [
        {
          id: 'L1',
          timestamp: '2026-04-10T10:15:00.000Z',
          sectionId: 'S1',
          operationId: 'OP1',
          userId: 'U1',
          orgId: 'ORG1',
          status: 'SUCCESS',
          details: { method: 'POST', url: '/pte/practice/attempt/start' }
        },
        {
          id: 'L2',
          timestamp: '2026-04-10T11:20:00.000Z',
          sectionId: 'S1',
          operationId: 'OP1',
          userId: 'U1',
          orgId: 'ORG1',
          status: 'SUCCESS',
          details: { method: 'GET', url: '/pte/practice/list' }
        }
      ];
    }
    if (type === 'users') return [{ id: 'U1', username: 'amin', displayName: 'Amin', primaryOrgId: 'ORG1' }];
    return [];
  };

  dataService.getDataById = async () => ({ id: 'ORG1', timezone: 'UTC' });

  try {
    const payload = await trackActivityService.fetchTrackActivityHourlyTimeline({
      startAt: '2026-04-10T08:00',
      endAt: '2026-04-10T23:00',
      userId: 'U1'
    }, { id: 'ROOT_001', isSystemAdmin: true, activeOrgId: 'ORG1' });

    assert.equal(payload.zoomLevel, 'hourly');
    assert.equal(Array.isArray(payload.dayTimelines), true);
    assert.equal(payload.dayTimelines.length, 1);
    assert.equal(payload.summary.totalRequests, 2);
    assert.equal(payload.summary.totalAttempts, 2);

    const day = payload.dayTimelines[0] || {};
    assert.equal(Array.isArray(day.chunks), true);
    assert.equal(day.chunks.length, 24);
    assert.equal(day.chunks[10].requestCount, 1);
    assert.equal(day.chunks[11].requestCount, 1);
  } finally {
    dataService.fetchData = originalFetchData;
    dataService.getDataById = originalGetDataById;
  }
});
