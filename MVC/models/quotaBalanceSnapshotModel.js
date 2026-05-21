const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { idsEqual, toPublicId } = require('../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../data/quotaBalanceSnapshots.json');
const METRIC_FIELDS = Object.freeze(['call', 'amount', 'token', 'volume']);

if (!fsSync.existsSync(path.dirname(DATA_PATH))) {
  fsSync.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}
if (!fsSync.existsSync(DATA_PATH)) {
  fsSync.writeFileSync(DATA_PATH, '[]');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 240, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function cleanId(value, { max = 120, allowEmpty = true } = {}) {
  const text = cleanString(value, { max, allowEmpty });
  if (text === null) return null;
  if (!text) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9_.:-]+$/.test(text)) throw new Error('Invalid id format.');
  return text;
}

function cleanIsoDateTime(value, { allowEmpty = false } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid datetime value.');
  return date.toISOString();
}

function cleanDateOnly(value, { allowEmpty = true } = {}) {
  const token = cleanString(value, { max: 20, allowEmpty: true });
  if (!token) return allowEmpty ? '' : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) throw new Error('Date values must use YYYY-MM-DD format.');
  return token;
}

function cleanMetricValue(value) {
  if (value === undefined || value === null || value === '') return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error('Metric value must be numeric.');
  return Number(numeric.toFixed(6));
}

function sanitizeMetrics(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const out = {};
  METRIC_FIELDS.forEach((field) => {
    out[field] = cleanMetricValue(source[field]);
  });
  return out;
}

function sanitizeAudit(raw = {}, { existing = null } = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const existingAudit = isPlainObject(existing) ? existing : {};
  const nowIso = new Date().toISOString();
  return {
    createUser: cleanString(existingAudit.createUser || input.createUser, { max: 120, allowEmpty: true }) || 'System',
    createDateTime: cleanIsoDateTime(existingAudit.createDateTime || input.createDateTime, { allowEmpty: true }) || nowIso,
    lastUpdateUser: cleanString(input.lastUpdateUser, { max: 120, allowEmpty: true })
      || cleanString(existingAudit.lastUpdateUser, { max: 120, allowEmpty: true })
      || cleanString(existingAudit.createUser, { max: 120, allowEmpty: true })
      || 'System',
    lastUpdateDateTime: cleanIsoDateTime(input.lastUpdateDateTime, { allowEmpty: true }) || nowIso
  };
}

function sanitizeSnapshot(input, { isUpdate = false, existing = null } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid quota balance snapshot payload.');

  const orgId = cleanId(input.orgId || existing?.orgId, { max: 120, allowEmpty: false });
  const userId = cleanId(input.userId || existing?.userId, { max: 120, allowEmpty: false });
  const section = cleanString(input.section || existing?.section, { max: 120, allowEmpty: false });
  const operation = cleanString(input.operation || existing?.operation, { max: 120, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');
  if (!userId) throw new Error('userId is required.');
  if (!section) throw new Error('section is required.');
  if (!operation) throw new Error('operation is required.');

  const metrics = sanitizeMetrics(
    isPlainObject(input.metrics)
      ? input.metrics
      : {
        call: input.call,
        amount: input.amount,
        token: input.token,
        volume: input.volume
      }
  );
  const versionRaw = Number.parseInt(String(input.version ?? existing?.version ?? 1), 10);
  const version = Number.isFinite(versionRaw) && versionRaw > 0 ? versionRaw : 1;
  const audit = sanitizeAudit(input.audit, { existing: existing?.audit || null });

  const out = {
    orgId,
    userId,
    section,
    operation,
    metrics,
    version,
    lastEvaluatedDate: cleanDateOnly(input.lastEvaluatedDate || existing?.lastEvaluatedDate, { allowEmpty: true }) || '',
    lastReconciledAt: cleanIsoDateTime(input.lastReconciledAt || existing?.lastReconciledAt, { allowEmpty: true }) || '',
    dateTime: cleanIsoDateTime(input.dateTime || existing?.dateTime, { allowEmpty: true }) || new Date().toISOString(),
    audit
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 64, allowEmpty: false });
  }

  if (isUpdate && existing && isPlainObject(existing.audit)) {
    out.audit.createUser = cleanString(existing.audit.createUser, { max: 120, allowEmpty: true }) || out.audit.createUser;
    out.audit.createDateTime = cleanIsoDateTime(existing.audit.createDateTime, { allowEmpty: true }) || out.audit.createDateTime;
  }

  return out;
}

function buildDateToken(isoDateTime) {
  const base = String(isoDateTime || new Date().toISOString()).slice(0, 10);
  return base.replace(/-/g, '');
}

function generateSnapshotId(existingIds, isoDateTime) {
  const ids = existingIds instanceof Set ? existingIds : new Set();
  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `AQS${dateToken}${suffix}`;
    if (!ids.has(candidate)) return candidate;
  }
  return `AQS${Date.now()}`;
}

function buildKey(orgId = '', userId = '', section = '', operation = '') {
  return [
    toPublicId(orgId) || '',
    toPublicId(userId) || '',
    cleanString(section, { max: 120, allowEmpty: true }) || '',
    cleanString(operation, { max: 120, allowEmpty: true }) || ''
  ].join('::');
}

async function getAllSnapshots() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve quota balance snapshots.');
  }
}

async function getSnapshotById(id) {
  const rows = await getAllSnapshots();
  return rows.find((item) => idsEqual(item?.id, id)) || null;
}

async function getSnapshotByKey(orgId, userId, section, operation) {
  const key = buildKey(orgId, userId, section, operation);
  if (!key || key === '::::') return null;
  const rows = await getAllSnapshots();
  return rows.find((item) => buildKey(item?.orgId, item?.userId, item?.section, item?.operation) === key) || null;
}

async function addSnapshot(payload) {
  return queueWrite(async () => {
    const rows = await getAllSnapshots();
    const sanitized = sanitizeSnapshot(payload, { isUpdate: false });
    const key = buildKey(sanitized.orgId, sanitized.userId, sanitized.section, sanitized.operation);
    const duplicateKey = rows.find((item) => buildKey(item?.orgId, item?.userId, item?.section, item?.operation) === key);
    if (duplicateKey) throw new Error('Quota balance snapshot already exists for this key.');
    const existingIds = new Set(rows.map((item) => String(item?.id || '').trim()).filter(Boolean));
    const id = sanitized.id || generateSnapshotId(existingIds, sanitized.dateTime);
    if (existingIds.has(id)) throw new Error('Quota balance snapshot id already exists.');
    sanitized.id = id;
    rows.push(sanitized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return sanitized;
  });
}

async function updateSnapshot(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllSnapshots();
    const index = rows.findIndex((item) => idsEqual(item?.id, id));
    if (index < 0) throw new Error('Quota balance snapshot not found.');
    const existing = rows[index];
    const sanitized = sanitizeSnapshot(
      { ...existing, ...(isPlainObject(payload) ? payload : {}), id: existing.id },
      { isUpdate: true, existing }
    );
    const key = buildKey(sanitized.orgId, sanitized.userId, sanitized.section, sanitized.operation);
    const duplicateKey = rows.find((item, rowIndex) => {
      if (rowIndex === index) return false;
      return buildKey(item?.orgId, item?.userId, item?.section, item?.operation) === key;
    });
    if (duplicateKey) throw new Error('Quota balance snapshot already exists for this key.');
    rows[index] = { ...existing, ...sanitized, id: existing.id };
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function updateSnapshotWithVersion(id, expectedVersion, patch = {}) {
  return queueWrite(async () => {
    const rows = await getAllSnapshots();
    const index = rows.findIndex((item) => idsEqual(item?.id, id));
    if (index < 0) return null;
    const existing = rows[index];
    const currentVersion = Number.parseInt(String(existing?.version || 1), 10) || 1;
    if (currentVersion !== Number(expectedVersion)) return null;
    const merged = {
      ...existing,
      ...(isPlainObject(patch) ? patch : {}),
      id: existing.id,
      version: currentVersion + 1
    };
    const sanitized = sanitizeSnapshot(merged, { isUpdate: true, existing });
    rows[index] = { ...existing, ...sanitized, id: existing.id, version: currentVersion + 1 };
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteSnapshot(id) {
  return queueWrite(async () => {
    const rows = await getAllSnapshots();
    const filtered = rows.filter((item) => !idsEqual(item?.id, id));
    if (filtered.length === rows.length) return false;
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

async function clearByOrg(orgId) {
  return queueWrite(async () => {
    const targetOrgId = toPublicId(orgId);
    if (!targetOrgId) throw new Error('orgId is required to clear quota balance snapshots.');
    const rows = await getAllSnapshots();
    const filtered = rows.filter((item) => !idsEqual(item?.orgId, targetOrgId));
    const removed = rows.length - filtered.length;
    if (!removed) return { removed: 0, remaining: rows.length };
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return { removed, remaining: filtered.length };
  });
}

async function clearAllSnapshots() {
  return queueWrite(async () => {
    const rows = await getAllSnapshots();
    await fs.writeFile(DATA_PATH, JSON.stringify([], null, 2));
    return { removed: rows.length, remaining: 0 };
  });
}

module.exports = {
  METRIC_FIELDS,
  sanitizeSnapshot,
  getAllSnapshots,
  getSnapshotById,
  getSnapshotByKey,
  addSnapshot,
  updateSnapshot,
  updateSnapshotWithVersion,
  deleteSnapshot,
  clearByOrg,
  clearAllSnapshots
};
