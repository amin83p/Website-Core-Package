const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/schoolEntityPickerController');
const schoolEntityPickerService = require('../services/school/schoolEntityPickerService');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const {
  requireAuth,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

const accessService = requireCoreModule('MVC/services/security/index');

function sendJsonError(res, statusCode, code, message) {
  return res.status(statusCode).json({
    status: 'error',
    code,
    message
  });
}

async function requireSchoolEntityPickerReadAccess(req, res, next) {
  try {
    if (!req.user) {
      return sendJsonError(res, 401, 'AUTH_REQUIRED', 'Authentication required before access check.');
    }

    let sectionIds;
    try {
      sectionIds = schoolEntityPickerService.getRequiredAccessSections(req.query?.target || 'students');
    } catch (error) {
      return sendJsonError(res, Number(error.statusCode || 400), error.code || 'INVALID_PICKER_TARGET', error.message);
    }

    if (!Array.isArray(sectionIds) || sectionIds.length === 0) {
      return sendJsonError(res, 403, 'PICKER_ACCESS_NOT_CONFIGURED', 'No access sections are configured for this picker target.');
    }

    let firstAllowedEvaluation = null;
    for (const sectionId of sectionIds) {
      // eslint-disable-next-line no-await-in-loop
      const evaluation = await accessService.evaluateAccess({
        user: req.user,
        sectionId,
        operationId: OPERATIONS.READ_ALL,
        ipAddress: req.ip
      });
      if (!evaluation?.allowed) {
        return sendJsonError(
          res,
          403,
          evaluation?.deniedCode || 'ACCESS_DENIED',
          evaluation?.reason || 'Access Denied: You do not have permission to use this picker.'
        );
      }
      if (!firstAllowedEvaluation) firstAllowedEvaluation = evaluation;
    }

    req.accessLimits = firstAllowedEvaluation?.limits || {};
    req.adminContext = firstAllowedEvaluation?.adminContext || req.adminContext || null;
    if (res.locals) res.locals.adminContext = req.adminContext;
    req.accessScope = firstAllowedEvaluation?.scopeId || req.accessScope || '';
    return next();
  } catch (error) {
    console.error('School entity picker access error:', error);
    return sendJsonError(res, 500, 'PICKER_ACCESS_ERROR', 'Internal Security Error');
  }
}

router.use(requireAuth);

router.get('/api/options',
  requireSchoolEntityPickerReadAccess,
  trackActionState(SECTIONS.SCHOOL || SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.getOptions);

module.exports = router;
module.exports.requireSchoolEntityPickerReadAccess = requireSchoolEntityPickerReadAccess;
