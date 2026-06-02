const { requireCoreModule } = require('./schoolCoreContracts');

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

function buildSchoolListScope(requestingUser, options = {}) {
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

  const allowSystemFallback = allowSystemFallbackRequested && !adminChekersService.isSuperAdmin(requestingUser);

  return {
    denyAll: false,
    canViewAll: false,
    activeOrgId,
    allowSystemFallback
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
  isScopedSuperAdmin,
  canBypassOrgScope,
  buildSchoolListScope,
  isRecordAccessibleByOrg,
  isTimesheetAccessibleByOrg
};
