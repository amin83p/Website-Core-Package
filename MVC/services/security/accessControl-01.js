// MVC/services/accessControlService.js
// Deprecated legacy copy. Runtime imports MVC/services/security/accessControl.js.
const { SYSTEM_CONTEXT } = require('../../../config/constants');
const dataService = require('../dataService'); 
const { resolveEntity } = require('../../utils/entityResolver'); 
const { idsEqual } = require('../../utils/idAdapter');

/* ============================================================
   MAIN EVALUATION FUNCTION
============================================================ */
async function evaluateAccess({ user, sectionId, operationId, ipAddress }) {
    
    // ---------------------------------------------------------
    // 1. SUPER ADMIN BYPASS
    // ---------------------------------------------------------
    if (!user || user === SYSTEM_CONTEXT) return allow("System Internal Request", true);
    if (user.isVirtualSuperAdmin) return allow("Virtual Super Admin Access", true);

    // ---------------------------------------------------------
    // 2. RESOLUTION & INTEGRITY CHECK
    //    (Resolve Names to IDs & Check Active Status)
    // ---------------------------------------------------------
    
    // A. Resolve Section (ID or Name)
    const sysSection = await resolveEntity('sections', sectionId);
    if (!sysSection) return deny(`Section '${sectionId}' does not exist.`);
    const targetSectionId = sysSection.id;

    if (sysSection.active === false) {
        const msg = sysSection.inactiveMessage && sysSection.inactiveMessage.trim() !== '' ? sysSection.inactiveMessage : `Section '${sysSection.name || sectionId}' is currently unavailable.`;
        return deny(msg);
    }

    // B. Resolve Operation (ID or Name)
    let sysOp = null;
    let sectionOpConfig = null;
    let targetOperationId = null;

    if (operationId) {
        sysOp = await resolveEntity('operations', operationId);
        if (!sysOp) return deny(`Operation '${operationId}' does not exist.`);
        
        targetOperationId = sysOp.id; 

        if (sysOp.active === false) return deny(`Operation '${sysOp.name || operationId}' is globally disabled.`);

        // C. Check Local Mapping (Inside Section)
        if (sysSection.operations && Array.isArray(sysSection.operations)) {
             sectionOpConfig = sysSection.operations.find(o => idsEqual(o.id, targetOperationId));
             if (!sectionOpConfig) return deny(`Operation '${sysOp.name}' is not supported in Section '${sysSection.name}'.`);
             if (sectionOpConfig.active === false) return deny(`Operation '${sysOp.name}' is currently disabled in Section '${sysSection.name}'.`);
        }
        
        if (sectionOpConfig) sysOp = { ...sysOp, ...sectionOpConfig };
    }

    // ---------------------------------------------------------
    // ✅ 3. ORGANIZATION POLICY CHECK (NEW LAYER)
    // ---------------------------------------------------------
    const orgPolicy = user.activeOrgPolicy; // Injected by login/middleware
    let orgSectionConfig = null;
    let orgOpConfig = null;

    if (orgPolicy) {
        // A. Global Active Check
        if (orgPolicy.active === false) return deny("Organization Access Policy is inactive.");

        // B. Banned Users List
        if (orgPolicy.bannedUsers && orgPolicy.bannedUsers.some(b => idsEqual(b.userId, user.id))) {
            const banInfo = orgPolicy.bannedUsers.find(b => idsEqual(b.userId, user.id));
            return deny(`Access Denied by Organization: ${banInfo.reason || 'User Banned'}`);
        }

        // C. Network Security
        if (ipAddress && orgPolicy.network) {
            if (!checkNetwork(orgPolicy.network, ipAddress)) return deny(`Access Denied: IP ${ipAddress} is blocked by Organization Policy.`);
        }

        // D. Global Schedule
        if (orgPolicy.globalSchedule && !checkSchedule(orgPolicy.globalSchedule)) {
            return deny("Access Denied: Outside of Organization Working Hours.");
        }

        // E. Section Specific Bans
        if (orgPolicy.sections) {
            orgSectionConfig = orgPolicy.sections.find(s => idsEqual(s.sectionId, targetSectionId));
            if (orgSectionConfig) {
                if (orgSectionConfig.accessType === 'full_ban') 
                    return deny(`Section is Banned by Organization Policy.<br>${orgSectionConfig.accessState.reason}`);
                
                // F. Operation Specific Bans (within Org Section)
                if (orgSectionConfig.operations && targetOperationId) {
                    orgOpConfig = orgSectionConfig.operations.find(o => idsEqual(o.operationId, targetOperationId));
                    if (orgOpConfig && orgOpConfig.accessType === 'full_ban') {
                        return deny("Operation is Banned by Organization Policy.");
                    }
                }
            }
        }
    }

    // ---------------------------------------------------------
    // 4. USER CONTEXT PREPARATION
    // ---------------------------------------------------------
    const profile = user.activeProfile;
    const policy = user.activePolicy;
    const isGlobalAdmin = (profile && profile.fullAdmin);

    let profileOpConfig = null;
    let policyOpConfig = null;
    let profileSectionConfig = null;
    let policySectionConfig = null;

    // A. Profile Lookup
    if (!isGlobalAdmin && profile && profile.sections) {
        profileSectionConfig = profile.sections.find(s => idsEqual(s.sectionId, targetSectionId));
        if (profileSectionConfig) {
            if (profileSectionConfig.adminAccess) {
                profileOpConfig = { accessType: 'full_access' }; 
            } else if (profileSectionConfig.operations && targetOperationId) {
                profileOpConfig = profileSectionConfig.operations.find(o => idsEqual(o.operationId, targetOperationId));
            }
        }
    }

    // B. Policy Lookup
    if (policy && policy.sections) {
        policySectionConfig = policy.sections.find(s => idsEqual(s.sectionId, targetSectionId));
        if (policySectionConfig && policySectionConfig.operations && targetOperationId) {
            policyOpConfig = policySectionConfig.operations.find(o => idsEqual(o.operationId, targetOperationId));
        }
    }

    // ---------------------------------------------------------
    // 5. GRANT CHECK
    // ---------------------------------------------------------
    let isGranted = false;
    let grantSource = '';

    if (policySectionConfig && policySectionConfig.accessType === 'full_access') {
        isGranted = true; grantSource = 'Policy Section Override (Full Access)';
    } else if (policyOpConfig && policyOpConfig.accessType !== 'full_ban') {
        isGranted = true; grantSource = isGlobalAdmin ? 'Global Admin (Restricted by Policy)' : 'Policy Operation Override';
    } else if (isGlobalAdmin) {
        isGranted = true; grantSource = 'Global Admin Profile';
    } else if (profileOpConfig) {
        isGranted = true; grantSource = 'Profile';
    }

    if (!isGranted) return deny("Access not granted by Role or Policy.");

    // ---------------------------------------------------------
    // 6. USER RESTRICTION CHECK
    // ---------------------------------------------------------
    if (policy) {
        if (policy.active === false) return deny("User Access Policy is inactive.");
        if (ipAddress && policy.network && !checkNetwork(policy.network, ipAddress)) return deny(`IP Address ${ipAddress} is blocked by User Policy.`);
        if (policy.globalSchedule && !checkSchedule(policy.globalSchedule)) return deny("Access denied by User Personal Schedule.");
    }

    if (policySectionConfig) {
        if (policySectionConfig.accessState?.status === 'suspended') return deny("Section access is suspended by User Policy.");
        if (policySectionConfig.accessType === 'full_ban') return deny("Section is Banned by User Policy.");
    }

    if (policyOpConfig && policyOpConfig.accessType === 'full_ban') {
        return deny("Operation is Banned by User Policy.");
    }

    // ---------------------------------------------------------
    // 7. LIMIT CALCULATION (Updated to include Org Limits)
    // ---------------------------------------------------------
    const limits = resolveLimits(
        isGlobalAdmin ? { accessType: 'full_access' } : profileOpConfig, 
        policyOpConfig, 
        policySectionConfig, 
        profileSectionConfig,
        sysOp,
        // ✅ Pass Org Configs
        orgOpConfig,
        orgSectionConfig
    );

    return {
        allowed: true,
        reason: `Authorized via ${grantSource}`,
        limits: limits,
        scopeId: profileOpConfig?.scopeId || policyOpConfig?.scopeId || 'Global'
    };
}

/* ============================================================
   INTERNAL HELPERS
============================================================ */

function allow(reason, unlimited = false) {
    return { allowed: true, reason, limits: unlimited ? { maxAttempts: null, maxTimeMinutes: null, maxVolumeKB: null } : {} };
}

function deny(reason) {
    return { allowed: false, reason, limits: {} };
}

function checkNetwork(networkConfig, userIp) {
    if(!networkConfig) return true;
    const { ipBlacklist, ipWhitelist } = networkConfig;
    if (ipBlacklist && ipBlacklist.length > 0 && ipBlacklist.includes(userIp)) return false;
    if (ipWhitelist && ipWhitelist.length > 0 && !ipWhitelist.includes(userIp)) return false;
    return true; 
}

function checkSchedule(scheduleConfig) {
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDay = days[now.getDay()];
    const todaySlots = scheduleConfig.weekdays?.[currentDay];

    if (!todaySlots || todaySlots.length === 0) {
        // If NO schedule is defined at all, allow access. If defined but empty for today, deny.
        const hasAnySchedule = Object.keys(scheduleConfig.weekdays || {}).length > 0;
        return !hasAnySchedule; 
    }

    const currentMinutes = (now.getHours() * 60) + now.getMinutes();
    return todaySlots.some(slot => {
        const start = timeToMinutes(slot.start);
        const end = timeToMinutes(slot.end);
        return currentMinutes >= start && currentMinutes <= end;
    });
}

function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h * 60) + m;
}

function resolveLimits(profOp, polOp, polSec, profSec, sysOp, orgOp, orgSec) {
    
    const getLimit = (obj, category, field) => {
        if (!obj) return undefined;
        // Full Access (User Level) shouldn't bypass Org Limits, but handles within its own layer.
        // Org Limits are strictly restrictive, so they will be checked first below.
        if ((obj.accessType === 'full_access' || obj.adminAccess) && !obj.isOrgLayer) return null;
        
        if (obj[category] && obj[category][field] !== undefined && obj[category][field] !== null) {
            return obj[category][field];
        }
        return undefined;
    };

    const getVal = (key) => {
        let category = '';
        let field = key;

        if (key === 'maxAttemptsPerSession') { category = 'executionLimits'; }
        else if (key === 'maxSessionDurationMinutes') { category = 'timeLimits'; }
        else if (key === 'maxFetchUploadVolumeKB') { category = 'throughputLimits'; field = 'maxFetchVolumeKB'; }

        // ✅ PRIORITY 1: Organization Limits (Strictest wins)
        // If Org defines a limit, it caps whatever the user has.
        // We look for a DEFINED limit. If Org has no limit (undefined), we proceed.
        if (orgOp) {
            const val = getLimit({...orgOp, isOrgLayer:true}, category, field);
            if (val !== undefined) return val; 
        }
        if (orgSec) {
            const val = getLimit({...orgSec, isOrgLayer:true}, category === 'executionLimits' ? 'timeLimits' : category, field);
            if (val !== undefined) return val;
        }

        // PRIORITY 2: User Policy Operation
        if (polOp) {
            const val = getLimit(polOp, category, field);
            if (val !== undefined) return val;
        }
        
        // PRIORITY 3: User Policy Section
        if (polSec) {
            const val = getLimit(polSec, category === 'executionLimits' ? 'timeLimits' : category, field);
            if (val !== undefined) return val;
        }

        // PRIORITY 4: Profile Operation
        if (profOp) {
            const val = getLimit(profOp, category, field);
            if (val !== undefined) return val;
        }

        // PRIORITY 5: Profile Section
        if (profSec) {
            const val = getLimit(profSec, category === 'executionLimits' ? 'timeLimits' : category, field);
            if (val !== undefined) return val;
        }

        // PRIORITY 6: System Defaults
        if (sysOp) {
            if (key === 'maxAttemptsPerSession' && sysOp.sessionAttempts !== undefined) return sysOp.sessionAttempts === 0 ? null : sysOp.sessionAttempts;
            if (key === 'maxSessionDurationMinutes' && sysOp.sessionTime !== undefined) return sysOp.sessionTime === 0 ? null : sysOp.sessionTime;
        }

        return null;
    };

    return {
        maxAttempts: getVal('maxAttemptsPerSession'),
        maxTimeMinutes: getVal('maxSessionDurationMinutes'),
        maxVolumeKB: getVal('maxFetchUploadVolumeKB')
    };
}

module.exports = { evaluateAccess };
