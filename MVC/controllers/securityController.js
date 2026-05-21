const crypto = require('crypto');

// Secret key for encryption (In production, this should be an environment variable)
// Must be 32 bytes for aes-256-cbc
// const { ENCRYPTION_KEY, IV_LENGTH } = require('../../config/security'); 
const { encrypt, getAdminVerificationState } = require('../utils/encyptors');
const { VALIDITY_TIME } = require('../../config/security');
//const ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY || crypto.randomBytes(32); 
// const IV_LENGTH = 16; // For AES, this is always 16

// function encrypt(text) {
//   let iv = crypto.randomBytes(IV_LENGTH);
//   let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
//   let encrypted = cipher.update(text);
//   encrypted = Buffer.concat([encrypted, cipher.final()]);
//   return iv.toString('hex') + ':' + encrypted.toString('hex');
// }

function getTodayCode() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2,'0')}`;
}

function logAdminVerification(req, event, extra = {}) {
  const state = getAdminVerificationState(req, { clearExpired: false });
  console.log('[AdminVerification]', event, {
    requestId: String(req.requestId || ''),
    userId: String(req.user?.id || ''),
    hasExpressSession: state.hasExpressSession,
    hasAdminKey: state.hasAdminKey,
    expired: state.expired,
    reason: state.reason,
    ...extra
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session || typeof req.session.save !== 'function') return resolve();
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

exports.verifyAdminCode = async (req, res) => {
  const { code } = req.body;

  if (!req.session) {
    logAdminVerification(req, 'VERIFY_FAILED', { reason: 'missing_express_session' });
    return res.status(500).json({
      status: "error",
      message: "Admin verification session is not available. Please refresh the page and try again."
    });
  }
  
  // Verify the code (e.g. against today's date or your hardcoded '1')
  // Using strict comparison for security
  if (code === '1') { // or getTodayCode()
    const timestamp = Date.now();
    
    // Create payload with timestamp and random salt
    const payload = JSON.stringify({
        timestamp,
        salt: crypto.randomBytes(8).toString('hex')
    });

    // Encrypt the payload and store it in the session
    req.session.adminKey = encrypt(payload);

    try {
      await saveSession(req);
      const expiresAt = new Date(timestamp + VALIDITY_TIME).toISOString();
      logAdminVerification(req, 'VERIFY_SUCCESS', { expiresAt });
      return res.json({
        status: "success",
        message: "Admin verified",
        expiresAt,
        validityMs: VALIDITY_TIME
      });
    } catch (error) {
      console.error('[AdminVerification] VERIFY_SAVE_FAILED', {
        requestId: String(req.requestId || ''),
        userId: String(req.user?.id || ''),
        error: error?.message || String(error)
      });
      return res.status(500).json({
        status: "error",
        message: "Admin verification could not be saved. Please try again."
      });
    }
  }

  logAdminVerification(req, 'VERIFY_FAILED', { reason: 'invalid_code' });
  return res.status(403).json({ status: "error", message: "Invalid admin code" });
};

exports.getAdminVerificationStatus = (req, res) => {
  const state = getAdminVerificationState(req);
  logAdminVerification(req, 'STATUS_CHECK');
  return res.json({
    status: 'success',
    verified: state.valid,
    reason: state.reason,
    expiresAt: state.expiresAt,
    remainingMs: state.remainingMs,
    validityMs: state.validityMs
  });
};
