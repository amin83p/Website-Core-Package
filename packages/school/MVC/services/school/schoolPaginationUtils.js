'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const settingService = requireCoreModule('MVC/services/settingService');

const COUNT_CACHE_TTL_MS = 30000;
const MAX_PAGE_SIZE = 100;
const countCache = new Map();

function toPositiveInteger(value, fallback = null) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveDefaultPageSize() {
  const configured = toPositiveInteger(settingService.getValue('app', 'defaultPageSize'), null);
  return configured || 20;
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  delete output.pageSize;
  return output;
}

function hasPaginationKeys(query = {}) {
  if (!query || typeof query !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(query, 'page')
    || Object.prototype.hasOwnProperty.call(query, 'limit')
    || Object.prototype.hasOwnProperty.call(query, 'pageSize');
}

function isUnboundedQuery(query = {}, accessContext = {}) {
  if (accessContext?.unbounded === true) return true;
  const limit = Number.parseInt(String(query?.limit ?? ''), 10);
  return Number.isFinite(limit) && limit === 0;
}

function applyDefaultFetchLimit(query = {}, accessContext = {}) {
  if (isUnboundedQuery(query, accessContext) || hasPaginationKeys(query)) {
    return { ...(query && typeof query === 'object' ? query : {}) };
  }
  return {
    ...(query && typeof query === 'object' ? query : {}),
    page: 1,
    limit: resolveDefaultPageSize()
  };
}

function clampPageLimit(limit) {
  const parsed = toPositiveInteger(limit, resolveDefaultPageSize()) || resolveDefaultPageSize();
  return Math.min(MAX_PAGE_SIZE, parsed);
}

function normalizePaginationQuery(query = {}) {
  const source = query && typeof query === 'object' ? query : {};
  const page = Math.max(1, toPositiveInteger(source.page, 1) || 1);
  const rawLimit = toPositiveInteger(source.limit ?? source.pageSize, resolveDefaultPageSize())
    || resolveDefaultPageSize();
  const limit = clampPageLimit(rawLimit);
  return { page, limit };
}

function buildPaginationMeta(totalRows = 0, page = 1, limit = 0) {
  const safeTotal = Math.max(0, Number(totalRows) || 0);
  const safeLimit = Math.max(1, Number(limit) || resolveDefaultPageSize());
  const totalPages = Math.max(1, Math.ceil(safeTotal / safeLimit));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const startIndex = (currentPage - 1) * safeLimit;
  const endIndex = Math.min(startIndex + safeLimit, safeTotal);
  return {
    currentPage,
    totalPages,
    totalItems: safeTotal,
    limit: safeLimit,
    startItem: safeTotal > 0 ? startIndex + 1 : 0,
    endItem: endIndex
  };
}

function buildCountCacheKey(entityType, normalizedQuery = {}, scope = {}) {
  return JSON.stringify({
    entityType: String(entityType || ''),
    query: normalizedQuery && typeof normalizedQuery === 'object' ? normalizedQuery : {},
    scope: scope && typeof scope === 'object' ? scope : {}
  });
}

function getCachedCountValue(cacheKey = '') {
  const key = String(cacheKey || '').trim();
  if (!key) return null;
  const row = countCache.get(key);
  if (!row) return null;
  const now = Date.now();
  if (!Number.isFinite(row?.expiresAt) || row.expiresAt <= now) {
    countCache.delete(key);
    return null;
  }
  return Number(row?.value || 0);
}

function setCachedCountValue(cacheKey = '', value = 0) {
  const key = String(cacheKey || '').trim();
  if (!key) return;
  countCache.set(key, {
    value: Number(value || 0),
    expiresAt: Date.now() + COUNT_CACHE_TTL_MS
  });
}

function clearSchoolCountCache() {
  countCache.clear();
}

function buildUnboundedQuery(query = {}) {
  return {
    ...(query && typeof query === 'object' ? query : {}),
    limit: 0
  };
}

module.exports = {
  MAX_PAGE_SIZE,
  resolveDefaultPageSize,
  stripPaginationFromQuery,
  hasPaginationKeys,
  isUnboundedQuery,
  applyDefaultFetchLimit,
  clampPageLimit,
  normalizePaginationQuery,
  buildPaginationMeta,
  buildCountCacheKey,
  getCachedCountValue,
  setCachedCountValue,
  clearSchoolCountCache,
  buildUnboundedQuery
};
