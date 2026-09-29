'use strict';

const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const notificationCenterOperationPolicyService = require('../services/school/notificationCenterOperationPolicyService');
const { SECTIONS } = require('../../config/accessConstants');

const accessService = requireCoreModule('MVC/services/security/index');
const firstRunBootstrapService = requireCoreModule('MVC/services/firstRunBootstrapService');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');

const ACCESS_REQUIRED_MESSAGE = 'You do not have access to this area yet. If you need it for your work, please contact your administrator or support team to request access.';

function denyAccess(req, res, reason, operationId) {
  const message = reason || ACCESS_REQUIRED_MESSAGE;
  if (req.headers['x-ajax-request'] || req.xhr || req.headers.accept?.includes('json')) {
    return res.status(403).json({
      status: 'access_required',
      message: ACCESS_REQUIRED_MESSAGE,
      reason: message
    });
  }
  return res.status(403).render('error', {
    title: 'Access Needed',
    statusCode: 403,
    message: ACCESS_REQUIRED_MESSAGE,
    user: req.user,
    accessRequest: {
      sectionId: SECTIONS.SCHOOL_NOTIFICATION_CENTER,
      operationId: String(operationId || '').trim(),
      reason: message,
      path: req.originalUrl || req.url || ''
    }
  });
}

async function evaluateNotificationCenterOperation(req, operationId) {
  const normalizedOperationId = String(operationId || '').trim();
  let evaluation = { allowed: false, reason: 'Access evaluation failed.' };
  try {
    evaluation = await accessService.evaluateAccess({
      user: req.user,
      sectionId: SECTIONS.SCHOOL_NOTIFICATION_CENTER,
      operationId: normalizedOperationId,
      ipAddress: req.ip
    });
  } catch (error) {
    evaluation = { allowed: false, reason: error?.message || evaluation.reason };
  }

  const policy = await notificationCenterOperationPolicyService.applyOperationPolicy({
    user: req.user,
    operationId: normalizedOperationId,
    evaluation
  });

  return {
    ...evaluation,
    allowed: policy.allowed === true,
    scopeId: policy.scopeId || evaluation.scopeId || '',
    reason: policy.reason || evaluation.reason,
    adminContext: evaluation.adminContext || req.adminContext || null,
    limits: evaluation.limits || {}
  };
}

function requireNotificationCenterOperation(operationId) {
  const normalizedOperationId = String(operationId || '').trim();
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication required before access check.'
        });
      }

      if (adminAuthorityService.isSuperAdmin(req.user) || req.adminContext?.isSuperAdmin) {
        req.accessScope = req.accessScope || '';
        return next();
      }

      const bootstrapBypassAllowed = await firstRunBootstrapService.isBypassAllowed({
        user: req.user,
        sectionId: SECTIONS.SCHOOL_NOTIFICATION_CENTER
      });
      if (bootstrapBypassAllowed) {
        req.accessScope = req.accessScope || '';
        return next();
      }

      const evaluation = await evaluateNotificationCenterOperation(req, normalizedOperationId);
      if (!evaluation?.allowed) {
        return denyAccess(req, res, evaluation?.reason, normalizedOperationId);
      }

      req.accessLimits = evaluation.limits || {};
      req.accessScope = evaluation.scopeId || '';
      req.adminContext = evaluation.adminContext || req.adminContext || null;
      if (res.locals) res.locals.adminContext = req.adminContext;
      return next();
    } catch (error) {
      console.error('Notification Centre Route Guard Error:', error);
      return res.status(500).send('Internal Security Error');
    }
  };
}

module.exports = {
  requireNotificationCenterOperation,
  evaluateNotificationCenterOperation
};
