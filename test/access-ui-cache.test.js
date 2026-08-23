const test = require('node:test');
const assert = require('node:assert/strict');

process.env.REQUEST_CACHE_TTL_MS = process.env.REQUEST_CACHE_TTL_MS || '900000';
process.env.REQUEST_CACHE_MAX_ENTRIES = process.env.REQUEST_CACHE_MAX_ENTRIES || '1000';

const accessService = require('../MVC/services/security');
const accessUiService = require('../MVC/services/security/accessUiService');

function createRequest(overrides = {}) {
  return {
    user: {
      id: 'USR-1',
      activeOrgId: 'ORG-1',
      currentProfileMode: 'LOCAL',
      activeProfile: { id: 'PROFILE-1' },
      activePolicy: { id: 'POLICY-1' },
      ...overrides.user
    },
    cookies: { auth_token: 'header.payload.session-1', ...overrides.cookies },
    ip: overrides.ip || '127.0.0.1'
  };
}

test('access UI cache reuses short-lived header access checks across requests', async () => {
  const originalEvaluateAccess = accessService.evaluateAccess;
  let calls = 0;
  accessUiService.clearUiAccessCache();
  accessService.evaluateAccess = async () => {
    calls += 1;
    return { allowed: true };
  };

  try {
    assert.equal(await accessUiService.canAccessTarget(createRequest(), {
      sectionId: 'PAGE_DIAGNOSTICS',
      operationId: 'OP1003'
    }), true);
    assert.equal(await accessUiService.canAccessTarget(createRequest(), {
      sectionId: 'PAGE_DIAGNOSTICS',
      operationId: 'OP1003'
    }), true);
    assert.equal(calls, 1);

    accessUiService.clearUiAccessCache();
    assert.equal(await accessUiService.canAccessTarget(createRequest(), {
      sectionId: 'PAGE_DIAGNOSTICS',
      operationId: 'OP1003'
    }), true);
    assert.equal(calls, 2);
  } finally {
    accessService.evaluateAccess = originalEvaluateAccess;
    accessUiService.clearUiAccessCache();
  }
});

test('access UI cache key changes by user and session', async () => {
  const originalEvaluateAccess = accessService.evaluateAccess;
  let calls = 0;
  accessUiService.clearUiAccessCache();
  accessService.evaluateAccess = async () => {
    calls += 1;
    return { allowed: true };
  };

  try {
    await accessUiService.canAccessTarget(createRequest(), {
      sectionId: 'ACTIVE_USERS',
      operationId: 'OP1003'
    });
    await accessUiService.canAccessTarget(createRequest({
      cookies: { auth_token: 'header.payload.session-2' }
    }), {
      sectionId: 'ACTIVE_USERS',
      operationId: 'OP1003'
    });
    await accessUiService.canAccessTarget(createRequest({
      user: { id: 'USR-2' }
    }), {
      sectionId: 'ACTIVE_USERS',
      operationId: 'OP1003'
    });
    assert.equal(calls, 3);
  } finally {
    accessService.evaluateAccess = originalEvaluateAccess;
    accessUiService.clearUiAccessCache();
  }
});

test('auth context invalidation clears cached UI access for the user', async () => {
  const originalEvaluateAccess = accessService.evaluateAccess;
  const authContextCacheService = require('../MVC/services/cache/authContextCacheService');
  let calls = 0;
  accessUiService.clearUiAccessCache();
  accessService.evaluateAccess = async () => {
    calls += 1;
    return { allowed: true };
  };

  try {
    await accessUiService.canAccessTarget(createRequest(), {
      sectionId: 'PAGE_DIAGNOSTICS',
      operationId: 'OP1003'
    });
    await accessUiService.canAccessTarget(createRequest(), {
      sectionId: 'PAGE_DIAGNOSTICS',
      operationId: 'OP1003'
    });
    assert.equal(calls, 1);

    authContextCacheService.invalidateAuthContextForUser('USR-1');
    await accessUiService.canAccessTarget(createRequest(), {
      sectionId: 'PAGE_DIAGNOSTICS',
      operationId: 'OP1003'
    });
    assert.equal(calls, 2);
  } finally {
    accessService.evaluateAccess = originalEvaluateAccess;
    accessUiService.clearUiAccessCache();
  }
});
