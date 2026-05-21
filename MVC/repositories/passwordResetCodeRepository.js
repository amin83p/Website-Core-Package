const { applyGenericFilter } = require('../utils/queryEngine');
const passwordResetCodeModel = require('../models/passwordResetCodeModel');
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
  resolveMongoIdFilter,
  generateUniqueStringId,
  deepMerge
} = require('./backend/mongoRepositoryUtils');

const COLLECTION_NAME = 'passwordResetCodes';
const DEFAULT_SEARCH_FIELDS = Object.freeze(['id', 'orgId', 'userId', 'email', 'status', 'verificationToken']);
const DEFAULT_DATE_FIELDS = Object.freeze(['createdAt', 'updatedAt', 'expiresAt', 'verifiedAt', 'usedAt', 'revokedAt']);

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function sanitizeRow(row = {}) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  delete out.codeHash;
  return out;
}

function applyJsonScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;
  const orgId = toPublicId(scope?.orgId || '');
  if (!orgId) return [];
  return list.filter((row) => idsEqual(row?.orgId, orgId));
}

function buildMongoScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const orgId = toPublicId(scope?.orgId || '');
  if (!orgId) return { id: '__NO_MATCH__' };
  return { orgId };
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
  const sort = buildMongoSortFromQuery(query, options?.sort || { createdAt: -1, id: -1 });
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

const passwordResetCodeRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await passwordResetCodeModel.getAllCodes();
        const scopedRows = applyJsonScope(rows, options?.scope || {});
        const filteredRows = applyGenericFilter(scopedRows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
        return filteredRows.map((row) => sanitizeRow(row));
      },
      mongo: async () => listMongoRows(options)
    }, 'core.passwordResetCodes.list');
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
    }, 'core.passwordResetCodes.count');
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
        const row = await passwordResetCodeModel.getCodeById(id);
        return row ? sanitizeRow(row) : null;
      },
      mongo: async () => {
        const row = await getMongoCollection(COLLECTION_NAME).findOne(resolveMongoIdFilter(id));
        const normalized = normalizeMongoDocument(row);
        return normalized ? sanitizeRow(normalized) : null;
      }
    }, 'core.passwordResetCodes.getById');
  },

  async getRawById(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => passwordResetCodeModel.getCodeById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection(COLLECTION_NAME).findOne(resolveMongoIdFilter(id)))
    }, 'core.passwordResetCodes.getRawById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => passwordResetCodeModel.addCode(data),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const normalized = passwordResetCodeModel.normalizeRecord(data, null, true);
        normalized.id = await generateUniqueStringId(collection, normalized.id);
        await collection.insertOne(normalized);
        return sanitizeRow(normalizeMongoDocument(normalized));
      }
    }, 'core.passwordResetCodes.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => passwordResetCodeModel.updateCode(id, data),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Password reset code not found.');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const normalized = passwordResetCodeModel.normalizeRecord(merged, normalizeMongoDocument(existing), true);
        const { _id, ...toSet } = normalized;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        const fresh = await collection.findOne({ _id: existing._id });
        return sanitizeRow(normalizeMongoDocument(fresh));
      }
    }, 'core.passwordResetCodes.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => passwordResetCodeModel.removeCode(id),
      mongo: async () => {
        const result = await getMongoCollection(COLLECTION_NAME).deleteOne(resolveMongoIdFilter(id));
        return Number(result?.deletedCount || 0) > 0;
      }
    }, 'core.passwordResetCodes.remove');
  },

  async findActiveByEmail(email = '', options = {}) {
    const token = String(email || '').trim().toLowerCase();
    if (!token) return null;
    const rows = await this.list({
      ...options,
      scope: { canViewAll: true },
      query: {
        email__eq: token,
        status__eq: 'active',
        page: 1,
        limit: 50
      },
      sort: { createdAt: -1, id: -1 }
    });
    const nowMs = Date.now();
    const first = (Array.isArray(rows) ? rows : []).find((row) => {
      const expiresMs = Date.parse(String(row?.expiresAt || ''));
      if (!Number.isFinite(expiresMs)) return false;
      return expiresMs > nowMs;
    });
    return first || null;
  },

  async findActiveRawByEmail(email = '', options = {}) {
    const token = String(email || '').trim().toLowerCase();
    if (!token) return null;
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await passwordResetCodeModel.getAllCodes();
        const nowMs = Date.now();
        const candidates = rows
          .filter((row) => String(row?.email || '').toLowerCase() === token)
          .filter((row) => String(row?.status || '').toLowerCase() === 'active')
          .sort((a, b) => Date.parse(String(b?.createdAt || '')) - Date.parse(String(a?.createdAt || '')));
        const row = candidates.find((item) => {
          const expiresMs = Date.parse(String(item?.expiresAt || ''));
          return Number.isFinite(expiresMs) && expiresMs > nowMs;
        });
        return row || null;
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const nowIso = new Date().toISOString();
        const row = await collection.findOne(
          {
            email: token,
            status: 'active',
            expiresAt: { $gt: nowIso }
          },
          { sort: { createdAt: -1, id: -1 } }
        );
        return normalizeMongoDocument(row);
      }
    }, 'core.passwordResetCodes.findActiveRawByEmail');
  }
};

assertQueryableCrudRepository('passwordResetCodeRepository', passwordResetCodeRepository);

module.exports = passwordResetCodeRepository;
