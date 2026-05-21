const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('../fileQueue');
const { encrypt, decrypt } = require('../../utils/encyptors');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../../data/pteAiProviders.json');
const DEFAULT_PROVIDER_ID = 'google-gemini';

if (!fsSync.existsSync(path.dirname(DATA_PATH))) {
  fsSync.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}
if (!fsSync.existsSync(DATA_PATH)) {
  fsSync.writeFileSync(DATA_PATH, '[]');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function cleanString(value, { max = 500, allowEmpty = true } = {}) {
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

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function cleanIsoDateTime(value, { allowEmpty = false } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid datetime value.');
  return parsed.toISOString();
}

function buildDateToken(value) {
  return String(value || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
}

function generateId(existingRows = []) {
  const existing = new Set(
    (Array.isArray(existingRows) ? existingRows : [])
      .map((row) => String(row?.id || '').trim())
      .filter(Boolean)
  );
  const dateToken = buildDateToken();
  for (let i = 0; i < 300; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `PTEAIP${dateToken}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `PTEAIP${Date.now()}`;
}

function buildKeyHint(rawApiKey = '') {
  const key = String(rawApiKey || '').trim();
  if (!key) return '';
  if (key.length <= 4) return `***${key}`;
  return `***${key.slice(-4)}`;
}

function sanitizeCreator(rawCreator = {}, fallback = {}) {
  const input = isPlainObject(rawCreator) ? rawCreator : {};
  const fallbackInput = isPlainObject(fallback) ? fallback : {};
  const type = cleanString(input.type || fallbackInput.type, { max: 20, allowEmpty: true }).toLowerCase() === 'system'
    ? 'system'
    : 'user';
  const userId = cleanId(input.userId || fallbackInput.userId, { max: 120, allowEmpty: true }) || '';

  if (type === 'system' || !userId) {
    return {
      type: 'system',
      displayName: 'System',
      userId: '',
      username: '',
      email: '',
      orgId: cleanId(input.orgId || fallbackInput.orgId, { max: 120, allowEmpty: true }) || ''
    };
  }

  return {
    type: 'user',
    displayName: cleanString(input.displayName || fallbackInput.displayName, { max: 180, allowEmpty: true }) || userId,
    userId,
    username: cleanString(input.username || fallbackInput.username, { max: 140, allowEmpty: true }) || '',
    email: cleanString(input.email || fallbackInput.email, { max: 220, allowEmpty: true }) || '',
    orgId: cleanId(input.orgId || fallbackInput.orgId, { max: 120, allowEmpty: true }) || ''
  };
}

function sanitizeAudit(rawAudit = {}, { creator = null, existingAudit = null } = {}) {
  const nowIso = new Date().toISOString();
  const source = isPlainObject(rawAudit) ? rawAudit : {};
  const existing = isPlainObject(existingAudit) ? existingAudit : {};
  const creatorType = String(creator?.type || '').toLowerCase();
  const creatorUser = creatorType === 'system'
    ? 'System'
    : (cleanId(creator?.userId, { max: 120, allowEmpty: true }) || 'System');

  return {
    createUser: cleanString(source.createUser || existing.createUser, { max: 120, allowEmpty: true }) || creatorUser,
    createDateTime: cleanIsoDateTime(source.createDateTime || existing.createDateTime, { allowEmpty: true }) || nowIso,
    lastUpdateUser: cleanString(source.lastUpdateUser, { max: 120, allowEmpty: true }) || creatorUser,
    lastUpdateDateTime: cleanIsoDateTime(source.lastUpdateDateTime, { allowEmpty: true }) || nowIso
  };
}

function normalizeProviderRecord(record = {}, existing = null, strict = false) {
  const input = isPlainObject(record) ? record : {};
  const base = isPlainObject(existing) ? existing : {};
  const nowIso = new Date().toISOString();

  const id = cleanId(input.id || base.id, { max: 120, allowEmpty: true }) || '';
  const orgId = cleanId(input.orgId || base.orgId, { max: 120, allowEmpty: false });
  const userId = cleanId(input.userId || base.userId, { max: 120, allowEmpty: false });
  const providerId = cleanString(input.providerId || base.providerId || DEFAULT_PROVIDER_ID, { max: 80, allowEmpty: true }).toLowerCase();
  const name = cleanString(input.name || base.name, { max: 220, allowEmpty: true }) || `${providerId || DEFAULT_PROVIDER_ID} key`;
  const modelId = cleanString(input.modelId || base.modelId, { max: 220, allowEmpty: true }) || '';
  const project = cleanString(input.project || base.project, { max: 220, allowEmpty: true }) || '';
  const location = cleanString(input.location || base.location, { max: 220, allowEmpty: true }) || '';
  const notes = cleanString(input.notes || base.notes, { max: 4000, allowEmpty: true }) || '';
  const isDefault = hasOwn(input, 'isDefault')
    ? normalizeBoolean(input.isDefault, false)
    : normalizeBoolean(base.isDefault, false);
  const isActive = hasOwn(input, 'isActive')
    ? normalizeBoolean(input.isActive, true)
    : normalizeBoolean(base.isActive, true);

  const incomingApiKey = cleanString(input.apiKey, { max: 8000, allowEmpty: true }) || '';
  let apiKeyEncrypted = cleanString(input.apiKeyEncrypted || base.apiKeyEncrypted, { max: 16000, allowEmpty: true }) || '';
  let apiKeyHint = cleanString(input.apiKeyHint || base.apiKeyHint, { max: 30, allowEmpty: true }) || '';
  if (incomingApiKey) {
    apiKeyEncrypted = encrypt(incomingApiKey);
    apiKeyHint = buildKeyHint(incomingApiKey);
  }

  const creator = sanitizeCreator(input.creator || base.creator, {
    type: 'user',
    userId,
    orgId,
    displayName: userId
  });
  const audit = sanitizeAudit(input.audit || {}, { creator, existingAudit: base.audit || null });

  if (strict) {
    if (!orgId) throw new Error('Organization is required.');
    if (!userId) throw new Error('User id is required.');
    if (!providerId) throw new Error('Provider is required.');
    if (!apiKeyEncrypted) throw new Error('API key is required.');
  }

  return {
    ...base,
    id,
    orgId,
    userId,
    name,
    providerId,
    modelId,
    project,
    location,
    notes,
    isDefault,
    isActive,
    apiKeyEncrypted,
    apiKeyHint,
    creator,
    audit,
    createdAt: cleanIsoDateTime(base.createdAt, { allowEmpty: true }) || nowIso,
    updatedAt: nowIso
  };
}

function sanitizeProviderForRead(record = {}) {
  const row = isPlainObject(record) ? { ...record } : {};
  delete row.apiKeyEncrypted;
  row.apiKeyMasked = cleanString(row.apiKeyHint, { max: 30, allowEmpty: true }) || 'Not set';
  row.hasApiKey = Boolean(row.apiKeyHint);
  return row;
}

async function getAllProviders() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve PTE AI providers.');
  }
}

async function getProviderById(id) {
  const rows = await getAllProviders();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function addProvider(payload = {}) {
  return queueWrite(async () => {
    const rows = await getAllProviders();
    const normalized = normalizeProviderRecord(payload, null, true);
    normalized.id = normalized.id || generateId(rows);
    if (rows.some((row) => idsEqual(row?.id, normalized.id))) {
      throw new Error(`Provider id '${normalized.id}' already exists.`);
    }

    if (normalized.isDefault) {
      rows.forEach((row) => {
        if (!idsEqual(row?.orgId, normalized.orgId)) return;
        if (!idsEqual(row?.userId, normalized.userId)) return;
        row.isDefault = false;
      });
    }

    rows.push(normalized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function updateProvider(id, payload = {}) {
  return queueWrite(async () => {
    const rows = await getAllProviders();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) throw new Error('PTE AI provider not found.');

    const existing = rows[index];
    const normalized = normalizeProviderRecord(
      {
        ...existing,
        ...(isPlainObject(payload) ? payload : {}),
        id: existing.id,
        orgId: cleanId(payload.orgId || existing.orgId, { max: 120, allowEmpty: false }),
        userId: cleanId(payload.userId || existing.userId, { max: 120, allowEmpty: false })
      },
      existing,
      true
    );

    if (normalized.isDefault) {
      rows.forEach((row) => {
        if (idsEqual(row?.id, normalized.id)) return;
        if (!idsEqual(row?.orgId, normalized.orgId)) return;
        if (!idsEqual(row?.userId, normalized.userId)) return;
        row.isDefault = false;
      });
    }

    rows[index] = normalized;
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function deleteProvider(id, scope = {}) {
  return queueWrite(async () => {
    const rows = await getAllProviders();
    const scopedUserId = toPublicId(scope?.userId || '');
    const scopedOrgId = toPublicId(scope?.orgId || '');
    const filtered = rows.filter((row) => {
      if (!idsEqual(row?.id, id)) return true;
      if (scopedOrgId && !idsEqual(row?.orgId, scopedOrgId)) return true;
      if (scopedUserId && !idsEqual(row?.userId, scopedUserId)) return true;
      return false;
    });
    if (filtered.length === rows.length) return false;
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

async function getDecryptedApiKeyById(id) {
  const rows = await getAllProviders();
  const target = rows.find((row) => idsEqual(row?.id, id));
  if (!target) return null;
  if (!target.apiKeyEncrypted) return null;
  return decrypt(target.apiKeyEncrypted);
}

module.exports = {
  normalizeProviderRecord,
  sanitizeProviderForRead,
  getAllProviders,
  getProviderById,
  addProvider,
  updateProvider,
  deleteProvider,
  getDecryptedApiKeyById,
  generateId
};
