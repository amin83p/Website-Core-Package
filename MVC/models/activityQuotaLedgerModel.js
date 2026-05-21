const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { idsEqual, toPublicId } = require('../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../data/activityQuotaLedger.json');
const ENTRY_TYPES = new Set(['credit', 'consumption', 'adjustment']);
const CREATOR_TYPES = new Set(['system', 'user']);
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

function cleanString(value, { max = 200, allowEmpty = true } = {}) {
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

function cleanDateOnly(value, { allowEmpty = false } = {}) {
  const token = cleanString(value, { max: 20, allowEmpty: true });
  if (!token) return allowEmpty ? '' : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) throw new Error('Date values must use YYYY-MM-DD format.');
  return token;
}

function cleanMetricValue(value, { allowNegative = false } = {}) {
  if (value === undefined || value === null || value === '') return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error('Invalid numeric metric value.');
  if (!allowNegative && numeric < 0) {
    throw new Error('Metric values cannot be negative for this entry type.');
  }
  return Number(numeric.toFixed(6));
}

function normalizeEntryType(value) {
  const token = cleanString(value, { max: 40, allowEmpty: false });
  if (!token) return '';
  return token.toLowerCase();
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

function sanitizeSource(source, { entryType = 'consumption' } = {}) {
  const input = isPlainObject(source) ? source : {};
  const module = cleanString(input.module, { max: 80, allowEmpty: false }) || 'activity_quota';
  const eventType = cleanString(input.eventType, { max: 80, allowEmpty: false }) || `${entryType}_event`;
  const eventId = cleanId(input.eventId, { max: 160, allowEmpty: false }) || `AQL-EVT-${Date.now()}`;
  const idempotencyKey = cleanString(input.idempotencyKey, { max: 220, allowEmpty: true });
  return {
    module,
    eventType,
    eventId,
    idempotencyKey
  };
}

function sanitizeValidity(value = {}) {
  const input = isPlainObject(value) ? value : {};
  const modeToken = cleanString(input.mode, { max: 30, allowEmpty: true }).toLowerCase();
  const startDate = cleanDateOnly(input.startDate, { allowEmpty: true }) || '';
  const endDate = cleanDateOnly(input.endDate, { allowEmpty: true }) || '';
  const timezone = normalizeTimezoneToken(input.timezone, 'UTC');
  const hasWindow = modeToken === 'date_range' || Boolean(startDate || endDate);
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

function sanitizeAllocation(value = {}) {
  const input = isPlainObject(value) ? value : {};
  const rows = Array.isArray(input.lots) ? input.lots : [];
  const lots = rows.map((row) => {
    const item = isPlainObject(row) ? row : {};
    const lotId = cleanId(item.lotId || item.id, { max: 120, allowEmpty: true }) || '';
    const metrics = {
      call: cleanMetricValue(item.call ?? item?.metrics?.call, { allowNegative: false }),
      amount: cleanMetricValue(item.amount ?? item?.metrics?.amount, { allowNegative: false }),
      token: cleanMetricValue(item.token ?? item?.metrics?.token, { allowNegative: false }),
      volume: cleanMetricValue(item.volume ?? item?.metrics?.volume, { allowNegative: false })
    };
    const hasPositive = Object.values(metrics).some((metric) => Number(metric || 0) > 0);
    if (!lotId || !hasPositive) return null;
    return {
      lotId,
      metrics
    };
  }).filter(Boolean);
  return {
    policy: cleanString(input.policy, { max: 40, allowEmpty: true }) || 'FEFO',
    lots
  };
}

function sanitizeCreator(creator) {
  const input = isPlainObject(creator) ? creator : {};
  const typeToken = cleanString(input.type, { max: 30, allowEmpty: true }).toLowerCase();
  const type = CREATOR_TYPES.has(typeToken)
    ? typeToken
    : (cleanId(input.userId, { max: 120, allowEmpty: true }) ? 'user' : 'system');

  const normalized = {
    type,
    displayName: cleanString(input.displayName, { max: 160, allowEmpty: true }),
    userId: cleanId(input.userId, { max: 120, allowEmpty: true }),
    username: cleanString(input.username, { max: 120, allowEmpty: true }),
    email: cleanString(input.email, { max: 200, allowEmpty: true }),
    orgId: cleanId(input.orgId, { max: 120, allowEmpty: true })
  };

  if (normalized.type === 'system') {
    normalized.displayName = 'System';
    normalized.userId = '';
    normalized.username = '';
    normalized.email = '';
    normalized.orgId = normalized.orgId || '';
    return normalized;
  }

  if (!normalized.userId) throw new Error('creator.userId is required when creator.type is user.');
  if (!normalized.displayName) {
    normalized.displayName = normalized.username || normalized.email || normalized.userId;
  }
  return normalized;
}

function sanitizeAudit(audit, { creatorType = 'system', creatorUserId = '' } = {}) {
  const input = isPlainObject(audit) ? audit : {};
  const nowIso = new Date().toISOString();

  const defaultCreateUser = creatorType === 'system' ? 'System' : String(creatorUserId || '').trim();
  const createUser = cleanString(input.createUser, { max: 120, allowEmpty: true }) || defaultCreateUser;
  const createDateTime = cleanIsoDateTime(input.createDateTime, { allowEmpty: true }) || nowIso;
  const lastUpdateUser = cleanString(input.lastUpdateUser, { max: 120, allowEmpty: true }) || createUser;
  const lastUpdateDateTime = cleanIsoDateTime(input.lastUpdateDateTime, { allowEmpty: true }) || nowIso;

  return {
    createUser,
    createDateTime,
    lastUpdateUser,
    lastUpdateDateTime
  };
}

function sanitizeEntry(input, { isUpdate = false, existing = null } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid activity quota ledger payload.');

  const entryType = normalizeEntryType(input.entryType);
  if (!ENTRY_TYPES.has(entryType)) throw new Error('Invalid entryType. Must be credit, consumption, or adjustment.');

  const orgId = cleanId(input.orgId, { max: 120, allowEmpty: false });
  const userId = cleanId(input.userId, { max: 120, allowEmpty: false });
  const section = cleanString(input.section, { max: 120, allowEmpty: false });
  const operation = cleanString(input.operation, { max: 120, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');
  if (!userId) throw new Error('userId is required.');
  if (!section) throw new Error('section is required.');
  if (!operation) throw new Error('operation is required.');

  const allowNegative = entryType === 'adjustment';
  const creator = sanitizeCreator(input.creator);
  const audit = sanitizeAudit(input.audit, {
    creatorType: creator.type,
    creatorUserId: creator.userId
  });
  const source = sanitizeSource(input.source, { entryType });
  const validity = sanitizeValidity(input.validity);
  const allocation = sanitizeAllocation(input.allocation);

  const out = {
    dateTime: cleanIsoDateTime(input.dateTime, { allowEmpty: true }) || new Date().toISOString(),
    userId,
    orgId,
    section,
    operation,
    call: cleanMetricValue(input.call, { allowNegative }),
    amount: cleanMetricValue(input.amount, { allowNegative }),
    token: cleanMetricValue(input.token, { allowNegative }),
    volume: cleanMetricValue(input.volume, { allowNegative }),
    entryType,
    source,
    validity,
    allocation,
    creator,
    audit
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 64, allowEmpty: false });
  }

  if (isUpdate && existing && isPlainObject(existing.audit)) {
    out.audit.createUser = cleanString(existing.audit.createUser, { max: 120, allowEmpty: true }) || out.audit.createUser;
    out.audit.createDateTime = cleanIsoDateTime(existing.audit.createDateTime, { allowEmpty: true }) || out.audit.createDateTime;
    out.audit.lastUpdateDateTime = new Date().toISOString();
    if (!out.audit.lastUpdateUser) {
      out.audit.lastUpdateUser = out.audit.createUser;
    }
  }

  return out;
}

function buildDateToken(isoDateTime) {
  const base = String(isoDateTime || new Date().toISOString()).slice(0, 10);
  return base.replace(/-/g, '');
}

function generateLedgerId(existingIds, isoDateTime) {
  const ids = existingIds instanceof Set ? existingIds : new Set();
  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `AQL${dateToken}${suffix}`;
    if (!ids.has(candidate)) return candidate;
  }
  return `AQL${Date.now()}`;
}

function assertIdempotencyUnique(entries, row, ignoreId = null) {
  const idempotencyKey = cleanString(row?.source?.idempotencyKey, { max: 220, allowEmpty: true });
  if (!idempotencyKey) return;
  const orgId = toPublicId(row?.orgId);
  const duplicate = (Array.isArray(entries) ? entries : []).find((item) => {
    if (!idsEqual(item?.orgId, orgId)) return false;
    if (String(item?.source?.idempotencyKey || '').trim() !== idempotencyKey) return false;
    if (ignoreId && idsEqual(item?.id, ignoreId)) return false;
    return true;
  });
  if (duplicate) {
    throw new Error('Duplicate source.idempotencyKey for this organization.');
  }
}

async function getAllEntries() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve activity quota ledger entries.');
  }
}

async function getEntryById(id) {
  const all = await getAllEntries();
  return all.find((item) => idsEqual(item?.id, id)) || null;
}

async function addEntry(payload) {
  return queueWrite(async () => {
    const all = await getAllEntries();
    const sanitized = sanitizeEntry(payload, { isUpdate: false });
    const existingIds = new Set(all.map((item) => String(item.id || '').trim()).filter(Boolean));
    const id = sanitized.id ? String(sanitized.id) : generateLedgerId(existingIds, sanitized.dateTime);
    if (existingIds.has(id)) throw new Error('Activity quota ledger id already exists.');
    sanitized.id = id;
    assertIdempotencyUnique(all, sanitized);
    all.push(sanitized);
    await fs.writeFile(DATA_PATH, JSON.stringify(all, null, 2));
    return sanitized;
  });
}

async function addEntries(items) {
  return queueWrite(async () => {
    const incoming = Array.isArray(items) ? items : [items];
    if (!incoming.length) throw new Error('At least one activity quota ledger item is required.');

    const all = await getAllEntries();
    const existingIds = new Set(all.map((item) => String(item.id || '').trim()).filter(Boolean));
    const working = [...all];
    const created = [];

    for (const item of incoming) {
      const sanitized = sanitizeEntry(item, { isUpdate: false });
      const id = sanitized.id ? String(sanitized.id) : generateLedgerId(existingIds, sanitized.dateTime);
      if (existingIds.has(id)) throw new Error('Activity quota ledger id already exists.');
      sanitized.id = id;
      assertIdempotencyUnique(working, sanitized);
      existingIds.add(id);
      working.push(sanitized);
      created.push(sanitized);
    }

    all.push(...created);
    await fs.writeFile(DATA_PATH, JSON.stringify(all, null, 2));
    return created;
  });
}

async function updateEntry(id, payload) {
  return queueWrite(async () => {
    const all = await getAllEntries();
    const index = all.findIndex((item) => idsEqual(item?.id, id));
    if (index < 0) throw new Error('Activity quota ledger entry not found.');

    const existing = all[index];
    const sanitized = sanitizeEntry(
      { ...existing, ...(isPlainObject(payload) ? payload : {}), id: existing.id },
      { isUpdate: true, existing }
    );

    assertIdempotencyUnique(all, sanitized, existing.id);
    all[index] = { ...existing, ...sanitized, id: existing.id };
    await fs.writeFile(DATA_PATH, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function deleteEntry(id) {
  return queueWrite(async () => {
    const all = await getAllEntries();
    const filtered = all.filter((item) => !idsEqual(item?.id, id));
    if (filtered.length === all.length) return false;
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

async function clearEntriesByOrg(orgId) {
  return queueWrite(async () => {
    const targetOrgId = toPublicId(orgId);
    if (!targetOrgId) throw new Error('orgId is required to clear activity quota ledger entries.');
    const all = await getAllEntries();
    const filtered = all.filter((item) => !idsEqual(item?.orgId, targetOrgId));
    const removed = all.length - filtered.length;
    if (!removed) return { removed: 0, remaining: all.length };
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return { removed, remaining: filtered.length };
  });
}

module.exports = {
  ENTRY_TYPES: Object.freeze([...ENTRY_TYPES]),
  CREATOR_TYPES: Object.freeze([...CREATOR_TYPES]),
  METRIC_FIELDS,
  getAllEntries,
  getEntryById,
  addEntry,
  addEntries,
  updateEntry,
  deleteEntry,
  clearEntriesByOrg,
  generateLedgerId
};
