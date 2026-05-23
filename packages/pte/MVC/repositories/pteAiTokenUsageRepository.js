const tokenUsageModel = require('../models/pte/pteAiTokenUsageModel');
const {
  applyGenericFilter,
  assertQueryableCrudRepository,
  runByRepositoryBackend,
  getMongoCollection,
  toPublicId,
  idsEqual,
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter
} = require('./pteAiRepositoryDependencies');

const COLLECTION_NAME = 'pteAiTokenUsages';
const DEFAULT_SEARCH_FIELDS = Object.freeze([
  'id',
  'orgId',
  'userId',
  'section',
  'operation',
  'objectId',
  'providerId',
  'providerRecordName',
  'modelUsed',
  'requestLabel',
  'status',
  'errorMessage'
]);
const DEFAULT_DATE_FIELDS = Object.freeze([
  'consumedAt',
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

async function generateMongoUsageId(collection, requestedId = null, isoDateTime = null) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;
  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `PTEAIU${dateToken}${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const existing = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!existing) return candidate;
  }
  return `PTEAIU${Date.now()}`;
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
  const sort = buildMongoSortFromQuery(query, options?.sort || { consumedAt: -1, id: -1 });
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
    .filter(Boolean);
}

const pteAiTokenUsageRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await tokenUsageModel.getAllTokenUsages();
        const scopedRows = applyJsonScope(rows, options?.scope || {});
        return applyGenericFilter(scopedRows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
      },
      mongo: async () => listMongoRows(options)
    }, 'pte.aiTokenUsages.list');
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
    }, 'pte.aiTokenUsages.count');
  },

  async getById(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => tokenUsageModel.getTokenUsageById(id),
      mongo: async () => {
        const row = await getMongoCollection(COLLECTION_NAME).findOne(resolveMongoIdFilter(id));
        return normalizeMongoDocument(row);
      }
    }, 'pte.aiTokenUsages.getById');
  },

  async create(data = {}, options = {}) {
    const payload = data && typeof data === 'object' ? data : {};
    return runByRepositoryBackend(options, {
      json: async () => tokenUsageModel.addTokenUsage(payload),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const normalized = tokenUsageModel.normalizeTokenUsageRecord(payload, null, true);
        normalized.id = await generateMongoUsageId(collection, normalized.id, normalized.consumedAt || new Date().toISOString());
        await collection.insertOne(normalized);
        const fresh = await collection.findOne(resolveMongoIdFilter(normalized.id));
        return normalizeMongoDocument(fresh || normalized);
      }
    }, 'pte.aiTokenUsages.create');
  },

  async update() {
    throw new Error('PTE AI token usage ledger is append-only and does not support update.');
  },

  async remove() {
    throw new Error('PTE AI token usage ledger is append-only and does not support remove.');
  },

  async exists(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = stripPaginationFromQuery(options?.query || {});
        const rows = await this.list({ ...options, query });
        return Array.isArray(rows) && rows.length > 0;
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
        const one = await collection.findOne(filter, { projection: { _id: 1 } });
        return Boolean(one);
      }
    }, 'pte.aiTokenUsages.exists');
  }
};

assertQueryableCrudRepository('pteAiTokenUsageRepository', pteAiTokenUsageRepository);

module.exports = pteAiTokenUsageRepository;
