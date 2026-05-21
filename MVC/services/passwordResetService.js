const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const passwordResetCodeRepository = require('../repositories/passwordResetCodeRepository');
const { toPublicId, idsEqual } = require('../utils/idAdapter');

function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeEmail(value = '') {
  return cleanString(value, { max: 320, allowEmpty: true }).toLowerCase();
}

function parseIsoMs(value = '') {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : NaN;
}

function buildNowIso() {
  return new Date().toISOString();
}

function buildVerificationToken() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return crypto.randomBytes(24).toString('hex');
}

function buildNumericCode(length = 6) {
  const size = Math.max(4, Math.min(8, Number(length) || 6));
  const min = Number(`1${'0'.repeat(size - 1)}`);
  const max = Number('9'.repeat(size));
  const value = Math.floor(Math.random() * (max - min + 1)) + min;
  return String(value);
}

function normalizeDeliveryMethod(value = '') {
  return String(value || '').trim().toLowerCase() === 'sms' ? 'sms' : 'email';
}

function normalizeProviderToken(value = '') {
  return cleanString(value, { max: 80, allowEmpty: true }).toLowerCase();
}

async function revokeActiveForEmail(email = '', reason = 'revoked') {
  const token = normalizeEmail(email);
  if (!token) return 0;
  const rows = await passwordResetCodeRepository.list({
    scope: { canViewAll: true },
    query: {
      email__eq: token,
      status__eq: 'active',
      page: 1,
      limit: 200
    },
    sort: { createdAt: -1, id: -1 }
  });
  let updated = 0;
  for (const row of (Array.isArray(rows) ? rows : [])) {
    // eslint-disable-next-line no-await-in-loop
    await passwordResetCodeRepository.update(row.id, {
      status: reason,
      revokedAt: buildNowIso(),
      verificationToken: '',
      verifiedAt: ''
    });
    updated += 1;
  }
  return updated;
}

async function findActiveRawByEmail(email = '') {
  const token = normalizeEmail(email);
  if (!token) return null;
  return passwordResetCodeRepository.findActiveRawByEmail(token);
}

async function markExpiredIfNeeded(rawRow = null) {
  if (!rawRow || !rawRow.id) return { expired: true };
  const expiresMs = parseIsoMs(rawRow.expiresAt);
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
    await passwordResetCodeRepository.update(rawRow.id, {
      status: 'expired',
      verificationToken: '',
      verifiedAt: ''
    });
    return { expired: true };
  }
  return { expired: false };
}

async function incrementFailedAttempt(rawRow = null) {
  if (!rawRow || !rawRow.id) return { ok: false, reason: 'invalid' };
  const nextAttempts = Math.max(0, Number(rawRow.attemptCount || 0)) + 1;
  const maxAttempts = Math.max(1, Number(rawRow.maxAttempts || 8));
  await passwordResetCodeRepository.update(rawRow.id, {
    attemptCount: nextAttempts,
    status: nextAttempts >= maxAttempts ? 'revoked' : 'active',
    revokedAt: nextAttempts >= maxAttempts ? buildNowIso() : (rawRow.revokedAt || '')
  });
  return { ok: true, revoked: nextAttempts >= maxAttempts, attempts: nextAttempts };
}

const passwordResetService = {
  async issueResetCode({ user = null, orgId = '', ttlMinutes = 15, maxAttempts = 8 } = {}) {
    const userId = toPublicId(user?.id || '');
    const orgToken = toPublicId(orgId || user?.primaryOrgId || '');
    const email = normalizeEmail(user?.email || '');
    if (!userId || !orgToken || !email) {
      throw new Error('Cannot issue reset code without user, organization, and email.');
    }

    await revokeActiveForEmail(email, 'revoked');

    const code = buildNumericCode(6);
    const codeHash = await bcrypt.hash(code, 10);
    const nowMs = Date.now();
    const ttl = Math.max(5, Number.parseInt(String(ttlMinutes || 15), 10) || 15);
    const expiresAt = new Date(nowMs + ttl * 60 * 1000).toISOString();

    const row = await passwordResetCodeRepository.create({
      orgId: orgToken,
      userId,
      email,
      codeHash,
      status: 'active',
      verificationToken: '',
      verifiedAt: '',
      usedAt: '',
      revokedAt: '',
      expiresAt,
      attemptCount: 0,
      maxAttempts: Math.max(1, Number.parseInt(String(maxAttempts || 8), 10) || 8),
      deliveryMethod: 'email',
      deliveryProvider: '',
      deliveryPhoneE164: '',
      deliveryReference: '',
      deliveryFallbackUsed: false,
      verificationSource: ''
    });

    return {
      code,
      record: row,
      expiresAt,
      ttlMinutes: ttl
    };
  },

  async verifyCode({ email = '', code = '' } = {}) {
    const normalizedEmail = normalizeEmail(email);
    const submittedCode = cleanString(code, { max: 40, allowEmpty: true });
    if (!normalizedEmail || !submittedCode) {
      return { ok: false, reason: 'invalid' };
    }

    const rawRow = await findActiveRawByEmail(normalizedEmail);
    if (!rawRow) return { ok: false, reason: 'invalid' };

    const expiry = await markExpiredIfNeeded(rawRow);
    if (expiry.expired) {
      return { ok: false, reason: 'expired' };
    }

    const isMatch = await bcrypt.compare(submittedCode, String(rawRow.codeHash || ''));
    if (!isMatch) {
      const failed = await incrementFailedAttempt(rawRow);
      return { ok: false, reason: failed.revoked ? 'revoked' : 'invalid' };
    }

    const verificationToken = buildVerificationToken();
    await passwordResetCodeRepository.update(rawRow.id, {
      verificationToken,
      verifiedAt: buildNowIso(),
      verificationSource: 'email_code'
    });

    return {
      ok: true,
      recordId: rawRow.id,
      verificationToken,
      userId: toPublicId(rawRow.userId || ''),
      orgId: toPublicId(rawRow.orgId || ''),
      email: normalizedEmail,
      expiresAt: rawRow.expiresAt
    };
  },

  async consumeVerifiedCode({ email = '', verificationToken = '' } = {}) {
    const normalizedEmail = normalizeEmail(email);
    const token = cleanString(verificationToken, { max: 160, allowEmpty: true });
    if (!normalizedEmail || !token) {
      return { ok: false, reason: 'invalid' };
    }

    const rawRow = await findActiveRawByEmail(normalizedEmail);
    if (!rawRow) return { ok: false, reason: 'invalid' };
    if (!idsEqual(rawRow.email, normalizedEmail)) return { ok: false, reason: 'invalid' };

    const expiry = await markExpiredIfNeeded(rawRow);
    if (expiry.expired) {
      return { ok: false, reason: 'expired' };
    }

    if (!rawRow.verifiedAt || !idsEqual(rawRow.verificationToken, token)) {
      return { ok: false, reason: 'invalid' };
    }

    await passwordResetCodeRepository.update(rawRow.id, {
      status: 'used',
      usedAt: buildNowIso(),
      verificationToken: ''
    });

    return {
      ok: true,
      userId: toPublicId(rawRow.userId || ''),
      orgId: toPublicId(rawRow.orgId || ''),
      email: normalizedEmail
    };
  },

  async peekVerifiedCode({ email = '', verificationToken = '' } = {}) {
    const normalizedEmail = normalizeEmail(email);
    const token = cleanString(verificationToken, { max: 160, allowEmpty: true });
    if (!normalizedEmail || !token) {
      return { ok: false, reason: 'invalid' };
    }

    const rawRow = await findActiveRawByEmail(normalizedEmail);
    if (!rawRow) return { ok: false, reason: 'invalid' };
    if (!idsEqual(rawRow.email, normalizedEmail)) return { ok: false, reason: 'invalid' };

    const expiry = await markExpiredIfNeeded(rawRow);
    if (expiry.expired) {
      return { ok: false, reason: 'expired' };
    }

    if (!rawRow.verifiedAt || !idsEqual(rawRow.verificationToken, token)) {
      return { ok: false, reason: 'invalid' };
    }

    return {
      ok: true,
      userId: toPublicId(rawRow.userId || ''),
      orgId: toPublicId(rawRow.orgId || ''),
      email: normalizedEmail
    };
  },

  async getActiveDeliveryContext({ email = '' } = {}) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return null;
    const rawRow = await findActiveRawByEmail(normalizedEmail);
    if (!rawRow) return null;
    const expiry = await markExpiredIfNeeded(rawRow);
    if (expiry.expired) return null;
    return {
      recordId: toPublicId(rawRow.id || ''),
      orgId: toPublicId(rawRow.orgId || ''),
      userId: toPublicId(rawRow.userId || ''),
      email: normalizedEmail,
      deliveryMethod: normalizeDeliveryMethod(rawRow.deliveryMethod || 'email'),
      deliveryProvider: normalizeProviderToken(rawRow.deliveryProvider || ''),
      deliveryPhoneE164: cleanString(rawRow.deliveryPhoneE164 || '', { max: 30, allowEmpty: true }) || '',
      deliveryReference: cleanString(rawRow.deliveryReference || '', { max: 180, allowEmpty: true }) || '',
      deliveryFallbackUsed: Boolean(rawRow.deliveryFallbackUsed)
    };
  },

  async markDeliveryContext({
    recordId = '',
    deliveryMethod = 'email',
    deliveryProvider = '',
    deliveryPhoneE164 = '',
    deliveryReference = '',
    deliveryFallbackUsed = false
  } = {}) {
    const targetId = toPublicId(recordId || '');
    if (!targetId) return null;
    return passwordResetCodeRepository.update(targetId, {
      deliveryMethod: normalizeDeliveryMethod(deliveryMethod),
      deliveryProvider: normalizeProviderToken(deliveryProvider || ''),
      deliveryPhoneE164: cleanString(deliveryPhoneE164 || '', { max: 30, allowEmpty: true }) || '',
      deliveryReference: cleanString(deliveryReference || '', { max: 180, allowEmpty: true }) || '',
      deliveryFallbackUsed: Boolean(deliveryFallbackUsed)
    });
  },

  async registerFailedAttempt({ email = '' } = {}) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return { ok: false, reason: 'invalid' };
    const rawRow = await findActiveRawByEmail(normalizedEmail);
    if (!rawRow) return { ok: false, reason: 'invalid' };

    const expiry = await markExpiredIfNeeded(rawRow);
    if (expiry.expired) return { ok: false, reason: 'expired' };

    const failed = await incrementFailedAttempt(rawRow);
    return { ok: true, reason: failed.revoked ? 'revoked' : 'invalid' };
  },

  async verifyManagedChallenge({
    email = '',
    deliveryMethod = 'sms',
    provider = ''
  } = {}) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return { ok: false, reason: 'invalid' };

    const rawRow = await findActiveRawByEmail(normalizedEmail);
    if (!rawRow) return { ok: false, reason: 'invalid' };

    const expiry = await markExpiredIfNeeded(rawRow);
    if (expiry.expired) return { ok: false, reason: 'expired' };

    const verificationToken = buildVerificationToken();
    await passwordResetCodeRepository.update(rawRow.id, {
      verificationToken,
      verifiedAt: buildNowIso(),
      verificationSource: `${normalizeDeliveryMethod(deliveryMethod)}:${normalizeProviderToken(provider || 'managed')}`
    });

    return {
      ok: true,
      recordId: rawRow.id,
      verificationToken,
      userId: toPublicId(rawRow.userId || ''),
      orgId: toPublicId(rawRow.orgId || ''),
      email: normalizedEmail,
      expiresAt: rawRow.expiresAt
    };
  }
};

module.exports = passwordResetService;
