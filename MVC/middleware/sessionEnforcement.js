// MVC/middleware/sessionEnforcement.js
const dataService = require('../services/dataService');
const { SYSTEM_CONTEXT } = require('../../config/constants');
const { sanitizeCurrentPath } = require('../utils/pagePathUtils');
const sessionRecordCacheService = require('../services/cache/sessionRecordCacheService');

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

function rejectMissingSession(req, res) {
    res.clearCookie('auth_token');
    if (req.xhr || req.headers['x-ajax-request']) {
        return res.status(401).json({ status: 'error', message: 'Session expired or revoked.' });
    }
    return res.redirect('/login?warning=Your session has been terminated.');
}

function rejectTimedOutSession(req, res) {
    res.clearCookie('auth_token');
    if (req.xhr || req.headers['x-ajax-request']) {
        return res.status(401).json({ status: 'error', message: 'Session timed out.' });
    }
    return res.redirect('/login?warning=Session timed out due to inactivity.');
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
            return rejectMissingSession(req, res);
        }

        const now = new Date();
        if (sessionRecordCacheService.isSessionExpired(session, now)) {
            sessionRecordCacheService.markRevoked(sessionId);
            await dataService.deleteData('sessions', sessionId, SYSTEM_CONTEXT).catch(() => {});
            return rejectTimedOutSession(req, res);
        }

        const lastActive = new Date(session.lastActivityAt);
        const heartbeatDue = (now - lastActive) > 60 * 1000;
        if (heartbeatDue) {
            const updates = { lastActivityAt: now.toISOString() };
            await dataService.updateData('sessions', sessionId, updates, SYSTEM_CONTEXT);
            Object.assign(session, updates);
            sessionRecordCacheService.set(sessionId, session);
        }

        req.userSession = session;

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
