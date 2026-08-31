const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { encrypt, decrypt } = require('../utils/encyptors');
const { idsEqual, toPublicId } = require('../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../data/emailProviderProfiles.json');
const SUPPORTED_PROVIDERS = Object.freeze(['resend']);

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

function cleanString(value, { max = 5000, allowEmpty = true } = {}) {
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
    const candidate = `EMPP${dateToken}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `EMPP${Date.now()}`;
}

function buildKeyHint(rawApiKey = '') {
  const key = String(rawApiKey || '').trim();
  if (!key) return '';
  if (key.length <= 4) return `***${key}`;
  return `***${key.slice(-4)}`;
}

function normalizeProviderName(value = '') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (!token) return 'resend';
  if (!SUPPORTED_PROVIDERS.includes(token)) {
    throw new Error(`Unsupported email provider '${token}'.`);
  }
  return token;
}

function normalizeVerifiedDomains(value = [], existing = []) {
  const source = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(/[,\n;]+/g) : []);
  const fallback = Array.isArray(existing) ? existing : [];
  const input = source.length ? source : fallback;
  const seen = new Set();
  const out = [];
  input.forEach((item) => {
    const domain = cleanString(item, { max: 253, allowEmpty: true }).toLowerCase().replace(/^@+/, '');
    if (!domain || seen.has(domain)) return;
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) {
      throw new Error(`Invalid domain '${domain}'.`);
    }
    seen.add(domain);
    out.push(domain);
  });
  return out;
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

function normalizeProfileRecord(record = {}, existing = null, strict = false) {
  const input = isPlainObject(record) ? record : {};
  const base = isPlainObject(existing) ? existing : {};
  const nowIso = new Date().toISOString();

  const id = cleanId(input.id || base.id, { max: 120, allowEmpty: true }) || '';
  const orgId = cleanId(input.orgId || base.orgId, { max: 120, allowEmpty: false });
  const provider = normalizeProviderName(input.provider || base.provider || 'resend');
  const label = cleanString(input.label || base.label, { max: 220, allowEmpty: true }) || 'Resend Profile';
  const defaultFromEmail = cleanString(
    hasOwn(input, 'defaultFromEmail') ? input.defaultFromEmail : base.defaultFromEmail,
    { max: 320, allowEmpty: true }
  ) || '';
  const verifiedDomains = normalizeVerifiedDomains(
    hasOwn(input, 'verifiedDomains') ? input.verifiedDomains : undefined,
    base.verifiedDomains || []
  );
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

  const creator = sanitizeCreator(input.creator || base.creator, { orgId });
  const audit = sanitizeAudit(input.audit || {}, { creator, existingAudit: base.audit || null });

  if (strict) {
    if (!orgId) throw new Error('Organization is required.');
    if (!label) throw new Error('Profile label is required.');
    if (!apiKeyEncrypted) throw new Error('API key is required.');
  }

  return {
    ...base,
    id,
    orgId,
    provider,
    label,
    defaultFromEmail,
    verifiedDomains,
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

function sanitizeProfileForRead(record = {}) {
  const row = isPlainObject(record) ? { ...record } : {};
  delete row.apiKeyEncrypted;
  row.apiKeyMasked = cleanString(row.apiKeyHint, { max: 30, allowEmpty: true }) || 'Not set';
  row.hasApiKey = Boolean(row.apiKeyHint);
  row.verifiedDomains = normalizeVerifiedDomains(row.verifiedDomains || [], []);
  return row;
}

function buildCompositeKey(row = {}) {
  return `${toPublicId(row?.orgId) || ''}::${cleanString(row?.label, { max: 220, allowEmpty: true }).toLowerCase()}`;
}

function assertUniqueLabel(rows = [], targetRow = {}, excludeId = '') {
  const targetKey = buildCompositeKey(targetRow);
  if (!targetKey || targetKey === '::') return;
  const conflict = (Array.isArray(rows) ? rows : []).find((row) => {
    if (excludeId && idsEqual(row?.id, excludeId)) return false;
    return buildCompositeKey(row) === targetKey;
  });
  if (conflict) {
    throw new Error('A provider profile with this label already exists in the selected organization.');
  }
}

async function readAllProfiles() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve email provider profiles.');
  }
}

async function getProfileById(id) {
  const rows = await readAllProfiles();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function addProfile(payload = {}) {
  return queueWrite(async () => {
    const rows = await readAllProfiles();
    const normalized = normalizeProfileRecord(payload, null, true);
    normalized.id = normalized.id || generateId(rows);
    if (rows.some((row) => idsEqual(row?.id, normalized.id))) {
      throw new Error(`Provider profile id '${normalized.id}' already exists.`);
    }
    assertUniqueLabel(rows, normalized, '');

    if (normalized.isDefault) {
      rows.forEach((row) => {
        if (!idsEqual(row?.orgId, normalized.orgId)) return;
        row.isDefault = false;
      });
    }

    rows.push(normalized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function updateProfile(id, payload = {}) {
  return queueWrite(async () => {
    const rows = await readAllProfiles();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) throw new Error('Email provider profile not found.');

    const existing = rows[index];
    const normalized = normalizeProfileRecord(
      {
        ...existing,
        ...(isPlainObject(payload) ? payload : {}),
        id: existing.id,
        orgId: cleanId(payload.orgId || existing.orgId, { max: 120, allowEmpty: false })
      },
      existing,
      !payload.apiKey && !existing.apiKeyEncrypted
    );
    assertUniqueLabel(rows, normalized, existing.id);

    if (normalized.isDefault) {
      rows.forEach((row) => {
        if (idsEqual(row?.id, normalized.id)) return;
        if (!idsEqual(row?.orgId, normalized.orgId)) return;
        row.isDefault = false;
      });
    }

    rows[index] = normalized;
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function deleteProfile(id) {
  return queueWrite(async () => {
    const rows = await readAllProfiles();
    const filtered = rows.filter((row) => !idsEqual(row?.id, id));
    if (filtered.length === rows.length) return false;
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

async function getDecryptedApiKeyById(id) {
  const rows = await readAllProfiles();
  const target = rows.find((row) => idsEqual(row?.id, id));
  if (!target) return null;
  if (!target.apiKeyEncrypted) return null;
  return decrypt(target.apiKeyEncrypted);
}

module.exports = {
  normalizeProfileRecord,
  sanitizeProfileForRead,
  normalizeVerifiedDomains,
  getAllProfiles: readAllProfiles,
  getProfileById,
  addProfile,
  updateProfile,
  deleteProfile,
  getDecryptedApiKeyById,
  generateId
};
