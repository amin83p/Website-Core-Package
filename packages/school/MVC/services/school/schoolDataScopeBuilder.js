const { requireCoreModule } = require('./schoolCoreContracts');

const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const ORGANIZATION_SCOPE_NAMES = new Set(['ADMIN', 'ORGANIZATION', 'ORG', 'GLOBAL']);
const OWNER_SCOPE_NAMES = new Set(['OWNER', 'USER', 'DEPARTMENT', 'DEPT', 'DIVISION', 'DIV']);
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
      userId: null
    };
  }

  if (isScopedSuperAdmin(requestingUser)) {
    return {
      denyAll: false,
      canViewAll: true,
      activeOrgId: getScopedActiveOrgId(requestingUser),
      allowSystemFallback: false,
      scopeName: 'ADMIN',
      userId: getScopedUserId(requestingUser)
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
      userId: null
    };
  }

  const allowSystemFallback = allowSystemFallbackRequested && !adminChekersService.isSuperAdmin(requestingUser);
  const ownerScoped = OWNER_SCOPE_NAMES.has(scopeName);
  const scopedUserId = ownerScoped ? getScopedUserId(requestingUser) : null;

  return {
    denyAll: false,
    canViewAll: false,
    activeOrgId,
    allowSystemFallback,
    scopeName: scopeName || 'ORGANIZATION',
    userId: scopedUserId,
    ownerScoped
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
  getScopedActiveOrgId,
  getScopedUserId,
  normalizeScopeName,
  resolveScopeNameFromAccessContext,
  isScopedSuperAdmin,
  canBypassOrgScope,
  buildSchoolListScope,
  isRecordAccessibleByOrg,
  isTimesheetAccessibleByOrg
};
