// MVC/middleware/sessionEnforcement.js
const dataService = require('../services/dataService');
const { SYSTEM_CONTEXT } = require('../../config/constants');
const { sanitizeCurrentPath } = require('../utils/pagePathUtils');
const sessionRecordCacheService = require('../services/cache/sessionRecordCacheService');
const sessionAuthDiagnosticLogService = require('../services/diagnostics/sessionAuthDiagnosticLogService');

const SESSION_HEARTBEAT_MS = 60 * 1000;

function parseSafeInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveSessionMaxDurationMinutes(session = {}) {
    const stored = parseSafeInt(session.maxDurationMinutes, null);
    if (stored > 0) return stored;
    const createdAt = session.createdAt ? new Date(session.createdAt) : null;
    const absoluteExpiry = session.absoluteExpiry ? new Date(session.absoluteExpiry) : null;
    if (!createdAt || !absoluteExpiry || Number.isNaN(createdAt.getTime()) || Number.isNaN(absoluteExpiry.getTime())) {
        return 720;
    }
    const mins = Math.round((absoluteExpiry.getTime() - createdAt.getTime()) / 60000);
    return mins > 0 ? mins : 720;
}

function buildSessionExpiryDiagnostics(session = {}, now = new Date()) {
    const lastActive = session?.lastActivityAt ? new Date(session.lastActivityAt) : null;
    const absoluteExpiry = session?.absoluteExpiry ? new Date(session.absoluteExpiry) : null;
    const idleLimitMs = sessionRecordCacheService.resolveEffectiveIdleLimitMs(session);
    const minutesSinceActivity = lastActive && !Number.isNaN(lastActive.getTime())
        ? Math.round((now - lastActive) / 60000)
        : null;
    const minutesUntilAbsoluteExpiry = absoluteExpiry && !Number.isNaN(absoluteExpiry.getTime())
        ? Math.round((absoluteExpiry - now) / 60000)
        : null;
    return {
        expiryReason: sessionRecordCacheService.resolveSessionExpiryReason(session, now) || '',
        idleTimeoutMinutes: parseSafeInt(session?.idleTimeoutMinutes, 30),
        maxDurationMinutes: resolveSessionMaxDurationMinutes(session),
        minutesSinceActivity,
        minutesUntilAbsoluteExpiry
    };
}

const CURRENT_PATH_UPDATE_THROTTLE_MS = 3 * 60 * 1000;
const PUBLIC_STATIC_PREFIXES = Object.freeze([
    '/scripts/',
    '/styles/',
    '/uploads/',
    '/package-assets/'
]);
const PUBLIC_STATIC_EXACT_PATHS = Object.freeze(new Set([
    '/favicon.ico',
    '/site.webmanifest'
]));

function normalizeRequestPath(req) {
    return sanitizeCurrentPath(req?.originalUrl || req?.url || req?.path || '').toLowerCase();
}

function isPublicStaticAssetRequest(req) {
    const method = String(req?.method || '').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return false;

    const pathname = normalizeRequestPath(req);
    if (!pathname) return false;
    if (PUBLIC_STATIC_EXACT_PATHS.has(pathname)) return true;
    return PUBLIC_STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function toValidDate(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
}

function shouldUpdateCurrentPath(session = {}, currentPath = '', now = new Date(), options = {}) {
    const nextPath = sanitizeCurrentPath(currentPath || '');
    if (!nextPath) return false;

    const previousPath = sanitizeCurrentPath(session.currentPath || '');
    const heartbeatDue = options?.heartbeatDue === true;
    if (!previousPath) return true;
    if (heartbeatDue) return true;
    if (nextPath === previousPath) return false;

    const lastUpdated = toValidDate(session.currentPathUpdatedAt);
    if (!lastUpdated) return true;
    return (now - lastUpdated) >= CURRENT_PATH_UPDATE_THROTTLE_MS;
}

function shouldTrackCurrentPathForRequest(req) {
    return false;
}

async function updateSessionCurrentPath(req, currentPath = '') {
    const session = req?.userSession || {};
    const sessionId = String(session.id || '').trim();
    if (!sessionId) return false;

    const sanitizedPath = sanitizeCurrentPath(
        currentPath || req?.originalUrl || req?.url || req?.path || ''
    );
    if (!sanitizedPath) return false;

    const now = new Date();
    if (!shouldUpdateCurrentPath(session, sanitizedPath, now)) return true;

    const updates = {
        currentPath: sanitizedPath,
        currentPathUpdatedAt: now.toISOString()
    };
    await dataService.updateData('sessions', sessionId, updates, SYSTEM_CONTEXT);
    Object.assign(session, updates);
    sessionRecordCacheService.set(sessionId, session);
    return true;
}

function rejectMissingSession(req, res, session = null) {
    sessionAuthDiagnosticLogService.logSessionAuthEvent({
        event: 'SESSION_REJECTED',
        reason: 'missing_or_revoked',
        req,
        session,
        details: buildSessionExpiryDiagnostics(session || {})
    });
    res.clearCookie('auth_token');
    if (req.xhr || req.headers['x-ajax-request']) {
        return res.status(401).json({ status: 'error', message: 'Session expired or revoked.' });
    }
    return res.redirect('/login?warning=Your session has been terminated.');
}

function rejectTimedOutSession(req, res, session = null, expiryReason = 'timeout') {
    const normalizedReason = String(expiryReason || 'timeout').trim() || 'timeout';
    sessionAuthDiagnosticLogService.logSessionAuthEvent({
        event: 'SESSION_REJECTED',
        reason: normalizedReason,
        req,
        session,
        details: buildSessionExpiryDiagnostics(session || {})
    });
    res.clearCookie('auth_token');
    const warning = normalizedReason === 'idle'
        ? 'Session timed out due to inactivity.'
        : (normalizedReason === 'absolute'
            ? 'Session timed out due to maximum session length.'
            : 'Session timed out.');
    if (req.xhr || req.headers['x-ajax-request']) {
        return res.status(401).json({ status: 'error', message: 'Session timed out.' });
    }
    return res.redirect(`/login?warning=${encodeURIComponent(warning)}`);
}

async function loadSessionRecord(sessionId) {
    const cached = sessionRecordCacheService.get(sessionId);
    if (cached?.revoked) return null;
    if (cached && typeof cached === 'object' && cached.id) return cached;

    const session = await dataService.getDataById('sessions', sessionId, SYSTEM_CONTEXT);
    if (!session) {
        sessionRecordCacheService.markRevoked(sessionId);
        return null;
    }
    sessionRecordCacheService.set(sessionId, session);
    return session;
}

async function resolveActiveSessionRecord(sessionId, session, now = new Date()) {
    if (!session) return null;

    const cachedReason = sessionRecordCacheService.resolveSessionExpiryReason(session, now);
    if (!cachedReason) return session;

    sessionRecordCacheService.invalidate(sessionId);
    const freshSession = await dataService.getDataById('sessions', sessionId, SYSTEM_CONTEXT);
    if (!freshSession) {
        sessionRecordCacheService.markRevoked(sessionId);
        return null;
    }

    const freshReason = sessionRecordCacheService.resolveSessionExpiryReason(freshSession, now);

    if (freshReason) {
        sessionRecordCacheService.set(sessionId, freshSession);
        return null;
    }

    sessionRecordCacheService.set(sessionId, freshSession);
    return freshSession;
}

async function enforceSession(req, res, next) {
    try {
        if (isPublicStaticAssetRequest(req)) return next();

        if (!req.cookies) {
            console.warn('⚠️ Cookie Parser not loaded. Skipping Session Enforcement.');
            return next();
        }

        const token = req.cookies.auth_token;
        if (!token) return next();

        const parts = token.split('.');
        if (parts.length !== 3) return next();
        const sessionId = parts[2];

        const session = await loadSessionRecord(sessionId);

        if (!session) {
            return rejectMissingSession(req, res, null);
        }

        const now = new Date();
        const activeSession = await resolveActiveSessionRecord(sessionId, session, now);
        if (!activeSession) {
            sessionRecordCacheService.invalidate(sessionId);
            const expiryReason = sessionRecordCacheService.resolveSessionExpiryReason(session, now) || 'timeout';
            return rejectTimedOutSession(req, res, session, expiryReason);
        }

        const lastActive = new Date(activeSession.lastActivityAt);
        const heartbeatDue = !Number.isNaN(lastActive.getTime())
            ? ((now - lastActive) > SESSION_HEARTBEAT_MS)
            : true;
        if (heartbeatDue) {
            const maxDurationMinutes = resolveSessionMaxDurationMinutes(activeSession);
            const updates = {
                lastActivityAt: now.toISOString(),
                absoluteExpiry: new Date(now.getTime() + (maxDurationMinutes * 60 * 1000)).toISOString()
            };
            if (!parseSafeInt(activeSession.maxDurationMinutes, null)) {
                updates.maxDurationMinutes = maxDurationMinutes;
            }
            await dataService.updateData('sessions', sessionId, updates, SYSTEM_CONTEXT);
            Object.assign(activeSession, updates);
            sessionRecordCacheService.set(sessionId, activeSession);
        }

        req.userSession = activeSession;

        next();

    } catch (error) {
        console.error('Session Enforcement Error:', error);
        next();
    }
}

async function trackCurrentPathAfterAuth(req, res, next) {
    try {
        if (!shouldTrackCurrentPathForRequest(req)) return next();
        await updateSessionCurrentPath(req);
        return next();
    } catch (error) {
        console.error('Session Current Path Tracking Error:', error);
        return next();
    }
}

module.exports = enforceSession;
module.exports.CURRENT_PATH_UPDATE_THROTTLE_MS = CURRENT_PATH_UPDATE_THROTTLE_MS;
module.exports.isPublicStaticAssetRequest = isPublicStaticAssetRequest;
module.exports.shouldUpdateCurrentPath = shouldUpdateCurrentPath;
module.exports.shouldTrackCurrentPathForRequest = shouldTrackCurrentPathForRequest;
module.exports.trackCurrentPathAfterAuth = trackCurrentPathAfterAuth;
module.exports.updateSessionCurrentPath = updateSessionCurrentPath;
module.exports.loadSessionRecord = loadSessionRecord;
module.exports.resolveActiveSessionRecord = resolveActiveSessionRecord;
