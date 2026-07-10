const crypto = require('crypto');
const { encrypt, getAdminVerificationState } = require('../utils/encyptors');
const { VALIDITY_TIME } = require('../../config/security');
const adminTotpService = require('../services/adminTotpService');

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

async function markAdminVerified(req) {
  const timestamp = Date.now();
  const payload = JSON.stringify({
    timestamp,
    salt: crypto.randomBytes(8).toString('hex')
  });
  req.session.adminKey = encrypt(payload);
  await saveSession(req);
  return new Date(timestamp + VALIDITY_TIME).toISOString();
}

exports.verifyAdminCode = async (req, res) => {
  const { code } = req.body;

  if (!req.session) {
    logAdminVerification(req, 'VERIFY_FAILED', { reason: 'missing_express_session' });
    return res.status(500).json({
      status: 'error',
      message: 'Admin verification session is not available. Please refresh the page and try again.'
    });
  }

  const actor = req.user;
  if (!actor) {
    logAdminVerification(req, 'VERIFY_FAILED', { reason: 'unauthenticated' });
    return res.status(401).json({ status: 'error', message: 'Authentication required.' });
  }

  if (!adminTotpService.isTotpEligibleUser(actor)) {
    logAdminVerification(req, 'VERIFY_FAILED', { reason: 'not_admin_privilege' });
    return res.status(403).json({
      status: 'error',
      message: 'Admin verification requires admin access on your profile. Contact a system admin if you need this.'
    });
  }

  try {
    const status = await adminTotpService.getStatus(actor.id);
    if (!status.enabled) {
      logAdminVerification(req, 'VERIFY_FAILED', { reason: 'not_enrolled' });
      return res.status(403).json({
        status: 'error',
        code: 'ADMIN_TOTP_NOT_ENROLLED',
        message: 'Set up Google Authenticator first: open your avatar menu → Authenticator.'
      });
    }

    await adminTotpService.verifyUserCode(actor.id, code);
    const expiresAt = await markAdminVerified(req);
    logAdminVerification(req, 'VERIFY_SUCCESS', { expiresAt });
    return res.json({
      status: 'success',
      message: 'Admin verified',
      expiresAt,
      validityMs: VALIDITY_TIME
    });
  } catch (error) {
    const reason = error?.code || 'invalid_code';
    logAdminVerification(req, 'VERIFY_FAILED', { reason, error: error?.message });
    const statusCode = ['NOT_ENROLLED', 'SECRET_CORRUPT'].includes(error?.code) ? 403 : 403;
    return res.status(statusCode).json({
      status: 'error',
      code: error?.code || 'INVALID_CODE',
      message: error?.message || 'Invalid authenticator code'
    });
  }
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
