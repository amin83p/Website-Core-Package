const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue');

const DATA_PATH = path.join(__dirname, '../../data/emailEventDefinitions.json');

if (!fsSync.existsSync(path.dirname(DATA_PATH))) {
  fsSync.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}
if (!fsSync.existsSync(DATA_PATH)) {
  fsSync.writeFileSync(DATA_PATH, '[]');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 5000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeKeyToken(value = '') {
  return cleanString(value, { max: 120, allowEmpty: true }).toUpperCase();
}

function normalizePackageName(value = '') {
  const token = cleanString(value, { max: 64, allowEmpty: true }).toUpperCase();
  return token || 'CORE';
}

function normalizeBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function normalizeTokenList(value = [], { maxItems = 200 } = {}) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  source.forEach((item) => {
    const token = normalizeKeyToken(item);
    if (!token || seen.has(token)) return;
    seen.add(token);
    out.push(token);
    if (out.length >= maxItems) return;
  });
  return out;
}

function cleanIsoDateTime(value, { allowEmpty = false } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid datetime value.');
  return parsed.toISOString();
}

function normalizeDefinitionRecord(record = {}, existing = null) {
  const input = isPlainObject(record) ? record : {};
  const base = isPlainObject(existing) ? existing : {};
  const nowIso = new Date().toISOString();

  const eventKey = normalizeKeyToken(input.eventKey || base.eventKey);
  if (!eventKey) throw new Error('Event key is required.');

  const sectionId = normalizeKeyToken(input.sectionId || base.sectionId);
  const operationId = normalizeKeyToken(input.operationId || base.operationId);
  if (!sectionId || !operationId) {
    throw new Error('Section and operation are required for email event definitions.');
  }

  const allowedPlaceholders = normalizeTokenList(
    input.allowedPlaceholders !== undefined ? input.allowedPlaceholders : base.allowedPlaceholders
  );
  const requiredPlaceholders = normalizeTokenList(
    input.requiredPlaceholders !== undefined ? input.requiredPlaceholders : base.requiredPlaceholders
  );
  const runtimePlaceholders = normalizeTokenList(
    input.runtimePlaceholders !== undefined ? input.runtimePlaceholders : base.runtimePlaceholders
  );

  const allowedSet = new Set(allowedPlaceholders);
  runtimePlaceholders.forEach((token) => allowedSet.add(token));
  const mergedAllowed = Array.from(allowedSet);

  return {
    ...base,
    id: cleanString(input.id || base.id || eventKey, { max: 120, allowEmpty: true }) || eventKey,
    eventKey,
    sectionId,
    operationId,
    packageName: normalizePackageName(input.packageName || base.packageName || 'CORE'),
    label: cleanString(input.label || base.label, { max: 180, allowEmpty: true }) || eventKey,
    resolverId: cleanString(input.resolverId || base.resolverId, { max: 120, allowEmpty: true }) || '',
    allowedPlaceholders: mergedAllowed,
    requiredPlaceholders,
    runtimePlaceholders,
    isActive: normalizeBoolean(
      input.isActive !== undefined ? input.isActive : base.isActive,
      true
    ),
    createdAt: cleanIsoDateTime(base.createdAt, { allowEmpty: true }) || nowIso,
    updatedAt: nowIso
  };
}

function sanitizeDefinitionForRead(record = {}) {
  const row = isPlainObject(record) ? { ...record } : {};
  row.eventKey = normalizeKeyToken(row.eventKey);
  row.sectionId = normalizeKeyToken(row.sectionId);
  row.operationId = normalizeKeyToken(row.operationId);
  row.packageName = normalizePackageName(row.packageName);
  row.allowedPlaceholders = normalizeTokenList(row.allowedPlaceholders);
  row.requiredPlaceholders = normalizeTokenList(row.requiredPlaceholders);
  row.runtimePlaceholders = normalizeTokenList(row.runtimePlaceholders);
  row.isActive = row.isActive !== false;
  return row;
}

async function readAllDefinitions() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve email event definitions.');
  }
}

async function getDefinitionByEventKey(eventKey = '') {
  const token = normalizeKeyToken(eventKey);
  if (!token) return null;
  const rows = await readAllDefinitions();
  return rows.find((row) => normalizeKeyToken(row?.eventKey) === token) || null;
}

async function upsertDefinition(payload = {}) {
  return queueWrite(async () => {
    const rows = await readAllDefinitions();
    const normalized = normalizeDefinitionRecord(payload, null);
    const index = rows.findIndex((row) => normalizeKeyToken(row?.eventKey) === normalized.eventKey);
    if (index >= 0) {
      rows[index] = normalizeDefinitionRecord(payload, rows[index]);
    } else {
      rows.push(normalized);
    }
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return index >= 0 ? rows[index] : rows[rows.length - 1];
  });
}

module.exports = {
  normalizeDefinitionRecord,
  sanitizeDefinitionForRead,
  normalizeKeyToken,
  getAllDefinitions: readAllDefinitions,
  getDefinitionByEventKey,
  upsertDefinition
};
