const { applyGenericFilter } = require('../utils/queryEngine');
const activityQuotaLedgerModel = require('../models/activityQuotaLedgerModel');
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
  'section',
  'operation',
  'entryType',
  'source.eventType',
  'source.eventId',
  'source.idempotencyKey',
  'creator.displayName'
]);

const DEFAULT_DATE_FIELDS = Object.freeze([
  'dateTime',
  'audit.createDateTime',
  'audit.lastUpdateDateTime'
]);

function normalizeEntryTypeToken(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token) return '';
  return ['credit', 'consumption', 'adjustment'].includes(token) ? token : token;
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
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

function buildDateToken(isoDateTime) {
  const base = String(isoDateTime || new Date().toISOString()).slice(0, 10);
  return base.replace(/-/g, '');
}

async function generateMongoLedgerId(collection, requestedId = null, isoDateTime = null) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;

  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `AQL${dateToken}${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!exists) return candidate;
  }
  return `AQL${Date.now()}`;
}

async function listMongoRows(options = {}) {
  const collection = getMongoCollection('activityQuotaLedger');
  const query = options?.query || {};
  const scopeFilter = buildMongoScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: DEFAULT_SEARCH_FIELDS,
    dateFields: DEFAULT_DATE_FIELDS
  });
  const filter = combineMongoFilters(scopeFilter, queryFilter);
  const sort = buildMongoSortFromQuery(query, options?.sort || { dateTime: -1, id: -1 });
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);

  let cursor = collection.find(filter);
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const rows = await cursor.toArray();
  return rows.map(normalizeMongoDocument).filter(Boolean);
}

const activityQuotaLedgerRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const allRows = await activityQuotaLedgerModel.getAllEntries();
        const scopedRows = applyJsonScope(allRows, options?.scope || {});
        return applyGenericFilter(scopedRows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
      },
      mongo: async () => listMongoRows(options)
    }, 'core.activityQuotaLedger.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    const rows = await this.list({
      ...options,
      query
    });
    return Array.isArray(rows) ? rows.length : 0;
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

  async getById(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => activityQuotaLedgerModel.getEntryById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('activityQuotaLedger').findOne(resolveMongoIdFilter(id)))
    }, 'core.activityQuotaLedger.getById');
  },

  async findBySourceIdempotencyKey(orgId, idempotencyKey, options = {}) {
    const resolvedOrgId = toPublicId(orgId);
    const normalizedKey = String(idempotencyKey || '').trim();
    if (!resolvedOrgId || !normalizedKey) return null;

    const normalizedUserId = toPublicId(options?.userId || '');
    const normalizedSection = String(options?.section || '').trim();
    const normalizedOperation = String(options?.operation || '').trim();
    const normalizedEntryType = normalizeEntryTypeToken(options?.entryType);

    return runByRepositoryBackend(options, {
      json: async () => {
        const allRows = await activityQuotaLedgerModel.getAllEntries();
        const list = Array.isArray(allRows) ? allRows : [];
        const found = list.find((row) => {
          if (!idsEqual(row?.orgId, resolvedOrgId)) return false;
          if (String(row?.source?.idempotencyKey || '').trim() !== normalizedKey) return false;
          if (normalizedUserId && !idsEqual(row?.userId, normalizedUserId)) return false;
          if (normalizedSection && String(row?.section || '').trim() !== normalizedSection) return false;
          if (normalizedOperation && String(row?.operation || '').trim() !== normalizedOperation) return false;
          if (normalizedEntryType && String(row?.entryType || '').trim().toLowerCase() !== normalizedEntryType) return false;
          return true;
        });
        return found || null;
      },
      mongo: async () => {
        const collection = getMongoCollection('activityQuotaLedger');
        const filter = {
          orgId: resolvedOrgId,
          'source.idempotencyKey': normalizedKey
        };
        if (normalizedUserId) filter.userId = normalizedUserId;
        if (normalizedSection) filter.section = normalizedSection;
        if (normalizedOperation) filter.operation = normalizedOperation;
        if (normalizedEntryType) filter.entryType = normalizedEntryType;
        const found = await collection.findOne(filter, {
          sort: { dateTime: -1, id: -1 }
        });
        return normalizeMongoDocument(found);
      }
    }, 'core.activityQuotaLedger.findBySourceIdempotencyKey');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        if (Array.isArray(data)) return activityQuotaLedgerModel.addEntries(data);
        return activityQuotaLedgerModel.addEntry(data);
      },
      mongo: async () => {
        const collection = getMongoCollection('activityQuotaLedger');
        if (Array.isArray(data)) {
          const payloads = [];
          for (const rawItem of data) {
            const item = { ...(rawItem || {}) };
            // eslint-disable-next-line no-await-in-loop
            item.id = await generateMongoLedgerId(collection, item.id, item.dateTime);
            payloads.push(item);
          }
          if (payloads.length > 0) {
            await collection.insertMany(payloads);
          }
          return payloads.map((row) => normalizeMongoDocument(row)).filter(Boolean);
        }

        const payload = { ...(data || {}) };
        payload.id = await generateMongoLedgerId(collection, payload.id, payload.dateTime);
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.activityQuotaLedger.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => activityQuotaLedgerModel.updateEntry(id, data),
      mongo: async () => {
        const collection = getMongoCollection('activityQuotaLedger');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Activity quota ledger entry not found.');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.activityQuotaLedger.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => activityQuotaLedgerModel.deleteEntry(id),
      mongo: async () => getMongoCollection('activityQuotaLedger').deleteOne(resolveMongoIdFilter(id))
    }, 'core.activityQuotaLedger.remove');
  },

  async clearByOrg(orgId, options = {}) {
    const targetOrgId = toPublicId(orgId);
    if (!targetOrgId) throw new Error('orgId is required to clear activity quota ledger entries.');

    return runByRepositoryBackend(options, {
      json: async () => activityQuotaLedgerModel.clearEntriesByOrg(targetOrgId),
      mongo: async () => {
        const collection = getMongoCollection('activityQuotaLedger');
        const before = await collection.countDocuments({ orgId: targetOrgId });
        if (!before) return { removed: 0, remaining: await collection.countDocuments({}) };
        await collection.deleteMany({ orgId: targetOrgId });
        return {
          removed: before,
          remaining: await collection.countDocuments({})
        };
      }
    }, 'core.activityQuotaLedger.clearByOrg');
  }
};

assertQueryableCrudRepository('activityQuotaLedgerRepository', activityQuotaLedgerRepository);

module.exports = activityQuotaLedgerRepository;
