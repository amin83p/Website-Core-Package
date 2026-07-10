const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { encrypt, decrypt } = require('../utils/encyptors');
const { toPublicId, idsEqual } = require('../utils/idAdapter');
const adminAuthorityService = require('./adminAuthorityService');
const { queueWrite } = require('../models/fileQueue');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');

const STORE_PATH = path.join(__dirname, '../../data/adminTotpSecrets.json');
const TOTP_MONGO_COLLECTION = 'adminTotpSecrets';
const ISSUER = 'Website Core Admin';
const PENDING_TTL_MS = 15 * 60 * 1000;
/** Lifetime cap on self-service key changes (counts only successfully confirmed enrollments). */
const MAX_TOTP_REGENERATIONS = 5;

authenticator.options = { window: 1, step: 30, digits: 6 };

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeStore(store) {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function normalizeMongoTotpDoc(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const { _id, ...rest } = doc;
  return rest;
}

/** Returns the record when Mongo is reachable and has one, null when reachable but empty, undefined when Mongo is unavailable. */
async function getRecordFromMongo(key) {
  try {
    const doc = await getMongoCollection(TOTP_MONGO_COLLECTION).findOne({ userId: key });
    return normalizeMongoTotpDoc(doc);
  } catch (_) {
    return undefined;
  }
}

/** Best-effort Mongo write; failures are swallowed so the JSON fallback write can still proceed. */
async function writeRecordToMongo(key, record) {
  try {
    const collection = getMongoCollection(TOTP_MONGO_COLLECTION);
    if (!record) {
      await collection.deleteOne({ userId: key });
    } else {
      await collection.updateOne(
        { userId: key },
        { $set: { ...record, userId: key, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
    }
  } catch (_) {
    // Mongo unavailable/erroring — JSON fallback below remains the source of truth for this write.
  }
}

function userKey(userId) {
  return toPublicId(userId) || String(userId || '').trim();
}

function encryptSecret(plainSecret) {
  return encrypt(String(plainSecret || ''));
}

function decryptSecret(secretEnc) {
  if (!secretEnc) return '';
  return decrypt(String(secretEnc), null, { silent: true }) || '';
}

function currentStep() {
  return Math.floor(Date.now() / 1000 / 30);
}

function formatSecretGrouped(secret) {
  const compact = String(secret || '').replace(/\s+/g, '').toUpperCase();
  return compact.replace(/(.{4})/g, '$1 ').trim();
}

function buildOtpauthUrl({ secret, accountName, issuer = ISSUER }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret: String(secret || '').replace(/\s+/g, ''),
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30'
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function isSystemSuperAdminUser(user) {
  if (!user) return false;
  if (adminAuthorityService.isSuperAdmin(user)) return true;
  if (typeof adminAuthorityService.isSystemAdmin === 'function' && adminAuthorityService.isSystemAdmin(user)) {
    return true;
  }
  return false;
}

/** Session user may enroll/use admin TOTP when they hold any admin privilege. */
function isTotpEligibleUser(user) {
  if (!user) return false;
  return adminAuthorityService.hasAnyAdminPrivilege(user);
}

/** @deprecated Prefer isTotpEligibleUser for session users. Kept for tests/compat. */
function isTotpEligibleTarget(user) {
  return isTotpEligibleUser(user);
}

/** Self-only: viewer may manage TOTP only for themselves when eligible. */
function canManageOwnTotp(user) {
  if (!user) return false;
  if (!isTotpEligibleUser(user)) return false;
  return Boolean(userKey(user.id || user.userId));
}

/** @deprecated Prefer canManageOwnTotp. Previously allowed admin-to-admin via user form. */
function canManageTotp(viewer, targetUser) {
  if (!viewer || !targetUser) return false;
  if (!canManageOwnTotp(viewer)) return false;
  return idsEqual(userKey(viewer.id || viewer.userId), userKey(targetUser.id || targetUser.userId));
}

function remainingRegenerations(regenCount) {
  return Math.max(0, MAX_TOTP_REGENERATIONS - Number(regenCount || 0));
}

function publicStatus(record) {
  const regenCount = Number(record?.regenCount || 0);
  if (!record || !record.enabled || !record.secretEnc) {
    return { enabled: false, enrolledAt: null, regenCount, remainingRegenerations: remainingRegenerations(regenCount) };
  }
  return {
    enabled: true,
    enrolledAt: record.enrolledAt || null,
    regenCount,
    remainingRegenerations: remainingRegenerations(regenCount)
  };
}

async function getRecord(userId) {
  const key = userKey(userId);
  if (!key) return null;

  // Mongo is the primary store; only fall back to the JSON file when Mongo is
  // unavailable or does not (yet) have a document for this user.
  const mongoRecord = await getRecordFromMongo(key);
  if (mongoRecord) return mongoRecord;

  const store = await readStore();
  const row = store[key];
  return row && typeof row === 'object' ? row : null;
}

async function saveRecord(userId, record) {
  const key = userKey(userId);
  if (!key) throw new Error('User id is required.');
  await queueWrite(async () => {
    await writeRecordToMongo(key, record);

    // Always mirror to JSON too: keeps the fallback path current when Mongo
    // succeeds, and is the only persistence when Mongo write failed above.
    const store = await readStore();
    if (!record) {
      delete store[key];
    } else {
      store[key] = record;
    }
    await writeStore(store);
  });
}

function getPendingFromSession(req, userId) {
  const pending = req?.session?.adminTotpPending;
  if (!pending || typeof pending !== 'object') return null;
  if (!idsEqual(pending.userId, userKey(userId))) return null;
  if (!pending.secretEnc || !pending.createdAt) return null;
  if (Date.now() - Number(pending.createdAt) > PENDING_TTL_MS) return null;
  return pending;
}

function clearPending(req) {
  if (req?.session) delete req.session.adminTotpPending;
}

async function getStatus(userId) {
  return publicStatus(await getRecord(userId));
}

async function beginEnrollment({ req, targetUser }) {
  const targetId = userKey(targetUser?.id);
  if (!targetId) throw new Error('Target user is required.');

  const existing = await getRecord(targetId);
  const regenCount = Number(existing?.regenCount || 0);
  if (regenCount >= MAX_TOTP_REGENERATIONS) {
    const err = new Error(
      `You have used all ${MAX_TOTP_REGENERATIONS} authenticator key changes allowed for this account. Contact a system administrator to reset it.`
    );
    err.code = 'REGEN_LIMIT_REACHED';
    throw err;
  }

  // Requesting a new key immediately invalidates any currently active key, so a
  // user (including the super admin with no recovery code) is never locked out
  // waiting on an old key while a new one is pending confirmation.
  if (existing?.enabled && existing?.secretEnc) {
    await saveRecord(targetId, {
      ...existing,
      enabled: false,
      secretEnc: ''
    });
  }

  const secret = authenticator.generateSecret();
  const accountName = String(targetUser.email || targetUser.username || targetId).trim() || targetId;
  const otpauthUrl = buildOtpauthUrl({ secret, accountName, issuer: ISSUER });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 280
  });

  if (!req.session) throw new Error('Session is required to begin authenticator setup.');
  req.session.adminTotpPending = {
    userId: targetId,
    secretEnc: encryptSecret(secret),
    accountName,
    issuer: ISSUER,
    createdAt: Date.now(),
    salt: crypto.randomBytes(6).toString('hex'),
    regenCount
  };

  return {
    qrDataUrl,
    secret,
    secretGrouped: formatSecretGrouped(secret),
    otpauthUrl,
    accountName,
    issuer: ISSUER,
    regenCount,
    remainingRegenerations: remainingRegenerations(regenCount)
  };
}

async function confirmEnrollment({ req, targetUser, code }) {
  const targetId = userKey(targetUser?.id);
  const pending = getPendingFromSession(req, targetId);
  if (!pending) {
    const err = new Error('No pending authenticator setup found. Click Begin setup again.');
    err.code = 'NO_PENDING';
    throw err;
  }

  const secret = decryptSecret(pending.secretEnc);
  if (!secret) {
    clearPending(req);
    const err = new Error('Pending setup secret could not be read. Begin setup again.');
    err.code = 'PENDING_CORRUPT';
    throw err;
  }

  const token = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(token)) {
    const err = new Error('Enter the 6-digit code from your authenticator app.');
    err.code = 'INVALID_CODE_FORMAT';
    throw err;
  }

  const ok = authenticator.check(token, secret);
  if (!ok) {
    const err = new Error('That code is not valid. Check your authenticator app and try again.');
    err.code = 'INVALID_CODE';
    throw err;
  }

  const enrolledAt = new Date().toISOString();
  const regenCount = Number(pending.regenCount || 0) + 1;
  await saveRecord(targetId, {
    enabled: true,
    secretEnc: encryptSecret(secret),
    enrolledAt,
    lastUsedStep: currentStep(),
    accountName: pending.accountName || '',
    issuer: pending.issuer || ISSUER,
    regenCount
  });
  clearPending(req);

  return { enabled: true, enrolledAt, regenCount, remainingRegenerations: remainingRegenerations(regenCount) };
}

function verifyCodeAgainstRecord(record, code) {
  if (!record?.enabled || !record?.secretEnc) {
    const err = new Error('Authenticator is not enrolled. Open Avatar menu → Authenticator to set it up.');
    err.code = 'NOT_ENROLLED';
    throw err;
  }
  const secret = decryptSecret(record.secretEnc);
  if (!secret) {
    const err = new Error('Authenticator secret could not be read. Re-enroll from Avatar menu → Authenticator.');
    err.code = 'SECRET_CORRUPT';
    throw err;
  }
  const token = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(token)) {
    const err = new Error('Enter the 6-digit code from Google Authenticator.');
    err.code = 'INVALID_CODE_FORMAT';
    throw err;
  }
  const delta = authenticator.checkDelta(token, secret);
  if (delta === null || delta === undefined || Number.isNaN(Number(delta))) {
    const err = new Error('Invalid authenticator code.');
    err.code = 'INVALID_CODE';
    throw err;
  }
  const usedStep = currentStep() + Number(delta);
  if (record.lastUsedStep != null && Number(record.lastUsedStep) === usedStep) {
    const err = new Error('That code was already used. Wait for the next code.');
    err.code = 'CODE_REUSED';
    throw err;
  }
  return { usedStep, secret };
}

async function verifyUserCode(userId, code) {
  const record = await getRecord(userId);
  const { usedStep } = verifyCodeAgainstRecord(record, code);
  await saveRecord(userId, {
    ...record,
    lastUsedStep: usedStep
  });
  return true;
}

async function disableEnrollment({ targetUser, code, requireCode = true }) {
  const targetId = userKey(targetUser?.id);
  const record = await getRecord(targetId);
  const existingRegenCount = Number(record?.regenCount || 0);
  if (!record?.enabled) {
    return { enabled: false, enrolledAt: null, regenCount: existingRegenCount, remainingRegenerations: remainingRegenerations(existingRegenCount) };
  }
  if (requireCode) {
    verifyCodeAgainstRecord(record, code);
  }
  // Preserve regenCount across disable/re-enroll cycles so the lifetime cap survives it.
  await saveRecord(targetId, {
    enabled: false,
    secretEnc: '',
    regenCount: existingRegenCount,
    disabledAt: new Date().toISOString()
  });
  return {
    enabled: false,
    enrolledAt: null,
    regenCount: existingRegenCount,
    remainingRegenerations: remainingRegenerations(existingRegenCount)
  };
}

/** Load all TOTP records into a Map keyed by userId (Mongo wins on conflict). */
async function listAllRecords() {
  const map = new Map();
  const store = await readStore();
  for (const [key, record] of Object.entries(store)) {
    if (record && typeof record === 'object') map.set(key, record);
  }
  try {
    const docs = await getMongoCollection(TOTP_MONGO_COLLECTION).find({}).toArray();
    for (const doc of docs) {
      const normalized = normalizeMongoTotpDoc(doc);
      const key = userKey(normalized?.userId || doc?.userId);
      if (key && normalized) map.set(key, normalized);
    }
  } catch (_) {
    // JSON fallback already populated above.
  }
  return map;
}

function buildAdminUsageRow(user, record) {
  const userId = userKey(user?.id || user?.userId || record?.userId);
  const status = publicStatus(record);
  return {
    userId,
    email: String(user?.email || record?.accountName || '').trim() || '—',
    username: String(user?.username || '').trim() || '—',
    isOrphan: !user,
    ...status
  };
}

/** Rows for TOTP records with no matching users row (e.g. virtual ROOT_001). */
function buildOrphanUsageRows(totpMap, knownUserIds = []) {
  const known = new Set(knownUserIds.map((id) => userKey(id)).filter(Boolean));
  const rows = [];
  for (const [uid, record] of totpMap.entries()) {
    if (known.has(uid)) continue;
    rows.push(buildAdminUsageRow(null, { ...record, userId: uid }));
  }
  return rows.sort((a, b) => String(a.userId).localeCompare(String(b.userId)));
}

/** Super-admin reset: clear lifetime key-change counter without touching enrollment. */
async function resetRegenCount(userId) {
  const key = userKey(userId);
  if (!key) throw new Error('User id is required.');
  const record = await getRecord(key);
  if (!record) return publicStatus(null);
  const updated = { ...record, regenCount: 0 };
  await saveRecord(key, updated);
  return publicStatus(updated);
}

module.exports = {
  ISSUER,
  MAX_TOTP_REGENERATIONS,
  isSystemSuperAdminUser,
  isTotpEligibleUser,
  isTotpEligibleTarget,
  canManageOwnTotp,
  canManageTotp,
  getStatus,
  beginEnrollment,
  confirmEnrollment,
  verifyUserCode,
  disableEnrollment,
  clearPending,
  formatSecretGrouped,
  buildOtpauthUrl,
  listAllRecords,
  buildAdminUsageRow,
  buildOrphanUsageRows,
  resetRegenCount
};
