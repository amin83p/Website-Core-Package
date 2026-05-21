const userMembershipModel = require('../models/userMembershipModel');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { idsEqual, toPublicId } = require('../utils/idAdapter');
const { normalizeMembershipPayload } = require('../services/security/entitlementService');
const {
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter,
  generateUniqueStringId
} = require('./backend/mongoRepositoryUtils');

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function buildMembershipScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const includeGlobal = scope?.includeGlobal === true;
  const orgId = toPublicId(scope?.orgId) || null;
  const userId = toPublicId(scope?.userId) || null;
  const clauses = [];
  if (userId) clauses.push({ userId });
  if (orgId) clauses.push({ orgId });
  if (includeGlobal) clauses.push({ $or: [{ orgId: { $exists: false } }, { orgId: null }, { orgId: '' }] });
  if (!clauses.length) return { id: '__NO_MATCH__' };
  if (clauses.length === 1) return clauses[0];
  return { $or: clauses };
}

function resolveScopeOrgId(value) {
  return toPublicId(value) || null;
}

function validateMembershipUniqueness(candidate, existingRows = [], currentId = null) {
  const candidateUserId = toPublicId(candidate?.userId) || null;
  if (!candidateUserId) {
    throw new Error('userId is required.');
  }

  const duplicateRows = (Array.isArray(existingRows) ? existingRows : []).filter((row) => {
    const rowId = toPublicId(row?.id || row?._id);
    if (currentId && idsEqual(rowId, currentId)) return false;
    return idsEqual(toPublicId(row?.userId), candidateUserId);
  });

  const candidateOrgId = resolveScopeOrgId(candidate?.orgId);
  const duplicateSameScope = duplicateRows.find((row) => idsEqual(resolveScopeOrgId(row?.orgId), candidateOrgId));
  const duplicateGlobal = duplicateRows.find((row) => !resolveScopeOrgId(row?.orgId));

  if (duplicateSameScope) {
    throw new Error('A membership record already exists for this user and this organization scope. Edit the existing record instead.');
  }
  if (!candidateOrgId && duplicateRows.length > 0) {
    throw new Error('Cannot create a Global membership when organization-specific memberships already exist for this user.');
  }
  if (candidateOrgId && duplicateGlobal) {
    throw new Error('Cannot create an organization membership while a Global membership exists for this user.');
  }
}

function normalizeMembershipDocument(input = {}, existing = null) {
  const current = existing && typeof existing === 'object' ? existing : {};
  const mergedInput = {
    ...current,
    ...input,
    periods: input?.periods !== undefined ? input.periods : current.periods,
    source: { ...(current.source || {}), ...(input?.source || {}) }
  };
  const normalized = normalizeMembershipPayload(mergedInput);
  const doc = {
    ...current,
    ...input,
    ...normalized,
    source: normalized.source,
    summary: normalized.summary,
    periods: normalized.periods,
    status: normalized.summary?.status || 'no_period'
  };
  if (current?.id) doc.id = current.id;
  if (current?.audit || input?.audit) {
    doc.audit = { ...(current.audit || {}), ...(input.audit || {}) };
  }
  return doc;
}

async function listMongoMemberships(options = {}) {
  const collection = getMongoCollection('userMemberships');
  const query = options?.query || {};
  const scopeFilter = buildMembershipScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'userId', 'orgId', 'status', 'notes'],
    dateFields: ['audit.createDateTime', 'audit.lastUpdateDateTime', 'summary.effectiveEndDate']
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

const userMembershipRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        return userMembershipModel.queryUserMemberships({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoMemberships(options)
    }, 'core.userMemberships.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await userMembershipModel.queryUserMemberships({
          query,
          scope: options?.scope || {},
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('userMemberships');
        const scopeFilter = buildMembershipScopeFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['id', 'userId', 'orgId', 'status', 'notes'],
          dateFields: ['audit.createDateTime', 'audit.lastUpdateDateTime', 'summary.effectiveEndDate']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.userMemberships.count');
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
      json: async () => userMembershipModel.getUserMembershipById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('userMemberships').findOne(resolveMongoIdFilter(id)))
    }, 'core.userMemberships.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => userMembershipModel.addUserMembership(data),
      mongo: async () => {
        const collection = getMongoCollection('userMemberships');
        const payload = normalizeMembershipDocument(data || {});
        if (!payload.userId) throw new Error('userId is required.');
        const existingRows = await collection.find({ userId: payload.userId }).toArray();
        validateMembershipUniqueness(payload, existingRows);
        payload.id = await generateUniqueStringId(collection, payload.id, { prefix: 'MEM' });
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.userMemberships.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => userMembershipModel.updateUserMembership(id, data),
      mongo: async () => {
        const collection = getMongoCollection('userMemberships');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Membership record not found');
        const current = normalizeMongoDocument(existing) || {};
        const merged = normalizeMembershipDocument(data || {}, current);
        merged.id = toPublicId(current?.id || existing?._id);
        const existingRows = await collection.find({ userId: merged.userId }).toArray();
        validateMembershipUniqueness(merged, existingRows, merged.id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.userMemberships.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => userMembershipModel.deleteUserMembership(id),
      mongo: async () => getMongoCollection('userMemberships').deleteOne(resolveMongoIdFilter(id))
    }, 'core.userMemberships.remove');
  }
};

assertQueryableCrudRepository('userMembershipRepository', userMembershipRepository);

module.exports = userMembershipRepository;
