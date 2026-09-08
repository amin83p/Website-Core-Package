'use strict';

const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

const accessService = requireCoreModule('MVC/services/security/index');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');

function denyAccess(req, res, reason) {
  if (req.xhr || req.headers.accept?.includes('application/json') || req.headers['x-ajax-request']) {
    return res.status(403).json({ status: 'error', message: reason || 'Insufficient permissions.' });
  }
  return res.status(403).render('error', {
    title: 'Access Denied',
    message: reason || 'Insufficient permissions.',
    user: req.user
  });
}

async function evaluateRouteAccess(req, sectionId, operationId) {
  try {
    return await accessService.evaluateAccess({
      user: req.user,
      sectionId,
      operationId,
      ipAddress: req?.ip
    });
  } catch (_) {
    return { allowed: false, reason: 'Insufficient permissions.' };
  }
}

function requireSessionFileUploadRouteAccess() {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required before access check.'
      });
    }

    if (adminAuthorityService.isSuperAdmin(req.user) || req.adminContext?.isSuperAdmin) {
      req.accessLimits = {};
      return next();
    }

    const [attendanceUpload, sessionsUpdate] = await Promise.all([
      evaluateRouteAccess(req, SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPLOAD),
      evaluateRouteAccess(req, SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE)
    ]);

    if (attendanceUpload?.allowed || sessionsUpdate?.allowed) {
      req.accessLimits = (attendanceUpload?.allowed ? attendanceUpload : sessionsUpdate).limits || {};
      req.accessScope = (attendanceUpload?.allowed ? attendanceUpload : sessionsUpdate).scopeId;
      return next();
    }

    return denyAccess(
      req,
      res,
      attendanceUpload?.reason || sessionsUpdate?.reason || 'Insufficient permissions.'
    );
  };
}

module.exports = {
  requireSessionFileUploadRouteAccess
};
