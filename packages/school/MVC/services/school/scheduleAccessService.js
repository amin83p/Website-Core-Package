'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const accessService = requireCoreModule('MVC/services/security');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const schoolAdminAccessService = require('./schoolAdminAccessService');
const schoolDataService = require('./schoolDataService');
const schoolIdentityLookupService = require('./schoolIdentityLookupService');
const { buildSchoolListScope, resolveScopeModeFromName, resolveScopeNameFromAccessContext, SCOPE_MODES } = require('./schoolDataScopeBuilder');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const SCHEDULE_ROLE_META = Object.freeze({
  student: Object.freeze({ key: 'student', label: 'Student' }),
  teacher: Object.freeze({ key: 'teacher', label: 'Teacher' }),
  staff: Object.freeze({ key: 'staff', label: 'Staff' })
});

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeScheduleRole(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized) return '';
  if (normalized === 'school_student' || normalized === 'student' || normalized === 'students') return 'student';
  if (normalized === 'school_teacher' || normalized === 'teacher' || normalized === 'teachers') return 'teacher';
  if (normalized === 'school_staff' || normalized === 'staff' || normalized === 'staffs') return 'staff';
  return normalized;
}

function getActiveScheduleOrgId(reqUser = {}) {
  return normalizeId(
    reqUser.activeOrgId
    || reqUser.activeOrganizationId
    || reqUser.currentOrgId
    || reqUser.orgId
    || reqUser.organization?.id
  );
}

function getUserPersonId(reqUser = {}) {
  return normalizeId(
    reqUser.personId
    || reqUser.person?.personId
    || reqUser.person?.id
    || reqUser.profile?.personId
  );
}

function rowBelongsToActiveOrg(row = {}, activeOrgId = '') {
  const orgId = normalizeId(activeOrgId);
  if (!orgId) return true;
  const rowOrgIds = [
    row.orgId,
    row.organizationId,
    row.schoolOrgId,
    row.activeOrgId
  ].map(normalizeId).filter(Boolean);
  if (!rowOrgIds.length) return true;
  return rowOrgIds.some((rowOrgId) => idsEqual(rowOrgId, orgId));
}

function isActiveSchoolIdentityRow(row = {}) {
  const status = String(row.status || row.state || '').trim().toLowerCase();
  return !['archived', 'deleted', 'inactive', 'disabled', 'removed'].includes(status);
}

function addScheduleRoleOption(roleMap, roleKey, source = 'backend') {
  const normalized = normalizeScheduleRole(roleKey);
  const meta = SCHEDULE_ROLE_META[normalized];
  if (!meta || roleMap.has(normalized)) return;
  roleMap.set(normalized, { key: meta.key, label: meta.label, source });
}

function buildPersonDisplayName(person = {}, fallbackId = '') {
  const first = String(person?.name?.first || person?.firstName || '').trim();
  const last = String(person?.name?.last || person?.lastName || '').trim();
  const composed = `${first} ${last}`.trim();
  return composed
    || String(person?.displayName || person?.fullName || person?.name || '').trim()
    || String(fallbackId || '').trim();
}

function getScheduleViewerName({ person, reqUser, personId }) {
  return (person ? buildPersonDisplayName(person) : '')
    || String(reqUser?.displayName || reqUser?.name || reqUser?.fullName || '').trim()
    || personId
    || '';
}

function extractPersonRolesInOrg(person = {}, activeOrgId = '') {
  const orgId = normalizeId(activeOrgId);
  const memberships = Array.isArray(person?.orgMemberships) ? person.orgMemberships : [];
  const match = memberships.find((row) => idsEqual(row?.orgId, orgId) || idsEqual(row?.organizationId, orgId));
  const roles = Array.isArray(match?.roles) ? match.roles : [];
  return roles.map((role) => String(role || '').trim()).filter(Boolean);
}

async function listSchoolPersonRecords(reqUser, { query = {} } = {}) {
  const payload = await schoolIdentityLookupService.listSchoolPersonRecords({
    reqUser,
    query,
    q: String(query?.q || '').trim()
  });
  return payload?.allRows || payload?.rows || [];
}

function buildOrgContext(reqUser, extra = {}) {
  return {
    orgId: getActiveScheduleOrgId(reqUser),
    section: { id: SECTIONS.SCHOOL_SCHEDULES, category: 'SCHOOL' },
    ...extra
  };
}

function isOperationAdminForSchedules(reqUser) {
  return schoolAdminAccessService.isSchedulesAdminViewer(reqUser);
}

async function evaluateScheduleOperation(reqUser, operationId, ipAddress = '') {
  try {
    return await accessService.evaluateAccess({
      user: reqUser,
      sectionId: SECTIONS.SCHOOL_SCHEDULES,
      operationId,
      ipAddress
    });
  } catch (_) {
    return { allowed: false, scopeId: '' };
  }
}

function resolveAccessContext(options = {}) {
  const scopeId = String(
    options?.accessScope
    || options?.accessContext?.scopeId
    || options?.accessContext?.accessScope
    || ''
  ).trim();
  return scopeId ? { scopeId } : {};
}

function resolveListScope(reqUser, accessContext = {}) {
  return buildSchoolListScope(reqUser, { accessContext });
}

async function buildScheduleCapabilities(reqUser = {}, options = {}) {
  const accessContext = resolveAccessContext(options);
  const ipAddress = String(options?.ipAddress || '').trim();
  const orgContext = buildOrgContext(reqUser);
  const activeOrgId = getActiveScheduleOrgId(reqUser);

  const [readEval, readAllEval] = await Promise.all([
    evaluateScheduleOperation(reqUser, OPERATIONS.READ, ipAddress),
    evaluateScheduleOperation(reqUser, OPERATIONS.READ_ALL, ipAddress)
  ]);

  const scopeId = String(
    options?.accessScope
    || readAllEval?.scopeId
    || readEval?.scopeId
    || accessContext?.scopeId
    || ''
  ).trim();
  const effectiveAccessContext = scopeId ? { scopeId } : accessContext;
  const scopeName = resolveScopeNameFromAccessContext(effectiveAccessContext);
  const scopeMode = resolveScopeModeFromName(scopeName);

  const isSuperAdmin = Boolean(adminAuthorityService.isSuperAdmin(reqUser));
  const isGlobalAdmin = Boolean(adminAuthorityService.isSystemAdmin(reqUser, orgContext));
  const isSectionAdmin = Boolean(adminAuthorityService.isAdminForSection(
    reqUser,
    SECTIONS.SCHOOL_SCHEDULES,
    orgContext
  ));
  const isOperationAdmin = Boolean(adminAuthorityService.isAdminForRequest(
    reqUser,
    SECTIONS.SCHOOL_SCHEDULES,
    OPERATIONS.READ_ALL,
    orgContext
  ));

  const canRead = Boolean(readEval?.allowed);
  const canReadAll = Boolean(readAllEval?.allowed);
  const canSelectAnyPerson = isOperationAdmin;
  const canUseGlobalComparison = isOperationAdmin;
  const canDragCreateSessions = isOperationAdmin;
  const canLoadAllSchedules = isOperationAdmin;

  const locked = canSelectAnyPerson
    ? {
      lockedPersonId: '',
      lockedPersonName: '',
      availableRoles: [],
      selectedRole: ''
    }
    : await resolveLockedViewerAccess(reqUser, { activeOrgId, accessContext: effectiveAccessContext });

  return {
    isSuperAdmin,
    isGlobalAdmin,
    isSectionAdmin,
    isOperationAdmin,
    scopeId,
    scopeName,
    scopeMode,
    canRead,
    canReadAll,
    canSelectAnyPerson,
    canUseGlobalComparison,
    canDragCreateSessions,
    canLoadAllSchedules,
    activeOrgId,
    ...locked
  };
}

async function resolveLockedViewerAccess(reqUser, { activeOrgId, accessContext = {} } = {}) {
  const personId = getUserPersonId(reqUser);
  const roleMap = new Map();
  let person = null;

  if (personId) {
    try {
      const [students, teachers, staffRows] = await Promise.all([
        schoolDataService.fetchAllData('students', { orgId__eq: activeOrgId }, reqUser, accessContext),
        schoolDataService.fetchAllData('teachers', { orgId__eq: activeOrgId }, reqUser, accessContext),
        schoolDataService.fetchAllData('staff', { orgId__eq: activeOrgId }, reqUser, accessContext)
      ]);

      const persons = await listSchoolPersonRecords(reqUser, { query: { limit: 1000 } }).catch(() => []);
      person = (Array.isArray(persons) ? persons : []).find((row) => idsEqual(row?.id, personId) || idsEqual(row?._id, personId)) || null;

      [
        { key: 'student', rows: students },
        { key: 'teacher', rows: teachers },
        { key: 'staff', rows: staffRows }
      ].forEach(({ key, rows }) => {
        (Array.isArray(rows) ? rows : []).forEach((row) => {
          if (
            idsEqual(row?.personId, personId)
            && rowBelongsToActiveOrg(row, activeOrgId)
            && isActiveSchoolIdentityRow(row)
          ) {
            addScheduleRoleOption(roleMap, key, 'school-record');
          }
        });
      });

      extractPersonRolesInOrg(person || reqUser.person || reqUser, activeOrgId).forEach((roleToken) => {
        const role = normalizeScheduleRole(roleToken);
        if (SCHEDULE_ROLE_META[role]) addScheduleRoleOption(roleMap, role, 'person-role');
      });
    } catch (_) {
      extractPersonRolesInOrg(reqUser.person || reqUser, activeOrgId).forEach((roleToken) => {
        const role = normalizeScheduleRole(roleToken);
        if (SCHEDULE_ROLE_META[role]) addScheduleRoleOption(roleMap, role, 'person-role');
      });
    }
  }

  const availableRoles = Array.from(roleMap.values());
  return {
    lockedPersonId: personId,
    lockedPersonName: getScheduleViewerName({ person, reqUser, personId }),
    availableRoles,
    selectedRole: availableRoles.length === 1 ? availableRoles[0].key : ''
  };
}

function toViewerScheduleAccess(capabilities = {}) {
  return {
    canSelectAnyPerson: capabilities.canSelectAnyPerson === true,
    activeOrgId: capabilities.activeOrgId || '',
    lockedPersonId: capabilities.lockedPersonId || '',
    lockedPersonName: capabilities.lockedPersonName || '',
    availableRoles: Array.isArray(capabilities.availableRoles) ? capabilities.availableRoles : [],
    selectedRole: capabilities.selectedRole || '',
    scopeId: capabilities.scopeId || '',
    scopeMode: capabilities.scopeMode || '',
    canDragCreateSessions: capabilities.canDragCreateSessions === true,
    canLoadAllSchedules: capabilities.canLoadAllSchedules === true,
    canUseGlobalComparison: capabilities.canUseGlobalComparison === true
  };
}

async function buildScheduleViewerAccess(reqUser = {}, options = {}) {
  const capabilities = await buildScheduleCapabilities(reqUser, options);
  return toViewerScheduleAccess(capabilities);
}

async function assertCanViewPersonSchedule(reqUser, targetPersonId, options = {}) {
  const capabilities = await buildScheduleCapabilities(reqUser, options);
  const normalizedTarget = normalizeId(targetPersonId);
  if (capabilities.canSelectAnyPerson) {
    return { capabilities, effectivePersonId: normalizedTarget };
  }
  const lockedPersonId = normalizeId(capabilities.lockedPersonId);
  if (!lockedPersonId) {
    throw new Error('Your user account is not linked to a school student, staff, or teacher profile.');
  }
  if (normalizedTarget && !idsEqual(normalizedTarget, lockedPersonId)) {
    throw new Error('You can only view your own school schedule.');
  }
  return { capabilities, effectivePersonId: lockedPersonId };
}

function buildRouteAccessContextFromRequest(req) {
  return schoolDataService.buildRouteAccessContext(req);
}

module.exports = {
  SCHEDULE_ROLE_META,
  SCOPE_MODES,
  normalizeId,
  normalizeScheduleRole,
  getActiveScheduleOrgId,
  getUserPersonId,
  isOperationAdminForSchedules,
  buildScheduleCapabilities,
  buildScheduleViewerAccess,
  toViewerScheduleAccess,
  assertCanViewPersonSchedule,
  resolveListScope,
  resolveAccessContext,
  buildRouteAccessContextFromRequest
};
