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

function createFakeCollection(record, options = {}) {
  let deletedFilter = null;
  return {
    get deletedFilter() {
      return deletedFilter;
    },
    async findOne() {
      return record;
    },
    async countDocuments() {
      return Number(options.childCount || 0);
    },
    async deleteOne(filter) {
      deletedFilter = filter;
      return { deletedCount: filter?._id === record?._id ? 1 : 0 };
    }
  };
}

function loadSchoolRepositoriesWithMongoCollections(collections) {
  const repositoryPath = require.resolve('../MVC/repositories/school');
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
      const collection = collections[name];
      if (!collection) throw new Error(`Missing fake collection: ${name}`);
      return collection;
    }
  });

  const repositories = require('../MVC/repositories/school');

  return {
    repositories,
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

[
  { label: 'student', collectionName: 'schoolStudents', purgeKey: 'students' },
  { label: 'teacher', collectionName: 'schoolTeachers', purgeKey: 'teachers' },
  { label: 'staff', collectionName: 'schoolStaff', purgeKey: 'staff' }
].forEach(({ label, collectionName, purgeKey }) => {
  test(`mongo ${label} purge deletes by raw _id and returns normalized row`, async () => {
    const rawId = { raw: `${label}-mongo-id` };
    const collection = createFakeCollection({
      _id: rawId,
      id: 'ROW-1',
      personId: 'P-1',
      orgId: 'ORG-1'
    });
    const loaded = loadSchoolRepositoriesWithMongoCollections({ [collectionName]: collection });
    try {
      const removed = await loaded.repositories[purgeKey].purgeById('ROW-1', { backendMode: 'mongo' });
      assert.equal(collection.deletedFilter._id, rawId);
      assert.deepEqual(removed, {
        id: 'ROW-1',
        personId: 'P-1',
        orgId: 'ORG-1'
      });
    } finally {
      loaded.restore();
    }
  });
});

test('mongo school account purge keeps child guard before deleting by raw _id', async () => {
  const rawId = { raw: 'account-mongo-id' };
  const collection = createFakeCollection({
    _id: rawId,
    id: 'ACC-1',
    parentId: '',
    orgId: 'ORG-1'
  }, { childCount: 1 });
  const loaded = loadSchoolRepositoriesWithMongoCollections({ schoolAccounts: collection });
  try {
    await assert.rejects(
      () => loaded.repositories.schoolAccounts.purgeById('ACC-1', { backendMode: 'mongo' }),
      /child accounts/i
    );
    assert.equal(collection.deletedFilter, null);
  } finally {
    loaded.restore();
  }
});

test('mongo school account purge deletes by raw _id when no child accounts remain', async () => {
  const rawId = { raw: 'account-mongo-id' };
  const collection = createFakeCollection({
    _id: rawId,
    id: 'ACC-1',
    parentId: '',
    orgId: 'ORG-1'
  });
  const loaded = loadSchoolRepositoriesWithMongoCollections({ schoolAccounts: collection });
  try {
    const removed = await loaded.repositories.schoolAccounts.purgeById('ACC-1', { backendMode: 'mongo' });
    assert.equal(collection.deletedFilter._id, rawId);
    assert.deepEqual(removed, {
      id: 'ACC-1',
      parentId: '',
      orgId: 'ORG-1'
    });
  } finally {
    loaded.restore();
  }
});
