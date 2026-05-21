const { applyGenericFilter } = require('../utils/queryEngine');
const activityQuotaConsumptionDefinitionModel = require('../models/activityQuotaConsumptionDefinitionModel');
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
  'name',
  'description',
  'sectionId',
  'operationId',
  'sourceEventType',
  'targetUserIds',
  'consumeTiming',
  'creator.displayName',
  'creator.username'
]);

const DEFAULT_DATE_FIELDS = Object.freeze([
  'audit.createDateTime',
  'audit.lastUpdateDateTime',
  'validity.startDate',
  'validity.endDate'
]);

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
    if (userId) {
      const creatorUserId = toPublicId(row?.creator?.userId || row?.audit?.createUser || '');
      if (!creatorUserId || !idsEqual(creatorUserId, userId)) return false;
    }
    return true;
  });
}

function buildMongoScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const clauses = [];
  const orgId = toPublicId(scope?.orgId || '');
  const userId = toPublicId(scope?.userId || '');
  if (orgId) clauses.push({ orgId });
  if (userId) clauses.push({ 'creator.userId': userId });
  if (!clauses.length) return { id: '__NO_MATCH__' };
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

function buildDateToken(isoDateTime) {
  const base = String(isoDateTime || new Date().toISOString()).slice(0, 10);
  return base.replace(/-/g, '');
}

async function generateMongoDefinitionId(collection, requestedId = null, isoDateTime = null) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;

  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `AQD${dateToken}${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!exists) return candidate;
  }
  return `AQD${Date.now()}`;
}

async function listMongoRows(options = {}) {
  const collection = getMongoCollection('activityQuotaConsumptionDefinitions');
  const query = options?.query || {};
  const scopeFilter = buildMongoScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: DEFAULT_SEARCH_FIELDS,
    dateFields: DEFAULT_DATE_FIELDS
  });
  const filter = combineMongoFilters(scopeFilter, queryFilter);
  const sort = buildMongoSortFromQuery(query, options?.sort || { 'audit.lastUpdateDateTime': -1, id: -1 });
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);

  let cursor = collection.find(filter);
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const rows = await cursor.toArray();
  return rows.map(normalizeMongoDocument).filter(Boolean);
}

const activityQuotaConsumptionDefinitionRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const allRows = await activityQuotaConsumptionDefinitionModel.getAllDefinitions();
        const scopedRows = applyJsonScope(allRows, options?.scope || {});
        return applyGenericFilter(scopedRows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
      },
      mongo: async () => listMongoRows(options)
    }, 'core.activityQuotaConsumptionDefinitions.list');
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
      json: async () => activityQuotaConsumptionDefinitionModel.getDefinitionById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('activityQuotaConsumptionDefinitions').findOne(resolveMongoIdFilter(id)))
    }, 'core.activityQuotaConsumptionDefinitions.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => activityQuotaConsumptionDefinitionModel.addDefinition(data),
      mongo: async () => {
        const collection = getMongoCollection('activityQuotaConsumptionDefinitions');
        const payload = { ...(data || {}) };
        payload.id = await generateMongoDefinitionId(
          collection,
          payload.id,
          payload?.audit?.createDateTime || new Date().toISOString()
        );
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.activityQuotaConsumptionDefinitions.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => activityQuotaConsumptionDefinitionModel.updateDefinition(id, data),
      mongo: async () => {
        const collection = getMongoCollection('activityQuotaConsumptionDefinitions');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Activity quota consumption definition not found.');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.activityQuotaConsumptionDefinitions.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => activityQuotaConsumptionDefinitionModel.deleteDefinition(id),
      mongo: async () => getMongoCollection('activityQuotaConsumptionDefinitions').deleteOne(resolveMongoIdFilter(id))
    }, 'core.activityQuotaConsumptionDefinitions.remove');
  }
};

assertQueryableCrudRepository(
  'activityQuotaConsumptionDefinitionRepository',
  activityQuotaConsumptionDefinitionRepository
);

module.exports = activityQuotaConsumptionDefinitionRepository;
