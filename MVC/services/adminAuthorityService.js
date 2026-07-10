const { SYSTEM_CONTEXT } = require('../../config/constants');
const { idsEqual, toPublicId } = require('../utils/idAdapter');
const effectiveAccessResolverService = require('./security/effectiveAccessResolverService');
const { resolveEntity } = require('../utils/entityResolver');

const EMPTY_AUTHORITY = Object.freeze({
  isSuperAdmin: false,
  isSystemAdmin: false,
  isCategoryAdminForSection: false,
  isGrantAdminAccessForSection: false,
  isOperationAdminForRequest: false,
  isSectionAdmin: false,
  isRequestAdmin: false,
  reasons: []
});

function normalizeAccessLevel(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function normalizeToken(value) {
  return String(value || '').trim();
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function normalizeCategory(value) {
  if (value && typeof value === 'object') {
    return normalizeToken(value.category || value.categoryId || value.id || value.value || value.name).toUpperCase();
  }
  return normalizeToken(value).toUpperCase();
}

function normalizeAccessType(value, fallback = 'custom') {
  const token = normalizeToken(value).toLowerCase();
  if (!token) return fallback;
  if (token === 'full_access') return 'full_access';
  if (token === 'full_ban') return 'full_ban';
  if (token === 'custom') return 'custom';
  return fallback;
}

function getActiveProfile(user) {
  const profile = user?.activeProfile;
  if (!profile || typeof profile !== 'object') return null;
  if (profile.active === false) return null;
  return profile;
}

function getActivePolicy(user) {
  const policy = user?.activePolicy;
  if (!policy || typeof policy !== 'object') return null;
  if (policy.active === false) return null;
  return policy;
}

function profileAppliesToOrg(profile, user, orgId) {
  if (!profile) return false;
  const profileOrgId = toPublicId(profile.orgId);
  if (!profileOrgId) return true;
  const targetOrgId = toPublicId(orgId || user?.activeOrgId);
  if (!targetOrgId) return true;
  return idsEqual(profileOrgId, targetOrgId);
}

function policyAppliesToOrg(policy, user, orgId) {
  if (!policy) return false;
  const policyOrgId = toPublicId(policy.orgId);
  if (!policyOrgId) return true;
  const targetOrgId = toPublicId(orgId || user?.activeOrgId);
  if (!targetOrgId) return true;
  return idsEqual(policyOrgId, targetOrgId);
}

function getActiveOrgPolicy(user, orgId) {
  const policy = user?.activeOrgPolicy;
  if (!policy || typeof policy !== 'object') return null;
  if (policy.active === false) return null;
  return policyAppliesToOrg(policy, user, orgId) ? policy : null;
}

function getTargetSectionId(sectionId, section) {
  return normalizeToken(section?.id || sectionId);
}

function getTargetCategory(section) {
  return normalizeCategory(section?.category || section?.categoryId || section?.group || '');
}

function sectionHasCategory(section) {
  return Boolean(getTargetCategory(section));
}

async function resolveSectionForAuthority(sectionId, section) {
  if (sectionHasCategory(section)) return section;
  const targetSectionId = getTargetSectionId(sectionId, section);
  if (!targetSectionId) return section || null;
  try {
    const resolvedSection = await resolveEntity('sections', targetSectionId);
    return resolvedSection || section || null;
  } catch (_) {
    return section || null;
  }
}

function getSectionConfig(rows, sectionId) {
  if (!Array.isArray(rows) || !sectionId) return null;
  return rows.find((row) => {
    const candidate = row?.sectionId || row?.id || row?.section || row?.sectionKey;
    return idsEqual(candidate, sectionId);
  }) || null;
}

function getOperationConfig(rows, operationId) {
  if (!Array.isArray(rows) || !operationId) return null;
  return rows.find((row) => {
    const candidate = row?.operationId || row?.id || row?.operation || row?.operationKey;
    return idsEqual(candidate, operationId);
  }) || null;
}

function normalizeTargetUserIds(values = []) {
  const list = Array.isArray(values) ? values : [];
  const out = [];
  const seen = new Set();
  list.forEach((value) => {
    const id = toPublicId(value);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function orgPolicySectionTargetsUser(sectionConfig = null, userId = '') {
  if (!sectionConfig || typeof sectionConfig !== 'object') return false;
  const targetUserIds = normalizeTargetUserIds(sectionConfig.targetUserIds || []);
  if (!targetUserIds.length) return true;
  const targetUserId = toPublicId(userId);
  if (!targetUserId) return false;
  return targetUserIds.some((item) => idsEqual(item, targetUserId));
}

function getTargetedOrgPolicySection(orgPolicy = null, sectionId = '', userId = '') {
  if (!orgPolicy || typeof orgPolicy !== 'object') return null;
  const sectionConfig = getSectionConfig(orgPolicy.sections, sectionId);
  if (!sectionConfig) return null;
  return orgPolicySectionTargetsUser(sectionConfig, userId) ? sectionConfig : null;
}

function hasAdminCategory(profile, category) {
  if (!profile || !category || !Array.isArray(profile.adminCategories)) return false;
  return profile.adminCategories
    .map(normalizeCategory)
    .filter(Boolean)
    .includes(category);
}

function isSuperAdmin(user) {
  if (user === SYSTEM_CONTEXT) return true;
  if (!user) return false;
  const userId = String(user.id || user.userId || user._id || '').trim();
  const userEmail = String(user.email || '').trim().toLowerCase();
  const username = String(user.username || '').trim().toLowerCase();
  const legacyRootIds = new Set(['ROOT_001', 'SYS_ROOT_001']);
  const userIsRoot = idsEqual(userId, 'ROOT_001') || idsEqual(userId, 'SYS_ROOT_001') || legacyRootIds.has(userId.toUpperCase());
  const userIsNamedRoot = username === 'amin' || userEmail === 'apaknejad@equilibrium.ab.ca';
  const accessLevel = normalizeAccessLevel(user.accessLevel, 0);
  return Boolean(
    user.isVirtualSuperAdmin === true ||
    user.isSuperAdmin === true ||
    accessLevel >= 10 ||
    userIsRoot ||
    userIsNamedRoot
  );
}

function isOperationConfigAdminSync(operationConfig = null) {
  if (!operationConfig || typeof operationConfig !== 'object') return false;
  if (normalizeBoolean(operationConfig.adminAccess, false)) return true;
  if (normalizeAccessType(operationConfig.accessType, 'custom') === 'full_access') return true;
  const scopeToken = normalizeToken(
    operationConfig.scopeId
    || operationConfig.scope
    || operationConfig.scopeKey
    || operationConfig.scopeName
    || ''
  );
  if (!scopeToken) return false;
  return effectiveAccessResolverService.isAdminScopeSync(scopeToken);
}

/**
 * True when the hydrated session user has any admin privilege on their active profile:
 * super/system (fullAdmin), category admin, section adminAccess, or operation admin.
 */
function hasAnyAdminPrivilege(user, orgId) {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;

  const profile = getActiveProfile(user);
  if (!profileAppliesToOrg(profile, user, orgId)) {
    return isSystemAdmin(user, orgId ? { orgId } : undefined);
  }

  if (normalizeBoolean(profile.fullAdmin, false)) return true;

  const categories = Array.isArray(profile.adminCategories) ? profile.adminCategories : [];
  if (categories.map(normalizeCategory).some(Boolean)) return true;

  const sections = Array.isArray(profile.sections) ? profile.sections : [];
  for (const section of sections) {
    if (!section || typeof section !== 'object') continue;
    if (normalizeBoolean(section.adminAccess, false)) return true;
    if (normalizeAccessType(section.accessType, 'custom') === 'full_access') return true;
    const operations = Array.isArray(section.operations) ? section.operations : [];
    for (const operation of operations) {
      if (isOperationConfigAdminSync(operation)) return true;
    }
  }

  return false;
}

function buildAuthorityPayload({
  superAdmin = false,
  systemAdmin = false,
  categoryAdmin = false,
  grantAdmin = false,
  operationAdmin = false,
  reasons = [],
  sectionId = '',
  operationId = '',
  category = ''
} = {}) {
  const dedupedReasons = Array.from(new Set((Array.isArray(reasons) ? reasons : []).filter(Boolean)));
  const sectionAdmin = Boolean(systemAdmin || categoryAdmin || grantAdmin);
  const requestAdmin = Boolean(superAdmin || sectionAdmin || operationAdmin);
  return {
    isSuperAdmin: Boolean(superAdmin),
    isSystemAdmin: Boolean(systemAdmin),
    isCategoryAdminForSection: Boolean(categoryAdmin),
    isGrantAdminAccessForSection: Boolean(grantAdmin),
    isOperationAdminForRequest: Boolean(operationAdmin),
    isSectionAdmin: sectionAdmin,
    isRequestAdmin: requestAdmin,
    reasons: dedupedReasons,
    sectionId: sectionId || null,
    operationId: operationId || null,
    category: category || null
  };
}

function resolveAdminAuthority({ user, sectionId, orgId, operationId, section } = {}) {
  if (!user) return { ...EMPTY_AUTHORITY };

  const reasons = [];
  const superAdmin = isSuperAdmin(user);
  if (superAdmin) reasons.push('SUPER_ADMIN');

  const profile = getActiveProfile(user);
  const policy = getActivePolicy(user);
  const orgPolicy = getActiveOrgPolicy(user, orgId);
  const profileInScope = profileAppliesToOrg(profile, user, orgId);
  const policyInScope = policyAppliesToOrg(policy, user, orgId);
  const targetSectionId = getTargetSectionId(sectionId, section);
  const targetCategory = getTargetCategory(section);
  const targetOperationId = normalizeToken(operationId);

  const systemAdmin = Boolean(profileInScope && normalizeBoolean(profile?.fullAdmin, false));
  if (systemAdmin) reasons.push('FULL_SYSTEM_ADMIN_PROFILE');

  let categoryAdmin = Boolean(profileInScope && targetCategory && hasAdminCategory(profile, targetCategory));

  const profileSection = getSectionConfig(profileInScope ? profile?.sections : null, targetSectionId);
  const policySection = getSectionConfig(policyInScope ? policy?.sections : null, targetSectionId);
  const orgPolicySection = getTargetedOrgPolicySection(orgPolicy, targetSectionId, user?.id);
  const policySectionAccessType = normalizeAccessType(policySection?.accessType, policySection ? 'custom' : 'none');
  const policySectionIsBan = policySectionAccessType === 'full_ban';
  const policySectionIsFullAccess = policySectionAccessType === 'full_access';
  const orgPolicySectionAccessType = normalizeAccessType(orgPolicySection?.accessType, orgPolicySection ? 'custom' : 'none');
  const orgPolicySectionIsBan = orgPolicySectionAccessType === 'full_ban';
  const orgPolicySectionIsFullAccess = orgPolicySectionAccessType === 'full_access';

  let grantAdmin = false;
  if (orgPolicySection) {
    grantAdmin = orgPolicySectionIsFullAccess;
  } else if (!policySectionIsBan) {
    grantAdmin = Boolean(policySectionIsFullAccess || normalizeBoolean(profileSection?.adminAccess, false));
  }
  if (policySectionIsBan || orgPolicySectionIsBan) {
    categoryAdmin = false;
  }
  if (categoryAdmin) reasons.push(`CATEGORY_ADMIN:${targetCategory}`);
  if (grantAdmin) reasons.push(`SECTION_ADMIN:${targetSectionId}`);
  if (policySectionIsFullAccess) reasons.push(`POLICY_SECTION_FULL_ACCESS:${targetSectionId}`);
  if (policySectionIsBan) reasons.push(`POLICY_SECTION_FULL_BAN:${targetSectionId}`);
  if (orgPolicySectionIsFullAccess) reasons.push(`ORG_POLICY_SECTION_FULL_ACCESS:${targetSectionId}`);
  if (orgPolicySectionIsBan) reasons.push(`ORG_POLICY_SECTION_FULL_BAN:${targetSectionId}`);

  const profileOperation = getOperationConfig(profileSection?.operations, targetOperationId);
  const policyOperation = getOperationConfig(policySection?.operations, targetOperationId);
  const orgPolicyOperation = getOperationConfig(orgPolicySection?.operations, targetOperationId);
  const policyOperationAccessType = normalizeAccessType(policyOperation?.accessType, policyOperation ? 'custom' : 'none');
  const policyOperationIsBan = policyOperationAccessType === 'full_ban';
  const policyOperationIsFullAccess = policyOperationAccessType === 'full_access';
  const orgPolicyOperationAccessType = normalizeAccessType(orgPolicyOperation?.accessType, orgPolicyOperation ? 'custom' : 'none');
  const orgPolicyOperationIsBan = orgPolicyOperationAccessType === 'full_ban';
  const orgPolicyOperationIsFullAccess = orgPolicyOperationAccessType === 'full_access';

  let operationAdmin = false;
  if (orgPolicySection) {
    if (orgPolicySectionIsBan) {
      operationAdmin = false;
    } else if (orgPolicySectionIsFullAccess) {
      operationAdmin = true;
    } else if (!targetOperationId) {
      operationAdmin = false;
    } else if (!orgPolicyOperation) {
      operationAdmin = false;
    } else if (orgPolicyOperationIsBan) {
      operationAdmin = false;
    } else if (orgPolicyOperationIsFullAccess) {
      operationAdmin = true;
    } else {
      operationAdmin = isOperationConfigAdminSync(orgPolicyOperation);
    }
  } else if (!policySectionIsBan) {
    if (policyOperationIsBan) {
      operationAdmin = false;
    } else if (policyOperationIsFullAccess) {
      operationAdmin = true;
    } else if (policyOperation) {
      operationAdmin = isOperationConfigAdminSync(policyOperation);
    } else {
      operationAdmin = isOperationConfigAdminSync(profileOperation);
    }
  }
  if (operationAdmin) reasons.push(`OPERATION_ADMIN:${targetSectionId}:${targetOperationId}`);
  if (policyOperationIsFullAccess) reasons.push(`POLICY_OPERATION_FULL_ACCESS:${targetSectionId}:${targetOperationId}`);
  if (policyOperationIsBan) reasons.push(`POLICY_OPERATION_FULL_BAN:${targetSectionId}:${targetOperationId}`);
  if (orgPolicyOperationIsFullAccess) reasons.push(`ORG_POLICY_OPERATION_FULL_ACCESS:${targetSectionId}:${targetOperationId}`);
  if (orgPolicyOperationIsBan) reasons.push(`ORG_POLICY_OPERATION_FULL_BAN:${targetSectionId}:${targetOperationId}`);

  return buildAuthorityPayload({
    superAdmin,
    systemAdmin,
    categoryAdmin,
    grantAdmin,
    operationAdmin,
    reasons,
    sectionId: targetSectionId,
    operationId: targetOperationId,
    category: targetCategory
  });
}

async function resolveAdminAuthorityAsync({ user, sectionId, orgId, operationId, section, effectiveAccess } = {}) {
  if (!user) return { ...EMPTY_AUTHORITY };

  const resolvedSection = await resolveSectionForAuthority(sectionId, section);
  const syncAuthority = resolveAdminAuthority({
    user,
    sectionId,
    orgId,
    operationId,
    section: resolvedSection || section
  });
  if (syncAuthority.isSuperAdmin) return syncAuthority;

  const resolvedEffective = effectiveAccess
    || await effectiveAccessResolverService.resolveEffectiveAccess({
      user,
      sectionId: syncAuthority.sectionId || sectionId,
      operationId: syncAuthority.operationId || operationId,
      orgId: orgId || user?.activeOrgId
    });

  const targetSectionId = syncAuthority.sectionId || getTargetSectionId(sectionId, section);
  const targetOperationId = syncAuthority.operationId || normalizeToken(operationId);
  const targetCategory = syncAuthority.category || getTargetCategory(resolvedSection || section);

  const sectionBanned = resolvedEffective?.section?.isBanned === true;
  const sectionAdminByEffective = resolvedEffective?.section?.isSectionAdmin === true;
  const operationAdminByEffective = resolvedEffective?.operation?.isOperationAdmin === true;

  let categoryAdmin = syncAuthority.isCategoryAdminForSection;
  let grantAdmin = syncAuthority.isGrantAdminAccessForSection;
  let operationAdmin = syncAuthority.isOperationAdminForRequest;
  const reasons = Array.isArray(syncAuthority.reasons) ? syncAuthority.reasons.slice() : [];

  if (sectionBanned) {
    categoryAdmin = false;
    grantAdmin = false;
    operationAdmin = false;
  } else {
    if (sectionAdminByEffective && !grantAdmin) {
      grantAdmin = true;
      reasons.push(`EFFECTIVE_SECTION_ADMIN:${targetSectionId}`);
    }
    if (operationAdminByEffective && !operationAdmin) {
      operationAdmin = true;
      reasons.push(`EFFECTIVE_OPERATION_ADMIN:${targetSectionId}:${targetOperationId}`);
    }
    if (!operationAdmin && resolvedEffective?.operation?.scopeId) {
      const isAdminScope = await effectiveAccessResolverService.isAdminScope(resolvedEffective.operation.scopeId);
      if (isAdminScope) {
        operationAdmin = true;
        reasons.push(`EFFECTIVE_ADMIN_SCOPE:${resolvedEffective.operation.scopeId}`);
      }
    }
  }

  return buildAuthorityPayload({
    superAdmin: syncAuthority.isSuperAdmin,
    systemAdmin: syncAuthority.isSystemAdmin,
    categoryAdmin,
    grantAdmin,
    operationAdmin,
    reasons,
    sectionId: targetSectionId,
    operationId: targetOperationId,
    category: targetCategory
  });
}

function isAdminForSection(user, sectionId, orgContext = {}) {
  return resolveAdminAuthority({
    user,
    sectionId,
    orgId: orgContext?.orgId,
    section: orgContext?.section
  }).isSectionAdmin || isSuperAdmin(user);
}

async function isAdminForSectionAsync(user, sectionId, orgContext = {}) {
  const authority = await resolveAdminAuthorityAsync({
    user,
    sectionId,
    orgId: orgContext?.orgId,
    section: orgContext?.section
  });
  return authority.isSectionAdmin || authority.isSuperAdmin;
}

function isAdminForRequest(user, sectionId, operationId, orgContext = {}) {
  return resolveAdminAuthority({
    user,
    sectionId,
    operationId,
    orgId: orgContext?.orgId,
    section: orgContext?.section
  }).isRequestAdmin;
}

async function isAdminForRequestAsync(user, sectionId, operationId, orgContext = {}) {
  const authority = await resolveAdminAuthorityAsync({
    user,
    sectionId,
    operationId,
    orgId: orgContext?.orgId,
    section: orgContext?.section
  });
  return authority.isRequestAdmin;
}

function isSystemAdmin(user, orgContext = {}) {
  return resolveAdminAuthority({
    user,
    orgId: orgContext?.orgId || user?.activeOrgId
  }).isSystemAdmin || isSuperAdmin(user);
}

function isOrgAdmin(user, orgContext = {}) {
  return isAdmin(user, orgContext);
}

async function isOrgAdminAsync(user, orgContext = {}) {
  return isAdminAsync(user, orgContext);
}

function isAdmin(user, orgContext = {}) {
  const targetSectionId = orgContext?.sectionId || orgContext?.section?.id || '';
  const targetOperationId = orgContext?.operationId || '';
  if (targetSectionId || orgContext?.section) {
    if (targetOperationId) {
      return isAdminForRequest(user, targetSectionId, targetOperationId, orgContext);
    }
    return isAdminForSection(user, targetSectionId, orgContext);
  }
  return isSystemAdmin(user, orgContext);
}

async function isAdminAsync(user, orgContext = {}) {
  const targetSectionId = orgContext?.sectionId || orgContext?.section?.id || '';
  const targetOperationId = orgContext?.operationId || '';
  if (targetSectionId || orgContext?.section) {
    if (targetOperationId) {
      return isAdminForRequestAsync(user, targetSectionId, targetOperationId, orgContext);
    }
    return isAdminForSectionAsync(user, targetSectionId, orgContext);
  }
  return isSystemAdmin(user, orgContext);
}

module.exports = {
  resolveAdminAuthority,
  resolveAdminAuthorityAsync,
  isSuperAdmin,
  isAdmin,
  isAdminAsync,
  isSystemAdmin,
  isOrgAdmin,
  isOrgAdminAsync,
  isAdminForSection,
  isAdminForSectionAsync,
  isAdminForRequest,
  isAdminForRequestAsync,
  hasAnyAdminPrivilege
};
