'use strict';

function createTtlLruCache(options = {}) {
  const name = String(options.name || 'ttl-lru-cache');
  const defaultTtlMs = Number(options.defaultTtlMs) > 0 ? Number(options.defaultTtlMs) : 60000;
  const maxEntries = Number(options.maxEntries) > 0 ? Number(options.maxEntries) : 500;
  const entries = new Map();
  let hits = 0;
  let misses = 0;

  function isExpired(entry) {
    return !entry || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= Date.now();
  }

  function touch(key, entry) {
    entries.delete(key);
    entries.set(key, entry);
  }

  function evictIfNeeded() {
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey === undefined) break;
      entries.delete(oldestKey);
    }
  }

  function get(key) {
    const normalizedKey = String(key || '');
    if (!normalizedKey) return null;
    const entry = entries.get(normalizedKey);
    if (!entry || isExpired(entry)) {
      if (entry) entries.delete(normalizedKey);
      misses += 1;
      return null;
    }
    touch(normalizedKey, entry);
    hits += 1;
    return entry.value;
  }

  function set(key, value, ttlMs) {
    const normalizedKey = String(key || '');
    if (!normalizedKey) return;
    const ttl = Number(ttlMs) > 0 ? Number(ttlMs) : defaultTtlMs;
    entries.set(normalizedKey, {
      value,
      expiresAt: Date.now() + ttl
    });
    evictIfNeeded();
  }

  function deleteKey(key) {
    entries.delete(String(key || ''));
  }

  function clear() {
    entries.clear();
  }

  function deleteByPrefix(prefix) {
    const normalizedPrefix = String(prefix || '');
    if (!normalizedPrefix) return 0;
    let removed = 0;
    for (const key of [...entries.keys()]) {
      if (key.startsWith(normalizedPrefix)) {
        entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  function deleteMatching(predicate) {
    if (typeof predicate !== 'function') return 0;
    let removed = 0;
    for (const key of [...entries.keys()]) {
      if (predicate(key)) {
        entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  function stats() {
    return {
      name,
      size: entries.size,
      maxEntries,
      defaultTtlMs,
      hits,
      misses
    };
  }

  return {
    name,
    get,
    set,
    delete: deleteKey,
    clear,
    deleteByPrefix,
    deleteMatching,
    stats
  };
}

module.exports = {
  createTtlLruCache
};
