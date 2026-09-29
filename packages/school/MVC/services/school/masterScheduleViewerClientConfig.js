'use strict';

const scheduleViewerPreferencesService = require('./scheduleViewerPreferencesService');

/**
 * Whitelisted client bootstrap for Master Schedule Viewer (no secrets / no full user object).
 */
function buildMasterScheduleViewerClientConfig({
  scheduleCapabilities = {},
  viewerScheduleAccess = {},
  initialScheduleViewerPrefs = null
} = {}) {
  const caps = scheduleCapabilities && typeof scheduleCapabilities === 'object' ? scheduleCapabilities : {};
  const access = viewerScheduleAccess && typeof viewerScheduleAccess === 'object' ? viewerScheduleAccess : {};

  const canSelectAnyPerson = caps.canSelectAnyPerson === true || access.canSelectAnyPerson === true;
  const canDragCreateSessions = caps.canDragCreateSessions === true || access.canDragCreateSessions === true;
  const canLoadAllSchedules = caps.canLoadAllSchedules === true || access.canLoadAllSchedules === true;
  const canDeleteClassSessions = caps.canDeleteClassSessions === true || access.canDeleteClassSessions === true;
  const canOpenRollingEnrollment = caps.canOpenRollingEnrollment === true || access.canOpenRollingEnrollment === true;
  const canUseGlobalComparison = caps.canUseGlobalComparison === true || access.canUseGlobalComparison === true;

  const scheduleRoles = Array.isArray(access.availableRoles) ? access.availableRoles : [];
  const defaultRole = access.selectedRole || (scheduleRoles.length >= 1 ? scheduleRoles[0].key : '');
  const lockedPersonId = access.lockedPersonId || caps.lockedPersonId || '';
  const lockedPersonName = access.lockedPersonName || caps.lockedPersonName || '';

  const prefs = initialScheduleViewerPrefs
    ? scheduleViewerPreferencesService.extractPreferences(initialScheduleViewerPrefs)
    : scheduleViewerPreferencesService.emptyPreferences();

  return {
    canSelectAnyPerson,
    canDragCreateSessions,
    canLoadAllSchedules,
    canDeleteClassSessions,
    canOpenRollingEnrollment,
    canUseGlobalComparison,
    initialScheduleRoles: scheduleRoles,
    initialDefaultRole: defaultRole,
    initialLockedPersonId: String(lockedPersonId || ''),
    initialLockedPersonName: String(lockedPersonName || ''),
    initialScheduleViewerPrefs: prefs,
    api: {
      viewerPreferences: '/school/schedules/api/viewer-preferences',
      commitStagedSessions: '/school/schedules/api/commit-staged-sessions',
      updateClassSessionSchedule: '/school/schedules/api/update-class-session-schedule',
      sessionManagementPolicy: '/school/schedules/api/session-management-policy',
      updateClassSessionStatus: '/school/schedules/api/update-class-session-status',
      updateWorkSessionSchedule: '/school/schedules/api/update-work-session-schedule',
      bulkDeleteSessionsPreview: '/school/schedules/api/bulk-delete-sessions/preview',
      bulkDeleteSessions: '/school/schedules/api/bulk-delete-sessions'
    },
    constants: {
      commitTimeoutMs: 120000,
      draftBackupKey: 'schoolMasterViewer.scheduleDraftBackup',
      draggableBlockSelector: '[data-event-type="schedule_draft"], .is-schedule-draft[data-session-id], [data-event-type="class_session"][data-schedule-editable="1"]'
    }
  };
}

module.exports = {
  buildMasterScheduleViewerClientConfig
};
