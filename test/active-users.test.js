const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isRecentlyActiveSession,
  groupSessionsByUser,
  computeSummaryMetrics
} = require('../MVC/services/security/activeUsersService');

const NOW = new Date('2026-07-12T12:00:00.000Z');
const STALE_MINUTES = 5;

test('isRecentlyActiveSession rejects stale activity even with long idle timeout', () => {
  const session = {
    status: 'active',
    lastActivityAt: '2026-07-12T11:50:00.000Z',
    absoluteExpiry: '2026-07-12T20:00:00.000Z',
    idleTimeoutMinutes: 1440
  };
  assert.equal(isRecentlyActiveSession(session, NOW, STALE_MINUTES), false);
});

test('isRecentlyActiveSession rejects absolute-expired sessions', () => {
  const session = {
    status: 'active',
    lastActivityAt: '2026-07-12T11:58:00.000Z',
    absoluteExpiry: '2026-07-12T11:30:00.000Z',
    idleTimeoutMinutes: 1440
  };
  assert.equal(isRecentlyActiveSession(session, NOW, STALE_MINUTES), false);
});

test('isRecentlyActiveSession allows recent activity within stale window', () => {
  const session = {
    status: 'active',
    lastActivityAt: '2026-07-12T11:57:00.000Z',
    absoluteExpiry: '2026-07-12T20:00:00.000Z',
    idleTimeoutMinutes: 1440
  };
  assert.equal(isRecentlyActiveSession(session, NOW, STALE_MINUTES), true);
});

test('isRecentlyActiveSession allows activity exactly at stale boundary', () => {
  const session = {
    status: 'active',
    lastActivityAt: '2026-07-12T11:55:00.000Z',
    absoluteExpiry: '2026-07-12T20:00:00.000Z',
    idleTimeoutMinutes: 1440
  };
  assert.equal(isRecentlyActiveSession(session, NOW, STALE_MINUTES), true);
});

test('groupSessionsByUser deduplicates by user and keeps latest activity within stale window', () => {
  const grouped = groupSessionsByUser([
    {
      status: 'active',
      userId: 'USR-1',
      lastActivityAt: '2026-07-12T11:40:00.000Z',
      absoluteExpiry: '2026-07-12T20:00:00.000Z',
      idleTimeoutMinutes: 1440,
      currentOrgId: 'ORG-1',
      deviceFingerprint: { ip: '10.0.0.1', browser: 'Desktop' }
    },
    {
      status: 'active',
      userId: 'USR-1',
      lastActivityAt: '2026-07-12T11:55:00.000Z',
      absoluteExpiry: '2026-07-12T20:00:00.000Z',
      idleTimeoutMinutes: 1440,
      currentOrgId: 'ORG-2',
      deviceFingerprint: { ip: '10.0.0.2', browser: 'Mobile Safari' }
    },
    {
      status: 'active',
      userId: 'USR-2',
      lastActivityAt: '2026-07-12T11:50:00.000Z',
      absoluteExpiry: '2026-07-12T20:00:00.000Z',
      idleTimeoutMinutes: 1440,
      currentOrgId: 'ORG-3',
      deviceFingerprint: { ip: '10.0.0.3', browser: 'Desktop' }
    },
    {
      status: 'active',
      userId: 'USR-3',
      lastActivityAt: '2026-07-12T10:00:00.000Z',
      absoluteExpiry: '2026-07-12T20:00:00.000Z',
      idleTimeoutMinutes: 1440,
      currentOrgId: 'ORG-4',
      deviceFingerprint: { ip: '10.0.0.4', browser: 'Desktop' }
    }
  ], NOW, STALE_MINUTES);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].userId, 'USR-1');
  assert.equal(grouped[0].sessionCount, 1);
  assert.equal(grouped[0].lastActivityAt, '2026-07-12T11:55:00.000Z');
  assert.equal(grouped[0].currentOrgId, 'ORG-2');
});

test('computeSummaryMetrics calculates session and activity averages', () => {
  const summary = computeSummaryMetrics([
    {
      userId: 'USR-1',
      sessionCount: 2,
      lastActivityAt: '2026-07-12T11:58:00.000Z'
    },
    {
      userId: 'USR-2',
      sessionCount: 1,
      lastActivityAt: '2026-07-12T11:56:00.000Z'
    }
  ], [
    { sessionCount: 2 },
    { sessionCount: 1 }
  ], NOW);

  assert.equal(summary.activeUserCount, 2);
  assert.equal(summary.activeSessionCount, 3);
  assert.equal(summary.avgSessionsPerUser, 1.5);
  assert.equal(summary.multiSessionUsers, 1);
  assert.equal(summary.avgMinutesSinceLastActivity, 3);
});
