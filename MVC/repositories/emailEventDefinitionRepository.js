const { applyGenericFilter } = require('../utils/queryEngine');
const emailEventDefinitionModel = require('../models/emailEventDefinitionModel');
const { assertQueryableCrudRepository } = require('./contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const {
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  deepMerge
} = require('./backend/mongoRepositoryUtils');

const COLLECTION_NAME = 'emailEventDefinitions';
const DEFAULT_SEARCH_FIELDS = Object.freeze([
  'id',
  'eventKey',
  'label',
  'sectionId',
  'operationId',
  'packageName',
  'resolverId'
]);
const DEFAULT_DATE_FIELDS = Object.freeze(['createdAt', 'updatedAt']);

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function sanitizeRow(row = {}) {
  return emailEventDefinitionModel.sanitizeDefinitionForRead(row);
}

function normalizeKeyToken(value = '') {
  return emailEventDefinitionModel.normalizeKeyToken(value);
}

async function listMongoRows(options = {}) {
  const collection = getMongoCollection(COLLECTION_NAME);
  const query = options?.query || {};
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: DEFAULT_SEARCH_FIELDS,
    dateFields: DEFAULT_DATE_FIELDS
  });
  const sort = buildMongoSortFromQuery(query, options?.sort || { packageName: 1, label: 1, eventKey: 1 });
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);

  let cursor = collection.find(queryFilter);
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const rows = await cursor.toArray();
  return rows
    .map((row) => normalizeMongoDocument(row))
    .filter(Boolean)
    .map((row) => sanitizeRow(row));
}

const emailEventDefinitionRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await emailEventDefinitionModel.getAllDefinitions();
        return applyGenericFilter(rows, options?.query || {}, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        }).map((row) => sanitizeRow(row));
      },
      mongo: async () => listMongoRows(options)
    }, 'core.emailEventDefinitions.list');
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
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: DEFAULT_SEARCH_FIELDS,
          dateFields: DEFAULT_DATE_FIELDS
        });
        return collection.countDocuments(queryFilter);
      }
    }, 'core.emailEventDefinitions.count');
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

  async getByEventKey(eventKey = '', options = {}) {
    const token = normalizeKeyToken(eventKey);
    if (!token) return null;
    const rows = await this.list({
      ...options,
      query: { eventKey__eq: token, page: 1, limit: 1 }
    });
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  },

  async getById(id, options = {}) {
    return this.getByEventKey(id, options);
  },

  async create(payload = {}, options = {}) {
    const existing = await this.getByEventKey(payload?.eventKey, options);
    if (existing) {
      const error = new Error('Email event definition already exists.');
      error.code = 11000;
      throw error;
    }
    return this.upsertByEventKey(payload, options);
  },

  async update(id, payload = {}, options = {}) {
    const token = normalizeKeyToken(id || payload?.eventKey);
    if (!token) throw new Error('Event key is required.');
    const existing = await this.getByEventKey(token, options);
    if (!existing) throw new Error('Email event definition not found.');
    return this.upsertByEventKey({ ...existing, ...payload, eventKey: token }, options);
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await emailEventDefinitionModel.getAllDefinitions();
        const token = normalizeKeyToken(id);
        const next = rows.filter((row) => normalizeKeyToken(row?.eventKey) !== token);
        if (next.length === rows.length) throw new Error('Email event definition not found.');
        const fs = require('fs').promises;
        const path = require('path');
        const dataPath = path.join(__dirname, '../../data/emailEventDefinitions.json');
        await fs.writeFile(dataPath, JSON.stringify(next, null, 2));
        return true;
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const token = normalizeKeyToken(id);
        const result = await collection.deleteOne({ eventKey: token });
        if (!result?.deletedCount) throw new Error('Email event definition not found.');
        return true;
      }
    }, 'core.emailEventDefinitions.remove');
  },

  async upsertByEventKey(payload = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => emailEventDefinitionModel.upsertDefinition(payload),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const token = normalizeKeyToken(payload?.eventKey);
        const existing = token ? await collection.findOne({ eventKey: token }) : null;
        const normalized = emailEventDefinitionModel.normalizeDefinitionRecord(
          payload,
          existing ? normalizeMongoDocument(existing) : null
        );
        if (existing) {
          const { _id, ...toSet } = deepMerge(existing, normalized);
          await collection.updateOne({ _id: existing._id }, { $set: toSet });
          const fresh = await collection.findOne({ _id: existing._id });
          return sanitizeRow(normalizeMongoDocument(fresh));
        }
        await collection.insertOne(normalized);
        return sanitizeRow(normalizeMongoDocument(normalized));
      }
    }, 'core.emailEventDefinitions.upsertByEventKey');
  }
};

assertQueryableCrudRepository('emailEventDefinitionRepository', emailEventDefinitionRepository);

module.exports = emailEventDefinitionRepository;
