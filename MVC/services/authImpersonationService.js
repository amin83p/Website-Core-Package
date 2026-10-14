'use strict';

const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('../../config/security');
const { SYSTEM_CONTEXT } = require('../../config/constants');
const { idsEqual, toPublicId } = require('../utils/idAdapter');
const dataService = require('./dataService');
const authService = require('./authService');
const sessionService = require('./SessionService');
const adminAuthorityService = require('./adminAuthorityService');
const startupLogger = require('../utils/startupLogger');
const { sanitizeAppReturnUrl } = require('../utils/pagePathUtils');

const IMPERSONATOR_COOKIE = 'auth_impersonator_token';
const DEFAULT_DASHBOARD_URL = '/dashboard';

function isBlockedImpersonationReturnPath(value = '') {
  const pathname = String(value || '').split('?')[0].trim().toLowerCase();
  return pathname === '/logout' || pathname === '/login';
}

function resolveImpersonationReturnUrl(req) {
  const safe = sanitizeAppReturnUrl(req?.query?.returnTo || req?.query?.returnPath || '');
  if (!safe || isBlockedImpersonationReturnPath(safe)) return '';
  return safe;
}

function buildImpersonationLogoutHref(req) {
  const safeReturn = sanitizeAppReturnUrl(req?.originalUrl || req?.url || '');
  if (!safeReturn || isBlockedImpersonationReturnPath(safeReturn)) return '/logout';
  return `/logout?returnTo=${encodeURIComponent(safeReturn)}`;
}

function extractSessionIdFromToken(token) {
  const parts = String(token || '').split('.');
  return parts.length === 3 ? String(parts[2] || '').trim() : '';
}

function authCookieOptions(maxDurationMins) {
  const safeMinutes = Number(maxDurationMins);
  const maxAgeMs = (Number.isFinite(safeMinutes) && safeMinutes > 0 ? safeMinutes : 1440) * 60 * 1000;
  return {
    httpOnly: true,
    secure: String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production',
    sameSite: 'lax',
    maxAge: maxAgeMs
  };
}

function resolveTokenMaxAgeMinutes(token) {
  try {
    const decoded = jwt.decode(String(token || '').trim());
    if (decoded?.exp && decoded?.iat) {
      const spanSec = Number(decoded.exp) - Number(decoded.iat);
      if (Number.isFinite(spanSec) && spanSec > 0) {
        return Math.max(1, Math.ceil(spanSec / 60));
      }
    }
  } catch (_) {
    // ignore
  }
  return 1440;
}

function buildDeviceInfo(req, provider = 'impersonation') {
  return {
    ip: req?.ip,
    browser: req?.headers?.['user-agent'] || 'Unknown',
    authProvider: provider
  };
}

function logImpersonationEvent(event, { actorUserId = '', targetUserId = '', req = null, details = {} } = {}) {
  startupLogger.info('AUTH', String(event || 'IMPERSONATION'), 'Super-admin impersonation event.', {
    actorUserId: toPublicId(actorUserId),
    targetUserId: toPublicId(targetUserId),
    ip: String(req?.ip || '').trim(),
    path: String(req?.originalUrl || req?.url || '').trim(),
    ...details
  });
  try {
    const sessionAuthDiagnosticLogService = require('./diagnostics/sessionAuthDiagnosticLogService');
    sessionAuthDiagnosticLogService.logSessionAuthEvent({
      event: String(event || 'IMPERSONATION'),
      reason: 'super_admin_impersonation',
      user: { id: toPublicId(actorUserId) },
      req,
      details: {
        targetUserId: toPublicId(targetUserId),
        ...details
      }
    });
  } catch (_) {
    // ignore diagnostic failures
  }
}

function assertSuperAdminCanImpersonate(actorUser, targetUser) {
  if (!adminAuthorityService.isSuperAdmin(actorUser)) {
    const error = new Error('Only super administrators can impersonate users.');
    error.statusCode = 403;
    throw error;
  }
  if (!targetUser || typeof targetUser !== 'object') {
    const error = new Error('Target user was not found.');
    error.statusCode = 404;
    throw error;
  }
  if (!targetUser.active || String(targetUser.status || '').trim().toLowerCase() !== 'active') {
    const error = new Error('Target user is not active.');
    error.statusCode = 400;
    throw error;
  }
  if (idsEqual(actorUser?.id, targetUser?.id)) {
    const error = new Error('You cannot impersonate your own account.');
    error.statusCode = 400;
    throw error;
  }
  if (adminAuthorityService.isSuperAdmin(targetUser)) {
    const error = new Error('Super administrator accounts cannot be impersonated.');
    error.statusCode = 403;
    throw error;
  }
}

async function loadTargetUserForImpersonation(targetUserId) {
  const normalizedId = toPublicId(targetUserId);
  if (!normalizedId) return null;
  return dataService.getDataById('users', normalizedId, SYSTEM_CONTEXT);
}

async function issueAuthSessionForUser(req, res, user, {
  provider = 'impersonation',
  impersonatedByUserId = ''
} = {}) {
  const orgId = user.primaryOrgId || 'SYSTEM';
  const limits = await sessionService.resolvePolicyLimits(user, orgId);
  const maxDurationMins = limits.maxDurationMins || 1440;

  const token = authService.generateToken(user, maxDurationMins);
  const tokenSignature = extractSessionIdFromToken(token);
  await sessionService.createSession(
    user,
    orgId,
    buildDeviceInfo(req, provider),
    tokenSignature,
    { impersonatedByUserId: toPublicId(impersonatedByUserId) }
  );

  res.cookie('auth_token', token, authCookieOptions(maxDurationMins));
  return { token, maxDurationMins };
}

async function beginImpersonation(req, res, targetUserId) {
  const impersonatorToken = String(req?.cookies?.[IMPERSONATOR_COOKIE] || '').trim();
  if (impersonatorToken) {
    const error = new Error('Finish the current impersonation session before starting another.');
    error.statusCode = 409;
    throw error;
  }

  const actorUser = req?.user;
  if (!adminAuthorityService.isSuperAdmin(actorUser)) {
    const error = new Error('Only super administrators can impersonate users.');
    error.statusCode = 403;
    throw error;
  }

  const currentToken = String(req?.cookies?.auth_token || '').trim();
  if (!currentToken || !authService.validateToken(currentToken)) {
    const error = new Error('Authentication required.');
    error.statusCode = 401;
    throw error;
  }

  const targetUser = await loadTargetUserForImpersonation(targetUserId);
  assertSuperAdminCanImpersonate(actorUser, targetUser);

  const impersonatorMaxAgeMins = resolveTokenMaxAgeMinutes(currentToken);
  res.cookie(IMPERSONATOR_COOKIE, currentToken, authCookieOptions(impersonatorMaxAgeMins));

  let issued;
  try {
    issued = await issueAuthSessionForUser(req, res, targetUser, {
      provider: 'impersonation',
      impersonatedByUserId: toPublicId(actorUser?.id)
    });
  } catch (error) {
    res.clearCookie(IMPERSONATOR_COOKIE);
    throw error;
  }
  const { token } = issued;

  logImpersonationEvent('IMPERSONATION_START', {
    actorUserId: actorUser?.id,
    targetUserId: targetUser?.id,
    req
  });

  let redirectUrl = DEFAULT_DASHBOARD_URL;
  try {
    await authService.getUserFromToken(token);
  } catch (_) {
    // keep default redirect
  }

  return {
    targetUserId: toPublicId(targetUser?.id),
    redirectUrl
  };
}

async function endImpersonationIfActive(req, res) {
  const impersonatorToken = String(req?.cookies?.[IMPERSONATOR_COOKIE] || '').trim();
  if (!impersonatorToken) {
    return false;
  }

  const currentToken = String(req?.cookies?.auth_token || '').trim();
  const currentSessionId = extractSessionIdFromToken(currentToken);
  if (currentSessionId) {
    try {
      await sessionService.terminateSession(currentSessionId);
    } catch (error) {
      startupLogger.warn('AUTH', 'IMPERSONATION_END', 'Failed to terminate impersonation session.', {
        sessionId: currentSessionId,
        error: error?.message || String(error)
      });
    }
  }

  res.clearCookie(IMPERSONATOR_COOKIE);

  if (!impersonatorToken || !authService.validateToken(impersonatorToken)) {
    res.clearCookie('auth_token');
    if (req?.xhr || req?.headers?.accept?.includes('json') || req?.headers?.['x-ajax-request']) {
      res.status(401).json({
        status: 'error',
        message: 'Impersonation ended but the original admin session expired. Please sign in again.',
        redirect: '/login'
      });
      return true;
    }
    return res.redirect('/login?warning=Impersonation ended but your admin session expired. Please sign in again.');
  }

  const maxDurationMins = resolveTokenMaxAgeMinutes(impersonatorToken);
  res.cookie('auth_token', impersonatorToken, authCookieOptions(maxDurationMins));

  let actorUserId = '';
  try {
    const actor = await authService.getUserFromToken(impersonatorToken);
    actorUserId = toPublicId(actor?.id);
  } catch (_) {
    // ignore
  }

  logImpersonationEvent('IMPERSONATION_END', {
    actorUserId,
    targetUserId: toPublicId(req?.user?.id),
    req
  });

  const redirectUrl = resolveImpersonationReturnUrl(req) || DEFAULT_DASHBOARD_URL;

  if (req?.xhr || req?.headers?.accept?.includes('json') || req?.headers?.['x-ajax-request']) {
    res.json({
      status: 'success',
      message: 'Returned to your administrator account.',
      redirectUrl
    });
    return true;
  }

  res.redirect(redirectUrl);
  return true;
}

async function resolveImpersonationLocals(req, res) {
  const impersonatorToken = String(req?.cookies?.[IMPERSONATOR_COOKIE] || '').trim();
  res.locals.isImpersonating = Boolean(impersonatorToken);
  res.locals.canImpersonateUsers = Boolean(
    req?.user
    && adminAuthorityService.isSuperAdmin(req.user)
    && !impersonatorToken
  );
  res.locals.impersonationActorLabel = '';
  res.locals.impersonationLogoutHref = buildImpersonationLogoutHref(req);

  if (!impersonatorToken) return;

  try {
    const actor = await authService.getUserFromToken(impersonatorToken);
    res.locals.impersonationActorLabel = String(
      actor?.name
      || actor?.username
      || actor?.email
      || actor?.id
      || 'Administrator'
    ).trim();
  } catch (_) {
    res.clearCookie(IMPERSONATOR_COOKIE);
    res.locals.isImpersonating = false;
    res.locals.impersonationActorLabel = '';
  }
}

module.exports = {
  IMPERSONATOR_COOKIE,
  assertSuperAdminCanImpersonate,
  beginImpersonation,
  endImpersonationIfActive,
  resolveImpersonationLocals,
  resolveImpersonationReturnUrl,
  buildImpersonationLogoutHref,
  isImpersonationSessionRecord: sessionService.isImpersonationSessionRecord,
  countSessionsTowardUserLimit: sessionService.countSessionsTowardUserLimit
};
