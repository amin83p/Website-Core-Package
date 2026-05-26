const packageDataOwnershipModel = require('../models/packageDataOwnershipModel');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const {
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters
} = require('./backend/mongoRepositoryUtils');

const COLLECTION_NAME = 'packageDataOwnershipRegistry';
const DEFAULT_SEARCH_FIELDS = Object.freeze(['id', 'entityType', 'identityKey', 'packageId', 'packageVersion']);
const DEFAULT_DATE_FIELDS = Object.freeze(['updatedAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']);

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeOwnershipIdentity(entityType = '', identityKey = '') {
  return packageDataOwnershipModel.normalizeOwnershipIdentity(entityType, identityKey);
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
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
  return rows.map((row) => packageDataOwnershipModel.normalizePersistedOwnershipRow(normalizeMongoDocument(row)));
}

const packageDataOwnershipRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => packageDataOwnershipModel.queryRows({ query: options?.query || {} }),
      mongo: async () => listMongoRows(options)
    }, 'core.packageDataOwnership.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await packageDataOwnershipModel.queryRows({ query });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
        const filter = combineMongoFilters(queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.packageDataOwnership.count');
  },

  async getByIdentity(entityType = '', identityKey = '', options = {}) {
    const id = normalizeOwnershipIdentity(entityType, identityKey);
    if (!id || id === '::') return null;
    return runByRepositoryBackend(options, {
      json: async () => packageDataOwnershipModel.getById(id),
      mongo: async () => {
        const row = await getMongoCollection(COLLECTION_NAME).findOne({ id });
        return row ? packageDataOwnershipModel.normalizePersistedOwnershipRow(normalizeMongoDocument(row)) : null;
      }
    }, 'core.packageDataOwnership.getByIdentity');
  },

  async upsertByIdentity(entityType = '', identityKey = '', patch = {}, options = {}) {
    const id = normalizeOwnershipIdentity(entityType, identityKey);
    if (!id || id === '::') throw new Error('entityType and identityKey are required.');
    return runByRepositoryBackend(options, {
      json: async () => packageDataOwnershipModel.upsertByIdentity(entityType, identityKey, patch, { actor: options?.actor || null }),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const existing = await collection.findOne({ id });
        const existingNormalized = existing
          ? packageDataOwnershipModel.normalizePersistedOwnershipRow(normalizeMongoDocument(existing))
          : null;
        const normalized = packageDataOwnershipModel.normalizeOwnershipRow({
          ...patch,
          id,
          ownershipId: id,
          entityType,
          identityKey
        }, existingNormalized, { actor: options?.actor || null });
        if (existing && existing._id) {
          await collection.updateOne({ _id: existing._id }, { $set: normalized });
          const fresh = await collection.findOne({ _id: existing._id });
          return packageDataOwnershipModel.normalizePersistedOwnershipRow(normalizeMongoDocument(fresh));
        }
        await collection.insertOne(normalized);
        return packageDataOwnershipModel.normalizePersistedOwnershipRow(normalized);
      }
    }, 'core.packageDataOwnership.upsertByIdentity');
  }
};

module.exports = packageDataOwnershipRepository;
