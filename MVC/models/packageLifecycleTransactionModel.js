const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');

const DEFAULT_DATA_PATH = path.join(__dirname, '../../data/packageLifecycleTransactions.json');
const ALLOWED_STATUS = new Set([
  'running',
  'success',
  'failed',
  'blocked',
  'rollback_applied',
  'rollback_failed'
]);

function resolveDataPath() {
  const overridePath = String(process.env.PACKAGE_LIFECYCLE_TRANSACTION_DATA_PATH || '').trim();
  return overridePath ? path.resolve(overridePath) : DEFAULT_DATA_PATH;
}

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizePackageId(value = '') {
  return cleanText(value, 120).toLowerCase();
}

function normalizeStatus(value = '', fallback = 'running') {
  const token = cleanText(value, 80).toLowerCase();
  if (!token) return fallback;
  return ALLOWED_STATUS.has(token) ? token : fallback;
}

function resolveAuditUser(actor = null) {
  if (!actor) return 'SYSTEM';
  if (typeof actor === 'object') {
    return cleanText(actor.id || actor.username || actor.email || '', 160) || 'SYSTEM';
  }
  return cleanText(actor, 160) || 'SYSTEM';
}

function sanitizeSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function sanitizeArrayRows(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row && typeof row === 'object');
}

function hashPayload(value) {
  const raw = JSON.stringify(value === undefined ? null : value);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function normalizeEntityOperation(row = {}) {
  const source = row && typeof row === 'object' ? row : {};
  const beforePayload = source.beforePayload === undefined ? null : source.beforePayload;
  const afterPayload = source.afterPayload === undefined ? null : source.afterPayload;
  return {
    entityType: cleanText(source.entityType, 80).toLowerCase(),
    identityKey: cleanText(source.identityKey || source.key, 400),
    ownership: sanitizeSnapshot(source.ownership),
    operation: cleanText(source.operation || source.status, 80).toLowerCase(),
    reason: cleanText(source.reason || source.message, 1200),
    beforeHash: cleanText(source.beforeHash, 120) || hashPayload(beforePayload),
    afterHash: cleanText(source.afterHash, 120) || hashPayload(afterPayload),
    beforePayload,
    afterPayload,
    recordedAt: cleanText(source.recordedAt, 80) || new Date().toISOString()
  };
}

function normalizePhaseRow(row = {}) {
  const source = row && typeof row === 'object' ? row : {};
  return {
    name: cleanText(source.name, 80).toLowerCase(),
    status: cleanText(source.status, 80).toLowerCase(),
    startedAt: cleanText(source.startedAt, 80),
    finishedAt: cleanText(source.finishedAt, 80),
    details: sanitizeSnapshot(source.details)
  };
}

function normalizePersistedTransaction(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = cleanText(source.id || source.transactionId, 160);
  if (!id) throw new Error('Lifecycle transaction id is required.');
  const packageId = normalizePackageId(source.packageId || source.package?.id || '');
  if (!packageId) throw new Error('Lifecycle transaction packageId is required.');
  return {
    id,
    transactionId: id,
    packageId,
    packageName: cleanText(source.packageName, 200),
    packageVersion: cleanText(source.packageVersion || source.version, 120),
    action: cleanText(source.action, 80).toLowerCase(),
    status: normalizeStatus(source.status, 'running'),
    phase: cleanText(source.phase, 80).toLowerCase(),
    startedAt: cleanText(source.startedAt, 80),
    finishedAt: cleanText(source.finishedAt, 80),
    actor: sanitizeSnapshot(source.actor),
    backendMode: cleanText(source.backendMode, 40).toLowerCase(),
    phases: sanitizeArrayRows(source.phases).map(normalizePhaseRow),
    entityOperations: sanitizeArrayRows(source.entityOperations).map(normalizeEntityOperation),
    summaryByEntity: sanitizeSnapshot(source.summaryByEntity),
    warnings: sanitizeArrayRows(source.warnings).map((row) => cleanText(row, 1200)).filter(Boolean),
    blockedReasons: sanitizeArrayRows(source.blockedReasons).map((row) => cleanText(row, 1200)).filter(Boolean),
    modifiedRecords: sanitizeArrayRows(source.modifiedRecords),
    rollback: sanitizeSnapshot(source.rollback),
    artifacts: sanitizeSnapshot(source.artifacts),
    metadata: sanitizeSnapshot(source.metadata),
    audit: {
      createUser: cleanText(source?.audit?.createUser, 160) || 'SYSTEM',
      createDateTime: cleanText(source?.audit?.createDateTime, 80) || '',
      lastUpdateUser: cleanText(source?.audit?.lastUpdateUser, 160) || 'SYSTEM',
      lastUpdateDateTime: cleanText(source?.audit?.lastUpdateDateTime, 80) || ''
    }
  };
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const output = Array.isArray(base) ? [...base] : { ...(base || {}) };
  Object.entries(patch).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      output[key] = [...value];
      return;
    }
    if (value && typeof value === 'object') {
      output[key] = deepMerge(output[key] && typeof output[key] === 'object' ? output[key] : {}, value);
      return;
    }
    output[key] = value;
  });
  return output;
}

function normalizeTransactionRow(raw = {}, existing = null, options = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const existingRow = existing && typeof existing === 'object' ? existing : null;
  const now = new Date().toISOString();
  const actor = resolveAuditUser(options.actor || source.actor || null);
  const id = cleanText(source.id || source.transactionId || existingRow?.id, 160) || `PKG_TXN_${Date.now()}`;
  const packageId = normalizePackageId(source.packageId || existingRow?.packageId || source?.package?.id || '');
  if (!packageId) throw new Error('packageId is required.');

  const merged = deepMerge(existingRow || {}, source);
  const createUser = cleanText(existingRow?.audit?.createUser || source?.audit?.createUser || actor, 160) || 'SYSTEM';
  const createDateTime = cleanText(existingRow?.audit?.createDateTime || source?.audit?.createDateTime || now, 80) || now;

  return normalizePersistedTransaction({
    ...merged,
    id,
    transactionId: id,
    packageId,
    packageName: cleanText(merged.packageName, 200),
    packageVersion: cleanText(merged.packageVersion || merged.version, 120),
    action: cleanText(merged.action, 80).toLowerCase(),
    status: normalizeStatus(merged.status, existingRow?.status || 'running'),
    phase: cleanText(merged.phase, 80).toLowerCase(),
    startedAt: cleanText(merged.startedAt, 80) || existingRow?.startedAt || now,
    finishedAt: cleanText(merged.finishedAt, 80),
    actor: merged.actor && typeof merged.actor === 'object' ? merged.actor : (existingRow?.actor || {}),
    backendMode: cleanText(merged.backendMode || existingRow?.backendMode, 40).toLowerCase(),
    phases: sanitizeArrayRows(merged.phases).map(normalizePhaseRow),
    entityOperations: sanitizeArrayRows(merged.entityOperations).map(normalizeEntityOperation),
    summaryByEntity: sanitizeSnapshot(merged.summaryByEntity),
    warnings: sanitizeArrayRows(merged.warnings).map((row) => cleanText(row, 1200)).filter(Boolean),
    blockedReasons: sanitizeArrayRows(merged.blockedReasons).map((row) => cleanText(row, 1200)).filter(Boolean),
    modifiedRecords: sanitizeArrayRows(merged.modifiedRecords),
    rollback: sanitizeSnapshot(merged.rollback),
    artifacts: sanitizeSnapshot(merged.artifacts),
    metadata: sanitizeSnapshot(merged.metadata),
    audit: {
      createUser,
      createDateTime,
      lastUpdateUser: actor,
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
        return normalizePersistedTransaction(row);
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function buildQueryFallback() {
  return {
    defaultSearchFields: [
      'id',
      'packageId',
      'packageVersion',
      'action',
      'status',
      'phase'
    ],
    dateFields: [
      'startedAt',
      'finishedAt',
      'audit.createDateTime',
      'audit.lastUpdateDateTime'
    ]
  };
}

async function queryRows(options = {}) {
  const rows = await readAllRows();
  return applyGenericFilter(rows, options?.query || {}, buildQueryFallback());
}

async function getById(id = '') {
  const token = cleanText(id, 160);
  if (!token) return null;
  const rows = await readAllRows();
  return rows.find((row) => cleanText(row?.id, 160) === token) || null;
}

async function upsertById(id = '', patch = {}, options = {}) {
  return queueWrite(async () => {
    const token = cleanText(id || patch?.id || patch?.transactionId, 160);
    if (!token) throw new Error('id is required.');
    const rows = await readAllRows();
    const index = rows.findIndex((row) => cleanText(row?.id, 160) === token);
    const existing = index >= 0 ? rows[index] : null;
    const normalized = normalizeTransactionRow({ ...patch, id: token }, existing, options);
    if (index >= 0) rows[index] = normalized;
    else rows.push(normalized);
    const dataPath = resolveDataPath();
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function createRow(input = {}, options = {}) {
  const id = cleanText(input?.id || input?.transactionId, 160) || `PKG_TXN_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return upsertById(id, { ...input, id }, options);
}

module.exports = {
  resolveDataPath,
  ALLOWED_STATUS,
  normalizePackageId,
  normalizePersistedTransaction,
  normalizeTransactionRow,
  readAllRows,
  queryRows,
  getById,
  upsertById,
  createRow,
  hashPayload
};
