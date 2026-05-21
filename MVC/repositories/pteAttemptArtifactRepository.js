const { applyGenericFilter } = require('../utils/queryEngine');
const artifactModel = require('../models/pte/pteAttemptArtifactModel');
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
  'artifactType',
  'status',
  'clientArtifactId',
  'name',
  'mimeType',
  'referenceId',
  'source.eventId'
]);

const DEFAULT_DATE_FIELDS = Object.freeze([
  'createdAt',
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

async function generateMongoArtifactId(collection, requestedId = null, isoDateTime = null) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;
  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `PTAA${dateToken}${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const existing = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!existing) return candidate;
  }
  return `PTAA${Date.now()}`;
}

async function listMongoRows(options = {}) {
  const collection = getMongoCollection('pteAttemptArtifacts');
  const query = options?.query || {};
  const scopeFilter = buildMongoScopeFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: DEFAULT_SEARCH_FIELDS,
    dateFields: DEFAULT_DATE_FIELDS
  });
  const filter = combineMongoFilters(scopeFilter, queryFilter);
  const sort = buildMongoSortFromQuery(query, options?.sort || { createdAt: -1, id: -1 });
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);

  let cursor = collection.find(filter);
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const rows = await cursor.toArray();
  return rows.map((row) => normalizeMongoDocument(row)).filter(Boolean);
}

const pteAttemptArtifactRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await artifactModel.getAllArtifacts();
        const scopedRows = applyJsonScope(rows, options?.scope || {});
        return applyGenericFilter(scopedRows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
      },
      mongo: async () => listMongoRows(options)
    }, 'pte.attempt.artifacts.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    const rows = await this.list({ ...options, query });
    return Array.isArray(rows) ? rows.length : 0;
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
      json: async () => artifactModel.getArtifactById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection('pteAttemptArtifacts').findOne(resolveMongoIdFilter(id)))
    }, 'pte.attempt.artifacts.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => artifactModel.addArtifact(data),
      mongo: async () => {
        const collection = getMongoCollection('pteAttemptArtifacts');
        const payload = { ...(data || {}) };
        payload.id = await generateMongoArtifactId(collection, payload.id, payload?.createdAt || payload?.audit?.createDateTime || new Date().toISOString());
        await collection.insertOne(payload);
        return normalizeMongoDocument(payload);
      }
    }, 'pte.attempt.artifacts.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => artifactModel.updateArtifact(id, data),
      mongo: async () => {
        const collection = getMongoCollection('pteAttemptArtifacts');
        const existing = await collection.findOne(resolveMongoIdFilter(id));
        if (!existing) throw new Error('PTE attempt artifact not found.');
        const merged = deepMerge(existing, data || {});
        merged.id = toPublicId(existing?.id || existing?._id);
        const { _id, ...toSet } = merged;
        await collection.updateOne({ _id: existing._id }, { $set: toSet });
        return normalizeMongoDocument(await collection.findOne({ _id: existing._id }));
      }
    }, 'pte.attempt.artifacts.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => artifactModel.deleteArtifact(id),
      mongo: async () => getMongoCollection('pteAttemptArtifacts').deleteOne(resolveMongoIdFilter(id))
    }, 'pte.attempt.artifacts.remove');
  }
};

assertQueryableCrudRepository('pteAttemptArtifactRepository', pteAttemptArtifactRepository);

module.exports = pteAttemptArtifactRepository;
