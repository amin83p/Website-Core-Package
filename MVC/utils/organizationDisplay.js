const { toPublicId } = require('./idAdapter');

function normalizeOrgId(value) {
  return toPublicId(value);
}

function firstNonBlank(values = []) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function resolveCanonicalOrganizationName(org = {}, fallbackName = '') {
  return firstNonBlank([
    org?.name,
    org?.identity?.displayName,
    org?.identity?.legalName,
    org?.orgName,
    org?.organizationName,
    org?.displayName,
    fallbackName
  ]);
}

function formatOrganizationLabel(orgId, name = '') {
  const normalizedOrgId = normalizeOrgId(orgId);
  const cleanName = String(name || '').trim();
  if (normalizedOrgId && cleanName) return `${cleanName} (${normalizedOrgId})`;
  if (normalizedOrgId) return `Org #${normalizedOrgId}`;
  return cleanName;
}

function buildOrganizationDisplayMap(organizations = []) {
  const map = new Map();
  (Array.isArray(organizations) ? organizations : []).forEach((org) => {
    const orgId = normalizeOrgId(org?.id ?? org?.orgId ?? org?._id);
    if (!orgId) return;
    const name = resolveCanonicalOrganizationName(org);
    map.set(orgId, {
      id: orgId,
      name,
      label: formatOrganizationLabel(orgId, name)
    });
  });
  return map;
}

function resolveMembershipOrgId(membership = {}) {
  return normalizeOrgId(membership?.orgId ?? membership?.organizationId ?? membership?.id);
}

function resolveMembershipOrganizationName(membership = {}, organizationMap = new Map()) {
  const orgId = resolveMembershipOrgId(membership);
  if (!orgId) return String(membership?.name || membership?.orgName || '').trim();
  const canonical = organizationMap.get(orgId);
  if (canonical?.name) return canonical.name;
  return String(membership?.name || membership?.orgName || membership?.organizationName || '').trim();
}

function resolveMembershipOrganizationLabel(membership = {}, organizationMap = new Map()) {
  const orgId = resolveMembershipOrgId(membership);
  if (!orgId) return String(membership?.name || membership?.orgName || '').trim();
  const canonical = organizationMap.get(orgId);
  if (canonical?.label) return canonical.label;
  return formatOrganizationLabel(orgId, canonical?.name || '');
}

function canonicalizeMembershipOrganizationName(membership = {}, organizationMap = new Map()) {
  if (!membership || typeof membership !== 'object') {
    return { value: membership, changed: false };
  }

  const orgId = resolveMembershipOrgId(membership);
  if (!orgId) return { value: membership, changed: false };

  const canonical = organizationMap.get(orgId);
  const canonicalName = String(canonical?.name || '').trim();
  if (!canonicalName) return { value: membership, changed: false };

  const canonicalLabel = canonical?.label || formatOrganizationLabel(orgId, canonicalName);
  const next = { ...membership };
  let changed = false;

  ['name', 'orgName', 'organizationName'].forEach((field) => {
    if (String(next[field] || '') !== canonicalName) {
      next[field] = canonicalName;
      changed = true;
    }
  });

  if (Object.prototype.hasOwnProperty.call(next, 'displayName') && String(next.displayName || '') !== canonicalName) {
    next.displayName = canonicalName;
    changed = true;
  }

  if (Object.prototype.hasOwnProperty.call(next, 'label') && String(next.label || '') !== canonicalLabel) {
    next.label = canonicalLabel;
    changed = true;
  }

  return { value: changed ? next : membership, changed };
}

function canonicalizeMembershipOrganizationNames(memberships = [], organizationMap = new Map()) {
  if (!Array.isArray(memberships)) {
    return { value: memberships, changed: false, changedCount: 0 };
  }

  let changed = false;
  let changedCount = 0;
  const value = memberships.map((membership) => {
    const result = canonicalizeMembershipOrganizationName(membership, organizationMap);
    if (result.changed) {
      changed = true;
      changedCount += 1;
    }
    return result.value;
  });

  return { value, changed, changedCount };
}

module.exports = {
  normalizeOrgId,
  resolveCanonicalOrganizationName,
  formatOrganizationLabel,
  buildOrganizationDisplayMap,
  resolveMembershipOrgId,
  resolveMembershipOrganizationName,
  resolveMembershipOrganizationLabel,
  canonicalizeMembershipOrganizationName,
  canonicalizeMembershipOrganizationNames
};
