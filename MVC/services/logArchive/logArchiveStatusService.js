'use strict';

const path = require('path');
const fs = require('fs');
const logRepository = require('../../repositories/logRepository');
const actionStateRepository = require('../../repositories/actionStateRepository');
const { runByRepositoryBackend } = require('../../repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = require('../../infrastructure/mongo/mongoConnection');
const { resolveRepositoryBackendMode } = require('../../repositories/backend/repositoryBackendSelector');
const logArchiveStateService = require('./logArchiveStateService');
const { getDateKeyInTimezone, getTodayDateKeyInTimezone } = require('../../utils/timezoneUtils');

const LOGS_JSON_PATH = path.join(__dirname, '../../../data/logs.json');
const ACTION_STATES_JSON_PATH = path.join(__dirname, '../../../data/actionStates.json');

function parseIsoMs(value) {
  const token = String(value || '').trim();
  if (!token) return null;
  const ms = new Date(token).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function dayAfterDateKey(dateKey) {
  const token = String(dateKey || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return '';
  const base = new Date(`${token}T12:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString().slice(0, 10);
}

function resolveRecordTimestampLog(row = {}) {
  return String(row?.timestamp || row?.createdAt || row?.audit?.createDateTime || '').trim();
}

function resolveRecordTimestampAction(row = {}) {
  return String(row?.startedAt || row?.createdAt || row?.updatedAt || row?.lastActiveAt || '').trim();
}

async function scanJsonFileBounds(filePath, pickTimestamp) {
  let count = 0;
  let sizeBytes = 0;
  let earliest = '';
  let latest = '';
  try {
    if (fs.existsSync(filePath)) {
      sizeBytes = fs.statSync(filePath).size;
      const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (Array.isArray(rows)) {
        count = rows.length;
        rows.forEach((row) => {
          const ts = pickTimestamp(row);
          if (!ts) return;
          if (!earliest || ts < earliest) earliest = ts;
          if (!latest || ts > latest) latest = ts;
        });
      }
    }
  } catch (_) {
    /* ignore */
  }
  return { count, sizeBytes, earliest, latest };
}

async function scanMongoBounds(collectionName, dateField) {
  const collection = getMongoCollection(collectionName);
  const count = Number(await collection.countDocuments({}));
  let earliest = '';
  let latest = '';
  const [minRow, maxRow] = await Promise.all([
    collection.find({ [dateField]: { $exists: true, $ne: '' } }).sort({ [dateField]: 1 }).limit(1).toArray(),
    collection.find({ [dateField]: { $exists: true, $ne: '' } }).sort({ [dateField]: -1 }).limit(1).toArray()
  ]);
  if (minRow[0]) earliest = String(minRow[0][dateField] || '');
  if (maxRow[0]) latest = String(maxRow[0][dateField] || '');
  let sizeBytes = 0;
  try {
    const db = collection.db;
    const name = String(collection.collectionName || collectionName || '').trim();
    if (db && name) {
      const collStats = await db.command({ collStats: name, scale: 1 });
      sizeBytes = Number(collStats?.storageSize ?? collStats?.size ?? 0) || 0;
    }
  } catch (_) {
    sizeBytes = 0;
  }
  return { count, sizeBytes, earliest, latest };
}

async function buildCollectionStatus(entityKey, options = {}) {
  const mode = resolveRepositoryBackendMode(options);
  const isLogs = entityKey === 'logs';
  const jsonPath = isLogs ? LOGS_JSON_PATH : ACTION_STATES_JSON_PATH;
  const pickTs = isLogs ? resolveRecordTimestampLog : resolveRecordTimestampAction;
  const mongoCollection = isLogs ? 'logs' : 'actionStates';
  const mongoDateField = isLogs ? 'timestamp' : 'startedAt';

  let bounds = { count: 0, sizeBytes: 0, earliest: '', latest: '' };
  let health = { health: 'secondary', message: 'Unknown' };

  if (mode === 'mongo') {
    bounds = await runByRepositoryBackend({}, {
      mongo: async () => scanMongoBounds(mongoCollection, mongoDateField),
      json: async () => scanJsonFileBounds(jsonPath, pickTs)
    }, `logArchive.status.${entityKey}`);
  } else {
    bounds = await scanJsonFileBounds(jsonPath, pickTs);
  }

  if (isLogs) {
    const stats = await logRepository.getSystemLogStats(options);
    health = {
      health: stats?.logHealth || 'secondary',
      message: stats?.logMessage || ''
    };
  } else {
    const stats = await actionStateRepository.getSystemActionStateStats(options);
    health = {
      health: stats?.actionStateHealth || 'secondary',
      message: stats?.actionStateMessage || ''
    };
  }

  return {
    entity: entityKey,
    label: isLogs ? 'Activity logs' : 'Action states',
    backendMode: mode,
    count: bounds.count,
    sizeBytes: bounds.sizeBytes,
    earliestAt: bounds.earliest,
    latestAt: bounds.latest,
    health: health.health,
    healthMessage: health.message
  };
}

function suggestDefaultEndDate(timezone = 'UTC') {
  const yesterdayMs = Date.now() - (24 * 60 * 60 * 1000);
  return getTodayDateKeyInTimezone(timezone, yesterdayMs);
}

function suggestStartDate({ archiveState, logsStatus, actionStatesStatus, timezone = 'UTC' }) {
  const fromCursor = String(archiveState?.lastExportEndDate || '').trim();
  if (fromCursor) {
    const next = dayAfterDateKey(fromCursor);
    if (next) return next;
  }
  const candidates = [
    logsStatus?.earliestAt,
    actionStatesStatus?.earliestAt
  ].map((value) => parseIsoMs(value)).filter(Number.isFinite);
  if (!candidates.length) return suggestDefaultEndDate(timezone);
  const minMs = Math.min(...candidates);
  return getDateKeyInTimezone(minMs, timezone) || new Date(minMs).toISOString().slice(0, 10);
}

async function buildArchiveStatusDashboard(options = {}) {
  const timezone = String(options?.timezone || 'UTC').trim() || 'UTC';
  const [logsStatus, actionStatesStatus, archiveState] = await Promise.all([
    buildCollectionStatus('logs', options),
    buildCollectionStatus('actionStates', options),
    logArchiveStateService.getLogArchiveState()
  ]);

  const suggestedStartDate = suggestStartDate({
    archiveState,
    logsStatus,
    actionStatesStatus,
    timezone
  });
  const suggestedEndDate = suggestDefaultEndDate(timezone);

  return {
    timezone,
    collections: {
      logs: logsStatus,
      actionStates: actionStatesStatus
    },
    archiveState,
    suggestedStartDate,
    suggestedEndDate
  };
}

module.exports = {
  buildArchiveStatusDashboard,
  buildCollectionStatus,
  suggestStartDate,
  suggestDefaultEndDate,
  dayAfterDateKey
};
