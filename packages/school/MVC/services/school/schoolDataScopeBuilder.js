const { requireCoreModule } = require('./schoolCoreContracts');

const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const SCOPE_MODES = Object.freeze({
  ORG_WIDE: 'orgWide',
  ASSIGNMENT: 'assignment',
  OWNER: 'owner',
  USER: 'user'
});

const ORG_WIDE_SCOPE_NAMES = new Set(['ADMIN', 'ORGANIZATION', 'ORG', 'GLOBAL']);
const ASSIGNMENT_SCOPE_NAMES = new Set(['DEPARTMENT', 'DEPT', 'DIVISION', 'DIV']);
const OWNER_SCOPE_NAMES = new Set(['OWNER']);
const USER_SCOPE_NAMES = new Set(['USER']);

const SCOPE_NAME_BY_ID = Object.freeze({
  SCP_ADMIN: 'ADMIN',
  SCP_ORG: 'ORGANIZATION',
  SCP_OWNER: 'OWNER',
  SCP_USER: 'USER',
  SCP_DEPT: 'DEPARTMENT',
  SCP_DIV: 'DIVISION'
});

function normalizeScopeName(scopeName = '') {
  const token = String(scopeName || '').trim().toUpperCase();
  if (!token) return '';
  if (SCOPE_NAME_BY_ID[token]) return SCOPE_NAME_BY_ID[token];
  if (token === 'GLOBAL') return 'GLOBAL';
  if (token === 'ADMIN') return 'ADMIN';
  if (token === 'ORGANIZATION' || token === 'ORG') return 'ORGANIZATION';
  if (token === 'OWNER') return 'OWNER';
  if (token === 'USER') return 'USER';
  if (token === 'DEPARTMENT' || token === 'DEPT') return 'DEPARTMENT';
  if (token === 'DIVISION' || token === 'DIV') return 'DIVISION';
  return '';
}

function resolveScopeModeFromName(scopeName = '') {
  const normalized = normalizeScopeName(scopeName);
  if (!normalized) return SCOPE_MODES.ORG_WIDE;
  if (USER_SCOPE_NAMES.has(normalized)) return SCOPE_MODES.USER;
  if (OWNER_SCOPE_NAMES.has(normalized)) return SCOPE_MODES.OWNER;
  if (ASSIGNMENT_SCOPE_NAMES.has(normalized)) return SCOPE_MODES.ASSIGNMENT;
  if (ORG_WIDE_SCOPE_NAMES.has(normalized)) return SCOPE_MODES.ORG_WIDE;
  return SCOPE_MODES.ORG_WIDE;
}

function resolveScopeNameFromAccessContext(accessContext = {}) {
  const rawScope = accessContext?.scopeId
    || accessContext?.accessScope
    || accessContext?.scope
    || accessContext?.scopeName
    || '';
  return normalizeScopeName(rawScope);
}

function getScopedActiveOrgId(requestingUser) {
  if (!requestingUser) return null;
  return toPublicId(requestingUser.activeOrgId) || null;
}

function getScopedUserId(requestingUser) {
  if (!requestingUser) return null;
  return toPublicId(requestingUser.id || requestingUser.userId || requestingUser._id) || null;
}

function getScopedPersonId(requestingUser) {
  if (!requestingUser) return null;
  return toPublicId(requestingUser.personId) || null;
}

function isScopedSuperAdmin(requestingUser) {
  if (!requestingUser) return false;
  if (!adminChekersService.isSuperAdmin(requestingUser)) return false;
  const activeOrgId = getScopedActiveOrgId(requestingUser);
  return toPublicId(activeOrgId).toUpperCase() === 'SYSTEM';
}

function canBypassOrgScope(requestingUser) {
  return !requestingUser || isScopedSuperAdmin(requestingUser);
}

function buildSchoolListScope(requestingUser, options = {}) {
  const allowSystemFallbackRequested = options?.allowSystemFallback === true;
  const scopeName = resolveScopeNameFromAccessContext(options?.accessContext || {});

  if (!requestingUser) {
    return {
      denyAll: true,
      canViewAll: false,
      activeOrgId: null,
      allowSystemFallback: false,
      scopeName: '',
      scopeMode: SCOPE_MODES.USER,
      userId: null,
      personId: null,
      ownerScoped: false
    };
  }

  if (isScopedSuperAdmin(requestingUser)) {
    return {
      denyAll: false,
      canViewAll: true,
      activeOrgId: getScopedActiveOrgId(requestingUser),
      allowSystemFallback: false,
      scopeName: 'ADMIN',
      scopeMode: SCOPE_MODES.ORG_WIDE,
      userId: getScopedUserId(requestingUser),
      personId: getScopedPersonId(requestingUser),
      ownerScoped: false
    };
  }

  const activeOrgId = getScopedActiveOrgId(requestingUser);
  if (!activeOrgId) {
    return {
      denyAll: true,
      canViewAll: false,
      activeOrgId: null,
      allowSystemFallback: false,
      scopeName: '',
      scopeMode: SCOPE_MODES.USER,
      userId: null,
      personId: null,
      ownerScoped: false
    };
  }

  const allowSystemFallback = allowSystemFallbackRequested && !adminChekersService.isSuperAdmin(requestingUser);
  const resolvedScopeName = scopeName || 'ORGANIZATION';
  const scopeMode = resolveScopeModeFromName(resolvedScopeName);
  const userId = getScopedUserId(requestingUser);
  const personId = getScopedPersonId(requestingUser);

  if (scopeMode === SCOPE_MODES.USER) {
    return {
      denyAll: true,
      canViewAll: false,
      activeOrgId,
      allowSystemFallback,
      scopeName: resolvedScopeName,
      scopeMode,
      userId,
      personId,
      ownerScoped: false
    };
  }

  return {
    denyAll: false,
    canViewAll: false,
    activeOrgId,
    allowSystemFallback,
    scopeName: resolvedScopeName,
    scopeMode,
    userId: (scopeMode === SCOPE_MODES.OWNER || scopeMode === SCOPE_MODES.ASSIGNMENT) ? userId : null,
    personId: (scopeMode === SCOPE_MODES.OWNER || scopeMode === SCOPE_MODES.ASSIGNMENT) ? personId : null,
    ownerScoped: scopeMode === SCOPE_MODES.OWNER,
    linkedAccountIds: []
  };
}

function isRecordAccessibleByOrg(record, requestingUser, { orgField = 'orgId', allowSystemFallback = false } = {}) {
  if (!record) return false;
  if (canBypassOrgScope(requestingUser)) return true;

  const activeOrgId = getScopedActiveOrgId(requestingUser);
  if (!activeOrgId) return false;

  const recordOrgId = toPublicId(record?.[orgField]);
  if (allowSystemFallback && recordOrgId === 'SYSTEM') return true;
  return idsEqual(recordOrgId, activeOrgId);
}

async function isTimesheetAccessibleByOrg(timesheet, requestingUser, resolvePeriodById) {
  if (!timesheet) return false;
  if (canBypassOrgScope(requestingUser)) return true;

  const activeOrgId = getScopedActiveOrgId(requestingUser);
  if (!activeOrgId) return false;

  const directOrgId = toPublicId(timesheet.orgId);
  if (directOrgId) return idsEqual(directOrgId, activeOrgId);

  const periodId = toPublicId(timesheet.periodId);
  if (!periodId || typeof resolvePeriodById !== 'function') return false;

  const period = await resolvePeriodById(periodId);
  if (!period) return false;
  return idsEqual(period?.orgId, activeOrgId);
}

module.exports = {
  SCOPE_MODES,
  getScopedActiveOrgId,
  getScopedUserId,
  getScopedPersonId,
  normalizeScopeName,
  resolveScopeModeFromName,
  resolveScopeNameFromAccessContext,
  isScopedSuperAdmin,
  canBypassOrgScope,
  buildSchoolListScope,
  isRecordAccessibleByOrg,
  isTimesheetAccessibleByOrg
};
