const { requireCoreModule } = require('./benchpathCoreModuleResolver');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function getScopedActiveOrgId(requestingUser) {
  if (!requestingUser) return null;
  return toPublicId(requestingUser.activeOrgId) || null;
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

function buildBenchPathListScope(requestingUser, options = {}) {
  const allowSystemFallbackRequested = options?.allowSystemFallback === true;

  if (!requestingUser) {
    return {
      denyAll: true,
      canViewAll: false,
      activeOrgId: null,
      allowSystemFallback: false
    };
  }

  if (isScopedSuperAdmin(requestingUser)) {
    return {
      denyAll: false,
      canViewAll: true,
      activeOrgId: getScopedActiveOrgId(requestingUser),
      allowSystemFallback: false
    };
  }

  const activeOrgId = getScopedActiveOrgId(requestingUser);
  if (!activeOrgId) {
    return {
      denyAll: true,
      canViewAll: false,
      activeOrgId: null,
      allowSystemFallback: false
    };
  }

  return {
    denyAll: false,
    canViewAll: false,
    activeOrgId,
    allowSystemFallback: allowSystemFallbackRequested
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

module.exports = {
  getScopedActiveOrgId,
  isScopedSuperAdmin,
  canBypassOrgScope,
  buildBenchPathListScope,
  isRecordAccessibleByOrg
};
