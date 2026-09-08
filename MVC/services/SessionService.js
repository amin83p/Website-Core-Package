// MVC/services/SessionService.js
const dataService = require('./dataService');
const effectiveAccessResolverService = require('./security/effectiveAccessResolverService');
const { SYSTEM_CONTEXT } = require('../../config/constants');
const { idsEqual, toPublicId } = require('../utils/idAdapter');
const { invalidateAuthContextForSession } = require('./cache/authContextCacheService');
const sessionRecordCacheService = require('./cache/sessionRecordCacheService');

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
        const idleLimitMs = idleMins > 0 ? idleMins * 60 * 1000 : null;

        let isExpired = false;
        if (now > absoluteExpiry) isExpired = true;
        if (!isExpired && idleLimitMs && (now - lastActive) > idleLimitMs) isExpired = true;

        if (isExpired) {
            sessionRecordCacheService.markRevoked(session.id);
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
        maxDurationMinutes: Number(limits.maxDurationMins),
        currentOrgId: orgId,
        orgHistory: [{
            orgId,
            enteredAt: now.toISOString(),
            action: 'login'
        }]
    };

    const created = await dataService.addData('sessions', newSession, SYSTEM_CONTEXT);
    sessionRecordCacheService.set(tokenSignature, newSession);
    return created;
}

async function touchSession(sessionId, meta = {}) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) return;
    const now = new Date();
    const nowIso = now.toISOString();
    let session = sessionRecordCacheService.get(normalizedSessionId);
    if (session?.revoked) session = null;
    if (!session || !session.id) {
        try {
            session = await dataService.getDataById('sessions', normalizedSessionId, SYSTEM_CONTEXT);
        } catch (_) {
            session = null;
        }
    }
    const updates = { lastActivityAt: nowIso };
    if (session && typeof session === 'object') {
        const storedMax = parseSafeInt(session.maxDurationMinutes, null);
        let maxDurationMinutes = storedMax;
        if (!maxDurationMinutes) {
            const absoluteExpiry = session.absoluteExpiry ? new Date(session.absoluteExpiry) : null;
            const createdAt = session.createdAt ? new Date(session.createdAt) : null;
            if (
                absoluteExpiry && createdAt
                && !Number.isNaN(absoluteExpiry.getTime())
                && !Number.isNaN(createdAt.getTime())
            ) {
                maxDurationMinutes = Math.max(1, Math.round((absoluteExpiry.getTime() - createdAt.getTime()) / 60000));
            }
        }
        if (maxDurationMinutes > 0) {
            updates.absoluteExpiry = new Date(now.getTime() + (maxDurationMinutes * 60 * 1000)).toISOString();
            if (!storedMax) updates.maxDurationMinutes = maxDurationMinutes;
        }
    }
    await dataService.updateData('sessions', normalizedSessionId, updates, SYSTEM_CONTEXT);
    const cached = sessionRecordCacheService.get(normalizedSessionId);
    if (cached && !cached.revoked) {
        sessionRecordCacheService.set(normalizedSessionId, { ...cached, ...updates });
    } else if (session && typeof session === 'object') {
        sessionRecordCacheService.set(normalizedSessionId, { ...session, ...updates });
    }
    if (meta.source) {
        const sessionAuthDiagnosticLogService = require('./diagnostics/sessionAuthDiagnosticLogService');
        sessionAuthDiagnosticLogService.logSessionAuthEvent({
            event: 'SESSION_TOUCHED',
            reason: String(meta.reason || meta.source || 'touch_session').trim(),
            session: session || { id: normalizedSessionId },
            details: { source: String(meta.source || '').trim() }
        });
    }
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
        maxDurationMinutes: Number(limits.maxDurationMins),
        orgHistory: history
    }, SYSTEM_CONTEXT);

    const updatedSession = {
        ...currentSession,
        currentOrgId: targetOrgId,
        idleTimeoutMinutes: Number(limits.idleTimeoutMins),
        maxDurationMinutes: Number(limits.maxDurationMins),
        orgHistory: history
    };
    sessionRecordCacheService.set(currentSessionId, updatedSession);

    return { allowed: true };
}

async function terminateSession(sessionId) {
    const normalizedSessionId = String(sessionId || '').trim();
    let session = null;
    if (normalizedSessionId) {
      try {
        session = await dataService.getDataById('sessions', normalizedSessionId, SYSTEM_CONTEXT);
      } catch (_) {
        session = null;
      }
    }
    const result = await dataService.deleteData('sessions', normalizedSessionId, SYSTEM_CONTEXT);
    sessionRecordCacheService.markRevoked(normalizedSessionId);
    if (session?.userId) {
      invalidateAuthContextForSession(session.userId, normalizedSessionId);
    }
    return result;
}

async function terminateAllSessionsForUser(userId) {
    const normalizedUserId = toPublicId(userId);
    if (!normalizedUserId) return { terminated: 0 };
    const sessions = await dataService.fetchData('sessions', {
        q: normalizedUserId,
        type: 'exact_match',
        searchFields: 'userId'
    }, SYSTEM_CONTEXT);
    const rows = Array.isArray(sessions) ? sessions : [];
    let terminated = 0;
    for (const session of rows) {
        const sessionId = String(session?.id || '').trim();
        if (!sessionId) continue;
        await terminateSession(sessionId);
        terminated += 1;
    }
    return { terminated };
}

async function invalidateSessionRecordCacheForUser(userId) {
    const normalizedUserId = toPublicId(userId);
    if (!normalizedUserId) return { sessionCount: 0 };

    const sessions = await dataService.fetchData('sessions', {
        q: normalizedUserId,
        type: 'exact_match',
        searchFields: 'userId'
    }, SYSTEM_CONTEXT);
    const rows = Array.isArray(sessions) ? sessions : [];
    rows.forEach((session) => {
        const sessionId = String(session?.id || '').trim();
        if (sessionId) sessionRecordCacheService.invalidate(sessionId);
    });
    return { sessionCount: rows.length };
}

async function refreshSessionPolicyLimitsForUser(userId) {
    const normalizedUserId = toPublicId(userId);
    if (!normalizedUserId) return { sessionCount: 0, refreshed: 0 };

    const user = await dataService.getDataById('users', normalizedUserId, SYSTEM_CONTEXT);
    if (!user) return { sessionCount: 0, refreshed: 0 };

    const sessions = await dataService.fetchData('sessions', {
        q: normalizedUserId,
        type: 'exact_match',
        searchFields: 'userId'
    }, SYSTEM_CONTEXT);
    const rows = Array.isArray(sessions) ? sessions : [];
    let refreshed = 0;
    const now = new Date();

    for (const session of rows) {
        const sessionId = String(session?.id || '').trim();
        if (!sessionId) continue;

        const orgId = session.currentOrgId || user.activeOrgId || user.primaryOrgId;
        const limits = await resolvePolicyLimits(
            { ...user, activeOrgId: orgId },
            orgId
        );
        const absoluteExpiry = resolveRefreshedAbsoluteExpiry(session, limits, now);
        const nextIdleTimeoutMinutes = Number(limits.idleTimeoutMins);
        const nextLastActivityAt = now.toISOString();

        sessionRecordCacheService.invalidate(sessionId);

        await dataService.updateData('sessions', sessionId, {
            idleTimeoutMinutes: nextIdleTimeoutMinutes,
            absoluteExpiry,
            lastActivityAt: nextLastActivityAt
        }, SYSTEM_CONTEXT);
        sessionRecordCacheService.set(sessionId, {
            ...session,
            idleTimeoutMinutes: nextIdleTimeoutMinutes,
            absoluteExpiry,
            lastActivityAt: nextLastActivityAt
        });
        refreshed += 1;
    }

    return { sessionCount: rows.length, refreshed };
}

function resolveRefreshedAbsoluteExpiry(session = {}, limits = {}, now = new Date()) {
    const policyExpiry = new Date(now.getTime() + (Number(limits.maxDurationMins || 0) * 60 * 1000));
    const existingExpiry = session.absoluteExpiry ? new Date(session.absoluteExpiry) : null;
    if (existingExpiry && !Number.isNaN(existingExpiry.getTime()) && existingExpiry > policyExpiry) {
        return existingExpiry.toISOString();
    }
    return policyExpiry.toISOString();
}

async function refreshSessionPolicyLimitsForUsers(userIds = []) {
    const ids = [...new Set(
        (Array.isArray(userIds) ? userIds : [userIds])
            .map((id) => toPublicId(id))
            .filter(Boolean)
    )];
    let sessionCount = 0;
    let refreshed = 0;
    for (const userId of ids) {
        const result = await refreshSessionPolicyLimitsForUser(userId);
        sessionCount += result.sessionCount || 0;
        refreshed += result.refreshed || 0;
    }
    return { userCount: ids.length, sessionCount, refreshed };
}

module.exports = {
    resolvePolicyLimits,
    cleanupExpiredSessions,
    createSession,
    touchSession,
    checkLoginEligibility,
    validateOrgSwitch,
    terminateSession,
    terminateAllSessionsForUser,
    invalidateSessionRecordCacheForUser,
    refreshSessionPolicyLimitsForUser,
    refreshSessionPolicyLimitsForUsers,
    resolveRefreshedAbsoluteExpiry
};
