const subscriptionGroupModel = require('../models/subscriptionGroupModel');
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

function buildGroupScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const orgIds = toIdArray(scope?.orgIds || []);
  if (!orgIds.length) return { id: '__NO_MATCH__' };
  return { orgId: { $in: orgIds } };
}

async function listMongoGroups(options = {}) {
  const collection = getMongoCollection('subscriptionGroups');
  const query = options?.query || {};
  const scopeFilter = buildGroupScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'name', 'orgId', 'description'],
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

const subscriptionGroupRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        return subscriptionGroupModel.queryGroups({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoGroups(options)
    }, 'core.subscriptionGroups.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const scope = options?.scope || {};
        const rows = await subscriptionGroupModel.queryGroups({
          query,
          scope,
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('subscriptionGroups');
        const scopeFilter = buildGroupScopeFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['id', 'name', 'orgId', 'description'],
          dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.subscriptionGroups.count');
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
      json: async () => subscriptionGroupModel.getGroupById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('subscriptionGroups').findOne(resolveMongoIdFilter(id)))
    }, 'core.subscriptionGroups.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => subscriptionGroupModel.addGroup(data),
      mongo: async () => {
        const collection = getMongoCollection('subscriptionGroups');
        const payload = { ...(data || {}) };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.subscriptionGroups.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => subscriptionGroupModel.updateGroup(id, data),
      mongo: async () => {
        const collection = getMongoCollection('subscriptionGroups');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Subscription group not found');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.subscriptionGroups.update');
  },

  async remove(id, orgId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => subscriptionGroupModel.deleteGroup(id, orgId),
      mongo: async () => {
        const collection = getMongoCollection('subscriptionGroups');
        const baseFilter = resolveMongoIdFilter(id);
        const filter = orgId ? combineMongoFilters(baseFilter, { orgId: toPublicId(orgId) }) : baseFilter;
        return collection.deleteOne(filter);
      }
    }, 'core.subscriptionGroups.remove');
  },

  async getByOrg(orgId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => subscriptionGroupModel.getGroupsByOrg(orgId),
      mongo: async () => {
        const rows = await getMongoCollection('subscriptionGroups')
          .find({ orgId: toPublicId(orgId) })
          .sort({ name: 1 })
          .toArray();
        return rows.map(normalizeMongoDocument).filter(Boolean);
      }
    }, 'core.subscriptionGroups.getByOrg');
  },

  async getAllGroups() {
    return await this.list();
  },

  async getGroupById(id) {
    return await this.getById(id);
  },

  async getGroupsByOrg(orgId) {
    return await this.getByOrg(orgId);
  },

  async addGroup(data) {
    return await this.create(data);
  },

  async updateGroup(id, data) {
    return await this.update(id, data);
  },

  async deleteGroup(id, orgId) {
    return await this.remove(id, orgId);
  }
};

assertQueryableCrudRepository('subscriptionGroupRepository', {
  list: subscriptionGroupRepository.list,
  count: subscriptionGroupRepository.count,
  exists: subscriptionGroupRepository.exists,
  getById: subscriptionGroupRepository.getById,
  create: subscriptionGroupRepository.create,
  update: subscriptionGroupRepository.update,
  remove: async (id) => subscriptionGroupRepository.remove(id, null)
});

module.exports = subscriptionGroupRepository;
