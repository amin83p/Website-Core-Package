const { applyGenericFilter } = require('../utils/queryEngine');
const pteAiProviderModel = require('../models/pte/pteAiProviderModel');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { toPublicId, idsEqual } = require('../utils/idAdapter');
const {
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter
} = require('./backend/mongoRepositoryUtils');
const actionStateChangeTrackerService = require('../services/actionStateChangeTrackerService');

const COLLECTION_NAME = 'pteAiProviders';
const DEFAULT_SEARCH_FIELDS = Object.freeze([
  'id',
  'orgId',
  'userId',
  'name',
  'providerId',
  'modelId',
  'project',
  'location',
  'notes',
  'creator.displayName'
]);
const DEFAULT_DATE_FIELDS = Object.freeze([
  'createdAt',
  'updatedAt',
  'audit.createDateTime',
  'audit.lastUpdateDateTime'
]);

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const out = { ...query };
  delete out.page;
  delete out.limit;
  return out;
}

function sanitizeRow(row = {}) {
  return pteAiProviderModel.sanitizeProviderForRead(row);
}

function applyJsonScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;

  const orgId = toPublicId(scope?.orgId || '');
  const userId = toPublicId(scope?.userId || '');
  return list.filter((row) => {
    if (orgId && !idsEqual(row?.orgId, orgId)) return false;
    if (userId && !idsEqual(row?.userId, userId)) return false;
    return true;
  });
}

function buildMongoScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};

  const clauses = [];
  const orgId = toPublicId(scope?.orgId || '');
  const userId = toPublicId(scope?.userId || '');
  if (orgId) clauses.push({ orgId });
  if (userId) clauses.push({ userId });

  if (!clauses.length) return { id: '__NO_MATCH__' };
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

function buildDateToken(value) {
  return String(value || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
}

function isDefaultUniqueConflict(error) {
  if (!error) return false;
  if (Number(error?.code) !== 11000) return false;
  const message = String(error?.message || error?.errmsg || error?.errorResponse?.errmsg || '').toLowerCase();
  if (!message) return false;
  if (message.includes('idx_pte_ai_providers_org_user_default_unique')) return true;
  return message.includes('orgid') && message.includes('userid') && message.includes('isdefault');
}

async function generateMongoProviderId(collection, requestedId = null, isoDateTime = null) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;
  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `PTEAIP${dateToken}${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const existing = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!existing) return candidate;
  }
  return `PTEAIP${Date.now()}`;
}

async function enforceSingleDefaultMongo(collection, row = {}) {
  if (!row?.isDefault) return;
  const orgId = toPublicId(row.orgId);
  const userId = toPublicId(row.userId);
  const id = toPublicId(row.id);
  if (!orgId || !userId || !id) return;
  await collection.updateMany(
    {
      orgId,
      userId,
      id: { $ne: id }
    },
    {
      $set: {
        isDefault: false
      }
    }
  );
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
  const projection = (options?.projection && typeof options.projection === 'object' && !Array.isArray(options.projection))
    ? options.projection
    : null;

  let cursor = collection.find(filter, projection ? { projection } : {});
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const rows = await cursor.toArray();
  return rows
    .map((row) => normalizeMongoDocument(row))
    .filter(Boolean)
    .map((row) => sanitizeRow(row));
}

const pteAiProviderRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await pteAiProviderModel.getAllProviders();
        const scopedRows = applyJsonScope(rows, options?.scope || {});
        const filteredRows = applyGenericFilter(scopedRows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
        return filteredRows.map((row) => sanitizeRow(row));
      },
      mongo: async () => listMongoRows(options)
    }, 'pte.aiProviders.list');
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
    }, 'pte.aiProviders.count');
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
        const row = await pteAiProviderModel.getProviderById(id);
        return row ? sanitizeRow(row) : null;
      },
      mongo: async () => {
        const row = await getMongoCollection(COLLECTION_NAME).findOne(resolveMongoIdFilter(id));
        const normalized = normalizeMongoDocument(row);
        return normalized ? sanitizeRow(normalized) : null;
      }
    }, 'pte.aiProviders.getById');
  },

  async create(data, options = {}) {
    const created = await runByRepositoryBackend(options, {
      json: async () => {
        const created = await pteAiProviderModel.addProvider(data);
        return sanitizeRow(created);
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const normalized = pteAiProviderModel.normalizeProviderRecord(data, null, true);
        normalized.id = await generateMongoProviderId(collection, normalized.id, normalized.updatedAt || new Date().toISOString());
        if (normalized.isDefault) {
          await enforceSingleDefaultMongo(collection, normalized);
        }
        try {
          await collection.insertOne(normalized);
        } catch (error) {
          if (!normalized.isDefault || !isDefaultUniqueConflict(error)) throw error;
          // Retry once after force-clearing existing defaults in this org/user scope.
          await enforceSingleDefaultMongo(collection, normalized);
          await collection.insertOne(normalized);
        }
        await enforceSingleDefaultMongo(collection, normalized);
        const fresh = await collection.findOne(resolveMongoIdFilter(normalized.id));
        const out = normalizeMongoDocument(fresh || normalized);
        return sanitizeRow(out);
      }
    }, 'pte.aiProviders.create');
    await actionStateChangeTrackerService.trackCreate({
      source: 'pte',
      entityType: 'pteAiProviders',
      entityId: toPublicId(created?.id || '')
    });
    return created;
  },

  async update(id, data, options = {}) {
    let beforeSnapshot = null;
    try {
      beforeSnapshot = await this.getById(id, options);
    } catch (_) {
      beforeSnapshot = null;
    }

    const updated = await runByRepositoryBackend(options, {
      json: async () => {
        const updated = await pteAiProviderModel.updateProvider(id, data);
        return sanitizeRow(updated);
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('PTE AI provider not found.');
        const existingRow = normalizeMongoDocument(existing);
        const normalized = pteAiProviderModel.normalizeProviderRecord(
          {
            ...existingRow,
            ...(data || {}),
            id: existingRow.id,
            orgId: existingRow.orgId,
            userId: existingRow.userId
          },
          existingRow,
          true
        );
        const { _id, ...toSet } = normalized;
        if (normalized.isDefault) {
          await enforceSingleDefaultMongo(collection, normalized);
        }
        try {
          await collection.updateOne({ _id: existing._id }, { $set: toSet });
        } catch (error) {
          if (!normalized.isDefault || !isDefaultUniqueConflict(error)) throw error;
          // Retry once after force-clearing existing defaults in this org/user scope.
          await enforceSingleDefaultMongo(collection, normalized);
          await collection.updateOne({ _id: existing._id }, { $set: toSet });
        }
        await enforceSingleDefaultMongo(collection, normalized);
        const fresh = await collection.findOne({ _id: existing._id });
        return sanitizeRow(normalizeMongoDocument(fresh));
      }
    }, 'pte.aiProviders.update');
    if (beforeSnapshot && typeof beforeSnapshot === 'object') {
      await actionStateChangeTrackerService.trackUpdate({
        source: 'pte',
        entityType: 'pteAiProviders',
        entityId: toPublicId(updated?.id || id || ''),
        before: beforeSnapshot,
        after: updated || {}
      });
    }
    return updated;
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => pteAiProviderModel.deleteProvider(id, {
        userId: options?.scope?.userId || options?.userId || '',
        orgId: options?.scope?.orgId || options?.orgId || ''
      }),
      mongo: async () => {
        const filter = resolveMongoIdFilter(id);
        const scoped = options?.scope || {};
        if (scoped?.canViewAll !== true) {
          const orgId = toPublicId(scoped?.orgId || '');
          const userId = toPublicId(scoped?.userId || '');
          if (orgId) filter.orgId = orgId;
          if (userId) filter.userId = userId;
        }
        const result = await getMongoCollection(COLLECTION_NAME).deleteOne(filter);
        return Number(result?.deletedCount || 0) > 0;
      }
    }, 'pte.aiProviders.remove');
  }
};

assertQueryableCrudRepository('pteAiProviderRepository', pteAiProviderRepository);

module.exports = pteAiProviderRepository;
