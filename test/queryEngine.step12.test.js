const test = require('node:test');
const assert = require('node:assert/strict');

const { applyGenericFilter } = require('../MVC/utils/queryEngine');
const { normalizeQueryOptions } = require('../MVC/utils/queryOptionsAdapter');

test('normalizeQueryOptions maps structured payload to legacy query shape', () => {
  const normalized = normalizeQueryOptions({
    filters: {
      status: 'active',
      orgId__in: ['10', '11']
    },
    search: {
      text: 'amin',
      type: 'contains',
      fields: ['username', 'email']
    },
    sort: {
      field: 'createdAt',
      order: 'desc'
    },
    pagination: {
      page: 2,
      pageSize: 5
    }
  });

  assert.deepEqual(normalized, {
    status: 'active',
    orgId__in: ['10', '11'],
    q: 'amin',
    type: 'contains',
    searchFields: ['username', 'email'],
    sort: 'createdAt',
    order: 'desc',
    page: 2,
    limit: 5
  });
});

test('applyGenericFilter supports sort and pagination controls', () => {
  const rows = [
    { id: '1', score: 3, createdAt: '2026-02-01T00:00:00.000Z' },
    { id: '2', score: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: '3', score: 2, createdAt: '2026-03-01T00:00:00.000Z' },
    { id: '4', score: 4, createdAt: '2026-04-01T00:00:00.000Z' }
  ];

  const page1 = applyGenericFilter(rows, {
    sort: '-score',
    page: 1,
    limit: 2
  });
  const page2 = applyGenericFilter(rows, {
    sort: '-score',
    page: 2,
    limit: 2
  });

  assert.deepEqual(page1.map((row) => row.id), ['4', '1']);
  assert.deepEqual(page2.map((row) => row.id), ['3', '2']);
});
