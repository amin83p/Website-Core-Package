const { applyGenericFilter } = require('../utils/queryEngine');
const emailLedgerModel = require('../models/emailLedgerModel');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { toPublicId, toIdArray, idsEqual } = require('../utils/idAdapter');
const {
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter
} = require('./backend/mongoRepositoryUtils');

const COLLECTION_NAME = 'emailLedger';
const DEFAULT_SEARCH_FIELDS = Object.freeze([
  'id',
  'orgId',
  'sectionId',
  'operationId',
  'eventKey',
  'status',
  'provider',
  'providerMessageId',
  'envelope.from',
  'envelope.to',
  'content.subject',
  'errorMessage'
]);
const DEFAULT_DATE_FIELDS = Object.freeze([
  'dateTime',
  'createdAt',
  'updatedAt',
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

function buildDateToken(value) {
  return String(value || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
}

async function generateMongoLedgerId(collection, requestedId = null, isoDateTime = null) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;

  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `EMLG${dateToken}${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!exists) return candidate;
  }
  return `EMLG${Date.now()}`;
}

function sanitizeRow(row = {}) {
  return emailLedgerModel.sanitizeLedgerForRead(row);
}

function applyJsonScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;

  const orgIds = toIdArray(scope?.orgIds || []);
  if (!orgIds.length) return [];
  return list.filter((row) => orgIds.some((orgId) => idsEqual(row?.orgId, orgId)));
}

function buildMongoScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const orgIds = toIdArray(scope?.orgIds || []);
  if (!orgIds.length) return { id: '__NO_MATCH__' };
  return { orgId: { $in: orgIds } };
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
  const sort = buildMongoSortFromQuery(query, options?.sort || { dateTime: -1, id: -1 });
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);

  let cursor = collection.find(filter);
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const rows = await cursor.toArray();
  return rows
    .map((row) => normalizeMongoDocument(row))
    .filter(Boolean)
    .map((row) => sanitizeRow(row));
}

const emailLedgerRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await emailLedgerModel.getAllEntries();
        const scopedRows = applyJsonScope(rows, options?.scope || {});
        const filteredRows = applyGenericFilter(scopedRows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
        return filteredRows.map((row) => sanitizeRow(row));
      },
      mongo: async () => listMongoRows(options)
    }, 'core.emailLedger.list');
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
    }, 'core.emailLedger.count');
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
      json: async () => {
        const row = await emailLedgerModel.getEntryById(id);
        return row ? sanitizeRow(row) : null;
      },
      mongo: async () => {
        const row = await getMongoCollection(COLLECTION_NAME).findOne(resolveMongoIdFilter(id));
        const normalized = normalizeMongoDocument(row);
        return normalized ? sanitizeRow(normalized) : null;
      }
    }, 'core.emailLedger.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        if (Array.isArray(data)) {
          const created = [];
          for (const item of data) {
            // eslint-disable-next-line no-await-in-loop
            const row = await emailLedgerModel.addEntry(item);
            created.push(sanitizeRow(row));
          }
          return created;
        }
        return sanitizeRow(await emailLedgerModel.addEntry(data));
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        if (Array.isArray(data)) {
          const payloads = [];
          for (const rawItem of data) {
            const normalized = emailLedgerModel.normalizeEmailLedgerRecord(rawItem, null, true);
            // eslint-disable-next-line no-await-in-loop
            normalized.id = await generateMongoLedgerId(collection, normalized.id, normalized.dateTime);
            payloads.push(normalized);
          }
          if (payloads.length > 0) await collection.insertMany(payloads);
          return payloads.map((row) => sanitizeRow(normalizeMongoDocument(row))).filter(Boolean);
        }
        const normalized = emailLedgerModel.normalizeEmailLedgerRecord(data, null, true);
        normalized.id = await generateMongoLedgerId(collection, normalized.id, normalized.dateTime);
        await collection.insertOne(normalized);
        return sanitizeRow(normalizeMongoDocument(normalized));
      }
    }, 'core.emailLedger.create');
  },

  async update() {
    throw new Error('Email ledger entries are immutable and cannot be updated.');
  },

  async remove() {
    throw new Error('Email ledger entries are immutable and cannot be deleted via repository API.');
  }
};

assertQueryableCrudRepository('emailLedgerRepository', emailLedgerRepository);

module.exports = emailLedgerRepository;
