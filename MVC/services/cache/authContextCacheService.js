'use strict';

const { createTtlLruCache } = require('./ttlLruCache');
const { cloneCacheValue } = require('./cacheClone');
const {
  resolveRequestCacheTtlMs,
  resolveRequestCacheMaxEntries
} = require('./requestCacheConfig');

let authContextCache = createAuthContextCache();

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

function buildAuthContextCacheKey(userId, sessionId) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedUserId || !normalizedSessionId) return '';
  return `${normalizedUserId}:${normalizedSessionId}`;
}

function getCachedAuthContext(userId, sessionId) {
  const cacheKey = buildAuthContextCacheKey(userId, sessionId);
  if (!cacheKey) return null;
  const cached = authContextCache.get(cacheKey);
  return cached ? cloneCacheValue(cached) : null;
}

function setCachedAuthContext(userId, sessionId, userContext) {
  const cacheKey = buildAuthContextCacheKey(userId, sessionId);
  if (!cacheKey || !userContext) return;
  authContextCache.set(cacheKey, userContext, resolveRequestCacheTtlMs());
}

function invalidateAuthContextForUser(userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return 0;
  return authContextCache.deleteByPrefix(`${normalizedUserId}:`);
}

function invalidateAuthContextForSession(userId, sessionId) {
  const cacheKey = buildAuthContextCacheKey(userId, sessionId);
  if (!cacheKey) return;
  authContextCache.delete(cacheKey);
}

function clearAuthContextCache() {
  authContextCache.clear();
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
  _authContextCache: () => authContextCache
};
