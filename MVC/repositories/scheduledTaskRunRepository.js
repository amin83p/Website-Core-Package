'use strict';

const { applyGenericFilter } = require('../utils/queryEngine');
const model = require('../models/scheduledTaskRunModel');
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

const COLLECTION_NAME = 'scheduledTaskRuns';
const DEFAULT_SEARCH_FIELDS = Object.freeze(['id', 'definitionId', 'orgId', 'packageName', 'taskKey', 'status', 'resultSummary', 'organizedByUserId', 'organizedByDisplayName']);
const DEFAULT_DATE_FIELDS = Object.freeze(['scheduledFor', 'startedAt', 'finishedAt', 'createdAt', 'updatedAt']);
const EXPORT_ROW_CAP = 50000;
const TERMINAL_RUN_STATUSES = Object.freeze(['succeeded', 'failed', 'cancelled']);

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

function rowInJsonScope(row, scope = {}) {
  if (scope?.canViewAll !== false) return true;
  const orgIds = toIdArray(scope?.orgIds || []);
  if (!orgIds.length) return false;
  return orgIds.some((orgId) => idsEqual(row?.orgId, orgId));
}

function isTerminalRunStatus(status) {
  return TERMINAL_RUN_STATUSES.includes(String(status || '').trim().toLowerCase());
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
  return `STRUN${Date.now()}`;
}

const scheduledTaskRunRepository = {
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
        const sort = buildMongoSortFromQuery(query, options?.sort || { scheduledFor: -1, id: -1 });
        const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);
        let cursor = collection.find(filter);
        if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
        if (skip > 0) cursor = cursor.skip(skip);
        if (limit > 0) cursor = cursor.limit(limit);
        return (await cursor.toArray()).map((row) => normalizeMongoDocument(row)).filter(Boolean);
      }
    }, 'core.scheduledTaskRuns.list');
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
    }, 'core.scheduledTaskRuns.count');
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
    }, 'core.scheduledTaskRuns.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => model.add(data),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const normalized = model.normalizeScheduledTaskRun(data);
        normalized.id = await generateMongoId(collection, normalized.id);
        await collection.insertOne(normalized);
        return normalizeMongoDocument(normalized);
      }
    }, 'core.scheduledTaskRuns.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => model.update(id, data),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const existing = normalizeMongoDocument(await collection.findOne(resolveMongoIdFilter(id)));
        if (!existing) throw new Error('Scheduled task run not found.');
        const normalized = model.normalizeScheduledTaskRun(data, existing);
        normalized.id = existing.id;
        await collection.updateOne(resolveMongoIdFilter(id), { $set: normalized });
        return normalized;
      }
    }, 'core.scheduledTaskRuns.update');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => model.remove(id),
      mongo: async () => {
        const result = await getMongoCollection(COLLECTION_NAME).deleteOne(resolveMongoIdFilter(id));
        if (!result.deletedCount) throw new Error('Scheduled task run not found.');
        return true;
      }
    }, 'core.scheduledTaskRuns.remove');
  },

  async listAllForQuery(query = {}, options = {}) {
    const cap = Math.min(
      Math.max(1, Number(options?.maxRows) || EXPORT_ROW_CAP),
      EXPORT_ROW_CAP
    );
    const listQuery = {
      ...stripPaginationFromQuery(query || {}),
      page: 1,
      limit: cap + 1
    };
    const rows = await this.list({ ...options, query: listQuery });
    if (rows.length > cap) {
      const error = new Error(`Export limit exceeded (${cap} rows). Narrow your filters and try again.`);
      error.statusCode = 400;
      throw error;
    }
    return rows;
  },

  async deleteTerminalRuns(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const scope = options?.scope || {};
        const rows = await model.getAll();
        let deletedCount = 0;
        let keptPending = 0;
        let keptRunning = 0;
        const kept = [];
        for (const row of rows) {
          const status = String(row?.status || '').toLowerCase();
          if (status === 'pending') {
            if (rowInJsonScope(row, scope)) keptPending += 1;
            kept.push(row);
            continue;
          }
          if (status === 'running') {
            if (rowInJsonScope(row, scope)) keptRunning += 1;
            kept.push(row);
            continue;
          }
          if (isTerminalRunStatus(status) && rowInJsonScope(row, scope)) {
            deletedCount += 1;
            continue;
          }
          kept.push(row);
        }
        await model.saveAll(kept);
        return { deletedCount, keptPending, keptRunning };
      },
      mongo: async () => {
        const scope = options?.scope || {};
        const collection = getMongoCollection(COLLECTION_NAME);
        const pendingFilter = combineMongoFilters(buildMongoScopeFilter(scope), { status: 'pending' });
        const runningFilter = combineMongoFilters(buildMongoScopeFilter(scope), { status: 'running' });
        const deleteFilter = combineMongoFilters(
          buildMongoScopeFilter(scope),
          { status: { $in: [...TERMINAL_RUN_STATUSES] } }
        );
        const [keptPending, keptRunning, deleteResult] = await Promise.all([
          collection.countDocuments(pendingFilter),
          collection.countDocuments(runningFilter),
          collection.deleteMany(deleteFilter)
        ]);
        return {
          deletedCount: Number(deleteResult?.deletedCount || 0),
          keptPending,
          keptRunning
        };
      }
    }, 'core.scheduledTaskRuns.deleteTerminalRuns');
  }
};

assertQueryableCrudRepository('scheduledTaskRunRepository', scheduledTaskRunRepository);

module.exports = scheduledTaskRunRepository;
