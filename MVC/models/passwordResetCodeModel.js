const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { idsEqual, toPublicId } = require('../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../data/passwordResetCodes.json');

if (!fsSync.existsSync(path.dirname(DATA_PATH))) {
  fsSync.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}
if (!fsSync.existsSync(DATA_PATH)) {
  fsSync.writeFileSync(DATA_PATH, '[]');
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
    const candidate = `PRC${dateToken}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `PRC${Date.now()}`;
}

function normalizeRecord(record = {}, existing = null, strict = false) {
  const input = isPlainObject(record) ? record : {};
  const base = isPlainObject(existing) ? existing : {};
  const nowIso = new Date().toISOString();

  const id = cleanId(input.id || base.id, { max: 120, allowEmpty: true }) || '';
  const orgId = cleanId(input.orgId || base.orgId, { max: 120, allowEmpty: false });
  const userId = cleanId(input.userId || base.userId, { max: 120, allowEmpty: false });
  const email = cleanString(input.email || base.email, { max: 320, allowEmpty: false }).toLowerCase();
  const codeHash = cleanString(input.codeHash || base.codeHash, { max: 500, allowEmpty: false });
  const status = cleanString(input.status || base.status || 'active', { max: 20, allowEmpty: true }).toLowerCase() || 'active';
  const verificationToken = cleanString(input.verificationToken || base.verificationToken, { max: 160, allowEmpty: true }) || '';
  const verifiedAt = cleanIsoDateTime(input.verifiedAt || base.verifiedAt, { allowEmpty: true }) || '';
  const usedAt = cleanIsoDateTime(input.usedAt || base.usedAt, { allowEmpty: true }) || '';
  const revokedAt = cleanIsoDateTime(input.revokedAt || base.revokedAt, { allowEmpty: true }) || '';
  const expiresAt = cleanIsoDateTime(input.expiresAt || base.expiresAt, { allowEmpty: false });
  const attemptCount = Math.max(0, Number.parseInt(String(input.attemptCount ?? base.attemptCount ?? 0), 10) || 0);
  const maxAttempts = Math.max(1, Number.parseInt(String(input.maxAttempts ?? base.maxAttempts ?? 8), 10) || 8);
  const deliveryMethodRaw = cleanString(input.deliveryMethod || base.deliveryMethod || 'email', { max: 20, allowEmpty: true }).toLowerCase();
  const deliveryMethod = deliveryMethodRaw === 'sms' ? 'sms' : 'email';
  const deliveryProvider = cleanString(input.deliveryProvider || base.deliveryProvider, { max: 80, allowEmpty: true }) || '';
  const deliveryPhoneE164 = cleanString(input.deliveryPhoneE164 || base.deliveryPhoneE164, { max: 30, allowEmpty: true }) || '';
  const deliveryReference = cleanString(input.deliveryReference || base.deliveryReference, { max: 180, allowEmpty: true }) || '';
  const deliveryFallbackUsed = Boolean(input.deliveryFallbackUsed ?? base.deliveryFallbackUsed ?? false);
  const verificationSource = cleanString(input.verificationSource || base.verificationSource, { max: 80, allowEmpty: true }) || '';

  if (strict) {
    if (!orgId) throw new Error('Organization is required.');
    if (!userId) throw new Error('User is required.');
    if (!email) throw new Error('Email is required.');
    if (!codeHash) throw new Error('Code hash is required.');
    if (!expiresAt) throw new Error('Expiry is required.');
  }

  return {
    ...base,
    id,
    orgId: toPublicId(orgId),
    userId: toPublicId(userId),
    email,
    codeHash,
    status,
    verificationToken,
    verifiedAt,
    usedAt,
    revokedAt,
    expiresAt,
    attemptCount,
    maxAttempts,
    deliveryMethod,
    deliveryProvider,
    deliveryPhoneE164,
    deliveryReference,
    deliveryFallbackUsed,
    verificationSource,
    createdAt: cleanIsoDateTime(base.createdAt, { allowEmpty: true }) || nowIso,
    updatedAt: nowIso
  };
}

async function readAllCodes() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to read password reset code records.');
  }
}

async function getCodeById(id) {
  const rows = await readAllCodes();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function addCode(payload = {}) {
  return queueWrite(async () => {
    const rows = await readAllCodes();
    const normalized = normalizeRecord(payload, null, true);
    normalized.id = normalized.id || generateId(rows);
    if (rows.some((row) => idsEqual(row?.id, normalized.id))) {
      throw new Error(`Password reset code id '${normalized.id}' already exists.`);
    }
    rows.push(normalized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function updateCode(id, payload = {}) {
  return queueWrite(async () => {
    const rows = await readAllCodes();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) throw new Error('Password reset code not found.');
    const existing = rows[index];
    const normalized = normalizeRecord({ ...existing, ...(payload || {}), id: existing.id }, existing, true);
    rows[index] = normalized;
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function removeCode(id) {
  return queueWrite(async () => {
    const rows = await readAllCodes();
    const filtered = rows.filter((row) => !idsEqual(row?.id, id));
    if (filtered.length === rows.length) return false;
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

module.exports = {
  normalizeRecord,
  getAllCodes: readAllCodes,
  getCodeById,
  addCode,
  updateCode,
  removeCode,
  generateId
};
