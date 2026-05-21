// MVC/services/AccessDelegationService.js
const dataService = require('../dataService');
const adminChekersService = require('../../services/adminChekersService');
const { idsEqual } = require('../../utils/idAdapter');

/**
 * AccessDelegationService
 * Security Policy Enforcement: "Subset & Scope Authority"
 */

async function validateDelegation(modifierUser, targetProfileId, targetOrgId) {
    try {
        // 1. SYSTEM ADMIN BYPASS
        if (adminChekersService.isSuperAdmin(modifierUser)) {
            return { allowed: true };
        }

        // 2. FETCH DATA & CONTEXT
        const targetProfile = await dataService.getDataById('accesses', targetProfileId, modifierUser);
        if (!targetProfile) {
            return { allowed: false, reason: `Target Access Profile (${targetProfileId}) does not exist.` };
        }

        const allScopes = await dataService.getAccessibleScopes(modifierUser);
        const scopeLevelMap = new Map(allScopes.map(s => [s.id, Number(s.level) || 0]));

        // 3. RESOLVE MODIFIER'S PROFILE
        const modOrgConfig = (modifierUser.allowedOrgs || []).find(o => idsEqual(o.orgId, targetOrgId));
        
        if (!modOrgConfig) {
             return { allowed: false, reason: `You are not a member of Organization <b>#${targetOrgId}</b>,<br> so you cannot grant access to it.` };
        }

        if (!modOrgConfig.accessProfileIds || modOrgConfig.accessProfileIds.length === 0) {
            return { allowed: false, reason: `You have no Access Profile assigned in Organization <b>#${targetOrgId}</b>.` };
        }

        let hasAuthority = false;
        let failReason = "Insufficient privileges.";

        for (const modPid of modOrgConfig.accessProfileIds) {
            const modifierProfile = await dataService.getDataById('accesses', modPid, modifierUser);
            if (!modifierProfile) continue;

            if (modifierProfile.fullAdmin) {
                return { allowed: true };
            }

            const check = checkProfileSubset(modifierProfile, targetProfile, scopeLevelMap);
            if (check.allowed) {
                hasAuthority = true;
                break; 
            } else {
                failReason = check.reason;
            }
        }

        if (hasAuthority) {
            return { allowed: true };
        } else {
            return { allowed: false, reason: failReason };
        }

    } catch (error) {
        console.error("AccessDelegationService Error:", error);
        return { allowed: false, reason: "Internal Server Error during permission validation." };
    }
}

/**
 * Helper: Checks if Target is a subset of Modifier
 */
function checkProfileSubset(modifier, target, scopeMap) {
    
    // 1. Full Admin Check
    if (target.fullAdmin) {
        return { allowed: false, reason: "<b>Privilege Escalation</b>:<br> You cannot grant Global Admin rights." };
    }

    // ✅ 2. NEW: Category Admin Check
    // Modifier MUST have every category that Target has
    if (target.adminCategories && target.adminCategories.length > 0) {
        const modCats = modifier.adminCategories || [];
        for (const cat of target.adminCategories) {
            if (!modCats.includes(cat)) {
                return { allowed: false, reason: `<b>Privilege Escalation</b>:<br> You are not an Admin of the <b>'${cat}'</b> category.` };
            }
        }
    }

    // 3. Section Checks
    if (!target.sections || target.sections.length === 0) return { allowed: true };

    for (const targetSec of target.sections) {
        
        // A. Find matching section in Modifier
        const modSec = (modifier.sections || []).find(s => idsEqual(s.sectionId, targetSec.sectionId));
        
        // ✅ NEW: Fallback if Modifier is Category Admin for this section
        // (Note: This requires section metadata which we assume is handled or checked elsewhere, 
        // but strictly speaking, if mod is Category Admin, they essentially "have" the section)
        // Ideally we fetch the section to check category, but to keep this synchronous and fast:
        // We assume if mod doesn't have the section explicitly, check if they have any categories.
        // For strictness, if mod is not Full Admin, they must have the section explicitly OR match category.
        
        if (!modSec) {
            // Strict Mode: Deny if explicit section missing (unless we implement category lookups here)
            // For now, if you grant specific sections, you must have them.
            return { allowed: false, reason: `<br>Privilege Escalation</b>:<br> You do not have access to Section <b>'${targetSec.sectionId}'</b>` };
        }

        // B. Admin Flag
        if (targetSec.adminAccess === true) {
            if (modSec.adminAccess !== true) {
                return { allowed: false, reason: `<b>Privilege Escalation</b>:<br> Cannot grant Admin Access to Section <b>'${targetSec.sectionId}'</b>` };
            }
            continue; 
        }

        // C. Operations & Scopes
        if (modSec.adminAccess === true) continue;

        if (targetSec.operations) {
            for (const targetOp of targetSec.operations) {
                const modOp = (modSec.operations || []).find(op => idsEqual(op.operationId, targetOp.operationId));

                if (!modOp) {
                    return { allowed: false, reason: `<b>Privilege Escalation<b>:<br> Missing Operation <b>'${targetOp.operationId}'</b> in Section <b>'${targetSec.sectionId}'</b>` };
                }

                const targetLvl = scopeMap.get(targetOp.scopeId) || 0;
                const modLvl = scopeMap.get(modOp.scopeId) || 0;

                if (targetLvl > modLvl) {
                    return { 
                        allowed: false, 
                        reason: `<b>Scope Violation</b>:<br> Op <b>'${targetOp.operationId}'</b>. Granting Level <b>${targetLvl}</b> > Your Level <b>${modLvl}</b>.` 
                    };
                }
            }
        }
    }

    return { allowed: true };
}

module.exports = {
    validateDelegation,
};
