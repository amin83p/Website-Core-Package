const fs = require('fs').promises;
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/ielts/ieltsCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { encrypt, decrypt } = requireCoreModule('MVC/utils/encyptors');

const dataPath = path.join(resolveCoreRoot(), 'data/ielts/apiProviders.json');
const DEFAULT_ORG_ID = 'SYSTEM';
const DEFAULT_PROVIDER_ID = 'google-gemini';

function normalizeString(value, fallback = '') {
  const out = String(value ?? '').trim();
  return out || fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function generateId() {
  return `api_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
}

function buildKeyHint(rawApiKey = '') {
  const key = String(rawApiKey || '').trim();
  if (!key) return '';
  if (key.length <= 4) return `***${key}`;
  return `***${key.slice(-4)}`;
}

function sanitizeForRead(record = {}) {
  return {
    ...record,
    apiKeyEncrypted: undefined,
    apiKeyMasked: normalizeString(record.apiKeyHint, 'Not set'),
    hasApiKey: Boolean(record.apiKeyEncrypted || record.apiKeyHint)
  };
}

async function ensureDataDir() {
  const dir = path.dirname(dataPath);
  try {
    await fs.access(dir);
  } catch (_) {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function getRawRecords() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(dataPath, JSON.stringify([], null, 2));
      return [];
    }
    throw error;
  }
}

function normalizeRecord(payload = {}, existing = null, strict = false) {
  const base = existing && typeof existing === 'object' ? existing : {};
  const now = new Date().toISOString();
  const id = normalizeString(payload.id ?? base.id);
  const userId = normalizeString(payload.userId ?? base.userId);
  const providerId = normalizeString(payload.providerId ?? base.providerId, DEFAULT_PROVIDER_ID).toLowerCase();
  const name = normalizeString(payload.name ?? base.name, `${providerId} key`);
  const modelId = normalizeString(payload.modelId ?? base.modelId, '');
  const project = normalizeString(payload.project ?? base.project, '');
  const location = normalizeString(payload.location ?? base.location, '');
  const notes = normalizeString(payload.notes ?? base.notes, '');
  const orgId = normalizeString(payload.orgId ?? base.orgId, DEFAULT_ORG_ID);
  const isDefault = normalizeBoolean(payload.isDefault, normalizeBoolean(base.isDefault, false));
  const isActive = normalizeBoolean(payload.isActive, normalizeBoolean(base.isActive, true));
  const createdBy = normalizeString(payload.createdBy ?? base.createdBy, userId || 'system');
  const updatedBy = normalizeString(payload.updatedBy ?? base.updatedBy, userId || 'system');

  const incomingApiKey = normalizeString(payload.apiKey, '');
  let apiKeyEncrypted = normalizeString(base.apiKeyEncrypted, '');
  let apiKeyHint = normalizeString(base.apiKeyHint, '');

  if (incomingApiKey) {
    apiKeyEncrypted = encrypt(incomingApiKey);
    apiKeyHint = buildKeyHint(incomingApiKey);
  }

  if (strict) {
    if (!id) throw new Error('Provider ID is required.');
    if (!userId) throw new Error('User ID is required.');
    if (!providerId) throw new Error('Provider is required.');
    if (!apiKeyEncrypted) throw new Error('API key is required.');
  }

  return {
    ...base,
    id,
    name,
    providerId,
    modelId,
    project,
    location,
    notes,
    userId,
    orgId,
    isDefault,
    isActive,
    apiKeyEncrypted,
    apiKeyHint,
    createdBy,
    updatedBy,
    createdAt: base.createdAt || now,
    updatedAt: now
  };
}

async function getAllApiProviders() {
  const rows = await getRawRecords();
  return rows.map((row) => sanitizeForRead(row));
}

async function getApiProviderById(id) {
  const rows = await getRawRecords();
  const match = rows.find((row) => String(row?.id || '') === String(id || ''));
  if (!match) return null;
  return sanitizeForRead(match);
}

async function saveApiProvider(payload = {}) {
  return queueWrite(async () => {
    const rows = await getRawRecords();
    const requestedId = normalizeString(payload.id, '');
    const userId = normalizeString(payload.userId, '');
    const existingIndex = requestedId
      ? rows.findIndex((row) => String(row?.id || '') === requestedId)
      : -1;
    const existing = existingIndex >= 0 ? rows[existingIndex] : null;
    const id = requestedId || generateId();
    const merged = normalizeRecord({ ...payload, id }, existing, true);

    if (existingIndex >= 0) rows[existingIndex] = merged;
    else rows.push(merged);

    const mergedOrgId = normalizeString(merged.orgId, '');
    if (merged.isDefault && userId) {
      for (let i = 0; i < rows.length; i += 1) {
        if (rows[i].id === merged.id) continue;
        if (String(rows[i].userId || '') !== userId) continue;
        if (mergedOrgId && String(rows[i].orgId || '') !== mergedOrgId) continue;
        rows[i].isDefault = false;
      }
    }

    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return sanitizeForRead(merged);
  });
}

async function deleteApiProvider(id, userId = null) {
  return queueWrite(async () => {
    const rows = await getRawRecords();
    const targetId = String(id || '').trim();
    const scopedUser = String(userId || '').trim();
    const filtered = rows.filter((row) => {
      if (String(row?.id || '') !== targetId) return true;
      if (!scopedUser) return false;
      return String(row?.userId || '') !== scopedUser;
    });
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
    return true;
  });
}

async function getDecryptedApiKeyById(id) {
  const rows = await getRawRecords();
  const target = rows.find((row) => String(row?.id || '') === String(id || ''));
  if (!target) return null;
  if (!target.apiKeyEncrypted) return null;
  return decrypt(target.apiKeyEncrypted);
}

module.exports = {
  getAllApiProviders,
  getApiProviderById,
  saveApiProvider,
  deleteApiProvider,
  getDecryptedApiKeyById
};
