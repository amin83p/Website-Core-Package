const actionStateModel = require('../models/actionStateModel');
const { assertActionStateRepository } = require('./contracts/actionStateRepositoryContract');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { toPublicId } = require('../utils/idAdapter');
const fs = require('fs').promises;
const path = require('path');
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

const ACTION_STATE_LIMITS = Object.freeze({
  COUNT_WARNING: 2500,
  COUNT_DANGER: 4500
});

const ACTION_STATE_JSON_PATH = path.join(__dirname, '../../data/actionStates.json');
const ACTION_STATE_DEFAULT_PAGE_LIMIT = 30;
const ACTION_STATE_RETENTION_DAYS = Object.freeze({
  active: 7,
  attempted: 7,
  in_progress: 7,
  retryable_error: 14,
  completed: 30,
  cancelled: 14,
  failed: 90,
  terminated: 90
});

function parseRetentionDaysFromEnv(status, fallbackDays) {
  const key = `ACTION_STATE_RETENTION_DAYS_${String(status || '').trim().toUpperCase()}`;
  const raw = process.env[key];
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return fallbackDays;
}

function resolveRetentionDays(status) {
  const normalized = String(status || '').trim().toLowerCase() || 'attempted';
  const base = Object.prototype.hasOwnProperty.call(ACTION_STATE_RETENTION_DAYS, normalized)
    ? ACTION_STATE_RETENTION_DAYS[normalized]
    : ACTION_STATE_RETENTION_DAYS.completed;
  return parseRetentionDaysFromEnv(normalized, base);
}

function resolveRetentionUntil(status, now = new Date()) {
  const days = resolveRetentionDays(status);
  const ms = Math.max(0, Number(days) || 0) * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() + ms);
}

function parsePageLimit(query = {}, pagination = null) {
  const rawPage = Number.parseInt(query?.page, 10);
  const rawLimit = Number.parseInt(query?.limit, 10);
  const pageFromOptions = Number.parseInt(pagination?.page, 10);
  const limitFromOptions = Number.parseInt(pagination?.limit, 10);
  const page = Number.isFinite(rawPage) && rawPage > 0
    ? rawPage
    : (Number.isFinite(pageFromOptions) && pageFromOptions > 0 ? pageFromOptions : 1);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? rawLimit
    : (Number.isFinite(limitFromOptions) && limitFromOptions > 0 ? limitFromOptions : ACTION_STATE_DEFAULT_PAGE_LIMIT);
  return { page, limit };
}

function normalizeVolume(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function resolveActionStateVolumeKB(row = {}) {
  const direct = normalizeVolume(row?.volumeUsageKB);
  if (direct > 0) return direct;
  const nested = [
    row?.progress?.volumeKB,
    row?.result?.volumeKB,
    row?.failure?.volumeKB,
    row?.retryableError?.volumeKB
  ].reduce((sum, value) => sum + normalizeVolume(value), 0);
  if (nested > 0) return nested;
  if (Array.isArray(row?.history)) {
    return row.history.reduce((sum, item) => sum + normalizeVolume(item?.volumeKB), 0);
  }
  return 0;
}

function normalizeIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function isActiveActionStateStatus(status) {
  const token = String(status || '').trim().toLowerCase();
  return ['active', 'attempted', 'in_progress', 'retryable_error'].includes(token);
}

function normalizeHistoryEntry(entry = {}) {
  if (!entry || typeof entry !== 'object') return null;
  const ts = normalizeIsoDate(entry.ts || entry.at || entry.time || entry.dateTime || entry.date);
  if (!ts) return null;
  return {
    ts,
    status: String(entry.status || '').trim() || 'event',
    details: String(entry.details || entry.message || '').trim(),
    volumeKB: normalizeVolume(entry.volumeKB),
    context: entry.context && typeof entry.context === 'object' ? entry.context : {}
  };
}

function sortHistoryAscending(rows = []) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  list.sort((left, right) => {
    const a = Date.parse(left?.ts || '');
    const b = Date.parse(right?.ts || '');
    if (Number.isNaN(a) && Number.isNaN(b)) return 0;
    if (Number.isNaN(a)) return 1;
    if (Number.isNaN(b)) return -1;
    return a - b;
  });
  return list;
}

function buildMongoHistoryFallback(row = {}) {
  const history = [];
  const add = (status, ts, details, volumeKB = 0, context = {}) => {
    const normalizedTs = normalizeIsoDate(ts);
    if (!normalizedTs) return;
    history.push({
      ts: normalizedTs,
      status,
      details: details || '',
      volumeKB: normalizeVolume(volumeKB),
      context: context && typeof context === 'object' ? context : {}
    });
  };

  add('attempt_started', row?.startedAt || row?.createdAt, 'New/Auto Session Started', 0, row?.initialContext || row?.context || {});
  add('step_completed', row?.progress?.at, 'Intermediate response sent', row?.progress?.volumeKB, row?.progress?.context || {});
  add('error_retryable', row?.retryableError?.at, row?.retryableError?.message || 'Client side error', row?.retryableError?.volumeKB, row?.retryableError?.context || {});
  add('failed', row?.failure?.at, '', row?.failure?.volumeKB, row?.failure?.context || {});
  add('success_completed', row?.result?.at, '', row?.result?.volumeKB, row?.result?.context || {});
  if (String(row?.status || '').trim().toLowerCase() === 'cancelled') {
    add('cancelled', row?.updatedAt || row?.lastActiveAt, 'User explicitly cancelled the action.', 0, {});
  }

  return sortHistoryAscending(history);
}

function resolveInitialContext(row = {}, history = []) {
  if (row?.initialContext && typeof row.initialContext === 'object') return row.initialContext;
  const firstWithContext = (Array.isArray(history) ? history : []).find((item) => item?.context && typeof item.context === 'object' && Object.keys(item.context).length > 0);
  if (firstWithContext) return firstWithContext.context;
  if (row?.context && typeof row.context === 'object') return row.context;
  return {};
}

function resolveAttemptCount(row = {}, history = []) {
  const direct = Number.parseInt(row?.attemptCount, 10);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const attempts = (Array.isArray(history) ? history : []).filter((item) => String(item?.status || '').toLowerCase() === 'attempt_started').length;
  return attempts > 0 ? attempts : 1;
}

function resolveStartedAt(row = {}, history = []) {
  return (
    normalizeIsoDate(row?.startedAt) ||
    normalizeIsoDate(row?.createdAt) ||
    normalizeIsoDate((Array.isArray(history) && history[0]) ? history[0].ts : null) ||
    normalizeIsoDate(row?.updatedAt) ||
    new Date().toISOString()
  );
}

function normalizeChangeEventEntry(event = {}) {
  if (!event || typeof event !== 'object') return null;
  const entityType = String(event.entityType || '').trim();
  const entityId = String(event.entityId || '').trim();
  if (!entityType || !entityId) return null;

  const summary = event.summary && typeof event.summary === 'object'
    ? event.summary
    : {};

  const changes = Array.isArray(event.changes)
    ? event.changes
      .filter((row) => row && typeof row === 'object')
      .map((row) => ({
        path: String(row.path || '').trim(),
        type: String(row.type || '').trim() || 'changed',
        from: row.from,
        to: row.to
      }))
    : [];

  return {
    mode: String(event.mode || '').trim().toLowerCase() === 'create' ? 'create' : 'update',
    entityType,
    entityId,
    at: normalizeIsoDate(event.at) || new Date().toISOString(),
    actionStateId: String(event.actionStateId || '').trim(),
    actor: event.actor && typeof event.actor === 'object' ? event.actor : {},
    summary: {
      addedCount: Number(summary.addedCount || 0),
      changedCount: Number(summary.changedCount || 0),
      hiddenAuditCount: Number(summary.hiddenAuditCount || 0)
    },
    changes
  };
}

function normalizeChangeEvents(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((event) => normalizeChangeEventEntry(event))
    .filter(Boolean)
    .sort((left, right) => {
      const a = Date.parse(left?.at || '');
      const b = Date.parse(right?.at || '');
      if (Number.isNaN(a) && Number.isNaN(b)) return 0;
      if (Number.isNaN(a)) return 1;
      if (Number.isNaN(b)) return -1;
      return a - b;
    });
}

function normalizeActionStateRow(row = {}) {
  const historyFromRow = Array.isArray(row?.history)
    ? row.history.map((entry) => normalizeHistoryEntry(entry)).filter(Boolean)
    : [];
  const history = historyFromRow.length > 0
    ? sortHistoryAscending(historyFromRow)
    : buildMongoHistoryFallback(row);
  const startedAt = resolveStartedAt(row, history);
  const appliedLimits = row?.appliedLimits && typeof row.appliedLimits === 'object'
    ? row.appliedLimits
    : (row?.limits && typeof row.limits === 'object' ? row.limits : {});
  const maxTimeMinutes = Number.parseInt(appliedLimits?.maxTimeMinutes, 10);
  const hasValidMaxMinutes = Number.isFinite(maxTimeMinutes) && maxTimeMinutes > 0;
  const expiresAt = normalizeIsoDate(row?.expiresAt)
    || (hasValidMaxMinutes
      ? new Date(new Date(startedAt).getTime() + maxTimeMinutes * 60 * 1000).toISOString()
      : null);
  const normalizedStatus = String(row?.status || '').trim().toLowerCase();
  const lastActiveAt = normalizeIsoDate(row?.lastActiveAt)
    || normalizeIsoDate(row?.updatedAt)
    || normalizeIsoDate((history.length ? history[history.length - 1].ts : null))
    || startedAt;
  const changeEvents = normalizeChangeEvents(row?.changeEvents);

  return {
    ...row,
    status: normalizedStatus || row?.status || 'active',
    startedAt,
    createdAt: normalizeIsoDate(row?.createdAt) || startedAt,
    updatedAt: normalizeIsoDate(row?.updatedAt) || lastActiveAt,
    lastActiveAt,
    expiresAt,
    attemptCount: resolveAttemptCount(row, history),
    appliedLimits,
    initialContext: resolveInitialContext(row, history),
    history,
    volumeUsageKB: resolveActionStateVolumeKB(row),
    changeEvents
  };
}

function computeSummaryFromRows(rows = [], options = {}) {
  const summary = (Array.isArray(rows) ? rows : []).reduce((acc, row) => {
    const status = String(row?.status || '').trim().toLowerCase();
    acc.totalActivities += 1;
    acc.trackedVolumeKB += normalizeVolume(row?.volumeUsageKB);
    if (isActiveActionStateStatus(status)) acc.activeSessions += 1;
    if (status === 'failed' || status === 'terminated') acc.failures += 1;
    return acc;
  }, {
    totalActivities: 0,
    trackedVolumeKB: 0,
    activeSessions: 0,
    failures: 0
  });

  const tableSizeBytes = normalizeBytes(options?.tableSizeBytes);
  summary.tableSizeBytes = tableSizeBytes;
  summary.tableSizeKB = tableSizeBytes / 1024;
  // Keep legacy key used by existing views.
  summary.totalVolumeKB = summary.trackedVolumeKB;
  return summary;
}

function buildVolumeExpression() {
  const asNumber = (expr) => ({ $convert: { input: expr, to: 'double', onError: 0, onNull: 0 } });
  const nested = {
    $add: [
      asNumber('$progress.volumeKB'),
      asNumber('$result.volumeKB'),
      asNumber('$failure.volumeKB'),
      asNumber('$retryableError.volumeKB')
    ]
  };
  const history = {
    $reduce: {
      input: { $ifNull: ['$history', []] },
      initialValue: 0,
      in: {
        $add: ['$$value', asNumber('$$this.volumeKB')]
      }
    }
  };

  return {
    $let: {
      vars: {
        direct: asNumber('$volumeUsageKB'),
        nested,
        history
      },
      in: {
        $cond: [
          { $gt: ['$$direct', 0] },
          '$$direct',
          {
            $cond: [
              { $gt: ['$$nested', 0] },
              '$$nested',
              '$$history'
            ]
          }
        ]
      }
    }
  };
}

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

async function resolveJsonActionStateTableSizeBytes() {
  try {
    const stats = await fs.stat(ACTION_STATE_JSON_PATH);
    return normalizeBytes(stats?.size);
  } catch (_) {
    return 0;
  }
}

async function resolveMongoActionStateTableSizeBytes(collection) {
  if (!collection) return 0;

  // Driver/cluster compatible fallback chain:
  // 1) db.command({ collStats }) - deprecated in server >=6.2 but often still available
  // 2) $collStats aggregation stage
  // 3) sum($bsonSize($$ROOT)) as a final approximation
  try {
    const db = collection.db;
    const collectionName = String(collection.collectionName || '').trim();
    if (db && collectionName) {
      const stats = await db.command({ collStats: collectionName, scale: 1 });
      const bytes = normalizeBytes(stats?.storageSize || stats?.size);
      if (bytes > 0) return bytes;
    }
  } catch (_) {
    // Continue to next fallback.
  }

  try {
    const rows = await collection.aggregate([
      { $collStats: { storageStats: { scale: 1 } } },
      {
        $project: {
          bytes: {
            $ifNull: ['$storageStats.storageSize', '$storageStats.size']
          }
        }
      },
      { $limit: 1 }
    ]).toArray();
    const bytes = normalizeBytes(rows?.[0]?.bytes);
    if (bytes > 0) return bytes;
  } catch (_) {
    // Continue to next fallback.
  }

  try {
    const rows = await collection.aggregate([
      {
        $group: {
          _id: null,
          bytes: { $sum: { $bsonSize: '$$ROOT' } }
        }
      }
    ]).toArray();
    return normalizeBytes(rows?.[0]?.bytes);
  } catch (_) {
    return 0;
  }
}

async function listMongoActionStates(options = {}) {
  const collection = getMongoCollection('actionStates');
  const query = options?.query || {};
  const scopeFilter = buildCanViewAllFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'userId', 'sectionId', 'operationId', 'targetKey', 'status'],
    dateFields: ['startedAt', 'createdAt', 'updatedAt', 'lastActiveAt']
  });
  const filter = combineMongoFilters(scopeFilter, queryFilter);
  const sort = buildMongoSortFromQuery(query, options?.sort || { createdAt: -1 });
  const { skip, limit } = resolveMongoPagination(query, options?.pagination || null);
  let cursor = collection.find(filter);
  if (sort && Object.keys(sort).length) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);
  const rows = await cursor.toArray();
  return rows.map(normalizeMongoDocument).filter(Boolean).map(normalizeActionStateRow);
}

async function listMongoActionStatesPageWithSummary(options = {}) {
  const collection = getMongoCollection('actionStates');
  const query = options?.query || {};
  const scopeFilter = buildCanViewAllFilter(options?.scope || {});
  const queryFilter = buildMongoFilterFromQuery(query, {
    defaultSearchFields: ['id', 'userId', 'sectionId', 'operationId', 'targetKey', 'status'],
    dateFields: ['startedAt', 'createdAt', 'updatedAt', 'lastActiveAt']
  });
  const filter = combineMongoFilters(scopeFilter, queryFilter);
  const sort = buildMongoSortFromQuery(query, options?.sort || { createdAt: -1 });
  const { page, limit } = parsePageLimit(query, options?.pagination || null);
  const skip = Math.max(0, (page - 1) * limit);

  const [rowsRaw, totalItems, tableSizeBytes, summaryRows] = await Promise.all([
    collection.find(filter).sort(sort).skip(skip).limit(limit).toArray(),
    collection.countDocuments(filter),
    resolveMongoActionStateTableSizeBytes(collection),
    collection.aggregate([
      { $match: filter },
      {
        $project: {
          statusNormalized: { $toLower: { $ifNull: ['$status', ''] } },
          volumeResolved: buildVolumeExpression()
        }
      },
      {
        $group: {
          _id: null,
          totalActivities: { $sum: 1 },
          totalVolumeKB: { $sum: '$volumeResolved' },
          activeSessions: {
            $sum: { $cond: [{ $in: ['$statusNormalized', ['active', 'attempted', 'in_progress', 'retryable_error']] }, 1, 0] }
          },
          failures: {
            $sum: { $cond: [{ $in: ['$statusNormalized', ['failed', 'terminated']] }, 1, 0] }
          }
        }
      }
    ]).toArray()
  ]);

  const data = rowsRaw
    .map(normalizeMongoDocument)
    .filter(Boolean)
    .map(normalizeActionStateRow);

  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const startItem = totalItems > 0 ? ((safePage - 1) * limit) + 1 : 0;
  const endItem = totalItems > 0 ? Math.min((safePage - 1) * limit + data.length, totalItems) : 0;
  const summaryRow = Array.isArray(summaryRows) && summaryRows.length > 0 ? summaryRows[0] : null;
  const normalizedTableSizeBytes = normalizeBytes(tableSizeBytes);
  const summary = {
    totalActivities: Number(summaryRow?.totalActivities || 0),
    trackedVolumeKB: normalizeVolume(summaryRow?.totalVolumeKB),
    tableSizeBytes: normalizedTableSizeBytes,
    tableSizeKB: normalizedTableSizeBytes / 1024,
    totalVolumeKB: normalizeVolume(summaryRow?.totalVolumeKB),
    activeSessions: Number(summaryRow?.activeSessions || 0),
    failures: Number(summaryRow?.failures || 0)
  };

  return {
    data,
    pagination: {
      currentPage: safePage,
      totalPages,
      totalItems,
      limit,
      startItem,
      endItem
    },
    summary
  };
}

async function getMongoActionStateById(id) {
  return normalizeActionStateRow(normalizeMongoDocument(await getMongoCollection('actionStates').findOne(resolveMongoIdFilter(id))));
}

async function updateMongoActionStateById(id, patch = {}) {
  const collection = getMongoCollection('actionStates');
  const existing = await collection.findOne(resolveMongoIdFilter(id));
  if (!existing) throw new Error('Action state not found');
  const merged = deepMerge(existing, patch);
  merged.id = toPublicId(existing?.id || existing?._id);
  const { _id, ...toSet } = merged;
  await collection.updateOne({ _id: existing._id }, { $set: toSet });
  return normalizeActionStateRow(normalizeMongoDocument(await collection.findOne({ _id: existing._id })));
}

const actionStateRepository = {
  async list(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        return actionStateModel.queryActionStates({
          query,
          scope: options?.scope || {},
          projection: options?.projection || null,
          pagination: options?.pagination || null,
          sort: options?.sort || null
        });
      },
      mongo: async () => listMongoActionStates(options)
    }, 'core.actionStates.list');
  },

  async listPageWithSummary(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const query = options?.query || {};
        const rows = await actionStateModel.queryActionStates({
          query: stripPaginationFromQuery(query),
          scope: options?.scope || {},
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        const normalizedRows = (Array.isArray(rows) ? rows : []).map(normalizeActionStateRow);
        const { page, limit } = parsePageLimit(query, options?.pagination || null);
        const totalItems = normalizedRows.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / limit));
        const safePage = Math.min(Math.max(page, 1), totalPages);
        const startIndex = (safePage - 1) * limit;
        const endIndex = startIndex + limit;
        const data = normalizedRows.slice(startIndex, endIndex);
        const tableSizeBytes = await resolveJsonActionStateTableSizeBytes();

        return {
          data,
          pagination: {
            currentPage: safePage,
            totalPages,
            totalItems,
            limit,
            startItem: totalItems > 0 ? startIndex + 1 : 0,
            endItem: totalItems > 0 ? Math.min(endIndex, totalItems) : 0
          },
          summary: computeSummaryFromRows(normalizedRows, { tableSizeBytes })
        };
      },
      mongo: async () => listMongoActionStatesPageWithSummary(options)
    }, 'core.actionStates.listPageWithSummary');
  },

  async count(options = {}) {
    const query = stripPaginationFromQuery(options?.query || {});
    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await actionStateModel.queryActionStates({
          query,
          scope: options?.scope || {},
          projection: options?.projection || null,
          sort: options?.sort || null
        });
        return Array.isArray(rows) ? rows.length : 0;
      },
      mongo: async () => {
        const collection = getMongoCollection('actionStates');
        const scopeFilter = buildCanViewAllFilter(options?.scope || {});
        const queryFilter = buildMongoFilterFromQuery(query, {
          defaultSearchFields: ['id', 'userId', 'sectionId', 'operationId', 'targetKey', 'status'],
          dateFields: ['startedAt', 'createdAt', 'updatedAt', 'lastActiveAt']
        });
        const filter = combineMongoFilters(scopeFilter, queryFilter);
        return Number(await collection.countDocuments(filter));
      }
    }, 'core.actionStates.count');
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
      json: async () => actionStateModel.getActionStateById(id),
      mongo: async () => getMongoActionStateById(id)
    }, 'core.actionStates.getById');
  },

  async create(data, options = {}) {
    const {
      userId,
      sectionId,
      operationId,
      targetKey,
      limits,
      forceId = null,
      context = {}
    } = data || {};
    return runByRepositoryBackend(options, {
      json: async () => actionStateModel.logAttempt(userId, sectionId, operationId, targetKey, limits, forceId, context),
      mongo: async () => {
        const collection = getMongoCollection('actionStates');
        const nowDate = new Date();
        const now = nowDate.toISOString();
        const normalizedUserId = toPublicId(userId);
        const normalizedSectionId = toPublicId(sectionId);
        const normalizedOperationId = toPublicId(operationId);
        const normalizedTargetKey = String(targetKey || '');
        const normalizedContext = context && typeof context === 'object' ? context : {};
        const safeLimits = limits && typeof limits === 'object' ? limits : {};
        const maxTimeMinutes = Number.parseInt(safeLimits?.maxTimeMinutes, 10);
        const expiresAt = Number.isFinite(maxTimeMinutes) && maxTimeMinutes > 0
          ? new Date(nowDate.getTime() + maxTimeMinutes * 60 * 1000).toISOString()
          : new Date(nowDate.getTime() + 60 * 60 * 1000).toISOString();
        const toActiveStateError = (state, message) => {
          if (!state) throw new Error(message || 'Invalid Action State ID.');
          if (!isActiveActionStateStatus(state?.status)) throw new Error('Action State is no longer active.');
          const expiry = normalizeIsoDate(state?.expiresAt);
          if (expiry && new Date(expiry).getTime() <= nowDate.getTime()) {
            throw new Error('Action Session has expired.');
          }
        };

        const appendAttemptHistory = (state, details) => {
          const existingHistory = Array.isArray(state?.history)
            ? state.history.map((entry) => normalizeHistoryEntry(entry)).filter(Boolean)
            : buildMongoHistoryFallback(state);
          return [
            ...sortHistoryAscending(existingHistory),
            {
              ts: now,
              status: 'attempt_started',
              details: String(details || '').trim() || 'Session Resumed',
              context: normalizedContext
            }
          ];
        };

        const resumeStateByRawDocument = async (rawDoc, normalizedState, details) => {
          const patch = {
            status: 'active',
            attemptCount: Number(normalizedState?.attemptCount || 0) + 1,
            appliedLimits: safeLimits,
            limits: safeLimits,
            context: normalizedContext,
            updatedAt: now,
            lastActiveAt: now,
            history: appendAttemptHistory(normalizedState, details),
            retentionUntil: resolveRetentionUntil('active', new Date(now)),
            expiresAt
          };

          if (rawDoc?._id !== undefined && rawDoc?._id !== null) {
            await collection.updateOne({ _id: rawDoc._id }, { $set: patch });
            const refreshed = await collection.findOne({ _id: rawDoc._id });
            if (!refreshed) throw new Error('Action state not found');
            return normalizeActionStateRow(normalizeMongoDocument(refreshed));
          }

          return updateMongoActionStateById(normalizedState?.id, patch);
        };

        if (forceId) {
          const existingRaw = await collection.findOne(resolveMongoIdFilter(forceId));
          const existing = normalizeActionStateRow(normalizeMongoDocument(existingRaw));
          if (!existing) throw new Error('Invalid Action State ID.');
          if (existing.userId !== normalizedUserId) throw new Error('Security Violation: User mismatch.');
          toActiveStateError(existing, 'Invalid Action State ID.');
          if (normalizedSectionId && existing.sectionId && existing.sectionId !== normalizedSectionId) {
            throw new Error('Action State Token does not belong to this section.');
          }
          if (normalizedOperationId && existing.operationId && existing.operationId !== normalizedOperationId) {
            throw new Error('Action State Token does not belong to this operation.');
          }
          if (normalizedTargetKey && String(existing.targetKey || '') !== normalizedTargetKey) {
            throw new Error('Action State Token is not valid for this record.');
          }

          return resumeStateByRawDocument(existingRaw, existing, 'Session Resumed by Client');
        }

        const reusableRaw = await collection.findOne({
          userId: normalizedUserId,
          sectionId: normalizedSectionId,
          operationId: normalizedOperationId,
          targetKey: normalizedTargetKey,
          status: { $in: ['active', 'attempted', 'in_progress', 'retryable_error'] },
          $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: null },
            { expiresAt: '' },
            { expiresAt: { $gt: now } }
          ]
        });
        const reusable = normalizeActionStateRow(normalizeMongoDocument(reusableRaw));
        if (reusable) {
          const reusableExpiry = normalizeIsoDate(reusable.expiresAt);
          const isReusableExpired = reusableExpiry && new Date(reusableExpiry).getTime() <= nowDate.getTime();
          if (!isReusableExpired) {
            toActiveStateError(reusable, 'Action State is no longer active.');
            try {
              return await resumeStateByRawDocument(reusableRaw, reusable, 'New/Auto Session Started');
            } catch (resumeError) {
              const msg = String(resumeError?.message || '');
              if (!/Action state not found/i.test(msg)) throw resumeError;
              // If a stale reusable pointer races with retention/deletion, fallback to a fresh state.
            }
          }
        }

        const payload = {
          id: await generateUniqueStringId(collection),
          userId: normalizedUserId,
          sectionId: normalizedSectionId,
          operationId: normalizedOperationId,
          targetKey: normalizedTargetKey,
          status: 'active',
          attemptCount: 1,
          volumeUsageKB: 0,
          startedAt: now,
          createdAt: now,
          updatedAt: now,
          lastActiveAt: now,
          expiresAt,
          limits: safeLimits,
          appliedLimits: safeLimits,
          initialContext: normalizedContext,
          context: normalizedContext,
          changeEvents: [],
          history: [{
            ts: now,
            status: 'attempt_started',
            details: 'New/Auto Session Started',
            context: normalizedContext
          }]
        };
        payload.retentionUntil = resolveRetentionUntil(payload.status, new Date(payload.updatedAt));
        await collection.insertOne(payload);
        return normalizeActionStateRow(normalizeMongoDocument(payload));
      }
    }, 'core.actionStates.create');
  },

  async update(id, data, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        if (data?.action === 'progress') return actionStateModel.updateProgress(id, data.volumeKB || 0, data.context || {});
        if (data?.action === 'complete') return actionStateModel.completeState(id, data.payload, data.volumeKB || 0, data.context || {});
        if (data?.action === 'append_change_event') return actionStateModel.appendChangeEvent(id, data.changeEvent, data.context || {});
        if (data?.action === 'fail') return actionStateModel.failAttempt(id, data.volumeKB || 0, data.context || {});
        if (data?.action === 'retryable_error') return actionStateModel.recordRetryableError(id, data.message, data.volumeKB || 0, data.context || {});
        if (data?.action === 'cancel') return actionStateModel.cancelState(id);
        throw new Error('Unsupported action state update action.');
      },
      mongo: async () => {
        const action = String(data?.action || '').trim().toLowerCase();
        const now = new Date().toISOString();
        const existing = await getMongoActionStateById(id);
        if (!existing) throw new Error('Action state not found');
        const existingHistory = Array.isArray(existing?.history)
          ? existing.history.map((entry) => normalizeHistoryEntry(entry)).filter(Boolean)
          : buildMongoHistoryFallback(existing);
        const appendHistory = (status, details = '', volumeKB = 0, context = {}) => {
          const merged = [
            ...sortHistoryAscending(existingHistory),
            {
              ts: now,
              status,
              details: String(details || '').trim(),
              volumeKB: normalizeVolume(volumeKB),
              context: context && typeof context === 'object' ? context : {}
            }
          ];
          return sortHistoryAscending(merged);
        };

        if (action === 'progress') {
          const addedVolume = Number(data?.volumeKB || 0);
          const nextVolume = normalizeVolume(existing?.volumeUsageKB) + normalizeVolume(addedVolume);
          return updateMongoActionStateById(id, {
            status: 'active',
            volumeUsageKB: nextVolume,
            lastActiveAt: now,
            progress: {
              volumeKB: normalizeVolume(addedVolume),
              context: data?.context || {},
              at: now
            },
            history: appendHistory('step_completed', 'Intermediate response sent', addedVolume, data?.context || {}),
            updatedAt: now,
            retentionUntil: resolveRetentionUntil('active', new Date(now))
          });
        }
        if (action === 'complete') {
          const addedVolume = Number(data?.volumeKB || 0);
          const nextVolume = normalizeVolume(existing?.volumeUsageKB) + normalizeVolume(addedVolume);
          return updateMongoActionStateById(id, {
            status: 'completed',
            volumeUsageKB: nextVolume,
            lastActiveAt: now,
            finalData: data?.payload ?? null,
            result: {
              payload: data?.payload ?? null,
              volumeKB: normalizeVolume(addedVolume),
              context: data?.context || {},
              at: now
            },
            history: appendHistory('success_completed', '', addedVolume, data?.context || {}),
            updatedAt: now,
            retentionUntil: resolveRetentionUntil('completed', new Date(now))
          });
        }
        if (action === 'append_change_event') {
          const existingEvents = normalizeChangeEvents(existing?.changeEvents || []);
          const event = normalizeChangeEventEntry(data?.changeEvent || {});
          if (!event) return existing;
          return updateMongoActionStateById(id, {
            changeEvents: [...existingEvents, event],
            lastActiveAt: now,
            updatedAt: now,
            retentionUntil: resolveRetentionUntil(existing?.status || 'active', new Date(now))
          });
        }
        if (action === 'fail') {
          const addedVolume = Number(data?.volumeKB || 0);
          const nextVolume = normalizeVolume(existing?.volumeUsageKB) + normalizeVolume(addedVolume);
          return updateMongoActionStateById(id, {
            status: 'failed',
            volumeUsageKB: nextVolume,
            lastActiveAt: now,
            failure: {
              volumeKB: normalizeVolume(addedVolume),
              context: data?.context || {},
              at: now
            },
            history: appendHistory('failed', '', addedVolume, data?.context || {}),
            updatedAt: now,
            retentionUntil: resolveRetentionUntil('failed', new Date(now))
          });
        }
        if (action === 'retryable_error') {
          const addedVolume = Number(data?.volumeKB || 0);
          const nextVolume = normalizeVolume(existing?.volumeUsageKB) + normalizeVolume(addedVolume);
          return updateMongoActionStateById(id, {
            status: 'active',
            volumeUsageKB: nextVolume,
            lastActiveAt: now,
            retryableError: {
              message: String(data?.message || ''),
              volumeKB: normalizeVolume(addedVolume),
              context: data?.context || {},
              at: now
            },
            history: appendHistory('error_retryable', String(data?.message || 'Client side error'), addedVolume, data?.context || {}),
            updatedAt: now,
            retentionUntil: resolveRetentionUntil('active', new Date(now))
          });
        }
        if (action === 'cancel') {
          if (!isActiveActionStateStatus(existing?.status)) return existing;
          return updateMongoActionStateById(id, {
            status: 'cancelled',
            lastActiveAt: now,
            history: appendHistory('cancelled', 'User explicitly cancelled the action.', 0, {}),
            updatedAt: now,
            retentionUntil: resolveRetentionUntil('cancelled', new Date(now))
          });
        }
        throw new Error('Unsupported action state update action.');
      }
    }, 'core.actionStates.update');
  },

  async backfillMissingRetention(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => 0,
      mongo: async () => {
        const collection = getMongoCollection('actionStates');
        const limit = Math.max(1, Number.parseInt(options?.limit, 10) || 500);
        const rows = await collection
          .find({
            $or: [
              { retentionUntil: { $exists: false } },
              { retentionUntil: null },
              { retentionUntil: '' }
            ]
          })
          .project({ _id: 1, status: 1, updatedAt: 1, createdAt: 1 })
          .limit(limit)
          .toArray();

        if (!rows.length) return 0;

        const bulkOps = rows.map((row) => {
          const baseDate = new Date(row?.updatedAt || row?.createdAt || new Date());
          return {
            updateOne: {
              filter: { _id: row._id },
              update: { $set: { retentionUntil: resolveRetentionUntil(row?.status, baseDate) } }
            }
          };
        });

        const result = await collection.bulkWrite(bulkOps, { ordered: false });
        return Number(result?.modifiedCount || 0);
      }
    }, 'core.actionStates.backfillMissingRetention');
  },

  async deleteExpiredByRetention(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => {
        const now = new Date();
        const rows = await this.list({ query: {}, scope: { canViewAll: true } });
        let deleted = 0;
        for (const row of rows) {
          const retentionUntil = row?.retentionUntil ? new Date(row.retentionUntil) : null;
          if (!retentionUntil || Number.isNaN(retentionUntil.getTime())) continue;
          if (retentionUntil <= now) {
            // eslint-disable-next-line no-await-in-loop
            await this.remove(row.id, options);
            deleted += 1;
          }
        }
        return deleted;
      },
      mongo: async () => {
        const collection = getMongoCollection('actionStates');
        const nowAt = new Date();
        const result = await collection.deleteMany({
          retentionUntil: { $lte: nowAt }
        });
        return Number(result?.deletedCount || 0);
      }
    }, 'core.actionStates.deleteExpiredByRetention');
  },

  async remove(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => actionStateModel.deleteActionState(id),
      mongo: async () => getMongoCollection('actionStates').deleteOne(resolveMongoIdFilter(id))
    }, 'core.actionStates.remove');
  },

  async getAllActionStates() {
    return await this.list();
  },

  async getActionStateById(id) {
    return await this.getById(id);
  },

  async getActionStatesByQuery(query = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => actionStateModel.getActionStatesByQuery(query),
      mongo: async () => this.list({ query, scope: options?.scope || {} })
    }, 'core.actionStates.getByQuery');
  },

  async getDecryptedData(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => actionStateModel.getDecryptedData(id),
      mongo: async () => {
        const row = await this.getById(id, options);
        if (!row) return null;
        return row.result?.payload ?? row.payload ?? null;
      }
    }, 'core.actionStates.getDecryptedData');
  },

  async logAttempt(userId, sectionId, operationId, targetKey, limits, forceId = null, context = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => actionStateModel.logAttempt(userId, sectionId, operationId, targetKey, limits, forceId, context),
      mongo: async () => this.create({ userId, sectionId, operationId, targetKey, limits, forceId, context }, options)
    }, 'core.actionStates.logAttempt');
  },

  async updateProgress(id, volumeKB = 0, context = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => actionStateModel.updateProgress(id, volumeKB, context),
      mongo: async () => this.update(id, { action: 'progress', volumeKB, context }, options)
    }, 'core.actionStates.updateProgress');
  },

  async completeState(id, payload, volumeKB = 0, context = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => actionStateModel.completeState(id, payload, volumeKB, context),
      mongo: async () => this.update(id, { action: 'complete', payload, volumeKB, context }, options)
    }, 'core.actionStates.completeState');
  },

  async appendChangeEvent(id, changeEvent, context = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => actionStateModel.appendChangeEvent(id, changeEvent, context),
      mongo: async () => this.update(id, { action: 'append_change_event', changeEvent, context }, options)
    }, 'core.actionStates.appendChangeEvent');
  },

  async failAttempt(id, volumeKB = 0, context = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => actionStateModel.failAttempt(id, volumeKB, context),
      mongo: async () => this.update(id, { action: 'fail', volumeKB, context }, options)
    }, 'core.actionStates.failAttempt');
  },

  async recordRetryableError(id, message, volumeKB = 0, context = {}, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => actionStateModel.recordRetryableError(id, message, volumeKB, context),
      mongo: async () => this.update(id, { action: 'retryable_error', message, volumeKB, context }, options)
    }, 'core.actionStates.recordRetryableError');
  },

  async cancelState(id, options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => actionStateModel.cancelState(id),
      mongo: async () => this.update(id, { action: 'cancel' }, options)
    }, 'core.actionStates.cancelState');
  },

  async deleteActionState(id) {
    return await this.remove(id);
  },

  async deleteAllActionStates(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => actionStateModel.deleteAllActionStates(),
      mongo: async () => getMongoCollection('actionStates').deleteMany({})
    }, 'core.actionStates.deleteAll');
  },

  async getSystemActionStateStats(options = {}) {
    return runByRepositoryBackend(options, {
      json: async () => actionStateModel.getSystemActionStateStats(),
      mongo: async () => {
        const collection = getMongoCollection('actionStates');
        const actionStateCount = await collection.countDocuments({});

        let actionStateHealth = 'success';
        let actionStateMessage = 'Healthy';
        if (actionStateCount > ACTION_STATE_LIMITS.COUNT_DANGER) {
          actionStateHealth = 'danger';
          actionStateMessage = 'Critical Limit';
        } else if (actionStateCount > ACTION_STATE_LIMITS.COUNT_WARNING) {
          actionStateHealth = 'warning';
          actionStateMessage = 'High Volume';
        }

        return {
          actionStateCount,
          actionStateHealth,
          actionStateMessage
        };
      }
    }, 'core.actionStates.getSystemStats');
  },

  async getEntityTimeline(entityType, entityId, options = {}) {
    const normalizedType = String(entityType || '').trim();
    const normalizedId = String(entityId || '').trim();
    if (!normalizedType || !normalizedId) return [];

    const buildTimelineRows = (states = []) => {
      const rows = [];
      (Array.isArray(states) ? states : []).forEach((state) => {
        const changeEvents = normalizeChangeEvents(state?.changeEvents || []);
        changeEvents.forEach((event) => {
          if (event.entityType !== normalizedType || event.entityId !== normalizedId) return;
          rows.push({
            actionStateId: String(state?.id || '').trim(),
            actionStateStatus: String(state?.status || '').trim(),
            sectionId: String(state?.sectionId || '').trim(),
            operationId: String(state?.operationId || '').trim(),
            targetKey: String(state?.targetKey || '').trim(),
            userId: String(state?.userId || '').trim(),
            at: event.at,
            event
          });
        });
      });

      rows.sort((left, right) => {
        const a = Date.parse(left?.at || '');
        const b = Date.parse(right?.at || '');
        if (Number.isNaN(a) && Number.isNaN(b)) return 0;
        if (Number.isNaN(a)) return 1;
        if (Number.isNaN(b)) return -1;
        return a - b;
      });
      return rows;
    };

    return runByRepositoryBackend(options, {
      json: async () => {
        const states = await actionStateModel.getAllActionStates();
        return buildTimelineRows(states);
      },
      mongo: async () => {
        const collection = getMongoCollection('actionStates');
        const rows = await collection.find({
          changeEvents: {
            $elemMatch: {
              entityType: normalizedType,
              entityId: normalizedId
            }
          }
        }).toArray();
        const normalizedStates = rows.map(normalizeMongoDocument).filter(Boolean).map(normalizeActionStateRow);
        return buildTimelineRows(normalizedStates);
      }
    }, 'core.actionStates.getEntityTimeline');
  }
};

assertActionStateRepository('actionStateRepository', actionStateRepository);

module.exports = actionStateRepository;
