(function registerGenericPickerContexts(global) {
  function getCurrentUser() {
    return global.__GENERIC_PICKER_USER__ || null;
  }

  function pickIcon(icon, fallback) {
    return icon || fallback;
  }

  function literal(label, value, icon) {
    return {
      label: label || 'Context',
      value: value ?? null,
      icon: icon || 'bi bi-search'
    };
  }

  function listOf(value, icon) {
    return literal('List of', value, pickIcon(icon, 'bi bi-collection fs-4'));
  }

  function scope(value, icon) {
    return literal('Scope', value, pickIcon(icon, 'bi bi-building fs-4'));
  }

  function system(value, icon) {
    return literal('System', value, pickIcon(icon, 'bi bi-globe'));
  }

  function findActiveOrg(userData) {
    if (!userData || !userData.activeOrgId || !Array.isArray(userData.allowedOrgs)) return null;
    return userData.allowedOrgs.find((org) => String(org.orgId) === String(userData.activeOrgId)) || null;
  }

  function activeOrganizationScope(options) {
    const opts = options || {};
    const userData = opts.user || getCurrentUser();
    const activeOrg = findActiveOrg(userData);
    return {
      label: opts.label || 'Active Organization Scope',
      orgId: opts.orgId || activeOrg?.orgId || null,
      orgName: opts.orgName || activeOrg?.name || '',
      value: Object.prototype.hasOwnProperty.call(opts, 'value') ? opts.value : null,
      icon: pickIcon(opts.icon, 'bi bi-building fs-4')
    };
  }

  function orgScope(orgLike, options) {
    const org = orgLike || {};
    const opts = options || {};
    return {
      label: opts.label || 'Target Organization',
      orgId: opts.orgId || org.orgId || org.id || null,
      orgName: opts.orgName || org.name || org.orgName || org.organizationName || '',
      value: Object.prototype.hasOwnProperty.call(opts, 'value') ? opts.value : null,
      icon: pickIcon(opts.icon, 'bi bi-building fs-4')
    };
  }

  function organizationSpecificPolicy() {
    return scope('Organization-Specific Policy', 'bi bi-building fs-4');
  }

  function globalSystemProfiles() {
    return scope('Global / System Profiles', 'bi bi-globe fs-4');
  }

  function allUsers() {
    return system('All Users', 'bi bi-globe');
  }

  function allOrganizations() {
    return listOf('All Registered Organizations', 'bi bi-building fs-4');
  }

  function allAccessProfiles() {
    return listOf('All Registered Access Profiles Templates', 'bi bi-building fs-4');
  }

  function allSections() {
    return scope('All Sections', 'bi bi-building');
  }

  function allRegisteredSections() {
    return listOf('All Registered Sections', 'bi bi-building fs-4');
  }

  function allOperations() {
    return scope('All Operations', 'bi bi-gear');
  }

  function allRegisteredOperations() {
    return listOf('All Registered Operations', 'bi bi-grid fs-4');
  }

  function allGroups() {
    return scope('All Groups', 'bi bi-building');
  }

  global.GenericPickerContexts = {
    activeOrganizationScope,
    allAccessProfiles,
    allGroups,
    allOperations,
    allOrganizations,
    allRegisteredOperations,
    allRegisteredSections,
    allSections,
    allUsers,
    globalSystemProfiles,
    listOf,
    literal,
    orgScope,
    organizationSpecificPolicy,
    scope,
    system
  };
})(typeof window !== 'undefined' ? window : globalThis);
