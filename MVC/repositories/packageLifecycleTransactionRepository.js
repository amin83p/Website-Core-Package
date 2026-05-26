const packageLifecycleTransactionModel = require('../models/packageLifecycleTransactionModel');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
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

const COLLECTION_NAME = 'packageLifecycleTransactions';
const DEFAULT_SEARCH_FIELDS = Object.freeze([
  'id',
  'transactionId',
  'packageId',
  'packageVersion',
  'action',
  'status',
  'phase'
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
  return rows.map((row) => packageLifecycleTransactionModel.normalizePersistedTransaction(normalizeMongoDocument(row)));
}

const packageLifecycleTransactionRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => packageLifecycleTransactionModel.queryRows({ query: options?.query || {} }),
      mongo: async () => listMongoRows(options)
    }, 'core.packageLifecycleTransactions.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await packageLifecycleTransactionModel.queryRows({ query });
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
    }, 'core.packageLifecycleTransactions.count');
  },

  async getById(id = '', options = {}) {
    const token = cleanText(id, 160);
    if (!token) return null;
    return runByRepositoryBackend(options, {
      json: async () => packageLifecycleTransactionModel.getById(token),
      mongo: async () => {
        const row = await getMongoCollection(COLLECTION_NAME).findOne(resolveMongoIdFilter(token));
        return row ? packageLifecycleTransactionModel.normalizePersistedTransaction(normalizeMongoDocument(row)) : null;
      }
    }, 'core.packageLifecycleTransactions.getById');
  },

  async create(input = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => packageLifecycleTransactionModel.createRow(input, { actor: options?.actor || null }),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const sourceId = cleanText(input?.id || input?.transactionId, 160);
        const id = sourceId || await generateUniqueStringId(collection, sourceId);
        const normalized = packageLifecycleTransactionModel.normalizeTransactionRow(
          { ...(input || {}), id, transactionId: id },
          null,
          { actor: options?.actor || null }
        );
        await collection.insertOne(normalized);
        return packageLifecycleTransactionModel.normalizePersistedTransaction(normalized);
      }
    }, 'core.packageLifecycleTransactions.create');
  },

  async update(id = '', patch = {}, options = {}) {
    const token = cleanText(id, 160);
    if (!token) throw new Error('Transaction id is required.');

    return runByRepositoryBackend(options, {
      json: async () => packageLifecycleTransactionModel.upsertById(token, { ...(patch || {}), id: token }, { actor: options?.actor || null }),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const existing = await collection.findOne({ id: token });
        const existingNormalized = existing
          ? packageLifecycleTransactionModel.normalizePersistedTransaction(normalizeMongoDocument(existing))
          : null;
        const merged = packageLifecycleTransactionModel.normalizeTransactionRow(
          deepMerge(existingNormalized || {}, { ...(patch || {}), id: token, transactionId: token }),
          existingNormalized,
          { actor: options?.actor || null }
        );

        if (existing && existing._id) {
          await collection.updateOne({ _id: existing._id }, { $set: merged });
          const fresh = await collection.findOne({ _id: existing._id });
          return packageLifecycleTransactionModel.normalizePersistedTransaction(normalizeMongoDocument(fresh));
        }

        await collection.insertOne(merged);
        return packageLifecycleTransactionModel.normalizePersistedTransaction(merged);
      }
    }, 'core.packageLifecycleTransactions.update');
  }
};

module.exports = packageLifecycleTransactionRepository;
