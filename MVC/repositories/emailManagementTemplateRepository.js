const { applyGenericFilter } = require('../utils/queryEngine');
const emailManagementTemplateModel = require('../models/emailManagementTemplateModel');
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

const COLLECTION_NAME = 'emailManagementTemplates';
const DEFAULT_SEARCH_FIELDS = Object.freeze([
  'id',
  'orgId',
  'sectionId',
  'operationId',
  'senderTemplate',
  'recipientTemplate',
  'subjectTemplate',
  'bodyTemplate'
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

function normalizeKeyToken(value = '') {
  return String(value || '').trim().toUpperCase();
}

function sanitizeRow(row = {}) {
  return emailManagementTemplateModel.sanitizeTemplateForRead(row);
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

function assertUniquePair(rows = [], targetRow = {}, excludeId = '') {
  const orgId = toPublicId(targetRow?.orgId || '');
  const sectionId = normalizeKeyToken(targetRow?.sectionId || '');
  const operationId = normalizeKeyToken(targetRow?.operationId || '');
  if (!orgId || !sectionId || !operationId) return;
  const conflict = (Array.isArray(rows) ? rows : []).find((row) => {
    if (excludeId && idsEqual(row?.id, excludeId)) return false;
    return idsEqual(row?.orgId, orgId)
      && normalizeKeyToken(row?.sectionId || '') === sectionId
      && normalizeKeyToken(row?.operationId || '') === operationId;
  });
  if (conflict) {
    throw new Error('A template for this section/operation already exists in the selected organization.');
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

const emailManagementTemplateRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await emailManagementTemplateModel.getAllTemplates();
        const scopedRows = applyJsonScope(rows, options?.scope || {});
        const filteredRows = applyGenericFilter(scopedRows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
        return filteredRows.map((row) => sanitizeRow(row));
      },
      mongo: async () => listMongoRows(options)
    }, 'core.emailTemplates.list');
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
    }, 'core.emailTemplates.count');
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
        const row = await emailManagementTemplateModel.getTemplateById(id);
        return row ? sanitizeRow(row) : null;
      },
      mongo: async () => {
        const row = await getMongoCollection(COLLECTION_NAME).findOne(resolveMongoIdFilter(id));
        const normalized = normalizeMongoDocument(row);
        return normalized ? sanitizeRow(normalized) : null;
      }
    }, 'core.emailTemplates.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await emailManagementTemplateModel.getAllTemplates();
        const normalized = emailManagementTemplateModel.normalizeTemplateRecord(data, null, true);
        assertUniquePair(rows, normalized, '');
        const created = await emailManagementTemplateModel.addTemplate(normalized);
        return sanitizeRow(created);
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const rows = await listMongoRows({
          scope: { canViewAll: true },
          query: {
            orgId__eq: toPublicId(data?.orgId || ''),
            sectionId__eq: normalizeKeyToken(data?.sectionId || ''),
            operationId__eq: normalizeKeyToken(data?.operationId || ''),
            page: 1,
            limit: 5
          }
        });
        const normalized = emailManagementTemplateModel.normalizeTemplateRecord(data, null, true);
        assertUniquePair(rows, normalized, '');
        normalized.id = await generateUniqueStringId(collection, normalized.id);
        await collection.insertOne(normalized);
        return sanitizeRow(normalizeMongoDocument(normalized));
      }
    }, 'core.emailTemplates.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await emailManagementTemplateModel.getAllTemplates();
        const existing = rows.find((row) => idsEqual(row?.id, id));
        if (!existing) throw new Error('Email template not found.');
        const normalized = emailManagementTemplateModel.normalizeTemplateRecord(
          { ...existing, ...(data || {}), id: existing.id, orgId: existing.orgId },
          existing,
          true
        );
        assertUniquePair(rows, normalized, existing.id);
        const updated = await emailManagementTemplateModel.updateTemplate(id, normalized);
        return sanitizeRow(updated);
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Email template not found.');

        const existingRow = normalizeMongoDocument(existing);
        const normalized = emailManagementTemplateModel.normalizeTemplateRecord(
          {
            ...existingRow,
            ...(data || {}),
            id: existingRow.id,
            orgId: existingRow.orgId
          },
          existingRow,
          true
        );

        const rows = await listMongoRows({
          scope: { canViewAll: true },
          query: {
            orgId__eq: normalized.orgId,
            sectionId__eq: normalized.sectionId,
            operationId__eq: normalized.operationId,
            page: 1,
            limit: 10
          }
        });
        assertUniquePair(rows, normalized, existingRow.id);

        const { _id, ...toSet } = deepMerge(existing, normalized);
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        const fresh = await collection.findOne({ _id: existing._id });
        return sanitizeRow(normalizeMongoDocument(fresh));
      }
    }, 'core.emailTemplates.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => emailManagementTemplateModel.deleteTemplate(id),
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
    }, 'core.emailTemplates.remove');
  },

  async getActiveTemplate(orgId = '', sectionId = '', operationId = '', options = {}) {
    const query = {
      orgId__eq: toPublicId(orgId),
      sectionId__eq: normalizeKeyToken(sectionId),
      operationId__eq: normalizeKeyToken(operationId),
      isActive__eq: true,
      page: 1,
      limit: 5
    };
    const rows = await this.list({
      ...options,
      scope: { canViewAll: true },
      query,
      sort: { updatedAt: -1, id: -1 }
    });
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  },

  isUniqueConflict(error = null) {
    return hasUniqueConflict(error);
  }
};

assertQueryableCrudRepository('emailManagementTemplateRepository', emailManagementTemplateRepository);

module.exports = emailManagementTemplateRepository;
