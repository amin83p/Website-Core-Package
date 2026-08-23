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

test('current path tracking only runs for cached diagnostics or active-users flags', () => {
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
  }), true);
  assert.equal(sessionEnforcement.shouldTrackCurrentPathForRequest({
    ...baseRequest,
    user: { uiAccess: { canViewActiveUsers: true } }
  }), true);
  assert.equal(sessionEnforcement.shouldTrackCurrentPathForRequest({
    ...baseRequest,
    originalUrl: '/scripts/main.js',
    user: { canUsePageDiagnostics: true, pageDiagnosticsEnabled: true }
  }), false);
});

test('post-auth current path tracker skips writes when diagnostics is disabled', async () => {
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
        user: { canUsePageDiagnostics: true, pageDiagnosticsEnabled: false }
      }, {}, resolve);
    });
    assert.equal(calls.length, 0);

    await new Promise((resolve) => {
      sessionEnforcement.trackCurrentPathAfterAuth({
        method: 'GET',
        originalUrl: '/dashboard',
        headers: { accept: 'text/html' },
        userSession: { id: 'SID123', currentPath: '', currentPathUpdatedAt: '' },
        user: { canUsePageDiagnostics: true, pageDiagnosticsEnabled: true }
      }, {}, resolve);
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'sessions');
    assert.equal(calls[0][1], 'SID123');
    assert.equal(calls[0][2].currentPath, '/dashboard');
  } finally {
    dataService.updateData = originalUpdateData;
  }
});
