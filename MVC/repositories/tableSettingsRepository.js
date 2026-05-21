const tableSettingsModel = require('../models/tableSettingsModel');
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
  deepMerge
} = require('./backend/mongoRepositoryUtils');

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function buildTableSettingsScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const userId = toPublicId(scope?.userId);
  if (!userId) return { id: '__NO_MATCH__' };
  return { userId };
}

function buildTableSettingsKeyFilter(key) {
  const userId = toPublicId(key?.userId);
  const tableId = String(key?.tableId || '').trim();
  if (!userId || !tableId) return { id: '__NO_MATCH__' };
  return { userId, tableId };
}

async function listMongoTableSettings(options = {}) {
  const collection = getMongoCollection('tableSettings');
  const query = options?.query || {};
  const scopeFilter = buildTableSettingsScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['userId', 'tableId', 'name'],
    dateFields: ['createdAt', 'updatedAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
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

const tableSettingsRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const scope = options?.scope || {};
        return tableSettingsModel.querySettings({
          query,
          scope,
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoTableSettings(options)
    }, 'core.tableSettings.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const scope = options?.scope || {};
        const rows = await tableSettingsModel.querySettings({
          query,
          scope,
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('tableSettings');
        const scopeFilter = buildTableSettingsScopeFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['userId', 'tableId', 'name'],
          dateFields: ['createdAt', 'updatedAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.tableSettings.count');
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

  async getById(key, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        if (!key || typeof key !== 'object') return null;
        return tableSettingsModel.getUserTableSetting(key.userId, key.tableId);
      },
      mongo: async () => normalizeMongoDocument(await getMongoCollection('tableSettings').findOne(buildTableSettingsKeyFilter(key)))
    }, 'core.tableSettings.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => tableSettingsModel.addSetting(data),
      mongo: async () => {
        const collection = getMongoCollection('tableSettings');
        const payload = {
          ...(data || {}),
          userId: toPublicId(data?.userId),
          tableId: String(data?.tableId || '').trim()
        };
        if (!payload.userId || !payload.tableId) throw new Error('userId and tableId are required for table setting.');
        const existing = await collection.findOne(buildTableSettingsKeyFilter(payload));
        if (existing) {
          const merged = deepMerge(existing, payload);
          const { _id, ...toSet } = merged;
          await collection.updateOne({ _id: existing._id }, { $set: toSet });
          return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
        }
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.tableSettings.create');
  },

  async update(_id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => tableSettingsModel.updateSetting(data),
      mongo: async () => {
        const keyFilter = buildTableSettingsKeyFilter(data || {});
        const collection = getMongoCollection('tableSettings');
        const existing = await collection.findOne(keyFilter);
        if (!existing) return this.create(data, options);
        const merged = deepMerge(existing, data || {});
        const { _id: mongoId, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.tableSettings.update');
  },

  async remove(key, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        if (!key || typeof key !== 'object') throw new Error('Invalid key for table settings remove.');
        return tableSettingsModel.deleteSetting(key.userId, key.tableId);
      },
      mongo: async () => getMongoCollection('tableSettings').deleteOne(buildTableSettingsKeyFilter(key))
    }, 'core.tableSettings.remove');
  },

  async getAllSettings() {
    return await this.list();
  },

  async getUserSettings(userId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => tableSettingsModel.getUserSettings(userId),
      mongo: async () => {
        const rows = await getMongoCollection('tableSettings').find({ userId: toPublicId(userId) }).toArray();
        return rows.map(normalizeMongoDocument).filter(Boolean);
      }
    }, 'core.tableSettings.getUserSettings');
  },

  async getUserTableSetting(userId, tableId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => tableSettingsModel.getUserTableSetting(userId, tableId),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('tableSettings').findOne(buildTableSettingsKeyFilter({ userId, tableId })))
    }, 'core.tableSettings.getUserTableSetting');
  },

  async addSetting(data) {
    return await this.create(data);
  },

  async updateSetting(data) {
    return await this.update(null, data);
  },

  async deleteSetting(userId, tableId) {
    return await this.remove({ userId, tableId });
  },

  async deleteUserSettings(userId, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => tableSettingsModel.deleteUserSettings(userId),
      mongo: async () => getMongoCollection('tableSettings').deleteMany({ userId: toPublicId(userId) })
    }, 'core.tableSettings.deleteUserSettings');
  }
};

assertQueryableCrudRepository('tableSettingsRepository', tableSettingsRepository);

module.exports = tableSettingsRepository;
