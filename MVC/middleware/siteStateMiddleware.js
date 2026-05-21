// MVC/middleware/siteStateMiddleware.js
const dataService = require('../services/dataService'); 
const adminChekersService = require('../services/adminChekersService');
const { SYSTEM_CONTEXT } = require('../../config/constants');

function getMinutes(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h * 60) + m;
}

async function enforceSitePolicy(req, res, next) {
    try {
        // 1. Fetch & Attach Policy
        const policy = await dataService.getWebsitePolicy(req.user || SYSTEM_CONTEXT); 
        req.websitePolicy = policy; 
        res.locals.websitePolicy = policy;

        const warnings = [];
        const isSuperAdmin = req.user && adminChekersService.isSuperAdmin(req.user);
        
        // Auth paths that must remain accessible
        const authPaths = ['/login', '/force-login', '/captcha', '/verify-admin', '/logout', '/auth/microsoft'];
        const isAuthRoute = authPaths.some(p => req.path === p || req.path.startsWith(p));

        // Helper to Handle Blocks - Added `forceLogout` parameter
        const handleBlock = (statusCode, title, message, forceLogout = false) => {
            if (isSuperAdmin) {
                warnings.push(message); 
                return false; // Did not block
            }

            if (req.headers['x-ajax-request'] || req.xhr || req.path.startsWith('/api')) {
                res.status(statusCode).json({ status: 'error', message });
            } else {
                // ONLY clear the token if forceLogout is true (e.g., Bans/Blacklists)
                if (forceLogout && req.cookies && req.cookies.token) {
                    res.clearCookie('token'); 
                }
                res.status(statusCode).render('error', { title, message, user: req.user || null });
            }
            return true; // Blocked
        };

        // =================================================================
        // 2. NETWORK SECURITY
        // =================================================================
        const clientIp = req.ip || req.connection.remoteAddress;
        const network = policy.network || { ipWhitelist: [], ipBlacklist: [] };

        if (network.ipBlacklist && network.ipBlacklist.includes(clientIp)) {
            const blocked = handleBlock(403, '403 Forbidden', 'Your IP address is on the Global Blacklist.', true); // Force Logout
            if (blocked) return;
        }

        if (network.ipWhitelist && network.ipWhitelist.length > 0) {
            if (!network.ipWhitelist.includes(clientIp)) {
                const blocked = handleBlock(403, '403 Forbidden', 'Access restricted to Whitelisted IPs only.', true); // Force Logout
                if (blocked) return;
            }
        }

        // =================================================================
        // 3. SYSTEM FEATURES
        // =================================================================
        const features = policy.features || {};

        if (features.publicAccess === false && !req.user && !isAuthRoute) {
            const blocked = handleBlock(403, 'Private Access Only', 'Public access is currently disabled. Please log in.', false);
            if (blocked) return;
        }

        if (features.registration === false && (
            req.path.startsWith('/register') || 
            req.path.startsWith('/signup') ||
            req.path.startsWith('/users/new')||
            req.path.startsWith('/persons/join'))) {
            const blocked = handleBlock(403, 'Registration Disabled', 'New user registration is currently closed.', false);
            if (blocked) return;
        }

        if (features.apiAccess === false && req.path.startsWith('/api')) {
            const blocked = handleBlock(403, 'API Disabled', 'API access is currently disabled.', false);
            if (blocked) return;
        }

        // =================================================================
        // 4. USER BANS
        // =================================================================
        if (req.user && policy.bannedUsers && policy.bannedUsers.length > 0) {
            const banRecord = policy.bannedUsers.find(u => String(u.userId) === String(req.user.id));
            if (banRecord) {
                const msg = `Account suspended: ${banRecord.reason || 'Policy Violation'}`;
                if (!isSuperAdmin) {
                    res.setHeader('X-Access-Restricted', 'policy');
                    if (req.headers['x-ajax-request'] || req.xhr || req.path.startsWith('/api')) {
                        res.status(403).json({
                            status: 'access_restricted',
                            message: 'Your account is restricted by website policy.',
                            reason: msg,
                            deniedCode: 'WEBSITE_POLICY_BANNED_USER',
                            deniedMeta: { layer: 'website', target: 'user' },
                            redirectUrl: '/dashboard'
                        });
                        return;
                    }
                    if (req.cookies && req.cookies.token) {
                        res.clearCookie('token');
                    }
                    res.status(403).render('access/policyBanned', {
                        title: 'Account Suspended',
                        statusCode: 403,
                        message: 'Your account is currently restricted by website policy.',
                        user: req.user || null,
                        accessRequest: {
                            reason: msg,
                            path: req.originalUrl || req.url || '',
                            deniedCode: 'WEBSITE_POLICY_BANNED_USER',
                            deniedMeta: { layer: 'website', target: 'user' }
                        }
                    });
                    return;
                }
            }
        }

        // =================================================================
        // 5. MAINTENANCE MODE
        // =================================================================
        if (policy.maintenance && policy.maintenance.enabled) {
            let hasRoleBypass = false;
            
            if (req.user && policy.maintenance.allowedRoles.includes(req.user.activeProfile?.id)) hasRoleBypass = true;
            if (policy.maintenance.allowedIps.includes(clientIp)) hasRoleBypass = true;
            
            // Allow auth routes AND the websitePolicy routes so admins can turn it off
            if (isAuthRoute || req.path.startsWith('/websitePolicy') || req.path === '/amin-dash') {
                hasRoleBypass = true; 
            }

            if (!hasRoleBypass) {
                // Pass false for forceLogout so they keep their session cookie
                const blocked = handleBlock(503, 'System Maintenance', policy.maintenance.message, false);
                if (blocked) return;
            } else if (isSuperAdmin) {
                 warnings.push(`System is in Maintenance Mode: "${policy.maintenance.message}"`);
            }
        }

        // =================================================================
        // 6. OPERATING SCHEDULE
        // =================================================================
        const schedule = policy.globalSchedule || {};
        if (schedule.weekdays && Object.keys(schedule.weekdays).length > 0) {
            const now = new Date();
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const currentDay = days[now.getDay()];
            const currentTime = (now.getHours() * 60) + now.getMinutes();
            const dayRules = schedule.weekdays[currentDay];

            if (dayRules && dayRules.length > 0) {
                const isOpen = dayRules.some(slot => currentTime >= getMinutes(slot.start) && currentTime < getMinutes(slot.end));
                
                if (!isOpen) {
                    if (!isAuthRoute && !req.path.startsWith('/websitePolicy')) { 
                        // Pass false so closed hours don't delete user sessions
                        const blocked = handleBlock(503, 'Operating Hours', `System is currently closed (Outside Operating Hours for ${currentDay}).`, false);
                        if (blocked) return;
                    } else if (isSuperAdmin) {
                        warnings.push(`System Closed (Operating Hours for ${currentDay})`);
                    }
                }
            }
        }

        // =================================================================
        // 7. ATTACH WARNINGS TO USER OBJECT
        // =================================================================
        if (req.user) {
            req.user.siteWarnings = [...new Set(warnings)];
            res.locals.siteWarnings = req.user.siteWarnings;
        }

        next();

    } catch (err) {
        console.error("Site Policy Enforcement Error:", err);
        next();
    }
}

module.exports = enforceSitePolicy;
