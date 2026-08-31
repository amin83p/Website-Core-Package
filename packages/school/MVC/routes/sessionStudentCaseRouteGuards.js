'use strict';

const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

const accessService = requireCoreModule('MVC/services/security/index');

async function evaluateCaseSectionAccess(req, operationId) {
  try {
    const evaluation = await accessService.evaluateAccess({
      user: req.user,
      sectionId: SECTIONS.SCHOOL_SESSION_STUDENT_CASES,
      operationId,
      ipAddress: req?.ip
    });
    return evaluation;
  } catch (_) {
    return { allowed: false, reason: 'Insufficient permissions.' };
  }
}

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

function requireCaseSectionOperationAny(operationIds) {
  const ids = (Array.isArray(operationIds) ? operationIds : [operationIds])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required before access check.'
      });
    }
    let lastReason = 'Insufficient permissions.';
    for (const operationId of ids) {
      // eslint-disable-next-line no-await-in-loop
      const evaluation = await evaluateCaseSectionAccess(req, operationId);
      if (evaluation?.allowed) {
        req.accessLimits = evaluation.limits || {};
        req.accessScope = evaluation.scopeId;
        return next();
      }
      lastReason = evaluation?.reason || lastReason;
    }
    return denyAccess(req, res, lastReason);
  };
}

function requireCaseStatusMutationAccess(req, res, next) {
  const status = String(req.body?.status || '').trim().toLowerCase();
  const operationId = status === 'resolved' ? OPERATIONS.RESOLVE : OPERATIONS.UPDATE;
  return requireCaseSectionOperationAny(operationId)(req, res, next);
}

async function requireCaseRoutingAdmin(req, res, next) {
  const schoolAdminAccessService = require('../services/school/schoolAdminAccessService');
  if (schoolAdminAccessService.isStudentCaseRoutingAdminViewer(req.user)) {
    return next();
  }
  return denyAccess(req, res, 'Only student case routing administrators can manage category routing.');
}

module.exports = {
  requireCaseSectionOperationAny,
  requireCaseStatusMutationAccess,
  requireCaseRoutingAdmin
};
