'use strict';

const { createTtlLruCache } = require('./ttlLruCache');
const { cloneCacheValue } = require('./cacheClone');
const { resolveRequestCacheTtlMs, resolveRequestCacheMaxEntries } = require('./requestCacheConfig');

const REVOKED_TOMBSTONE = Object.freeze({ revoked: true });

const sessionRecordCache = createTtlLruCache({
  name: 'session-record-cache',
  maxEntries: resolveRequestCacheMaxEntries(),
  defaultTtlMs: resolveRequestCacheTtlMs()
});

function normalizeSessionId(sessionId) {
  return String(sessionId || '').trim();
}

function isRevokedEntry(entry) {
  return Boolean(entry && entry.revoked === true);
}

function get(sessionId) {
  const normalizedId = normalizeSessionId(sessionId);
  if (!normalizedId) return null;
  const entry = sessionRecordCache.get(normalizedId);
  if (!entry) return null;
  if (isRevokedEntry(entry)) return { revoked: true };
  return cloneCacheValue(entry);
}

function set(sessionId, sessionRow) {
  const normalizedId = normalizeSessionId(sessionId);
  if (!normalizedId || !sessionRow || typeof sessionRow !== 'object') return;
  sessionRecordCache.set(normalizedId, cloneCacheValue(sessionRow), resolveRequestCacheTtlMs());
}

function markRevoked(sessionId) {
  const normalizedId = normalizeSessionId(sessionId);
  if (!normalizedId) return;
  sessionRecordCache.set(normalizedId, REVOKED_TOMBSTONE, resolveRequestCacheTtlMs());
}

function invalidate(sessionId) {
  const normalizedId = normalizeSessionId(sessionId);
  if (!normalizedId) return;
  sessionRecordCache.delete(normalizedId);
}

function clearSessionRecordCache() {
  sessionRecordCache.clear();
}

function parseSafeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isSessionExpired(session = {}, now = new Date()) {
  const lastActive = session.lastActivityAt ? new Date(session.lastActivityAt) : null;
  const absoluteExpiry = session.absoluteExpiry ? new Date(session.absoluteExpiry) : null;
  const idleMins = parseSafeInt(session.idleTimeoutMinutes, 30);
  const idleLimitMs = idleMins * 60 * 1000;

  if (absoluteExpiry && !Number.isNaN(absoluteExpiry.getTime()) && now > absoluteExpiry) {
    return true;
  }
  if (lastActive && !Number.isNaN(lastActive.getTime()) && (now - lastActive) > idleLimitMs) {
    return true;
  }
  return false;
}

module.exports = {
  get,
  set,
  markRevoked,
  invalidate,
  clearSessionRecordCache,
  isSessionExpired,
  _sessionRecordCache: sessionRecordCache
};
