const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('../fileQueue');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../../../../data/pteAiTokenUsages.json');
const VALID_STATUSES = new Set(['success', 'failed']);

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

function cleanIsoDateTime(value, { allowEmpty = false } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid datetime value.');
  return parsed.toISOString();
}

function cleanNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) return null;
  return numeric;
}

function normalizeStatus(value, fallback = 'success') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (VALID_STATUSES.has(token)) return token;
  const fallbackToken = cleanString(fallback, { max: 40, allowEmpty: true }).toLowerCase();
  return VALID_STATUSES.has(fallbackToken) ? fallbackToken : 'success';
}

function sanitizeCreator(rawCreator = {}, fallback = {}) {
  const input = isPlainObject(rawCreator) ? rawCreator : {};
  const source = isPlainObject(fallback) ? fallback : {};
  const type = cleanString(input.type || source.type, { max: 20, allowEmpty: true }).toLowerCase() === 'system'
    ? 'system'
    : 'user';
  const userId = cleanId(input.userId || source.userId, { max: 120, allowEmpty: true }) || '';
  if (type === 'system' || !userId) {
    return {
      type: 'system',
      displayName: 'System',
      userId: '',
      username: '',
      email: '',
      orgId: cleanId(input.orgId || source.orgId, { max: 120, allowEmpty: true }) || ''
    };
  }
  return {
    type: 'user',
    displayName: cleanString(input.displayName || source.displayName, { max: 180, allowEmpty: true }) || userId,
    userId,
    username: cleanString(input.username || source.username, { max: 120, allowEmpty: true }) || '',
    email: cleanString(input.email || source.email, { max: 220, allowEmpty: true }) || '',
    orgId: cleanId(input.orgId || source.orgId, { max: 120, allowEmpty: true }) || ''
  };
}

function sanitizeAudit(rawAudit = {}, { creator = null, existingAudit = null } = {}) {
  const source = isPlainObject(rawAudit) ? rawAudit : {};
  const existing = isPlainObject(existingAudit) ? existingAudit : {};
  const nowIso = new Date().toISOString();
  const actor = String(creator?.type || '').toLowerCase() === 'system'
    ? 'System'
    : (cleanId(creator?.userId, { max: 120, allowEmpty: true }) || 'System');

  return {
    createUser: cleanString(source.createUser || existing.createUser, { max: 120, allowEmpty: true }) || actor,
    createDateTime: cleanIsoDateTime(source.createDateTime || existing.createDateTime, { allowEmpty: true }) || nowIso,
    lastUpdateUser: cleanString(source.lastUpdateUser || existing.lastUpdateUser, { max: 120, allowEmpty: true }) || actor,
    lastUpdateDateTime: cleanIsoDateTime(source.lastUpdateDateTime || existing.lastUpdateDateTime, { allowEmpty: true }) || nowIso
  };
}

function sanitizeUsageObject(rawUsage = {}, fallback = {}) {
  const source = isPlainObject(rawUsage) ? rawUsage : {};
  const seed = isPlainObject(fallback) ? fallback : {};
  return {
    promptTokenCount: cleanNumberOrNull(source.promptTokenCount ?? seed.promptTokenCount),
    candidatesTokenCount: cleanNumberOrNull(source.candidatesTokenCount ?? seed.candidatesTokenCount),
    totalTokenCount: cleanNumberOrNull(source.totalTokenCount ?? seed.totalTokenCount),
    cachedContentTokenCount: cleanNumberOrNull(source.cachedContentTokenCount ?? seed.cachedContentTokenCount)
  };
}

function buildDateToken(value) {
  return String(value || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
}

function generateId(rows = []) {
  const existing = new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => String(row?.id || '').trim())
      .filter(Boolean)
  );
  const dateToken = buildDateToken();
  for (let i = 0; i < 300; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `PTEAIU${dateToken}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `PTEAIU${Date.now()}`;
}

function normalizeTokenUsageRecord(raw = {}, existing = null, strict = false) {
  const input = isPlainObject(raw) ? raw : {};
  const prev = isPlainObject(existing) ? existing : {};
  const nowIso = new Date().toISOString();

  const orgId = toPublicId(input.orgId || prev.orgId) || '';
  const userId = toPublicId(input.userId || prev.userId) || '';
  const providerId = cleanString(input.providerId || prev.providerId, { max: 80, allowEmpty: true }).toLowerCase();
  const section = cleanString(input.section || prev.section, { max: 120, allowEmpty: true }).toUpperCase();
  const operation = cleanString(input.operation || prev.operation, { max: 120, allowEmpty: true }).toUpperCase();
  const objectId = cleanId(input.objectId || prev.objectId, { max: 180, allowEmpty: true }) || '';

  const usage = sanitizeUsageObject(input.usage, prev.usage);
  const promptTokenCount = cleanNumberOrNull(
    hasOwn(input, 'promptTokenCount') ? input.promptTokenCount : usage.promptTokenCount
  );
  const candidatesTokenCount = cleanNumberOrNull(
    hasOwn(input, 'candidatesTokenCount') ? input.candidatesTokenCount : usage.candidatesTokenCount
  );
  const totalTokenCount = cleanNumberOrNull(
    hasOwn(input, 'totalTokenCount') ? input.totalTokenCount : usage.totalTokenCount
  );
  const cachedContentTokenCount = cleanNumberOrNull(
    hasOwn(input, 'cachedContentTokenCount') ? input.cachedContentTokenCount : usage.cachedContentTokenCount
  );

  const creator = sanitizeCreator(input.creator || prev.creator, {
    type: 'user',
    userId,
    orgId,
    displayName: userId
  });
  const audit = sanitizeAudit(input.audit || {}, { creator, existingAudit: prev.audit || null });
  const consumedAt = cleanIsoDateTime(input.consumedAt || prev.consumedAt, { allowEmpty: true }) || nowIso;
  const status = normalizeStatus(input.status || prev.status || 'success', 'success');

  if (strict) {
    if (!orgId) throw new Error('orgId is required.');
    if (!userId) throw new Error('userId is required.');
    if (!providerId) throw new Error('providerId is required.');
    if (!section) throw new Error('section is required.');
    if (!operation) throw new Error('operation is required.');
    if (!objectId) throw new Error('objectId is required.');
  }

  return {
    ...prev,
    id: cleanId(input.id || prev.id, { max: 120, allowEmpty: true }) || '',
    consumedAt,
    orgId,
    userId,
    section,
    operation,
    objectId,
    providerId,
    providerRecordId: toPublicId(input.providerRecordId || prev.providerRecordId) || null,
    providerRecordName: cleanString(input.providerRecordName || prev.providerRecordName, { max: 260, allowEmpty: true }) || null,
    modelUsed: cleanString(input.modelUsed || prev.modelUsed, { max: 220, allowEmpty: true }) || null,
    requestLabel: cleanString(input.requestLabel || prev.requestLabel, { max: 220, allowEmpty: true }) || null,
    messageCount: cleanNumberOrNull(input.messageCount ?? prev.messageCount),
    hasSystemInstruction: Boolean(hasOwn(input, 'hasSystemInstruction') ? input.hasSystemInstruction : prev.hasSystemInstruction),
    status,
    errorMessage: cleanString(input.errorMessage || prev.errorMessage, { max: 4000, allowEmpty: true }) || null,
    usage: {
      promptTokenCount,
      candidatesTokenCount,
      totalTokenCount,
      cachedContentTokenCount
    },
    promptTokenCount,
    candidatesTokenCount,
    totalTokenCount,
    cachedContentTokenCount,
    requestMeta: isPlainObject(input.requestMeta)
      ? input.requestMeta
      : (isPlainObject(prev.requestMeta) ? prev.requestMeta : {}),
    creator,
    audit,
    createdAt: cleanIsoDateTime(prev.createdAt || input.createdAt, { allowEmpty: true }) || nowIso,
    updatedAt: nowIso
  };
}

async function getAllTokenUsages() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve PTE AI token usage records.');
  }
}

async function getTokenUsageById(id) {
  const rows = await getAllTokenUsages();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function addTokenUsage(payload = {}) {
  return queueWrite(async () => {
    const rows = await getAllTokenUsages();
    const normalized = normalizeTokenUsageRecord(payload, null, true);
    normalized.id = normalized.id || generateId(rows);
    if (rows.some((row) => idsEqual(row?.id, normalized.id))) {
      throw new Error(`PTE AI token usage id '${normalized.id}' already exists.`);
    }
    rows.push(normalized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

module.exports = {
  normalizeTokenUsageRecord,
  getAllTokenUsages,
  getTokenUsageById,
  addTokenUsage
};
