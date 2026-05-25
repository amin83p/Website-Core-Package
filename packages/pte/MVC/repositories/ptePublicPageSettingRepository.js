const { applyGenericFilter } = require('../utils/queryEngine');
const ptePublicPageSettingModel = require('../models/pte/ptePublicPageSettingModel');
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

const COLLECTION_NAME = 'ptePublicPageSettings';
const DEFAULT_SEARCH_FIELDS = Object.freeze([
  'id',
  'orgId',
  'page.hero.title',
  'page.hero.subtitle',
  'page.finalCta.title',
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
  return ptePublicPageSettingModel.sanitizeSettingForRead(row);
}

function applyJsonScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;

  const orgId = toPublicId(scope?.orgId || '');
  return list.filter((row) => {
    if (orgId && !idsEqual(row?.orgId, orgId)) return false;
    return true;
  });
}

function buildMongoScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const orgId = toPublicId(scope?.orgId || '');
  if (orgId) return { orgId };
  return { id: '__NO_MATCH__' };
}

function buildDateToken(value) {
  return String(value || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
}

async function generateMongoSettingId(collection, requestedId = null, isoDateTime = null) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;
  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `PTEPUB${dateToken}${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const existing = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!existing) return candidate;
  }
  return `PTEPUB${Date.now()}`;
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

const ptePublicPageSettingRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await ptePublicPageSettingModel.getAllSettings();
        const scopedRows = applyJsonScope(rows, options?.scope || {});
        const filteredRows = applyGenericFilter(scopedRows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
        return filteredRows.map((row) => sanitizeRow(row));
      },
      mongo: async () => listMongoRows(options)
    }, 'pte.publicPageSettings.list');
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
    }, 'pte.publicPageSettings.count');
  },

  async getById(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const row = await ptePublicPageSettingModel.getSettingById(id);
        if (!row) return null;
        const scopedRows = applyJsonScope([row], options?.scope || {});
        return scopedRows.length ? sanitizeRow(scopedRows[0]) : null;
      },
      mongo: async () => {
        const filter = combineMongoFilters(resolveMongoIdFilter(id), buildMongoScopeFilter(options?.scope || {}));
        const row = await getMongoCollection(COLLECTION_NAME).findOne(filter);
        const normalized = normalizeMongoDocument(row);
        return normalized ? sanitizeRow(normalized) : null;
      }
    }, 'pte.publicPageSettings.getById');
  },

  async getByOrgId(orgId, options = {}) {
    const orgToken = toPublicId(orgId);
    if (!orgToken) return null;

    return runByRepositoryBackend(options, {
      json: async () => {
        const row = await ptePublicPageSettingModel.getSettingByOrgId(orgToken);
        if (!row) return null;
        const scopedRows = applyJsonScope([row], options?.scope || {});
        return scopedRows.length ? sanitizeRow(scopedRows[0]) : null;
      },
      mongo: async () => {
        const filter = combineMongoFilters({ orgId: orgToken }, buildMongoScopeFilter(options?.scope || {}));
        const row = await getMongoCollection(COLLECTION_NAME).findOne(filter);
        const normalized = normalizeMongoDocument(row);
        return normalized ? sanitizeRow(normalized) : null;
      }
    }, 'pte.publicPageSettings.getByOrgId');
  },

  async upsertForOrgId(data, options = {}) {
    let beforeSnapshot = null;
    try {
      beforeSnapshot = await this.getByOrgId(data?.orgId, options);
    } catch (_) {
      beforeSnapshot = null;
    }

    const saved = await runByRepositoryBackend(options, {
      json: async () => {
        const saved = await ptePublicPageSettingModel.upsertSettingForOrgId(data);
        return sanitizeRow(saved);
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const existing = await collection.findOne({ orgId: toPublicId(data?.orgId) });
        const existingRow = normalizeMongoDocument(existing);
        const normalized = ptePublicPageSettingModel.normalizePublicPageSettingRecord(
          {
            ...(existingRow || {}),
            ...(data || {}),
            id: existingRow?.id || data?.id || '',
            orgId: toPublicId(data?.orgId)
          },
          existingRow || null,
          true
        );
        normalized.id = await generateMongoSettingId(collection, normalized.id, normalized.updatedAt || new Date().toISOString());
        const { _id, ...toSet } = normalized;

        await collection.updateOne(
          { orgId: normalized.orgId },
          { $set: toSet },
          { upsert: true }
        );

        const fresh = await collection.findOne({ orgId: normalized.orgId });
        return sanitizeRow(normalizeMongoDocument(fresh));
      }
    }, 'pte.publicPageSettings.upsertForOrgId');

    if (beforeSnapshot && typeof beforeSnapshot === 'object') {
      await actionStateChangeTrackerService.trackUpdate({
        source: 'pte',
        entityType: COLLECTION_NAME,
        entityId: toPublicId(saved?.id || ''),
        before: beforeSnapshot,
        after: saved || {}
      });
    } else {
      await actionStateChangeTrackerService.trackCreate({
        source: 'pte',
        entityType: COLLECTION_NAME,
        entityId: toPublicId(saved?.id || '')
      });
    }

    return saved;
  }
};

module.exports = ptePublicPageSettingRepository;
