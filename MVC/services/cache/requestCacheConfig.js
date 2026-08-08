'use strict';

const settingService = require('../settingService');

const DEFAULT_TTL_SECONDS = 900;
const DEFAULT_MAX_ENTRIES = 500;
const MIN_TTL_SECONDS = 5;
const MAX_TTL_SECONDS = 900;
const MIN_MAX_ENTRIES = 50;
const MAX_MAX_ENTRIES = 5000;

function parsePositiveInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function resolveRequestCacheTtlMs() {
  const envOverride = Number.parseInt(String(process.env.REQUEST_CACHE_TTL_MS || ''), 10);
  if (Number.isFinite(envOverride) && envOverride > 0) return envOverride;

  const fromSettings = settingService.getValue('app', 'requestCacheTtlSeconds');
  const seconds = parsePositiveInt(fromSettings, DEFAULT_TTL_SECONDS, MIN_TTL_SECONDS, MAX_TTL_SECONDS);
  return seconds * 1000;
}

function resolveRequestCacheMaxEntries() {
  const fromSettings = settingService.getValue('app', 'requestCacheMaxEntries');
  return parsePositiveInt(fromSettings, DEFAULT_MAX_ENTRIES, MIN_MAX_ENTRIES, MAX_MAX_ENTRIES);
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  DEFAULT_MAX_ENTRIES,
  MAX_TTL_SECONDS,
  resolveRequestCacheTtlMs,
  resolveRequestCacheMaxEntries
};
