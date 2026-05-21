const contractModel = require('../models/contractModel');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { idsEqual, toPublicId } = require('../utils/idAdapter');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
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

async function listMongoContracts(options = {}) {
  const collection = getMongoCollection('contracts');
  const query = options?.query || {};
  const scopeFilter = buildCanViewAllFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'orgId', 'status', 'title'],
    dateFields: ['startDate', 'endDate', 'createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
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

const contractRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        return contractModel.queryContracts({
          query,
          scope: options?.scope || {},
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoContracts(options)
    }, 'core.contracts.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await contractModel.queryContracts({
          query,
          scope: options?.scope || {},
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('contracts');
        const scopeFilter = buildCanViewAllFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['id', 'orgId', 'status', 'title'],
          dateFields: ['startDate', 'endDate', 'createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.contracts.count');
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
      json: async () => contractModel.getContractById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('contracts').findOne(resolveMongoIdFilter(id)))
    }, 'core.contracts.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => contractModel.addContract(data),
      mongo: async () => {
        const collection = getMongoCollection('contracts');
        const payload = { ...(data || {}) };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.contracts.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => contractModel.updateContract(id, data),
      mongo: async () => {
        const collection = getMongoCollection('contracts');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Contract not found');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.contracts.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => contractModel.deleteContract(id),
      mongo: async () => getMongoCollection('contracts').deleteOne(resolveMongoIdFilter(id))
    }, 'core.contracts.remove');
  },

  async getAllContracts() {
    return await this.list();
  },

  async getContractById(id) {
    return await this.getById(id);
  },

  async addContract(data) {
    return await this.create(data);
  },

  async updateContract(id, data) {
    return await this.update(id, data);
  },

  async deleteContract(id) {
    return await this.remove(id);
  },

  async hasActiveContractForOrg(orgId, options = {}) {
    if (orgId === undefined || orgId === null || orgId === '') return false;
    const nowDate = options?.atDate instanceof Date ? options.atDate : new Date();
    const now = Number.isNaN(nowDate.getTime()) ? new Date() : nowDate;

    const contracts = await this.list({
      query: {
        orgId__eq: orgId,
        status__eq: 'active'
      }
    });

    return (contracts || []).some((contract) => {
      if (!idsEqual(contract?.orgId, orgId)) return false;
      if (String(contract?.status || '').toLowerCase() !== 'active') return false;

      if (!contract?.startDate) return false;
      const start = new Date(contract.startDate);
      if (Number.isNaN(start.getTime()) || start > now) return false;

      if (contract.endDate) {
        const end = new Date(contract.endDate);
        if (Number.isNaN(end.getTime()) || end < now) return false;
      }

      return true;
    });
  }
};

assertQueryableCrudRepository('contractRepository', contractRepository);

module.exports = contractRepository;
