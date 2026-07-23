'use strict';

const schoolAdminAccessService = require('../services/school/schoolAdminAccessService');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const accessService = requireCoreModule('MVC/services/security');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

/** Section admins only — Matrix Thresholds settings / policy numbers. */
async function userCanManageAttendanceMatrixPolicy(user) {
  if (!user) return false;
  return schoolAdminAccessService.isAttendancesAdminViewerAsync(user);
}

/**
 * Anyone allowed to open the Attendance Matrix page (matches requireAccess UPDATE).
 * Used for nav links; distinct from policy-admin / thresholds manage.
 */
async function userCanOpenAttendanceMatrix(user, ipAddress) {
  if (!user) return false;
  if (await schoolAdminAccessService.isAttendancesAdminViewerAsync(user)) return true;
  try {
    const evaluation = await accessService.evaluateAccess({
      user,
      sectionId: SECTIONS.SCHOOL_ATTENDANCES,
      operationId: OPERATIONS.UPDATE,
      ipAddress
    });
    return evaluation?.allowed === true;
  } catch (_) {
    return false;
  }
}

function requireAttendanceMatrixPolicyAdmin() {
  return async (req, res, next) => {
    try {
      const ok = await userCanManageAttendanceMatrixPolicy(req.user);
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
  userCanOpenAttendanceMatrix,
  requireAttendanceMatrixPolicyAdmin
};
