'use strict';

const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const studentCaseAccessService = require('../services/school/studentCaseAccessService');
const studentCaseOperationPolicyService = require('../services/school/studentCaseOperationPolicyService');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

const accessService = requireCoreModule('MVC/services/security/index');
const firstRunBootstrapService = requireCoreModule('MVC/services/firstRunBootstrapService');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');

const ACCESS_REQUIRED_MESSAGE = 'You do not have access to this area yet. If you need it for your work, please contact your administrator or support team to request access.';

function denyAccess(req, res, reason) {
  const message = reason || ACCESS_REQUIRED_MESSAGE;
  if (req.xhr || req.headers.accept?.includes('application/json') || req.headers['x-ajax-request']) {
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
      sectionId: SECTIONS.SCHOOL_SESSION_STUDENT_CASES,
      reason: message,
      path: req.originalUrl || req.url || ''
    }
  });
}

async function evaluateCaseSectionAccess(req, operationId) {
  try {
    const evaluation = await accessService.evaluateAccess({
      user: req.user,
      sectionId: SECTIONS.SCHOOL_SESSION_STUDENT_CASES,
      operationId,
      ipAddress: req?.ip
    });
    const policy = await studentCaseOperationPolicyService.applyOperationPolicy({
      user: req.user,
      operationId,
      evaluation
    });
    return {
      ...evaluation,
      allowed: policy.allowed,
      scopeId: policy.scopeId || evaluation.scopeId,
      reason: policy.reason || evaluation.reason
    };
  } catch (_) {
    return { allowed: false, reason: 'Insufficient permissions.' };
  }
}

async function allowStudentCaseBypass(req) {
  if (adminAuthorityService.isSuperAdmin(req.user) || req.adminContext?.isSuperAdmin) {
    req.accessScope = req.accessScope || '';
    return true;
  }
  const bootstrapBypassAllowed = await firstRunBootstrapService.isBypassAllowed({
    user: req.user,
    sectionId: SECTIONS.SCHOOL_SESSION_STUDENT_CASES
  });
  if (bootstrapBypassAllowed) {
    req.accessScope = req.accessScope || '';
    return true;
  }
  return false;
}

function requireStudentCaseOperation(operationId) {
  const normalizedOperationId = String(operationId || '').trim();
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication required before access check.'
        });
      }
      if (await allowStudentCaseBypass(req)) {
        return next();
      }
      const evaluation = await evaluateCaseSectionAccess(req, normalizedOperationId);
      if (!evaluation?.allowed) {
        return denyAccess(req, res, evaluation?.reason);
      }
      req.accessLimits = evaluation.limits || {};
      req.accessScope = evaluation.scopeId || '';
      req.adminContext = evaluation.adminContext || req.adminContext || null;
      if (res.locals) res.locals.adminContext = req.adminContext;
      return next();
    } catch (error) {
      console.error('Student Case Route Guard Error:', error);
      return res.status(500).send('Internal Security Error');
    }
  };
}

function requireCaseSectionOperationAny(operationIds) {
  const ids = (Array.isArray(operationIds) ? operationIds : [operationIds])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication required before access check.'
        });
      }
      if (await allowStudentCaseBypass(req)) {
        return next();
      }
      let lastReason = 'Insufficient permissions.';
      for (const operationId of ids) {
        // eslint-disable-next-line no-await-in-loop
        const evaluation = await evaluateCaseSectionAccess(req, operationId);
        if (evaluation?.allowed) {
          req.accessLimits = evaluation.limits || {};
          req.accessScope = evaluation.scopeId || '';
          req.adminContext = evaluation.adminContext || req.adminContext || null;
          if (res.locals) res.locals.adminContext = req.adminContext;
          return next();
        }
        lastReason = evaluation?.reason || lastReason;
      }
      return denyAccess(req, res, lastReason);
    } catch (error) {
      console.error('Student Case Route Guard Error:', error);
      return res.status(500).send('Internal Security Error');
    }
  };
}

function requireCaseStatusMutationAccess(req, res, next) {
  const status = String(req.body?.status || '').trim().toLowerCase();
  const operationId = status === 'resolved' ? OPERATIONS.RESOLVE : OPERATIONS.UPDATE;
  return requireStudentCaseOperation(operationId)(req, res, next);
}

async function requireCaseRoutingAdmin(req, res, next) {
  const access = await studentCaseAccessService.buildStudentCaseAccess(req.user, req.ip);
  if (access.canConfigureRouting) {
    return next();
  }
  return denyAccess(req, res, 'Only student case routing administrators can manage category routing.');
}

module.exports = {
  requireStudentCaseOperation,
  requireCaseSectionOperationAny,
  requireCaseStatusMutationAccess,
  requireCaseRoutingAdmin,
  evaluateCaseSectionAccess
};
