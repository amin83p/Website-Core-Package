// MVC/services/authService.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'); 
const dataService = require('./dataService'); 
const { SECRET_KEY } = require('../../config/security'); 
const { SYSTEM_CONTEXT } = require('../../config/constants'); 
const sessionService = require('./SessionService'); 
const { loadMergedProfileByIds } = require('./security/profileMergeService');
const { normalizeOrgRoles, getPrimaryOrgRole } = require('../utils/orgContextUtils');
const { idsEqual, toPublicId, toStorageId } = require('../utils/idAdapter');
const userRepository = require('../repositories/userRepository');
const { evaluateUserEntitlement } = require('./security/entitlementService');
const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });

async function resolveUserById(userId) {
    const fromDataService = await dataService.getDataById('users', userId, SYSTEM_CONTEXT);
    if (fromDataService) return fromDataService;
    return await userRepository.getById(userId);
}

async function fetchUserMembershipRows(userId) {
    const normalizedUserId = toPublicId(userId);
    if (!normalizedUserId) return [];
    return await dataService.fetchData('userMemberships', {
        q: normalizedUserId,
        type: 'exact_match',
        searchFields: 'userId',
        page: 1,
        limit: 5000
    }, SYSTEM_CONTEXT);
}

function buildBypassEntitlement(status, reason) {
    return {
        enforced: false,
        hasRecords: false,
        active: true,
        status,
        reason,
        appliesToAllOrgs: false,
        effectiveStartDate: null,
        effectiveEndDate: null,
        nextStartDate: null,
        periods: []
    };
}

/* ============================================================
   AUTHENTICATION & TOKEN UTILS
============================================================ */

// 1. Authenticate User
async function authenticateUser(username, password) {
    try {
        const requestedUsername = String(username || '').trim();
        const requestedLower = requestedUsername.toLowerCase();

        const users = await dataService.fetchData('users', {
            q: requestedUsername,
            type: 'exact_match',
            searchFields: 'username'
        }, SYSTEM_CONTEXT);

        let user = Array.isArray(users)
            ? users.find((u) => String(u?.username || '').trim().toLowerCase() === requestedLower)
            : null;

        // Mongo mode may not surface virtual/system users through generic list queries.
        // Fallback to repository direct lookup to avoid superuser lockout.
        if (!user) {
            user = await userRepository.getByUsername(requestedUsername);
        }

        if (!user) return { success: false, message: 'Invalid username or password.' };
        if (!user.active || user.status !== 'active') return { success: false, message: 'User account is not active.' };

        const isMatch = await bcrypt.compare(password, user.passwordHash || user.password);
        if (!isMatch) return { success: false, message: 'Invalid username or password.' };

        // Virtual/system super-admin can be resolved from static model fallback in mongo mode
        // and may not exist as a writable Mongo document. Skip noisy lastLogin writes for that case.
        if (!user?.isVirtualSuperAdmin) {
            try {
                await dataService.updateData('users', user.id, { lastLoginAt: new Date().toISOString() }, SYSTEM_CONTEXT);
            } catch (e) {
                const msg = String(e?.message || '');
                if (/user not found/i.test(msg)) {
                    console.warn('Last login update skipped: user not found in active backend store.');
                } else {
                    console.error('Last login update failed', e);
                }
            }
        }

        return { success: true, user };
    } catch (error) {
        console.error('Auth Service Error:', error);
        throw new Error('Authentication failed.');
    }
}

// 2. Generate Token (Dynamic Expiration)
function generateToken(user, durationMinutes = 2880) { // Default 48h
    let fullName = user.username;
    const expiresInSeconds = durationMinutes * 60;

    return jwt.sign(
        { id: user.id, username: user.username, name: fullName, accessLevel: user.accessLevel }, 
        SECRET_KEY, 
        { expiresIn: expiresInSeconds } 
    );
}

// 3. Validate Token
function validateToken(token) {
  try {
    jwt.verify(token, SECRET_KEY);
    return true;
  } catch (error) { return false; }
}

/* ============================================================
   LOGIN FLOW (Service Wrapper)
============================================================ */
async function login(username, password, deviceInfo) {
  const authResult = await authenticateUser(username, password);
  if (!authResult.success) return authResult;

  const user = authResult.user;
  const startOrgId = user.primaryOrgId || null;

  // 1. Resolve Policy Limits
  const limits = await sessionService.resolvePolicyLimits(user, startOrgId);
  const maxDurationMins = limits.maxDurationMins || 1440; 

  // 2. Check Session Count Eligibility
  const eligibility = await sessionService.checkLoginEligibility(user, startOrgId);
  if (!eligibility.allowed) {
      return { 
          success: false,
          status: 'session_limit_exceeded', 
          message: 'Maximum active sessions reached.',
          activeSessions: eligibility.activeSessions 
      };
  }

  // 3. Generate Token
  const token = generateToken(user, maxDurationMins);
  
  // 4. Create Database Session
  const signature = token.split('.')[2].substring(0, 10);
  await sessionService.createSession(user, startOrgId, deviceInfo, signature);

  // 5. Return success
  return { 
      success: true, 
      token, 
      user,
      maxAge: maxDurationMins * 60 * 1000 
  };
}

/* ============================================================
   CONTEXT RESOLVER (Token -> Full User Context)
============================================================ */
async function getUserFromToken(token) {
  const decoded = jwt.verify(token, SECRET_KEY);
  const user = await resolveUserById(decoded.id);
  
  if (!user) throw new Error('Token user no longer exists');
  if (!user.active || user.status !== 'active') throw new Error('User account is not active.');

  let fullName = user.username;
  let personAvatarUrl = null;
  
  // 1. SYSTEM IDENTITY FLAGS
  let isVirtualSuperAdmin = false;
  let hasSystemProfile = false;
  let sysProfile = null;

  if (user.isVirtualSuperAdmin) {
      isVirtualSuperAdmin = true;
      sysProfile = { id: 'VIRTUAL_ROOT', name: 'SYSTEM_ROOT', fullAdmin: true, active: true, adminCategories: [] };
      fullName = user.username || "System Administrator";
  } else if (user.systemAccessProfileId) {
      const loadedSysProfile = await dataService.getDataById('accesses', user.systemAccessProfileId, SYSTEM_CONTEXT);
      if (loadedSysProfile && loadedSysProfile.active) {
          hasSystemProfile = true;
          sysProfile = loadedSysProfile;
          if (!sysProfile.adminCategories) sysProfile.adminCategories = [];
      }
  }

  // 2. CALCULATE REAL LOCAL MEMBERSHIPS
  let realLocalMemberships = [];
  let personOrgs = [];

  if (user.personId) {
      const person = await dataService.getDataById('persons', user.personId, SYSTEM_CONTEXT, PERSON_QUERY_OPTIONS);
      if (person) {
          personAvatarUrl = String(person.avatarUrl || '').trim() || null;
          if (!isVirtualSuperAdmin && !hasSystemProfile) {
              const n = person.name || {};
              fullName = n.preferred ? n.preferred : [n.first, n.middle, n.last].filter(Boolean).join(' ');
          }
          if (person.organizations && Array.isArray(person.organizations)) {
              personOrgs = [...person.organizations];
          }
      }
  }

  let mergedOrgs = [...personOrgs];
  if (user.organizations && Array.isArray(user.organizations)) {
      user.organizations.forEach(uOrg => {
          const idx = mergedOrgs.findIndex(pOrg => idsEqual(pOrg.orgId, uOrg.orgId));
          if (idx > -1) {
              mergedOrgs[idx] = { ...mergedOrgs[idx], ...uOrg };
          } else {
              mergedOrgs.push(uOrg);
          }
      });
  }
  realLocalMemberships = mergedOrgs;

  // 3. BUILD ALLOWED ORGS
  let allowedOrgs = [];
  
  if (isVirtualSuperAdmin || hasSystemProfile) {
      // System/Admin users can see all orgs, but switchability is still gated by active + contract.
      const allOrgs = await dataService.fetchData('organizations', {}, SYSTEM_CONTEXT);
      allowedOrgs = await Promise.all(allOrgs.map(async (o) => {
          const orgIsActive = Boolean(o?.active);
          const hasActiveContract = orgIsActive
            ? await dataService.OrgHasActiveContract(o.id, SYSTEM_CONTEXT)
            : false;
          const isSelectable = Boolean(orgIsActive && hasActiveContract);
          const disabledReason = !orgIsActive
            ? 'Organization is inactive.'
            : (!hasActiveContract ? 'Organization has no active contract.' : '');
          let orgObj = {
              orgId: o.id,
              name: o.identity?.displayName || o.identity?.legalName || o.name || `Org #${o.id}`,
              roles: [isVirtualSuperAdmin ? 'admin' : 'system_user'],
              role: isVirtualSuperAdmin ? 'admin' : 'system_user',
              memberStatus: 'active',
              joinedAt: new Date().toISOString(),
              accessProfileIds: [],
              isOrgActive: orgIsActive,
              hasActiveContract,
              isSelectable,
              switchDisabledReason: disabledReason
          };
          const realMem = realLocalMemberships.find(rm => idsEqual(rm.orgId, o.id));
          if (realMem && realMem.memberStatus === 'active') {
               orgObj.roles = normalizeOrgRoles(realMem);
               orgObj.role = getPrimaryOrgRole(realMem, orgObj.role);
               if (realMem.accessProfileIds) orgObj.accessProfileIds = realMem.accessProfileIds;
          }
          return orgObj;
      }));
      allowedOrgs.unshift({ orgId: 'SYSTEM', name: 'SYSTEM / GLOBAL MODE', roles: ['super_admin'], role: 'Super Admin', memberStatus: 'active' });
  } else {
      // ✅ STANDARD USERS: Enforce Contract Check
      for (const org of realLocalMemberships) {
          if (org.memberStatus !== 'active') continue;
          
          const orgData = await dataService.getDataById('organizations', org.orgId, SYSTEM_CONTEXT);
          
          // Must be Active AND Have Active Contract
          if (orgData && orgData.active) {
              if (await dataService.OrgHasActiveContract(orgData.id, SYSTEM_CONTEXT)) {
                  const resolvedOrgName = String(
                    orgData?.identity?.displayName ||
                    orgData?.identity?.legalName ||
                    org?.name ||
                    org?.orgName ||
                    `Org #${orgData?.id || org?.orgId}`
                  ).trim();
                  allowedOrgs.push({
                    ...org,
                    name: resolvedOrgName,
                    orgName: resolvedOrgName,
                    organizationName: resolvedOrgName,
                    roles: normalizeOrgRoles(org),
                    role: getPrimaryOrgRole(org)
                  }); 
              } else {
                  // Optional: You could log this rejection
                  // console.log(`Org ${org.orgId} blocked for user ${user.id}: No Valid Contract`);
              }
          }
      }
  }

  let membershipRows = [];
  const entitlementByOrgId = new Map();
  if (!user.isVirtualSuperAdmin) {
      membershipRows = await fetchUserMembershipRows(user.id);
      allowedOrgs = allowedOrgs.map((org) => {
          if (idsEqual(org?.orgId, 'SYSTEM')) return org;
          const nextOrg = { ...org };
          const orgEntitlement = evaluateUserEntitlement(membershipRows, user.id, nextOrg.orgId);
          entitlementByOrgId.set(String(nextOrg.orgId), orgEntitlement);
          nextOrg.entitlement = orgEntitlement;
          if (orgEntitlement.enforced && orgEntitlement.active === false) {
              if (nextOrg.isSelectable !== false) nextOrg.isSelectable = false;
              if (!String(nextOrg.switchDisabledReason || '').trim()) {
                  nextOrg.switchDisabledReason = orgEntitlement.reason || 'Membership is inactive for this organization.';
              }
          } else if (nextOrg.isSelectable !== false) {
              nextOrg.isSelectable = true;
          }
          return nextOrg;
      });
  }

  if (!isVirtualSuperAdmin && !hasSystemProfile && allowedOrgs.length === 0) {
      // If user has memberships but all contracts are expired
      throw new Error('No active organization memberships found or contracts may be expired.');
  }


  // 4. ACTIVE ORG
  let activeOrgId = null;
  const primaryOrgIdStr = toPublicId(user.primaryOrgId);

  if ((isVirtualSuperAdmin || hasSystemProfile) && (toPublicId(user.primaryOrgId) === 'SYSTEM' || !user.primaryOrgId)) {
      activeOrgId = 'SYSTEM';
  } else {
      const primaryOrg = allowedOrgs.find(o => idsEqual(o.orgId, primaryOrgIdStr));
      if (primaryOrg && primaryOrg.orgId !== 'SYSTEM') activeOrgId = primaryOrg.orgId;
      
      if (!activeOrgId) {
          // Fallback if primary org is now blocked
          if (isVirtualSuperAdmin || hasSystemProfile) {
              activeOrgId = 'SYSTEM';
              await dataService.updateData('users', user.id, { primaryOrgId: 'SYSTEM' }, SYSTEM_CONTEXT);
          } else {
              if (allowedOrgs.length > 0) {
                  activeOrgId = allowedOrgs[0].orgId;
                  await dataService.updateData('users', user.id, { primaryOrgId: toStorageId(activeOrgId) }, SYSTEM_CONTEXT);
              } else {
                  throw new Error("No available organizations to access.");
              }
          }
      }
  }

  if (!activeOrgId) throw new Error('No active organization context available.');

  // 5. PROFILE RESOLUTION
  let activeProfile = null;
  let canSwitchProfile = false;
  let currentProfileMode = user.activeProfileMode || 'SYSTEM';

  if (activeOrgId === 'SYSTEM') {
      currentProfileMode = 'SYSTEM';
      activeProfile = sysProfile;
  } else {
      const currentOrgConfig = allowedOrgs.find(o => idsEqual(o.orgId, activeOrgId));
      let localProfile = null;
      if (currentOrgConfig?.accessProfileIds?.length > 0) {
          localProfile = await loadMergedProfileByIds(currentOrgConfig.accessProfileIds, SYSTEM_CONTEXT);
          if (localProfile && !localProfile.adminCategories) localProfile.adminCategories = [];
      }

      if ((isVirtualSuperAdmin || hasSystemProfile) && localProfile) {
          canSwitchProfile = true;
          activeProfile = (currentProfileMode === 'LOCAL') ? localProfile : sysProfile;
      } else {
          if (localProfile) { activeProfile = localProfile; currentProfileMode = 'LOCAL'; }
          else if (isVirtualSuperAdmin || hasSystemProfile) { activeProfile = sysProfile; currentProfileMode = 'SYSTEM'; }
      }
  }

  // 6. FETCH POLICIES
  let activePolicy = null;
  let activeOrgPolicy = null; 
  const userPolicies = await dataService.fetchData('accessPolicies', { q: user.id, type: 'exact_match', searchFields: 'userId' }, SYSTEM_CONTEXT);
  if (userPolicies && userPolicies.length > 0) {
      activePolicy = userPolicies.find(p => idsEqual(p.orgId, activeOrgId)) || userPolicies.find(p => !p.orgId);
  }
  if (activeOrgId && activeOrgId !== 'SYSTEM') {
      const orgPolicies = await dataService.fetchData('orgPolicies', { q: activeOrgId, type: 'exact_match', searchFields: 'orgId' }, SYSTEM_CONTEXT);
      if (orgPolicies) activeOrgPolicy = orgPolicies.find(p => idsEqual(p.orgId, activeOrgId));
  }

  // 7. MEMBERSHIP / ENTITLEMENT WINDOW (per-user validity)
  let entitlement = buildBypassEntitlement('bypass', 'Entitlement check bypassed for virtual super admin.');

  if (!user.isVirtualSuperAdmin) {
    if (activeOrgId === 'SYSTEM') {
      entitlement = buildBypassEntitlement('system_mode', 'System mode is not membership-restricted.');
    } else {
      entitlement = entitlementByOrgId.get(String(activeOrgId))
        || evaluateUserEntitlement(membershipRows, user.id, activeOrgId);
    }
  }

  return {
    ...decoded,
    id: user.id, 
    username: user.username, 
    personId: user.personId,
    personAvatarUrl,
    userAvatarUrl: String(user.avatarUrl || user.avatar || '').trim() || null,
    name: fullName, 
    email: user.email, 
    accessLevel: user.accessLevel, 
    isVirtualSuperAdmin: user.isVirtualSuperAdmin, 
    isSystemAdmin: (currentProfileMode === 'SYSTEM' && (isVirtualSuperAdmin || hasSystemProfile)), 
    activeOrgId, 
    allowedOrgs, 
    activeProfile, 
    activePolicy, 
    activeOrgPolicy,
    canSwitchProfile,
    currentProfileMode,
    entitlement
  };
}

/* ============================================================
   CONTEXT SWITCHES (Org & Profile)
============================================================ */
async function switchOrganization(userId, targetOrgId, currentSessionId) {
  const user = await resolveUserById(userId);
  if (!user) return { success: false, message: 'User not found.' };

  const isSystemUser = (user.isVirtualSuperAdmin || !!user.systemAccessProfileId);

  // 1. Session Check (Policy limits)
  if (currentSessionId && targetOrgId !== 'SYSTEM') {
       const sessionCheck = await sessionService.validateOrgSwitch(user, currentSessionId, targetOrgId);
       if (!sessionCheck.allowed) {
           return { 
               success: false, 
               status: 'session_limit_exceeded',
               message: sessionCheck.message,
               reason: sessionCheck.reason,
               sessionsToDelete: sessionCheck.sessionsToDelete 
           };
       }
  }

  // 2. Logic
  if ((targetOrgId === 'SYSTEM' || !targetOrgId) && isSystemUser) {
      await dataService.updateData('users', user.id, { primaryOrgId: 'SYSTEM', activeProfileMode: 'SYSTEM' }, SYSTEM_CONTEXT);
      return { success: true, message: 'Switched to System Mode.' };
  }

  const target = await dataService.getDataById('organizations', targetOrgId, SYSTEM_CONTEXT);
  if (!target) return { success: false, message: 'Organization not found.' };

  // All users (including super users) can only switch into active orgs with an active contract.
  if (!target.active) {
      return { success: false, message: 'Cannot switch.<br>This organization is inactive.' };
  }
  const targetHasActiveContract = await dataService.OrgHasActiveContract(target.id, SYSTEM_CONTEXT);
  if (!targetHasActiveContract) {
      return { success: false, message: 'Cannot switch.<br>This organization has no active subscription/contract.' };
  }

  if (!user?.isVirtualSuperAdmin) {
      const membershipRows = await fetchUserMembershipRows(user.id);
      const targetEntitlement = evaluateUserEntitlement(membershipRows, user.id, target.id);
      if (targetEntitlement.enforced && targetEntitlement.active === false) {
          return { success: false, message: targetEntitlement.reason || 'Membership is inactive for this organization.' };
      }
  }

  // ✅ VALIDATE TARGET ORG CONTRACT
  // System Admins (entering as local) AND Standard Users are both subject to this check
  // when "entering" the org context to do work.
 
    if(!isSystemUser){
        if (!target.active || !targetHasActiveContract) {
            return { success: false, message: 'Access Denied<br>This Organization has no active subscription/contract.' };
        }
    }

  let canSwitch = false;
  let profileMode = 'LOCAL';
  if (isSystemUser){ 
    canSwitch = true;
    profileMode = 'SYSTEM';
  } else {
      const person = await dataService.getDataById('persons', user.personId, SYSTEM_CONTEXT, PERSON_QUERY_OPTIONS);
      if (person?.organizations?.some(o => idsEqual(o.orgId, targetOrgId) && o.memberStatus === 'active')) canSwitch = true;
      if (!canSwitch && user.organizations?.some(o => idsEqual(o.orgId, targetOrgId) && o.memberStatus === 'active')) canSwitch = true;
  }

  if (canSwitch) {
      await dataService.updateData('users', user.id, {
        primaryOrgId: toStorageId(targetOrgId),
        activeProfileMode: profileMode,//'LOCAL',
        audit: { lastUpdateUser: user.id, lastUpdateDateTime: new Date().toISOString() }
      }, SYSTEM_CONTEXT);
      return { success: true, message: 'Context switched.' };
  }
  return { success: false, message: 'Switch failed.' };
}

async function switchProfileMode(userId, mode, currentSessionId) {
    if (!['SYSTEM', 'LOCAL'].includes(mode)) throw new Error("Invalid Mode.");
    const user = await resolveUserById(userId);
    if (!user) throw new Error('User not found.');

    // ✅ VALIDATION: Block 'LOCAL' mode if Organization Contract is Invalid
    if (mode === 'LOCAL') {
        const currentOrgId = user.primaryOrgId;

        // We only check contracts for actual Tenant Organizations (not the root SYSTEM org)
        console.log((currentOrgId && toPublicId(currentOrgId) !== 'SYSTEM'));
        if (currentOrgId && toPublicId(currentOrgId) !== 'SYSTEM') {
            const hasContract = await dataService.OrgHasActiveContract(currentOrgId, SYSTEM_CONTEXT);
            
            if (!hasContract) {
                return { 
                    success: false, 
                    message: '<b>Cannot switch to Local View</b><br>This Organization has no active contracts.' 
                };
            }
        }
    }

    // 1. Update Session Activity
    if (currentSessionId) {
        await sessionService.touchSession(currentSessionId);
    }

    // 2. Update User Profile Mode
    await dataService.updateData('users', user.id, {
        activeProfileMode: mode,
        audit: { lastUpdateUser: user.id, lastUpdateDateTime: new Date().toISOString() }
    }, SYSTEM_CONTEXT);
    return { success: true, message: `Switched to ${mode === 'SYSTEM' ? 'System Admin' : 'Local Member'} View.` };
}

module.exports = { 
    authenticateUser, 
    generateToken, 
    login, 
    validateToken, 
    getUserFromToken, 
    switchOrganization, 
    switchProfileMode 
};
