'use strict';

const { applyGenericFilter } = require('../utils/queryEngine');
const model = require('../models/emailOutboxModel');
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

const COLLECTION_NAME = 'emailOutbox';
const DEFAULT_SEARCH_FIELDS = Object.freeze(['id', 'orgId', 'eventKey', 'to', 'subject', 'status', 'dedupeKey']);
const DEFAULT_DATE_FIELDS = Object.freeze(['sendAt', 'preparedAt', 'sentAt', 'createdAt', 'updatedAt']);

function stripPaginationFromQuery(query = {}) {
  const output = { ...(query || {}) };
  delete output.page;
  delete output.limit;
  return output;
}

function buildMongoScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};
  const orgIds = toIdArray(scope?.orgIds || []);
  if (!orgIds.length) return { id: '__NO_MATCH__' };
  return { orgId: { $in: orgIds } };
}

function applyJsonScope(rows, scope = {}) {
  if (scope?.canViewAll !== false) return rows;
  const orgIds = toIdArray(scope?.orgIds || []);
  if (!orgIds.length) return [];
  return rows.filter((row) => orgIds.some((orgId) => idsEqual(row?.orgId, orgId)));
}

async function generateMongoId(collection, requestedId = null) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;
  for (let i = 0; i < 250; i += 1) {
    const candidate = model.generateId([]);
    // eslint-disable-next-line no-await-in-loop
    const exists = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!exists) return candidate;
  }
  return `EMOBX${Date.now()}`;
}

const emailOutboxRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = applyJsonScope(await model.getAll(), options?.scope || {});
        return applyGenericFilter(rows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const query = options?.query || {};
        const filter = combineMongoFilters(
          buildMongoScopeFilter(options?.scope || {}),
          buildMongoFilterFromQuery(query, { defaultSearchFields: DEFAULT_SEARCH_FIELDS, dateFields: DEFAULT_DATE_FIELDS })
        );
        const sort = buildMongoSortFromQuery(query, options?.sort || { sendAt: 1, id: 1 });
        const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);
        let cursor = collection.find(filter);
        if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
        if (skip > 0) cursor = cursor.skip(skip);
        if (limit > 0) cursor = cursor.limit(limit);
        return (await cursor.toArray()).map((row) => normalizeMongoDocument(row)).filter(Boolean);
      }
    }, 'core.emailOutbox.list');
  },

  async count(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => (await this.list({ ...options, query: stripPaginationFromQuery(options?.query || {}) })).length,
      mongo: async () => {
        const filter = combineMongoFilters(
          buildMongoScopeFilter(options?.scope || {}),
          buildMongoFilterFromQuery(stripPaginationFromQuery(options?.query || {}), {
            defaultSearchFields: DEFAULT_SEARCH_FIELDS,
            dateFields: DEFAULT_DATE_FIELDS
          })
        );
        return getMongoCollection(COLLECTION_NAME).countDocuments(filter);
      }
    }, 'core.emailOutbox.count');
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
      json: async () => model.getById(id),
      mongo: async () => normalizeMongoDocument(await getMongoCollection(COLLECTION_NAME).findOne(resolveMongoIdFilter(id)))
    }, 'core.emailOutbox.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => model.add(data),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const normalized = model.normalizeEmailOutboxRecord(data, null, { strict: true });
        normalized.id = await generateMongoId(collection, normalized.id);
        await collection.insertOne(normalized);
        return normalizeMongoDocument(normalized);
      }
    }, 'core.emailOutbox.create');
  },

  async createMany(rows = [], options = {}) {
    if (!Array.isArray(rows) || !rows.length) return [];
    return runByRepositoryBackend(options, {
      json: async () => {
        const created = [];
        for (const row of rows) {
          // eslint-disable-next-line no-await-in-loop
          created.push(await model.add(row));
        }
        return created;
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const payloads = [];
        for (const row of rows) {
          const normalized = model.normalizeEmailOutboxRecord(row, null, { strict: true });
          // eslint-disable-next-line no-await-in-loop
          normalized.id = await generateMongoId(collection, normalized.id);
          payloads.push(normalized);
        }
        if (payloads.length) await collection.insertMany(payloads);
        return payloads.map((row) => normalizeMongoDocument(row)).filter(Boolean);
      }
    }, 'core.emailOutbox.createMany');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => model.update(id, data),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const existing = normalizeMongoDocument(await collection.findOne(resolveMongoIdFilter(id)));
        if (!existing) throw new Error('Email outbox entry not found.');
        const normalized = model.normalizeEmailOutboxRecord(data, existing);
        normalized.id = existing.id;
        await collection.updateOne(resolveMongoIdFilter(id), { $set: normalized });
        return normalized;
      }
    }, 'core.emailOutbox.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => model.remove(id),
      mongo: async () => {
        const result = await getMongoCollection(COLLECTION_NAME).deleteOne(resolveMongoIdFilter(id));
        if (!result.deletedCount) throw new Error('Email outbox entry not found.');
        return true;
      }
    }, 'core.emailOutbox.remove');
  }
};

assertQueryableCrudRepository('emailOutboxRepository', emailOutboxRepository);

module.exports = emailOutboxRepository;
