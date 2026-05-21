const operationModel = require('../models/operationModel');
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

async function listMongoOperations(options = {}) {
  const collection = getMongoCollection('operations');
  const query = options?.query || {};
  const scopeFilter = buildCanViewAllFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'name', 'description', 'sectionId'],
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

const operationRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        return operationModel.queryOperations({
          query,
          scope: options?.scope || {},
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoOperations(options)
    }, 'core.operations.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await operationModel.queryOperations({
          query,
          scope: options?.scope || {},
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('operations');
        const scopeFilter = buildCanViewAllFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['id', 'name', 'description', 'sectionId'],
          dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.operations.count');
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
      json: async () => operationModel.getOperationById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('operations').findOne(resolveMongoIdFilter(id)))
    }, 'core.operations.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => operationModel.addOperation(data),
      mongo: async () => {
        const collection = getMongoCollection('operations');
        const payload = { ...(data || {}) };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.operations.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => operationModel.updateOperation(id, data),
      mongo: async () => {
        const collection = getMongoCollection('operations');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Operation not found');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.operations.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => operationModel.deleteOperation(id),
      mongo: async () => getMongoCollection('operations').deleteOne(resolveMongoIdFilter(id))
    }, 'core.operations.remove');
  },

  async getByName(name, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        if (typeof operationModel.getOperationByName === 'function') return operationModel.getOperationByName(name);
        const rows = await this.list({
          query: {
            name__eq: String(name || '').trim(),
            limit: 1
          }
        });
        return Array.isArray(rows) && rows[0] ? rows[0] : null;
      },
      mongo: async () => {
        const n = String(name || '').trim();
        if (!n) return null;
        const row = await getMongoCollection('operations').findOne({
          name: { $regex: new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        });
        return normalizeMongoDocument(row);
      }
    }, 'core.operations.getByName');
  },

  async getAllOperations() {
    return await this.list();
  },

  async getOperationById(id) {
    return await this.getById(id);
  },

  async getOperationByName(name) {
    return await this.getByName(name);
  },

  async addOperation(data) {
    return await this.create(data);
  },

  async updateOperation(id, data) {
    return await this.update(id, data);
  },

  async deleteOperation(id) {
    return await this.remove(id);
  }
};

assertQueryableCrudRepository('operationRepository', operationRepository);

module.exports = operationRepository;
