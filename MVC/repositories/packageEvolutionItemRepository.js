'use strict';

const { applyGenericFilter } = require('../utils/queryEngine');
const model = require('../models/packageEvolutionItemModel');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { toPublicId } = require('../utils/idAdapter');
const {
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter
} = require('./backend/mongoRepositoryUtils');

const COLLECTION_NAME = 'packageEvolutionItems';
const DEFAULT_SEARCH_FIELDS = Object.freeze([
  'id', 'packageName', 'commitSha', 'commitShortHash', 'title', 'description', 'purpose', 'changeType', 'status', 'source'
]);
const DEFAULT_DATE_FIELDS = Object.freeze(['committedAt', 'createdAt', 'updatedAt']);

function stripPaginationFromQuery(query = {}) {
  const output = { ...(query || {}) };
  delete output.page;
  delete output.limit;
  return output;
}

async function generateMongoId(collection, requestedId = null) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;
  for (let i = 0; i < 250; i += 1) {
    const candidate = model.generateId([], 'PEVOL');
    // eslint-disable-next-line no-await-in-loop
    const exists = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!exists) return candidate;
  }
  return `PEVOL${Date.now()}`;
}

const packageEvolutionItemRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await model.getAll();
        return applyGenericFilter(rows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const query = options?.query || {};
        const filter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
        const sort = buildMongoSortFromQuery(query, options?.sort || { committedAt: -1, id: -1 });
        const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);
        let cursor = collection.find(filter);
        if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
        if (skip > 0) cursor = cursor.skip(skip);
        if (limit > 0) cursor = cursor.limit(limit);
        return (await cursor.toArray()).map((row) => normalizeMongoDocument(row)).filter(Boolean);
      }
    }, 'core.packageEvolutionItems.list');
  },

  async count(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await this.list({ ...options, query: stripPaginationFromQuery(options?.query || {}) });
        return rows.length;
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const filter = buildMongoFilterFromQuery(stripPaginationFromQuery(options?.query || {}), {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
        return collection.countDocuments(filter);
      }
    }, 'core.packageEvolutionItems.count');
  },

  async exists(options = {}) {
    const query = {
      ...(stripPaginationFromQuery(options?.query || {})),
      page: 1,
      limit: 1
    };
    const rows = await this.list({ ...options, query });
    return Array.isArray(rows) && rows.length > 0;
  },

  async getById(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => model.getById(id),
      mongo: async () => normalizeMongoDocument(
        await getMongoCollection(COLLECTION_NAME).findOne(resolveMongoIdFilter(id))
      )
    }, 'core.packageEvolutionItems.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => model.add(data),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const normalized = model.normalizePackageEvolutionItem(data, null, { strict: true });
        normalized.id = await generateMongoId(collection, normalized.id);
        await collection.insertOne(normalized);
        return normalizeMongoDocument(normalized);
      }
    }, 'core.packageEvolutionItems.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => model.update(id, data),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const existing = normalizeMongoDocument(await collection.findOne(resolveMongoIdFilter(id)));
        if (!existing) throw new Error('Package evolution item not found.');
        const normalized = model.normalizePackageEvolutionItem(data, existing);
        normalized.id = existing.id;
        await collection.updateOne(resolveMongoIdFilter(id), { $set: normalized });
        return normalized;
      }
    }, 'core.packageEvolutionItems.update');
  },

  async upsertByKey(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const result = await model.upsertByKey(data);
        return result.row;
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const normalized = model.normalizePackageEvolutionItem(data, null, { strict: false });
        if (!normalized.upsertKey) throw new Error('Upsert key is required.');
        const existing = normalizeMongoDocument(await collection.findOne({ upsertKey: normalized.upsertKey }));
        if (existing) {
          const merged = model.normalizePackageEvolutionItem(data, existing);
          merged.id = existing.id;
          merged.createdAt = existing.createdAt || merged.createdAt;
          await collection.updateOne({ id: existing.id }, { $set: merged });
          return merged;
        }
        if (!normalized.id) normalized.id = await generateMongoId(collection);
        if (!normalized.committedAt) throw new Error('committedAt is required.');
        await collection.insertOne(normalized);
        return normalizeMongoDocument(normalized);
      }
    }, 'core.packageEvolutionItems.upsertByKey');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => model.remove(id),
      mongo: async () => {
        const result = await getMongoCollection(COLLECTION_NAME).deleteOne(resolveMongoIdFilter(id));
        if (!result.deletedCount) throw new Error('Package evolution item not found.');
        return true;
      }
    }, 'core.packageEvolutionItems.remove');
  }
};

assertQueryableCrudRepository('packageEvolutionItemRepository', packageEvolutionItemRepository);

module.exports = packageEvolutionItemRepository;