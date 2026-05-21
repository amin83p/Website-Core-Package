// MVC/services/SessionService.js
const dataService = require('./dataService');
const effectiveAccessResolverService = require('./security/effectiveAccessResolverService');
const { SYSTEM_CONTEXT } = require('../../config/constants');
const { idsEqual, toPublicId } = require('../utils/idAdapter');

/**
 * =============================================================================
 * 1. POLICY & LIMIT RESOLUTION
 * =============================================================================
 */

function parseSafeInt(value, fallback) {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
}

function parseNonNegativeInt(value, fallback) {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < 0) return fallback;
    return parsed;
}

async function loadOrgPolicyForOrg(orgId) {
    const targetOrgId = toPublicId(orgId || '');
    if (!targetOrgId || targetOrgId === 'SYSTEM') return null;
    const orgPolicies = await dataService.fetchData('orgPolicies', { q: targetOrgId, type: 'exact_match', searchFields: 'orgId' }, SYSTEM_CONTEXT);
    return (Array.isArray(orgPolicies) ? orgPolicies : []).find((p) => idsEqual(p.orgId, targetOrgId)) || null;
}

async function loadUserPolicyForOrg(userId, orgId) {
    const userPolicies = await dataService.fetchData('accessPolicies', { q: userId, type: 'exact_match', searchFields: 'userId' }, SYSTEM_CONTEXT);
    const rows = Array.isArray(userPolicies) ? userPolicies : [];
    if (!rows.length) return null;
    const targetOrgId = toPublicId(orgId || '');
    if (targetOrgId) {
        const exact = rows.find((p) => idsEqual(p.orgId, targetOrgId));
        if (exact) return exact;
    }
    return rows.find((p) => !p.orgId || String(p.orgId).trim().toLowerCase() === 'global') || null;
}

async function resolvePolicyLimits(user, targetOrgId) {
    const webPolicy = await dataService.getWebsitePolicy();
    const effectiveOrgId = toPublicId(targetOrgId || user?.activeOrgId || user?.primaryOrgId || '');
    const orgPolicy = await loadOrgPolicyForOrg(effectiveOrgId);
    const userPolicy = await loadUserPolicyForOrg(user?.id, effectiveOrgId);

    const resolverUser = {
        ...(user || {}),
        activeOrgId: effectiveOrgId || user?.activeOrgId || user?.primaryOrgId || null,
        activeOrgPolicy: orgPolicy || null,
        activePolicy: userPolicy || null
    };

    const globalPolicyContext = await effectiveAccessResolverService.resolveGlobalPolicyContext({
        user: resolverUser,
        orgId: effectiveOrgId,
        ipAddress: '',
        websitePolicy: webPolicy,
        now: new Date()
    });

    const sessionLimits = globalPolicyContext?.sessionLimits || {};
    return {
        maxSessions: parseNonNegativeInt(sessionLimits.maxSessions, parseSafeInt(webPolicy?.sessionControl?.maxSessions, 10)),
        maxDurationMins: parseNonNegativeInt(sessionLimits.maxDurationMins, parseSafeInt(webPolicy?.sessionControl?.maxDuration, 720)),
        idleTimeoutMins: parseNonNegativeInt(sessionLimits.idleTimeoutMins, parseSafeInt(webPolicy?.sessionControl?.idleTimeout, 60))
    };
}

/**
 * =============================================================================
 * 2. SESSION LIFECYCLE MANAGEMENT
 * =============================================================================
 */

async function cleanupExpiredSessions(userId) {
    const allSessions = await dataService.fetchData('sessions', { q: userId, type: 'exact_match', searchFields: 'userId' }, SYSTEM_CONTEXT);
    if (!allSessions || allSessions.length === 0) return;

    const now = new Date();
    const deletePromises = [];

    for (const session of allSessions) {
        const lastActive = new Date(session.lastActivityAt);
        const absoluteExpiry = new Date(session.absoluteExpiry);

        const idleMins = parseSafeInt(session.idleTimeoutMinutes, 30);
        const idleLimitMs = idleMins * 60 * 1000;

        let isExpired = false;
        if (now > absoluteExpiry) isExpired = true;
        if (!isExpired && (now - lastActive) > idleLimitMs) isExpired = true;

        if (isExpired) {
            deletePromises.push(dataService.deleteData('sessions', session.id, SYSTEM_CONTEXT));
        }
    }

    if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
    }
}

/**
 * Creates a new session using the token signature as the ID.
 */
async function createSession(user, orgId, deviceInfo, tokenSignature) {
    const limits = await resolvePolicyLimits(user, orgId);

    const now = new Date();
    const expiryTime = new Date(now.getTime() + (limits.maxDurationMins * 60 * 1000));

    const newSession = {
        id: tokenSignature,
        tokenHash: tokenSignature,
        userId: user.id,
        deviceFingerprint: deviceInfo || { ip: 'unknown', browser: 'unknown' },
        status: 'active',
        createdAt: now.toISOString(),
        lastActivityAt: now.toISOString(),
        absoluteExpiry: expiryTime.toISOString(),
        idleTimeoutMinutes: Number(limits.idleTimeoutMins),
        currentOrgId: orgId,
        orgHistory: [{
            orgId,
            enteredAt: now.toISOString(),
            action: 'login'
        }]
    };

    return await dataService.addData('sessions', newSession, SYSTEM_CONTEXT);
}

async function touchSession(sessionId) {
    await dataService.updateData('sessions', sessionId, {
        lastActivityAt: new Date().toISOString()
    }, SYSTEM_CONTEXT);
}

/**
 * =============================================================================
 * 3. VALIDATION GATES
 * =============================================================================
 */

async function checkLoginEligibility(user, targetOrgId) {
    await cleanupExpiredSessions(user.id);
    const limits = await resolvePolicyLimits(user, targetOrgId);
    const activeSessions = await dataService.fetchData('sessions', { q: user.id, type: 'exact_match', searchFields: 'userId' }, SYSTEM_CONTEXT);

    if (limits.maxSessions === 0 || activeSessions.length >= limits.maxSessions) {
        return {
            allowed: false,
            reason: 'COUNT_LIMIT',
            maxSessions: limits.maxSessions,
            currentCount: activeSessions.length,
            activeSessions
        };
    }
    return { allowed: true };
}

async function validateOrgSwitch(user, currentSessionId, targetOrgId) {
    await cleanupExpiredSessions(user.id);
    const limits = await resolvePolicyLimits(user, targetOrgId);

    if (limits.maxSessions === 0) {
        return {
            allowed: false,
            reason: 'COUNT_LIMIT',
            message: 'Session creation is blocked by policy limits for this organization.'
        };
    }

    const currentSession = await dataService.getDataById('sessions', currentSessionId, SYSTEM_CONTEXT);

    if (!currentSession) return { allowed: false, reason: 'INVALID_SESSION', message: 'Session not found or expired.' };

    const created = new Date(currentSession.createdAt);
    const ageMins = (new Date() - created) / 1000 / 60;

    if (ageMins > limits.maxDurationMins) {
        return {
            allowed: false,
            reason: 'TIME_LIMIT',
            message: `<b>You have reached session time limit</b></br>Session is too old <b>(${Math.floor(ageMins)} mins)</b>.<br>Allowed Organization limit is <b>${limits.maxDurationMins}</b> minutes.`
        };
    }

    const userSessions = await dataService.fetchData('sessions', { q: user.id, type: 'exact_match', searchFields: 'userId' }, SYSTEM_CONTEXT);
    if (userSessions.length > limits.maxSessions) {
        return {
            allowed: false,
            reason: 'COUNT_LIMIT',
            message: `<b>You have reached organization limit</b><br>You are allowed to use <b>${limits.maxSessions}</b> sessions.<br>You currently have ${userSessions.length}.`,
            sessionsToDelete: userSessions.length - limits.maxSessions
        };
    }

    const history = currentSession.orgHistory || [];
    history.push({ orgId: targetOrgId, enteredAt: new Date().toISOString(), action: 'switch' });

    await dataService.updateData('sessions', currentSessionId, {
        currentOrgId: targetOrgId,
        idleTimeoutMinutes: Number(limits.idleTimeoutMins),
        orgHistory: history
    }, SYSTEM_CONTEXT);

    return { allowed: true };
}

async function terminateSession(sessionId) {
    return await dataService.deleteData('sessions', sessionId, SYSTEM_CONTEXT);
}

module.exports = {
    resolvePolicyLimits,
    cleanupExpiredSessions,
    createSession,
    touchSession,
    checkLoginEligibility,
    validateOrgSwitch,
    terminateSession
};
