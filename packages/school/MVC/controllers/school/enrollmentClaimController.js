'use strict';

const enrollmentClaimDisplayService = require('../../services/school/enrollmentClaimDisplayService');

async function postEnrollmentClaimsWindow(req, res) {
  try {
    const page = String(req.body?.page || '').trim();
    const allowed = await enrollmentClaimDisplayService.canShowForPage(req.user, page, req.ip);
    if (!allowed) {
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to view enrollment claim numbers.'
      });
    }

    const claims = await enrollmentClaimDisplayService.loadClaimsForWindow({
      orgId: req.user?.activeOrgId,
      classId: String(req.body?.classId || '').trim(),
      startDate: String(req.body?.startDate || '').trim(),
      endDate: String(req.body?.endDate || '').trim(),
      students: Array.isArray(req.body?.students) ? req.body.students : [],
      requestingUser: req.user
    });
    return res.json({ status: 'success', claims });
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      message: error.message || 'Could not load claim numbers.'
    });
  }
}

module.exports = {
  postEnrollmentClaimsWindow
};
