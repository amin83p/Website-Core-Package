const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

async function userCanManageConductRatingScalePolicy(user) {
  if (!user) return false;
  return adminAuthorityService.isAdminForRequestAsync(
    user,
    SECTIONS.SCHOOL_CLASSES,
    OPERATIONS.UPDATE,
    { section: { id: SECTIONS.SCHOOL_CLASSES } }
  );
}

function requireConductRatingScalePolicyAdmin() {
  return async (req, res, next) => {
    try {
      const ok = await userCanManageConductRatingScalePolicy(req.user);
      if (!ok) {
        if (req.headers['x-ajax-request'] || req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(403).json({ status: 'error', message: 'You do not have permission to manage conduct rating scale settings.' });
        }
        return res.status(403).render('error', {
          title: 'Access Denied',
          message: 'You do not have permission to manage conduct rating scale settings.',
          user: req.user
        });
      }
      next();
    } catch (err) {
      console.error('conductRatingScalePolicyAdmin middleware', err);
      res.status(500).send('Internal error');
    }
  };
}

module.exports = {
  userCanManageConductRatingScalePolicy,
  requireConductRatingScalePolicyAdmin
};
