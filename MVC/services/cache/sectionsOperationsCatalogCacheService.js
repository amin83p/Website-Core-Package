'use strict';

const { SYSTEM_CONTEXT } = require('../../../config/constants');
const { createTtlLruCache } = require('./ttlLruCache');
const { cloneCacheValue } = require('./cacheClone');
const { resolveRequestCacheTtlMs } = require('./requestCacheConfig');
const { idsEqual, toIdArray } = require('../../utils/idAdapter');
const { clearDashboardFilteredSectionsCache } = require('./dashboardFilteredSectionsCacheService');

function getBuildSectionScope() {
  return require('../security/dataScopeBuilder').buildSectionScope;
}

function getDataService() {
  return require('../dataService');
}

const SECTIONS_CATALOG_KEY = 'sections:catalog';
const OPERATIONS_CATALOG_KEY = 'operations:catalog';

const catalogCache = createTtlLruCache({
  name: 'sections-operations-catalog-cache',
  maxEntries: 4,
  defaultTtlMs: resolveRequestCacheTtlMs()
});

function filterSectionsByScope(rows = [], scope = {}) {
  if (!Array.isArray(rows)) return [];
  if (scope?.canViewAll !== false) return rows.slice();

  const categories = Array.isArray(scope?.categories)
    ? scope.categories.map((c) => String(c || '').trim()).filter(Boolean)
    : [];
  const sectionIds = toIdArray(scope?.sectionIds || []);
  const excludedSectionIds = toIdArray(scope?.excludedSectionIds || []);

  if (!categories.length && !sectionIds.length) return [];

  return rows.filter((row) => {
    const id = String(row?.id || '').trim();
    if (!id) return false;
    if (excludedSectionIds.some((excludedId) => idsEqual(excludedId, id))) return false;

    const category = String(row?.category || '').trim();
    const categoryMatch = categories.length > 0 && categories.includes(category);
    const idMatch = sectionIds.length > 0 && sectionIds.some((sectionId) => idsEqual(sectionId, id));

    if (!categories.length) return idMatch;
    if (!sectionIds.length) return categoryMatch;
    return categoryMatch || idMatch;
  });
}

async function loadSectionsCatalogFromDb() {
  const rows = await getDataService().fetchData('sections', {}, SYSTEM_CONTEXT);
  return Array.isArray(rows) ? rows : [];
}

async function loadOperationsCatalogFromDb() {
  const rows = await getDataService().fetchData('operations', {}, SYSTEM_CONTEXT);
  return Array.isArray(rows) ? rows : [];
}

async function getCatalogSections() {
  const cached = catalogCache.get(SECTIONS_CATALOG_KEY);
  if (cached) return cloneCacheValue(cached);

  const rows = await loadSectionsCatalogFromDb();
  catalogCache.set(SECTIONS_CATALOG_KEY, rows, resolveRequestCacheTtlMs());
  return cloneCacheValue(rows);
}

async function getCatalogOperations() {
  const cached = catalogCache.get(OPERATIONS_CATALOG_KEY);
  if (cached) return cloneCacheValue(cached);

  const rows = await loadOperationsCatalogFromDb();
  catalogCache.set(OPERATIONS_CATALOG_KEY, rows, resolveRequestCacheTtlMs());
  return cloneCacheValue(rows);
}

async function getSectionsForUser(user) {
  const catalog = await getCatalogSections();
  const scope = getBuildSectionScope()(user);
  return filterSectionsByScope(catalog, scope);
}

async function getOperationsForUser(_user) {
  return await getCatalogOperations();
}

async function findSectionById(identifier) {
  const catalog = await getCatalogSections();
  const needle = String(identifier || '').trim();
  if (!needle) return null;
  return catalog.find((row) => idsEqual(row?.id, needle)) || null;
}

async function findSectionByName(identifier) {
  const catalog = await getCatalogSections();
  const needle = String(identifier || '').trim().toUpperCase();
  if (!needle) return null;
  return catalog.find((row) => String(row?.name || '').trim().toUpperCase() === needle) || null;
}

async function findOperationById(identifier) {
  const catalog = await getCatalogOperations();
  const needle = String(identifier || '').trim();
  if (!needle) return null;
  return catalog.find((row) => idsEqual(row?.id, needle)) || null;
}

async function findOperationByName(identifier) {
  const catalog = await getCatalogOperations();
  const needle = String(identifier || '').trim().toUpperCase();
  if (!needle) return null;
  return catalog.find((row) => String(row?.name || '').trim().toUpperCase() === needle) || null;
}

function invalidateSectionsCatalog() {
  catalogCache.delete(SECTIONS_CATALOG_KEY);
  clearDashboardFilteredSectionsCache();
}

function invalidateOperationsCatalog() {
  catalogCache.delete(OPERATIONS_CATALOG_KEY);
}

function invalidateAllCatalogs() {
  catalogCache.clear();
  clearDashboardFilteredSectionsCache();
}

function clearSectionsOperationsCatalogCache() {
  invalidateAllCatalogs();
}

module.exports = {
  getCatalogSections,
  getCatalogOperations,
  getSectionsForUser,
  getOperationsForUser,
  findSectionById,
  findSectionByName,
  findOperationById,
  findOperationByName,
  invalidateSectionsCatalog,
  invalidateOperationsCatalog,
  invalidateAllCatalogs,
  clearSectionsOperationsCatalogCache,
  filterSectionsByScope,
  _catalogCache: catalogCache
};
