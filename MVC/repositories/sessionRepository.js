const sessionModel = require('../models/sessionModel');
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

function buildSessionScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const userId = toPublicId(scope?.userId);
  if (!userId) return { id: '__NO_MATCH__' };
  return { userId };
}

async function listMongoSessions(options = {}) {
  const collection = getMongoCollection('sessions');
  const query = options?.query || {};
  const scopeFilter = buildSessionScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'sessionId', 'userId', 'status'],
    dateFields: ['createdAt', 'expiresAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
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

const sessionRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        return sessionModel.querySessions({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoSessions(options)
    }, 'core.sessions.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const scope = options?.scope || {};
        const rows = await sessionModel.querySessions({
          query,
          scope,
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('sessions');
        const scopeFilter = buildSessionScopeFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['id', 'sessionId', 'userId', 'status'],
          dateFields: ['createdAt', 'expiresAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.sessions.count');
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
      json: async () => sessionModel.getSessionById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('sessions').findOne(resolveMongoIdFilter(id)))
    }, 'core.sessions.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => sessionModel.addSession(data),
      mongo: async () => {
        const collection = getMongoCollection('sessions');
        const payload = { ...(data || {}) };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.sessions.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => sessionModel.updateSession(id, data),
      mongo: async () => {
        const collection = getMongoCollection('sessions');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Session not found');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.sessions.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => sessionModel.deleteSession(id),
      mongo: async () => getMongoCollection('sessions').deleteOne(resolveMongoIdFilter(id))
    }, 'core.sessions.remove');
  },

  async getAllSessions() {
    return await this.list();
  },

  async getSessionById(id) {
    return await this.getById(id);
  },

  async addSession(data) {
    return await this.create(data);
  },

  async updateSession(id, data) {
    return await this.update(id, data);
  },

  async deleteSession(id) {
    return await this.remove(id);
  }
};

assertQueryableCrudRepository('sessionRepository', sessionRepository);

module.exports = sessionRepository;
