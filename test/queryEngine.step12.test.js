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

test('applyGenericFilter treats sortBy and sortDir as sort controls, not field filters', () => {
  const rows = [
    { id: '1', nextRunAt: '2026-08-31T08:00:00.000Z', label: 'Later' },
    { id: '2', nextRunAt: '2026-08-30T08:00:00.000Z', label: 'Earlier' }
  ];

  const sorted = applyGenericFilter(rows, {
    sortBy: 'nextRunAt',
    sortDir: 'asc',
    page: 1,
    limit: 30
  });

  assert.equal(sorted.length, 2);
  assert.deepEqual(sorted.map((row) => row.id), ['2', '1']);
});

test('buildMongoFilterFromQuery ignores sortBy and sortDir query keys', () => {
  const { buildMongoFilterFromQuery } = require('../MVC/repositories/backend/mongoRepositoryUtils');
  const filter = buildMongoFilterFromQuery({
    sortBy: 'nextRunAt',
    sortDir: 'asc',
    page: 1,
    limit: 30
  });

  assert.deepEqual(filter, {});
});

test('applyGenericFilter supports lte and gte comparison operators', () => {
  const rows = [
    { id: '1', nextRunAt: '2026-08-30T10:00:00.000Z', enabled: true, paused: false },
    { id: '2', nextRunAt: '2026-08-31T10:00:00.000Z', enabled: true, paused: false }
  ];

  const due = applyGenericFilter(rows, {
    enabled__eq: true,
    paused__eq: false,
    nextRunAt__lte: '2026-08-30T12:00:00.000Z',
    sortBy: 'nextRunAt',
    sortDir: 'asc',
    page: 1,
    limit: 200
  });

  assert.deepEqual(due.map((row) => row.id), ['1']);
});

test('buildMongoFilterFromQuery supports lte comparison operators', () => {
  const { buildMongoFilterFromQuery } = require('../MVC/repositories/backend/mongoRepositoryUtils');
  const filter = buildMongoFilterFromQuery({
    enabled__eq: true,
    paused__eq: false,
    nextRunAt__lte: '2026-08-30T12:00:00.000Z'
  });

  assert.deepEqual(filter, {
    $and: [
      { enabled: { $in: [true, 'true'] } },
      { paused: { $in: [false, 'false'] } },
      { nextRunAt: { $lte: '2026-08-30T12:00:00.000Z' } }
    ]
  });
});
