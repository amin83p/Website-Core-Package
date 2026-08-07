'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveDefaultPageSize,
  normalizePaginationQuery,
  buildPaginationMeta,
  applyDefaultFetchLimit,
  buildUnboundedQuery,
  clearSchoolCountCache
} = require('../MVC/services/school/schoolPaginationUtils');

const schoolDataService = require('../MVC/services/school/schoolDataService');

function withSettingsStub(pageSize, fn) {
  const settingService = require('../../../MVC/services/settingService');
  const originalGetValue = settingService.getValue;
  settingService.getValue = (section, key) => {
    if (section === 'app' && key === 'defaultPageSize') return String(pageSize);
    return originalGetValue(section, key);
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      settingService.getValue = originalGetValue;
      clearSchoolCountCache();
    });
}

test('normalizePaginationQuery uses configured default page size', () => withSettingsStub(30, async () => {
  assert.deepEqual(normalizePaginationQuery({}), { page: 1, limit: 30 });
  assert.deepEqual(normalizePaginationQuery({ page: 2, limit: 50 }), { page: 2, limit: 50 });
  assert.deepEqual(normalizePaginationQuery({ page: 1, limit: 500 }), { page: 1, limit: 100 });
}));

test('buildPaginationMeta matches core pagination shape', () => {
  const meta = buildPaginationMeta(95, 2, 30);
  assert.equal(meta.currentPage, 2);
  assert.equal(meta.totalPages, 4);
  assert.equal(meta.totalItems, 95);
  assert.equal(meta.limit, 30);
  assert.equal(meta.startItem, 31);
  assert.equal(meta.endItem, 60);
});

test('applyDefaultFetchLimit injects page size unless unbounded', () => withSettingsStub(30, async () => {
  assert.deepEqual(applyDefaultFetchLimit({}, {}), { page: 1, limit: 30 });
  assert.deepEqual(applyDefaultFetchLimit({ limit: 0 }, {}), { limit: 0 });
  assert.deepEqual(applyDefaultFetchLimit({}, { unbounded: true }), {});
  assert.deepEqual(applyDefaultFetchLimit({ page: 2 }, {}), { page: 2 });
}));

test('schoolDataService exposes pagination APIs', () => {
  assert.equal(typeof schoolDataService.fetchDataPaged, 'function');
  assert.equal(typeof schoolDataService.countData, 'function');
  assert.equal(typeof schoolDataService.fetchAllData, 'function');
  assert.equal(typeof schoolDataService.clearSchoolCountCache, 'function');
});

test('buildUnboundedQuery sets limit zero', () => {
  assert.deepEqual(buildUnboundedQuery({ orgId__eq: 'ORG_1' }), { orgId__eq: 'ORG_1', limit: 0 });
});
