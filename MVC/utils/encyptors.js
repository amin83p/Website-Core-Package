const crypto = require('crypto');
const { ENCRYPTION_KEY, IV_LENGTH, VALIDITY_TIME } = require('../../config/security'); 

// ✅ Updated: Accepts optional 'customKey'
function decrypt(text, customKey = null, options = {}) {
  try {
      if (!text) return null;
      
      // Use custom key if provided, otherwise default to global ENCRYPTION_KEY
      const keyToUse = customKey || ENCRYPTION_KEY;

      let textParts = text.split(':');
      let iv = Buffer.from(textParts.shift(), 'hex');
      let encryptedText = Buffer.from(textParts.join(':'), 'hex');
      
      let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(keyToUse), iv);
      let decrypted = decipher.update(encryptedText);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      return decrypted.toString();
  } catch (e) {
      if (!options.silent) {
        console.error("Decryption failed:", e.message);
      }
      return null;
  }
}

// ✅ Updated: Accepts optional 'customKey'
function encrypt(text, customKey = null) {
  if (!text) return null;
  if (typeof text === 'object') text = JSON.stringify(text);

  const keyToUse = customKey || ENCRYPTION_KEY;

  let iv = crypto.randomBytes(IV_LENGTH);
  let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(keyToUse), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function clearAdminVerification(req) {
  if (req && req.session && req.session.adminKey) {
    delete req.session.adminKey;
  }
}

function getAdminVerificationState(req, options = {}) {
  const clearExpired = options.clearExpired !== false;
  const now = Date.now();
  const hasExpressSession = Boolean(req && req.session);
  const hasAdminKey = Boolean(req && req.session && req.session.adminKey);

  const base = {
    valid: false,
    reason: hasExpressSession ? 'missing_admin_key' : 'missing_express_session',
    hasExpressSession,
    hasAdminKey,
    expired: false,
    issuedAt: null,
    expiresAt: null,
    remainingMs: 0,
    validityMs: VALIDITY_TIME
  };

  if (!hasExpressSession || !hasAdminKey) return base;

  const decryptedString = decrypt(req.session.adminKey, null, { silent: true });
  if (!decryptedString) {
    clearAdminVerification(req);
    return { ...base, reason: 'decrypt_failed' };
  }

  let data = null;
  try {
    data = JSON.parse(decryptedString);
  } catch (_) {
    clearAdminVerification(req);
    return { ...base, reason: 'invalid_payload' };
  }

  const issuedAtMs = Number(data.timestamp || 0);
  if (!issuedAtMs || !Number.isFinite(issuedAtMs)) {
    clearAdminVerification(req);
    return { ...base, reason: 'missing_timestamp' };
  }

  const expiresAtMs = issuedAtMs + VALIDITY_TIME;
  const remainingMs = Math.max(0, expiresAtMs - now);
  const state = {
    ...base,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    remainingMs,
    expired: remainingMs <= 0
  };

  if (state.expired) {
    if (clearExpired) clearAdminVerification(req);
    return { ...state, reason: 'expired' };
  }

  return {
    ...state,
    valid: true,
    reason: 'valid'
  };
}

function checkAdminVerificationCode(req) {
  return getAdminVerificationState(req).valid === true;
}

module.exports = {
  encrypt,
  decrypt,
  clearAdminVerification,
  getAdminVerificationState,
  checkAdminVerificationCode
};
