'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const websitePolicyCacheService = require('../MVC/services/cache/websitePolicyCacheService');
const requestCacheConfig = require('../MVC/services/cache/requestCacheConfig');

const RUNTIME_PATH = require.resolve('../MVC/infrastructure/runtime/dataBackendRuntime');
const DOMAIN_OPS_PATH = require.resolve('../MVC/services/data/domainOpsService');
const REPO_PATH = require.resolve('../MVC/repositories/websitePolicyRepository');

function withActiveBackend(config, fn) {
  const { setActiveDataBackendConfig } = require(RUNTIME_PATH);
  const previous = require(RUNTIME_PATH).getActiveDataBackendConfig();
  setActiveDataBackendConfig(config);
  try {
    return fn();
  } finally {
    setActiveDataBackendConfig(previous);
  }
}

test('website policy cache TTL is capped for faster maintenance propagation', () => {
  assert.equal(websitePolicyCacheService.WEBSITE_POLICY_CACHE_MAX_TTL_MS, 60000);
  assert.equal(
    websitePolicyCacheService.resolveWebsitePolicyCacheTtlMs(),
    Math.min(requestCacheConfig.resolveRequestCacheTtlMs(), 60000)
  );
});

test('updateWebsitePolicy rejects save when mongo is configured but active backend is json recovery', async () => {
  const originalEnv = { ...process.env };
  process.env.DATA_BACKEND = 'mongo';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test-policy-backend';

  delete require.cache[DOMAIN_OPS_PATH];
  delete require.cache[REPO_PATH];
  const domainOpsService = require(DOMAIN_OPS_PATH);
  const websitePolicyRepository = require(REPO_PATH);

  const originalUpdate = websitePolicyRepository.updatePolicy;
  let jsonWriteAttempted = false;
  websitePolicyRepository.updatePolicy = async () => {
    jsonWriteAttempted = true;
    return { maintenance: { enabled: false } };
  };

  try {
    await withActiveBackend(
      {
        mode: 'json',
        requested: 'mongo',
        mongo: { ready: true, uri: process.env.MONGODB_URI },
        fallback: { active: true, reason: 'mongo_sync_failed', message: 'recovery' }
      },
      async () => {
        await assert.rejects(
          () => domainOpsService.updateWebsitePolicy({ maintenance: { enabled: false } }, { id: 'USR_1' }),
          /JSON recovery mode/
        );
      }
    );
    assert.equal(jsonWriteAttempted, false);
  } finally {
    websitePolicyRepository.updatePolicy = originalUpdate;
    process.env = originalEnv;
    delete require.cache[DOMAIN_OPS_PATH];
    delete require.cache[REPO_PATH];
  }
});
