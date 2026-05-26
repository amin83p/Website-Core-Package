const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');

const DEFAULT_DATA_PATH = path.join(__dirname, '../../data/packageDataOwnershipRegistry.json');

function resolveDataPath() {
  const overridePath = String(process.env.PACKAGE_DATA_OWNERSHIP_DATA_PATH || '').trim();
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

function normalizeOwnershipIdentity(entityType = '', identityKey = '') {
  return `${cleanText(entityType, 80).toLowerCase()}::${cleanText(identityKey, 400)}`;
}

function resolveAuditUser(actor = null) {
  if (!actor) return 'SYSTEM';
  if (typeof actor === 'object') {
    return cleanText(actor.id || actor.username || actor.email || '', 160) || 'SYSTEM';
  }
  return cleanText(actor, 160) || 'SYSTEM';
}

function normalizePersistedOwnershipRow(raw = {}) {
  const source = sanitizeObject(raw);
  const entityType = cleanText(source.entityType, 80).toLowerCase();
  const identityKey = cleanText(source.identityKey, 400);
  if (!entityType || !identityKey) throw new Error('Ownership row requires entityType and identityKey.');
  const id = cleanText(source.id || source.ownershipId, 500) || normalizeOwnershipIdentity(entityType, identityKey);
  return {
    id,
    ownershipId: id,
    entityType,
    identityKey,
    packageId: normalizePackageId(source.packageId),
    packageVersion: cleanText(source.packageVersion, 120),
    backendMode: cleanText(source.backendMode, 40).toLowerCase(),
    baselineHash: cleanText(source.baselineHash, 120),
    baselineSnapshot: source.baselineSnapshot === undefined ? null : source.baselineSnapshot,
    metadata: sanitizeObject(source.metadata),
    updatedAt: cleanText(source.updatedAt, 80),
    audit: {
      createUser: cleanText(source?.audit?.createUser, 160) || 'SYSTEM',
      createDateTime: cleanText(source?.audit?.createDateTime, 80) || '',
      lastUpdateUser: cleanText(source?.audit?.lastUpdateUser, 160) || 'SYSTEM',
      lastUpdateDateTime: cleanText(source?.audit?.lastUpdateDateTime, 80) || ''
    }
  };
}

function normalizeOwnershipRow(raw = {}, existing = null, options = {}) {
  const source = sanitizeObject(raw);
  const existingRow = sanitizeObject(existing);
  const now = new Date().toISOString();
  const actor = resolveAuditUser(options.actor || source.actor || null);
  const entityType = cleanText(source.entityType || existingRow.entityType, 80).toLowerCase();
  const identityKey = cleanText(source.identityKey || existingRow.identityKey, 400);
  if (!entityType || !identityKey) throw new Error('entityType and identityKey are required.');
  const id = cleanText(source.id || source.ownershipId || existingRow.id, 500) || normalizeOwnershipIdentity(entityType, identityKey);
  return normalizePersistedOwnershipRow({
    ...existingRow,
    ...source,
    id,
    ownershipId: id,
    entityType,
    identityKey,
    packageId: normalizePackageId(source.packageId !== undefined ? source.packageId : existingRow.packageId),
    packageVersion: cleanText(source.packageVersion !== undefined ? source.packageVersion : existingRow.packageVersion, 120),
    backendMode: cleanText(source.backendMode !== undefined ? source.backendMode : existingRow.backendMode, 40).toLowerCase(),
    baselineHash: cleanText(source.baselineHash !== undefined ? source.baselineHash : existingRow.baselineHash, 120),
    baselineSnapshot: source.baselineSnapshot !== undefined ? source.baselineSnapshot : existingRow.baselineSnapshot,
    metadata: source.metadata !== undefined ? sanitizeObject(source.metadata) : sanitizeObject(existingRow.metadata),
    updatedAt: now,
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
        return normalizePersistedOwnershipRow(row);
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
    defaultSearchFields: ['id', 'entityType', 'identityKey', 'packageId', 'packageVersion'],
    dateFields: ['updatedAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
  };
}

async function queryRows(options = {}) {
  const rows = await readAllRows();
  return applyGenericFilter(rows, options?.query || {}, buildQueryFallback());
}

async function getById(id = '') {
  const token = cleanText(id, 500);
  if (!token) return null;
  const rows = await readAllRows();
  return rows.find((row) => cleanText(row?.id, 500) === token) || null;
}

async function upsertByIdentity(entityType = '', identityKey = '', patch = {}, options = {}) {
  return queueWrite(async () => {
    const normalizedId = normalizeOwnershipIdentity(entityType, identityKey);
    if (!normalizedId || normalizedId === '::') throw new Error('entityType and identityKey are required.');
    const rows = await readAllRows();
    const index = rows.findIndex((row) => cleanText(row?.id, 500) === normalizedId);
    const existing = index >= 0 ? rows[index] : null;
    const normalized = normalizeOwnershipRow(
      {
        ...patch,
        id: normalizedId,
        ownershipId: normalizedId,
        entityType,
        identityKey
      },
      existing,
      options
    );
    if (index >= 0) rows[index] = normalized;
    else rows.push(normalized);
    const dataPath = resolveDataPath();
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

module.exports = {
  resolveDataPath,
  normalizePackageId,
  normalizeOwnershipIdentity,
  normalizePersistedOwnershipRow,
  normalizeOwnershipRow,
  readAllRows,
  queryRows,
  getById,
  upsertByIdentity
};
