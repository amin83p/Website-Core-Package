// MVC/services/AccessDelegationService.js
const accessRepository = require('../../repositories/accessRepository');
const scopeRepository = require('../../repositories/scopeRepository');
const adminChekersService = require('../../services/adminChekersService');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');

/**
 * AccessDelegationService
 * Security Policy Enforcement: "Subset & Scope Authority"
 */

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeProfileIds(values = []) {
    const out = [];
    const seen = new Set();
    asArray(values).forEach((value) => {
        const id = toPublicId(value);
        if (!id || seen.has(id)) return;
        seen.add(id);
        out.push(id);
    });
    return out;
}

function resolveOrgAccessProfileIds(orgConfig = {}) {
    return normalizeProfileIds([
        ...asArray(orgConfig.accessProfileIds),
        ...asArray(orgConfig.directAccessProfileIds),
        ...asArray(orgConfig.managedAccessProfiles).map((row) => row?.profileId || row?.id || row?.accessProfileId)
    ]);
}

async function getAccessProfileForOrg(profileId, targetOrgId) {
    const rows = await accessRepository.list({
        query: {
            id__eq: toPublicId(profileId),
            page: 1,
            limit: 1
        },
        scope: {
            canViewAll: false,
            includeGlobal: true,
            orgId: toPublicId(targetOrgId)
        }
    });
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function validateDelegation(modifierUser, targetProfileId, targetOrgId) {
    try {
        // 1. SYSTEM ADMIN BYPASS
        if (adminChekersService.isSuperAdmin(modifierUser)) {
            return { allowed: true };
        }

        // 2. FETCH DATA & CONTEXT
        const targetProfile = await getAccessProfileForOrg(targetProfileId, targetOrgId);
        if (!targetProfile) {
            return { allowed: false, reason: `Target Access Profile (${targetProfileId}) does not exist.` };
        }

        const allScopes = await scopeRepository.list({ scope: { canViewAll: true } });
        const scopeLevelMap = new Map(asArray(allScopes).map(s => [toPublicId(s.id), Number(s.level) || 0]));

        // 3. RESOLVE MODIFIER'S PROFILE
        const modOrgConfig = asArray(modifierUser.allowedOrgs).find(o => idsEqual(o.orgId, targetOrgId));
        
        if (!modOrgConfig) {
             return { allowed: false, reason: `You are not a member of Organization <b>#${targetOrgId}</b>,<br> so you cannot grant access to it.` };
        }

        const modifierProfileIds = resolveOrgAccessProfileIds(modOrgConfig);
        if (modifierProfileIds.length === 0) {
            return { allowed: false, reason: `You have no Access Profile assigned in Organization <b>#${targetOrgId}</b>.` };
        }

        let hasAuthority = false;
        let failReason = "Insufficient privileges.";

        for (const modPid of modifierProfileIds) {
            const modifierProfile = await getAccessProfileForOrg(modPid, targetOrgId);
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
        return { allowed: false, reason: `Unable to validate delegated permission: ${error.message}` };
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
    const targetCategories = asArray(target.adminCategories);
    if (targetCategories.length > 0) {
        const modCats = asArray(modifier.adminCategories);
        for (const cat of targetCategories) {
            if (!modCats.includes(cat)) {
                return { allowed: false, reason: `<b>Privilege Escalation</b>:<br> You are not an Admin of the <b>'${cat}'</b> category.` };
            }
        }
    }

    // 3. Section Checks
    const targetSections = asArray(target.sections);
    const modifierSections = asArray(modifier.sections);

    if (targetSections.length === 0) return { allowed: true };

    for (const targetSec of targetSections) {
        if (!targetSec || typeof targetSec !== 'object') continue;
        const targetSectionId = toPublicId(targetSec.sectionId || targetSec.id);
        
        // A. Find matching section in Modifier
        const modSec = modifierSections.find(s => idsEqual(s?.sectionId || s?.id, targetSectionId));
        
        // ✅ NEW: Fallback if Modifier is Category Admin for this section
        // (Note: This requires section metadata which we assume is handled or checked elsewhere, 
        // but strictly speaking, if mod is Category Admin, they essentially "have" the section)
        // Ideally we fetch the section to check category, but to keep this synchronous and fast:
        // We assume if mod doesn't have the section explicitly, check if they have any categories.
        // For strictness, if mod is not Full Admin, they must have the section explicitly OR match category.
        
        if (!modSec) {
            // Strict Mode: Deny if explicit section missing (unless we implement category lookups here)
            // For now, if you grant specific sections, you must have them.
            return { allowed: false, reason: `<b>Privilege Escalation</b>:<br> You do not have access to Section <b>'${targetSectionId}'</b>` };
        }

        // B. Admin Flag
        if (targetSec.adminAccess === true) {
            if (modSec.adminAccess !== true) {
                return { allowed: false, reason: `<b>Privilege Escalation</b>:<br> Cannot grant Admin Access to Section <b>'${targetSectionId}'</b>` };
            }
            continue; 
        }

        // C. Operations & Scopes
        if (modSec.adminAccess === true) continue;

        if (Array.isArray(targetSec.operations)) {
            const modifierOperations = asArray(modSec.operations);
            for (const targetOp of targetSec.operations) {
                if (!targetOp || typeof targetOp !== 'object') continue;
                const targetOperationId = toPublicId(targetOp.operationId || targetOp.id);
                const modOp = modifierOperations.find(op => idsEqual(op?.operationId || op?.id, targetOperationId));

                if (!modOp) {
                    return { allowed: false, reason: `<b>Privilege Escalation</b>:<br> Missing Operation <b>'${targetOperationId}'</b> in Section <b>'${targetSectionId}'</b>` };
                }

                const targetLvl = scopeMap.get(toPublicId(targetOp.scopeId)) || 0;
                const modLvl = scopeMap.get(toPublicId(modOp.scopeId)) || 0;

                if (targetLvl > modLvl) {
                    return { 
                        allowed: false, 
                        reason: `<b>Scope Violation</b>:<br> Op <b>'${targetOperationId}'</b>. Granting Level <b>${targetLvl}</b> > Your Level <b>${modLvl}</b>.` 
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
