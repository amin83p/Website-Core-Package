'use strict';

const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const { SECTIONS } = require('../../config/accessConstants');

const accessService = requireCoreModule('MVC/services/security/index');

const BOOK_COVERING_SECTION = SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING;

async function evaluateBookCoveringAccess(req, operationId) {
  try {
    return await accessService.evaluateAccess({
      user: req.user,
      sectionId: BOOK_COVERING_SECTION,
      operationId,
      ipAddress: req?.ip
    });
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

function requireBookCoveringOperationAny(operationIds) {
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
      const evaluation = await evaluateBookCoveringAccess(req, operationId);
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

module.exports = {
  requireBookCoveringOperationAny
};
