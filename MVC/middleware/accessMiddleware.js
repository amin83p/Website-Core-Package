// MVC/middleware/accessMiddleware.js
const accessService = require('../services/security/index');

function setLogContext(req, sectionId, operationId) {
  if (!req || typeof req !== 'object') return;
  const sec = String(sectionId || '').trim();
  const op = String(operationId || '').trim();
  if (sec) req.logSectionId = sec;
  if (op) req.logOperationId = op;
}

/**
 * Access Control Middleware Factory
 * * Usage in Routes:
 * router.post('/users/edit/:id', 
 * requireAuth, 
 * requireAccess('USERS', 'OP_EDIT_USER'), 
 * userController.editUser
 * );
 */
const ACCESS_REQUIRED_MESSAGE = 'You do not have access to this area yet. If you need it for your work, please contact your administrator or support team to request access.';
const ACCESS_POLICY_BANNED_MESSAGE = 'Your access to this area is restricted by an active security policy.';
const ACCESS_RESTRICTED_REDIRECT_URL = '/dashboard';

function isPolicyBannedContext(accessContext = {}) {
  const deniedCode = String(accessContext.deniedCode || '').trim().toUpperCase();
  const policyCodes = new Set([
    'WEBSITE_POLICY_BAN',
    'ORG_POLICY_BAN',
    'ORG_POLICY_BANNED_USER',
    'WEBSITE_POLICY_BANNED_USER',
    'WEBSITE_POLICY_NETWORK',
    'ORG_POLICY_NETWORK',
    'USER_POLICY_NETWORK',
    'WEBSITE_POLICY_SCHEDULE',
    'ORG_POLICY_SCHEDULE',
    'USER_POLICY_SCHEDULE'
  ]);
  if (policyCodes.has(deniedCode)) return true;
  const deniedLayer = String(accessContext?.deniedMeta?.layer || '').trim().toLowerCase();
  if (deniedLayer === 'website' || deniedLayer === 'organization' || deniedLayer === 'user') return true;
  const reason = String(accessContext.reason || '').toLowerCase();
  return (
    reason.includes('organization policy') && reason.includes('banned')
  ) || reason.includes('temporarily unavailable') || reason.includes('temporarily disabled by administrators');
}

const denyAccess = (req, res, reason, context = {}) => {
  const accessContext = {
    sectionId: context.sectionId || '',
    operationId: context.operationId || '',
    sectionIds: Array.isArray(context.sectionIds) ? context.sectionIds : [],
    reason: reason || 'This area is protected.',
    path: req.originalUrl || req.url || '',
    deniedCode: context.deniedCode || '',
    deniedMeta: context.deniedMeta && typeof context.deniedMeta === 'object' ? context.deniedMeta : null
  };
  const policyBanned = isPolicyBannedContext(accessContext);
  const pageMessage = policyBanned ? ACCESS_POLICY_BANNED_MESSAGE : ACCESS_REQUIRED_MESSAGE;
  if (policyBanned) {
    res.setHeader('X-Access-Restricted', 'policy');
  }

  if (req.headers['x-ajax-request'] || req.xhr || req.headers.accept?.includes('json')) {
    return res.status(403).json({
      status: policyBanned ? 'access_restricted' : 'access_required',
      message: pageMessage,
      reason: accessContext.reason,
      deniedCode: accessContext.deniedCode,
      deniedMeta: accessContext.deniedMeta,
      redirectUrl: policyBanned ? ACCESS_RESTRICTED_REDIRECT_URL : '',
      accessRequest: accessContext
    });
  }
  if (policyBanned) {
    return res.status(403).render('access/policyBanned', {
      title: 'Access Restricted',
      statusCode: 403,
      message: pageMessage,
      user: req.user,
      accessRequest: accessContext
    });
  }
  return res.status(403).render('error', {
    title: 'Access Needed',
    statusCode: 403,
    message: pageMessage,
    user: req.user,
    accessRequest: accessContext
  });
};

const requireAccess = (sectionId, operationId) => {
  //console.log('here i am for ',sectionId,' and ',operationId);
  return async (req, res, next) => {
    try {
      setLogContext(req, sectionId, operationId);

      // 1. Ensure User Context exists (Auth Middleware should run before this)
      if (!req.user) {
        return res.status(401).json({ 
            status: 'error', 
            message: 'Authentication required before access check.' 
        });
      }

      // 2. Evaluate Access
      const evaluation = await accessService.evaluateAccess({
        user: req.user,
        sectionId: sectionId,
        operationId: operationId,
        ipAddress: req.ip
      });
      //console.log(evaluation);
      // 3. Handle Denial
      if (!evaluation.allowed) {
        // Log the security event here if needed (e.g., via logger.denied)
        return denyAccess(req, res, evaluation.reason, {
          sectionId,
          operationId,
          deniedCode: evaluation.deniedCode,
          deniedMeta: evaluation.deniedMeta
        });
      }

      // 4. Attach Limits for Controller Use
      // This is crucial for your future "Activity" tracking.
      // The controller can read req.accessLimits.maxAttempts or maxVolumeKB
      req.accessLimits = evaluation.limits || {};
      req.adminContext = evaluation.adminContext || req.adminContext || null;
      res.locals.adminContext = req.adminContext;
      
      // 5. Attach Scope (Optional, useful for data filtering)
      req.accessScope = evaluation.scopeId;
      setLogContext(req, sectionId, operationId);

      next();

    } catch (error) {
      console.error("Access Middleware Error:", error);
      res.status(500).send("Internal Security Error");
    }
  };
};

/**
 * Allow the request if the user is permitted the operation on any of the listed sections.
 */
const requireAccessAny = (sectionIds, operationId) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication required before access check.'
        });
      }
      const ids = Array.isArray(sectionIds) ? sectionIds : [];
      if (!ids.length) {
        return denyAccess(req, res, 'No sections configured for this route.', { operationId });
      }
      let lastReason = 'Insufficient permissions.';
      let lastEvaluation = null;
      for (const sectionId of ids) {
        setLogContext(req, sectionId, operationId);
        // eslint-disable-next-line no-await-in-loop
        const evaluation = await accessService.evaluateAccess({
          user: req.user,
          sectionId,
          operationId,
          ipAddress: req.ip
        });
        if (evaluation.allowed) {
          req.accessLimits = evaluation.limits || {};
          req.adminContext = evaluation.adminContext || req.adminContext || null;
          res.locals.adminContext = req.adminContext;
          req.accessScope = evaluation.scopeId;
          setLogContext(req, sectionId, operationId);
          return next();
        }
        lastReason = evaluation.reason || lastReason;
        lastEvaluation = evaluation;
      }
      return denyAccess(req, res, lastReason, {
        sectionIds: ids,
        operationId,
        deniedCode: lastEvaluation?.deniedCode,
        deniedMeta: lastEvaluation?.deniedMeta
      });
    } catch (error) {
      console.error('Access Middleware Error:', error);
      return res.status(500).send('Internal Security Error');
    }
  };
};

const checkAccess = async (sectionId, operationId) => {
  //console.log('here i am for ',sectionId,' and ',operationId);
    try {
      // 1. Ensure User Context exists (Auth Middleware should run before this)
      if (!req.user) return false 

      // 2. Evaluate Access
      const evaluation = await accessService.evaluateAccess({
        user: req.user,
        sectionId: sectionId,
        operationId: operationId,
        ipAddress: req.ip
      });
      //console.log(evaluation);
      // 3. Handle Denial
      if (!evaluation.allowed) {
        // Log the security event here if needed (e.g., via logger.denied)
        
        // Return 403
        if (req.headers['x-ajax-request'] || req.xhr || req.headers.accept?.includes('json'))
            return false
      }

      // 4. Attach Limits for Controller Use
      // This is crucial for your future "Activity" tracking.
      // The controller can read req.accessLimits.maxAttempts or maxVolumeKB
      req.accessLimits = evaluation.limits || {};
      
      // 5. Attach Scope (Optional, useful for data filtering)
      req.accessScope = evaluation.scopeId;

      return true;

    } catch (error) {
      console.error("Access Middleware Error:", error);
      return false;
    }
};

module.exports = { requireAccess, requireAccessAny, checkAccess };
