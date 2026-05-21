const scopeModel = require('../models/scopeModel');
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
  resolveMongoIdFilter,
  generateUniqueStringId,
  deepMerge
} = require('./backend/mongoRepositoryUtils');

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function buildCanViewAllFilter(scope = {}) {
  return scope?.canViewAll === false ? { id: '__NO_MATCH__' } : {};
}

async function listMongoScopes(options = {}) {
  const collection = getMongoCollection('scopes');
  const query = options?.query || {};
  const scopeFilter = buildCanViewAllFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'name', 'description'],
    dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
  });
  const filter = combineMongoFilters(scopeFilter, queryFilter);
  const sort = buildMongoSortFromQuery(query, options?.sort || null);
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);

  let cursor = collection.find(filter);
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);
  const rows = await cursor.toArray();
  return rows.map(normalizeMongoDocument).filter(Boolean);
}

const scopeRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        return scopeModel.queryScopes({
          query,
          scope: options?.scope || {},
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoScopes(options)
    }, 'core.scopes.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await scopeModel.queryScopes({
          query,
          scope: options?.scope || {},
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('scopes');
        const scopeFilter = buildCanViewAllFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['id', 'name', 'description'],
          dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.scopes.count');
  },

  async exists(options = {}) {
    const query = {
      ...(stripPaginationFromQuery(options?.query || {})),
      page: 1,
      limit: 1
    };
    const rows = await this.list({
      ...options,
      query
    });
    return Array.isArray(rows) && rows.length > 0;
  },

  async getById(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => scopeModel.getScopeById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('scopes').findOne(resolveMongoIdFilter(id)))
    }, 'core.scopes.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => scopeModel.addScope(data),
      mongo: async () => {
        const collection = getMongoCollection('scopes');
        const payload = { ...(data || {}) };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.scopes.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => scopeModel.updateScope(id, data),
      mongo: async () => {
        const collection = getMongoCollection('scopes');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Scope not found');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.scopes.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => scopeModel.deleteScope(id),
      mongo: async () => getMongoCollection('scopes').deleteOne(resolveMongoIdFilter(id))
    }, 'core.scopes.remove');
  },

  async getAllScopes() {
    return await this.list();
  },

  async getScopeById(id) {
    return await this.getById(id);
  },

  async addScope(data) {
    return await this.create(data);
  },

  async updateScope(id, data) {
    return await this.update(id, data);
  },

  async deleteScope(id) {
    return await this.remove(id);
  }
};

assertQueryableCrudRepository('scopeRepository', scopeRepository);

module.exports = scopeRepository;
