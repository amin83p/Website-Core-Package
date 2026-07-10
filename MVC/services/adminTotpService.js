const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { encrypt, decrypt } = require('../utils/encyptors');
const { toPublicId, idsEqual } = require('../utils/idAdapter');
const adminAuthorityService = require('./adminAuthorityService');
const { queueWrite } = require('../models/fileQueue');

const STORE_PATH = path.join(__dirname, '../../data/adminTotpSecrets.json');
const ISSUER = 'Website Core Admin';
const PENDING_TTL_MS = 15 * 60 * 1000;

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

function publicStatus(record) {
  if (!record || !record.enabled || !record.secretEnc) {
    return { enabled: false, enrolledAt: null };
  }
  return {
    enabled: true,
    enrolledAt: record.enrolledAt || null
  };
}

async function getRecord(userId) {
  const key = userKey(userId);
  if (!key) return null;
  const store = await readStore();
  const row = store[key];
  return row && typeof row === 'object' ? row : null;
}

async function saveRecord(userId, record) {
  const key = userKey(userId);
  if (!key) throw new Error('User id is required.');
  await queueWrite(async () => {
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
  if (existing?.enabled && existing?.secretEnc) {
    const err = new Error('Authenticator is already enrolled. Disable it before setting up again.');
    err.code = 'ALREADY_ENROLLED';
    throw err;
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
    salt: crypto.randomBytes(6).toString('hex')
  };

  return {
    qrDataUrl,
    secret,
    secretGrouped: formatSecretGrouped(secret),
    otpauthUrl,
    accountName,
    issuer: ISSUER
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
  await saveRecord(targetId, {
    enabled: true,
    secretEnc: encryptSecret(secret),
    enrolledAt,
    lastUsedStep: currentStep(),
    accountName: pending.accountName || '',
    issuer: pending.issuer || ISSUER
  });
  clearPending(req);

  return { enabled: true, enrolledAt };
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
  if (!record?.enabled) {
    return { enabled: false, enrolledAt: null };
  }
  if (requireCode) {
    verifyCodeAgainstRecord(record, code);
  }
  await saveRecord(targetId, null);
  return { enabled: false, enrolledAt: null };
}

module.exports = {
  ISSUER,
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
  buildOtpauthUrl
};
