const coreBootstrapRunModel = require('../models/coreBootstrapRunModel');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const {
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter,
  generateUniqueStringId
} = require('./backend/mongoRepositoryUtils');

const COLLECTION_NAME = 'coreBootstrapRuns';
const DEFAULT_SEARCH_FIELDS = Object.freeze([
  'id',
  'runId',
  'action',
  'baselineId',
  'baselineVersion',
  'backendMode',
  'status'
]);
const DEFAULT_DATE_FIELDS = Object.freeze([
  'startedAt',
  'finishedAt',
  'audit.createDateTime',
  'audit.lastUpdateDateTime'
]);

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

async function listMongoRows(options = {}) {
  const collection = getMongoCollection(COLLECTION_NAME);
  const query = options?.query || {};
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: DEFAULT_SEARCH_FIELDS,
    dateFields: DEFAULT_DATE_FIELDS
  });
  const filter = combineMongoFilters(queryFilter);
  const sort = buildMongoSortFromQuery(query, options?.sort || { startedAt: -1, id: 1 });
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);

  let cursor = collection.find(filter);
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const rows = await cursor.toArray();
  return rows.map((row) => coreBootstrapRunModel.normalizePersistedRow(normalizeMongoDocument(row)));
}

const coreBootstrapRunRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => coreBootstrapRunModel.queryRows({ query: options?.query || {} }),
      mongo: async () => listMongoRows(options)
    }, 'core.coreBootstrapRuns.list');
  },

  async create(input = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => coreBootstrapRunModel.createRow(input, { actor: options?.actor || null }),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const providedId = cleanText(input?.id || input?.runId, 160);
        const id = providedId || await generateUniqueStringId(collection, 'CORE_BOOTSTRAP');
        const normalized = coreBootstrapRunModel.normalizeRow(
          { ...(input || {}), id, runId: id },
          null,
          { actor: options?.actor || null }
        );
        await collection.insertOne(normalized);
        return coreBootstrapRunModel.normalizePersistedRow(normalized);
      }
    }, 'core.coreBootstrapRuns.create');
  },

  async getById(id = '', options = {}) {
    const token = cleanText(id, 160);
    if (!token) return null;
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await coreBootstrapRunModel.queryRows({ query: { id__eq: token, limit: 1, page: 1 } });
        return Array.isArray(rows) && rows.length ? rows[0] : null;
      },
      mongo: async () => {
        const row = await getMongoCollection(COLLECTION_NAME).findOne(resolveMongoIdFilter(token));
        return row ? coreBootstrapRunModel.normalizePersistedRow(normalizeMongoDocument(row)) : null;
      }
    }, 'core.coreBootstrapRuns.getById');
  }
};

module.exports = coreBootstrapRunRepository;
