// MVC/middleware/authMiddleware.js
const authService = require('../services/authService');
const adminAuthorityService = require('../services/adminAuthorityService');
const effectiveAccessResolverService = require('../services/security/effectiveAccessResolverService');

function attachAdminContext(req, res) {
  const adminContext = adminAuthorityService.resolveAdminAuthority({
    user: req.user,
    orgId: req.user?.activeOrgId
  });
  req.adminContext = adminContext;
  if (res?.locals) res.locals.adminContext = adminContext;
  return adminContext;
}

function isMembershipStatusExemptPath(reqPath = '') {
  const path = String(reqPath || '').trim().toLowerCase();
  if (!path) return false;
  return (
    path === '/membership-status'
    || path === '/logout'
    || path === '/switch-org'
    || path === '/switch-mode'
  );
}

function shouldRedirectToMembershipStatus(req) {
  if (!req?.user) return false;
  if (isMembershipStatusExemptPath(req.path)) return false;
  const entitlement = req.user.entitlement || null;
  return Boolean(entitlement?.enforced && entitlement.active === false);
}

function isPolicyGateExemptPath(reqPath = '') {
  const path = String(reqPath || '').trim().toLowerCase();
  if (!path) return false;
  return (
    path === '/logout'
    || path === '/switch-org'
    || path === '/switch-mode'
    || path === '/membership-status'
  );
}

function buildPolicyBlockedPayload(denied = null) {
  const layer = String(denied?.deniedMeta?.layer || 'policy').trim().toLowerCase();
  const target = String(denied?.deniedMeta?.target || 'access').trim().toLowerCase();
  const deniedCode = String(denied?.deniedCode || 'ACCESS_DENIED').trim() || 'ACCESS_DENIED';
  const reason = String(denied?.reason || denied?.message || 'Access is restricted by policy.').trim() || 'Access is restricted by policy.';
  let headline = 'Your account is restricted by policy.';
  if (target === 'network') headline = 'Access is restricted by network policy.';
  else if (target === 'schedule') headline = 'Access is restricted by schedule policy.';
  else if (target === 'user') headline = 'Your account is currently restricted.';
  else if (layer === 'website') headline = 'Access is restricted by website policy.';
  else if (layer === 'organization') headline = 'Access is restricted by organization policy.';

  return {
    status: 'access_restricted',
    message: headline,
    reason,
    deniedCode,
    deniedMeta: denied?.deniedMeta || null,
    redirectUrl: '/dashboard'
  };
}

function handlePolicyDenied(req, res, denied = null, isAjaxRequest = false) {
  const payload = buildPolicyBlockedPayload(denied);
  res.setHeader('X-Access-Restricted', 'policy');
  if (isAjaxRequest) {
    return res.status(403).json(payload);
  }
  return res.status(403).render('access/policyBanned', {
    title: 'Access Restricted by Policy',
    statusCode: 403,
    message: payload.message,
    user: req.user || null,
    accessRequest: {
      reason: payload.reason,
      path: req.originalUrl || req.url || '',
      deniedCode: payload.deniedCode,
      deniedMeta: payload.deniedMeta
    }
  });
}

async function requireAuth(req, res, next) {
  const token = req.cookies.auth_token;
  const isAjaxRequest = Boolean(req.headers['x-ajax-request'] || req.xhr || req.headers.accept?.includes('json'));
  // 1. No token? Standard redirect.
  if (!token) {
    if (isAjaxRequest) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required.',
        redirect: '/login'
      });
    }
    return res.redirect('/login');
  }
  // 2. Invalid signature? Clear and redirect.
  if (!authService.validateToken(token)) {
    res.clearCookie('auth_token');
    if (isAjaxRequest) {
      return res.status(401).json({
        status: 'error',
        message: 'Session expired. Please log in again.',
        redirect: '/login'
      });
    }
    return res.redirect('/login?warning=Session expired. Please log in again.');
  }  

  try {
    // 3. Hydrate User Context
    // This is where "No active organization" errors are thrown
    if(typeof req.user === 'undefined' || !req.user){
      const user = await authService.getUserFromToken(token);
      //console.log(JSON.stringify(user));
      req.user = user; // Attach user to request
    }

    const isSuperAdmin = adminAuthorityService.isSuperAdmin(req.user);
    if (!isPolicyGateExemptPath(req.path) && !isSuperAdmin) {
      const globalPolicyContext = await effectiveAccessResolverService.resolveGlobalPolicyContext({
        user: req.user,
        orgId: req.user?.activeOrgId,
        ipAddress: req.ip,
        websitePolicy: req.websitePolicy || null,
        now: new Date()
      });

      req.globalPolicyContext = globalPolicyContext;
      if (res?.locals) res.locals.globalPolicyContext = globalPolicyContext;

      if (globalPolicyContext && globalPolicyContext.allowed === false) {
        return handlePolicyDenied(req, res, globalPolicyContext.denied, isAjaxRequest);
      }
    } else {
      req.globalPolicyContext = null;
      if (res?.locals) res.locals.globalPolicyContext = null;
    }

    if (shouldRedirectToMembershipStatus(req)) {
      const reason = req.user?.entitlement?.reason || 'Membership is inactive.';
      if (isAjaxRequest) {
        return res.status(403).json({
          status: 'error',
          message: reason,
          redirect: '/membership-status'
        });
      }
      return res.redirect('/membership-status');
    }
    attachAdminContext(req, res);
    next();
  } catch (error) {
    console.warn('Auth Context Failed:', error.message);    
    // ✅ 4. Clear the invalid session so they aren't stuck
    res.clearCookie('auth_token');

    // ✅ 5. Handle AJAX Requests (don't send HTML redirect to JSON fetchers)
    if (isAjaxRequest) {
        return res.status(403).json({ 
            status: 'error', 
            message: error.message, 
            redirect: '/login' 
        });
    }

    // ✅ 6. Redirect to Login with the Error Message
    // encodeURIComponent ensures special chars like <br> are safe in the URL
    return res.redirect(`/login?warning=${encodeURIComponent(error.message)}`);  }
}

async function softAuth(req, res, next) {
  const token = req.cookies.auth_token;
  if (!token) {
      req.user = null; // Guest
      attachAdminContext(req, res);
      return next();
  }
  try {
      if (!authService.validateToken(token)) throw new Error('Invalid Token');
      const user = await authService.getUserFromToken(token);
      req.user = user;
      attachAdminContext(req, res);
  } catch (error) {
      req.user = null; // Invalid token -> Treat as Guest
      attachAdminContext(req, res);
      // Optional: res.clearCookie('auth_token');
  }
  next();
}

module.exports = { requireAuth, softAuth };
