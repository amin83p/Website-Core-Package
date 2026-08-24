// MVC/utils/entityResolver.js

const DATA_SERVICE_PATH = '../services/dataService';

function getCatalogCacheService() {
  return require('../services/cache/sectionsOperationsCatalogCacheService');
}

function getCachedDataService() {
  const modulePath = require.resolve(DATA_SERVICE_PATH);
  const cached = require.cache[modulePath];
  if (cached?.loaded && cached.exports) return cached.exports;
  return null;
}

async function resolveDataServiceWithRetry(maxAttempts = 8) {
  let dataService = getCachedDataService();
  if (dataService) return dataService;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      require(DATA_SERVICE_PATH);
    } catch (error) {
      console.error('Entity Resolution Error: failed to require dataService module:', error.message);
      break;
    }

    dataService = getCachedDataService();
    if (dataService) return dataService;

    if (attempt < maxAttempts) {
      const waitMs = Math.min(8 + (attempt * 4), 40);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  return getCachedDataService();
}

async function resolveCatalogEntity(type, identifier) {
  if (!identifier) return null;
  const catalogCacheService = getCatalogCacheService();
  if (type === 'sections') {
    const byId = await catalogCacheService.findSectionById(identifier);
    if (byId) return byId;
    return await catalogCacheService.findSectionByName(identifier);
  }
  if (type === 'operations') {
    const byId = await catalogCacheService.findOperationById(identifier);
    if (byId) return byId;
    return await catalogCacheService.findOperationByName(identifier);
  }
  return null;
}

/**
 * Resolves an entity by ID first, then falls back to Name (exact match).
 * @param {string} type - The entity type (e.g., 'sections', 'operations')
 * @param {string} identifier - The ID or Name to search for
 * @returns {Promise<Object|null>} The found entity object or null
 */
async function resolveEntity(type, identifier) {
    if (!identifier) return null;

    if (type === 'sections' || type === 'operations') {
      try {
        return await resolveCatalogEntity(type, identifier);
      } catch (error) {
        console.error(`Entity Resolution Error (${type}/${identifier}):`, error.message);
        return null;
      }
    }

    const dataService = await resolveDataServiceWithRetry();
    if (!dataService) {
      console.error(`Entity Resolution Error (${type}/${identifier}): dataService not available yet`);
      return null;
    }

    const { SYSTEM_CONTEXT } = require('../../config/constants');

    try {
        if (typeof dataService.getDataById !== 'function') {
          throw new Error('dataService.getDataById is not a function');
        }
        let entity = await dataService.getDataById(type, identifier, SYSTEM_CONTEXT);
        if (entity) return entity;
    } catch (e) {
        if (e?.message === 'dataService.getDataById is not a function') {
          console.error(`Entity Resolution Error (${type}/${identifier}): dataService.getDataById is not available`);
          return null;
        }
    }

    try {
        if (typeof dataService.fetchData !== 'function') {
          throw new Error('dataService.fetchData is not a function');
        }
        const results = await dataService.fetchData(type, {
            q: identifier,
            type: 'exact_match',
            searchFields: 'name'
        }, SYSTEM_CONTEXT);

        if (results && results.length > 0) return results[0];
    } catch (e) {
        if (e?.message === 'dataService.fetchData is not a function') {
          console.error(`Entity Resolution Error (${type}/${identifier}): dataService.fetchData is not available`);
          return null;
        }
        console.error(`Entity Resolution Error (${type}/${identifier}):`, e.message);
    }

    return null;
}

module.exports = { resolveEntity };
