// MVC/middleware/sessionEnforcement.js
const dataService = require('../services/dataService');
const { SYSTEM_CONTEXT } = require('../../config/constants');
const { isHtmlNavigationRequest, sanitizeCurrentPath } = require('../utils/pagePathUtils');

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

function hasCachedUiFlag(user, key) {
    return user?.[key] === true || user?.uiAccess?.[key] === true;
}

function shouldTrackCurrentPathForRequest(req) {
    if (!isHtmlNavigationRequest(req)) return false;
    const user = req?.user;
    if (!user) return false;
    const diagnosticsEnabled = hasCachedUiFlag(user, 'canUsePageDiagnostics') && user.pageDiagnosticsEnabled !== false;
    const activeUsersNeedsPresence = hasCachedUiFlag(user, 'canViewActiveUsers');
    return diagnosticsEnabled || activeUsersNeedsPresence;
}

async function enforceSession(req, res, next) {
    try {
        if (isPublicStaticAssetRequest(req)) return next();

        // 1. Safety Check: Ensure cookie-parser is running
        if (!req.cookies) {
            console.warn("⚠️ Cookie Parser not loaded. Skipping Session Enforcement.");
            return next();
        }

        const token = req.cookies.auth_token;
        if (!token) return next();

        // 2. Extract Session ID
        const parts = token.split('.');
        if (parts.length !== 3) return next();
        const sessionId = parts[2];

        // 3. Lookup
        const session = await dataService.getDataById('sessions', sessionId, SYSTEM_CONTEXT);

        // 4. Enforcement: Session Missing
        if (!session) {
            res.clearCookie('auth_token');
            if (req.xhr || req.headers['x-ajax-request']) {
                return res.status(401).json({ status: 'error', message: 'Session expired or revoked.' });
            }
            return res.redirect('/login?warning=Your session has been terminated.');
        }

        // 5. Enforcement: Idle Timeout
        const now = new Date();
        const lastActive = new Date(session.lastActivityAt);
        const idleLimitMs = (session.idleTimeoutMinutes || 30) * 60 * 1000;

        if ((now - lastActive) > idleLimitMs) {
            await dataService.deleteData('sessions', sessionId, SYSTEM_CONTEXT).catch(() => {});
            res.clearCookie('auth_token');
            if (req.xhr || req.headers['x-ajax-request']) {
                return res.status(401).json({ status: 'error', message: 'Session timed out.' });
            }
            return res.redirect('/login?warning=Session timed out due to inactivity.');
        }

        // 6. Keep the heartbeat fresh without writing current-page presence before auth context exists.
        const heartbeatDue = (now - lastActive) > 60 * 1000;
        if (heartbeatDue) {
            const updates = { lastActivityAt: now.toISOString() };
            await dataService.updateData('sessions', sessionId, updates, SYSTEM_CONTEXT);
            Object.assign(session, updates);
        }

        // ✅ FIX: Use a unique name to avoid breaking express-session
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
        const session = req.userSession || {};
        const sessionId = String(session.id || '').trim();
        if (!sessionId) return next();

        const now = new Date();
        const currentPath = sanitizeCurrentPath(req.originalUrl || req.url || req.path || '');
        if (!shouldUpdateCurrentPath(session, currentPath, now)) return next();

        const updates = {
            currentPath,
            currentPathUpdatedAt: now.toISOString()
        };
        await dataService.updateData('sessions', sessionId, updates, SYSTEM_CONTEXT);
        Object.assign(session, updates);
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
