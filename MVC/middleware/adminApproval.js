// Adjust path to point to your config folder
const { getAdminVerificationState } = require('../utils/encyptors');

module.exports = (req, res, next) => {
  try {
    const state = getAdminVerificationState(req);
    console.log('[AdminVerification]', state.valid ? 'APPROVAL_PASS' : 'APPROVAL_REQUIRED', {
      requestId: String(req.requestId || ''),
      userId: String(req.user?.id || ''),
      hasExpressSession: state.hasExpressSession,
      hasAdminKey: state.hasAdminKey,
      expired: state.expired,
      reason: state.reason
    });
    if (state.valid) return next();
  } catch (e) {
    console.error("Admin Approval Middleware Error:", e);
  }

  // If we reach here, verification failed or expired
  return res.status(403).json({
    status: "admin_required",
    message: "Admin approval required or session expired."
  });
};
