const { applyGenericFilter } = require('../utils/queryEngine');
const eventModel = require('../models/pte/pteAttemptLedgerEventModel');
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
  deepMerge
} = require('./backend/mongoRepositoryUtils');

const DEFAULT_SEARCH_FIELDS = Object.freeze([
  'id',
  'orgId',
  'userId',
  'attemptSessionId',
  'attemptItemId',
  'attemptType',
  'eventType',
  'testVersionId',
  'questionVersionId',
  'questionType',
  'skill',
  'selfDifficultyRating',
  'source.eventId',
  'source.idempotencyKey'
]);

const DEFAULT_DATE_FIELDS = Object.freeze([
  'eventAt',
  'startedAt',
  'finishedAt',
  'feedbackProvidedAt',
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

async function generateMongoEventId(collection, requestedId = null, isoDateTime = null) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;
  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `PTAE${dateToken}${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const existing = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!existing) return candidate;
  }
  return `PTAE${Date.now()}`;
}

async function listMongoRows(options = {}) {
  const collection = getMongoCollection('pteAttemptLedgerEvents');
  const query = options?.query || {};
  const scopeFilter = buildMongoScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: DEFAULT_SEARCH_FIELDS,
    dateFields: DEFAULT_DATE_FIELDS
  });
  const filter = combineMongoFilters(scopeFilter, queryFilter);
  const sort = buildMongoSortFromQuery(query, options?.sort || { eventAt: -1, id: -1 });
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);
  const projection = (options?.projection && typeof options.projection === 'object' && !Array.isArray(options.projection))
    ? options.projection
    : null;

  let cursor = collection.find(filter, projection ? { projection } : {});
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const rows = await cursor.toArray();
  return rows.map((row) => normalizeMongoDocument(row)).filter(Boolean);
}

const pteAttemptLedgerEventRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await eventModel.getAllEvents();
        const scopedRows = applyJsonScope(rows, options?.scope || {});
        return applyGenericFilter(scopedRows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
      },
      mongo: async () => listMongoRows(options)
    }, 'pte.attempt.events.list');
  },

  async count(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = stripPaginationFromQuery(options?.query || {});
        const rows = await this.list({ ...options, query });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('pteAttemptLedgerEvents');
        const query = stripPaginationFromQuery(options?.query || {});
        const scopeFilter = buildMongoScopeFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return collection.countDocuments(filter);
      }
    }, 'pte.attempt.events.count');
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
      json: async () => eventModel.getEventById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('pteAttemptLedgerEvents').findOne(resolveMongoIdFilter(id)))
    }, 'pte.attempt.events.getById');
  },

  async findByIdempotencyKey(orgId, idempotencyKey, options = {}) {
    const normalizedOrgId = toPublicId(orgId || '');
    const normalizedKey = String(idempotencyKey || '').trim();
    if (!normalizedOrgId || !normalizedKey) return null;

    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await eventModel.getAllEvents();
        return rows.find((row) => (
          idsEqual(row?.orgId, normalizedOrgId)
          && String(row?.source?.idempotencyKey || '').trim() === normalizedKey
        )) || null;
      },
      mongo: async () => normalizeMongoDocument(await getMongoCollection('pteAttemptLedgerEvents').findOne({
        orgId: normalizedOrgId,
        'source.idempotencyKey': normalizedKey
      }))
    }, 'pte.attempt.events.findByIdempotencyKey');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => eventModel.addEvent(data),
      mongo: async () => {
        const collection = getMongoCollection('pteAttemptLedgerEvents');
        const payload = { ...(data || {}) };
        payload.id = await generateMongoEventId(collection, payload.id, payload?.eventAt || payload?.audit?.createDateTime || new Date().toISOString());
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'pte.attempt.events.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => eventModel.updateEvent(id, data),
      mongo: async () => {
        const collection = getMongoCollection('pteAttemptLedgerEvents');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('PTE attempt event not found.');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'pte.attempt.events.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => eventModel.deleteEvent(id),
      mongo: async () => getMongoCollection('pteAttemptLedgerEvents').deleteOne(resolveMongoIdFilter(id))
    }, 'pte.attempt.events.remove');
  }
};

assertQueryableCrudRepository('pteAttemptLedgerEventRepository', pteAttemptLedgerEventRepository);

module.exports = pteAttemptLedgerEventRepository;
