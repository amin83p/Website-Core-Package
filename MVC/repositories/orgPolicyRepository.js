const orgPolicyModel = require('../models/orgPolicyModel');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { toIdArray, toPublicId } = require('../utils/idAdapter');
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

function buildOrgPolicyScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const orgIds = toIdArray(scope?.orgIds || []);
  if (!orgIds.length) return { id: '__NO_MATCH__' };
  return { orgId: { $in: orgIds } };
}

function normalizeOrgPolicyOrgId(value) {
  return toPublicId(value) || '';
}

function isDuplicateOrgPolicyError(error) {
  if (!error) return false;
  const message = String(error?.message || '').toLowerCase();
  if (Number(error?.code) === 11000) return true;
  if (message.includes('e11000')) return true;
  return message.includes('duplicate') && message.includes('key');
}

function findOrgPolicyScopeConflict(rows = [], candidate = {}, currentId = null) {
  const candidateOrgId = normalizeOrgPolicyOrgId(candidate?.orgId);
  if (!candidateOrgId) throw new Error('Organization ID is required.');

  return (Array.isArray(rows) ? rows : []).find((row) => {
    const rowId = toPublicId(row?.id || row?._id);
    if (currentId && rowId && String(rowId) === String(currentId)) return false;
    return normalizeOrgPolicyOrgId(row?.orgId) === candidateOrgId;
  }) || null;
}

function enforceOrgPolicyKeyImmutability(existing = {}, incoming = {}) {
  if (!incoming || typeof incoming !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(incoming, 'orgId')) {
    const originalOrgId = normalizeOrgPolicyOrgId(existing?.orgId);
    const incomingOrgId = normalizeOrgPolicyOrgId(incoming?.orgId);
    if (originalOrgId !== incomingOrgId) {
      throw new Error('Organization cannot be changed when editing an existing policy.');
    }
  }
}

async function listMongoOrgPolicies(options = {}) {
  const collection = getMongoCollection('orgPolicies');
  const query = options?.query || {};
  const scopeFilter = buildOrgPolicyScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'orgId', 'policyName', 'status'],
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

const orgPolicyRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        return orgPolicyModel.queryPolicies({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoOrgPolicies(options)
    }, 'core.orgPolicies.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const scope = options?.scope || {};
        const rows = await orgPolicyModel.queryPolicies({
          query,
          scope,
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('orgPolicies');
        const scopeFilter = buildOrgPolicyScopeFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['id', 'orgId', 'policyName', 'status'],
          dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.orgPolicies.count');
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
      json: async () => orgPolicyModel.getPolicyById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('orgPolicies').findOne(resolveMongoIdFilter(id)))
    }, 'core.orgPolicies.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const payload = { ...(data || {}) };
        const allRows = await orgPolicyModel.getAllPolicies();
        const conflict = findOrgPolicyScopeConflict(allRows, payload);
        if (conflict) {
          throw new Error('This organization already has a policy.');
        }
        return orgPolicyModel.addPolicy(payload);
      },
      mongo: async () => {
        const collection = getMongoCollection('orgPolicies');
        const payload = { ...(data || {}) };
        payload.orgId = normalizeOrgPolicyOrgId(payload?.orgId);
        const existingRows = await collection.find({ orgId: payload.orgId }).toArray();
        const conflict = findOrgPolicyScopeConflict(existingRows, payload);
        if (conflict) {
          throw new Error('This organization already has a policy.');
        }
        payload.id = await generateUniqueStringId(collection, payload.id);
        try {
          await collection.insertOne(payload);
          return normalizeMongoDocument(payload);
        } catch (error) {
          if (isDuplicateOrgPolicyError(error)) {
            throw new Error('This organization already has a policy.');
          }
          throw error;
        }
      }
    }, 'core.orgPolicies.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const existing = await orgPolicyModel.getPolicyById(id);
        if (!existing) throw new Error('Organization policy not found');
        enforceOrgPolicyKeyImmutability(existing, data || {});
        const merged = deepMerge(existing, data || {});
        const allRows = await orgPolicyModel.getAllPolicies();
        const conflict = findOrgPolicyScopeConflict(allRows, merged, toPublicId(existing?.id || id));
        if (conflict) {
          throw new Error('This organization already has a policy.');
        }
        return orgPolicyModel.updatePolicy(id, data);
      },
      mongo: async () => {
        const collection = getMongoCollection('orgPolicies');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Organization policy not found');
        enforceOrgPolicyKeyImmutability(existing, data || {});
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        merged.orgId = normalizeOrgPolicyOrgId(merged?.orgId);
        const existingRows = await collection.find({ orgId: merged.orgId }).toArray();
        const conflict = findOrgPolicyScopeConflict(existingRows, merged, merged.id);
        if (conflict) {
          throw new Error('This organization already has a policy.');
        }
        const { _id, ...toSet } = merged;
        try {
          await collection.updateOne({ _id: existing._id }, { $set: toSet });
          return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
        } catch (error) {
          if (isDuplicateOrgPolicyError(error)) {
            throw new Error('This organization already has a policy.');
          }
          throw error;
        }
      }
    }, 'core.orgPolicies.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => orgPolicyModel.deletePolicy(id),
      mongo: async () => getMongoCollection('orgPolicies').deleteOne(resolveMongoIdFilter(id))
    }, 'core.orgPolicies.remove');
  },

  async getByOrgId(orgId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        if (typeof orgPolicyModel.getPolicyByOrgId === 'function') return orgPolicyModel.getPolicyByOrgId(orgId);
        const rows = await this.list({
          query: {
            orgId__eq: orgId,
            limit: 1
          },
          scope: { canViewAll: true }
        });
        return Array.isArray(rows) && rows[0] ? rows[0] : null;
      },
      mongo: async () => {
        const row = await getMongoCollection('orgPolicies').findOne({ orgId: toPublicId(orgId) });
        return normalizeMongoDocument(row);
      }
    }, 'core.orgPolicies.getByOrgId');
  },

  async getAllPolicies() {
    return await this.list();
  },

  async getPolicyById(id) {
    return await this.getById(id);
  },

  async getPolicyByOrgId(orgId) {
    return await this.getByOrgId(orgId);
  },

  async addPolicy(data) {
    return await this.create(data);
  },

  async updatePolicy(id, data) {
    return await this.update(id, data);
  },

  async deletePolicy(id) {
    return await this.remove(id);
  }
};

assertQueryableCrudRepository('orgPolicyRepository', orgPolicyRepository);

module.exports = orgPolicyRepository;
