const pteAiScoringSettingModel = require('../models/pte/pteAiScoringSettingModel');
const {
  applyGenericFilter,
  runByRepositoryBackend,
  getMongoCollection,
  toPublicId,
  idsEqual,
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter,
  actionStateChangeTrackerService
} = require('./pteAiRepositoryDependencies');

const COLLECTION_NAME = 'pteAiScoringSettings';
const DEFAULT_SEARCH_FIELDS = Object.freeze([
  'id',
  'orgId',
  'questionType',
  'providerRecordId',
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
  return pteAiScoringSettingModel.sanitizeScoringSettingForRead(row);
}

function normalizeQuestionType(value = '') {
  return pteAiScoringSettingModel.normalizeQuestionType(value);
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
    const candidate = `PTEAISS${dateToken}${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const existing = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!existing) return candidate;
  }
  return `PTEAISS${Date.now()}`;
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

const pteAiScoringSettingRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await pteAiScoringSettingModel.getAllSettings();
        const scopedRows = applyJsonScope(rows, options?.scope || {});
        const filteredRows = applyGenericFilter(scopedRows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
        return filteredRows.map((row) => sanitizeRow(row));
      },
      mongo: async () => listMongoRows(options)
    }, 'pte.aiScoringSettings.list');
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
    }, 'pte.aiScoringSettings.count');
  },

  async getById(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const row = await pteAiScoringSettingModel.getSettingById(id);
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
    }, 'pte.aiScoringSettings.getById');
  },

  async getByOrgQuestionType(orgId, questionType, options = {}) {
    const orgToken = toPublicId(orgId);
    const typeToken = normalizeQuestionType(questionType);
    if (!orgToken || !typeToken) return null;

    return runByRepositoryBackend(options, {
      json: async () => {
        const row = await pteAiScoringSettingModel.getSettingByOrgQuestionType(orgToken, typeToken);
        if (!row) return null;
        const scopedRows = applyJsonScope([row], options?.scope || {});
        return scopedRows.length ? sanitizeRow(scopedRows[0]) : null;
      },
      mongo: async () => {
        const filter = combineMongoFilters(
          { orgId: orgToken, questionType: typeToken },
          buildMongoScopeFilter(options?.scope || {})
        );
        const row = await getMongoCollection(COLLECTION_NAME).findOne(filter);
        const normalized = normalizeMongoDocument(row);
        return normalized ? sanitizeRow(normalized) : null;
      }
    }, 'pte.aiScoringSettings.getByOrgQuestionType');
  },

  async upsertForOrgQuestionType(data, options = {}) {
    let beforeSnapshot = null;
    try {
      beforeSnapshot = await this.getByOrgQuestionType(data?.orgId, data?.questionType, options);
    } catch (_) {
      beforeSnapshot = null;
    }

    const saved = await runByRepositoryBackend(options, {
      json: async () => {
        const saved = await pteAiScoringSettingModel.upsertSettingForOrgQuestionType(data);
        return sanitizeRow(saved);
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const existing = await collection.findOne({
          orgId: toPublicId(data?.orgId),
          questionType: normalizeQuestionType(data?.questionType)
        });
        const existingRow = normalizeMongoDocument(existing);
        const normalized = pteAiScoringSettingModel.normalizeScoringSettingRecord(
          {
            ...(existingRow || {}),
            ...(data || {}),
            id: existingRow?.id || data?.id || '',
            orgId: toPublicId(data?.orgId),
            questionType: normalizeQuestionType(data?.questionType)
          },
          existingRow || null,
          true
        );
        normalized.id = await generateMongoSettingId(collection, normalized.id, normalized.updatedAt || new Date().toISOString());
        const { _id, ...toSet } = normalized;

        await collection.updateOne(
          { orgId: normalized.orgId, questionType: normalized.questionType },
          { $set: toSet },
          { upsert: true }
        );

        const fresh = await collection.findOne({ orgId: normalized.orgId, questionType: normalized.questionType });
        return sanitizeRow(normalizeMongoDocument(fresh));
      }
    }, 'pte.aiScoringSettings.upsertForOrgQuestionType');

    if (beforeSnapshot && typeof beforeSnapshot === 'object') {
      await actionStateChangeTrackerService.trackUpdate({
        source: 'pte',
        entityType: 'pteAiScoringSettings',
        entityId: toPublicId(saved?.id || ''),
        before: beforeSnapshot,
        after: saved || {}
      });
    } else {
      await actionStateChangeTrackerService.trackCreate({
        source: 'pte',
        entityType: 'pteAiScoringSettings',
        entityId: toPublicId(saved?.id || '')
      });
    }

    return saved;
  },

  async remove(id, options = {}) {
    const removed = await runByRepositoryBackend(options, {
      json: async () => pteAiScoringSettingModel.deleteSetting(id, {
        orgId: options?.scope?.orgId || options?.orgId || ''
      }),
      mongo: async () => {
        const filter = combineMongoFilters(resolveMongoIdFilter(id), buildMongoScopeFilter(options?.scope || {}));
        const result = await getMongoCollection(COLLECTION_NAME).deleteOne(filter);
        return Number(result?.deletedCount || 0) > 0;
      }
    }, 'pte.aiScoringSettings.remove');

    if (removed) {
      await actionStateChangeTrackerService.trackDelete?.({
        source: 'pte',
        entityType: 'pteAiScoringSettings',
        entityId: toPublicId(id || '')
      });
    }
    return removed;
  }
};

module.exports = pteAiScoringSettingRepository;
