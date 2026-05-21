const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { idsEqual, toPublicId } = require('../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../data/activityQuotaCreditGroups.json');
const CREATOR_TYPES = new Set(['system', 'user']);
const STATUS_VALUES = new Set(['active', 'archived']);

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

function cleanNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return Number(fallback || 0);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error('Numeric value is invalid.');
  if (numeric < 0) throw new Error('Numeric value cannot be negative.');
  return Number(numeric.toFixed(6));
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

function sanitizeUsers(users) {
  const list = Array.isArray(users) ? users : [];
  const map = new Map();

  list.forEach((rawUser) => {
    const row = isPlainObject(rawUser) ? rawUser : { id: rawUser };
    const id = cleanId(row.id || row.userId, { max: 120, allowEmpty: false });
    if (!id) return;
    map.set(id, {
      id,
      name: cleanString(row.name, { max: 180, allowEmpty: true }) || '',
      username: cleanString(row.username, { max: 120, allowEmpty: true }) || '',
      email: cleanString(row.email, { max: 200, allowEmpty: true }) || ''
    });
  });

  const out = Array.from(map.values());
  if (!out.length) throw new Error('Group requires at least one user.');
  return out;
}

function sanitizeOperation(operation = {}) {
  const row = isPlainObject(operation) ? operation : { id: operation };
  const id = cleanId(row.id || row.operationId, { max: 120, allowEmpty: false });
  if (!id) throw new Error('Section operation id is required.');
  const metrics = {
    call: cleanNumber(row.call, 0),
    amount: cleanNumber(row.amount, 0),
    token: cleanNumber(row.token, 0),
    volume: cleanNumber(row.volume, 0)
  };
  if (metrics.call <= 0 && metrics.amount <= 0 && metrics.token <= 0 && metrics.volume <= 0) {
    throw new Error(`Operation '${id}' requires at least one positive credit value.`);
  }
  return {
    id,
    name: cleanString(row.name, { max: 180, allowEmpty: true }) || '',
    ...metrics
  };
}

function sanitizeSections(sections) {
  const list = Array.isArray(sections) ? sections : [];
  const map = new Map();

  list.forEach((rawSection) => {
    const section = isPlainObject(rawSection) ? rawSection : { id: rawSection };
    const id = cleanId(section.id || section.sectionId, { max: 120, allowEmpty: false });
    if (!id) return;
    const operations = Array.isArray(section.operations)
      ? section.operations.map((op) => sanitizeOperation(op))
      : [];
    if (!operations.length) throw new Error(`Section '${id}' requires at least one operation.`);

    const opMap = new Map();
    operations.forEach((op) => opMap.set(op.id, op));
    map.set(id, {
      id,
      name: cleanString(section.name, { max: 180, allowEmpty: true }) || '',
      operations: Array.from(opMap.values())
    });
  });

  const out = Array.from(map.values());
  if (!out.length) throw new Error('Group requires at least one section.');
  return out;
}

function sanitizeSource(source = {}) {
  const input = isPlainObject(source) ? source : {};
  return {
    module: cleanString(input.module, { max: 80, allowEmpty: true }) || 'activity_quota_add_credit',
    eventType: cleanString(input.eventType, { max: 80, allowEmpty: true }) || 'manual_credit',
    eventIdMode: cleanString(input.eventIdMode, { max: 20, allowEmpty: true }).toLowerCase() === 'custom' ? 'custom' : 'auto',
    eventId: cleanString(input.eventId, { max: 180, allowEmpty: true }) || '',
    idempotencyMode: cleanString(input.idempotencyMode, { max: 20, allowEmpty: true }).toLowerCase() === 'custom' ? 'custom' : 'auto',
    idempotencyKey: cleanString(input.idempotencyKey, { max: 220, allowEmpty: true }) || ''
  };
}

function sanitizeLedgerEntryIds(values) {
  const list = Array.isArray(values) ? values : [];
  const out = [];
  list.forEach((value) => {
    const id = cleanId(value, { max: 120, allowEmpty: false });
    if (!id) return;
    if (!out.includes(id)) out.push(id);
  });
  return out;
}

function summarizeGroup(sectionRows = [], userRows = [], ledgerEntryIds = []) {
  let operationCount = 0;
  sectionRows.forEach((section) => {
    operationCount += Array.isArray(section?.operations) ? section.operations.length : 0;
  });
  return {
    userCount: userRows.length,
    sectionCount: sectionRows.length,
    operationCount,
    ledgerEntryCount: ledgerEntryIds.length
  };
}

function sanitizeGroup(input, { isUpdate = false, existing = null } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid activity quota credit group payload.');

  const orgId = cleanId(input.orgId, { max: 120, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');

  const users = sanitizeUsers(input.users);
  const sections = sanitizeSections(input.sections);
  const ledgerEntryIds = sanitizeLedgerEntryIds(input.ledgerEntryIds || []);
  const creator = sanitizeCreator(input.creator);
  const audit = sanitizeAudit(input.audit, {
    creatorType: creator.type,
    creatorUserId: creator.userId
  });
  const statusRaw = cleanString(input.status, { max: 40, allowEmpty: true }).toLowerCase();
  const status = STATUS_VALUES.has(statusRaw) ? statusRaw : 'active';

  const out = {
    dateTime: cleanIsoDateTime(input.dateTime, { allowEmpty: true }) || new Date().toISOString(),
    orgId,
    users,
    sections,
    source: sanitizeSource(input.source),
    ledgerEntryIds,
    status,
    creator,
    audit,
    summary: summarizeGroup(sections, users, ledgerEntryIds)
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

function generateGroupId(existingIds, isoDateTime) {
  const ids = existingIds instanceof Set ? existingIds : new Set();
  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `AQG${dateToken}${suffix}`;
    if (!ids.has(candidate)) return candidate;
  }
  return `AQG${Date.now()}`;
}

async function getAllGroups() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve activity quota credit groups.');
  }
}

async function getGroupById(id) {
  const all = await getAllGroups();
  return all.find((item) => idsEqual(item?.id, id)) || null;
}

async function addGroup(payload) {
  return queueWrite(async () => {
    const all = await getAllGroups();
    const sanitized = sanitizeGroup(payload, { isUpdate: false });
    const existingIds = new Set(all.map((item) => String(item.id || '').trim()).filter(Boolean));
    const id = sanitized.id ? String(sanitized.id) : generateGroupId(existingIds, sanitized.dateTime);
    if (existingIds.has(id)) throw new Error('Activity quota credit group id already exists.');
    sanitized.id = id;
    all.push(sanitized);
    await fs.writeFile(DATA_PATH, JSON.stringify(all, null, 2));
    return sanitized;
  });
}

async function updateGroup(id, payload) {
  return queueWrite(async () => {
    const all = await getAllGroups();
    const index = all.findIndex((item) => idsEqual(item?.id, id));
    if (index < 0) throw new Error('Activity quota credit group not found.');

    const existing = all[index];
    const sanitized = sanitizeGroup(
      { ...existing, ...(isPlainObject(payload) ? payload : {}), id: existing.id },
      { isUpdate: true, existing }
    );

    all[index] = { ...existing, ...sanitized, id: existing.id };
    await fs.writeFile(DATA_PATH, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function deleteGroup(id) {
  return queueWrite(async () => {
    const all = await getAllGroups();
    const filtered = all.filter((item) => !idsEqual(item?.id, id));
    if (filtered.length === all.length) return false;
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

module.exports = {
  CREATOR_TYPES: Object.freeze([...CREATOR_TYPES]),
  STATUS_VALUES: Object.freeze([...STATUS_VALUES]),
  getAllGroups,
  getGroupById,
  addGroup,
  updateGroup,
  deleteGroup,
  generateGroupId
};
