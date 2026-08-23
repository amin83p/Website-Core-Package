const userSettingsModel = require('../models/userSettingsModel');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { toPublicId, idsEqual } = require('../utils/idAdapter');
const {
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters
} = require('./backend/mongoRepositoryUtils');

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clonePlainObject(value) {
  if (!isPlainObject(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function buildUserSettingsScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const userId = toPublicId(scope?.userId);
  if (!userId) return { id: '__NO_MATCH__' };
  return { $or: [{ id: userId }, { userId }] };
}

function buildUserSettingsKeyFilter(idOrUserId) {
  const userId = toPublicId(
    idOrUserId && typeof idOrUserId === 'object'
      ? idOrUserId.userId || idOrUserId.id
      : idOrUserId
  );
  if (!userId) return { id: '__NO_MATCH__' };
  return { $or: [{ id: userId }, { userId }] };
}

function normalizeActor(actor) {
  if (actor && typeof actor === 'object') {
    return toPublicId(actor.id || actor.userId || actor.username || actor.email) || 'system';
  }
  return toPublicId(actor) || 'system';
}

function buildSettingsKeySummary(settings = {}) {
  return Object.keys(isPlainObject(settings) ? settings : {})
    .sort((a, b) => a.localeCompare(b))
    .join(', ');
}

function decorateRecord(row) {
  const normalized = normalizeMongoDocument(row);
  if (!normalized || typeof normalized !== 'object') return normalized;
  return {
    ...normalized,
    settingsKeys: buildSettingsKeySummary(normalized.settings)
  };
}

function buildMongoRecord(data = {}, existing = null) {
  const userId = toPublicId(data.userId || data.id);
  if (!userId) throw new Error('User ID is required for user settings.');

  const now = new Date().toISOString();
  const auditUser = normalizeActor(data.auditUser || data.actor || data.audit?.lastUpdateUser);
  const existingAudit = isPlainObject(existing?.audit) ? existing.audit : {};
  const incomingAudit = isPlainObject(data.audit) ? data.audit : {};

  return {
    ...(existing && typeof existing === 'object' ? normalizeMongoDocument(existing) : {}),
    id: userId,
    userId,
    settings: clonePlainObject(data.settings),
    audit: {
      createUser: String(existingAudit.createUser || incomingAudit.createUser || auditUser),
      createDateTime: String(existingAudit.createDateTime || incomingAudit.createDateTime || now),
      lastUpdateUser: auditUser,
      lastUpdateDateTime: now
    }
  };
}

async function listMongoUserSettings(options = {}) {
  const collection = getMongoCollection('userSettings');
  const query = options?.query || {};
  const scopeFilter = buildUserSettingsScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['userId', 'id'],
    dateFields: ['audit.createDateTime', 'audit.lastUpdateDateTime']
  });
  const filter = combineMongoFilters(scopeFilter, queryFilter);
  const sort = buildMongoSortFromQuery(query, options?.sort || { 'audit.lastUpdateDateTime': -1 });
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);
  let cursor = collection.find(filter);
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);
  const rows = await cursor.toArray();
  return rows.map(decorateRecord).filter(Boolean);
}

const userSettingsRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        return userSettingsModel.querySettings({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoUserSettings(options)
    }, 'core.userSettings.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await userSettingsModel.querySettings({
          query,
          scope: options?.scope || {},
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('userSettings');
        const scopeFilter = buildUserSettingsScopeFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['userId', 'id'],
          dateFields: ['audit.createDateTime', 'audit.lastUpdateDateTime']
        });
        return Number(await collection.countDocuments(combineMongoFilters(scopeFilter, queryFilter)));
      }
    }, 'core.userSettings.count');
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

  async getById(idOrUserId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => userSettingsModel.getUserSettings(idOrUserId),
      mongo: async () => decorateRecord(await getMongoCollection('userSettings').findOne(buildUserSettingsKeyFilter(idOrUserId)))
    }, 'core.userSettings.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => userSettingsModel.addSetting(data),
      mongo: async () => {
        const collection = getMongoCollection('userSettings');
        const userId = toPublicId(data?.userId || data?.id);
        if (!userId) throw new Error('User ID is required for user settings.');
        const existing = await collection.findOne(buildUserSettingsKeyFilter(userId));
        if (existing) throw new Error(`Settings already exist for user "${userId}".`);
        const payload = buildMongoRecord({ ...data, userId }, null);
        await collection.insertOne(payload);
        return decorateRecord(payload);
      }
    }, 'core.userSettings.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => userSettingsModel.updateSetting({
        ...(data || {}),
        userId: data?.userId || id || data?.id
      }),
      mongo: async () => {
        const collection = getMongoCollection('userSettings');
        const userId = toPublicId(data?.userId || id || data?.id);
        if (!userId) throw new Error('User ID is required for user settings.');
        const existing = await collection.findOne(buildUserSettingsKeyFilter(userId));
        const payload = buildMongoRecord({ ...(data || {}), userId }, existing);

        if (existing) {
          const { _id, ...toSet } = payload;
          await collection.updateOne({ _id: existing._id }, { $set: toSet });
          return decorateRecord(await collection.findOne({ _id: existing._id }));
        }

        await collection.insertOne(payload);
        return decorateRecord(payload);
      }
    }, 'core.userSettings.update');
  },

  async remove(idOrUserId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => userSettingsModel.deleteSetting(idOrUserId),
      mongo: async () => getMongoCollection('userSettings').deleteOne(buildUserSettingsKeyFilter(idOrUserId))
    }, 'core.userSettings.remove');
  },

  async getAllSettings(options = {}) {
    return await this.list(options);
  },

  async getUserSettings(userId, options = {}) {
    return await this.getById(userId, options);
  },

  async updateSetting(data, options = {}) {
    return await this.update(data?.userId || data?.id, data, options);
  },

  async deleteUserSettings(userId, options = {}) {
    return await this.remove(userId, options);
  },

  idsEqual
};

assertQueryableCrudRepository('userSettingsRepository', userSettingsRepository);

module.exports = userSettingsRepository;
