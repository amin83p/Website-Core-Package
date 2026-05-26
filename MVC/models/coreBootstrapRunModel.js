const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');

const DEFAULT_DATA_PATH = path.join(__dirname, '../../data/coreBootstrapRuns.json');

function resolveDataPath() {
  const overridePath = String(process.env.CORE_BOOTSTRAP_RUN_DATA_PATH || '').trim();
  return overridePath ? path.resolve(overridePath) : DEFAULT_DATA_PATH;
}

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function sanitizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function sanitizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value;
}

function normalizeRunStatus(value = '') {
  const token = cleanText(value, 80).toLowerCase();
  if (!token) return 'success';
  if (['success', 'partial_success', 'failed', 'preview'].includes(token)) return token;
  return 'success';
}

function normalizePersistedRow(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = cleanText(source.id || source.runId, 160);
  if (!id) throw new Error('core bootstrap run id is required.');
  return {
    id,
    runId: id,
    action: cleanText(source.action || 'preflight', 40).toLowerCase(),
    baselineId: cleanText(source.baselineId, 160),
    baselineVersion: cleanText(source.baselineVersion, 120),
    manifestHash: cleanText(source.manifestHash, 160),
    backendMode: cleanText(source.backendMode, 40).toLowerCase(),
    status: normalizeRunStatus(source.status),
    actor: sanitizeObject(source.actor),
    startedAt: cleanText(source.startedAt, 80),
    finishedAt: cleanText(source.finishedAt, 80),
    summary: sanitizeObject(source.summary),
    report: sanitizeObject(source.report),
    warnings: sanitizeArray(source.warnings).map((row) => cleanText(row, 1200)).filter(Boolean),
    audit: {
      createUser: cleanText(source?.audit?.createUser, 160) || 'SYSTEM',
      createDateTime: cleanText(source?.audit?.createDateTime, 80) || '',
      lastUpdateUser: cleanText(source?.audit?.lastUpdateUser, 160) || 'SYSTEM',
      lastUpdateDateTime: cleanText(source?.audit?.lastUpdateDateTime, 80) || ''
    }
  };
}

function resolveActorLabel(actor = null) {
  if (!actor) return 'SYSTEM';
  if (typeof actor === 'object') {
    return cleanText(actor.id || actor.username || actor.email || '', 160) || 'SYSTEM';
  }
  return cleanText(actor, 160) || 'SYSTEM';
}

function normalizeRow(input = {}, existing = null, options = {}) {
  const now = new Date().toISOString();
  const source = input && typeof input === 'object' ? input : {};
  const existingRow = existing && typeof existing === 'object' ? existing : null;
  const actorLabel = resolveActorLabel(options?.actor || source?.actor || null);
  const id = cleanText(source.id || source.runId || existingRow?.id, 160)
    || `CORE_BOOTSTRAP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return normalizePersistedRow({
    ...(existingRow || {}),
    ...source,
    id,
    runId: id,
    status: normalizeRunStatus(source.status || existingRow?.status || 'success'),
    startedAt: cleanText(source.startedAt, 80) || existingRow?.startedAt || now,
    finishedAt: cleanText(source.finishedAt, 80) || now,
    audit: {
      createUser: cleanText(existingRow?.audit?.createUser || source?.audit?.createUser || actorLabel, 160) || 'SYSTEM',
      createDateTime: cleanText(existingRow?.audit?.createDateTime || source?.audit?.createDateTime || now, 80) || now,
      lastUpdateUser: actorLabel,
      lastUpdateDateTime: now
    }
  });
}

async function readAllRows() {
  const dataPath = resolveDataPath();
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    const parsed = JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row) => {
      try {
        return normalizePersistedRow(row);
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function queryRows(options = {}) {
  const rows = await readAllRows();
  return applyGenericFilter(rows, options?.query || {}, {
    defaultSearchFields: ['id', 'action', 'baselineId', 'baselineVersion', 'backendMode', 'status'],
    dateFields: ['startedAt', 'finishedAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
  });
}

async function upsertById(id = '', patch = {}, options = {}) {
  return queueWrite(async () => {
    const token = cleanText(id || patch?.id || patch?.runId, 160);
    if (!token) throw new Error('id is required.');
    const rows = await readAllRows();
    const index = rows.findIndex((row) => cleanText(row?.id, 160) === token);
    const existing = index >= 0 ? rows[index] : null;
    const normalized = normalizeRow({ ...(patch || {}), id: token, runId: token }, existing, options);
    if (index >= 0) rows[index] = normalized;
    else rows.push(normalized);

    const dataPath = resolveDataPath();
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function createRow(input = {}, options = {}) {
  const id = cleanText(input?.id || input?.runId, 160)
    || `CORE_BOOTSTRAP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return upsertById(id, { ...(input || {}), id, runId: id }, options);
}

module.exports = {
  resolveDataPath,
  normalizePersistedRow,
  normalizeRow,
  readAllRows,
  queryRows,
  upsertById,
  createRow
};
