'use strict';

const { applyGenericFilter } = require('../utils/queryEngine');
const model = require('../models/scheduledTaskDefinitionModel');
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

const COLLECTION_NAME = 'scheduledTaskDefinitions';
const DEFAULT_SEARCH_FIELDS = Object.freeze(['id', 'orgId', 'packageName', 'taskKey', 'label', 'source', 'sourceRef']);
const DEFAULT_DATE_FIELDS = Object.freeze(['nextRunAt', 'lastRunAt', 'createdAt', 'updatedAt']);

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
    const candidate = model.generateId([], 'STDEF');
    // eslint-disable-next-line no-await-in-loop
    const exists = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!exists) return candidate;
  }
  return `STDEF${Date.now()}`;
}

const scheduledTaskDefinitionRepository = {
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
        const sort = buildMongoSortFromQuery(query, options?.sort || { nextRunAt: 1, id: 1 });
        const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);
        let cursor = collection.find(filter);
        if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
        if (skip > 0) cursor = cursor.skip(skip);
        if (limit > 0) cursor = cursor.limit(limit);
        return (await cursor.toArray()).map((row) => normalizeMongoDocument(row)).filter(Boolean);
      }
    }, 'core.scheduledTaskDefinitions.list');
  },

  async count(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await this.list({ ...options, query: stripPaginationFromQuery(options?.query || {}) });
        return rows.length;
      },
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const filter = combineMongoFilters(
          buildMongoScopeFilter(options?.scope || {}),
          buildMongoFilterFromQuery(stripPaginationFromQuery(options?.query || {}), {
            defaultSearchFields: DEFAULT_SEARCH_FIELDS,
            dateFields: DEFAULT_DATE_FIELDS
          })
        );
        return collection.countDocuments(filter);
      }
    }, 'core.scheduledTaskDefinitions.count');
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
    }, 'core.scheduledTaskDefinitions.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => model.add(data),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const normalized = model.normalizeScheduledTaskDefinition(data, null, { strict: true });
        normalized.id = await generateMongoId(collection, normalized.id);
        await collection.insertOne(normalized);
        return normalizeMongoDocument(normalized);
      }
    }, 'core.scheduledTaskDefinitions.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => model.update(id, data),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const existing = normalizeMongoDocument(await collection.findOne(resolveMongoIdFilter(id)));
        if (!existing) throw new Error('Scheduled task definition not found.');
        const normalized = model.normalizeScheduledTaskDefinition(data, existing);
        normalized.id = existing.id;
        await collection.updateOne(resolveMongoIdFilter(id), { $set: normalized });
        return normalized;
      }
    }, 'core.scheduledTaskDefinitions.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => model.remove(id),
      mongo: async () => {
        const result = await getMongoCollection(COLLECTION_NAME).deleteOne(resolveMongoIdFilter(id));
        if (!result.deletedCount) throw new Error('Scheduled task definition not found.');
        return true;
      }
    }, 'core.scheduledTaskDefinitions.remove');
  }
};

assertQueryableCrudRepository('scheduledTaskDefinitionRepository', scheduledTaskDefinitionRepository);

module.exports = scheduledTaskDefinitionRepository;
