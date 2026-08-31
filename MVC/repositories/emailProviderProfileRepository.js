const { applyGenericFilter } = require('../utils/queryEngine');
const emailProviderProfileModel = require('../models/emailProviderProfileModel');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { toPublicId, toIdArray, idsEqual } = require('../utils/idAdapter');
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

const COLLECTION_NAME = 'emailProviderProfiles';
const DEFAULT_SEARCH_FIELDS = Object.freeze([
  'id',
  'orgId',
  'provider',
  'label',
  'defaultFromEmail'
]);
const DEFAULT_DATE_FIELDS = Object.freeze([
  'createdAt',
  'updatedAt',
  'audit.createDateTime',
  'audit.lastUpdateDateTime'
]);

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function sanitizeRow(row = {}) {
  return emailProviderProfileModel.sanitizeProfileForRead(row);
}

function applyJsonScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;

  const orgIds = toIdArray(scope?.orgIds || []);
  if (!orgIds.length) return [];
  return list.filter((row) => orgIds.some((orgId) => idsEqual(row?.orgId, orgId)));
}

function buildMongoScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const orgIds = toIdArray(scope?.orgIds || []);
  if (!orgIds.length) return { id: '__NO_MATCH__' };
  return { orgId: { $in: orgIds } };
}

function hasUniqueConflict(error = null) {
  const code = Number(error?.code || 0);
  const message = String(error?.message || error?.errmsg || error?.errorResponse?.errmsg || '').toLowerCase();
  if (code === 11000) return true;
  return message.includes('e11000') || (message.includes('duplicate') && message.includes('key'));
}

function assertUniqueLabel(rows = [], targetRow = {}, excludeId = '') {
  const orgId = toPublicId(targetRow?.orgId || '');
  const label = String(targetRow?.label || '').trim().toLowerCase();
  if (!orgId || !label) return;
  const conflict = (Array.isArray(rows) ? rows : []).find((row) => {
    if (excludeId && idsEqual(row?.id, excludeId)) return false;
    return idsEqual(row?.orgId, orgId)
      && String(row?.label || '').trim().toLowerCase() === label;
  });
  if (conflict) {
    throw new Error('A provider profile with this label already exists in the selected organization.');
  }
}

async function listMongoRows(options = {}) {
  const collection = getMongoCollection(COLLECTION_NAME);
  const query = options?.query || {};
  const scopeFilter = buildMongoScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: DEFAULT_SEARCH_FIELDS,
    dateFields: DEFAULT_DATE_FIELDS
  });
  const filter = combineMongoFilters(scopeFilter, queryFilter);
  const sort = buildMongoSortFromQuery(query, options?.sort || { updatedAt: -1, id: -1 });
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);

  let cursor = collection.find(filter);
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const rows = await cursor.toArray();
  return rows
    .map((row) => normalizeMongoDocument(row))
    .filter(Boolean)
    .map((row) => sanitizeRow(row));
}

const emailProviderProfileRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await emailProviderProfileModel.getAllProfiles();
        const scopedRows = applyJsonScope(rows, options?.scope || {});
        const filteredRows = applyGenericFilter(scopedRows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
        return filteredRows.map((row) => sanitizeRow(row));
      },
      mongo: async () => listMongoRows(options)
    }, 'core.emailProviderProfiles.list');
  },

  async count(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = stripPaginationFromQuery(options?.query || {});
        const rows = await this.list({ ...options, query });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const query = stripPaginationFromQuery(options?.query || {});
        const scopeFilter = buildMongoScopeFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return collection.countDocuments(filter);
      }
    }, 'core.emailProviderProfiles.count');
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
      json: async () => {
        const row = await emailProviderProfileModel.getProfileById(id);
        return row ? sanitizeRow(row) : null;
      },
      mongo: async () => {
        const row = await getMongoCollection(COLLECTION_NAME).findOne(resolveMongoIdFilter(id));
        const normalized = normalizeMongoDocument(row);
        return normalized ? sanitizeRow(normalized) : null;
      }
    }, 'core.emailProviderProfiles.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await emailProviderProfileModel.getAllProfiles();
        const normalized = emailProviderProfileModel.normalizeProfileRecord(data, null, true);
        assertUniqueLabel(rows, normalized, '');
        const created = await emailProviderProfileModel.addProfile(normalized);
        return sanitizeRow(created);
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const normalized = emailProviderProfileModel.normalizeProfileRecord(data, null, true);
        const rows = await listMongoRows({
          scope: { canViewAll: true },
          query: {
            orgId__eq: toPublicId(normalized.orgId),
            page: 1,
            limit: 200
          }
        });
        assertUniqueLabel(rows, normalized, '');
        normalized.id = await generateUniqueStringId(collection, normalized.id);

        if (normalized.isDefault) {
          await collection.updateMany(
            { orgId: normalized.orgId },
            { $set: { isDefault: false } }
          );
        }

        await collection.insertOne(normalized);
        return sanitizeRow(normalizeMongoDocument(normalized));
      }
    }, 'core.emailProviderProfiles.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await emailProviderProfileModel.getAllProfiles();
        const existing = rows.find((row) => idsEqual(row?.id, id));
        if (!existing) throw new Error('Email provider profile not found.');
        const normalized = emailProviderProfileModel.normalizeProfileRecord(
          { ...existing, ...(data || {}), id: existing.id, orgId: existing.orgId },
          existing,
          !data?.apiKey && !existing.apiKeyEncrypted
        );
        assertUniqueLabel(rows, normalized, existing.id);
        const updated = await emailProviderProfileModel.updateProfile(id, normalized);
        return sanitizeRow(updated);
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Email provider profile not found.');

        const existingRow = normalizeMongoDocument(existing);
        const normalized = emailProviderProfileModel.normalizeProfileRecord(
          {
            ...existingRow,
            ...(data || {}),
            id: existingRow.id,
            orgId: existingRow.orgId
          },
          existingRow,
          !data?.apiKey && !existingRow.apiKeyEncrypted
        );

        const rows = await listMongoRows({
          scope: { canViewAll: true },
          query: { orgId__eq: normalized.orgId, page: 1, limit: 200 }
        });
        assertUniqueLabel(rows, normalized, existingRow.id);

        if (normalized.isDefault) {
          await collection.updateMany(
            { orgId: normalized.orgId, id: { $ne: normalized.id } },
            { $set: { isDefault: false } }
          );
        }

        const { _id, ...toSet } = deepMerge(existing, normalized);
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        const fresh = await collection.findOne({ _id: existing._id });
        return sanitizeRow(normalizeMongoDocument(fresh));
      }
    }, 'core.emailProviderProfiles.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => emailProviderProfileModel.deleteProfile(id),
      mongo: async () => {
        const filter = resolveMongoIdFilter(id);
        const scoped = options?.scope || {};
        if (scoped?.canViewAll !== true) {
          const orgIds = toIdArray(scoped?.orgIds || []);
          if (!orgIds.length) return false;
          filter.orgId = { $in: orgIds };
        }
        const result = await getMongoCollection(COLLECTION_NAME).deleteOne(filter);
        return Number(result?.deletedCount || 0) > 0;
      }
    }, 'core.emailProviderProfiles.remove');
  },

  async getDefaultProfile(orgId = '', options = {}) {
    const query = {
      orgId__eq: toPublicId(orgId),
      isActive__eq: true,
      isDefault__eq: true,
      page: 1,
      limit: 5
    };
    const rows = await this.list({
      ...options,
      scope: { canViewAll: true },
      query,
      sort: { updatedAt: -1, id: -1 }
    });
    if (Array.isArray(rows) && rows.length > 0) return rows[0];

    const fallbackQuery = {
      orgId__eq: toPublicId(orgId),
      isActive__eq: true,
      page: 1,
      limit: 5
    };
    const fallbackRows = await this.list({
      ...options,
      scope: { canViewAll: true },
      query: fallbackQuery,
      sort: { updatedAt: -1, id: -1 }
    });
    return Array.isArray(fallbackRows) && fallbackRows.length > 0 ? fallbackRows[0] : null;
  },

  async getDecryptedApiKeyById(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        if (typeof emailProviderProfileModel.getDecryptedApiKeyById === 'function') {
          return emailProviderProfileModel.getDecryptedApiKeyById(id);
        }
        return null;
      },
      mongo: async () => {
        const row = await getMongoCollection(COLLECTION_NAME).findOne(resolveMongoIdFilter(id));
        const normalized = normalizeMongoDocument(row);
        if (!normalized?.apiKeyEncrypted) return null;
        const { decrypt } = require('../utils/encyptors');
        return decrypt(normalized.apiKeyEncrypted);
      }
    }, 'core.emailProviderProfiles.getDecryptedApiKeyById');
  },

  isUniqueConflict(error = null) {
    return hasUniqueConflict(error);
  }
};

assertQueryableCrudRepository('emailProviderProfileRepository', emailProviderProfileRepository);

module.exports = emailProviderProfileRepository;
