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
    org?.identity?.displayName,
    org?.identity?.legalName,
    org?.name,
    org?.orgName,
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

function resolveMembershipOrganizationName(membership = {}, organizationMap = new Map()) {
  const orgId = normalizeOrgId(membership?.orgId ?? membership?.id);
  if (!orgId) return String(membership?.name || membership?.orgName || '').trim();
  const canonical = organizationMap.get(orgId);
  if (canonical?.name) return canonical.name;
  return String(membership?.name || membership?.orgName || '').trim();
}

function resolveMembershipOrganizationLabel(membership = {}, organizationMap = new Map()) {
  const orgId = normalizeOrgId(membership?.orgId ?? membership?.id);
  if (!orgId) return String(membership?.name || membership?.orgName || '').trim();
  const canonical = organizationMap.get(orgId);
  if (canonical?.label) return canonical.label;
  return formatOrganizationLabel(orgId, canonical?.name || '');
}

function canonicalizeMembershipOrganizationName(membership = {}, organizationMap = new Map()) {
  if (!membership || typeof membership !== 'object') {
    return { value: membership, changed: false };
  }

  const orgId = normalizeOrgId(membership?.orgId ?? membership?.id);
  if (!orgId) return { value: membership, changed: false };

  const canonical = organizationMap.get(orgId);
  const canonicalName = String(canonical?.name || '').trim();
  if (!canonicalName) return { value: membership, changed: false };

  const rawCurrentName = String(membership?.name || '');
  if (rawCurrentName === canonicalName) return { value: membership, changed: false };

  return {
    value: {
      ...membership,
      name: canonicalName
    },
    changed: true
  };
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
  resolveMembershipOrganizationName,
  resolveMembershipOrganizationLabel,
  canonicalizeMembershipOrganizationName,
  canonicalizeMembershipOrganizationNames
};
