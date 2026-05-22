const packageRegistryModel = require('../models/packageRegistryModel');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const {
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter
} = require('./backend/mongoRepositoryUtils');

const COLLECTION_NAME = 'packageRegistries';
const DEFAULT_SEARCH_FIELDS = Object.freeze([
  'id',
  'packageId',
  'version',
  'installStatus',
  'lastError',
  'lastWarning'
]);
const DEFAULT_DATE_FIELDS = Object.freeze([
  'installedAt',
  'updatedAt',
  'audit.createDateTime',
  'audit.lastUpdateDateTime'
]);

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function normalizePackageId(value = '') {
  return packageRegistryModel.normalizePackageId(value);
}

function normalizeMongoRegistryRow(raw = {}, existing = null, options = {}) {
  const normalized = packageRegistryModel.normalizePackageRegistryRow(raw, existing, options);
  const { _id, ...rest } = normalized;
  return rest;
}

async function listMongoRows(options = {}) {
  const collection = getMongoCollection(COLLECTION_NAME);
  const query = options?.query || {};
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: DEFAULT_SEARCH_FIELDS,
    dateFields: DEFAULT_DATE_FIELDS
  });
  const filter = combineMongoFilters(queryFilter);
  const sort = buildMongoSortFromQuery(query, options?.sort || { updatedAt: -1, id: 1 });
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);

  let cursor = collection.find(filter);
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const rows = await cursor.toArray();
  return rows.map((row) => normalizeMongoDocument(row)).filter(Boolean);
}

const packageRegistryRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => packageRegistryModel.queryPackageRegistryRows({
        query: options?.query || {}
      }),
      mongo: async () => listMongoRows(options)
    }, 'core.packageRegistry.list');
  },

  async count(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await packageRegistryModel.queryPackageRegistryRows({
          query: stripPaginationFromQuery(options?.query || {})
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const queryFilter = buildMongoFilterFromQuery(stripPaginationFromQuery(options?.query || {}), {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
        const filter = combineMongoFilters(queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.packageRegistry.count');
  },

  async getById(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => packageRegistryModel.getPackageRegistryByPackageId(id),
      mongo: async () => {
        const row = await getMongoCollection(COLLECTION_NAME).findOne(resolveMongoIdFilter(id));
        return normalizeMongoDocument(row);
      }
    }, 'core.packageRegistry.getById');
  },

  async getByPackageId(packageId, options = {}) {
    const token = normalizePackageId(packageId);
    if (!token) return null;
    return runByRepositoryBackend(options, {
      json: async () => packageRegistryModel.getPackageRegistryByPackageId(token),
      mongo: async () => {
        const row = await getMongoCollection(COLLECTION_NAME).findOne({ packageId: token });
        return normalizeMongoDocument(row);
      }
    }, 'core.packageRegistry.getByPackageId');
  },

  async upsertByPackageId(packageId, patch = {}, options = {}) {
    const token = normalizePackageId(packageId);
    if (!token) throw new Error('packageId is required.');

    return runByRepositoryBackend(options, {
      json: async () => packageRegistryModel.upsertPackageRegistry({
        ...patch,
        packageId: token
      }, { actor: options?.actor || null }),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const existing = await collection.findOne({ packageId: token });
        const existingNormalized = normalizeMongoDocument(existing);
        const merged = normalizeMongoRegistryRow(
          { ...patch, packageId: token },
          existingNormalized,
          { actor: options?.actor || null }
        );

        if (existing && existing._id) {
          await collection.updateOne({ _id: existing._id }, { $set: merged });
          const fresh = await collection.findOne({ _id: existing._id });
          return normalizeMongoDocument(fresh);
        }

        await collection.insertOne(merged);
        return normalizeMongoDocument(merged);
      }
    }, 'core.packageRegistry.upsertByPackageId');
  },

  async removeByPackageId(packageId, options = {}) {
    const token = normalizePackageId(packageId);
    if (!token) return false;

    return runByRepositoryBackend(options, {
      json: async () => packageRegistryModel.removePackageRegistryByPackageId(token),
      mongo: async () => {
        const result = await getMongoCollection(COLLECTION_NAME).deleteOne({
          packageId: token
        });
        return Number(result?.deletedCount || 0) > 0;
      }
    }, 'core.packageRegistry.removeByPackageId');
  }
};

module.exports = packageRegistryRepository;
