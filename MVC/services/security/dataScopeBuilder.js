const adminChekersService = require('../adminChekersService');
const { toPublicId, toIdArray } = require('../../utils/idAdapter');
const effectiveAccessResolverService = require('./effectiveAccessResolverService');

function buildPersonScope(requestingUser) {
  if (!requestingUser) return { canViewAll: true };
  if (adminChekersService.isSuperAdmin(requestingUser)) return { canViewAll: true };

  const allowedPersonIds = Array.isArray(requestingUser?.allowedPersonIds)
    ? toIdArray(requestingUser.allowedPersonIds)
    : [];

  if (allowedPersonIds.length > 0) {
    return { canViewAll: false, personIds: allowedPersonIds };
  }

  return { canViewAll: true };
}

function buildOrganizationScope(requestingUser) {
  if (!requestingUser) return { canViewAll: false, orgIds: [] };
  if (adminChekersService.isSuperAdmin(requestingUser) || adminChekersService.isAdmin(requestingUser)) {
    return { canViewAll: true };
  }

  const allowedOrgIds = Array.isArray(requestingUser?.allowedOrgs)
    ? toIdArray(requestingUser.allowedOrgs.map((item) => item?.orgId))
    : [];

  if (allowedOrgIds.length > 0) return { canViewAll: false, orgIds: allowedOrgIds };

  const activeOrgId = toPublicId(requestingUser?.activeOrgId) || null;
  if (activeOrgId) return { canViewAll: false, orgIds: [activeOrgId] };

  return { canViewAll: false, orgIds: [] };
}

function buildSectionScope(requestingUser) {
  if (!requestingUser) return { canViewAll: false, categories: [], sectionIds: [] };
  if (adminChekersService.isSuperAdmin(requestingUser)) return { canViewAll: true };

  const profile = requestingUser?.activeProfile;
  const policy = requestingUser?.activePolicy;
  if (!profile && !policy) return { canViewAll: false, categories: [], sectionIds: [] };
  if (adminChekersService.isAdmin(requestingUser)) return { canViewAll: true };

  const categories = Array.isArray(profile?.adminCategories) ? profile.adminCategories : [];
  const profileSectionIds = Array.isArray(profile?.sections)
    ? toIdArray(profile.sections.map((item) => item?.sectionId))
    : [];
  const scopeOverrides = effectiveAccessResolverService.resolvePolicySectionScopeOverrides(requestingUser);
  const policyGrantedSectionIds = Array.isArray(scopeOverrides?.grantedSectionIds)
    ? toIdArray(scopeOverrides.grantedSectionIds)
    : [];
  const policyBannedSectionIds = Array.isArray(scopeOverrides?.bannedSectionIds)
    ? toIdArray(scopeOverrides.bannedSectionIds)
    : [];
  const sectionIds = Array.from(new Set([...profileSectionIds, ...policyGrantedSectionIds]));
  const excludedSectionIds = Array.from(new Set(policyBannedSectionIds));

  return { canViewAll: false, categories, sectionIds, excludedSectionIds };
}

function buildAccessScope(requestingUser) {
  if (!requestingUser) return { canViewAll: false, includeGlobal: false, orgId: null };
  if (adminChekersService.isSuperAdmin(requestingUser)) return { canViewAll: true };

  return {
    canViewAll: false,
    includeGlobal: true,
    orgId: toPublicId(requestingUser?.activeOrgId) || null
  };
}

function buildAccessPolicyScope(requestingUser) {
  if (!requestingUser) return { canViewAll: false, userIds: [] };
  if (adminChekersService.isSuperAdmin(requestingUser)) return { canViewAll: true };

  // Existing behavior exposes all users to non-super admins in this app version.
  return { canViewAll: true };
}

function buildTableSettingsScope(requestingUser) {
  if (!requestingUser) return { canViewAll: false, userId: null };
  if (adminChekersService.isSuperAdmin(requestingUser)) return { canViewAll: true };
  return { canViewAll: false, userId: toPublicId(requestingUser?.id) };
}

function buildOrgPolicyScope(requestingUser) {
  if (!requestingUser) return { canViewAll: false, orgIds: [] };
  if (adminChekersService.isSuperAdmin(requestingUser)) return { canViewAll: true };

  const activeOrgId = toPublicId(requestingUser?.activeOrgId) || null;
  if (!activeOrgId) return { canViewAll: false, orgIds: [] };

  return { canViewAll: false, orgIds: [activeOrgId] };
}

function buildSymbolScope(requestingUser) {
  if (!requestingUser) return { canViewAll: false, includeGlobal: false, orgId: null };
  if (adminChekersService.isSuperAdmin(requestingUser)) return { canViewAll: true };

  return {
    canViewAll: false,
    includeGlobal: true,
    orgId: toPublicId(requestingUser?.activeOrgId) || null
  };
}

function buildSessionScope(requestingUser) {
  if (!requestingUser || adminChekersService.isSuperAdmin(requestingUser)) return { canViewAll: true };
  return { canViewAll: false, userId: toPublicId(requestingUser?.id) };
}

function buildContactScope(requestingUser) {
  if (!requestingUser) return { canViewAll: false, isAuthenticated: false };
  return { canViewAll: true, isAuthenticated: true };
}

function buildNewsletterScope(requestingUser) {
  if (!requestingUser) return { canViewAll: false, isAuthenticated: false };
  return { canViewAll: true, isAuthenticated: true };
}

function buildSubscriptionGroupScope(requestingUser) {
  if (!requestingUser) return { canViewAll: false, orgIds: [] };
  if (adminChekersService.isSuperAdmin(requestingUser)) return { canViewAll: true };

  const activeOrgId = toPublicId(requestingUser?.activeOrgId) || null;
  if (!activeOrgId) return { canViewAll: false, orgIds: [] };

  return { canViewAll: false, orgIds: [activeOrgId] };
}

function buildNewsScope(requestingUser) {
  if (adminChekersService.isSuperAdmin(requestingUser)) {
    return {
      canViewAll: true,
      isAuthenticated: Boolean(requestingUser),
      activeOrgId: requestingUser?.activeOrgId || null
    };
  }

  return {
    canViewAll: false,
    isAuthenticated: Boolean(requestingUser),
    activeOrgId: requestingUser?.activeOrgId || null
  };
}

function buildUserMembershipScope(requestingUser) {
  if (!requestingUser) return { canViewAll: false, includeGlobal: false, orgId: null, userId: null };
  if (adminChekersService.isSuperAdmin(requestingUser)) return { canViewAll: true };

  const activeOrgId = toPublicId(requestingUser?.activeOrgId);
  const userId = toPublicId(requestingUser?.id);
  return {
    canViewAll: false,
    includeGlobal: Boolean(activeOrgId),
    orgId: activeOrgId || null,
    userId: userId || null
  };
}

function buildEmailManagementTemplateScope(requestingUser) {
  if (!requestingUser) return { canViewAll: false, orgIds: [] };
  if (adminChekersService.isSuperAdmin(requestingUser)) return { canViewAll: true };

  const activeOrgId = toPublicId(requestingUser?.activeOrgId);
  if (!activeOrgId) return { canViewAll: false, orgIds: [] };
  return { canViewAll: false, orgIds: [activeOrgId] };
}

module.exports = {
  buildPersonScope,
  buildOrganizationScope,
  buildSectionScope,
  buildAccessScope,
  buildAccessPolicyScope,
  buildTableSettingsScope,
  buildOrgPolicyScope,
  buildSymbolScope,
  buildSessionScope,
  buildContactScope,
  buildNewsletterScope,
  buildSubscriptionGroupScope,
  buildNewsScope,
  buildUserMembershipScope,
  buildEmailManagementTemplateScope
};
