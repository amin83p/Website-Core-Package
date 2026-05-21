// MVC/services/policyValidator.js
const dataService = require('./dataService'); // ✅ Use Data Service
const { SYSTEM_CONTEXT } = require('../../config/constants');
const { loadMergedProfileByIds } = require('./security/profileMergeService');

/**
 * ----------------------------------------------------------------------------
 * STEP 1: CALCULATE CREATOR'S EFFECTIVE CAPABILITIES
 * Returns a map of what the Creator is allowed to do based on Profile + Policy.
 * ----------------------------------------------------------------------------
 */
async function getCreatorCapabilities(creatorId) {
    // 1. Fetch Creator (Use System Context to get raw user data)
    const creator = await dataService.getDataById('users', creatorId, SYSTEM_CONTEXT);
    if (!creator) throw new Error('Creator user not found');

    // 2. Check Virtual Admin / Super Admin (God Mode)
    if (creator.isVirtualSuperAdmin) {
        return { isSuperAdmin: true };
    }

    // 3. Fetch Definitions
    const allSections = await dataService.fetchData('sections', {}, SYSTEM_CONTEXT);
    
    // 4. Fetch Creator's Context (Profile & Policy)
    // A. Policy (Personal)
    const policies = await dataService.fetchData('accessPolicies', { 
        q: creator.id, type: 'exact_match', searchFields: 'userId' 
    }, SYSTEM_CONTEXT);
    const creatorPolicy = policies[0];

    // B. Profile (Organizational Role)
    let creatorProfile = null;
    if (creator.primaryOrgId) {
        const orgConf = (creator.organizations || []).find(o => Number(o.orgId) === Number(creator.primaryOrgId));
        if (orgConf && orgConf.accessProfileIds && orgConf.accessProfileIds.length > 0) {
            creatorProfile = await loadMergedProfileByIds(orgConf.accessProfileIds, SYSTEM_CONTEXT);
        }
    }

    // Global Profile Admin Check
    if (creatorProfile && creatorProfile.fullAdmin) {
        return { isSuperAdmin: true };
    }

    // -------------------------------------------------------
    // BUILD CAPABILITY MAP
    // -------------------------------------------------------
    const capabilities = {}; 

    // --- BASELINE: RBAC (From Access Profile) ---
    // Instead of checking 'accessLevel', we check if the section exists in the Profile.
    if (creatorProfile && creatorProfile.sections) {
        creatorProfile.sections.forEach(profSec => {
            const sysSec = allSections.find(s => s.id === profSec.sectionId);
            if (!sysSec) return;

            // Initialize Section Capability
            capabilities[profSec.sectionId] = {
                allowed: true,
                source: 'PROFILE',
                adminAccess: profSec.adminAccess, // If profile says Admin, they have full ops
                timeLimits: { maxSessionDurationMinutes: Infinity, maxAttemptsPerSession: Infinity },
                throughputLimits: { maxFetchVolumeKB: Infinity },
                operations: {} 
            };

            // Populate Operations (if not Admin Access)
            if (!profSec.adminAccess && profSec.operations) {
                profSec.operations.forEach(profOp => {
                    capabilities[profSec.sectionId].operations[profOp.operationId] = {
                        allowed: true,
                        // Profile limits (or Infinity if not set)
                        maxAttemptsPerSession: profOp.maxAttemptsPerSession ?? Infinity,
                        maxSessionDurationMinutes: profOp.maxSessionDurationMinutes ?? Infinity,
                        throughputLimits: { maxFetchVolumeKB: profOp.maxFetchUploadVolumeKB ?? Infinity } 
                    };
                });
            } else if (profSec.adminAccess && sysSec.operations) {
                // If Profile gives Admin Access to section, populate ALL system operations as allowed
                sysSec.operations.forEach(opRef => {
                    capabilities[profSec.sectionId].operations[opRef.id] = {
                        allowed: true,
                        maxAttemptsPerSession: Infinity,
                        maxSessionDurationMinutes: Infinity,
                        throughputLimits: { maxFetchVolumeKB: Infinity }
                    };
                });
            }
        });
    }

    // --- OVERLAY: ABAC (Policy Overrides) ---
    if (creatorPolicy && creatorPolicy.active && creatorPolicy.sections) {
        creatorPolicy.sections.forEach(polSec => {
            const sysSec = allSections.find(s => s.id === polSec.sectionId);
            if (!sysSec) return;

            // 1. Policy Bans (Revoke)
            if (polSec.accessState?.status === 'suspended' || polSec.accessType === 'full_ban') {
                delete capabilities[polSec.sectionId]; 
                return;
            }

            // 2. Policy Grants (Add if missing)
            if (!capabilities[polSec.sectionId]) {
                capabilities[polSec.sectionId] = {
                    allowed: true,
                    source: 'POLICY',
                    operations: {}
                };
            }

            const cap = capabilities[polSec.sectionId];

            // 3. Policy Section Limits (Apply Restrictive Logic)
            if (polSec.accessType === 'full_access') {
                // Policy explicitly grants full access -> Upgrade limits to Infinity
                cap.timeLimits = { maxSessionDurationMinutes: Infinity, maxAttemptsPerSession: Infinity };
                cap.throughputLimits = { maxFetchVolumeKB: Infinity };
                cap.adminAccess = true; // Effectively admin
            } else {
                // Apply specific limits (Policy usually restricts)
                // Note: Logic here is tricky. If Profile said Infinity, and Policy says 10, effective is 10.
                if(polSec.timeLimits) cap.timeLimits = { ...cap.timeLimits, ...polSec.timeLimits };
                if(polSec.throughputLimits) cap.throughputLimits = { ...cap.throughputLimits, ...polSec.throughputLimits };
            }

            // 4. Policy Operations
            if (polSec.operations) {
                polSec.operations.forEach(polOp => {
                    if (polOp.accessType === 'full_ban') {
                        delete cap.operations[polOp.operationId];
                        return;
                    }

                    if (!cap.operations[polOp.operationId]) {
                        cap.operations[polOp.operationId] = { allowed: true };
                    }
                    const opCap = cap.operations[polOp.operationId];

                    if (polOp.accessType === 'full_access') {
                        opCap.maxSessionDurationMinutes = Infinity;
                        opCap.maxAttemptsPerSession = Infinity;
                    } else {
                        // Merge specific limits
                        if(polOp.timeLimits?.maxSessionDurationMinutes) opCap.maxSessionDurationMinutes = polOp.timeLimits.maxSessionDurationMinutes;
                        if(polOp.executionLimits?.maxAttemptsPerSession) opCap.maxAttemptsPerSession = polOp.executionLimits.maxAttemptsPerSession;
                        if(polOp.throughputLimits?.maxFetchVolumeKB) {
                            if(!opCap.throughputLimits) opCap.throughputLimits = {};
                            opCap.throughputLimits.maxFetchVolumeKB = polOp.throughputLimits.maxFetchVolumeKB;
                        }
                    }
                });
            }
        });
    }

    return { isSuperAdmin: false, scope: capabilities };
}

/**
 * ----------------------------------------------------------------------------
 * MAIN VALIDATOR FUNCTION
 * ----------------------------------------------------------------------------
 */
async function validatePolicyChange(creatorId, newPolicy) {
    const errors = [];
    const caps = await getCreatorCapabilities(creatorId);

    // 1. Super Admin Bypass
    if (caps.isSuperAdmin) return { isValid: true };

    const creatorScope = caps.scope;

    // 2. Iterate Target Sections in the New Policy
    if (newPolicy.sections && Array.isArray(newPolicy.sections)) {
        for (const targetSec of newPolicy.sections) {
            const secId = targetSec.sectionId;
            const creatorSec = creatorScope[secId];

            // RULE: Section Existence (You cannot grant what you don't have)
            if (!creatorSec) {
                errors.push(`<b>Privilege Escalation</b><br>You do not have access to section '${secId}', so you cannot grant it.`);
                continue;
            }

            // RULE: Full Access Grant
            if (targetSec.accessType === 'full_access') {
                const hasLimits = (
                    creatorSec.timeLimits?.maxSessionDurationMinutes !== Infinity ||
                    creatorSec.throughputLimits?.maxFetchVolumeKB !== Infinity
                );
                if (hasLimits) {
                    errors.push(`<b>Limit Violation</b><br>Section '${secId}': You have restricted access, so you cannot grant 'Full Access'.`);
                }
            } else if (targetSec.accessType === 'custom') {
                // Numeric Limit Check (Delegation)
                // You cannot grant a limit higher than your own
                const tMax = targetSec.timeLimits?.maxSessionDurationMinutes || Infinity;
                const cMax = creatorSec.timeLimits?.maxSessionDurationMinutes || Infinity;
                
                if (tMax > cMax) {
                    errors.push(`<b>Limit Violation</b><br>Section '${secId}': You cannot grant ${tMax} min session. Your limit is ${cMax} min.`);
                }
            }

            // RULE: Operations
            if (targetSec.operations) {
                for (const targetOp of targetSec.operations) {
                    const opId = targetOp.operationId;
                    const creatorOp = creatorSec.operations[opId];

                    if (!creatorOp) {
                        errors.push(`<b>Privilege Escalation</b><br>Section '${secId}': You do not have access to operation '${opId}'.`);
                        continue;
                    }

                    const isCreatorFull = (
                        creatorOp.maxAttemptsPerSession === Infinity &&
                        creatorOp.maxSessionDurationMinutes === Infinity
                    );

                    if (targetOp.accessType === 'full_access' && !isCreatorFull) {
                        errors.push(`<b>Limit Violation</b><br>Op '${opId}': You have restricted access, so you cannot grant 'Full Access'.`);
                    } else if (targetOp.accessType !== 'full_access') {
                        // Custom numeric checks
                        const tAtt = targetOp.executionLimits?.maxAttemptsPerSession || Infinity;
                        const cAtt = creatorOp.maxAttemptsPerSession || Infinity;
                        if (tAtt > cAtt) {
                            errors.push(`<b>Limit Violation</b><br>Op '${opId}': Cannot grant ${tAtt} attempts. Your limit is ${cAtt}.`);
                        }
                    }
                }
            }
        }
    }

    return { 
        isValid: errors.length === 0, 
        errors 
    };
}

// Export only the validator. (checkAccess removed as it duplicated accessControlService)
module.exports = { validatePolicyChange };
