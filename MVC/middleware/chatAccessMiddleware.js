const chatAccessService = require('../services/chatAccessService');
const { SECTIONS } = require('../../config/accessConstants');

function setLogContext(req, operationId) {
  if (!req || typeof req !== 'object') return;
  req.logSectionId = SECTIONS.CHATS;
  if (operationId) req.logOperationId = operationId;
}

function denyAccess(req, res, reason) {
  const message = reason || 'Insufficient chat permissions.';
  if (req.headers['x-ajax-request'] || req.xhr || req.headers.accept?.includes('json')) {
    return res.status(403).json({
      status: 'error',
      message: `Access Denied: ${message}`
    });
  }
  return res.status(403).render('error', {
    title: 'Access Denied',
    message,
    user: req.user
  });
}

function requireChatAccessAny(operationIds, logOperationId = '') {
  return async (req, res, next) => {
    try {
      const operations = Array.isArray(operationIds) ? operationIds : [operationIds];
      setLogContext(req, logOperationId || operations[0]);

      if (!req.user) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication required before access check.'
        });
      }

      const result = await chatAccessService.canUseChatOperation(req.user, operations, req.ip);
      if (!result.allowed) {
        return denyAccess(req, res, result.reason || result.evaluation?.reason);
      }

      req.chatAllowedOperation = result.operationId;
      req.chatAccessEvaluation = result.evaluation || null;
      req.accessLimits = result.limits || result.evaluation?.limits || {};
      req.accessScope = result.scopeId || result.evaluation?.scopeId || null;
      setLogContext(req, result.operationId);
      return next();
    } catch (error) {
      console.error('Chat Access Middleware Error:', error);
      return res.status(500).send('Internal Security Error');
    }
  };
}

module.exports = {
  requireChatAccessAny
};
