const { requireCoreModule, resolveCoreRoot } = require('../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const { queueWrite } = requireCoreModule('MVC/MVC/models/fileQueue');
const { idsEqual, toPublicId } = requireCoreModule('MVC/MVC/utils/idAdapter');

function ensureJsonArrayFile(dataPath) {
  if (!fsSync.existsSync(dataPath)) {
    fsSync.writeFileSync(dataPath, '[]');
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 5000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function cleanId(value, { max = 120, allowEmpty = false } = {}) {
  const token = cleanString(value, { max, allowEmpty });
  if (token === null) return null;
  if (!token) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9:_-]+$/.test(token)) {
    throw new Error('Invalid id format.');
  }
  return token;
}

function cleanInteger(value, { min = 0, max = 1000000, allowEmpty = true } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? null : NaN;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error('Invalid integer value.');
  }
  if (parsed < min || parsed > max) {
    throw new Error('Integer value out of range.');
  }
  return parsed;
}

function cleanNumber(value, { min = null, max = null, allowEmpty = true } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? null : NaN;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('Invalid numeric value.');
  if (min !== null && parsed < min) throw new Error('Numeric value below minimum.');
  if (max !== null && parsed > max) throw new Error('Numeric value above maximum.');
  return parsed;
}

function cleanBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return Boolean(fallback);
}

function cleanDateOnly(value, { allowEmpty = true } = {}) {
  const token = cleanString(value, { max: 10, allowEmpty });
  if (token === null) return null;
  if (!token) return allowEmpty ? '' : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    throw new Error('Invalid date format. Use YYYY-MM-DD.');
  }
  return token;
}

function cleanIsoUtc(value, { allowEmpty = true } = {}) {
  const token = cleanString(value, { max: 60, allowEmpty });
  if (token === null) return null;
  if (!token) return allowEmpty ? '' : null;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid UTC timestamp.');
  return parsed.toISOString();
}

function cleanStringArray(value, { maxItem = 200, maxItems = 100 } = {}) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  rows.forEach((item) => {
    const token = cleanString(item, { max: maxItem, allowEmpty: false });
    if (!token) return;
    if (seen.has(token)) return;
    seen.add(token);
    if (out.length < maxItems) out.push(token);
  });
  return out;
}

function cleanIdArray(value, { maxItem = 120, maxItems = 200 } = {}) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  rows.forEach((item) => {
    const token = cleanId(item, { max: maxItem, allowEmpty: false });
    if (!token) return;
    if (seen.has(token)) return;
    seen.add(token);
    if (out.length < maxItems) out.push(token);
  });
  return out;
}

function buildAudit(nextAudit = {}, existingAudit = {}) {
  const nowIso = new Date().toISOString();
  const rawNext = isPlainObject(nextAudit) ? nextAudit : {};
  const rawExisting = isPlainObject(existingAudit) ? existingAudit : {};
  return {
    createUser: cleanString(rawExisting.createUser || rawNext.createUser, { max: 120, allowEmpty: true }) || '',
    createDateTime: cleanIsoUtc(rawExisting.createDateTime || rawNext.createDateTime, { allowEmpty: true }) || nowIso,
    lastUpdateUser: cleanString(rawNext.lastUpdateUser || rawExisting.lastUpdateUser, { max: 120, allowEmpty: true }) || '',
    lastUpdateDateTime: nowIso
  };
}

function generateEntityId(prefix, existingIds = new Set()) {
  const safePrefix = cleanString(prefix, { max: 30, allowEmpty: false }) || 'REC';
  for (let i = 0; i < 50; i += 1) {
    const candidate = `${safePrefix}-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function readAllRows(dataPath) {
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`Failed to read data store: ${error.message}`);
  }
}

async function writeAllRows(dataPath, rows) {
  await fs.writeFile(dataPath, JSON.stringify(Array.isArray(rows) ? rows : [], null, 2));
}

function createJsonEntityModel({
  dataPath,
  idPrefix,
  entityLabel = 'Record',
  sanitizeInput,
  mergeForUpdate
}) {
  ensureJsonArrayFile(dataPath);
  if (typeof sanitizeInput !== 'function') {
    throw new Error('sanitizeInput function is required for createJsonEntityModel.');
  }

  async function getAll() {
    return readAllRows(dataPath);
  }

  async function getById(id) {
    const rows = await getAll();
    return rows.find((row) => idsEqual(row?.id, id)) || null;
  }

  async function add(input, options = {}) {
    void options;
    return queueWrite(async () => {
      const rows = await getAll();
      const sanitized = sanitizeInput(input, { isUpdate: false, existing: null });
      const existingIds = new Set(rows.map((row) => toPublicId(row?.id)).filter(Boolean));
      const generatedId = sanitized.id || generateEntityId(idPrefix, existingIds);
      if (existingIds.has(generatedId)) {
        throw new Error(`${entityLabel} id already exists.`);
      }
      const next = {
        ...sanitized,
        id: generatedId,
        audit: buildAudit(sanitized.audit, {})
      };
      rows.push(next);
      await writeAllRows(dataPath, rows);
      return next;
    });
  }

  async function update(id, updates, options = {}) {
    void options;
    return queueWrite(async () => {
      const rows = await getAll();
      const index = rows.findIndex((row) => idsEqual(row?.id, id));
      if (index === -1) throw new Error(`${entityLabel} not found.`);
      const existing = rows[index];
      const mergedInput = typeof mergeForUpdate === 'function'
        ? mergeForUpdate(existing, updates)
        : { ...existing, ...(isPlainObject(updates) ? updates : {}) };
      const sanitized = sanitizeInput(mergedInput, { isUpdate: true, existing });
      const next = {
        ...existing,
        ...sanitized,
        id: existing.id,
        audit: buildAudit(sanitized.audit, existing.audit)
      };
      rows[index] = next;
      await writeAllRows(dataPath, rows);
      return next;
    });
  }

  async function remove(id, options = {}) {
    void options;
    return queueWrite(async () => {
      const rows = await getAll();
      const next = rows.filter((row) => !idsEqual(row?.id, id));
      const removed = rows.length - next.length;
      if (!removed) return false;
      await writeAllRows(dataPath, next);
      return true;
    });
  }

  async function clearByOrg(orgId) {
    const targetOrgId = toPublicId(orgId);
    if (!targetOrgId) throw new Error('orgId is required.');
    return queueWrite(async () => {
      const rows = await getAll();
      const next = rows.filter((row) => !idsEqual(row?.orgId, targetOrgId));
      const removed = rows.length - next.length;
      if (removed > 0) await writeAllRows(dataPath, next);
      return { removed, remaining: next.length };
    });
  }

  return {
    getAll,
    getById,
    add,
    update,
    remove,
    clearByOrg
  };
}

module.exports = {
  isPlainObject,
  cleanString,
  cleanId,
  cleanInteger,
  cleanNumber,
  cleanBoolean,
  cleanDateOnly,
  cleanIsoUtc,
  cleanStringArray,
  cleanIdArray,
  createJsonEntityModel
};
