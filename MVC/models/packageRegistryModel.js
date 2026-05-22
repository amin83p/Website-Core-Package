const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');

const DEFAULT_DATA_PATH = path.join(__dirname, '../../data/packageRegistry.json');
const ALLOWED_INSTALL_STATUS = new Set([
  'pending',
  'installed',
  'enabled',
  'disabled',
  'failed',
  'updating'
]);

function resolveDataPath() {
  const overridePath = String(process.env.PACKAGE_REGISTRY_DATA_PATH || '').trim();
  return overridePath ? path.resolve(overridePath) : DEFAULT_DATA_PATH;
}

function cleanText(value, max = 2000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizePackageId(value = '') {
  return cleanText(value, 80).toLowerCase();
}

function assertValidPackageId(value = '', label = 'packageId') {
  const token = normalizePackageId(value);
  if (!token) throw new Error(`${label} is required.`);
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(token)) {
    throw new Error(`${label} is invalid. Use lowercase letters, digits, and dashes.`);
  }
  return token;
}

function normalizeVersion(value = '') {
  const token = cleanText(value, 120);
  return token || '';
}

function normalizeInstallStatus(value = '', fallback = 'installed') {
  const token = cleanText(value, 80).toLowerCase();
  if (!token) return fallback;
  return ALLOWED_INSTALL_STATUS.has(token) ? token : fallback;
}

function resolveAuditUser(actor = null) {
  if (!actor) return 'SYSTEM';
  if (typeof actor === 'object') {
    return cleanText(actor.id || actor.username || actor.email || '', 160) || 'SYSTEM';
  }
  return cleanText(actor, 160) || 'SYSTEM';
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

function normalizePersistedPackageRegistryRow(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const packageId = assertValidPackageId(
    source.packageId || source.id || '',
    'packageId'
  );
  return {
    ...source,
    id: packageId,
    packageId,
    version: normalizeVersion(source.version),
    enabled: source.enabled === true,
    installStatus: normalizeInstallStatus(source.installStatus, 'installed'),
    installedAt: cleanText(source.installedAt, 80),
    updatedAt: cleanText(source.updatedAt, 80),
    lastError: cleanText(source.lastError, 4000),
    lastWarning: cleanText(source.lastWarning, 2000),
    metadata: normalizeMetadata(source.metadata),
    audit: {
      createUser: cleanText(source?.audit?.createUser, 160) || 'SYSTEM',
      createDateTime: cleanText(source?.audit?.createDateTime, 80) || '',
      lastUpdateUser: cleanText(source?.audit?.lastUpdateUser, 160) || 'SYSTEM',
      lastUpdateDateTime: cleanText(source?.audit?.lastUpdateDateTime, 80) || ''
    }
  };
}

function normalizePackageRegistryRow(raw = {}, existing = null, options = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const now = new Date().toISOString();
  const actor = resolveAuditUser(options.actor || source.actor || null);
  const existingRow = existing && typeof existing === 'object' ? existing : null;
  const packageId = assertValidPackageId(
    source.packageId || source.id || existingRow?.packageId || existingRow?.id || '',
    'packageId'
  );

  const installedAt = cleanText(
    source.installedAt || existingRow?.installedAt || '',
    80
  ) || now;
  const updatedAt = now;

  const next = {
    ...(existingRow || {}),
    ...source,
    id: packageId,
    packageId,
    version: normalizeVersion(source.version !== undefined ? source.version : existingRow?.version),
    enabled: source.enabled !== undefined ? Boolean(source.enabled) : (existingRow?.enabled === true),
    installStatus: normalizeInstallStatus(
      source.installStatus !== undefined ? source.installStatus : existingRow?.installStatus,
      existingRow?.installStatus || 'installed'
    ),
    installedAt,
    updatedAt,
    lastError: cleanText(source.lastError !== undefined ? source.lastError : existingRow?.lastError, 4000),
    lastWarning: cleanText(source.lastWarning !== undefined ? source.lastWarning : existingRow?.lastWarning, 2000),
    metadata: normalizeMetadata(source.metadata !== undefined ? source.metadata : existingRow?.metadata),
    audit: {
      ...(existingRow?.audit || {}),
      ...(source.audit && typeof source.audit === 'object' ? source.audit : {}),
      createUser: cleanText(existingRow?.audit?.createUser || source?.audit?.createUser || actor, 160) || 'SYSTEM',
      createDateTime: cleanText(existingRow?.audit?.createDateTime || source?.audit?.createDateTime || now, 80) || now,
      lastUpdateUser: actor,
      lastUpdateDateTime: now
    }
  };

  return next;
}

async function readAllPackageRegistryRows() {
  const dataPath = resolveDataPath();
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    const cleaned = String(data || '').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        try {
          return normalizePersistedPackageRegistryRow(row);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function buildRegistryQueryFallback() {
  return {
    defaultSearchFields: [
      'id',
      'packageId',
      'version',
      'installStatus',
      'lastError',
      'lastWarning'
    ],
    dateFields: [
      'installedAt',
      'updatedAt',
      'audit.createDateTime',
      'audit.lastUpdateDateTime'
    ]
  };
}

async function queryPackageRegistryRows(options = {}) {
  const rows = await readAllPackageRegistryRows();
  const query = options?.query || {};
  return applyGenericFilter(rows, query, buildRegistryQueryFallback());
}

async function getPackageRegistryByPackageId(packageId = '') {
  const token = normalizePackageId(packageId);
  if (!token) return null;
  const rows = await readAllPackageRegistryRows();
  return rows.find((row) => normalizePackageId(row?.packageId || row?.id) === token) || null;
}

async function upsertPackageRegistry(input = {}, options = {}) {
  return queueWrite(async () => {
    const rows = await readAllPackageRegistryRows();
    const packageId = assertValidPackageId(input.packageId || input.id || '', 'packageId');
    const index = rows.findIndex((row) => normalizePackageId(row?.packageId || row?.id) === packageId);
    const existing = index >= 0 ? rows[index] : null;
    const normalized = normalizePackageRegistryRow(
      { ...input, packageId },
      existing,
      { actor: options?.actor || input?.actor || null }
    );

    if (index >= 0) rows[index] = normalized;
    else rows.push(normalized);

    const dataPath = resolveDataPath();
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function removePackageRegistryByPackageId(packageId = '') {
  return queueWrite(async () => {
    const token = normalizePackageId(packageId);
    if (!token) return false;
    const rows = await readAllPackageRegistryRows();
    const nextRows = rows.filter((row) => normalizePackageId(row?.packageId || row?.id) !== token);
    if (nextRows.length === rows.length) return false;

    const dataPath = resolveDataPath();
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(dataPath, JSON.stringify(nextRows, null, 2));
    return true;
  });
}

module.exports = {
  resolveDataPath,
  ALLOWED_INSTALL_STATUS,
  normalizePackageId,
  normalizeInstallStatus,
  normalizePersistedPackageRegistryRow,
  normalizePackageRegistryRow,
  readAllPackageRegistryRows,
  queryPackageRegistryRows,
  getPackageRegistryByPackageId,
  upsertPackageRegistry,
  removePackageRegistryByPackageId
};
