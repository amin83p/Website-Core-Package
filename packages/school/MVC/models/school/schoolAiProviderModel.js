'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const {
  PROVIDER_VENDOR_OPTIONS,
  encrypt,
  isPlainObject,
  hasOwn,
  cleanString,
  cleanId,
  normalizeBoolean,
  cleanIsoDateTime,
  buildKeyHint,
  generateDatedId,
  normalizeModelsList,
  normalizeBannedUserIds,
  buildAudit
} = require('../../services/school/schoolAiModelUtils');

const DATA_PATH = path.join(resolveCoreRoot(), 'data/school/schoolAiProviders.json');
const ID_PREFIX = 'SCHAIP';
const VENDOR_IDS = new Set(PROVIDER_VENDOR_OPTIONS.map((row) => row.id));

if (!fsSync.existsSync(path.dirname(DATA_PATH))) {
  fsSync.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}
if (!fsSync.existsSync(DATA_PATH)) {
  fsSync.writeFileSync(DATA_PATH, '[]');
}

function normalizeProviderRecord(record = {}, existing = null, strict = false) {
  const input = isPlainObject(record) ? record : {};
  const base = isPlainObject(existing) ? existing : {};
  const nowIso = new Date().toISOString();
  const orgId = cleanId(input.orgId || base.orgId, { max: 120, allowEmpty: false });
  const providerId = cleanString(input.providerId || base.providerId || 'openai', { max: 80, allowEmpty: true }).toLowerCase();
  if (providerId && !VENDOR_IDS.has(providerId)) throw new Error('Unknown AI provider vendor.');
  const name = cleanString(input.name || base.name, { max: 220, allowEmpty: true }) || `${providerId} key`;
  const models = normalizeModelsList(input.models !== undefined ? input.models : base.models, { strict: false });
  const bannedUserIds = normalizeBannedUserIds(
    input.bannedUserIds !== undefined ? input.bannedUserIds : base.bannedUserIds
  );
  const incomingApiKey = cleanString(input.apiKey, { max: 8000, allowEmpty: true }) || '';
  let apiKeyEncrypted = cleanString(input.apiKeyEncrypted || base.apiKeyEncrypted, { max: 32000, allowEmpty: true }) || '';
  let apiKeyHint = cleanString(input.apiKeyHint || base.apiKeyHint, { max: 30, allowEmpty: true }) || '';
  if (incomingApiKey) {
    apiKeyEncrypted = encrypt(incomingApiKey);
    apiKeyHint = buildKeyHint(incomingApiKey);
  }
  const isDefault = hasOwn(input, 'isDefault') ? normalizeBoolean(input.isDefault, false) : normalizeBoolean(base.isDefault, false);
  const isActive = hasOwn(input, 'isActive') ? normalizeBoolean(input.isActive, true) : normalizeBoolean(base.isActive, true);
  const audit = buildAudit(input.lastUpdateUser || input.audit?.lastUpdateUser, input.audit || base.audit);

  if (strict) {
    if (!orgId) throw new Error('Organization is required.');
    if (!providerId) throw new Error('Provider vendor is required.');
    if (!apiKeyEncrypted) throw new Error('API key is required.');
  }

  return {
    ...base,
    id: cleanId(input.id || base.id, { max: 120, allowEmpty: true }) || '',
    orgId,
    name,
    providerId,
    project: cleanString(input.project || base.project, { max: 220, allowEmpty: true }) || '',
    location: cleanString(input.location || base.location, { max: 220, allowEmpty: true }) || '',
    baseUrl: cleanString(input.baseUrl || base.baseUrl, { max: 500, allowEmpty: true }) || '',
    notes: cleanString(input.notes || base.notes, { max: 4000, allowEmpty: true }) || '',
    models,
    bannedUserIds,
    isDefault,
    isActive,
    apiKeyEncrypted,
    apiKeyHint,
    audit,
    createdAt: cleanIsoDateTime(base.createdAt, { allowEmpty: true }) || nowIso,
    updatedAt: nowIso
  };
}

function sanitizeProviderForRead(record = {}) {
  const row = isPlainObject(record) ? { ...record } : {};
  const legacyPlain = cleanString(record.apiKey, { max: 8000, allowEmpty: true }) || '';
  delete row.apiKeyEncrypted;
  delete row.apiKey;
  row.apiKeyMasked = cleanString(row.apiKeyHint, { max: 30, allowEmpty: true })
    || (legacyPlain ? buildKeyHint(legacyPlain) : '')
    || 'Not set';
  row.hasApiKey = Boolean(row.apiKeyHint) || Boolean(record.apiKeyEncrypted) || Boolean(legacyPlain);
  row.modelCount = Array.isArray(row.models) ? row.models.length : 0;
  return row;
}

async function getAllProviders() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
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
    normalized.id = normalized.id || generateDatedId(ID_PREFIX, rows);
    if (normalized.isDefault) {
      rows.forEach((row) => {
        if (idsEqual(row?.orgId, normalized.orgId)) row.isDefault = false;
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
    if (index < 0) throw new Error('AI provider not found.');
    const existing = rows[index];
    const normalized = normalizeProviderRecord({ ...payload, id: existing.id, orgId: existing.orgId }, existing, false);
    if (!normalized.apiKeyEncrypted) throw new Error('API key is required.');
    if (normalized.isDefault) {
      rows.forEach((row, idx) => {
        if (idx === index) return;
        if (idsEqual(row?.orgId, normalized.orgId)) row.isDefault = false;
      });
    }
    rows[index] = normalized;
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function deleteProvider(id) {
  return queueWrite(async () => {
    const rows = await getAllProviders();
    const next = rows.filter((row) => !idsEqual(row?.id, id));
    if (next.length === rows.length) throw new Error('AI provider not found.');
    await fs.writeFile(DATA_PATH, JSON.stringify(next, null, 2));
    return true;
  });
}

module.exports = {
  DATA_PATH,
  normalizeProviderRecord,
  sanitizeProviderForRead,
  getAllProviders,
  getProviderById,
  addProvider,
  updateProvider,
  deleteProvider
};