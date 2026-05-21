const { applyGenericFilter } = require('../utils/queryEngine');
const activityQuotaPackageModel = require('../models/activityQuotaPackageModel');
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
  'visibility',
  'creator.displayName',
  'creator.username',
  'price.currencyCode',
  'eligibleRoles',
  'accessProfiles.id',
  'accessProfiles.name',
  'bannedUsers.id',
  'bannedUsers.name',
  'sections.id',
  'sections.name',
  'sections.operations.id',
  'sections.operations.name',
  'sections.operations.label'
]);

const DEFAULT_DATE_FIELDS = Object.freeze([
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

async function generateMongoPackageId(collection, requestedId = null, isoDateTime = null) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;

  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `AQP${dateToken}${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!exists) return candidate;
  }
  return `AQP${Date.now()}`;
}

async function listMongoRows(options = {}) {
  const collection = getMongoCollection('activityQuotaPackages');
  const query = options?.query || {};
  const scopeFilter = buildMongoScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: DEFAULT_SEARCH_FIELDS,
    dateFields: DEFAULT_DATE_FIELDS
  });
  const filter = combineMongoFilters(scopeFilter, queryFilter);
  const sort = buildMongoSortFromQuery(query, options?.sort || { 'audit.createDateTime': -1, id: -1 });
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);

  let cursor = collection.find(filter);
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const rows = await cursor.toArray();
  return rows.map(normalizeMongoDocument).filter(Boolean);
}

const activityQuotaPackageRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const allRows = await activityQuotaPackageModel.getAllPackages();
        const scopedRows = applyJsonScope(allRows, options?.scope || {});
        return applyGenericFilter(scopedRows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
      },
      mongo: async () => listMongoRows(options)
    }, 'core.activityQuotaPackages.list');
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
      json: async () => activityQuotaPackageModel.getPackageById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('activityQuotaPackages').findOne(resolveMongoIdFilter(id)))
    }, 'core.activityQuotaPackages.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => activityQuotaPackageModel.addPackage(data),
      mongo: async () => {
        const collection = getMongoCollection('activityQuotaPackages');
        const payload = { ...(data || {}) };
        payload.id = await generateMongoPackageId(collection, payload.id, payload?.audit?.createDateTime || new Date().toISOString());
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'core.activityQuotaPackages.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => activityQuotaPackageModel.updatePackage(id, data),
      mongo: async () => {
        const collection = getMongoCollection('activityQuotaPackages');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('Activity quota package not found.');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'core.activityQuotaPackages.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => activityQuotaPackageModel.deletePackage(id),
      mongo: async () => getMongoCollection('activityQuotaPackages').deleteOne(resolveMongoIdFilter(id))
    }, 'core.activityQuotaPackages.remove');
  }
};

assertQueryableCrudRepository('activityQuotaPackageRepository', activityQuotaPackageRepository);

module.exports = activityQuotaPackageRepository;
