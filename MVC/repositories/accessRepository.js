const accessModel = require('../models/accessModel');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { toPublicId } = require('../utils/idAdapter');
const {
  normalizeAccessProfileScope,
  choosePreferredAccessProfile,
  dedupeAccessProfilesById,
  buildMongoAccessOrgFilter,
  buildMongoGlobalAccessOrgFilter
} = require('../utils/accessProfileScopeUtils');
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

const ACCESS_MONGO_SEARCH_FIELDS = ['id', 'name', 'description', 'orgId', 'adminCategories', 'profileName', 'scope'];

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function buildAccessScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const includeGlobal = scope?.includeGlobal !== false;
  const orgId = toPublicId(scope?.orgId);
  const clauses = [];
  if (includeGlobal) clauses.push(buildMongoGlobalAccessOrgFilter());
  if (orgId) clauses.push(buildMongoAccessOrgFilter(orgId));
  if (!clauses.length) return { id: '__NO_MATCH__' };
  if (clauses.length === 1) return clauses[0];
  return { $or: clauses };
}

function splitOrgIdQueryFilter(query = {}) {
  const cleanQuery = { ...(query || {}) };
  const orgId = toPublicId(cleanQuery.orgId);
  delete cleanQuery.orgId;
  return {
    query: cleanQuery,
    orgFilter: orgId ? buildMongoAccessOrgFilter(orgId) : {}
  };
}

function getNestedValue(item, path) {
  if (!item || !path) return undefined;
  return String(path).split('.').reduce((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[key];
  }, item);
}

function compareUnknownValues(left, right) {
  if (left === right) return 0;
  if (left === undefined || left === null || left === '') return 1;
  if (right === undefined || right === null || right === '') return -1;
  const leftDate = Date.parse(String(left));
  const rightDate = Date.parse(String(right));
  if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate - rightDate;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), undefined, { sensitivity: 'base', numeric: true });
}

function applySortAndPagination(rows = [], query = {}, explicitSort = null) {
  const output = [...(Array.isArray(rows) ? rows : [])];
  const sort = buildMongoSortFromQuery(query, explicitSort);
  const sortEntries = Object.entries(sort || {});
  if (sortEntries.length > 0) {
    output.sort((left, right) => {
      for (const [field, direction] of sortEntries) {
        const comparison = compareUnknownValues(getNestedValue(left, field), getNestedValue(right, field));
        if (comparison !== 0) return Number(direction) < 0 ? -comparison : comparison;
      }
      return 0;
    });
  }

  const { skip, limit } = resolveMongoPagination(query, null);
  if (limit > 0) return output.slice(Math.max(0, skip), Math.max(0, skip) + limit);
  return output;
}

async function listMongoAccessesRaw(options = {}) {
  const collection = getMongoCollection('accesses');
  const query = options?.query || {};
  const splitQuery = splitOrgIdQueryFilter(query);
  const scopeFilter = buildAccessScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(splitQuery.query, {
    defaultSearchFields: ACCESS_MONGO_SEARCH_FIELDS,
    dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
  });
  const filter = combineMongoFilters(scopeFilter, splitQuery.orgFilter, queryFilter);
  const rows = await collection.find(filter).toArray();
  return rows.map(normalizeMongoDocument).filter(Boolean).map(normalizeAccessProfileScope);
}

async function listMongoAccesses(options = {}) {
  const query = options?.query || {};
  const rows = dedupeAccessProfilesById(await listMongoAccessesRaw(options));
  return applySortAndPagination(rows, query, options?.sort || null);
}

const accessRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        const rows = await accessModel.queryAccesses({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.map(normalizeAccessProfileScope) : [];
      },
      mongo: async () => listMongoAccesses(options)
    }, 'core.accesses.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const scope = options?.scope || {};
        const rows = await accessModel.queryAccesses({
          query,
          scope,
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const rows = await listMongoAccessesRaw({
          ...options,
          query
        });
        return dedupeAccessProfilesById(rows).length;
      }
    }, 'core.accesses.count');
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
      json: async () => normalizeAccessProfileScope(await accessModel.getAccessById(id)),
      mongo: async () => {
        const rows = await getMongoCollection('accesses').find(resolveMongoIdFilter(id)).toArray();
        return dedupeAccessProfilesById(rows.map(normalizeMongoDocument).filter(Boolean))[0] || null;
      }
    }, 'core.accesses.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => accessModel.addAccess(data),
      mongo: async () => {
        const collection = getMongoCollection('accesses');
        const payload = { ...(data || {}) };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizeAccessProfileScope(normalizeMongoDocument(payload));
      }
    }, 'core.accesses.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => accessModel.updateAccess(id, data),
      mongo: async () => {
        const collection = getMongoCollection('accesses');
        const matches = await collection.find(resolveMongoIdFilter(id)).toArray();
        const existing = (Array.isArray(matches) ? matches : []).reduce(
          (preferred, candidate) => choosePreferredAccessProfile(preferred, candidate),
          null
        );
        if (!existing) throw new Error('Access record not found');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeAccessProfileScope(normalizeMongoDocument(await collection.findOne({ _id: existing._id })));
      }
    }, 'core.accesses.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => accessModel.deleteAccess(id),
      mongo: async () => getMongoCollection('accesses').deleteOne(resolveMongoIdFilter(id))
    }, 'core.accesses.remove');
  },

  async getAllAccesses() {
    return await this.list();
  },

  async getAccessById(id) {
    return await this.getById(id);
  },

  async addAccess(data) {
    return await this.create(data);
  },

  async updateAccess(id, data) {
    return await this.update(id, data);
  },

  async deleteAccess(id) {
    return await this.remove(id);
  }
};

assertQueryableCrudRepository('accessRepository', accessRepository);

module.exports = accessRepository;
