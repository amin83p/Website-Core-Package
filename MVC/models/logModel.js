// MVC/models/logModel.js
const fs = require('fs').promises;
const path = require('path');
const fsNormal = require('fs');
const { queueWrite } = require('./fileQueue');

const { applyGenericFilter } = require('../utils/queryEngine');
const { idsEqual } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');
const { canonicalizeLogInput, normalizePersistedLogRecord } = require('../utils/logRecordUtils');

const dataPath = path.join(__dirname, '../../data/logs.json');
const MAX_LOGS = 5000;

const LOG_LIMITS = {
  COUNT_WARNING: 2500,
  COUNT_DANGER: 4500,
  SIZE_WARNING_MB: 2,
  SIZE_DANGER_MB: 5
};

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

async function getSystemLogStats() {
  let logCount = 0;
  let logSize = '0 Bytes';
  let logHealth = 'success';
  let logMessage = 'Healthy';

  try {
    if (fsNormal.existsSync(dataPath)) {
      const stats = fsNormal.statSync(dataPath);
      const sizeBytes = stats.size;
      logSize = formatBytes(sizeBytes);
      const logs = await getAllLogs();
      logCount = logs.length;

      if (logCount > LOG_LIMITS.COUNT_DANGER || sizeBytes > (LOG_LIMITS.SIZE_DANGER_MB * 1024 * 1024)) {
        logHealth = 'danger';
        logMessage = 'Critical Limit';
      } else if (logCount > LOG_LIMITS.COUNT_WARNING || sizeBytes > (LOG_LIMITS.SIZE_WARNING_MB * 1024 * 1024)) {
        logHealth = 'warning';
        logMessage = 'High Volume';
      }
    }
  } catch (e) {
    console.error('Log Stat Error:', e.message);
    logHealth = 'secondary';
  }

  return { logCount, logSize, logHealth, logMessage };
}

async function getAllLogs() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    const rows = JSON.parse(data);
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => normalizePersistedLogRecord(row)).filter(Boolean);
  } catch (error) {
    return [];
  }
}

function buildLogQueryPlan(options = {}) {
  const query = options?.query || {};

  return {
    entity: 'logs',
    query,
    scope: options?.scope || {},
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
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
      dateFields: ['timestamp']
    }
  };
}

async function queryLogs(options = {}) {
  const plan = buildLogQueryPlan(options);
  const executor = getEntityQueryExecutor('logs');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result.map((row) => normalizePersistedLogRecord(row)).filter(Boolean);
    if (result && Array.isArray(result.items)) {
      return result.items.map((row) => normalizePersistedLogRecord(row)).filter(Boolean);
    }
  }

  const getAllLogsFn = module.exports?.getAllLogs;
  const allLogs = await (typeof getAllLogsFn === 'function'
    ? getAllLogsFn()
    : getAllLogs());
  const normalizedLogs = (Array.isArray(allLogs) ? allLogs : [])
    .map((row) => normalizePersistedLogRecord(row))
    .filter(Boolean);
  return applyGenericFilter(normalizedLogs, plan.query, plan.fallback);
}

async function addLog(sectionId, operationId, user, status, details = {}) {
  let created = null;
  await queueWrite(async () => {
    let logs = await getAllLogs();
    const canonical = canonicalizeLogInput({
      sectionId,
      operationId,
      user,
      status,
      details
    });

    created = {
      id: canonical.id || (Date.now().toString(36) + Math.random().toString(36).substr(2, 5)),
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

    logs.unshift(created);

    if (logs.length > MAX_LOGS) {
      logs = logs.slice(0, MAX_LOGS);
    }

    await fs.writeFile(dataPath, JSON.stringify(logs, null, 2));
  });
  return created;
}

async function getReport({ sectionId, operationId, userId, startDate, endDate }) {
  const logs = await getAllLogs();

  return logs.filter((log) => {
    let match = true;
    const logDate = new Date(log.timestamp);

    if (sectionId && log.sectionId !== sectionId) match = false;
    if (operationId && log.operationId !== operationId) match = false;
    if (userId && !idsEqual(log?.userId, userId)) match = false;
    if (startDate && logDate < new Date(startDate)) match = false;
    if (endDate && logDate > new Date(endDate)) match = false;

    return match;
  });
}

async function deleteLog(id) {
  await queueWrite(async () => {
    const logs = await getAllLogs();
    const filtered = logs.filter((u) => !idsEqual(u?.id, id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

async function deleteAllLog() {
  await queueWrite(async () => {
    await fs.writeFile(dataPath, JSON.stringify([], null, 2));
  });
}

module.exports = {
  getAllLogs,
  queryLogs,
  buildLogQueryPlan,
  addLog,
  getReport,
  deleteLog,
  deleteAllLog,
  getSystemLogStats
};
