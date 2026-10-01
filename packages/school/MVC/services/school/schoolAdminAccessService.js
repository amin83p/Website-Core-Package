'use strict';

/**
 * Thin school facade over core adminAuthorityService.
 * No privilege math here — only SCHOOL defaults + convenience viewers.
 */

const { requireCoreModule } = require('./schoolCoreContracts');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const effectiveAccessResolverService = requireCoreModule('MVC/services/security/effectiveAccessResolverService');
const accessService = requireCoreModule('MVC/services/security/accessControl');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

function buildOrgContext(user, sectionId, extra = {}) {
  return {
    orgId: user?.activeOrgId,
    section: { id: sectionId, category: 'SCHOOL' },
    ...extra
  };
}

function isSuperAdmin(user) {
  return Boolean(adminAuthorityService.isSuperAdmin(user));
}

function isAdminForSection(user, sectionId, orgContext = {}) {
  return Boolean(adminAuthorityService.isAdminForSection(
    user,
    sectionId,
    buildOrgContext(user, sectionId, orgContext)
  ));
}

async function isAdminForSectionAsync(user, sectionId, orgContext = {}) {
  return Boolean(await adminAuthorityService.isAdminForSectionAsync(
    user,
    sectionId,
    buildOrgContext(user, sectionId, orgContext)
  ));
}

function isAdminForRequest(user, sectionId, operationId = OPERATIONS.READ_ALL, orgContext = {}) {
  return Boolean(adminAuthorityService.isAdminForRequest(
    user,
    sectionId,
    operationId,
    buildOrgContext(user, sectionId, orgContext)
  ));
}

async function isAdminForRequestAsync(user, sectionId, operationId = OPERATIONS.READ_ALL, orgContext = {}) {
  return Boolean(await adminAuthorityService.isAdminForRequestAsync(
    user,
    sectionId,
    operationId,
    buildOrgContext(user, sectionId, orgContext)
  ));
}

function isTasksAdminViewer(user) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_TASKS, OPERATIONS.READ_ALL);
}

function isNotificationCenterAdminViewer(user) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_NOTIFICATION_CENTER, OPERATIONS.READ_ALL);
}

function isTaskRoutingAdminViewer(user) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_TASKS, OPERATIONS.CONFIGURE);
}

function isStudentCaseRoutingAdminViewer(user) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_SESSION_STUDENT_CASES, OPERATIONS.CONFIGURE);
}

function isReportsInstancesAdminViewer(user) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_REPORTS_INSTANCES, OPERATIONS.READ_ALL);
}

function isSessionsAdminViewer(user) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_SESSIONS, OPERATIONS.READ_ALL);
}

function isLeaveRequestsAdminViewer(user) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_LEAVE_REQUESTS, OPERATIONS.READ_ALL);
}

function isTimesheetsAdminViewer(user, operationId = OPERATIONS.READ_ALL) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_TIMESHEETS, operationId);
}

async function isTimesheetsAdminViewerAsync(user, operationId = OPERATIONS.READ_ALL) {
  return isAdminForRequestAsync(user, SECTIONS.SCHOOL_TIMESHEETS, operationId);
}

function isTimesheetManagementAdminViewer(user, operationId = OPERATIONS.READ_ALL) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, operationId);
}

async function isTimesheetManagementAdminViewerAsync(user, operationId = OPERATIONS.READ_ALL) {
  return isAdminForRequestAsync(user, SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, operationId);
}

function isActivitiesAdminViewer(user, operationId = OPERATIONS.READ_ALL) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_ACTIVITIES, operationId);
}

async function isActivitiesAdminViewerAsync(user, operationId = OPERATIONS.READ_ALL) {
  return isAdminForRequestAsync(user, SECTIONS.SCHOOL_ACTIVITIES, operationId);
}

function isWorkSessionsAdminViewer(user, operationId = OPERATIONS.READ_ALL) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_WORK_SESSIONS, operationId);
}

async function isWorkSessionsAdminViewerAsync(user, operationId = OPERATIONS.READ_ALL) {
  return isAdminForRequestAsync(user, SECTIONS.SCHOOL_WORK_SESSIONS, operationId);
}

function isSchedulesAdminViewer(user) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL);
}

async function isSchedulesAdminViewerAsync(user) {
  return isAdminForRequestAsync(user, SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL);
}

function isCalendarAdminViewer(user) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_CALENDAR, OPERATIONS.READ_ALL);
}

function isExamsAdminViewer(user) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_EXAMS, OPERATIONS.READ_ALL);
}

async function canSelectAdminSessionStatuses(user) {
  return isAdminForRequestAsync(user, SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE);
}

function isAttendancesAdminViewer(user, operationId = OPERATIONS.UPDATE) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_ATTENDANCES, operationId);
}

async function isAttendancesAdminViewerAsync(user, operationId = OPERATIONS.UPDATE) {
  return isAdminForRequestAsync(user, SECTIONS.SCHOOL_ATTENDANCES, operationId);
}

function isFamilyABypassAdminAuthority(authority = {}) {
  return Boolean(authority?.isSuperAdmin || authority?.isSectionAdmin);
}

function isFamilyBReadAllOrgOrAdminScope(scopeMode = '') {
  return scopeMode === 'organization' || scopeMode === 'admin';
}

async function evaluateReadAllTimesheetAccess(user, sectionId, orgId) {
  return accessService.evaluateAccess({
    user,
    sectionId,
    operationId: OPERATIONS.READ_ALL,
    orgId,
    ipAddress: ''
  });
}

async function canViewStatHolidayPayWarningsPanelAsync(user) {
  if (!user) return false;
  const orgId = user?.activeOrgId;
  const operationId = OPERATIONS.READ_ALL;
  const readAllSections = [SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, SECTIONS.SCHOOL_TIMESHEETS];

  for (const sectionId of readAllSections) {
    const authority = await adminAuthorityService.resolveAdminAuthorityAsync({
      user,
      sectionId,
      operationId,
      orgId,
      section: { id: sectionId, category: 'SCHOOL' }
    });
    if (isFamilyABypassAdminAuthority(authority)) {
      return true;
    }
    if (authority.isOperationAdminForRequest) {
      return true;
    }

    const evaluation = await evaluateReadAllTimesheetAccess(user, sectionId, orgId);
    if (!evaluation?.allowed) continue;
    if (isFamilyABypassAdminAuthority(evaluation.adminContext || {})) {
      return true;
    }
    const scopeId = String(
      evaluation.scopeId || evaluation.effectiveAccess?.operation?.scopeId || ''
    ).trim();
    const scopeMode = scopeId ? await effectiveAccessResolverService.getScopeMode(scopeId) : '';
    if (isFamilyBReadAllOrgOrAdminScope(scopeMode)) {
      return true;
    }
  }

  return false;
}

async function evaluateWorkSessionUpdateAccess(user, sectionId, orgId) {
  return accessService.evaluateAccess({
    user,
    sectionId,
    operationId: OPERATIONS.UPDATE,
    orgId,
    ipAddress: ''
  });
}

async function canEditAssigneeTimingAsync(user) {
  if (!user) return false;
  const orgId = user?.activeOrgId;
  const operationId = OPERATIONS.UPDATE;
  const sections = [SECTIONS.SCHOOL_WORK_SESSIONS, SECTIONS.SCHOOL_ACTIVITIES];

  for (const sectionId of sections) {
    const authority = await adminAuthorityService.resolveAdminAuthorityAsync({
      user,
      sectionId,
      operationId,
      orgId,
      section: { id: sectionId, category: 'SCHOOL' }
    });
    if (isFamilyABypassAdminAuthority(authority)) {
      return true;
    }
    if (authority.isOperationAdminForRequest) {
      return true;
    }

    const evaluation = await evaluateWorkSessionUpdateAccess(user, sectionId, orgId);
    if (!evaluation?.allowed) continue;
    if (isFamilyABypassAdminAuthority(evaluation.adminContext || {})) {
      return true;
    }
    const scopeId = String(
      evaluation.scopeId || evaluation.effectiveAccess?.operation?.scopeId || ''
    ).trim();
    const scopeMode = scopeId ? await effectiveAccessResolverService.getScopeMode(scopeId) : '';
    if (isFamilyBReadAllOrgOrAdminScope(scopeMode)) {
      return true;
    }
  }

  return false;
}

async function canRevertCompletedSessionStatusAsync(user) {
  if (!user) return false;
  const orgId = user?.activeOrgId;
  const operationId = OPERATIONS.UPDATE;
  const sectionId = SECTIONS.SCHOOL_SESSIONS;

  const authority = await adminAuthorityService.resolveAdminAuthorityAsync({
    user,
    sectionId,
    operationId,
    orgId,
    section: { id: sectionId, category: 'SCHOOL' }
  });
  if (isFamilyABypassAdminAuthority(authority)) {
    return true;
  }
  if (authority.isOperationAdminForRequest) {
    return true;
  }

  const evaluation = await accessService.evaluateAccess({
    user,
    sectionId,
    operationId,
    orgId,
    ipAddress: ''
  });
  if (!evaluation?.allowed) return false;
  if (isFamilyABypassAdminAuthority(evaluation.adminContext || {})) {
    return true;
  }
  const scopeId = String(
    evaluation.scopeId || evaluation.effectiveAccess?.operation?.scopeId || ''
  ).trim();
  const scopeMode = scopeId ? await effectiveAccessResolverService.getScopeMode(scopeId) : '';
  return isFamilyBReadAllOrgOrAdminScope(scopeMode);
}

module.exports = {
  isSuperAdmin,
  isAdminForSection,
  isAdminForSectionAsync,
  isAdminForRequest,
  isAdminForRequestAsync,
  isTasksAdminViewer,
  isNotificationCenterAdminViewer,
  isTaskRoutingAdminViewer,
  isStudentCaseRoutingAdminViewer,
  isReportsInstancesAdminViewer,
  isSessionsAdminViewer,
  canSelectAdminSessionStatuses,
  isLeaveRequestsAdminViewer,
  isTimesheetsAdminViewer,
  isTimesheetsAdminViewerAsync,
  isTimesheetManagementAdminViewer,
  isTimesheetManagementAdminViewerAsync,
  isActivitiesAdminViewer,
  isActivitiesAdminViewerAsync,
  isWorkSessionsAdminViewer,
  isWorkSessionsAdminViewerAsync,
  isSchedulesAdminViewer,
  isSchedulesAdminViewerAsync,
  isCalendarAdminViewer,
  isExamsAdminViewer,
  isAttendancesAdminViewer,
  isAttendancesAdminViewerAsync,
  canViewStatHolidayPayWarningsPanelAsync,
  canEditAssigneeTimingAsync,
  canRevertCompletedSessionStatusAsync,
  isFamilyABypassAdminAuthority
};
