'use strict';

const { createTtlLruCache } = require('./ttlLruCache');
const { cloneCacheValue } = require('./cacheClone');
const {
  resolveRequestCacheTtlMs,
  resolveRequestCacheMaxEntries
} = require('./requestCacheConfig');

let authContextCache = null;

function createAuthContextCache() {
  return createTtlLruCache({
    name: 'auth-context-cache',
    maxEntries: resolveRequestCacheMaxEntries(),
    defaultTtlMs: resolveRequestCacheTtlMs()
  });
}

function rebuildAuthContextCache() {
  authContextCache = createAuthContextCache();
}

function getAuthContextCache() {
  if (!authContextCache) rebuildAuthContextCache();
  return authContextCache;
}

function buildAuthContextCacheKey(userId, sessionId) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedUserId || !normalizedSessionId) return '';
  return `${normalizedUserId}:${normalizedSessionId}`;
}

function getCachedAuthContext(userId, sessionId) {
  const cacheKey = buildAuthContextCacheKey(userId, sessionId);
  if (!cacheKey) return null;
  const cached = getAuthContextCache().get(cacheKey);
  return cached ? cloneCacheValue(cached) : null;
}

function setCachedAuthContext(userId, sessionId, userContext) {
  const cacheKey = buildAuthContextCacheKey(userId, sessionId);
  if (!cacheKey || !userContext) return;
  getAuthContextCache().set(cacheKey, userContext, resolveRequestCacheTtlMs());
}

function invalidateAuthContextForUser(userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return 0;
  const removed = getAuthContextCache().deleteByPrefix(`${normalizedUserId}:`);
  try {
    const accessUiService = require('../security/accessUiService');
    if (accessUiService && typeof accessUiService.invalidateUiAccessCacheForUser === 'function') {
      accessUiService.invalidateUiAccessCacheForUser(normalizedUserId);
    }
  } catch (_) {
    // ignore
  }
  return removed;
}

function invalidateAuthContextForSession(userId, sessionId) {
  const cacheKey = buildAuthContextCacheKey(userId, sessionId);
  if (!cacheKey) return;
  getAuthContextCache().delete(cacheKey);
}

function clearAuthContextCache() {
  if (authContextCache) authContextCache.clear();
}

function clearAllRequestCaches() {
  clearAuthContextCache();
  rebuildAuthContextCache();
  try {
    const websitePolicyCacheService = require('./websitePolicyCacheService');
    websitePolicyCacheService.clearWebsitePolicyCache();
  } catch (_) {
    // ignore
  }
  try {
    const accessUiService = require('../security/accessUiService');
    if (accessUiService && typeof accessUiService.clearUiAccessCache === 'function') {
      accessUiService.clearUiAccessCache();
    }
  } catch (_) {
    // ignore
  }
}

module.exports = {
  buildAuthContextCacheKey,
  getCachedAuthContext,
  setCachedAuthContext,
  invalidateAuthContextForUser,
  invalidateAuthContextForSession,
  clearAuthContextCache,
  clearAllRequestCaches,
  rebuildAuthContextCache,
  _authContextCache: () => getAuthContextCache()
};
