// MVC/services/accessControlService.js
const { SYSTEM_CONTEXT } = require('../../../config/constants');
const { SECTIONS } = require('../../../config/accessConstants');
const dataService = require('../dataService');
const { resolveEntity } = require('../../utils/entityResolver');
const { idsEqual } = require('../../utils/idAdapter');
const adminAuthorityService = require('../adminAuthorityService');
const effectiveAccessResolverService = require('./effectiveAccessResolverService');

/* ============================================================
   MAIN EVALUATION FUNCTION
============================================================ */
async function evaluateAccess({ user, sectionId, operationId, ipAddress }) {
  // 1. SUPER ADMIN BYPASS
  if (!user || user === SYSTEM_CONTEXT) return allow('System Internal Request', true);
  if (adminAuthorityService.isSuperAdmin(user)) {
    return {
      ...allow('Super Admin Access', true),
      adminContext: adminAuthorityService.resolveAdminAuthority({ user, sectionId, operationId })
    };
  }

  // 2. RESOLUTION & INTEGRITY CHECK
  // A. Resolve Section
  const sysSection = await resolveEntity('sections', sectionId);
  if (!sysSection) return deny(`Section '${sectionId}' does not exist.`);
  const targetSectionId = sysSection.id;

  const entitlement = user?.entitlement || null;
  if (entitlement?.enforced && entitlement.active === false) {
    const exemptSections = new Set([SECTIONS.USER_MEMBERSHIPS, SECTIONS.DASHBOARD]);
    if (!exemptSections.has(targetSectionId)) {
      return deny(entitlement.reason || 'Your membership is inactive or expired.');
    }
  }

  if (sysSection.active === false) {
    const msg = sysSection.inactiveMessage && sysSection.inactiveMessage.trim() !== ''
      ? sysSection.inactiveMessage
      : `Section '${sysSection.name || sectionId}' is currently unavailable.`;
    return deny(msg);
  }

  // B. Resolve Operation
  let sysOp = null;
  let sectionOpConfig = null;
  let targetOperationId = null;

  if (operationId) {
    sysOp = await resolveEntity('operations', operationId);
    if (!sysOp) return deny(`Operation '${operationId}' does not exist.`);
    targetOperationId = sysOp.id;

    if (sysOp.active === false) return deny(`Operation '${sysOp.name || operationId}' is globally disabled.`);

    if (sysSection.operations && Array.isArray(sysSection.operations)) {
      sectionOpConfig = sysSection.operations.find((o) => idsEqual(o.id, targetOperationId));
      if (!sectionOpConfig) return deny(`Operation '${sysOp.name}' is not supported in Section '${sysSection.name}'.`);
      if (sectionOpConfig.active === false) return deny(`Operation '${sysOp.name}' is currently disabled in Section '${sysSection.name}'.`);
    }
    if (sectionOpConfig) sysOp = { ...sysOp, ...sectionOpConfig };
  }

  // 2.5. WEBSITE GOVERNANCE CHECK (Via DataService)
  const websitePolicy = await dataService.getWebsitePolicy();
  let webSectionConfig = null;
  let webOpConfig = null;

  if (websitePolicy && websitePolicy.sections) {
    webSectionConfig = websitePolicy.sections.find((s) => idsEqual(s.sectionId, targetSectionId));
    if (webSectionConfig) {
      if (webSectionConfig.accessType === 'full_ban') return deny(
        `Section Temporarily Unavailable.<br>Reason: ${webSectionConfig.accessState?.reason || 'System Maintenance'}`,
        'WEBSITE_POLICY_BAN',
        { layer: 'website', target: 'section' }
      );
      if (targetOperationId && webSectionConfig.operations) {
        webOpConfig = webSectionConfig.operations.find((o) => idsEqual(o.operationId, targetOperationId));
        if (webOpConfig && webOpConfig.accessType === 'full_ban') return deny(
          'Operation Temporarily Disabled by Administrators.',
          'WEBSITE_POLICY_BAN',
          { layer: 'website', target: 'operation' }
        );
      }
    }
  }
  // Check if data registration is active.
  if (websitePolicy?.features?.registration === false && sysSection.name === 'USERS' && sysOp?.name === 'CREATE') {
    return deny('User Registration is Temporarily Disabled by Administrators.');
  }

  const globalPolicyContext = await effectiveAccessResolverService.resolveGlobalPolicyContext({
    user,
    orgId: user?.activeOrgId,
    ipAddress,
    websitePolicy,
    now: new Date()
  });

  if (globalPolicyContext && globalPolicyContext.allowed === false) {
    const denied = globalPolicyContext.denied || {};
    return deny(
      denied.reason || denied.message || 'Access denied by policy guardrail.',
      denied.deniedCode || 'ACCESS_DENIED',
      denied.deniedMeta || null
    );
  }

  // 3. ORGANIZATION POLICY CHECK
  const orgPolicy = user.activeOrgPolicy;
  let orgSectionConfig = null;
  let orgOpConfig = null;

  if (orgPolicy) {
    if (orgPolicy.active === false) return deny('Organization Access Policy is inactive.');
  }

  // 4. USER CONTEXT PREPARATION
  const profile = user.activeProfile;
  const policy = user.activePolicy;
  let profileSectionConfig = null;
  let policySectionConfig = null;
  let profileOpConfig = null;
  let policyOpConfig = null;

  if (profile && profile.sections) {
    profileSectionConfig = profile.sections.find((s) => idsEqual(s.sectionId, targetSectionId));
    if (profileSectionConfig) {
      if (profileSectionConfig.adminAccess) profileOpConfig = { accessType: 'full_access' };
      else if (profileSectionConfig.operations && targetOperationId) {
        profileOpConfig = profileSectionConfig.operations.find((o) => idsEqual(o.operationId, targetOperationId));
      }
    }
  }

  if (policy && policy.sections) {
    policySectionConfig = policy.sections.find((s) => idsEqual(s.sectionId, targetSectionId));
    if (policySectionConfig && policySectionConfig.operations && targetOperationId) {
      policyOpConfig = policySectionConfig.operations.find((o) => idsEqual(o.operationId, targetOperationId));
    }
  }

  const effectiveAccess = await effectiveAccessResolverService.resolveEffectiveAccess({
    user,
    sectionId: targetSectionId,
    operationId: targetOperationId,
    orgId: user.activeOrgId
  });

  const appliedPolicyContext = effectiveAccess?.appliedPolicyContext || {};
  const orgPolicyTargeted = appliedPolicyContext?.orgPolicy?.targetedSectionApplied === true;
  const decisionSource = effectiveAccess?.decisionSource
    || (orgPolicyTargeted ? 'org_policy_targeted' : 'profile_policy_merge');

  if (orgPolicyTargeted) {
    orgSectionConfig = appliedPolicyContext?.orgPolicy?.sectionConfig || orgSectionConfig;
    orgOpConfig = appliedPolicyContext?.orgPolicy?.operationConfig || orgOpConfig;
    profileSectionConfig = null;
    policySectionConfig = null;
    profileOpConfig = null;
    policyOpConfig = null;
  }

  const adminContext = await adminAuthorityService.resolveAdminAuthorityAsync({
    user,
    sectionId: targetSectionId,
    operationId: targetOperationId,
    orgId: user.activeOrgId,
    section: sysSection,
    effectiveAccess
  });

  // 5. GRANT CHECK
  const sectionBannedByPolicy = effectiveAccess?.section?.isBanned === true;
  const operationBannedByPolicy = effectiveAccess?.operation?.isBanned === true;
  if (sectionBannedByPolicy) {
    if (orgPolicyTargeted) {
      const orgReason = normalizeReasonText(orgSectionConfig?.accessState?.reason);
      return deny(
        orgReason ? `Section is Banned by Organization Policy.<br>Reason: ${orgReason}` : 'Section is Banned by Organization Policy.',
        'ORG_POLICY_BAN',
        { layer: 'organization', target: 'section', reason: orgReason }
      );
    }
    const userReason = normalizeReasonText(policySectionConfig?.accessState?.reason);
    return deny(
      userReason ? `Section is Banned by User Policy.<br>Reason: ${userReason}` : 'Section is Banned by User Policy.',
      'USER_POLICY_BAN',
      { layer: 'user', target: 'section', reason: userReason }
    );
  }
  if (operationBannedByPolicy) {
    if (orgPolicyTargeted) {
      return deny(
        'Operation is Banned by Organization Policy.',
        'ORG_POLICY_BAN',
        { layer: 'organization', target: 'operation' }
      );
    }
    const userReason = normalizeReasonText(policyOpConfig?.accessState?.reason);
    return deny(
      userReason ? `Operation is Banned by User Policy.<br>Reason: ${userReason}` : 'Operation is Banned by User Policy.',
      'USER_POLICY_BAN',
      { layer: 'user', target: 'operation', reason: userReason }
    );
  }

  let isGranted = false;
  let grantSource = '';

  if (adminContext.isRequestAdmin) {
    isGranted = true;
    if (adminContext.isSuperAdmin) grantSource = 'Super Admin';
    else if (adminContext.isSystemAdmin) grantSource = 'Full System Admin Profile';
    else if (adminContext.isCategoryAdminForSection) grantSource = `Category Admin (${sysSection.category})`;
    else if (adminContext.isGrantAdminAccessForSection) grantSource = 'Section Admin Access';
    else if (adminContext.isOperationAdminForRequest) grantSource = 'Operation Admin Access';
    else grantSource = 'Admin Context';
  } else if (!targetOperationId && effectiveAccess?.section?.allowed) {
    isGranted = true;
    grantSource = 'Section Access';
  } else if (targetOperationId && effectiveAccess?.operation?.allowed) {
    isGranted = true;
    grantSource = 'Profile/Policy Operation';
  }

  if (!isGranted) return deny('Access not granted by Role or Policy.');

  // 6. USER RESTRICTION CHECK
  if (policy) {
    if (policy.active === false) {
      return deny(
        'User Access Policy is inactive.',
        'USER_POLICY_INACTIVE',
        { layer: 'user', target: 'user' }
      );
    }
  }

  if (!orgPolicyTargeted && policySectionConfig) {
    if (policySectionConfig.accessState?.status === 'suspended') {
      const suspendedReason = normalizeReasonText(policySectionConfig?.accessState?.reason);
      return deny(
        suspendedReason
          ? `Section access is suspended by User Policy.<br>Reason: ${suspendedReason}`
          : 'Section access is suspended by User Policy.',
        'USER_POLICY_BAN',
        { layer: 'user', target: 'section', reason: suspendedReason }
      );
    }
    if (sectionBannedByPolicy) {
      const sectionReason = normalizeReasonText(policySectionConfig?.accessState?.reason);
      return deny(
        sectionReason
          ? `Section is Banned by User Policy.<br>Reason: ${sectionReason}`
          : 'Section is Banned by User Policy.',
        'USER_POLICY_BAN',
        { layer: 'user', target: 'section', reason: sectionReason }
      );
    }
  }

  if (!orgPolicyTargeted && (operationBannedByPolicy || (policyOpConfig && policyOpConfig.accessType === 'full_ban'))) {
    const operationReason = normalizeReasonText(policyOpConfig?.accessState?.reason);
    return deny(
      operationReason
        ? `Operation is Banned by User Policy.<br>Reason: ${operationReason}`
        : 'Operation is Banned by User Policy.',
      'USER_POLICY_BAN',
      { layer: 'user', target: 'operation', reason: operationReason }
    );
  }

  // 7. LIMIT CALCULATION
  const limits = resolveLimits(
    adminContext.isRequestAdmin ? { accessType: 'full_access' } : profileOpConfig,
    policyOpConfig,
    policySectionConfig,
    profileSectionConfig,
    sysOp,
    orgOpConfig,
    orgSectionConfig,
    webOpConfig,
    webSectionConfig
  );

  return {
    allowed: true,
    reason: `Authorized via ${grantSource}`,
    limits,
    scopeId: effectiveAccess?.operation?.scopeId || policyOpConfig?.scopeId || profileOpConfig?.scopeId || 'Global',
    adminContext,
    effectiveAccess,
    decisionSource,
    appliedPolicyContext: {
      orgPolicy: {
        id: appliedPolicyContext?.orgPolicy?.id || '',
        targetedSectionApplied: orgPolicyTargeted,
        sectionId: appliedPolicyContext?.orgPolicy?.sectionId || '',
        sectionAccessType: appliedPolicyContext?.orgPolicy?.sectionAccessType || '',
        operationId: appliedPolicyContext?.orgPolicy?.operationId || '',
        operationAccessType: appliedPolicyContext?.orgPolicy?.operationAccessType || ''
      },
      userPolicy: {
        id: appliedPolicyContext?.userPolicy?.id || '',
        sectionId: appliedPolicyContext?.userPolicy?.sectionId || '',
        sectionAccessType: appliedPolicyContext?.userPolicy?.sectionAccessType || '',
        operationId: appliedPolicyContext?.userPolicy?.operationId || '',
        operationAccessType: appliedPolicyContext?.userPolicy?.operationAccessType || ''
      }
    }
  };
}

// ... (Internal Helpers: allow, deny, checkNetwork, checkSchedule, timeToMinutes, resolveLimits - unchanged) ...
function allow(reason, unlimited = false) {
  return { allowed: true, reason, limits: unlimited ? { maxAttempts: null, maxTimeMinutes: null, maxVolumeKB: null } : {} };
}

function deny(reason, deniedCode = 'ACCESS_DENIED', deniedMeta = null) {
  return { allowed: false, reason, limits: {}, deniedCode, deniedMeta: deniedMeta && typeof deniedMeta === 'object' ? deniedMeta : null };
}

function normalizeReasonText(value) {
  const text = String(value || '').trim();
  return text || '';
}

function checkNetwork(networkConfig, userIp) {
  if (!networkConfig) return true;
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
    const hasAnySchedule = Object.keys(scheduleConfig.weekdays || {}).length > 0;
    return !hasAnySchedule;
  }

  const currentMinutes = (now.getHours() * 60) + now.getMinutes();
  return todaySlots.some((slot) => {
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

function resolveLimits(profOp, polOp, polSec, profSec, sysOp, orgOp, orgSec, webOp, webSec) {
  const getLimitCandidates = (key) => {
    if (key === 'maxAttemptsPerSession') {
      return [
        ['executionLimits', 'maxAttemptsPerSession'],
        // Backward-compat: some configs stored attempts in timeLimits.
        ['timeLimits', 'maxAttemptsPerSession'],
        [null, 'maxAttemptsPerSession'],
        // Backward-compat: some access-definition editors used legacy naming.
        [null, 'sessionAttempts']
      ];
    }
    if (key === 'maxSessionDurationMinutes') {
      return [
        ['timeLimits', 'maxSessionDurationMinutes'],
        [null, 'maxSessionDurationMinutes'],
        [null, 'sessionTime']
      ];
    }
    if (key === 'maxFetchUploadVolumeKB') {
      return [
        ['throughputLimits', 'maxFetchVolumeKB'],
        ['throughputLimits', 'maxFetchUploadVolumeKB'],
        [null, 'maxFetchUploadVolumeKB'],
        [null, 'maxFetchVolumeKB']
      ];
    }
    return [[null, key]];
  };

  const getLimit = (obj, key) => {
    if (!obj) return undefined;
    if ((obj.accessType === 'full_access' || obj.adminAccess) && !obj.isLayered) return null;
    const candidates = getLimitCandidates(key);
    for (const [category, field] of candidates) {
      let value;
      if (category) value = obj?.[category]?.[field];
      else value = obj?.[field];
      if (value !== undefined && value !== null) return value;
    }
    return undefined;
  };

  const getVal = (key) => {
    if (webOp) { const val = getLimit({ ...webOp, isLayered: true }, key); if (val !== undefined) return val; }
    if (webSec) { const val = getLimit({ ...webSec, isLayered: true }, key); if (val !== undefined) return val; }

    if (orgOp) { const val = getLimit({ ...orgOp, isLayered: true }, key); if (val !== undefined) return val; }
    if (orgSec) { const val = getLimit({ ...orgSec, isLayered: true }, key); if (val !== undefined) return val; }

    if (polOp) { const val = getLimit(polOp, key); if (val !== undefined) return val; }
    if (polSec) { const val = getLimit(polSec, key); if (val !== undefined) return val; }

    if (profOp) { const val = getLimit(profOp, key); if (val !== undefined) return val; }
    if (profSec) { const val = getLimit(profSec, key); if (val !== undefined) return val; }

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
