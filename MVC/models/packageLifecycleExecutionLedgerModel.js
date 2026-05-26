const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');

const DEFAULT_DATA_PATH = path.join(__dirname, '../../data/packageLifecycleExecutionLedger.json');
const ALLOWED_STATUS = new Set(['running', 'success', 'failed', 'skipped']);
const ALLOWED_STEP_TYPES = new Set(['migration', 'seeder']);
const ALLOWED_DIRECTIONS = new Set(['up', 'down', 'run', 'revert']);

function resolveDataPath() {
  const overridePath = String(process.env.PACKAGE_LIFECYCLE_EXECUTION_LEDGER_DATA_PATH || '').trim();
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

function sanitizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sanitizeArray(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === 'object') : [];
}

function normalizeStatus(value = '', fallback = 'running') {
  const token = cleanText(value, 40).toLowerCase();
  if (!token) return fallback;
  return ALLOWED_STATUS.has(token) ? token : fallback;
}

function normalizeStepType(value = '', fallback = 'migration') {
  const token = cleanText(value, 40).toLowerCase();
  if (!token) return fallback;
  return ALLOWED_STEP_TYPES.has(token) ? token : fallback;
}

function normalizeDirection(value = '', fallback = 'up') {
  const token = cleanText(value, 40).toLowerCase();
  if (!token) return fallback;
  return ALLOWED_DIRECTIONS.has(token) ? token : fallback;
}

function resolveAuditUser(actor = null) {
  if (!actor) return 'SYSTEM';
  if (typeof actor === 'object') {
    return cleanText(actor.id || actor.username || actor.email || '', 160) || 'SYSTEM';
  }
  return cleanText(actor, 160) || 'SYSTEM';
}

function normalizeOwnershipRecord(row = {}) {
  const source = sanitizeObject(row);
  return {
    entityType: cleanText(source.entityType, 80).toLowerCase(),
    identityKey: cleanText(source.identityKey, 400),
    packageId: normalizePackageId(source.packageId || ''),
    packageVersion: cleanText(source.packageVersion, 120),
    baselineHash: cleanText(source.baselineHash, 120),
    baselineSnapshot: source.baselineSnapshot === undefined ? null : source.baselineSnapshot,
    metadata: sanitizeObject(source.metadata)
  };
}

function normalizePersistedLedgerRow(raw = {}) {
  const source = sanitizeObject(raw);
  const id = cleanText(source.id || source.ledgerId, 180);
  if (!id) throw new Error('Execution ledger id is required.');
  const packageId = normalizePackageId(source.packageId);
  if (!packageId) throw new Error('Execution ledger packageId is required.');
  const stepId = cleanText(source.stepId, 200);
  if (!stepId) throw new Error('Execution ledger stepId is required.');

  return {
    id,
    ledgerId: id,
    packageId,
    packageVersion: cleanText(source.packageVersion, 120),
    stepId,
    stepType: normalizeStepType(source.stepType, 'migration'),
    direction: normalizeDirection(source.direction, 'up'),
    backendMode: cleanText(source.backendMode, 40).toLowerCase(),
    scriptPath: cleanText(source.scriptPath, 1800),
    scriptChecksum: cleanText(source.scriptChecksum, 200),
    manifestChecksum: cleanText(source.manifestChecksum, 200),
    status: normalizeStatus(source.status, 'running'),
    startedAt: cleanText(source.startedAt, 80),
    finishedAt: cleanText(source.finishedAt, 80),
    error: cleanText(source.error, 4000),
    transactionId: cleanText(source.transactionId, 180),
    artifacts: sanitizeObject(source.artifacts),
    ownershipRecords: sanitizeArray(source.ownershipRecords).map(normalizeOwnershipRecord),
    metadata: sanitizeObject(source.metadata),
    audit: {
      createUser: cleanText(source?.audit?.createUser, 160) || 'SYSTEM',
      createDateTime: cleanText(source?.audit?.createDateTime, 80) || '',
      lastUpdateUser: cleanText(source?.audit?.lastUpdateUser, 160) || 'SYSTEM',
      lastUpdateDateTime: cleanText(source?.audit?.lastUpdateDateTime, 80) || ''
    }
  };
}

function normalizeLedgerRow(raw = {}, existing = null, options = {}) {
  const source = sanitizeObject(raw);
  const existingRow = sanitizeObject(existing);
  const now = new Date().toISOString();
  const actor = resolveAuditUser(options.actor || source.actor || null);
  const id = cleanText(source.id || source.ledgerId || existingRow.id, 180) || `PKG_EXEC_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const packageId = normalizePackageId(source.packageId || existingRow.packageId || '');
  if (!packageId) throw new Error('packageId is required.');
  const stepId = cleanText(source.stepId || existingRow.stepId, 200);
  if (!stepId) throw new Error('stepId is required.');

  return normalizePersistedLedgerRow({
    ...existingRow,
    ...source,
    id,
    ledgerId: id,
    packageId,
    packageVersion: cleanText(source.packageVersion !== undefined ? source.packageVersion : existingRow.packageVersion, 120),
    stepId,
    stepType: normalizeStepType(source.stepType !== undefined ? source.stepType : existingRow.stepType, 'migration'),
    direction: normalizeDirection(source.direction !== undefined ? source.direction : existingRow.direction, 'up'),
    backendMode: cleanText(source.backendMode !== undefined ? source.backendMode : existingRow.backendMode, 40).toLowerCase(),
    scriptPath: cleanText(source.scriptPath !== undefined ? source.scriptPath : existingRow.scriptPath, 1800),
    scriptChecksum: cleanText(source.scriptChecksum !== undefined ? source.scriptChecksum : existingRow.scriptChecksum, 200),
    manifestChecksum: cleanText(source.manifestChecksum !== undefined ? source.manifestChecksum : existingRow.manifestChecksum, 200),
    status: normalizeStatus(source.status !== undefined ? source.status : existingRow.status, existingRow.status || 'running'),
    startedAt: cleanText(source.startedAt !== undefined ? source.startedAt : existingRow.startedAt, 80) || now,
    finishedAt: cleanText(source.finishedAt !== undefined ? source.finishedAt : existingRow.finishedAt, 80),
    error: cleanText(source.error !== undefined ? source.error : existingRow.error, 4000),
    transactionId: cleanText(source.transactionId !== undefined ? source.transactionId : existingRow.transactionId, 180),
    artifacts: source.artifacts !== undefined ? sanitizeObject(source.artifacts) : sanitizeObject(existingRow.artifacts),
    ownershipRecords: source.ownershipRecords !== undefined
      ? sanitizeArray(source.ownershipRecords).map(normalizeOwnershipRecord)
      : sanitizeArray(existingRow.ownershipRecords).map(normalizeOwnershipRecord),
    metadata: source.metadata !== undefined ? sanitizeObject(source.metadata) : sanitizeObject(existingRow.metadata),
    audit: {
      ...(sanitizeObject(existingRow.audit)),
      ...(sanitizeObject(source.audit)),
      createUser: cleanText(existingRow?.audit?.createUser || source?.audit?.createUser || actor, 160) || 'SYSTEM',
      createDateTime: cleanText(existingRow?.audit?.createDateTime || source?.audit?.createDateTime || now, 80) || now,
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
        return normalizePersistedLedgerRow(row);
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
      'stepId',
      'stepType',
      'direction',
      'status',
      'error'
    ],
    dateFields: ['startedAt', 'finishedAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
  };
}

async function queryRows(options = {}) {
  const rows = await readAllRows();
  return applyGenericFilter(rows, options?.query || {}, buildQueryFallback());
}

async function getById(id = '') {
  const token = cleanText(id, 180);
  if (!token) return null;
  const rows = await readAllRows();
  return rows.find((row) => cleanText(row?.id, 180) === token) || null;
}

async function upsertById(id = '', patch = {}, options = {}) {
  return queueWrite(async () => {
    const token = cleanText(id || patch?.id || patch?.ledgerId, 180);
    if (!token) throw new Error('id is required.');
    const rows = await readAllRows();
    const index = rows.findIndex((row) => cleanText(row?.id, 180) === token);
    const existing = index >= 0 ? rows[index] : null;
    const normalized = normalizeLedgerRow({ ...patch, id: token, ledgerId: token }, existing, options);
    if (index >= 0) rows[index] = normalized;
    else rows.push(normalized);
    const dataPath = resolveDataPath();
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function createRow(input = {}, options = {}) {
  const id = cleanText(input?.id || input?.ledgerId, 180) || `PKG_EXEC_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return upsertById(id, { ...input, id, ledgerId: id }, options);
}

module.exports = {
  resolveDataPath,
  normalizePackageId,
  normalizePersistedLedgerRow,
  normalizeLedgerRow,
  readAllRows,
  queryRows,
  getById,
  upsertById,
  createRow
};
