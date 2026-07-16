const jwt = require('jsonwebtoken');
const { SESSION_SECRET } = require('../../config/security');

const COOKIE_NAME = 'microsoft_login.pending';
const TOKEN_ISSUER = 'website-core';
const TOKEN_AUDIENCE = 'microsoft-pending-login';
const TOKEN_PURPOSE = 'microsoft_force_login';

function cleanString(value, max = 320) {
  const token = String(value || '').replace(/\0/g, '').trim();
  return token.length > max ? token.slice(0, max) : token;
}

function sanitizeProviderAccount(account = {}) {
  return {
    email: cleanString(account.email, 320).toLowerCase(),
    tenantId: cleanString(account.tenantId, 120),
    objectId: cleanString(account.objectId, 120),
    name: cleanString(account.name, 220),
    username: cleanString(account.username || account.email, 320)
  };
}

function normalizePendingLogin(pending = {}) {
  const userId = cleanString(pending.userId, 120);
  if (!userId) return null;
  return {
    userId,
    providerAccount: sanitizeProviderAccount(pending.providerAccount)
  };
}

function sign(pending = {}, { ttlMs = 10 * 60 * 1000 } = {}) {
  const normalized = normalizePendingLogin(pending);
  if (!normalized) throw new Error('Microsoft pending login requires a user ID.');

  return jwt.sign({
    purpose: TOKEN_PURPOSE,
    ...normalized
  }, SESSION_SECRET, {
    algorithm: 'HS256',
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
    expiresIn: Math.max(1, Math.ceil(Number(ttlMs || 0) / 1000))
  });
}

function verify(token = '') {
  const value = cleanString(token, 4096);
  if (!value) return null;

  try {
    const payload = jwt.verify(value, SESSION_SECRET, {
      algorithms: ['HS256'],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE
    });
    if (payload?.purpose !== TOKEN_PURPOSE) return null;
    const normalized = normalizePendingLogin(payload);
    if (!normalized) return null;
    return {
      ...normalized,
      createdAt: Number(payload.iat || 0) * 1000,
      expiresAt: Number(payload.exp || 0) * 1000
    };
  } catch (_) {
    return null;
  }
}

function setCookie(res, pending = {}, { ttlMs = 10 * 60 * 1000, secure = false } = {}) {
  if (!res || typeof res.cookie !== 'function') return;
  res.cookie(COOKIE_NAME, sign(pending, { ttlMs }), {
    httpOnly: true,
    secure: Boolean(secure),
    sameSite: 'lax',
    path: '/',
    maxAge: ttlMs
  });
}

function readCookie(req) {
  return verify(req?.cookies?.[COOKIE_NAME] || '');
}

function clearCookie(res) {
  if (!res || typeof res.clearCookie !== 'function') return;
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production',
    sameSite: 'lax',
    path: '/'
  });
}

module.exports = {
  COOKIE_NAME,
  sign,
  verify,
  setCookie,
  readCookie,
  clearCookie
};
