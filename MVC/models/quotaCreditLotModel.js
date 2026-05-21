const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { idsEqual, toPublicId } = require('../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../data/quotaCreditLots.json');
const METRIC_FIELDS = Object.freeze(['call', 'amount', 'token', 'volume']);
const LOT_STATUSES = new Set(['active', 'exhausted', 'expired', 'void']);

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    throw new Error('Date values must use YYYY-MM-DD format.');
  }
  return token;
}

function cleanMetricValue(value, { min = 0 } = {}) {
  if (value === undefined || value === null || value === '') return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error('Metric value must be numeric.');
  if (numeric < min) throw new Error('Metric value is below allowed range.');
  return Number(numeric.toFixed(6));
}

function normalizeTimezoneToken(value, fallback = 'UTC') {
  const token = cleanString(value, { max: 80, allowEmpty: true }) || fallback;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: token });
    return token;
  } catch (_) {
    return fallback;
  }
}

function sanitizeValidity(value = {}) {
  const input = isPlainObject(value) ? value : {};
  const mode = cleanString(input.mode, { max: 30, allowEmpty: true }).toLowerCase();
  const startDate = cleanDateOnly(input.startDate, { allowEmpty: true }) || '';
  const endDate = cleanDateOnly(input.endDate, { allowEmpty: true }) || '';
  const timezone = normalizeTimezoneToken(input.timezone, 'UTC');

  const hasWindow = mode === 'date_range' || startDate || endDate;
  if (!hasWindow) {
    return {
      mode: 'none',
      startDate: '',
      endDate: '',
      timezone
    };
  }
  if (!startDate || !endDate) {
    throw new Error('validity.startDate and validity.endDate are required when validity window is enabled.');
  }
  if (endDate < startDate) {
    throw new Error('validity.endDate must be the same day or after validity.startDate.');
  }
  return {
    mode: 'date_range',
    startDate,
    endDate,
    timezone
  };
}

function sanitizeMetrics(input = {}, { allowZero = true } = {}) {
  const source = isPlainObject(input) ? input : {};
  const out = {};
  METRIC_FIELDS.forEach((field) => {
    out[field] = cleanMetricValue(source[field], { min: 0 });
  });
  if (!allowZero) {
    const hasPositive = METRIC_FIELDS.some((field) => Number(out[field] || 0) > 0);
    if (!hasPositive) {
      throw new Error('Lot metrics require at least one positive value.');
    }
  }
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

function deriveStatus(inputStatus = '', remaining = {}) {
  const requested = cleanString(inputStatus, { max: 40, allowEmpty: true }).toLowerCase();
  if (LOT_STATUSES.has(requested)) return requested;
  const hasRemaining = METRIC_FIELDS.some((field) => Number(remaining[field] || 0) > 0);
  return hasRemaining ? 'active' : 'exhausted';
}

function sanitizeLot(input, { isUpdate = false, existing = null } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid quota credit lot payload.');

  const orgId = cleanId(input.orgId || existing?.orgId, { max: 120, allowEmpty: false });
  const userId = cleanId(input.userId || existing?.userId, { max: 120, allowEmpty: false });
  const section = cleanString(input.section || existing?.section, { max: 120, allowEmpty: false });
  const operation = cleanString(input.operation || existing?.operation, { max: 120, allowEmpty: false });
  const creditEntryId = cleanId(input.creditEntryId || existing?.creditEntryId, { max: 120, allowEmpty: false });

  if (!orgId) throw new Error('orgId is required.');
  if (!userId) throw new Error('userId is required.');
  if (!section) throw new Error('section is required.');
  if (!operation) throw new Error('operation is required.');
  if (!creditEntryId) throw new Error('creditEntryId is required.');

  const metrics = sanitizeMetrics(
    isPlainObject(input.metrics) ? input.metrics : input,
    { allowZero: false }
  );
  const remaining = sanitizeMetrics(
    isPlainObject(input.remaining) ? input.remaining : {
      call: input.remainingCall,
      amount: input.remainingAmount,
      token: input.remainingToken,
      volume: input.remainingVolume
    },
    { allowZero: true }
  );

  const status = deriveStatus(input.status || existing?.status, remaining);
  const versionRaw = Number.parseInt(String(input.version ?? existing?.version ?? 1), 10);
  const version = Number.isFinite(versionRaw) && versionRaw > 0 ? versionRaw : 1;
  const audit = sanitizeAudit(input.audit, { existing: existing?.audit || null });

  const out = {
    orgId,
    userId,
    section,
    operation,
    creditEntryId,
    creditDateTime: cleanIsoDateTime(input.creditDateTime || existing?.creditDateTime || input.dateTime, { allowEmpty: true })
      || cleanIsoDateTime(input.dateTime || existing?.dateTime, { allowEmpty: true })
      || new Date().toISOString(),
    dateTime: cleanIsoDateTime(input.dateTime || existing?.dateTime, { allowEmpty: true }) || new Date().toISOString(),
    metrics,
    remaining,
    validity: sanitizeValidity(input.validity || existing?.validity || {}),
    status,
    source: {
      module: cleanString(input?.source?.module || existing?.source?.module, { max: 80, allowEmpty: true }) || 'activity_quota',
      eventType: cleanString(input?.source?.eventType || existing?.source?.eventType, { max: 80, allowEmpty: true }) || 'credit',
      eventId: cleanString(input?.source?.eventId || existing?.source?.eventId, { max: 180, allowEmpty: true }) || creditEntryId,
      idempotencyKey: cleanString(input?.source?.idempotencyKey || existing?.source?.idempotencyKey, { max: 220, allowEmpty: true }) || ''
    },
    lastEvaluatedDate: cleanDateOnly(input.lastEvaluatedDate || existing?.lastEvaluatedDate, { allowEmpty: true }) || '',
    version,
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

function generateLotId(existingIds, isoDateTime) {
  const ids = existingIds instanceof Set ? existingIds : new Set();
  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `AQLT${dateToken}${suffix}`;
    if (!ids.has(candidate)) return candidate;
  }
  return `AQLT${Date.now()}`;
}

async function getAllLots() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve quota credit lots.');
  }
}

async function getLotById(id) {
  const rows = await getAllLots();
  return rows.find((item) => idsEqual(item?.id, id)) || null;
}

async function addLot(payload) {
  return queueWrite(async () => {
    const rows = await getAllLots();
    const sanitized = sanitizeLot(payload, { isUpdate: false });
    const existingIds = new Set(rows.map((item) => String(item?.id || '').trim()).filter(Boolean));
    const id = sanitized.id || generateLotId(existingIds, sanitized.dateTime);
    if (existingIds.has(id)) throw new Error('Quota credit lot id already exists.');
    sanitized.id = id;
    rows.push(sanitized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return sanitized;
  });
}

async function addLots(items) {
  return queueWrite(async () => {
    const incoming = Array.isArray(items) ? items : [items];
    if (!incoming.length) throw new Error('At least one lot payload is required.');
    const rows = await getAllLots();
    const existingIds = new Set(rows.map((item) => String(item?.id || '').trim()).filter(Boolean));
    const created = [];
    for (const input of incoming) {
      const sanitized = sanitizeLot(input, { isUpdate: false });
      const id = sanitized.id || generateLotId(existingIds, sanitized.dateTime);
      if (existingIds.has(id)) throw new Error('Quota credit lot id already exists.');
      sanitized.id = id;
      existingIds.add(id);
      created.push(sanitized);
    }
    rows.push(...created);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return created;
  });
}

async function updateLot(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllLots();
    const index = rows.findIndex((item) => idsEqual(item?.id, id));
    if (index < 0) throw new Error('Quota credit lot not found.');
    const existing = rows[index];
    const sanitized = sanitizeLot(
      { ...existing, ...(isPlainObject(payload) ? payload : {}), id: existing.id },
      { isUpdate: true, existing }
    );
    rows[index] = { ...existing, ...sanitized, id: existing.id };
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function updateLotWithVersion(id, expectedVersion, patch = {}) {
  return queueWrite(async () => {
    const rows = await getAllLots();
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
    const sanitized = sanitizeLot(merged, { isUpdate: true, existing });
    rows[index] = { ...existing, ...sanitized, id: existing.id, version: currentVersion + 1 };
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteLot(id) {
  return queueWrite(async () => {
    const rows = await getAllLots();
    const filtered = rows.filter((item) => !idsEqual(item?.id, id));
    if (filtered.length === rows.length) return false;
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

async function clearByOrg(orgId) {
  return queueWrite(async () => {
    const targetOrgId = toPublicId(orgId);
    if (!targetOrgId) throw new Error('orgId is required to clear quota credit lots.');
    const rows = await getAllLots();
    const filtered = rows.filter((item) => !idsEqual(item?.orgId, targetOrgId));
    const removed = rows.length - filtered.length;
    if (!removed) return { removed: 0, remaining: rows.length };
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return { removed, remaining: filtered.length };
  });
}

async function clearAllLots() {
  return queueWrite(async () => {
    const rows = await getAllLots();
    await fs.writeFile(DATA_PATH, JSON.stringify([], null, 2));
    return { removed: rows.length, remaining: 0 };
  });
}

module.exports = {
  METRIC_FIELDS,
  LOT_STATUSES: Object.freeze(Array.from(LOT_STATUSES)),
  sanitizeLot,
  getAllLots,
  getLotById,
  addLot,
  addLots,
  updateLot,
  updateLotWithVersion,
  deleteLot,
  clearByOrg,
  clearAllLots
};
