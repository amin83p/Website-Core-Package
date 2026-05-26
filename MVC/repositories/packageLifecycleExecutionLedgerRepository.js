const packageLifecycleExecutionLedgerModel = require('../models/packageLifecycleExecutionLedgerModel');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const {
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter,
  deepMerge,
  generateUniqueStringId
} = require('./backend/mongoRepositoryUtils');

const COLLECTION_NAME = 'packageLifecycleExecutionLedger';
const DEFAULT_SEARCH_FIELDS = Object.freeze([
  'id',
  'packageId',
  'packageVersion',
  'stepId',
  'stepType',
  'direction',
  'status',
  'error'
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

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
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
  return rows.map((row) => packageLifecycleExecutionLedgerModel.normalizePersistedLedgerRow(normalizeMongoDocument(row)));
}

const packageLifecycleExecutionLedgerRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => packageLifecycleExecutionLedgerModel.queryRows({ query: options?.query || {} }),
      mongo: async () => listMongoRows(options)
    }, 'core.packageLifecycleExecutionLedger.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await packageLifecycleExecutionLedgerModel.queryRows({ query });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
        const filter = combineMongoFilters(queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.packageLifecycleExecutionLedger.count');
  },

  async getById(id = '', options = {}) {
    const token = cleanText(id, 180);
    if (!token) return null;
    return runByRepositoryBackend(options, {
      json: async () => packageLifecycleExecutionLedgerModel.getById(token),
      mongo: async () => {
        const row = await getMongoCollection(COLLECTION_NAME).findOne(resolveMongoIdFilter(token));
        return row ? packageLifecycleExecutionLedgerModel.normalizePersistedLedgerRow(normalizeMongoDocument(row)) : null;
      }
    }, 'core.packageLifecycleExecutionLedger.getById');
  },

  async create(input = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => packageLifecycleExecutionLedgerModel.createRow(input, { actor: options?.actor || null }),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const requestedId = cleanText(input?.id || input?.ledgerId, 180);
        const id = requestedId || await generateUniqueStringId(collection, requestedId);
        const normalized = packageLifecycleExecutionLedgerModel.normalizeLedgerRow(
          { ...(input || {}), id, ledgerId: id },
          null,
          { actor: options?.actor || null }
        );
        await collection.insertOne(normalized);
        return packageLifecycleExecutionLedgerModel.normalizePersistedLedgerRow(normalized);
      }
    }, 'core.packageLifecycleExecutionLedger.create');
  },

  async update(id = '', patch = {}, options = {}) {
    const token = cleanText(id, 180);
    if (!token) throw new Error('Ledger id is required.');
    return runByRepositoryBackend(options, {
      json: async () => packageLifecycleExecutionLedgerModel.upsertById(token, { ...(patch || {}), id: token, ledgerId: token }, { actor: options?.actor || null }),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const existing = await collection.findOne({ id: token });
        const existingNormalized = existing
          ? packageLifecycleExecutionLedgerModel.normalizePersistedLedgerRow(normalizeMongoDocument(existing))
          : null;
        const merged = packageLifecycleExecutionLedgerModel.normalizeLedgerRow(
          deepMerge(existingNormalized || {}, { ...(patch || {}), id: token, ledgerId: token }),
          existingNormalized,
          { actor: options?.actor || null }
        );

        if (existing && existing._id) {
          await collection.updateOne({ _id: existing._id }, { $set: merged });
          const fresh = await collection.findOne({ _id: existing._id });
          return packageLifecycleExecutionLedgerModel.normalizePersistedLedgerRow(normalizeMongoDocument(fresh));
        }

        await collection.insertOne(merged);
        return packageLifecycleExecutionLedgerModel.normalizePersistedLedgerRow(merged);
      }
    }, 'core.packageLifecycleExecutionLedger.update');
  }
};

module.exports = packageLifecycleExecutionLedgerRepository;
