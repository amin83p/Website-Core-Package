const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { idsEqual } = require('../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../data/activityQuotaConsumptionDefinitions.json');
const CREATOR_TYPES = new Set(['system', 'user']);
const VALIDITY_MODES = new Set(['date_range', 'always']);
const CONSUME_TIMINGS = new Set(['on_attempt', 'on_success', 'hybrid']);
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
  const token = cleanString(value, { max, allowEmpty });
  if (token === null) return null;
  if (!token) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9_.:-]+$/.test(token)) throw new Error('Invalid id format.');
  return token;
}

function cleanIsoDateTime(value, { allowEmpty = false } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid datetime value.');
  return parsed.toISOString();
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

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
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

function sanitizeCreator(inputCreator = {}) {
  const creator = isPlainObject(inputCreator) ? inputCreator : {};
  const typeToken = cleanString(creator.type, { max: 30, allowEmpty: true }).toLowerCase();
  const type = CREATOR_TYPES.has(typeToken)
    ? typeToken
    : (cleanId(creator.userId, { max: 120, allowEmpty: true }) ? 'user' : 'system');

  const normalized = {
    type,
    displayName: cleanString(creator.displayName, { max: 160, allowEmpty: true }),
    userId: cleanId(creator.userId, { max: 120, allowEmpty: true }),
    username: cleanString(creator.username, { max: 120, allowEmpty: true }),
    email: cleanString(creator.email, { max: 200, allowEmpty: true }),
    orgId: cleanId(creator.orgId, { max: 120, allowEmpty: true })
  };

  if (normalized.type === 'system') {
    normalized.displayName = 'System';
    normalized.userId = '';
    normalized.username = '';
    normalized.email = '';
    return normalized;
  }

  if (!normalized.userId) throw new Error('creator.userId is required when creator.type is user.');
  if (!normalized.displayName) normalized.displayName = normalized.username || normalized.email || normalized.userId;
  return normalized;
}

function sanitizeAudit(inputAudit = {}, { creatorType = 'system', creatorUserId = '' } = {}) {
  const audit = isPlainObject(inputAudit) ? inputAudit : {};
  const nowIso = new Date().toISOString();
  const fallbackUser = creatorType === 'system' ? 'System' : String(creatorUserId || '').trim();
  const createUser = cleanString(audit.createUser, { max: 120, allowEmpty: true }) || fallbackUser;
  const createDateTime = cleanIsoDateTime(audit.createDateTime, { allowEmpty: true }) || nowIso;
  const lastUpdateUser = cleanString(audit.lastUpdateUser, { max: 120, allowEmpty: true }) || createUser;
  const lastUpdateDateTime = cleanIsoDateTime(audit.lastUpdateDateTime, { allowEmpty: true }) || nowIso;
  return {
    createUser,
    createDateTime,
    lastUpdateUser,
    lastUpdateDateTime
  };
}

function sanitizeMetricFormula(inputMetric = {}) {
  const metric = isPlainObject(inputMetric) ? inputMetric : {};
  return {
    base: cleanNumber(metric.base, { min: 0, max: 999999999 }),
    multiplier: cleanNumber(metric.multiplier, { min: 0, max: 999999999 }),
    contextKey: cleanString(metric.contextKey, { max: 120, allowEmpty: true }) || ''
  };
}

function sanitizeFormula(inputFormula = {}) {
  const formula = isPlainObject(inputFormula) ? inputFormula : {};
  const out = {};
  METRIC_FIELDS.forEach((field) => {
    out[field] = sanitizeMetricFormula(formula[field]);
  });
  return out;
}

function hasPotentialPositiveMetric(formula = {}) {
  return METRIC_FIELDS.some((field) => {
    const row = isPlainObject(formula[field]) ? formula[field] : {};
    return Number(row.base || 0) > 0 || Number(row.multiplier || 0) > 0;
  });
}

function sanitizeTargetUserIds(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const set = new Set();
  list.forEach((row) => {
    const id = cleanId(isPlainObject(row) ? (row.id || row.userId) : row, {
      max: 120,
      allowEmpty: true
    });
    if (id) set.add(id);
  });
  return Array.from(set.values());
}

function sanitizeValidity(inputValidity = {}) {
  const validity = isPlainObject(inputValidity) ? inputValidity : {};
  const modeToken = cleanString(validity.mode, { max: 30, allowEmpty: true }).toLowerCase();
  const mode = VALIDITY_MODES.has(modeToken) ? modeToken : '';
  if (!mode) throw new Error('validity.mode must be date_range or always.');
  if (mode === 'always') {
    return {
      mode: 'always',
      startDate: '',
      endDate: '',
      timezone: normalizeTimezoneToken(validity.timezone, 'UTC')
    };
  }
  const startDate = cleanDateOnly(validity.startDate, { allowEmpty: false });
  const endDate = cleanDateOnly(validity.endDate, { allowEmpty: false });
  if (!startDate || !endDate) {
    throw new Error('validity.startDate and validity.endDate are required.');
  }
  if (endDate < startDate) {
    throw new Error('validity.endDate must be the same day or after validity.startDate.');
  }
  return {
    mode: 'date_range',
    startDate,
    endDate,
    timezone: normalizeTimezoneToken(validity.timezone, 'UTC')
  };
}

function sanitizeDefinition(input, { isUpdate = false, existing = null } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid consumption definition payload.');

  const orgId = cleanId(input.orgId, { max: 120, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');
  const name = cleanString(input.name, { max: 220, allowEmpty: false });
  if (!name) throw new Error('name is required.');
  const sectionId = cleanId(input.sectionId, { max: 120, allowEmpty: false });
  if (!sectionId) throw new Error('sectionId is required.');
  const operationId = cleanId(input.operationId, { max: 120, allowEmpty: false });
  if (!operationId) throw new Error('operationId is required.');

  const sourceEventType = cleanString(input.sourceEventType, { max: 120, allowEmpty: true }) || '';
  const targetUserIds = sanitizeTargetUserIds(input.targetUserIds);
  const isFallback = normalizeBoolean(input.isFallback, false);
  if (isFallback && !sourceEventType) {
    throw new Error('Fallback definitions require sourceEventType (event-specific).');
  }
  const normalizedTargetUserIds = isFallback ? [] : targetUserIds;
  const normalizedActive = isFallback ? true : normalizeBoolean(input.active, true);

  const consumeTimingToken = cleanString(input.consumeTiming, { max: 40, allowEmpty: true }).toLowerCase();
  const consumeTiming = CONSUME_TIMINGS.has(consumeTimingToken) ? consumeTimingToken : 'on_attempt';
  const formula = sanitizeFormula(input.formula);
  if (!hasPotentialPositiveMetric(formula)) {
    throw new Error('At least one metric formula must have a positive base or multiplier.');
  }

  const creator = sanitizeCreator(input.creator);
  const audit = sanitizeAudit(input.audit, {
    creatorType: creator.type,
    creatorUserId: creator.userId
  });

  const out = {
    orgId,
    name,
    description: cleanString(input.description, { max: 3000, allowEmpty: true }) || '',
    active: normalizedActive,
    sectionId,
    operationId,
    sourceEventType,
    targetUserIds: normalizedTargetUserIds,
    isFallback,
    validity: sanitizeValidity(isFallback
      ? {
        mode: 'always',
        timezone: cleanString(input?.validity?.timezone, { max: 80, allowEmpty: true }) || 'UTC'
      }
      : input.validity),
    consumeTiming,
    formula,
    creator,
    audit
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 120, allowEmpty: false });
  }

  if (isUpdate && existing && isPlainObject(existing.audit)) {
    out.audit.createUser = cleanString(existing.audit.createUser, { max: 120, allowEmpty: true }) || out.audit.createUser;
    out.audit.createDateTime = cleanIsoDateTime(existing.audit.createDateTime, { allowEmpty: true }) || out.audit.createDateTime;
    out.audit.lastUpdateDateTime = new Date().toISOString();
    if (!out.audit.lastUpdateUser) out.audit.lastUpdateUser = out.audit.createUser;
  }

  return out;
}

function buildDateToken(isoDateTime) {
  const base = String(isoDateTime || new Date().toISOString()).slice(0, 10);
  return base.replace(/-/g, '');
}

function generateDefinitionId(existingIds, isoDateTime) {
  const ids = existingIds instanceof Set ? existingIds : new Set();
  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `AQD${dateToken}${suffix}`;
    if (!ids.has(candidate)) return candidate;
  }
  return `AQD${Date.now()}`;
}

async function getAllDefinitions() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve activity quota consumption definitions.');
  }
}

async function getDefinitionById(id) {
  const all = await getAllDefinitions();
  return all.find((item) => idsEqual(item?.id, id)) || null;
}

async function addDefinition(payload) {
  return queueWrite(async () => {
    const all = await getAllDefinitions();
    const sanitized = sanitizeDefinition(payload, { isUpdate: false });
    const existingIds = new Set(all.map((item) => String(item?.id || '').trim()).filter(Boolean));
    const id = sanitized.id || generateDefinitionId(existingIds, sanitized?.audit?.createDateTime || new Date().toISOString());
    if (existingIds.has(id)) throw new Error('Activity quota consumption definition id already exists.');
    sanitized.id = id;
    all.push(sanitized);
    await fs.writeFile(DATA_PATH, JSON.stringify(all, null, 2));
    return sanitized;
  });
}

async function updateDefinition(id, payload) {
  return queueWrite(async () => {
    const all = await getAllDefinitions();
    const index = all.findIndex((item) => idsEqual(item?.id, id));
    if (index < 0) throw new Error('Activity quota consumption definition not found.');
    const existing = all[index];
    const sanitized = sanitizeDefinition(
      { ...existing, ...(isPlainObject(payload) ? payload : {}), id: existing.id },
      { isUpdate: true, existing }
    );
    all[index] = { ...existing, ...sanitized, id: existing.id };
    await fs.writeFile(DATA_PATH, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function deleteDefinition(id) {
  return queueWrite(async () => {
    const all = await getAllDefinitions();
    const filtered = all.filter((item) => !idsEqual(item?.id, id));
    if (filtered.length === all.length) return false;
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

module.exports = {
  METRIC_FIELDS: Object.freeze([...METRIC_FIELDS]),
  VALIDITY_MODES: Object.freeze([...VALIDITY_MODES]),
  CONSUME_TIMINGS: Object.freeze([...CONSUME_TIMINGS]),
  getAllDefinitions,
  getDefinitionById,
  addDefinition,
  updateDefinition,
  deleteDefinition,
  generateDefinitionId
};
