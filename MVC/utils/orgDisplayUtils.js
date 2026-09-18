function userCanUseSystemOrgContext(user = {}) {
  return Boolean(
    user.isVirtualSuperAdmin
    || String(user.systemAccessProfileId || '').trim()
    || String(user.currentProfileMode || '').trim().toUpperCase() === 'SYSTEM'
  );
}

function findOrgInAllowed(user, orgId) {
  const orgs = Array.isArray(user?.allowedOrgs) ? user.allowedOrgs : [];
  const target = String(orgId || '').trim();
  if (!target) return null;
  return orgs.find((org) => String(org?.orgId || '').trim() === target) || null;
}

function resolveActiveOrgDisplay(user = {}) {
  const orgs = Array.isArray(user?.allowedOrgs) ? user.allowedOrgs : [];
  const activeOrgId = String(user?.activeOrgId || '').trim();
  const systemOrgUser = userCanUseSystemOrgContext(user);

  if (activeOrgId === 'SYSTEM') {
    if (systemOrgUser) {
      const sys = findOrgInAllowed(user, 'SYSTEM');
      return {
        orgId: 'SYSTEM',
        name: sys?.name || 'System / Global',
        role: Array.isArray(sys?.roles) && sys.roles.length ? sys.roles.join(', ') : (sys?.role || 'System Admin')
      };
    }
    const fallback = orgs.find((org) => {
      const id = String(org?.orgId || '').trim();
      return id && id !== 'SYSTEM' && org?.isSelectable !== false;
    });
    if (fallback) {
      return {
        orgId: String(fallback.orgId),
        name: fallback.name || fallback.orgName || fallback.organizationName || `Org ${fallback.orgId}`,
        role: Array.isArray(fallback.roles) && fallback.roles.length ? fallback.roles.join(', ') : (fallback.role || 'Member')
      };
    }
  }

  if (activeOrgId) {
    const matched = findOrgInAllowed(user, activeOrgId);
    return {
      orgId: activeOrgId,
      name: matched?.name || matched?.orgName || matched?.organizationName || `Org ${activeOrgId}`,
      role: Array.isArray(matched?.roles) && matched.roles.length ? matched.roles.join(', ') : (matched?.role || 'Member')
    };
  }

  if (systemOrgUser) {
    const sys = findOrgInAllowed(user, 'SYSTEM');
    return {
      orgId: 'SYSTEM',
      name: sys?.name || 'System / Global',
      role: Array.isArray(sys?.roles) && sys.roles.length ? sys.roles.join(', ') : (sys?.role || 'System Admin')
    };
  }

  const firstSelectable = orgs.find((org) => {
    const id = String(org?.orgId || '').trim();
    return id && id !== 'SYSTEM' && org?.isSelectable !== false;
  });
  if (firstSelectable) {
    return {
      orgId: String(firstSelectable.orgId),
      name: firstSelectable.name || firstSelectable.orgName || firstSelectable.organizationName || `Org ${firstSelectable.orgId}`,
      role: Array.isArray(firstSelectable.roles) && firstSelectable.roles.length
        ? firstSelectable.roles.join(', ')
        : (firstSelectable.role || 'Member')
    };
  }

  return { orgId: '', name: 'No organization', role: 'Member' };
}

module.exports = {
  userCanUseSystemOrgContext,
  findOrgInAllowed,
  resolveActiveOrgDisplay
};
