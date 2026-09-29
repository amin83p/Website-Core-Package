'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EJS_PATH = path.join(ROOT, 'packages/school/MVC/views/school/schedule/personSchedule.ejs');
const CORE_OUT = path.join(ROOT, 'packages/school/public/scripts/masterScheduleViewer.js');
const STAGING_OUT = path.join(ROOT, 'packages/school/public/scripts/masterScheduleViewerStaging.js');

const DEP_NAMES = new Set([
  'escapeHtml', 'scheduleState', 'uiAlert', 'uiConfirm', 'scheduleCalendarCore',
  'setDateRangeFromIso', 'setActiveRangeChip', 'schedulePersistDraftBackup',
  'fetchWithScheduleTimeout', 'SCHEDULE_COMMIT_STAGED_API', 'countAllPendingDraftSessions',
  'clearScheduleDraftBackup', 'getScheduleEventsForPerson', 'focusScheduleTimelineOnFirstStagedSession',
  'canDragCreateSessions', 'SCHEDULE_DRAGGABLE_BLOCK_SELECTOR', 'getEventTitle',
  'formatScheduleClockRange', 'timeToMinutes', 'calculatePosition', 'normalizeSessionStatus',
  'sessionStatusMetaMap', 'getStatusMeta', 'activeSchedulePerson', 'refreshScheduleActiveView',
  'loadActiveSchedulePerson', 'acknowledgeLocalScheduleMutation', 'getScheduleHolidayDatesForRender',
  'refreshScheduleViewWithHolidays', 'loadSchedulePerson',
  'buildSessionCaseBadgeHtml', 'TIMELINE_START_HOUR', 'TIMELINE_END_HOUR', 'TOTAL_MINUTES',
  'scheduleDraftSelectHtml', 'toggleDraftSessionSelection', 'isDraftSessionSelected',
  'getActiveDraftSelectionSet', 'clearActiveDraftSessionSelection', 'hasPendingDraftWorkForPerson',
  'resolveScheduleContextEventFromTarget', 'isScheduledClassSessionForQuickEdit',
  'canScheduleSessionChangeDate', 'canScheduleSessionChangeTime', 'formatSessionManagementBlockerMessage',
  'isScheduleEventMutableUnderClassFocus', 'selectedScheduleRole', 'syncScheduleActiveClassChipAfterStaging',
  'getScheduleRange', 'appendSavedClassSessionsToState', 'patchSavedClassSessionEventInState',
  'applySavedSessionScheduleUpdate', 'resolveStagingPassSessionIds', 'getSelectedDraftEvents',
  'updateScheduleDraftSelectedControls', 'selectDraftSessionsInStagingPass'
]);

const STAGING_EXPORTS = [
  'bindScheduleDragCreate',
  'resolveScheduleDraftEventFromTarget',
  'bindScheduleDraftSessionContextMenu',
  'commitScheduleDraftSessions',
  'getScheduleStageModalEl',
  'getDraftBatchesForPerson',
  'syncPartialModalFromTimelineDrafts',
  'isScheduleSavedSessionWorkActive',
  'isLatestScheduleSessionMutation',
  'buildScheduleDraftResizeHandlesHtml',
  'openScheduleDraftEditFromTarget',
  'isScheduleDraftEditInteractionTarget',
  'showScheduleDraftSessionContextMenu',
  'hideScheduleDraftEditOverlay',
  'hideScheduleDraftMoveOverlay',
  'openScheduleSavedSessionEditOverlay',
  'openScheduleSavedSessionMoveOverlay'
];

function readScriptBody() {
  const lines = fs.readFileSync(EJS_PATH, 'utf8').split(/\r?\n/);
  let body = lines.slice(363, 8407).join('\n');
  body = body.replace(/^<script>\n?/, '');
  return body;
}

function stripConfigInjections(body) {
  return body
    .replace(/const canSelectAnyPerson = <%- JSON\.stringify\(canSelectAnyPerson\) %>;\n?/g, '')
    .replace(/const canDragCreateSessions = <%- JSON\.stringify\(canDragCreateSessions\) %>;\n?/g, '')
    .replace(/const canLoadAllSchedules = <%- JSON\.stringify\(canLoadAllSchedules\) %>;\n?/g, '')
    .replace(/const canDeleteClassSessions = <%- JSON\.stringify\(canDeleteClassSessions\) %>;\n?/g, '')
    .replace(/const canOpenRollingEnrollment = <%- JSON\.stringify\(canOpenRollingEnrollment\) %>;\n?/g, '')
    .replace(/const initialScheduleRoles = <%- JSON\.stringify\(scheduleRoles\) %>;\n?/g, '')
    .replace(/const initialDefaultRole = <%- JSON\.stringify\(defaultRole\) %>;\n?/g, '')
    .replace(/const initialLockedPersonId = <%- JSON\.stringify\(lockedPersonId\) %>;\n?/g, '')
    .replace(/const initialLockedPersonName = <%- JSON\.stringify\(lockedPersonName\) %>;\n?/g, '')
    .replace(/const initialScheduleViewerPrefs = <%- JSON\.stringify\([\s\S]*?\) %>;\n?/g, '')
    .replace(/const SCHEDULE_VIEWER_PREFS_API = '[^']+';\n?/g, '')
    .replace(/const SCHEDULE_COMMIT_STAGED_API = '[^']+';\n?/g, '')
    .replace(/const SCHEDULE_COMMIT_TIMEOUT_MS = \d+;\n?/g, '')
    .replace(/const SCHEDULE_DRAFT_BACKUP_KEY = '[^']+';\n?/g, '')
    .replace(/const SCHEDULE_UPDATE_CLASS_SESSION_SCHEDULE_API = '[^']+';\n?/g, '')
    .replace(/const SCHEDULE_SESSION_MANAGEMENT_POLICY_API = '[^']+';\n?/g, '')
    .replace(/const SCHEDULE_UPDATE_CLASS_SESSION_STATUS_API = '[^']+';\n?/g, '')
    .replace(/const SCHEDULE_UPDATE_WORK_SESSION_SCHEDULE_API = '[^']+';\n?/g, '')
    .replace(/const SCHEDULE_BULK_DELETE_SESSIONS_PREVIEW_API = '[^']+';\n?/g, '')
    .replace(/const SCHEDULE_BULK_DELETE_SESSIONS_API = '[^']+';\n?/g, '')
    .replace(/const SCHEDULE_DRAGGABLE_BLOCK_SELECTOR = '[^']+';\n?/g, '');
}

function splitStaging(body) {
  const start = body.indexOf('<% if (canDragCreateSessions) { %>');
  const elseStart = body.indexOf('<% } else { %>', start);
  const end = body.indexOf('<% } %>', elseStart);
  if (start < 0 || elseStart < 0 || end < 0) throw new Error('staging markers not found');
  const partA = body.slice(0, start);
  let staging = body.slice(start, elseStart).replace(/^<% if \(canDragCreateSessions\) \{ %>\n?/, '');
  const partB = body.slice(end).replace(/^<% } %>\n?/, '');
  return { partA, staging, partB };
}

function rewriteDeps(code) {
  let out = code;
  const sorted = [...DEP_NAMES].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    out = out.replace(new RegExp(`\\b${name}\\b`, 'g'), `deps.${name}`);
  }
  return out;
}

function transformPartB(partB) {
  let out = partB;
  const adminStart = out.indexOf('<% if (canSelectAnyPerson) { %>');
  const adminEnd = out.indexOf('<% } %>', adminStart);
  if (adminStart >= 0 && adminEnd >= 0) {
    const before = out.slice(0, adminStart);
    const block = out.slice(adminStart, adminEnd).replace(/^<% if \(canSelectAnyPerson\) \{ %>\n?/, '');
    const after = out.slice(adminEnd).replace(/^<% } %>\n?/, '');
    out = `${before}if (canSelectAnyPerson) {\n${block}}\n${after}`;
  }
  out = out.replace(
    /<% if \(canLoadAllSchedules\) \{ %>\n([\s\S]*?)<% \} %>/g,
    'if (canLoadAllSchedules) {\n$1}'
  );
  return out;
}

function buildStagingModule(stagingBody) {
  const rewritten = rewriteDeps(stagingBody);
  const returnLines = STAGING_EXPORTS.map((name) => `      ${name}`).join(',\n');
  return `/* eslint-disable */\n(function (global) {\n  'use strict';\n\n  function installMasterScheduleStaging(deps) {\n${rewritten.split('\n').map((line) => `    ${line}`).join('\n')}\n    return {\n${returnLines}\n    };\n  }\n\n  global.MasterScheduleViewerStaging = { install: installMasterScheduleStaging };\n})(typeof window !== 'undefined' ? window : globalThis);\n`;
}

function buildCoreModule(partA, partB) {
  const configBootstrap = `
    const cfg = readMasterScheduleViewerConfig();
    const canSelectAnyPerson = cfg.canSelectAnyPerson === true;
    const canDragCreateSessions = cfg.canDragCreateSessions === true;
    const canLoadAllSchedules = cfg.canLoadAllSchedules === true;
    const canDeleteClassSessions = cfg.canDeleteClassSessions === true;
    const canOpenRollingEnrollment = cfg.canOpenRollingEnrollment === true;
    const initialScheduleRoles = Array.isArray(cfg.initialScheduleRoles) ? cfg.initialScheduleRoles : [];
    const initialDefaultRole = String(cfg.initialDefaultRole || '');
    const initialLockedPersonId = String(cfg.initialLockedPersonId || '');
    const initialLockedPersonName = String(cfg.initialLockedPersonName || '');
    const initialScheduleViewerPrefs = cfg.initialScheduleViewerPrefs && typeof cfg.initialScheduleViewerPrefs === 'object'
      ? cfg.initialScheduleViewerPrefs
      : {};
    const SCHEDULE_VIEWER_PREFS_API = String(cfg.api?.viewerPreferences || '/school/schedules/api/viewer-preferences');
    const SCHEDULE_COMMIT_STAGED_API = String(cfg.api?.commitStagedSessions || '/school/schedules/api/commit-staged-sessions');
    const SCHEDULE_COMMIT_TIMEOUT_MS = Number(cfg.constants?.commitTimeoutMs) || 120000;
    const SCHEDULE_DRAFT_BACKUP_KEY = String(cfg.constants?.draftBackupKey || 'schoolMasterViewer.scheduleDraftBackup');
    const SCHEDULE_UPDATE_CLASS_SESSION_SCHEDULE_API = String(cfg.api?.updateClassSessionSchedule || '/school/schedules/api/update-class-session-schedule');
    const SCHEDULE_SESSION_MANAGEMENT_POLICY_API = String(cfg.api?.sessionManagementPolicy || '/school/schedules/api/session-management-policy');
    const SCHEDULE_UPDATE_CLASS_SESSION_STATUS_API = String(cfg.api?.updateClassSessionStatus || '/school/schedules/api/update-class-session-status');
    const SCHEDULE_UPDATE_WORK_SESSION_SCHEDULE_API = String(cfg.api?.updateWorkSessionSchedule || '/school/schedules/api/update-work-session-schedule');
    const SCHEDULE_BULK_DELETE_SESSIONS_PREVIEW_API = String(cfg.api?.bulkDeleteSessionsPreview || '/school/schedules/api/bulk-delete-sessions/preview');
    const SCHEDULE_BULK_DELETE_SESSIONS_API = String(cfg.api?.bulkDeleteSessions || '/school/schedules/api/bulk-delete-sessions');
    const SCHEDULE_DRAGGABLE_BLOCK_SELECTOR = String(cfg.constants?.draggableBlockSelector || '[data-event-type="schedule_draft"], .is-schedule-draft[data-session-id], [data-event-type="class_session"][data-schedule-editable="1"]');
`;

  const stagingBridge = `
    let bindScheduleDragCreate = function bindScheduleDragCreate() {};
    let resolveScheduleDraftEventFromTarget = function resolveScheduleDraftEventFromTarget() { return null; };
    let bindScheduleDraftSessionContextMenu = function bindScheduleDraftSessionContextMenu() {};
    let commitScheduleDraftSessions = async function commitScheduleDraftSessions() {};
    let getScheduleStageModalEl = function getScheduleStageModalEl() { return null; };
    let getDraftBatchesForPerson = function getDraftBatchesForPerson() { return []; };
    let syncPartialModalFromTimelineDrafts = function syncPartialModalFromTimelineDrafts() {};
    let isScheduleSavedSessionWorkActive = function isScheduleSavedSessionWorkActive() { return false; };
    let isLatestScheduleSessionMutation = function isLatestScheduleSessionMutation() { return true; };
    let buildScheduleDraftResizeHandlesHtml = function buildScheduleDraftResizeHandlesHtml() { return ''; };
    let openScheduleDraftEditFromTarget = function openScheduleDraftEditFromTarget() {};
    let isScheduleDraftEditInteractionTarget = function isScheduleDraftEditInteractionTarget() { return false; };
    let showScheduleDraftSessionContextMenu = function showScheduleDraftSessionContextMenu() {};
    let hideScheduleDraftEditOverlay = function hideScheduleDraftEditOverlay() {};
    let hideScheduleDraftMoveOverlay = function hideScheduleDraftMoveOverlay() {};
    let openScheduleSavedSessionEditOverlay = function openScheduleSavedSessionEditOverlay() {};
    let openScheduleSavedSessionMoveOverlay = function openScheduleSavedSessionMoveOverlay() {};

    if (canDragCreateSessions && global.MasterScheduleViewerStaging && typeof global.MasterScheduleViewerStaging.install === 'function') {
      const stagingDeps = {
        escapeHtml, scheduleState, uiAlert, uiConfirm, scheduleCalendarCore,
        setDateRangeFromIso, setActiveRangeChip, schedulePersistDraftBackup,
        fetchWithScheduleTimeout, SCHEDULE_COMMIT_STAGED_API, countAllPendingDraftSessions,
        clearScheduleDraftBackup, getScheduleEventsForPerson, focusScheduleTimelineOnFirstStagedSession,
        canDragCreateSessions, SCHEDULE_DRAGGABLE_BLOCK_SELECTOR, getEventTitle,
        formatScheduleClockRange, timeToMinutes, calculatePosition, normalizeSessionStatus,
        sessionStatusMetaMap, getStatusMeta, activeSchedulePerson, refreshScheduleActiveView,
        loadActiveSchedulePerson, acknowledgeLocalScheduleMutation, getScheduleHolidayDatesForRender,
        refreshScheduleViewWithHolidays, loadSchedulePerson,
        buildSessionCaseBadgeHtml, TIMELINE_START_HOUR, TIMELINE_END_HOUR, TOTAL_MINUTES,
        scheduleDraftSelectHtml, toggleDraftSessionSelection, isDraftSessionSelected,
        getActiveDraftSelectionSet, clearActiveDraftSessionSelection, hasPendingDraftWorkForPerson,
        resolveScheduleContextEventFromTarget, isScheduledClassSessionForQuickEdit,
        canScheduleSessionChangeDate, canScheduleSessionChangeTime, formatSessionManagementBlockerMessage,
        isScheduleEventMutableUnderClassFocus, selectedScheduleRole, syncScheduleActiveClassChipAfterStaging,
        getScheduleRange, appendSavedClassSessionsToState, patchSavedClassSessionEventInState,
        applySavedSessionScheduleUpdate, resolveStagingPassSessionIds, getSelectedDraftEvents,
        updateScheduleDraftSelectedControls, selectDraftSessionsInStagingPass
      };
      const stagingExports = global.MasterScheduleViewerStaging.install(stagingDeps);
      if (stagingExports && typeof stagingExports === 'object') {
        if (typeof stagingExports.bindScheduleDragCreate === 'function') bindScheduleDragCreate = stagingExports.bindScheduleDragCreate;
        if (typeof stagingExports.resolveScheduleDraftEventFromTarget === 'function') resolveScheduleDraftEventFromTarget = stagingExports.resolveScheduleDraftEventFromTarget;
        if (typeof stagingExports.bindScheduleDraftSessionContextMenu === 'function') bindScheduleDraftSessionContextMenu = stagingExports.bindScheduleDraftSessionContextMenu;
        if (typeof stagingExports.commitScheduleDraftSessions === 'function') commitScheduleDraftSessions = stagingExports.commitScheduleDraftSessions;
        if (typeof stagingExports.getScheduleStageModalEl === 'function') getScheduleStageModalEl = stagingExports.getScheduleStageModalEl;
        if (typeof stagingExports.getDraftBatchesForPerson === 'function') getDraftBatchesForPerson = stagingExports.getDraftBatchesForPerson;
        if (typeof stagingExports.syncPartialModalFromTimelineDrafts === 'function') syncPartialModalFromTimelineDrafts = stagingExports.syncPartialModalFromTimelineDrafts;
        if (typeof stagingExports.isScheduleSavedSessionWorkActive === 'function') isScheduleSavedSessionWorkActive = stagingExports.isScheduleSavedSessionWorkActive;
        if (typeof stagingExports.isLatestScheduleSessionMutation === 'function') isLatestScheduleSessionMutation = stagingExports.isLatestScheduleSessionMutation;
        if (typeof stagingExports.buildScheduleDraftResizeHandlesHtml === 'function') buildScheduleDraftResizeHandlesHtml = stagingExports.buildScheduleDraftResizeHandlesHtml;
        if (typeof stagingExports.openScheduleDraftEditFromTarget === 'function') openScheduleDraftEditFromTarget = stagingExports.openScheduleDraftEditFromTarget;
        if (typeof stagingExports.isScheduleDraftEditInteractionTarget === 'function') isScheduleDraftEditInteractionTarget = stagingExports.isScheduleDraftEditInteractionTarget;
        if (typeof stagingExports.showScheduleDraftSessionContextMenu === 'function') showScheduleDraftSessionContextMenu = stagingExports.showScheduleDraftSessionContextMenu;
        if (typeof stagingExports.hideScheduleDraftEditOverlay === 'function') hideScheduleDraftEditOverlay = stagingExports.hideScheduleDraftEditOverlay;
        if (typeof stagingExports.hideScheduleDraftMoveOverlay === 'function') hideScheduleDraftMoveOverlay = stagingExports.hideScheduleDraftMoveOverlay;
        if (typeof stagingExports.openScheduleSavedSessionEditOverlay === 'function') openScheduleSavedSessionEditOverlay = stagingExports.openScheduleSavedSessionEditOverlay;
        if (typeof stagingExports.openScheduleSavedSessionMoveOverlay === 'function') openScheduleSavedSessionMoveOverlay = stagingExports.openScheduleSavedSessionMoveOverlay;
      }
    }
`;

  const header = `/* eslint-disable */\n(function (global) {\n  'use strict';\n\n  function readMasterScheduleViewerConfig() {\n    const el = document.getElementById('masterScheduleViewerConfig');\n    if (!el) return {};\n    try {\n      return JSON.parse(el.textContent || '{}');\n    } catch (_) {\n      return {};\n    }\n  }\n\n  document.addEventListener('DOMContentLoaded', () => {\n`;

  const footer = `\n  });\n})(typeof window !== 'undefined' ? window : globalThis);\n`;

  const innerA = partA.replace(/^document\.addEventListener\('DOMContentLoaded', \(\) => \{\n?/, '');
  let transformedB = transformPartB(partB);
  transformedB = transformedB.replace(/\n\}\);\s*$/, '\n');

  return header + configBootstrap + innerA + stagingBridge + transformedB + footer;
}

function main() {
  let body = readScriptBody();
  body = stripConfigInjections(body);
  const { partA, staging, partB } = splitStaging(body);
  fs.writeFileSync(STAGING_OUT, buildStagingModule(staging));
  fs.writeFileSync(CORE_OUT, buildCoreModule(partA, partB));
  console.log('Wrote', CORE_OUT);
  console.log('Wrote', STAGING_OUT);
}

main();
