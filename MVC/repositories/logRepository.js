const logModel = require('../models/logModel');
const { assertLogRepository } = require('./contracts/logRepositoryContract');
const { idsEqual, toPublicId } = require('../utils/idAdapter');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { applyGenericFilter } = require('../utils/queryEngine');
const { canonicalizeLogInput, normalizePersistedLogRecord } = require('../utils/logRecordUtils');
const {
  normalizeMongoDocument,
  resolveMongoIdFilter,
  generateUniqueStringId
} = require('./backend/mongoRepositoryUtils');

const LOG_LIMITS = Object.freeze({
  COUNT_WARNING: 2500,
  COUNT_DANGER: 4500,
  SIZE_WARNING_MB: 2,
  SIZE_DANGER_MB: 5
});

const LOG_QUERY_FALLBACK = Object.freeze({
  defaultSearchFields: [
    'id',
    'sectionId',
    'operationId',
    'userId',
    'username',
    'displayName',
    'actorType',
    'status',
    'orgId',
    'requestId',
    'actionStateId',
    'details.actor.userId',
    'details.actor.username',
    'details.actor.displayName',
    'details.actionStateId'
  ],
  dateFields: ['timestamp', 'createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
});

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function buildCanViewAllFilter(scope = {}) {
  return scope?.canViewAll === false ? { id: '__NO_MATCH__' } : {};
}

function formatBytes(bytes, decimals = 2) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

function injectSortQuery(query = {}, explicitSort = null) {
  const next = { ...(query || {}) };
  if (next.sort || !explicitSort || typeof explicitSort !== 'object' || Array.isArray(explicitSort)) return next;

  const fields = Object.entries(explicitSort)
    .filter(([field]) => String(field || '').trim())
    .map(([field, order]) => (Number(order) < 0 ? `-${field}` : field));

  if (fields.length) next.sort = fields.join(',');
  return next;
}

async function listMongoLogs(options = {}, runtime = {}) {
  const collection = getMongoCollection('logs');
  const scopeFilter = buildCanViewAllFilter(options?.scope || {});
  const queryInput = runtime?.includePagination === false
    ? stripPaginationFromQuery(options?.query || {})
    : (options?.query || {});
  const query = injectSortQuery(queryInput, options?.sort || { timestamp: -1 });

  const rows = await collection.find(scopeFilter).toArray();
  const normalizedRows = rows
    .map((row) => normalizeMongoDocument(row))
    .map((row) => normalizePersistedLogRecord(row))
    .filter(Boolean);

  return applyGenericFilter(normalizedRows, query, LOG_QUERY_FALLBACK);
}

const logRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        return logModel.queryLogs({
          query,
          scope: options?.scope || {},
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoLogs(options, { includePagination: true })
    }, 'core.logs.list');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await logModel.queryLogs({
          query,
          scope: options?.scope || {},
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const rows = await listMongoLogs({
          ...options,
          query
        }, { includePagination: false });
        return Array.isArray(rows) ? rows.length : 0;
      }
    }, 'core.logs.count');
  },

  async exists(options = {}) {
    const query = {
      ...(stripPaginationFromQuery(options?.query || {})),
      page: 1,
      limit: 1
    };
    const rows = await this.list({
      ...options,
      query
    });
    return Array.isArray(rows) && rows.length > 0;
  },

  async getById(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const all = await this.list();
        return all.find((item) => idsEqual(item?.id, id)) || null;
      },
      mongo: async () => {
        const row = await getMongoCollection('logs').findOne(resolveMongoIdFilter(id));
        return normalizePersistedLogRecord(normalizeMongoDocument(row));
      }
    }, 'core.logs.getById');
  },

  async create(data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => logModel.addLog(data.sectionId, data.operationId, data.user, data.status, data.details),
      mongo: async () => {
        const collection = getMongoCollection('logs');
        const canonical = canonicalizeLogInput(data || {});
        const payload = {
          id: canonical.id,
          timestamp: canonical.timestamp || new Date().toISOString(),
          sectionId: canonical.sectionId,
          operationId: canonical.operationId,
          userId: canonical.userId,
          username: canonical.username,
          displayName: canonical.displayName,
          orgId: canonical.orgId,
          actorType: canonical.actorType,
          status: canonical.status,
          details: canonical.details,
          requestId: canonical.requestId || '',
          actionStateId: canonical.actionStateId || ''
        };
        payload.id = await generateUniqueStringId(collection, payload.id);
        await collection.insertOne(payload);
        return normalizePersistedLogRecord(normalizeMongoDocument(payload));
      }
    }, 'core.logs.create');
  },

  async update() {
    throw new Error('Log entries are immutable.');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => logModel.deleteLog(id),
      mongo: async () => getMongoCollection('logs').deleteOne(resolveMongoIdFilter(id))
    }, 'core.logs.remove');
  },

  async getAllLogs() {
    return this.list();
  },

  async addLog(sectionId, operationId, user, status, details = {}) {
    return runByRepositoryBackend({}, {
      json: async () => logModel.addLog(sectionId, operationId, user, status, details),
      mongo: async () => this.create({ sectionId, operationId, user, status, details }, {})
    }, 'core.logs.addLog');
  },

  async getReport(filters = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => logModel.getReport(filters),
      mongo: async () => this.list({ query: filters, scope: options?.scope || {} })
    }, 'core.logs.getReport');
  },

  async countByUserId(userId) {
    if (userId === undefined || userId === null || userId === '') return 0;
    const normalizedUserId = toPublicId(userId) || String(userId);
    return runByRepositoryBackend({}, {
      json: async () => {
        const rows = await logModel.getReport({ userId: normalizedUserId });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const rows = await listMongoLogs({
          query: { userId__eq: normalizedUserId },
          scope: { canViewAll: true }
        }, { includePagination: false });
        return Array.isArray(rows) ? rows.length : 0;
      }
    }, 'core.logs.countByUserId');
  },

  async deleteLog(id) {
    return this.remove(id);
  },

  async deleteAllLog(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => logModel.deleteAllLog(),
      mongo: async () => getMongoCollection('logs').deleteMany({})
    }, 'core.logs.deleteAll');
  },

  async getSystemLogStats(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => logModel.getSystemLogStats(),
      mongo: async () => {
        const collection = getMongoCollection('logs');
        const logCount = await collection.countDocuments({});

        let sizeBytes = 0;
        try {
          const stats = await collection.db.command({ collStats: collection.collectionName });
          if (stats && Number.isFinite(stats.size)) sizeBytes = Number(stats.size);
        } catch (_) {
          sizeBytes = 0;
        }

        let logHealth = 'success';
        let logMessage = 'Healthy';
        if (
          logCount > LOG_LIMITS.COUNT_DANGER ||
          sizeBytes > (LOG_LIMITS.SIZE_DANGER_MB * 1024 * 1024)
        ) {
          logHealth = 'danger';
          logMessage = 'Critical Limit';
        } else if (
          logCount > LOG_LIMITS.COUNT_WARNING ||
          sizeBytes > (LOG_LIMITS.SIZE_WARNING_MB * 1024 * 1024)
        ) {
          logHealth = 'warning';
          logMessage = 'High Volume';
        }

        return {
          logCount,
          logSize: formatBytes(sizeBytes),
          logHealth,
          logMessage
        };
      }
    }, 'core.logs.getSystemLogStats');
  }
};

assertLogRepository('logRepository', logRepository);

module.exports = logRepository;
