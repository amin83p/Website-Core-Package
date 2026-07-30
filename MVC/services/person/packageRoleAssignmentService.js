const { idsEqual, toPublicId } = require('../../utils/idAdapter');

const INACTIVE_STATUSES = new Set([
  'archived',
  'deleted',
  'inactive',
  'disabled',
  'removed',
  'suspended',
  'pending'
]);

const CORE_MEMBERSHIP_TOKENS = new Set([
  'member',
  'members',
  'system_user',
  'super_admin'
]);

function normalizeRoleToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
}

function dedupe(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function pluralVariant(value = '') {
  const token = normalizeRoleToken(value);
  if (!token || token.endsWith('s')) return token;
  return `${token}s`;
}

function compactVariant(value = '') {
  return normalizeRoleToken(value).replace(/[_-]/g, '');
}

function roleVariants(role = {}) {
  return dedupe([
    role?.key,
    role?.id,
    ...(Array.isArray(role?.aliases) ? role.aliases : []),
    pluralVariant(role?.key),
    compactVariant(role?.key),
    pluralVariant(compactVariant(role?.key))
  ].map(normalizeRoleToken));
}

function isPackageSystemRole(role = {}) {
  if (role?.system !== true) return false;
  const domain = normalizeRoleToken(role?.domain || '');
  const packageName = normalizeRoleToken(role?.packageName || '');
  return !(domain === 'core' && packageName === 'core');
}

function packageDomainKey(role = {}) {
  return normalizeRoleToken(role?.domain || role?.packageName || role?.key || '');
}

function buildPackageSystemRoleIndex(registry = {}) {
  const allRoles = Array.isArray(registry?.roles) ? registry.roles : [];
  const roles = allRoles.filter(isPackageSystemRole);
  const roleByKey = new Map();
  const aliasToKey = new Map();
  const knownRoleTokens = new Set(CORE_MEMBERSHIP_TOKENS);

  allRoles.forEach((role) => {
    roleVariants(role).forEach((token) => knownRoleTokens.add(token));
  });

  roles.forEach((role) => {
    const key = normalizeRoleToken(role?.key);
    if (!key) return;
    const normalizedRole = {
      id: String(role?.id || '').trim(),
      key,
      label: String(role?.label || key).trim() || key,
      domain: packageDomainKey(role),
      packageName: String(role?.packageName || role?.domain || 'Package').trim() || 'Package',
      active: role?.active !== false,
      system: true
    };
    roleByKey.set(key, normalizedRole);
    roleVariants(role).forEach((alias) => {
      aliasToKey.set(alias, key);
      aliasToKey.set(normalizeRoleToken(`member ${alias}`), key);
      aliasToKey.set(normalizeRoleToken(`member_${alias}`), key);
      aliasToKey.set(normalizeRoleToken(`member${compactVariant(alias)}`), key);
    });
  });

  Object.entries(registry?.systemRoleAlias || {}).forEach(([alias, key]) => {
    const normalizedAlias = normalizeRoleToken(alias);
    const normalizedKey = normalizeRoleToken(key);
    if (normalizedAlias && roleByKey.has(normalizedKey)) {
      aliasToKey.set(normalizedAlias, normalizedKey);
      knownRoleTokens.add(normalizedAlias);
    }
  });

  return { roles, roleByKey, aliasToKey, knownRoleTokens };
}

function splitRoleValues(value) {
  if (value === undefined || value === null) return [];
  return String(value)
    .split(/[,;|]+/)
    .map(normalizeRoleToken)
    .filter(Boolean);
}

function collectMembershipRoleTokens(membership = {}) {
  const candidates = [
    membership.roles,
    membership.role,
    membership.roleId,
    membership.roleKey,
    membership.type,
    membership.membershipType
  ];
  const tokens = [];
  candidates.forEach((candidate) => {
    if (Array.isArray(candidate)) {
      candidate.forEach((value) => tokens.push(...splitRoleValues(value)));
    } else {
      tokens.push(...splitRoleValues(candidate));
    }
  });
  return dedupe(tokens);
}

function membershipOrgId(membership = {}) {
  return toPublicId(membership?.orgId || membership?.organizationId || membership?.id);
}

function isActiveMembership(membership = {}) {
  const status = String(membership?.memberStatus || membership?.status || 'active')
    .trim()
    .toLowerCase();
  return status === 'active';
}

function isActivePerson(person = {}) {
  if (!person || person.active === false) return false;
  const status = String(
    person?.status
    || person?.state
    || person?.lifecycleStatus
    || person?.accountStatus
    || 'active'
  ).trim().toLowerCase();
  return !INACTIVE_STATUSES.has(status);
}

function analyzeRoleTokens(tokens = [], registry = {}) {
  const { roleByKey, aliasToKey, knownRoleTokens } = buildPackageSystemRoleIndex(registry);
  const packageRoles = [];
  const unknownTokens = [];
  const seenRoles = new Set();

  dedupe(tokens.map(normalizeRoleToken)).forEach((token) => {
    let canonicalKey = aliasToKey.get(token);
    if (!canonicalKey && token.startsWith('member')) {
      const withoutMember = token.replace(/^member[_-]?/, '');
      canonicalKey = aliasToKey.get(withoutMember);
    }
    const role = roleByKey.get(canonicalKey);
    if (role) {
      if (!seenRoles.has(role.key)) {
        seenRoles.add(role.key);
        packageRoles.push(role);
      }
      return;
    }
    if (!knownRoleTokens.has(token)) unknownTokens.push(token);
  });

  const packageDomains = dedupe(packageRoles.map((role) => role.domain).filter(Boolean));
  return {
    packageRoles,
    packageDomains,
    unknownTokens: dedupe(unknownTokens),
    isPlain: packageRoles.length === 0 && unknownTokens.length === 0
  };
}

function analyzePersonRoleScope(person, orgId, registry = {}, options = {}) {
  const normalizedOrgId = toPublicId(orgId);
  const requireActiveMembership = options?.requireActiveMembership !== false;
  const memberships = (Array.isArray(person?.organizations) ? person.organizations : [])
    .filter((membership) => idsEqual(membershipOrgId(membership), normalizedOrgId))
    .filter((membership) => !requireActiveMembership || isActiveMembership(membership));

  if (!normalizedOrgId || memberships.length === 0) {
    return {
      eligible: false,
      reason: 'No active Person membership exists in the selected organization.',
      orgId: normalizedOrgId || '',
      memberships: [],
      packageRoles: [],
      packageDomains: [],
      unknownTokens: [],
      isPlain: false
    };
  }

  const roleAnalysis = analyzeRoleTokens(
    memberships.flatMap((membership) => collectMembershipRoleTokens(membership)),
    registry
  );

  return {
    eligible: isActivePerson(person),
    reason: isActivePerson(person) ? '' : 'The linked Person is inactive.',
    orgId: normalizedOrgId,
    memberships,
    ...roleAnalysis
  };
}

function collectPackageSystemRoleAssignments(person, registry = {}) {
  const memberships = Array.isArray(person?.organizations) ? person.organizations : [];
  const assignments = [];
  const seen = new Set();

  memberships.forEach((membership) => {
    const orgId = membershipOrgId(membership) || 'UNKNOWN';
    const orgName = String(
      membership?.displayLabel
      || membership?.name
      || membership?.organizationName
      || ''
    ).trim();
    const analysis = analyzeRoleTokens(collectMembershipRoleTokens(membership), registry);

    analysis.packageRoles.forEach((role) => {
      const dedupeKey = `${role.key}|${orgId}|${orgName}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      assignments.push({
        roleKey: role.key,
        roleLabel: role.label,
        packageName: role.packageName,
        packageDomain: role.domain,
        roleActive: role.active,
        orgId,
        orgName,
        memberStatus: String(membership?.memberStatus || '').trim().toLowerCase()
      });
    });
  });

  return assignments;
}

module.exports = {
  INACTIVE_STATUSES,
  CORE_MEMBERSHIP_TOKENS,
  normalizeRoleToken,
  dedupe,
  isPackageSystemRole,
  packageDomainKey,
  buildPackageSystemRoleIndex,
  collectMembershipRoleTokens,
  membershipOrgId,
  isActiveMembership,
  isActivePerson,
  analyzeRoleTokens,
  analyzePersonRoleScope,
  collectPackageSystemRoleAssignments
};
