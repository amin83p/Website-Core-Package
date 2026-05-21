// MVC/middleware/sessionEnforcement.js
const dataService = require('../services/dataService');
const { SYSTEM_CONTEXT } = require('../../config/constants');

async function enforceSession(req, res, next) {
    try {
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

        // 6. Update Heartbeat (Throttled to 1 min)
        if ((now - lastActive) > 60 * 1000) {
            await dataService.updateData('sessions', sessionId, {
                lastActivityAt: now.toISOString()
            }, SYSTEM_CONTEXT);
        }

        // ✅ FIX: Use a unique name to avoid breaking express-session
        req.userSession = session; 
        
        next();

    } catch (error) {
        console.error('Session Enforcement Error:', error);
        next();
    }
}

module.exports = enforceSession;