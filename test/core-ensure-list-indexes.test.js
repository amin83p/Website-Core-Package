'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runEnsureCoreListIndexes,
  TARGET_COLLECTIONS
} = require('../scripts/core/ensure-core-list-indexes');
const mongoIndexManager = require('../MVC/infrastructure/mongo/mongoIndexManager');

test('emailManagementTemplates event index uses mongo-supported partial filter', () => {
  const specs = mongoIndexManager.INDEX_DEFINITIONS.emailManagementTemplates;
  const eventIndex = specs.find((spec) => spec?.options?.name === 'idx_email_management_templates_org_event_key');
  assert.ok(eventIndex);
  const filter = JSON.stringify(eventIndex.options.partialFilterExpression);
  assert.doesNotMatch(filter, /\$ne/);
  assert.equal(eventIndex.options.partialFilterExpression.templateKind, 'event');
});

test('TARGET_COLLECTIONS includes logs for mongo-native pagination', () => {
  assert.equal(TARGET_COLLECTIONS.has('logs'), true);
});

test('runEnsureCoreListIndexes skips when mongo backend is not configured', async () => {
  const result = await runEnsureCoreListIndexes({
    args: {},
    env: {
      DATA_BACKEND: 'json',
      MONGODB_URI: '',
      MONGO_URI: ''
    }
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'mongo-not-configured');
});

function createFakeIndexDb({ duplicateSamplesByCollection = {} } = {}) {
  const dropped = [];
  const created = [];
  const aggregateCalls = [];

  return {
    dropped,
    created,
    aggregateCalls,
    collection(collectionName) {
      const indexName = collectionName === 'operations' ? 'idx_operations_id' : 'idx_sections_id';
      return {
        listIndexes() {
          return {
            async toArray() {
              return [{ name: indexName, key: { id: 1 }, unique: false }];
            }
          };
        },
        aggregate(pipeline, options) {
          aggregateCalls.push({ collectionName, pipeline, options });
          return {
            async toArray() {
              return duplicateSamplesByCollection[collectionName] || [];
            }
          };
        },
        async dropIndex(name) {
          dropped.push({ collectionName, name });
        },
        async createIndexes(indexes) {
          created.push({ collectionName, indexes });
          return indexes.map((index) => index.name);
        }
      };
    }
  };
}

test('ensureMongoIndexes repairs stale sections and operations id indexes when unique keys are clean', async () => {
  const fakeDb = createFakeIndexDb();

  const result = await mongoIndexManager.ensureMongoIndexes(fakeDb, {
    verbose: false,
    definitions: {
      sections: [
        { key: { id: 1 }, options: { name: 'idx_sections_id', unique: true } }
      ],
      operations: [
        { key: { id: 1 }, options: { name: 'idx_operations_id', unique: true } }
      ]
    }
  });

  assert.deepEqual(fakeDb.dropped, [
    { collectionName: 'sections', name: 'idx_sections_id' },
    { collectionName: 'operations', name: 'idx_operations_id' }
  ]);
  assert.equal(fakeDb.aggregateCalls.length, 2);
  assert.equal(result.collections.every((row) => row.ok), true);
});

test('ensureMongoIndexes blocks stale unique index repair when duplicate keys remain', async () => {
  const fakeDb = createFakeIndexDb({
    duplicateSamplesByCollection: {
      sections: [{ _id: { f0: '445576' }, count: 2 }]
    }
  });

  const result = await mongoIndexManager.ensureMongoIndexes(fakeDb, {
    verbose: false,
    definitions: {
      sections: [
        { key: { id: 1 }, options: { name: 'idx_sections_id', unique: true } }
      ]
    }
  });

  assert.deepEqual(fakeDb.dropped, []);
  assert.equal(result.collections.length, 1);
  assert.equal(result.collections[0].ok, false);
  assert.match(result.collections[0].error, /Cannot repair sections\.idx_sections_id as a unique index/);
});
