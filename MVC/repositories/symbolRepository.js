const symbolModel = require('../models/symbolModel');
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

function buildSymbolScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const includeGlobal = scope?.includeGlobal !== false;
  const orgId = toPublicId(scope?.orgId);
  const clauses = [];
  if (includeGlobal) {
    clauses.push({ $or: [{ orgId: { $exists: false } }, { orgId: null }, { orgId: '' }, { orgId: 'SYSTEM' }] });
  }
  if (orgId) clauses.push({ orgId });
  if (!clauses.length) return { id: '__NO_MATCH__' };
  if (clauses.length === 1) return clauses[0];
  return { $or: clauses };
}

async function listMongoSymbols(options = {}) {
  const collection = getMongoCollection('symbols');
  const query = options?.query || {};
  const scopeFilter = buildSymbolScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'name', 'title', 'group', 'orgId'],
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

const symbolRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        return symbolModel.querySymbols({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoSymbols(options)
    }, 'core.symbols.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const scope = options?.scope || {};
        const rows = await symbolModel.querySymbols({
          query,
          scope,
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('symbols');
        const scopeFilter = buildSymbolScopeFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['id', 'name', 'title', 'group', 'orgId'],
          dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.symbols.count');
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
      json: async () => symbolModel.getSymbolById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('symbols').findOne(resolveMongoIdFilter(id)))
    }, 'core.symbols.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => symbolModel.addSymbol(data),
      mongo: async () => {
        const collection = getMongoCollection('symbols');
        const payload = { ...(data || {}) };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.symbols.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => symbolModel.updateSymbol(id, data),
      mongo: async () => {
        const collection = getMongoCollection('symbols');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Symbol not found');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.symbols.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => symbolModel.deleteSymbol(id),
      mongo: async () => getMongoCollection('symbols').deleteOne(resolveMongoIdFilter(id))
    }, 'core.symbols.remove');
  },

  async getAllSymbols() {
    return await this.list();
  },

  async getSymbolById(id) {
    return await this.getById(id);
  },

  async addSymbol(data) {
    return await this.create(data);
  },

  async updateSymbol(id, data) {
    return await this.update(id, data);
  },

  async deleteSymbol(id) {
    return await this.remove(id);
  }
};

assertQueryableCrudRepository('symbolRepository', symbolRepository);

module.exports = symbolRepository;
