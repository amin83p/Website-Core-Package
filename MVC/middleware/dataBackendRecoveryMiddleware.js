const adminCheckersService = require('../services/adminChekersService');
const dataBackendRuntimeService = require('../services/dataBackendRuntimeService');

const PUBLIC_EXACT_PATHS = new Set([
  '/login',
  '/force-login',
  '/captcha',
  '/logout',
  '/password-reset',
  '/password-reset/request',
  '/password-reset/sms/start',
  '/password-reset/verify',
  '/password-reset/complete',
  '/site.webmanifest'
]);

const PUBLIC_PREFIXES = [
  '/auth/microsoft',
  '/internal/file-gateway'
];

const ADMIN_REPAIR_PREFIXES = [
  '/dashboard',
  '/systemSettings',
  '/debug',
  '/files',
  '/verify-admin',
  '/profile',
  '/users',
  '/sessions',
  '/sections',
  '/operations',
  '/scopes',
  '/accesses',
  '/accessPolicies',
  '/actionStates',
  '/security',
  '/logs',
  '/styles',
  '/symbols'
];

function normalizePath(value = '') {
  const path = String(value || '').split('?')[0].trim();
  if (!path || path === '/') return '/';
  return path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
}

function hasPrefix(pathValue, prefixes = []) {
  return prefixes.some((prefix) => pathValue === prefix || pathValue.startsWith(`${prefix}/`));
}

function isAjaxRequest(req) {
  return Boolean(req.headers['x-ajax-request'] || req.xhr || req.headers.accept?.includes('json'));
}

function isRecoveryAdmin(user) {
  return adminCheckersService.isAdmin(user);
}

function exposeBackendStatus(req, res, next) {
  const backendStatus = dataBackendRuntimeService.getPublicBackendStatus();
  res.locals.backendStatus = backendStatus;
  res.locals.backendRecoveryActive = Boolean(backendStatus?.fallback?.active);
  res.locals.backendRecoveryCanView = Boolean(req.user && isRecoveryAdmin(req.user));
  next();
}

function renderRecoveryPage(req, res, statusCode, message, options = {}) {
  const backendStatus = dataBackendRuntimeService.getPublicBackendStatus();
  if (isAjaxRequest(req)) {
    return res.status(statusCode).json({
      status: 'error',
      message,
      recoveryMode: true,
      backendStatus: {
        requestedMode: backendStatus?.runtime?.requestedMode || backendStatus?.requested || '',
        activeMode: backendStatus?.mode || '',
        reason: backendStatus?.fallback?.reason || ''
      }
    });
  }

  return res.status(statusCode).render('systemSettings/recoveryMode', {
    title: 'Database Recovery Mode',
    user: req.user || null,
    backendStatus,
    message,
    isAdminRecoveryUser: Boolean(options.isAdminRecoveryUser),
    attemptedPath: req.originalUrl || req.url || ''
  });
}

function enforceRecoveryMode(req, res, next) {
  if (!dataBackendRuntimeService.isRecoveryModeActive()) return next();

  const reqPath = normalizePath(req.path || req.url || '');
  if (PUBLIC_EXACT_PATHS.has(reqPath) || hasPrefix(reqPath, PUBLIC_PREFIXES)) {
    return next();
  }

  if (!req.user) {
    if (isAjaxRequest(req)) {
      return renderRecoveryPage(
        req,
        res,
        503,
        'The app is running in database recovery mode. Please sign in with a system administrator account.'
      );
    }
    return res.redirect('/login?warning=' + encodeURIComponent('Mongo is unavailable. Sign in with a system administrator account to use recovery mode.'));
  }

  const isAdminRecoveryUser = isRecoveryAdmin(req.user);
  if (!isAdminRecoveryUser) {
    return renderRecoveryPage(
      req,
      res,
      503,
      'The app is temporarily in database recovery mode. Normal user areas are paused until MongoDB is restored.',
      { isAdminRecoveryUser: false }
    );
  }

  if (hasPrefix(reqPath, ADMIN_REPAIR_PREFIXES)) {
    return next();
  }

  return renderRecoveryPage(
    req,
    res,
    503,
    'This page is blocked in JSON recovery mode to prevent production data from being written to the wrong backend.',
    { isAdminRecoveryUser: true }
  );
}

module.exports = {
  exposeBackendStatus,
  enforceRecoveryMode
};
