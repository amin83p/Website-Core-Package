const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { queueWrite } = require('../fileQueue');
const { idsEqual } = require('../../utils/idAdapter');

function ensureJsonFile(dataPath) {
  if (!fs.existsSync(path.dirname(dataPath))) {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  }
  if (!fs.existsSync(dataPath)) {
    fs.writeFileSync(dataPath, '[]');
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function cleanId(value, { max = 120, allowEmpty = true } = {}) {
  const token = cleanString(value, { max, allowEmpty });
  if (token === null) return null;
  if (!token && allowEmpty) return '';
  if (!/^[A-Za-z0-9_.:-]+$/.test(token)) throw new Error('Invalid id format.');
  return token;
}

function cleanIso(value, { allowEmpty = false } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid datetime value.');
  return parsed.toISOString();
}

function cleanNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return Number(fallback || 0);
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) throw new Error('Invalid numeric value.');
  return Number(numeric.toFixed(6));
}

function cleanNonNegativeInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return Number(fallback || 0);
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric < 0) {
    throw new Error('Integer fields must be zero or positive integers.');
  }
  return numeric;
}

function cleanStringArray(values = [], { maxItem = 200 } = {}) {
  const rows = Array.isArray(values) ? values : [values];
  const out = [];
  const seen = new Set();
  rows.forEach((value) => {
    const clean = cleanString(value, { max: maxItem, allowEmpty: true }) || '';
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out;
}

function sanitizeCreator(rawCreator = {}) {
  const input = isPlainObject(rawCreator) ? rawCreator : {};
  const type = cleanString(input.type, { max: 20, allowEmpty: true }).toLowerCase() === 'system' ? 'system' : 'user';
  const userId = cleanId(input.userId, { max: 120, allowEmpty: true }) || '';
  if (type === 'system' || !userId) {
    return {
      type: 'system',
      displayName: 'System',
      userId: '',
      username: '',
      email: '',
      orgId: cleanId(input.orgId, { max: 120, allowEmpty: true }) || ''
    };
  }
  return {
    type: 'user',
    displayName: cleanString(input.displayName, { max: 180, allowEmpty: true }) || userId,
    userId,
    username: cleanString(input.username, { max: 120, allowEmpty: true }) || '',
    email: cleanString(input.email, { max: 220, allowEmpty: true }) || '',
    orgId: cleanId(input.orgId, { max: 120, allowEmpty: true }) || ''
  };
}

function sanitizeAudit(rawAudit = {}, { creator = null, existingAudit = null } = {}) {
  const input = isPlainObject(rawAudit) ? rawAudit : {};
  const existing = isPlainObject(existingAudit) ? existingAudit : {};
  const nowIso = new Date().toISOString();
  const actor = String(creator?.type || '').toLowerCase() === 'system'
    ? 'System'
    : (cleanId(creator?.userId, { max: 120, allowEmpty: true }) || 'System');
  return {
    createUser: cleanString(existing.createUser || input.createUser, { max: 120, allowEmpty: true }) || actor,
    createDateTime: cleanIso(existing.createDateTime || input.createDateTime, { allowEmpty: true }) || nowIso,
    lastUpdateUser: cleanString(input.lastUpdateUser, { max: 120, allowEmpty: true }) || actor,
    lastUpdateDateTime: cleanIso(input.lastUpdateDateTime, { allowEmpty: true }) || nowIso
  };
}

function sanitizeSource(rawSource = {}, { module = 'pte_attempt_runtime', eventType = '', eventIdPrefix = 'PTE-EVT' } = {}) {
  const input = isPlainObject(rawSource) ? rawSource : {};
  return {
    module: cleanString(input.module, { max: 80, allowEmpty: true }) || module,
    eventType: cleanString(input.eventType, { max: 80, allowEmpty: true }) || eventType,
    eventId: cleanId(input.eventId, { max: 180, allowEmpty: true }) || `${eventIdPrefix}-${Date.now()}`,
    idempotencyKey: cleanString(input.idempotencyKey, { max: 220, allowEmpty: true }) || ''
  };
}

function buildDateToken(value) {
  return String(value || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
}

function generateId(prefix, rows = [], dateTime = null) {
  const existingIds = new Set((Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.id || '').trim())
    .filter(Boolean));
  const dateToken = buildDateToken(dateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `${prefix}${dateToken}${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${prefix}${Date.now()}`;
}

function createJsonStore({ dataPath, entityLabel, idPrefix, sanitizeEntity }) {
  ensureJsonFile(dataPath);

  async function getAll() {
    try {
      const raw = await fsPromises.readFile(dataPath, 'utf8');
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new Error(`Failed to retrieve ${entityLabel} rows.`);
    }
  }

  async function getById(id) {
    const rows = await getAll();
    return rows.find((row) => idsEqual(row?.id, id)) || null;
  }

  async function add(payload) {
    return queueWrite(async () => {
      const rows = await getAll();
      const sanitized = sanitizeEntity(payload, { isUpdate: false, existing: null });
      sanitized.id = sanitized.id || generateId(idPrefix, rows, sanitized?.audit?.createDateTime || sanitized?.startedAt || sanitized?.eventAt || null);
      if (rows.some((row) => idsEqual(row?.id, sanitized.id))) {
        throw new Error(`${entityLabel} id '${sanitized.id}' already exists.`);
      }
      rows.push(sanitized);
      await fsPromises.writeFile(dataPath, JSON.stringify(rows, null, 2));
      return sanitized;
    });
  }

  async function update(id, patch) {
    return queueWrite(async () => {
      const rows = await getAll();
      const index = rows.findIndex((row) => idsEqual(row?.id, id));
      if (index < 0) throw new Error(`${entityLabel} not found.`);
      const existing = rows[index];
      const merged = sanitizeEntity({ ...existing, ...(isPlainObject(patch) ? patch : {}), id: existing.id }, { isUpdate: true, existing });
      rows[index] = { ...existing, ...merged, id: existing.id };
      await fsPromises.writeFile(dataPath, JSON.stringify(rows, null, 2));
      return rows[index];
    });
  }

  async function remove(id) {
    return queueWrite(async () => {
      const rows = await getAll();
      const filtered = rows.filter((row) => !idsEqual(row?.id, id));
      if (filtered.length === rows.length) return false;
      await fsPromises.writeFile(dataPath, JSON.stringify(filtered, null, 2));
      return true;
    });
  }

  return {
    getAll,
    getById,
    add,
    update,
    remove
  };
}

module.exports = {
  isPlainObject,
  cleanString,
  cleanId,
  cleanIso,
  cleanNumber,
  cleanNonNegativeInteger,
  cleanStringArray,
  sanitizeCreator,
  sanitizeAudit,
  sanitizeSource,
  generateId,
  createJsonStore
};
