'use strict';

/**
 * Thin school facade over core adminAuthorityService.
 * No privilege math here — only SCHOOL defaults + convenience viewers.
 */

const { requireCoreModule } = require('./schoolCoreContracts');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
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

function isTaskRoutingAdminViewer(user) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_TASKS, OPERATIONS.CONFIGURE);
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

function isSchedulesAdminViewer(user) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL);
}

function isCalendarAdminViewer(user) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_CALENDAR, OPERATIONS.READ_ALL);
}

function isExamsAdminViewer(user) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_EXAMS, OPERATIONS.READ_ALL);
}

function isAttendancesAdminViewer(user, operationId = OPERATIONS.UPDATE) {
  return isAdminForRequest(user, SECTIONS.SCHOOL_ATTENDANCES, operationId);
}

async function isAttendancesAdminViewerAsync(user, operationId = OPERATIONS.UPDATE) {
  return isAdminForRequestAsync(user, SECTIONS.SCHOOL_ATTENDANCES, operationId);
}

module.exports = {
  isSuperAdmin,
  isAdminForSection,
  isAdminForSectionAsync,
  isAdminForRequest,
  isAdminForRequestAsync,
  isTasksAdminViewer,
  isTaskRoutingAdminViewer,
  isReportsInstancesAdminViewer,
  isSessionsAdminViewer,
  isLeaveRequestsAdminViewer,
  isTimesheetsAdminViewer,
  isTimesheetsAdminViewerAsync,
  isTimesheetManagementAdminViewer,
  isTimesheetManagementAdminViewerAsync,
  isActivitiesAdminViewer,
  isActivitiesAdminViewerAsync,
  isSchedulesAdminViewer,
  isCalendarAdminViewer,
  isExamsAdminViewer,
  isAttendancesAdminViewer,
  isAttendancesAdminViewerAsync
};
