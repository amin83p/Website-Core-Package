'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const dataService = require('../MVC/services/dataService');
const catalogCacheService = require('../MVC/services/cache/sectionsOperationsCatalogCacheService');
const dashboardFilteredCacheService = require('../MVC/services/cache/dashboardFilteredSectionsCacheService');
const { SYSTEM_CONTEXT } = require('../config/constants');

test('sections catalog cache avoids repeated fetchData until invalidate', async () => {
  const originalFetchData = dataService.fetchData;
  let sectionFetches = 0;

  dataService.fetchData = async (entityType, query, requestingUser) => {
    if (entityType === 'sections' && requestingUser === SYSTEM_CONTEXT) {
      sectionFetches += 1;
      return [{ id: 'SEC_TEST', name: 'TEST_SECTION', category: 'GENERAL', active: true }];
    }
    return originalFetchData(entityType, query, requestingUser);
  };

  try {
    catalogCacheService.invalidateAllCatalogs();

    const first = await catalogCacheService.getCatalogSections();
    const second = await catalogCacheService.getCatalogSections();
    assert.equal(sectionFetches, 1);
    assert.equal(first[0]?.id, 'SEC_TEST');
    assert.equal(second[0]?.id, 'SEC_TEST');

    catalogCacheService.invalidateSectionsCatalog();
    await catalogCacheService.getCatalogSections();
    assert.equal(sectionFetches, 2);
  } finally {
    dataService.fetchData = originalFetchData;
    catalogCacheService.invalidateAllCatalogs();
  }
});

test('invalidateSectionsCatalog clears dashboard filtered section cache', () => {
  catalogCacheService.invalidateAllCatalogs();
  const cacheKey = dashboardFilteredCacheService.buildDashboardAllSectionsCacheKey({ id: 'USR1' });
  dashboardFilteredCacheService.writeDashboardAllSectionsCache(cacheKey, [{ id: 'ROW1' }]);
  assert.ok(dashboardFilteredCacheService.readDashboardAllSectionsCache(cacheKey));

  catalogCacheService.invalidateSectionsCatalog();
  assert.equal(dashboardFilteredCacheService.readDashboardAllSectionsCache(cacheKey), null);
});

test('filterSectionsByScope limits rows for scoped section ids', () => {
  const rows = [
    { id: 'SEC_A', name: 'SEC_A', category: 'GENERAL', active: true },
    { id: 'SEC_B', name: 'SEC_B', category: 'SCHOOL', active: true }
  ];
  const scoped = catalogCacheService.filterSectionsByScope(rows, {
    canViewAll: false,
    sectionIds: ['SEC_B'],
    categories: []
  });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].id, 'SEC_B');
});
