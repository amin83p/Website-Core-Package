const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { idsEqual } = require('../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../data/activityQuotaPackages.json');
const CREATOR_TYPES = new Set(['system', 'user']);
const VISIBILITY_VALUES = new Set(['public', 'internal']);
const VALIDITY_MODES = new Set(['date_range', 'duration']);

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

function cleanDateOnly(value, { allowEmpty = false } = {}) {
  const token = cleanString(value, { max: 20, allowEmpty: true });
  if (!token) return allowEmpty ? '' : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    throw new Error('Date values must use YYYY-MM-DD format.');
  }
  return token;
}

function cleanNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error('Numeric value is invalid.');
  if (numeric < min) throw new Error('Numeric value is below allowed range.');
  if (numeric > max) throw new Error('Numeric value is above allowed range.');
  return Number(numeric.toFixed(6));
}

function cleanInteger(value, { min = 0, max = 5000 } = {}) {
  if (value === undefined || value === null || value === '') return 0;
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric)) throw new Error('Integer value is invalid.');
  if (numeric < min) throw new Error('Integer value is below allowed range.');
  if (numeric > max) throw new Error('Integer value is above allowed range.');
  return numeric;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
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

function sanitizePrice(priceInput) {
  const input = isPlainObject(priceInput) ? priceInput : {};
  const amount = cleanNumber(input.amount, { min: 0, max: 999999999 });
  const currencyCodeRaw = cleanString(input.currencyCode, { max: 3, allowEmpty: true });
  const currencyCode = (currencyCodeRaw || 'CAD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error('price.currencyCode must be a valid 3-letter currency code.');
  return {
    amount,
    currencyCode
  };
}

function sanitizeValidity(validityInput) {
  const input = isPlainObject(validityInput) ? validityInput : {};
  const modeRaw = cleanString(input.mode, { max: 20, allowEmpty: true }).toLowerCase();
  const mode = VALIDITY_MODES.has(modeRaw) ? modeRaw : '';
  if (!mode) throw new Error('validity.mode must be date_range or duration.');

  if (mode === 'date_range') {
    const startDate = cleanDateOnly(input.startDate, { allowEmpty: false });
    const endDate = cleanDateOnly(input.endDate, { allowEmpty: false });
    if (!startDate || !endDate) throw new Error('validity.startDate and validity.endDate are required for date_range mode.');
    if (endDate < startDate) throw new Error('validity.endDate must be the same day or after validity.startDate.');
    return {
      mode,
      startDate,
      endDate,
      years: 0,
      months: 0,
      days: 0
    };
  }

  const years = cleanInteger(input.years, { min: 0, max: 200 });
  const months = cleanInteger(input.months, { min: 0, max: 1200 });
  const days = cleanInteger(input.days, { min: 0, max: 50000 });
  if ((years + months + days) <= 0) {
    throw new Error('Duration validity requires at least one positive value in years, months, or days.');
  }
  return {
    mode,
    startDate: '',
    endDate: '',
    years,
    months,
    days
  };
}

function sanitizeAccessProfiles(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const unique = new Map();
  list.forEach((raw) => {
    const item = isPlainObject(raw) ? raw : { id: raw };
    const id = cleanId(item.id || item.accessProfileId, { max: 120, allowEmpty: false });
    if (!id) return;
    unique.set(id, {
      id,
      name: cleanString(item.name, { max: 180, allowEmpty: true }) || '',
      orgId: cleanId(item.orgId, { max: 120, allowEmpty: true }) || ''
    });
  });
  return Array.from(unique.values());
}

function sanitizeBannedUsers(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const unique = new Map();
  list.forEach((raw) => {
    const item = isPlainObject(raw) ? raw : { id: raw };
    const id = cleanId(item.id || item.userId, { max: 120, allowEmpty: false });
    if (!id) return;
    unique.set(id, {
      id,
      name: cleanString(item.name, { max: 180, allowEmpty: true }) || '',
      username: cleanString(item.username, { max: 120, allowEmpty: true }) || '',
      email: cleanString(item.email, { max: 200, allowEmpty: true }) || '',
      orgId: cleanId(item.orgId, { max: 120, allowEmpty: true }) || ''
    });
  });
  return Array.from(unique.values());
}

function sanitizeEligibleRoles(rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  const unique = new Map();
  list.forEach((raw) => {
    const tokenRaw = isPlainObject(raw)
      ? (raw.id || raw.role || raw.value || raw.name)
      : raw;
    const token = cleanString(tokenRaw, { max: 120, allowEmpty: true }).toLowerCase();
    if (!token) return;
    if (!/^[a-z0-9_.:-]+$/.test(token)) {
      throw new Error('eligibleRoles must contain only letters, numbers, underscore, dot, colon, or dash.');
    }
    if (!unique.has(token)) unique.set(token, token);
  });
  return Array.from(unique.values());
}

function sanitizeOperation(rawOperation = {}) {
  const row = isPlainObject(rawOperation) ? rawOperation : { id: rawOperation };
  const id = cleanId(row.id || row.operationId, { max: 120, allowEmpty: false });
  if (!id) throw new Error('section operation id is required.');
  const metrics = {
    call: cleanNumber(row.call, { min: 0, max: 999999999 }),
    amount: cleanNumber(row.amount, { min: 0, max: 999999999 }),
    token: cleanNumber(row.token, { min: 0, max: 999999999999 }),
    volume: cleanNumber(row.volume, { min: 0, max: 999999999 })
  };
  if (metrics.call <= 0 && metrics.amount <= 0 && metrics.token <= 0 && metrics.volume <= 0) {
    throw new Error(`Operation '${id}' requires at least one positive quota value.`);
  }
  return {
    id,
    name: cleanString(row.name, { max: 180, allowEmpty: true }) || '',
    label: cleanString(row.label, { max: 180, allowEmpty: true }) || '',
    ...metrics
  };
}

function sanitizeSections(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const sectionMap = new Map();

  list.forEach((rawSection) => {
    const section = isPlainObject(rawSection) ? rawSection : { id: rawSection };
    const id = cleanId(section.id || section.sectionId, { max: 120, allowEmpty: false });
    if (!id) return;
    const operationsRaw = Array.isArray(section.operations) ? section.operations : [];
    const operationMap = new Map();
    operationsRaw.forEach((rawOperation) => {
      const operation = sanitizeOperation(rawOperation);
      operationMap.set(operation.id, operation);
    });
    if (!operationMap.size) throw new Error(`Section '${id}' requires at least one operation.`);
    sectionMap.set(id, {
      id,
      name: cleanString(section.name, { max: 180, allowEmpty: true }) || '',
      operations: Array.from(operationMap.values())
    });
  });

  const out = Array.from(sectionMap.values());
  if (!out.length) throw new Error('At least one section is required.');
  return out;
}

function sanitizePackage(input, { isUpdate = false, existing = null } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid activity quota package payload.');

  const orgId = cleanId(input.orgId, { max: 120, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');

  const name = cleanString(input.name, { max: 200, allowEmpty: false });
  if (!name) throw new Error('name is required.');

  const visibilityRaw = cleanString(input.visibility, { max: 30, allowEmpty: true }).toLowerCase();
  const visibility = VISIBILITY_VALUES.has(visibilityRaw) ? visibilityRaw : 'internal';

  const creator = sanitizeCreator(input.creator);
  const audit = sanitizeAudit(input.audit, {
    creatorType: creator.type,
    creatorUserId: creator.userId
  });

  const out = {
    orgId,
    name,
    category: cleanString(input.category, { max: 80, allowEmpty: true }) || '',
    description: cleanString(input.description, { max: 3000, allowEmpty: true }) || '',
    price: sanitizePrice(input.price),
    active: normalizeBoolean(input.active, true),
    visibility,
    validity: sanitizeValidity(input.validity),
    accessProfiles: sanitizeAccessProfiles(input.accessProfiles),
    eligibleRoles: sanitizeEligibleRoles(input.eligibleRoles !== undefined ? input.eligibleRoles : existing?.eligibleRoles || []),
    bannedUsers: sanitizeBannedUsers(input.bannedUsers),
    sections: sanitizeSections(input.sections),
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

function generatePackageId(existingIds, isoDateTime) {
  const ids = existingIds instanceof Set ? existingIds : new Set();
  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `AQP${dateToken}${suffix}`;
    if (!ids.has(candidate)) return candidate;
  }
  return `AQP${Date.now()}`;
}

async function getAllPackages() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve activity quota package records.');
  }
}

async function getPackageById(id) {
  const all = await getAllPackages();
  return all.find((item) => idsEqual(item?.id, id)) || null;
}

async function addPackage(payload) {
  return queueWrite(async () => {
    const all = await getAllPackages();
    const sanitized = sanitizePackage(payload, { isUpdate: false });
    const existingIds = new Set(all.map((item) => String(item?.id || '').trim()).filter(Boolean));
    const id = sanitized.id || generatePackageId(existingIds, sanitized?.audit?.createDateTime || new Date().toISOString());
    if (existingIds.has(id)) throw new Error('Activity quota package id already exists.');
    sanitized.id = id;
    all.push(sanitized);
    await fs.writeFile(DATA_PATH, JSON.stringify(all, null, 2));
    return sanitized;
  });
}

async function updatePackage(id, payload) {
  return queueWrite(async () => {
    const all = await getAllPackages();
    const index = all.findIndex((item) => idsEqual(item?.id, id));
    if (index < 0) throw new Error('Activity quota package not found.');
    const existing = all[index];
    const sanitized = sanitizePackage(
      { ...existing, ...(isPlainObject(payload) ? payload : {}), id: existing.id },
      { isUpdate: true, existing }
    );
    all[index] = { ...existing, ...sanitized, id: existing.id };
    await fs.writeFile(DATA_PATH, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function deletePackage(id) {
  return queueWrite(async () => {
    const all = await getAllPackages();
    const filtered = all.filter((item) => !idsEqual(item?.id, id));
    if (filtered.length === all.length) return false;
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

module.exports = {
  CREATOR_TYPES: Object.freeze([...CREATOR_TYPES]),
  VISIBILITY_VALUES: Object.freeze([...VISIBILITY_VALUES]),
  VALIDITY_MODES: Object.freeze([...VALIDITY_MODES]),
  getAllPackages,
  getPackageById,
  addPackage,
  updatePackage,
  deletePackage,
  generatePackageId
};
