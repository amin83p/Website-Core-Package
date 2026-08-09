'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function createCacheEntry(filename, exportsValue) {
  return {
    id: filename,
    filename,
    loaded: true,
    exports: exportsValue
  };
}

function createFindCursor(rows, state = {}) {
  const chain = {
    sort(sort) {
      state.sort = sort;
      return chain;
    },
    skip(n) {
      state.skip = n;
      return chain;
    },
    limit(n) {
      state.limit = n;
      return chain;
    },
    async toArray() {
      const skip = Number(state.skip || 0);
      const limit = Number(state.limit || 0);
      if (limit > 0) return rows.slice(skip, skip + limit);
      if (skip > 0) return rows.slice(skip);
      return rows;
    }
  };
  return chain;
}

function createFakeLogCollection(rows = []) {
  const state = {
    findFilter: null,
    countFilter: null,
    findState: {}
  };

  return {
    state,
    find(filter) {
      state.findFilter = filter;
      state.findState = {};
      return createFindCursor(rows, state.findState);
    },
    async countDocuments(filter) {
      state.countFilter = filter;
      return rows.length;
    },
    async findOne() {
      return rows[0] || null;
    },
    async insertOne() {
      return { acknowledged: true };
    },
    async deleteOne() {
      return { deletedCount: 0 };
    },
    async deleteMany() {
      return { deletedCount: 0 };
    },
    get collectionName() {
      return 'logs';
    },
    db: {
      async command() {
        return { size: 0 };
      }
    }
  };
}

function loadLogRepositoryWithMongoCollection(collection) {
  const repositoryPath = require.resolve('../MVC/repositories/logRepository');
  const selectorPath = require.resolve('../MVC/repositories/backend/repositoryBackendSelector');
  const mongoConnectionPath = require.resolve('../MVC/infrastructure/mongo/mongoConnection');
  const savedCache = new Map([
    [repositoryPath, require.cache[repositoryPath]],
    [selectorPath, require.cache[selectorPath]],
    [mongoConnectionPath, require.cache[mongoConnectionPath]]
  ]);

  delete require.cache[repositoryPath];
  require.cache[selectorPath] = createCacheEntry(selectorPath, {
    resolveRepositoryBackendMode: () => 'mongo',
    runByRepositoryBackend: async (_options, handlers) => handlers.mongo()
  });
  require.cache[mongoConnectionPath] = createCacheEntry(mongoConnectionPath, {
    getMongoCollection: (name) => {
      if (name !== 'logs') throw new Error(`Unexpected collection: ${name}`);
      return collection;
    }
  });

  const logRepository = require('../MVC/repositories/logRepository');

  return {
    logRepository,
    restore() {
      delete require.cache[repositoryPath];
      [repositoryPath, selectorPath, mongoConnectionPath].forEach((modulePath) => {
        const entry = savedCache.get(modulePath);
        if (entry) {
          require.cache[modulePath] = entry;
        } else {
          delete require.cache[modulePath];
        }
      });
    }
  };
}

test('logRepository mongo list applies skip/limit without loading all rows in memory', async () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({
    id: `log-${index + 1}`,
    timestamp: `2026-01-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    sectionId: '000000',
    operationId: 'OP9001',
    userId: `U-${index + 1}`,
    status: 'SUCCESS'
  }));
  const collection = createFakeLogCollection(rows);
  const { logRepository, restore } = loadLogRepositoryWithMongoCollection(collection);

  try {
    const page = await logRepository.list({
      backendMode: 'mongo',
      query: { page: 2, limit: 2 }
    });

    assert.equal(page.length, 2);
    assert.equal(page[0].id, 'log-3');
    assert.equal(page[1].id, 'log-4');
    assert.equal(collection.state.findState.skip, 2);
    assert.equal(collection.state.findState.limit, 2);
    assert.equal(collection.state.findState.sort.timestamp, -1);
    assert.ok(collection.state.findFilter);
  } finally {
    restore();
  }
});

test('logRepository mongo count uses countDocuments with query filter', async () => {
  const collection = createFakeLogCollection([
    { id: 'log-1', userId: 'U-100', timestamp: '2026-01-01T10:00:00.000Z', status: 'SUCCESS' },
    { id: 'log-2', userId: 'U-200', timestamp: '2026-01-02T10:00:00.000Z', status: 'SUCCESS' }
  ]);
  const { logRepository, restore } = loadLogRepositoryWithMongoCollection(collection);

  try {
    const total = await logRepository.count({
      backendMode: 'mongo',
      query: { userId__eq: 'U-100', page: 1, limit: 50 }
    });

    assert.equal(total, 2);
    assert.ok(collection.state.countFilter);
    assert.equal(collection.state.countFilter.userId, 'U-100');
    assert.equal(collection.state.findState.skip, undefined);
  } finally {
    restore();
  }
});

test('logRepository mongo countByUserId uses countDocuments instead of full scan list', async () => {
  const collection = createFakeLogCollection([
    { id: 'log-1', userId: 'U-100', timestamp: '2026-01-01T10:00:00.000Z', status: 'SUCCESS' }
  ]);
  const { logRepository, restore } = loadLogRepositoryWithMongoCollection(collection);

  try {
    const total = await logRepository.countByUserId('U-100');
    assert.equal(total, 1);
    assert.equal(collection.state.countFilter.userId, 'U-100');
  } finally {
    restore();
  }
});

test('mongo date filter includes ISO string bounds for string timestamps', () => {
  const { buildMongoFilterFromQuery } = require('../MVC/repositories/backend/mongoRepositoryUtils');
  const filter = buildMongoFilterFromQuery({
    startDate: '2026-08-01',
    endDate: '2026-08-10'
  }, {
    dateFields: ['timestamp']
  });

  const serialized = JSON.stringify(filter);
  assert.match(serialized, /2026-08-01T/);
  assert.match(serialized, /T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  assert.equal(serialized.includes('2026-08-01T06:00:00.000Z'), true);
});
