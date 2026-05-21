const accessService = require('../services/security');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
const adminAuthorityService = require('../services/adminAuthorityService');

/**
 * Superusers, global admins (fullAdmin profile), or users with UPDATE or VIEW_DASHBOARD
 * on SCHOOL_ATTENDANCES may edit org-wide attendance matrix thresholds.
 */
async function userCanManageAttendanceMatrixPolicy(user, ipAddress) {
  if (!user) return false;
  if (await adminAuthorityService.isAdminForRequestAsync(user, SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { section: { id: SECTIONS.SCHOOL_ATTENDANCES } })) return true;

  for (const operationId of [OPERATIONS.UPDATE, OPERATIONS.VIEW_DASHBOARD]) {
    try {
      const evaluation = await accessService.evaluateAccess({
        user,
        sectionId: SECTIONS.SCHOOL_ATTENDANCES,
        operationId,
        ipAddress: ipAddress || ''
      });
      if (evaluation?.allowed) return true;
    } catch (_) {
      /* continue */
    }
  }
  return false;
}

function requireAttendanceMatrixPolicyAdmin() {
  return async (req, res, next) => {
    try {
      const ok = await userCanManageAttendanceMatrixPolicy(req.user, req.ip);
      if (!ok) {
        if (req.headers['x-ajax-request'] || req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(403).json({ status: 'error', message: 'You do not have permission to manage attendance matrix settings.' });
        }
        return res.status(403).render('error', {
          title: 'Access Denied',
          message: 'You do not have permission to manage attendance matrix settings.',
          user: req.user
        });
      }
      next();
    } catch (err) {
      console.error('attendanceMatrixPolicyAdmin middleware', err);
      res.status(500).send('Internal error');
    }
  };
}

module.exports = {
  userCanManageAttendanceMatrixPolicy,
  requireAttendanceMatrixPolicyAdmin
};
