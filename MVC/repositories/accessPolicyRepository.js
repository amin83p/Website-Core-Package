const accessPolicyModel = require('../models/accessPolicyModel');
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

function buildAccessPolicyScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const userIds = toIdArray(scope?.userIds || []);
  if (!userIds.length) return { id: '__NO_MATCH__' };
  return { userId: { $in: userIds } };
}

function normalizeAccessPolicyUserId(value) {
  return toPublicId(value) || '';
}

function normalizeAccessPolicyOrgId(value) {
  const token = String(toPublicId(value) || '').trim();
  if (!token || token.toLowerCase() === 'global') return '';
  return token;
}

function isDuplicateAccessPolicyError(error) {
  if (!error) return false;
  const message = String(error?.message || '').toLowerCase();
  if (Number(error?.code) === 11000) return true;
  if (message.includes('e11000')) return true;
  return message.includes('duplicate') && message.includes('key');
}

function findAccessPolicyScopeConflict(rows = [], candidate = {}, currentId = null) {
  const candidateUserId = normalizeAccessPolicyUserId(candidate?.userId);
  const candidateOrgId = normalizeAccessPolicyOrgId(candidate?.orgId);
  if (!candidateUserId) throw new Error('User ID is required.');

  return (Array.isArray(rows) ? rows : []).find((row) => {
    const rowId = toPublicId(row?.id || row?._id);
    if (currentId && rowId && String(rowId) === String(currentId)) return false;
    return normalizeAccessPolicyUserId(row?.userId) === candidateUserId
      && normalizeAccessPolicyOrgId(row?.orgId) === candidateOrgId;
  }) || null;
}

function enforceAccessPolicyKeyImmutability(existing = {}, incoming = {}) {
  if (!incoming || typeof incoming !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(incoming, 'userId')) {
    const originalUserId = normalizeAccessPolicyUserId(existing?.userId);
    const incomingUserId = normalizeAccessPolicyUserId(incoming?.userId);
    if (originalUserId !== incomingUserId) {
      throw new Error('User cannot be changed when editing an existing policy.');
    }
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'orgId')) {
    const originalOrgId = normalizeAccessPolicyOrgId(existing?.orgId);
    const incomingOrgId = normalizeAccessPolicyOrgId(incoming?.orgId);
    if (originalOrgId !== incomingOrgId) {
      throw new Error('Organization scope cannot be changed when editing an existing policy.');
    }
  }
}

async function listMongoAccessPolicies(options = {}) {
  const collection = getMongoCollection('accessPolicies');
  const query = options?.query || {};
  const scopeFilter = buildAccessPolicyScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'userId', 'policyName', 'status'],
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

const accessPolicyRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        return accessPolicyModel.queryPolicies({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoAccessPolicies(options)
    }, 'core.accessPolicies.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const scope = options?.scope || {};
        const rows = await accessPolicyModel.queryPolicies({
          query,
          scope,
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('accessPolicies');
        const scopeFilter = buildAccessPolicyScopeFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['id', 'userId', 'policyName', 'status'],
          dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.accessPolicies.count');
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
      json: async () => accessPolicyModel.getPolicyById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('accessPolicies').findOne(resolveMongoIdFilter(id)))
    }, 'core.accessPolicies.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const payload = { ...(data || {}) };
        const allRows = await accessPolicyModel.getAllPolicies();
        const conflict = findAccessPolicyScopeConflict(allRows, payload);
        if (conflict) {
          throw new Error('A policy already exists for this user in the selected scope.');
        }
        return accessPolicyModel.addPolicy(payload);
      },
      mongo: async () => {
        const collection = getMongoCollection('accessPolicies');
        const payload = { ...(data || {}) };
        const candidateUserId = normalizeAccessPolicyUserId(payload?.userId);
        const candidateOrgId = normalizeAccessPolicyOrgId(payload?.orgId);
        payload.userId = candidateUserId;
        payload.orgId = candidateOrgId || null;
        const existingRows = await collection.find({ userId: candidateUserId }).toArray();
        const conflict = findAccessPolicyScopeConflict(existingRows, payload);
        if (conflict) {
          throw new Error('A policy already exists for this user in the selected scope.');
        }
        payload.id = await generateUniqueStringId(collection, payload.id);
        try {
          await collection.insertOne(payload);
          return normalizeMongoDocument(payload);
        } catch (error) {
          if (isDuplicateAccessPolicyError(error)) {
            throw new Error('A policy already exists for this user in the selected scope.');
          }
          throw error;
        }
      }
    }, 'core.accessPolicies.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const existing = await accessPolicyModel.getPolicyById(id);
        if (!existing) throw new Error('Access policy not found');
        enforceAccessPolicyKeyImmutability(existing, data || {});
        const merged = deepMerge(existing, data || {});
        const allRows = await accessPolicyModel.getAllPolicies();
        const conflict = findAccessPolicyScopeConflict(allRows, merged, toPublicId(existing?.id || id));
        if (conflict) {
          throw new Error('A policy already exists for this user in the selected scope.');
        }
        return accessPolicyModel.updatePolicy(id, data);
      },
      mongo: async () => {
        const collection = getMongoCollection('accessPolicies');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Access policy not found');
        enforceAccessPolicyKeyImmutability(existing, data || {});
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const candidateUserId = normalizeAccessPolicyUserId(merged?.userId);
        const candidateOrgId = normalizeAccessPolicyOrgId(merged?.orgId);
        merged.userId = candidateUserId;
        merged.orgId = candidateOrgId || null;
        const existingRows = await collection.find({ userId: candidateUserId }).toArray();
        const conflict = findAccessPolicyScopeConflict(existingRows, merged, merged.id);
        if (conflict) {
          throw new Error('A policy already exists for this user in the selected scope.');
        }
        const { _id, ...toSet } = merged;
        try {
          await collection.updateOne({ _id: existing._id }, { $set: toSet });
          return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
        } catch (error) {
          if (isDuplicateAccessPolicyError(error)) {
            throw new Error('A policy already exists for this user in the selected scope.');
          }
          throw error;
        }
      }
    }, 'core.accessPolicies.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => accessPolicyModel.deletePolicy(id),
      mongo: async () => getMongoCollection('accessPolicies').deleteOne(resolveMongoIdFilter(id))
    }, 'core.accessPolicies.remove');
  },

  async getByUserId(userId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        if (typeof accessPolicyModel.getPolicyByUserId === 'function') {
          return accessPolicyModel.getPolicyByUserId(userId);
        }
        return this.list({
          query: { userId__eq: userId },
          scope: { canViewAll: true }
        });
      },
      mongo: async () => {
        const row = await getMongoCollection('accessPolicies').findOne({ userId: toPublicId(userId) });
        return normalizeMongoDocument(row);
      }
    }, 'core.accessPolicies.getByUserId');
  },

  async getAllPolicies() {
    return await this.list();
  },

  async getPolicyById(id) {
    return await this.getById(id);
  },

  async getPolicyByUserId(userId) {
    return await this.getByUserId(userId);
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

assertQueryableCrudRepository('accessPolicyRepository', accessPolicyRepository);

module.exports = accessPolicyRepository;
