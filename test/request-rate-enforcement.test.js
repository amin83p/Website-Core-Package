'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeGroupList,
  needsWriteHeavyEnforcement,
  ensureWriteHeavyRateLimitEnforcement
} = require('../MVC/services/security/requestRateEnforcementBootstrap');
const requestRateMonitor = require('../MVC/middleware/requestRateMonitor');

test('normalizeGroupList always includes write and heavy', () => {
  assert.deepEqual(normalizeGroupList(['auth']), ['auth', 'write', 'heavy']);
  assert.deepEqual(normalizeGroupList(['auth', 'heavy']), ['auth', 'write', 'heavy']);
});

test('needsWriteHeavyEnforcement detects disabled phase2 or missing write group', () => {
  assert.equal(needsWriteHeavyEnforcement({ phase2: { enabled: false, enforceGroups: ['auth', 'heavy'] } }), true);
  assert.equal(needsWriteHeavyEnforcement({ phase2: { enabled: true, enforceGroups: ['auth', 'heavy'] } }), true);
  assert.equal(needsWriteHeavyEnforcement({ phase2: { enabled: true, enforceGroups: ['auth', 'heavy', 'write'] } }), false);
});

test('ensureWriteHeavyRateLimitEnforcement updates policy when needed', async () => {
  let saved = null;
  const result = await ensureWriteHeavyRateLimitEnforcement({
    getWebsitePolicy: async () => ({
      requestControl: {
        enabled: true,
        mode: 'monitor',
        phase2: { enabled: false, enforceGroups: ['auth', 'heavy'] }
      }
    }),
    updateWebsitePolicy: async (updates, user) => {
      saved = { updates, user };
      return updates;
    }
  });

  assert.equal(result.updated, true);
  assert.deepEqual(result.enforceGroups, ['auth', 'write', 'heavy']);
  assert.equal(saved.updates.requestControl.phase2.enabled, true);
  assert.deepEqual(saved.updates.requestControl.phase2.enforceGroups, ['auth', 'write', 'heavy']);
});

test('request rate monitor defaults enable phase2 write/heavy enforcement', () => {
  assert.equal(requestRateMonitor.DEFAULT_CONFIG.phase2.enabled, true);
  assert.deepEqual(requestRateMonitor.DEFAULT_CONFIG.phase2.enforceGroups, ['auth', 'heavy', 'write']);
});

test('shouldEnforceForGroup enforces write and heavy when phase2 is enabled', () => {
  const cfg = {
    mode: 'monitor',
    phase2: {
      enabled: true,
      enforceGroups: ['auth', 'heavy', 'write']
    }
  };
  assert.equal(requestRateMonitor.shouldEnforceForGroup(cfg, 'write'), true);
  assert.equal(requestRateMonitor.shouldEnforceForGroup(cfg, 'heavy'), true);
  assert.equal(requestRateMonitor.shouldEnforceForGroup(cfg, 'picker'), false);
});
