'use strict';

const websitePolicyRepository = require('../../repositories/websitePolicyRepository');
const { createTtlLruCache } = require('./ttlLruCache');
const { cloneCacheValue } = require('./cacheClone');
const { resolveRequestCacheTtlMs } = require('./requestCacheConfig');

/** Cap policy cache TTL so maintenance toggles propagate across app instances within ~1 minute. */
const WEBSITE_POLICY_CACHE_MAX_TTL_MS = 60000;

const POLICY_CACHE_KEY = 'website-policy';

function resolveWebsitePolicyCacheTtlMs() {
  return Math.min(resolveRequestCacheTtlMs(), WEBSITE_POLICY_CACHE_MAX_TTL_MS);
}

const policyCache = createTtlLruCache({
  name: 'website-policy-cache',
  maxEntries: 1,
  defaultTtlMs: resolveWebsitePolicyCacheTtlMs()
});

async function getWebsitePolicy(options = {}) {
  const cached = policyCache.get(POLICY_CACHE_KEY);
  if (cached) return cloneCacheValue(cached);

  const policy = await websitePolicyRepository.getPolicy(options);
  policyCache.set(POLICY_CACHE_KEY, policy, resolveWebsitePolicyCacheTtlMs());
  return cloneCacheValue(policy);
}

function invalidateWebsitePolicyCache() {
  policyCache.clear();
}

function clearWebsitePolicyCache() {
  policyCache.clear();
}

module.exports = {
  getWebsitePolicy,
  invalidateWebsitePolicyCache,
  clearWebsitePolicyCache,
  resolveWebsitePolicyCacheTtlMs,
  WEBSITE_POLICY_CACHE_MAX_TTL_MS,
  _policyCache: policyCache
};
