'use strict';

const websitePolicyRepository = require('../../repositories/websitePolicyRepository');
const { createTtlLruCache } = require('./ttlLruCache');
const { cloneCacheValue } = require('./cacheClone');
const { resolveRequestCacheTtlMs } = require('./requestCacheConfig');

const POLICY_CACHE_KEY = 'website-policy';
const policyCache = createTtlLruCache({
  name: 'website-policy-cache',
  maxEntries: 1,
  defaultTtlMs: resolveRequestCacheTtlMs()
});

async function getWebsitePolicy(options = {}) {
  const cached = policyCache.get(POLICY_CACHE_KEY);
  if (cached) return cloneCacheValue(cached);

  const policy = await websitePolicyRepository.getPolicy(options);
  policyCache.set(POLICY_CACHE_KEY, policy, resolveRequestCacheTtlMs());
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
  _policyCache: policyCache
};
