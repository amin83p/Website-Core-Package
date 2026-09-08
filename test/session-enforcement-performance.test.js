const test = require('node:test');
const assert = require('node:assert/strict');

const sessionEnforcement = require('../MVC/middleware/sessionEnforcement');
const dataService = require('../MVC/services/dataService');

test('session enforcement bypasses known public static asset requests', () => {
  assert.equal(sessionEnforcement.isPublicStaticAssetRequest({
    method: 'GET',
    originalUrl: '/scripts/main.js?v=abc123'
  }), true);
  assert.equal(sessionEnforcement.isPublicStaticAssetRequest({
    method: 'HEAD',
    originalUrl: '/styles/main.css'
  }), true);
  assert.equal(sessionEnforcement.isPublicStaticAssetRequest({
    method: 'GET',
    originalUrl: '/uploads/GLOBAL/logo/Logo1.png'
  }), true);
  assert.equal(sessionEnforcement.isPublicStaticAssetRequest({
    method: 'GET',
    originalUrl: '/site.webmanifest'
  }), true);
});

test('session enforcement static bypass does not skip dynamic-looking protected routes', () => {
  assert.equal(sessionEnforcement.isPublicStaticAssetRequest({
    method: 'GET',
    originalUrl: '/reports/export.csv'
  }), false);
  assert.equal(sessionEnforcement.isPublicStaticAssetRequest({
    method: 'POST',
    originalUrl: '/scripts/main.js'
  }), false);
  assert.equal(sessionEnforcement.isPublicStaticAssetRequest({
    method: 'GET',
    originalUrl: '/debug/client-diagnostics/page-presence'
  }), false);
});

test('session current path updates are throttled between heartbeat writes', () => {
  const now = new Date('2026-08-23T12:00:00.000Z');

  assert.equal(sessionEnforcement.shouldUpdateCurrentPath({}, '/dashboard', now), true);
  assert.equal(sessionEnforcement.shouldUpdateCurrentPath({
    currentPath: '/dashboard',
    currentPathUpdatedAt: '2026-08-23T11:59:50.000Z'
  }, '/dashboard', now), false);
  assert.equal(sessionEnforcement.shouldUpdateCurrentPath({
    currentPath: '/dashboard',
    currentPathUpdatedAt: '2026-08-23T11:59:50.000Z'
  }, '/profile', now), false);
  assert.equal(sessionEnforcement.shouldUpdateCurrentPath({
    currentPath: '/dashboard',
    currentPathUpdatedAt: '2026-08-23T11:56:30.000Z'
  }, '/profile', now), true);
  assert.equal(sessionEnforcement.shouldUpdateCurrentPath({
    currentPath: '/dashboard',
    currentPathUpdatedAt: '2026-08-23T11:59:50.000Z'
  }, '/profile', now, { heartbeatDue: true }), true);
});

test('navigation never auto-tracks current path for any user flags', () => {
  const baseRequest = {
    method: 'GET',
    originalUrl: '/dashboard',
    headers: { accept: 'text/html' }
  };

  assert.equal(sessionEnforcement.shouldTrackCurrentPathForRequest(baseRequest), false);
  assert.equal(sessionEnforcement.shouldTrackCurrentPathForRequest({
    ...baseRequest,
    user: { canUsePageDiagnostics: true, pageDiagnosticsEnabled: false }
  }), false);
  assert.equal(sessionEnforcement.shouldTrackCurrentPathForRequest({
    ...baseRequest,
    user: { canUsePageDiagnostics: true, pageDiagnosticsEnabled: true }
  }), false);
  assert.equal(sessionEnforcement.shouldTrackCurrentPathForRequest({
    ...baseRequest,
    user: { uiAccess: { canViewActiveUsers: true } }
  }), false);
  assert.equal(sessionEnforcement.shouldTrackCurrentPathForRequest({
    ...baseRequest,
    originalUrl: '/scripts/main.js',
    user: { uiAccess: { canViewActiveUsers: true } }
  }), false);
});

test('post-auth current path tracker never writes on navigation', async () => {
  const originalUpdateData = dataService.updateData;
  const calls = [];
  dataService.updateData = async (...args) => {
    calls.push(args);
    return { ok: true };
  };

  try {
    await new Promise((resolve) => {
      sessionEnforcement.trackCurrentPathAfterAuth({
        method: 'GET',
        originalUrl: '/dashboard',
        headers: { accept: 'text/html' },
        userSession: { id: 'SID123', currentPath: '', currentPathUpdatedAt: '' },
        user: { canUsePageDiagnostics: true, pageDiagnosticsEnabled: true }
      }, {}, resolve);
    });
    assert.equal(calls.length, 0);

    await new Promise((resolve) => {
      sessionEnforcement.trackCurrentPathAfterAuth({
        method: 'GET',
        originalUrl: '/dashboard',
        headers: { accept: 'text/html' },
        userSession: { id: 'SID123', currentPath: '', currentPathUpdatedAt: '' },
        user: { canViewActiveUsers: true }
      }, {}, resolve);
    });
    assert.equal(calls.length, 0);
  } finally {
    dataService.updateData = originalUpdateData;
  }
});

test('updateSessionCurrentPath still writes when invoked explicitly', async () => {
  const originalUpdateData = dataService.updateData;
  const calls = [];
  dataService.updateData = async (...args) => {
    calls.push(args);
    return { ok: true };
  };

  try {
    const updated = await sessionEnforcement.updateSessionCurrentPath({
      userSession: { id: 'SID123', currentPath: '', currentPathUpdatedAt: '' }
    }, '/dashboard');
    assert.equal(updated, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'sessions');
    assert.equal(calls[0][1], 'SID123');
    assert.equal(calls[0][2].currentPath, '/dashboard');
  } finally {
    dataService.updateData = originalUpdateData;
  }
});

const sessionRecordCacheService = require('../MVC/services/cache/sessionRecordCacheService');

test('loadSessionRecord returns cached session without database read', async () => {
  const sessionId = 'CACHE_HIT_SESSION';
  const sessionRow = {
    id: sessionId,
    lastActivityAt: new Date().toISOString(),
    idleTimeoutMinutes: 30,
    absoluteExpiry: new Date(Date.now() + 3600000).toISOString()
  };

  sessionRecordCacheService.clearSessionRecordCache();
  sessionRecordCacheService.set(sessionId, sessionRow);

  const originalGetDataById = dataService.getDataById;
  let getDataByIdCalls = 0;
  dataService.getDataById = async (...args) => {
    getDataByIdCalls += 1;
    return originalGetDataById(...args);
  };

  try {
    const loaded = await sessionEnforcement.loadSessionRecord(sessionId);
    assert.equal(getDataByIdCalls, 0);
    assert.equal(loaded?.id, sessionId);
  } finally {
    dataService.getDataById = originalGetDataById;
    sessionRecordCacheService.clearSessionRecordCache();
  }
});

test('loadSessionRecord tombstone rejects without database read', async () => {
  const sessionId = 'REVOKED_SESSION';
  sessionRecordCacheService.clearSessionRecordCache();
  sessionRecordCacheService.markRevoked(sessionId);

  const originalGetDataById = dataService.getDataById;
  let getDataByIdCalls = 0;
  dataService.getDataById = async (...args) => {
    getDataByIdCalls += 1;
    return originalGetDataById(...args);
  };

  try {
    const loaded = await sessionEnforcement.loadSessionRecord(sessionId);
    assert.equal(loaded, null);
    assert.equal(getDataByIdCalls, 0);
  } finally {
    dataService.getDataById = originalGetDataById;
    sessionRecordCacheService.clearSessionRecordCache();
  }
});

test('sessionRecordCacheService evaluates idle and absolute expiry', () => {
  const now = new Date('2026-08-23T12:00:00.000Z');

  assert.equal(sessionRecordCacheService.isSessionExpired({
    lastActivityAt: '2026-08-23T11:50:00.000Z',
    idleTimeoutMinutes: 30,
    absoluteExpiry: '2026-08-24T12:00:00.000Z'
  }, now), false);

  assert.equal(sessionRecordCacheService.isSessionExpired({
    lastActivityAt: '2026-08-23T10:00:00.000Z',
    idleTimeoutMinutes: 30,
    absoluteExpiry: '2026-08-24T12:00:00.000Z'
  }, now), true);

  assert.equal(sessionRecordCacheService.isSessionExpired({
    lastActivityAt: '2026-08-23T11:50:00.000Z',
    idleTimeoutMinutes: 30,
    absoluteExpiry: '2026-08-23T11:00:00.000Z'
  }, now), true);

  assert.equal(sessionRecordCacheService.resolveSessionExpiryReason({
    lastActivityAt: '2026-08-23T10:00:00.000Z',
    idleTimeoutMinutes: 30,
    absoluteExpiry: '2026-08-24T12:00:00.000Z'
  }, now), 'idle');

  assert.equal(sessionRecordCacheService.resolveSessionExpiryReason({
    lastActivityAt: '2026-08-23T10:00:00.000Z',
    idleTimeoutMinutes: 0,
    absoluteExpiry: '2026-08-24T12:00:00.000Z'
  }, now), '');
});

test('loadSessionRecord rechecks database when cached session appears expired', async () => {
  const sessionId = 'SES_STALE_CACHE';
  const now = new Date('2026-08-23T12:00:00.000Z');
  const staleSession = {
    id: sessionId,
    lastActivityAt: '2026-08-23T10:00:00.000Z',
    idleTimeoutMinutes: 30,
    absoluteExpiry: '2026-08-24T12:00:00.000Z'
  };
  const freshSession = {
    ...staleSession,
    lastActivityAt: '2026-08-23T11:55:00.000Z'
  };
  const originalGetDataById = dataService.getDataById;

  sessionRecordCacheService.clearSessionRecordCache();
  sessionRecordCacheService.set(sessionId, staleSession);
  dataService.getDataById = async (entityType, id) => (
    entityType === 'sessions' && id === sessionId ? { ...freshSession } : null
  );

  try {
    const loaded = await sessionEnforcement.loadSessionRecord(sessionId);
    assert.equal(loaded.lastActivityAt, staleSession.lastActivityAt);
    const active = await sessionEnforcement.resolveActiveSessionRecord(sessionId, loaded, now);
    assert.equal(active.lastActivityAt, freshSession.lastActivityAt);
  } finally {
    dataService.getDataById = originalGetDataById;
    sessionRecordCacheService.clearSessionRecordCache();
  }
});

test('resolveRefreshedAbsoluteExpiry extends from now and preserves later existing expiry', () => {
  const sessionService = require('../MVC/services/SessionService');
  const now = new Date('2026-09-07T14:00:00.000Z');
  const laterExisting = '2026-09-08T08:00:00.000Z';
  const refreshed = sessionService.resolveRefreshedAbsoluteExpiry(
    { absoluteExpiry: laterExisting },
    { maxDurationMins: 720 },
    now
  );
  assert.equal(refreshed, laterExisting);

  const fromNow = sessionService.resolveRefreshedAbsoluteExpiry(
    { absoluteExpiry: '2026-09-07T10:00:00.000Z' },
    { maxDurationMins: 720 },
    now
  );
  assert.equal(fromNow, '2026-09-08T02:00:00.000Z');
  assert.ok(new Date(fromNow).getTime() > now.getTime());
});

test('refreshSessionPolicyLimitsForUser bumps activity and avoids past absolute expiry', async () => {
  const sessionService = require('../MVC/services/SessionService');
  const sessionRecordCacheService = require('../MVC/services/cache/sessionRecordCacheService');
  const originals = {
    fetchData: dataService.fetchData,
    getDataById: dataService.getDataById,
    updateData: dataService.updateData,
    getWebsitePolicy: dataService.getWebsitePolicy
  };
  const sessionRow = {
    id: 'SES_POLICY_REFRESH',
    userId: 'USR_POLICY',
    createdAt: '2026-09-07T08:00:00.000Z',
    lastActivityAt: '2026-09-07T08:05:00.000Z',
    idleTimeoutMinutes: 30,
    absoluteExpiry: '2026-09-07T09:00:00.000Z',
    currentOrgId: 'ORG_1'
  };
  let updatedPayload = null;

  dataService.fetchData = async (entityType, query = {}) => {
    if (entityType === 'sessions' && query.searchFields === 'userId') return [sessionRow];
    if (entityType === 'accessPolicies') return [];
    if (entityType === 'orgPolicies') return [];
    return [];
  };
  dataService.getDataById = async (entityType, id) => (
    entityType === 'users' && id === 'USR_POLICY'
      ? { id: 'USR_POLICY', activeOrgId: 'ORG_1', primaryOrgId: 'ORG_1' }
      : null
  );
  dataService.updateData = async (entityType, id, payload) => {
    if (entityType === 'sessions' && id === 'SES_POLICY_REFRESH') {
      updatedPayload = payload;
      Object.assign(sessionRow, payload);
    }
    return payload;
  };
  dataService.getWebsitePolicy = async () => ({
    sessionControl: { maxSessions: 10, maxDuration: 720, idleTimeout: 120 }
  });

  try {
    const result = await sessionService.refreshSessionPolicyLimitsForUser('USR_POLICY');
    assert.equal(result.refreshed, 1);
    assert.equal(updatedPayload?.idleTimeoutMinutes, 120);
    assert.ok(updatedPayload?.lastActivityAt);
    assert.ok(new Date(updatedPayload.absoluteExpiry).getTime() > Date.now() - 5000);
    const cached = sessionRecordCacheService.get('SES_POLICY_REFRESH');
    assert.equal(cached?.lastActivityAt, updatedPayload.lastActivityAt);
  } finally {
    Object.assign(dataService, originals);
    sessionRecordCacheService.clearSessionRecordCache();
  }
});
