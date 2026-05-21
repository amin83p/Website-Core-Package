(function initGenericPickerCore(global) {
  const registry = new Map();

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toLabel(value) {
    return String(value || '')
      .replace(/[_-]+/g, ' ')
      .split(' ')
      .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
      .join(' ')
      .trim();
  }

  function truncate(value, maxLength) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.slice(0, Math.max(0, maxLength - 3)).trimEnd() + '...';
  }

  function getEntityDisplayName(item) {
    const firstName = item?.name?.first || item?.firstName || '';
    const lastName = item?.name?.last || item?.lastName || '';
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;
    if (typeof item?.name === 'string') return String(item.name).trim();
    if (typeof item?.displayName === 'string') return String(item.displayName).trim();
    if (typeof item?.title === 'string') return String(item.title).trim();
    return '';
  }

  function getPrimaryEmail(item) {
    if (item?.email) return String(item.email);
    const emails = Array.isArray(item?.contact?.emails) ? item.contact.emails : [];
    const primary = emails.find((entry) => entry && entry.isPrimary && entry.email);
    return String(primary?.email || emails[0]?.email || '').trim();
  }

  function getFirstPhone(item) {
    const phones = Array.isArray(item?.contact?.phones) ? item.contact.phones : [];
    return String(phones[0]?.number || item?.phone || '').trim();
  }

  function getRoleList(item) {
    if (Array.isArray(item?.roles) && item.roles.length) {
      return item.roles.map((role) => String(role || '').trim()).filter(Boolean);
    }

    if (Array.isArray(item?.organizations)) {
      const roles = [];
      item.organizations.forEach((org) => {
        const orgRoles = Array.isArray(org?.roles) && org.roles.length ? org.roles : (org?.role ? [org.role] : []);
        orgRoles.forEach((role) => {
          const cleanRole = String(role || '').trim();
          if (cleanRole && !roles.includes(cleanRole)) roles.push(cleanRole);
        });
      });
      return roles;
    }

    if (item?.role) return [String(item.role).trim()].filter(Boolean);
    return [];
  }

  function getOrgInfo(item, resource) {
    if (resource === 'organizations' || resource === 'organization') {
      return {
        id: item?.id || '',
        name: item?.identity?.displayName || item?.name || item?.identity?.legalName || ''
      };
    }

    if (item?.orgId || item?.orgName) {
      return {
        id: item.orgId || '',
        name: item.orgName || item.organizationName || item.organizationDisplayName || (item.orgId ? `Org ${item.orgId}` : '')
      };
    }

    if (item?.organization && (item.organization.orgId || item.organization.id || item.organization.name)) {
      return {
        id: item.organization.orgId || item.organization.id || '',
        name: item.organization.name || item.organization.orgName || item.organization.displayName || ''
      };
    }

    if (Array.isArray(item?.organizations) && item.organizations.length) {
      const org = item.organizations[0] || {};
      return {
        id: org.orgId || org.id || '',
        name: org.name || org.orgName || ''
      };
    }

    return null;
  }

  function resolveResourceName(resourceOrEndpoint) {
    if (!resourceOrEndpoint || typeof resourceOrEndpoint !== 'string') return '';
    const withoutOrigin = resourceOrEndpoint.replace(/^[a-z]+:\/\/[^/]+/i, '');
    const trimmed = withoutOrigin.replace(/^\/+/, '');
    const parts = trimmed.split(/[/?#]/).filter(Boolean);
    return String(parts[parts.length - 1] || '').toLowerCase();
  }

  function registerProfile(resources, definition) {
    const list = Array.isArray(resources) ? resources : [resources];
    list.forEach((resource) => {
      const normalized = resolveResourceName(resource);
      if (normalized) registry.set(normalized, definition || {});
    });
  }

  function getProfile(resource) {
    return registry.get(resolveResourceName(resource)) || null;
  }

  function defaultTitle(resource, item) {
    if (resource === 'persons' || resource === 'person' || resource === 'teachers' || resource === 'teacher' || resource === 'students' || resource === 'student' || resource === 'staff') {
      const fullName = getEntityDisplayName(item);
      return fullName || item?.name || item?.displayName || item?.id || 'Unnamed';
    }

    if (resource === 'users' || resource === 'user') {
      return item?.name || item?.username || item?.email || item?.id || 'Unnamed User';
    }

    if (resource === 'organizations' || resource === 'organization') {
      return item?.identity?.displayName || item?.name || item?.identity?.legalName || item?.id || 'Unknown Organization';
    }

    return getEntityDisplayName(item) || item?.identity?.displayName || item?.id || 'Untitled';
  }

  function defaultSummary(resource, item) {
    const description = String(item?.description || item?.summary || item?.notes || '').trim();
    if (description) return truncate(description, 110);

    if (resource === 'persons' || resource === 'person' || resource === 'teachers' || resource === 'teacher' || resource === 'students' || resource === 'student' || resource === 'staff') {
      const email = getPrimaryEmail(item);
      const roles = getRoleList(item).map(toLabel);
      const roleSummary = roles.length ? `Roles: ${roles.join(', ')}` : '';
      if (email && roleSummary) return truncate(`${email} | ${roleSummary}`, 110);
      if (email) return truncate(email, 110);
      if (roleSummary) return truncate(roleSummary, 110);
      const phone = getFirstPhone(item);
      return phone || 'No contact summary';
    }

    if (resource === 'users' || resource === 'user') {
      const email = getPrimaryEmail(item);
      const status = String(item?.status || '').trim();
      if (email && status) return truncate(`${email} | Status: ${toLabel(status)}`, 110);
      return email || (status ? `Status: ${toLabel(status)}` : 'No summary');
    }

    if (resource === 'organizations' || resource === 'organization') {
      return truncate(item?.identity?.legalName || item?.legalName || item?.description || 'Organization record', 110);
    }

    if (resource === 'accesses' || resource === 'access') {
      if (item?.fullAdmin) return 'Full admin access profile';
      const sectionCount = Array.isArray(item?.sections) ? item.sections.length : 0;
      return `${sectionCount} configured section${sectionCount === 1 ? '' : 's'}`;
    }

    if (resource === 'operations' || resource === 'operation') {
      return `System operation: ${item?.system ? 'Yes' : 'No'}`;
    }

    return truncate(item?.email || item?.title || item?.subtitle || 'No summary', 110);
  }

  function defaultStatusBadge(resource, item) {
    if (resource === 'users' || resource === 'user') {
      const status = String(item?.status || '').trim();
      if (!status) return '';
      const badgeClass = status === 'active' ? 'bg-success' : (status === 'pending' ? 'bg-warning text-dark' : 'bg-secondary');
      return `<span class="badge ${badgeClass} rounded-pill mb-1">${escapeHtml(toLabel(status))}</span>`;
    }

    if (typeof item?.active === 'boolean') {
      const badgeClass = item.active ? 'bg-success-subtle text-success-emphasis border' : 'bg-secondary-subtle text-secondary-emphasis border';
      return `<span class="badge ${badgeClass} mb-1">${item.active ? 'Active' : 'Inactive'}</span>`;
    }

    return '';
  }

  function defaultOrgMeta(resource, item) {
    const org = getOrgInfo(item, resource);
    if (org && (org.id || org.name)) {
      const name = escapeHtml(org.name || `Org ${org.id}`);
      const id = escapeHtml(org.id || '-');
      return `<div class="x-small text-secondary mt-1"><i class="bi bi-building me-1"></i>${name} <span class="font-monospace">(#${id})</span></div>`;
    }

    if (resource === 'accesses' || resource === 'access') {
      return `<div class="x-small text-secondary mt-1"><i class="bi bi-globe2 me-1"></i>Scope: Global / System</div>`;
    }

    return '';
  }

  function defaultIcon(resource) {
    return 'bi-search';
  }

  function renderResourceCard(resourceOrEndpoint, item) {
    const resource = resolveResourceName(resourceOrEndpoint);
    const profile = getProfile(resource) || {};
    const helpers = {
      escapeHtml,
      getFirstPhone,
      getOrgInfo,
      getPrimaryEmail,
      getRoleList,
      toLabel,
      truncate
    };

    const title = escapeHtml((profile.getTitle ? profile.getTitle(item, helpers) : defaultTitle(resource, item)) || 'Untitled');
    const summaryText = (profile.getSummary ? profile.getSummary(item, helpers) : defaultSummary(resource, item)) || 'No summary available';
    const summary = escapeHtml(summaryText);
    const statusBadge = profile.getStatusBadge ? profile.getStatusBadge(item, helpers) : defaultStatusBadge(resource, item);
    const orgMeta = profile.getOrgMeta ? profile.getOrgMeta(item, helpers) : defaultOrgMeta(resource, item);
    const iconClass = profile.icon || defaultIcon(resource);
    const itemId = escapeHtml(item?.id || item?.code || '-');

    return `
      <div class="d-flex justify-content-between align-items-center w-100 gap-3">
        <div class="d-flex align-items-center gap-3 flex-grow-1 overflow-hidden">
          <div class="rounded bg-white border d-flex align-items-center justify-content-center shadow-sm text-primary flex-shrink-0" style="width: 42px; height: 42px;">
            <i class="bi ${iconClass} fs-5"></i>
          </div>
          <div class="overflow-hidden">
            <div class="fw-bold text-dark text-truncate">${title}</div>
            <div class="text-muted small text-truncate" style="max-width: 420px;" title="${summary}">${summary}</div>
            ${orgMeta}
          </div>
        </div>
        <div class="text-end flex-shrink-0">
          ${statusBadge}
          <div class="badge bg-light text-secondary border font-monospace" style="font-size: 0.65rem;">ID: ${itemId}</div>
        </div>
      </div>
    `;
  }

  function formatContextValue(context, userData) {
    if (!context) return 'Global';

    const allowedOrgs = Array.isArray(userData?.allowedOrgs) ? userData.allowedOrgs : [];
    const findAllowedOrg = (id) => allowedOrgs.find((org) => String(org.orgId) === String(id));
    const isGenericOrgLabel = (value, id) => {
      const normalized = String(value || '').trim().toLowerCase();
      const generic = `org ${String(id || '').trim()}`.toLowerCase();
      const genericHash = `org #${String(id || '').trim()}`.toLowerCase();
      return normalized === generic || normalized === genericHash;
    };

    const explicitName = context.orgName || context.name || '';
    const explicitId = context.orgId || context.id || '';
    if (explicitName || explicitId) {
      const matchedOrg = explicitId ? findAllowedOrg(explicitId) : null;
      const preferredName = matchedOrg?.name && (!explicitName || isGenericOrgLabel(explicitName, explicitId))
        ? matchedOrg.name
        : explicitName;
      const name = preferredName || `Org ${explicitId}`;
      return explicitId ? `${name} (#${explicitId})` : name;
    }

    if (context.value && typeof context.value === 'object') {
      const objName = context.value.name || context.value.orgName || '';
      const objId = context.value.orgId || context.value.id || '';
      if (objName || objId) {
        const matchedOrg = objId ? findAllowedOrg(objId) : null;
        const preferredName = matchedOrg?.name && (!objName || isGenericOrgLabel(objName, objId))
          ? matchedOrg.name
          : objName;
        const name = preferredName || `Org ${objId}`;
        return objId ? `${name} (#${objId})` : name;
      }
    }

    const rawValue = String(context.value || '').trim();
    if (rawValue) {
      const matchedOrg = allowedOrgs.find((org) => String(org.orgId) === rawValue);
      if (matchedOrg) {
        const name = matchedOrg.name || `Org ${matchedOrg.orgId}`;
        return `${name} (#${matchedOrg.orgId})`;
      }
      return rawValue;
    }

    if (userData?.activeOrgId && Array.isArray(userData?.allowedOrgs)) {
      const activeOrg = userData.allowedOrgs.find((org) => String(org.orgId) === String(userData.activeOrgId));
      if (activeOrg) {
        const name = activeOrg.name || `Org ${activeOrg.orgId}`;
        return `${name} (#${activeOrg.orgId})`;
      }
    }

    return 'System / Global';
  }

  global.GenericPickerCore = {
    escapeHtml,
    formatContextValue,
    registerProfile,
    renderResourceCard,
    resolveResourceName,
    utils: {
      getFirstPhone,
      getOrgInfo,
      getPrimaryEmail,
      getRoleList,
      toLabel,
      truncate
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
