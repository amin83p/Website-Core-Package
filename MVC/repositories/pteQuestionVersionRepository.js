const { applyGenericFilter } = require('../utils/queryEngine');
const questionVersionModel = require('../models/pte/pteQuestionVersionModel');
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
const actionStateChangeTrackerService = require('../services/actionStateChangeTrackerService');

const DEFAULT_SEARCH_FIELDS = Object.freeze([
  'id',
  'orgId',
  'familyId',
  'parentVersionId',
  'code',
  'title',
  'testType',
  'skill',
  'questionType',
  'practiceEnabled',
  'status',
  'difficulty',
  'tags',
  'creator.displayName',
  'creator.userId'
]);

const DEFAULT_DATE_FIELDS = Object.freeze([
  'audit.createDateTime',
  'audit.lastUpdateDateTime',
  'publishingMeta.publishedAt'
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

function buildDateToken(value) {
  return String(value || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
}

async function generateMongoQuestionId(collection, requestedId = null, isoDateTime = null) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;
  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `PTEQ${dateToken}${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const existing = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!existing) return candidate;
  }
  return `PTEQ${Date.now()}`;
}

async function generateMongoFamilyId(collection, requestedId = null, isoDateTime = null) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;
  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `PTEQF${dateToken}${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const existing = await collection.findOne({ familyId: candidate }, { projection: { _id: 1 } });
    if (!existing) return candidate;
  }
  return `PTEQF${Date.now()}`;
}

async function listMongoRows(options = {}) {
  const collection = getMongoCollection('pteQuestionVersions');
  const query = options?.query || {};
  const scopeFilter = buildMongoScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: DEFAULT_SEARCH_FIELDS,
    dateFields: DEFAULT_DATE_FIELDS
  });
  const filter = combineMongoFilters(scopeFilter, queryFilter);
  const sort = buildMongoSortFromQuery(query, options?.sort || { 'audit.createDateTime': -1, id: -1 });
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

const pteQuestionVersionRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await questionVersionModel.getAllQuestionVersions();
        const scopedRows = applyJsonScope(rows, options?.scope || {});
        return applyGenericFilter(scopedRows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
      },
      mongo: async () => listMongoRows(options)
    }, 'pte.questions.list');
  },

  async count(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = stripPaginationFromQuery(options?.query || {});
        const rows = await this.list({ ...options, query });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('pteQuestionVersions');
        const query = stripPaginationFromQuery(options?.query || {});
        const scopeFilter = buildMongoScopeFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return collection.countDocuments(filter);
      }
    }, 'pte.questions.count');
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

  async listByFamily(familyId, options = {}) {
    const token = toPublicId(familyId);
    if (!token) return [];
    return this.list({
      ...options,
      query: {
        ...(options?.query || {}),
        familyId__eq: token
      }
    });
  },

  async getById(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => questionVersionModel.getQuestionVersionById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('pteQuestionVersions').findOne(resolveMongoIdFilter(id)))
    }, 'pte.questions.getById');
  },

  async create(data, options = {}) {
    const created = await runByRepositoryBackend(options, {
      json: async () => questionVersionModel.addQuestionVersion(data),
      mongo: async () => {
        const collection = getMongoCollection('pteQuestionVersions');
        const payload = { ...(data || {}) };
        payload.id = await generateMongoQuestionId(collection, payload.id, payload?.audit?.createDateTime || new Date().toISOString());
        payload.familyId = await generateMongoFamilyId(collection, payload.familyId, payload?.audit?.createDateTime || new Date().toISOString());
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'pte.questions.create');
    await actionStateChangeTrackerService.trackCreate({
      source: 'pte',
      entityType: 'pteQuestionVersions',
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
      json: async () => questionVersionModel.updateQuestionVersion(id, data),
      mongo: async () => {
        const collection = getMongoCollection('pteQuestionVersions');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('PTE question version not found.');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'pte.questions.update');
    if (beforeSnapshot && typeof beforeSnapshot === 'object') {
      await actionStateChangeTrackerService.trackUpdate({
        source: 'pte',
        entityType: 'pteQuestionVersions',
        entityId: toPublicId(updated?.id || id || ''),
        before: beforeSnapshot,
        after: updated || {}
      });
    }
    return updated;
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => questionVersionModel.deleteQuestionVersion(id),
      mongo: async () => getMongoCollection('pteQuestionVersions').deleteOne(resolveMongoIdFilter(id))
    }, 'pte.questions.remove');
  }
};

assertQueryableCrudRepository('pteQuestionVersionRepository', pteQuestionVersionRepository);

module.exports = pteQuestionVersionRepository;
