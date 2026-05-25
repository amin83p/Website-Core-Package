const test = require('node:test');
const assert = require('node:assert/strict');

function setRequireStub(modulePath, exportsValue, originals) {
  const resolved = require.resolve(modulePath);
  if (!originals.has(resolved)) originals.set(resolved, require.cache[resolved]);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue
  };
}

function cloneRow(row = {}) {
  return JSON.parse(JSON.stringify(row));
}

function createAsyncCursor(rows = []) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) {
        yield cloneRow(row);
      }
    }
  };
}

async function withStubbedMigrationService(options, callback) {
  const servicePath = require.resolve('../MVC/services/migration/jsonToMongoMigrationService');
  const originals = new Map();
  if (!originals.has(servicePath)) originals.set(servicePath, require.cache[servicePath]);
  delete require.cache[servicePath];

  const state = {
    sourceConnected: 0,
    lastDestinationUri: '',
    lastDestinationDbName: '',
    destinationClosed: 0
  };

  const sourceCollections = Array.isArray(options?.sourceCollections)
    ? options.sourceCollections
    : ['users'];
  const sourceDocsByCollection = options?.sourceDocsByCollection || {
    users: [{ _id: 'U1', name: 'User 1' }]
  };
  const destinationDocsSeed = options?.destinationDocsByCollection || {
    users: [{ _id: 'OLD1', name: 'Old User' }]
  };
  const destinationDocsByCollection = new Map(
    Object.entries(destinationDocsSeed).map(([name, rows]) => [
      name,
      (Array.isArray(rows) ? rows : []).map(cloneRow)
    ])
  );

  function getDestinationDocs(collectionName) {
    if (!destinationDocsByCollection.has(collectionName)) {
      destinationDocsByCollection.set(collectionName, []);
    }
    return destinationDocsByCollection.get(collectionName);
  }

  const sourceDb = {
    databaseName: options?.sourceDbName || 'sourceDb',
    listCollections(filter = {}) {
      if (filter && filter.name) {
        return {
          async hasNext() {
            return sourceCollections.includes(String(filter.name));
          }
        };
      }
      return {
        async toArray() {
          return sourceCollections.map((name) => ({ name }));
        }
      };
    },
    collection(collectionName) {
      const rows = Array.isArray(sourceDocsByCollection[collectionName])
        ? sourceDocsByCollection[collectionName]
        : [];
      return {
        async countDocuments() {
          return rows.length;
        },
        find() {
          return createAsyncCursor(rows);
        }
      };
    }
  };

  class MockMongoClient {
    constructor(uri) {
      this.uri = uri;
      state.lastDestinationUri = String(uri || '');
    }

    async connect() {
      return this;
    }

    db(dbName) {
      state.lastDestinationDbName = String(dbName || '');
      return {
        collection(collectionName) {
          return {
            async countDocuments() {
              return getDestinationDocs(collectionName).length;
            },
            async deleteMany() {
              const docs = getDestinationDocs(collectionName);
              const deletedCount = docs.length;
              destinationDocsByCollection.set(collectionName, []);
              return { deletedCount };
            },
            async insertMany(rows) {
              const docs = getDestinationDocs(collectionName);
              const batch = Array.isArray(rows) ? rows.map(cloneRow) : [];
              batch.forEach((row) => docs.push(row));
              return {
                insertedCount: batch.length,
                insertedIds: Object.fromEntries(batch.map((row, index) => [index, row._id || index]))
              };
            }
          };
        }
      };
    }

    async close() {
      state.destinationClosed += 1;
    }
  }

  setRequireStub('../config/dataBackend', {
    resolveDataBackendConfig() {
      return {
        mongo: {
          ready: true,
          uri: options?.sourceUri || 'mongodb+srv://src:pw@source.example.net/sourceDb'
        }
      };
    }
  }, originals);
  setRequireStub('../MVC/infrastructure/mongo/mongoConnection', {
    async connectMongo() {
      state.sourceConnected += 1;
      return sourceDb;
    },
    getMongoDbOrNull() {
      return sourceDb;
    },
    getMongoCollection(collectionName) {
      return sourceDb.collection(collectionName);
    }
  }, originals);
  setRequireStub('mongodb', { MongoClient: MockMongoClient }, originals);

  try {
    const service = require('../MVC/services/migration/jsonToMongoMigrationService');
    return await callback({ service, state });
  } finally {
    delete require.cache[servicePath];
    originals.forEach((original, resolved) => {
      if (original) require.cache[resolved] = original;
      else delete require.cache[resolved];
    });
  }
}

test('overwriteCollectionToDestination rejects invalid collection names', async () => {
  await withStubbedMigrationService({}, async ({ service }) => {
    await assert.rejects(
      () => service.overwriteCollectionToDestination({
        collectionName: 'invalid collection name',
        destinationUri: 'mongodb+srv://dest:pw@dest.example.net/targetDb'
      }),
      /invalid characters/i
    );
  });
});

test('overwriteCollectionToDestination falls back destination DB to source DB when URI omits DB', async () => {
  await withStubbedMigrationService({
    sourceDbName: 'sourceDb',
    sourceUri: 'mongodb+srv://src:pw@source.example.net/sourceDb',
    sourceCollections: ['users'],
    sourceDocsByCollection: {
      users: [
        { _id: 'U1', name: 'User 1' },
        { _id: 'U2', name: 'User 2' }
      ]
    },
    destinationDocsByCollection: {
      users: [{ _id: 'OLD1', name: 'Old User' }]
    }
  }, async ({ service, state }) => {
    const report = await service.overwriteCollectionToDestination({
      collectionName: 'users',
      destinationUri: 'mongodb+srv://dest:pw@dest.example.net'
    });

    assert.equal(report.destinationDbName, 'sourceDb');
    assert.equal(state.lastDestinationDbName, 'sourceDb');
    assert.equal(report.sourceCount, 2);
    assert.equal(report.deletedCount, 1);
    assert.equal(report.insertedCount, 2);
    assert.equal(report.destinationAfterCount, 2);
  });
});

test('overwriteCollectionToDestination blocks same source and destination target', async () => {
  const sourceUri = 'mongodb+srv://same:pw@cluster.example.net/sourceDb';
  await withStubbedMigrationService({
    sourceDbName: 'sourceDb',
    sourceUri,
    sourceCollections: ['users'],
    sourceDocsByCollection: {
      users: [{ _id: 'U1', name: 'User 1' }]
    }
  }, async ({ service }) => {
    await assert.rejects(
      () => service.overwriteCollectionToDestination({
        collectionName: 'users',
        destinationUri: sourceUri
      }),
      /same database target/i
    );
  });
});

test('overwriteCollectionToDestination returns structured report fields', async () => {
  await withStubbedMigrationService({
    sourceDbName: 'sourceDb',
    sourceUri: 'mongodb+srv://src:pw@source.example.net/sourceDb',
    sourceCollections: ['users'],
    sourceDocsByCollection: {
      users: [
        { _id: 'U1', name: 'User 1' },
        { _id: 'U2', name: 'User 2' },
        { _id: 'U3', name: 'User 3' }
      ]
    },
    destinationDocsByCollection: {
      users: [{ _id: 'OLD1' }, { _id: 'OLD2' }]
    }
  }, async ({ service }) => {
    const report = await service.overwriteCollectionToDestination({
      collectionName: 'users',
      destinationUri: 'mongodb+srv://dest:pw@dest.example.net/targetDb'
    });

    assert.equal(report.collection, 'users');
    assert.equal(report.sourceDbName, 'sourceDb');
    assert.equal(report.destinationDbName, 'targetDb');
    assert.equal(report.sourceCount, 3);
    assert.equal(report.destinationBeforeCount, 2);
    assert.equal(report.deletedCount, 2);
    assert.equal(report.insertedCount, 3);
    assert.equal(report.destinationAfterCount, 3);
    assert.ok(Number(report.durationMs) >= 0);
    assert.ok(Array.isArray(report.warnings));
  });
});
