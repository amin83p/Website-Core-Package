// MVC/utils/entityResolver.js
const dataService = require('../services/dataService');
const { SYSTEM_CONTEXT } = require('../../config/constants');

/**
 * Resolves an entity by ID first, then falls back to Name (exact match).
 * @param {string} type - The entity type (e.g., 'sections', 'operations')
 * @param {string} identifier - The ID or Name to search for
 * @returns {Promise<Object|null>} The found entity object or null
 */
async function resolveEntity(type, identifier) {
    if (!identifier) return null;

    // 1. Try Direct ID Lookup (Fastest)
    try {
        let entity = await dataService.getDataById(type, identifier, SYSTEM_CONTEXT);
        if (entity) return entity;
    } catch (e) {
        // Ignore error if ID lookup fails (e.g. invalid format), proceed to name search
    }

    // 2. Try Name Lookup (Exact Match)
    try {
        const results = await dataService.fetchData(type, { 
            q: identifier, 
            type: 'exact_match', 
            searchFields: 'name' 
        }, SYSTEM_CONTEXT);

        if (results && results.length > 0) return results[0];
    } catch (e) {
        console.error(`Entity Resolution Error (${type}/${identifier}):`, e.message);
    }
    
    return null;
}

module.exports = { resolveEntity };