const packageDataService = require('../../../../../MVC/services/activityQuota/packageDataService');
const packageManagerDataService = require('../../../../../MVC/services/activityQuota/packageManagerDataService');
const activityQuotaPackageAssignmentRepository = require('../../../../../MVC/repositories/activityQuotaPackageAssignmentRepository');
const dataService = require('../../../../../MVC/services/dataService');
const settingService = require('../../../../../MVC/services/settingService');
const pteStudentDataService = require('./pteStudentDataService');
const { DEFAULTS, SYSTEM_CONTEXT } = require('../../../config/constants');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');

const FREE_ORG_ID = Number(DEFAULTS?.FREE_ORG_ID || 900000);
const PUBLIC_ROLE_TOKEN = String(pteStudentDataService.PERSON_ORG_ROLE_PUBLIC_TOKEN || 'pte_student_public').toLowerCase();
const PUBLIC_ROLE_ALIASES = new Set([PUBLIC_ROLE_TOKEN, 'pte_public_student']);
const PUBLIC_PACKAGE_SCOPE = Object.freeze({ scope: 'ORGANIZATION' });

function cleanString(value, max = 240) {
  const text = String(value ?? '').replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function normalizeRoleToken(value = '') {
  if (value && typeof value === 'object') {
    return normalizeRoleToken(value.id || value.role || value.value || value.name || '');
  }
  return cleanString(value, 120).toLowerCase();
}

function normalizeRoleList(values = []) {
  const out = new Set();
  normalizeList(values).forEach((value) => {
    const token = normalizeRoleToken(value);
    if (token) out.add(token);
  });
  return Array.from(out.values());
}

function toStoredOrgId(orgId) {
  const token = toPublicId(orgId);
  if (!token) return orgId;
  const parsed = Number(token);
  return Number.isFinite(parsed) ? parsed : token;
}

function resolveConfiguredOrgId(settingKey, fallbackValue) {
  const raw = settingService.getValue('organization', settingKey);
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const fallbackParsed = Number.parseInt(String(fallbackValue ?? '').trim(), 10);
  if (Number.isFinite(fallbackParsed) && fallbackParsed > 0) return fallbackParsed;
  return FREE_ORG_ID;
}

function resolvePteJoinOrgId() {
  const freeOrgId = resolveConfiguredOrgId('freeOrgId', FREE_ORG_ID);
  return resolveConfiguredOrgId('pteJoinOrgId', freeOrgId);
}

function isPtePublicRoleToken(value = '') {
  const token = normalizeRoleToken(value);
  return PUBLIC_ROLE_ALIASES.has(token) || token.includes(PUBLIC_ROLE_TOKEN);
}

function extractOrgRoles(org = {}) {
  const roles = Array.isArray(org?.roles) && org.roles.length ? org.roles : (org?.role ? [org.role] : []);
  return normalizeRoleList(roles);
}

function hasPtePublicRoleForOrg(organizations = [], orgId = '') {
  const targetOrgId = toPublicId(orgId);
  return (Array.isArray(organizations) ? organizations : []).some((org) => {
    const rowOrgId = toPublicId(org?.orgId || org?.id || '');
    if (targetOrgId && rowOrgId && !idsEqual(rowOrgId, targetOrgId)) return false;
    return extractOrgRoles(org).some(isPtePublicRoleToken);
  });
}

function getDisplayName(user = {}) {
  return cleanString(user?.name || user?.username || user?.email || user?.id || '', 220);
}

function buildPackageRequester(sourceUser = {}, orgId = '') {
  const user = sourceUser && typeof sourceUser === 'object' ? sourceUser : {};
  const fallbackId = `PTE_PUBLIC_${toPublicId(orgId) || 'VIEWER'}`;
  return {
    ...user,
    id: toPublicId(user.id || fallbackId),
    username: cleanString(user.username || user.email || user.id || fallbackId, 160),
    email: cleanString(user.email || '', 200),
    activeOrgId: toStoredOrgId(orgId),
    primaryOrgId: toStoredOrgId(orgId)
  };
}

function isPublicPtePackage(row = {}, orgId = '') {
  if (!row || typeof row !== 'object') return false;
  if (row.active === false) return false;
  if (orgId && !idsEqual(row.orgId, orgId)) return false;
  if (String(row.visibility || '').trim().toLowerCase() !== 'public') return false;

  const roles = normalizeRoleList(row.eligibleRoles || []);
  if (!roles.some(isPtePublicRoleToken)) return false;

  return roles.every((role) => role === 'member' || isPtePublicRoleToken(role));
}

function formatCurrency(price = {}) {
  const amount = Number(price?.amount || 0);
  const currencyCode = cleanString(price?.currencyCode || 'CAD', 3).toUpperCase() || 'CAD';
  if (!Number.isFinite(amount) || amount <= 0) return 'Free';
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;
  return `${amount.toLocaleString('en-CA', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2
  })} ${currencyCode}`;
}

function formatValidity(validity = {}) {
  const mode = String(validity?.mode || '').trim().toLowerCase();
  if (mode === 'date_range') {
    const start = cleanString(validity.startDate || '', 20);
    const end = cleanString(validity.endDate || '', 20);
    if (start && end) return `${start} to ${end}`;
    if (start) return `Starts ${start}`;
    if (end) return `Until ${end}`;
    return 'Date range';
  }

  const years = Number.parseInt(String(validity?.years || '0'), 10) || 0;
  const months = Number.parseInt(String(validity?.months || '0'), 10) || 0;
  const days = Number.parseInt(String(validity?.days || '0'), 10) || 0;
  const parts = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (months > 0) parts.push(`${months} month${months === 1 ? '' : 's'}`);
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'Starts when added';
}

function toPackageCardModel(row = {}) {
  const sections = Array.isArray(row.sections) ? row.sections : [];
  const summary = row.summary || {};
  const operationLabels = [];
  sections.forEach((section) => {
    const operations = Array.isArray(section?.operations) ? section.operations : [];
    operations.forEach((operation) => {
      const label = cleanString(operation?.label || operation?.name || operation?.id || '', 140);
      if (label) operationLabels.push(label);
    });
  });

  return {
    ...row,
    id: toPublicId(row.id || ''),
    name: cleanString(row.name || row.id || 'PTE Public Package', 220),
    category: cleanString(row.category || 'PTE Practice', 90),
    description: cleanString(row.description || 'A public PTE practice package for applicant preparation.', 600),
    priceLabel: formatCurrency(row.price || {}),
    validityLabel: formatValidity(row.validity || {}),
    roleLabels: normalizeRoleList(row.eligibleRoles || []),
    sectionLabels: sections.map((section) => cleanString(section?.name || section?.id || '', 160)).filter(Boolean),
    operationLabels,
    summary: {
      sectionCount: Number(summary.sectionCount || sections.length || 0),
      operationCount: Number(summary.operationCount || operationLabels.length || 0),
      accessProfileCount: Number(summary.accessProfileCount || (Array.isArray(row.accessProfiles) ? row.accessProfiles.length : 0) || 0)
    }
  };
}

async function resolvePublicRoleState(currentUser = null, options = {}) {
  const pteJoinOrgId = resolvePteJoinOrgId();
  const userId = toPublicId(currentUser?.id || '');
  const state = {
    pteJoinOrgId,
    userId,
    displayName: getDisplayName(currentUser || {}),
    hasUserRole: false,
    hasPersonRole: false,
    joined: false,
    linkedUser: null,
    linkedPerson: null
  };

  if (!userId) return state;

  const linkedUser = await dataService.getDataById('users', userId, SYSTEM_CONTEXT, options);
  if (!linkedUser) return state;

  state.linkedUser = linkedUser;
  state.userId = toPublicId(linkedUser.id || userId);
  state.displayName = getDisplayName(linkedUser) || state.displayName;
  state.hasUserRole = hasPtePublicRoleForOrg(linkedUser.organizations, pteJoinOrgId);

  const personId = toPublicId(linkedUser.personId || currentUser?.personId || '');
  if (personId && personId !== 'NO_PERSONID') {
    const linkedPerson = await dataService.getDataById('persons', personId, SYSTEM_CONTEXT, {
      ...options,
      enrichment: { includeSchoolRoles: false }
    });
    state.linkedPerson = linkedPerson || null;
    state.hasPersonRole = hasPtePublicRoleForOrg(linkedPerson?.organizations, pteJoinOrgId);
  }

  state.joined = state.hasUserRole && state.hasPersonRole;
  return state;
}

async function listAssignedPackageIds(userId = '', orgId = '', options = {}) {
  const normalizedUserId = toPublicId(userId);
  const normalizedOrgId = toPublicId(orgId);
  if (!normalizedUserId || !normalizedOrgId) return [];

  const rows = await activityQuotaPackageAssignmentRepository.list({
    query: {
      orgId__eq: normalizedOrgId,
      targetUserId__eq: normalizedUserId,
      limit: 500
    },
    scope: { canViewAll: true },
    backendMode: options?.backendMode
  });

  return (Array.isArray(rows) ? rows : [])
    .filter((row) => String(row?.status || '').trim().toLowerCase() !== 'removed')
    .map((row) => toPublicId(row?.packageId || ''))
    .filter(Boolean);
}

async function listPublicPackages(currentUser = null, options = {}) {
  const pteJoinOrgId = resolvePteJoinOrgId();
  const roleState = await resolvePublicRoleState(currentUser, options);
  const requester = buildPackageRequester(roleState.linkedUser || currentUser || {}, pteJoinOrgId);
  const rows = await packageDataService.listPackages({
    visibility__eq: 'public',
    limit: 500
  }, requester, PUBLIC_PACKAGE_SCOPE, options);

  const packages = (Array.isArray(rows) ? rows : [])
    .filter((row) => isPublicPtePackage(row, pteJoinOrgId))
    .map(toPackageCardModel)
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' }));

  const assignedPackageIds = roleState.userId
    ? await listAssignedPackageIds(roleState.userId, pteJoinOrgId, options)
    : [];

  return {
    pteJoinOrgId,
    publicRoleToken: PUBLIC_ROLE_TOKEN,
    roleState,
    packages,
    assignedPackageIds
  };
}

async function getPublicPackageById(packageId = '', currentUser = null, orgId = '', options = {}) {
  const pteJoinOrgId = orgId || resolvePteJoinOrgId();
  const requester = buildPackageRequester(currentUser || {}, pteJoinOrgId);
  const row = await packageDataService.getPackageById(packageId, requester, PUBLIC_PACKAGE_SCOPE, options);
  if (!isPublicPtePackage(row, pteJoinOrgId)) return null;
  return toPackageCardModel(row);
}

function buildPublicError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function selectPublicPackage(packageId = '', currentUser = null, options = {}) {
  const roleState = await resolvePublicRoleState(currentUser, options);
  if (!roleState.userId) {
    throw buildPublicError('Please sign in before selecting a public PTE package.', 'AUTH_REQUIRED');
  }
  if (!roleState.joined) {
    throw buildPublicError('Please join Public PTE before selecting a package.', 'PTE_PUBLIC_ACCESS_REQUIRED');
  }

  const packageRecord = await getPublicPackageById(packageId, roleState.linkedUser || currentUser, roleState.pteJoinOrgId, options);
  if (!packageRecord) {
    throw buildPublicError('This package is not available for public PTE students.', 'PACKAGE_NOT_AVAILABLE');
  }

  const assignedPackageIds = await listAssignedPackageIds(roleState.userId, roleState.pteJoinOrgId, options);
  if (assignedPackageIds.some((id) => idsEqual(id, packageRecord.id))) {
    return {
      package: packageRecord,
      assignment: null,
      alreadyAssigned: true
    };
  }

  const requester = buildPackageRequester(roleState.linkedUser || currentUser || {}, roleState.pteJoinOrgId);
  try {
    const assignment = await packageManagerDataService.createAssignment({
      packageId: packageRecord.id,
      targetUserId: roleState.userId,
      notes: 'Self-selected from the public PTE package page.'
    }, requester, PUBLIC_PACKAGE_SCOPE, options);

    return {
      package: packageRecord,
      assignment,
      alreadyAssigned: false
    };
  } catch (error) {
    if (/active assignment already exists/i.test(String(error?.message || ''))) {
      return {
        package: packageRecord,
        assignment: null,
        alreadyAssigned: true
      };
    }
    throw error;
  }
}

module.exports = {
  PUBLIC_ROLE_TOKEN,
  resolvePteJoinOrgId,
  resolvePublicRoleState,
  listPublicPackages,
  selectPublicPackage,
  isPtePublicRoleToken
};
