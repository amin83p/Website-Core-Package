const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const {
  createService,
  extractPreferences,
  sanitizeForAccess,
  mergePreferences,
  hasSavedPreferences,
  emptyPreferences
} = require('../MVC/services/school/scheduleViewerPreferencesService');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function readMasterScheduleViewerJs() {
  return [
    read('public/scripts/masterScheduleViewer.js'),
    read('public/scripts/masterScheduleViewerStaging.js')
  ].join('\n');
}

test('extractPreferences normalizes dates, persons, and autoChangeDetector', () => {
  const prefs = extractPreferences({
    startDate: '2026-09-01',
    endDate: '2026-09-07',
    activePersonId: 'P2',
    persons: [
      { id: 'P1', name: 'Alpha', selectedRole: 'teacher' },
      { id: 'P2', name: 'Beta' },
      { id: 'P1', name: 'Duplicate' }
    ],
    autoChangeDetector: false
  });

  assert.equal(prefs.startDate, '2026-09-01');
  assert.equal(prefs.endDate, '2026-09-07');
  assert.equal(prefs.activePersonId, 'P2');
  assert.equal(prefs.persons.length, 2);
  assert.equal(prefs.persons[0].id, 'P1');
  assert.equal(prefs.autoChangeDetector, false);
  assert.equal(prefs.timelineStartHour, 7);
  assert.equal(prefs.timelineEndHour, 22);
});

test('extractPreferences rejects invalid dates and defaults active person', () => {
  const prefs = extractPreferences({
    startDate: 'not-a-date',
    endDate: '2026-09-07',
    activePersonId: 'missing',
    persons: [{ id: 'P1', name: 'Alpha' }]
  });

  assert.equal(prefs.startDate, '');
  assert.equal(prefs.endDate, '2026-09-07');
  assert.equal(prefs.activePersonId, 'P1');
});

test('mergePreferences preserves existing values for partial updates', () => {
  const current = extractPreferences({
    startDate: '2026-09-01',
    endDate: '2026-09-07',
    activePersonId: 'P1',
    persons: [{ id: 'P1', name: 'Alpha' }],
    autoChangeDetector: true
  });
  const merged = mergePreferences(current, { autoChangeDetector: false });

  assert.equal(merged.startDate, '2026-09-01');
  assert.equal(merged.endDate, '2026-09-07');
  assert.equal(merged.persons.length, 1);
  assert.equal(merged.autoChangeDetector, false);
});

test('extractPreferences normalizes timeline hours and rejects invalid bounds', () => {
  const prefs = extractPreferences({
    timelineStartHour: 8,
    timelineEndHour: 18
  });
  assert.equal(prefs.timelineStartHour, 8);
  assert.equal(prefs.timelineEndHour, 18);

  const invalid = extractPreferences({
    timelineStartHour: 20,
    timelineEndHour: 21
  });
  assert.equal(invalid.timelineStartHour, 7);
  assert.equal(invalid.timelineEndHour, 22);
});

test('mergePreferences updates timeline hours without clearing workspace fields', () => {
  const current = extractPreferences({
    startDate: '2026-09-01',
    endDate: '2026-09-07',
    activePersonId: 'P1',
    persons: [{ id: 'P1', name: 'Alpha' }],
    timelineStartHour: 7,
    timelineEndHour: 22
  });
  const merged = mergePreferences(current, { timelineStartHour: 6, timelineEndHour: 20 });
  assert.equal(merged.startDate, '2026-09-01');
  assert.equal(merged.persons.length, 1);
  assert.equal(merged.timelineStartHour, 6);
  assert.equal(merged.timelineEndHour, 20);
});

test('emptyPreferences includes default timeline hours', () => {
  const prefs = emptyPreferences();
  assert.equal(prefs.timelineStartHour, 7);
  assert.equal(prefs.timelineEndHour, 22);
});

test('emptyPreferences includes default staged view padding weeks', () => {
  const prefs = emptyPreferences();
  assert.equal(prefs.stagedViewPaddingWeeksBefore, 2);
  assert.equal(prefs.stagedViewPaddingWeeksAfter, 2);
});

test('extractPreferences normalizes staged view padding weeks', () => {
  const prefs = extractPreferences({
    stagedViewPaddingWeeksBefore: 1,
    stagedViewPaddingWeeksAfter: 3
  });
  assert.equal(prefs.stagedViewPaddingWeeksBefore, 1);
  assert.equal(prefs.stagedViewPaddingWeeksAfter, 3);

  const clamped = extractPreferences({
    stagedViewPaddingWeeksBefore: -1,
    stagedViewPaddingWeeksAfter: 99
  });
  assert.equal(clamped.stagedViewPaddingWeeksBefore, 0);
  assert.equal(clamped.stagedViewPaddingWeeksAfter, 12);
});

test('normalizePersonEntry stores valid chip colors and drops invalid values', () => {
  const { extractPreferences } = require('../MVC/services/school/scheduleViewerPreferencesService');
  const prefs = extractPreferences({
    persons: [{
      id: 'P1',
      name: 'Alpha',
      chipBgColor: '#abc',
      chipTextColor: 'not-a-color'
    }]
  });
  assert.equal(prefs.persons.length, 1);
  assert.equal(prefs.persons[0].chipBgColor, '#aabbcc');
  assert.ok(!prefs.persons[0].chipTextColor);
});

test('mergePreferences updates staged view padding without clearing workspace fields', () => {
  const current = extractPreferences({
    startDate: '2026-09-01',
    endDate: '2026-09-07',
    activePersonId: 'P1',
    persons: [{ id: 'P1', name: 'Alpha' }]
  });
  const merged = mergePreferences(current, {
    stagedViewPaddingWeeksBefore: 0,
    stagedViewPaddingWeeksAfter: 4
  });
  assert.equal(merged.startDate, '2026-09-01');
  assert.equal(merged.persons.length, 1);
  assert.equal(merged.stagedViewPaddingWeeksBefore, 0);
  assert.equal(merged.stagedViewPaddingWeeksAfter, 4);
});

test('sanitizeForAccess keeps only locked person for non-admin viewers', () => {
  const prefs = extractPreferences({
    startDate: '2026-09-01',
    endDate: '2026-09-07',
    activePersonId: 'OTHER',
    persons: [
      { id: 'OTHER', name: 'Other Person' },
      { id: 'LOCKED', name: 'Locked Teacher', selectedRole: 'teacher' }
    ],
    autoChangeDetector: false
  });

  const sanitized = sanitizeForAccess(prefs, {
    canSelectAnyPerson: false,
    lockedPersonId: 'LOCKED',
    lockedPersonName: 'Locked Teacher'
  });

  assert.equal(sanitized.persons.length, 1);
  assert.equal(sanitized.persons[0].id, 'LOCKED');
  assert.equal(sanitized.activePersonId, 'LOCKED');
  assert.equal(sanitized.autoChangeDetector, false);
});

test('hasSavedPreferences detects meaningful workspace state', () => {
  assert.equal(hasSavedPreferences(emptyPreferences()), false);
  assert.equal(hasSavedPreferences({ startDate: '2026-09-01', endDate: '2026-09-07' }), true);
  assert.equal(hasSavedPreferences({ persons: [{ id: 'P1', name: 'Alpha' }] }), true);
});

test('savePreferences writes merged blob through userSettingsService', async () => {
  const writes = [];
  const service = createService({
    userSettingsService: {
      async getSettings() {
        return {
          schoolScheduleViewer: {
            startDate: '2026-08-01',
            endDate: '2026-08-07',
            persons: [{ id: 'P1', name: 'Alpha' }],
            autoChangeDetector: true
          }
        };
      },
      async setSettings(userId, settings, actor) {
        writes.push({ userId, settings, actor });
        return settings;
      }
    }
  });

  const saved = await service.savePreferences(
    'USER-1',
    {
      startDate: '2026-09-01',
      endDate: '2026-09-07',
      persons: [{ id: 'P2', name: 'Beta', selectedRole: 'teacher' }],
      activePersonId: 'P2'
    },
    { id: 'USER-1' },
    {
      access: {
        canSelectAnyPerson: true,
        lockedPersonId: '',
        lockedPersonName: ''
      }
    }
  );

  assert.equal(saved.activePersonId, 'P2');
  assert.equal(saved.persons.length, 1);
  assert.equal(saved.persons[0].id, 'P2');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].settings.schoolScheduleViewer.startDate, '2026-09-01');
});

test('savePreferences clears schoolScheduleViewer when workspace payload is empty', async () => {
  const writes = [];
  const service = createService({
    userSettingsService: {
      async getSettings() {
        return {
          schoolScheduleViewer: {
            startDate: '2026-09-01',
            endDate: '2026-09-07',
            persons: [{ id: 'P1', name: 'Alpha' }],
            autoChangeDetector: true
          },
          otherSetting: true
        };
      },
      async setSettings(userId, settings, actor) {
        writes.push({ userId, settings, actor });
        return settings;
      }
    }
  });

  const saved = await service.savePreferences(
    'USER-1',
    {
      startDate: '',
      endDate: '',
      activePersonId: '',
      persons: []
    },
    { id: 'USER-1' }
  );

  assert.equal(saved.persons.length, 0);
  assert.equal(saved.startDate, '');
  assert.equal(saved.endDate, '');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].settings.schoolScheduleViewer, undefined);
  assert.equal(writes[0].settings.otherSetting, true);
});

test('schedule routes expose viewer-preferences endpoints', () => {
  const routeSource = read('MVC/routes/scheduleRoutes.js');
  assert.match(routeSource, /\/api\/viewer-preferences/);
  assert.match(routeSource, /getScheduleViewerPreferences/);
  assert.match(routeSource, /saveScheduleViewerPreferences/);
});

test('personSchedule loads person chip color admin assets only for canSelectAnyPerson', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  const adminJs = read('public/scripts/masterScheduleViewerAdmin.js');
  assert.match(view, /if \(canSelectAnyPerson \|\| canDragCreateSessions\) \{ %>\s*<link rel="stylesheet" href="\/styles\/schedule-viewer-admin\.css"/s);
  assert.match(view, /if \(canSelectAnyPerson\) \{ %>\s*<script src="\/scripts\/masterScheduleViewerAdmin\.js"><\/script>/s);
  assert.match(adminJs, /schedule-person-chip-color-popover/);
  assert.match(adminJs, /chipBgColor/);
  const core = read('public/scripts/masterScheduleViewer.js');
  assert.match(core, /MasterScheduleViewerAdmin\.install/);
  assert.doesNotMatch(core, /schedule-person-chip-color-popover/);
  assert.match(core, /mapSchedulePersonsForPreferences/);
  assert.match(core, /handlePersonTabClick/);
});

test('personSchedule wires workspace save and user-settings restore', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  const source = readMasterScheduleViewerJs();

  assert.match(view, /masterScheduleViewerConfig/);
  assert.match(source, /data-schedule-save-workspace/);
  assert.match(source, /data-schedule-clear-workspace/);
  assert.match(source, /saveScheduleWorkspace/);
  assert.match(source, /clearScheduleWorkspace/);
  assert.match(source, /buildScheduleWorkspaceActionsHtml/);
  assert.match(source, /hasScheduleWorkspaceToSave\(\) && !hasServerSavedWorkspace\(\)/);
  assert.match(source, /queueScheduleWorkspaceAutoPersist/);
  assert.match(source, /putScheduleWorkspacePreferences/);
  assert.match(source, /suppressWorkspaceAutoPersist/);
  assert.match(source, /addedNewPerson[\s\S]*queueScheduleWorkspaceAutoPersist/);
  assert.match(source, /sch_startDate[\s\S]*queueScheduleWorkspaceAutoPersist/);
  assert.match(source, /data-schedule-workspace-actions/);
  assert.match(source, /schedule-person-tab-group--with-actions/);
  assert.match(source, /schedulePersonTabs.*addEventListener\('click'[\s\S]*data-schedule-save-workspace/);
  assert.match(source, /schedulePersonTabs.*addEventListener\('click'[\s\S]*data-schedule-clear-workspace/);
  const legendBlock = source.slice(
    source.indexOf('function renderScheduleControls'),
    source.indexOf('function groupEventsByDate')
  );
  assert.doesNotMatch(legendBlock, /schedule-viewbar-chips[\s\S]*data-schedule-workspace-actions/);
  assert.match(source, /initializeScheduleViewer/);
  assert.match(source, /loadAllSavedSchedulePersons/);
  assert.match(source, /SCHEDULE_VIEWER_PREFS_API/);
  assert.match(source, /persistScheduleViewerPreferencesPartial/);
  assert.doesNotMatch(source, /!canSelectAnyPerson \? buildScheduleWorkspace/);

  assert.match(source, /data-schedule-save-drafts/);
  assert.match(source, /data-schedule-day-size-toggle/);
  assert.match(source, /schedule-day-size-popover/);
  assert.match(source, /data-schedule-time-range-toggle/);
  assert.match(source, /data-schedule-staged-padding-toggle/);
  assert.match(source, /scheduleStagedPaddingPopoverHostHtml/);
  assert.match(source, /stagedViewPaddingWeeksBefore/);
  assert.match(source, /getStagedViewPaddingRangeOptions/);
  assert.match(source, /data-schedule-week-expand-time/);
  assert.match(source, /buildScheduleSaveDraftsButtonHtml/);
  assert.match(source, /commitScheduleDraftSessions/);
  assert.match(source, /SCHEDULE_COMMIT_STAGED_API/);
  assert.doesNotMatch(source, /SCHEDULE_AUTO_CHANGE_DETECTOR_KEY/);
});

test('schedule routes expose saved session mutation endpoints', () => {
  const routeSource = read('MVC/routes/scheduleRoutes.js');
  assert.match(routeSource, /\/api\/update-class-session-schedule/);
  assert.match(routeSource, /SCHOOL_CLASSES, OPERATIONS\.UPDATE/);
  assert.match(routeSource, /SCHOOL_ACTIVITIES, OPERATIONS\.UPDATE/);
});

test('personSchedule wires saved session schedule editing for admins', () => {
  const source = readMasterScheduleViewerJs();
  assert.match(source, /isScheduledClassSessionForQuickEdit/);
  assert.match(source, /isWorkSessionScheduleEvent/);
  assert.match(source, /data-schedule-editable="1"/);
  assert.match(source, /resolveWorkSessionEventFromTarget/);
  assert.match(source, /SCHEDULE_UPDATE_CLASS_SESSION_SCHEDULE_API/);
  assert.match(source, /applySavedSessionScheduleUpdate/);
  assert.match(source, /applyClassSessionStatusUpdate/);
  assert.match(source, /applyWorkSessionStatusUpdate/);
  assert.match(source, /requiresManageSession/);
  assert.match(source, /btn_scheduleSessionContextEdit/);
  assert.match(source, /openScheduleSavedSessionEditOverlay/);
  assert.match(source, /SCHEDULE_DRAGGABLE_BLOCK_SELECTOR/);
  assert.match(source, /shouldOpenSessionOnClick/);
  assert.match(source, /btn_scheduleSessionContextOpenSession/);
  assert.match(source, /rerenderScheduleSessionBlockFromState/);
  assert.match(source, /patchScheduleEventInState/);
});

test('status updates patch state and rerender single block instead of reloading schedule', () => {
  const source = readMasterScheduleViewerJs();
  const classStatusBlock = source.slice(source.indexOf('async function applyClassSessionStatusUpdate'), source.indexOf('async function applyWorkSessionStatusUpdate'));
  const workStatusBlock = source.slice(source.indexOf('async function applyWorkSessionStatusUpdate'), source.indexOf('function buildSessionManagerUrlForEvent'));
  assert.match(classStatusBlock, /showLoading\('Updating session status/);
  assert.match(classStatusBlock, /rerenderScheduleSessionBlockFromState/);
  assert.doesNotMatch(classStatusBlock, /loadSchedulePerson/);
  assert.match(workStatusBlock, /showLoading\('Updating work session status/);
  assert.match(workStatusBlock, /rerenderScheduleSessionBlockFromState/);
  assert.doesNotMatch(workStatusBlock, /loadSchedulePerson/);
});

test('schedule updates show waiting modal during applySavedSessionScheduleUpdate', () => {
  const source = readMasterScheduleViewerJs();
  const scheduleUpdateBlock = source.slice(
    source.indexOf('async function applySavedSessionScheduleUpdate'),
    source.indexOf('async function applyClassSessionStatusUpdate')
  );
  assert.match(scheduleUpdateBlock, /showLoading\(forceConflicts === true \? 'Saving session schedule/);
  assert.match(scheduleUpdateBlock, /'Updating session schedule\.\.\.'/);
  assert.match(scheduleUpdateBlock, /hideLoading\(\{ force: true \}\)/);
  assert.match(scheduleUpdateBlock, /loadingShown = false;\s*if \(deferPostUpdate\)/s);
  assert.match(scheduleUpdateBlock, /await uiConfirm/);
  assert.match(scheduleUpdateBlock, /acknowledgeLocalScheduleMutation/);
  assert.match(scheduleUpdateBlock, /revertSavedSessionScheduleInState/);
});

test('personSchedule uiAlert and uiConfirm route through window.showMessageModal', () => {
  const source = readMasterScheduleViewerJs();
  assert.match(source, /window\.showMessageModal/);
  assert.match(source, /inferScheduleAlertIcon/);
  assert.doesNotMatch(source, /return confirm\(/);
});

test('saved session bulk edit exposes markup and applies schedule per session without changing date', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  const source = read('public/scripts/masterScheduleViewer.js');
  assert.match(view, /btn_scheduleSessionContextEditSelected/);
  assert.match(view, /scheduleSavedBulkEditOverlay/);
  assert.match(view, /id="scheduleSavedBulkEditDate"[^>]*disabled/);
  assert.match(view, /data-saved-bulk-edit-duration="1"/);
  assert.match(source, /function getSelectedSavedClassSessionEvents/);
  assert.match(source, /function openScheduleSavedBulkEditOverlay/);
  assert.match(source, /isSavedSessionMultiSelectContextMenu/);
  assert.match(source, /Edit or delete selected sessions/);
  const bulkApplyBlock = source.slice(
    source.indexOf('async function applyScheduleSavedBulkEditOverlay'),
    source.indexOf('function isSavedSessionBulkContextMenu')
  );
  assert.match(bulkApplyBlock, /applySavedSessionScheduleUpdate\(\{/);
  assert.match(bulkApplyBlock, /date: sessionDate/);
  assert.match(bulkApplyBlock, /lookupSessionDate: sessionDate/);
  assert.match(bulkApplyBlock, /deferPostUpdate: true/);
});

test('commit staged sessions and bulk delete update state without reloading schedule', () => {
  const source = readMasterScheduleViewerJs();
  const staging = read('public/scripts/masterScheduleViewerStaging.js');
  const commitBlock = staging.slice(
    staging.indexOf('async function commitScheduleDraftSessions'),
    staging.indexOf('let scheduleStageEditAttemptId')
  );
  assert.match(commitBlock, /appendSavedClassSessionsToState/);
  assert.match(commitBlock, /acknowledgeLocalScheduleMutation/);
  assert.match(commitBlock, /loadSchedulePerson\(person, \{ silent: true \}\)/);
  assert.match(commitBlock, /totalAppended <= 0/);

  const bulkDeleteBlock = source.slice(
    source.indexOf('async function openScheduleBulkSessionDeleteModal'),
    source.indexOf('function isSavedSessionBulkContextMenu')
  );
  assert.match(bulkDeleteBlock, /removeSavedClassSessionsFromState/);
  assert.match(bulkDeleteBlock, /acknowledgeLocalScheduleMutation/);
  assert.doesNotMatch(bulkDeleteBlock, /loadSchedulePerson/);
});

test('Master Schedule Viewer loads holidays for the active date range', () => {
  const source = readMasterScheduleViewerJs();
  assert.match(source, /syncScheduleHolidayDates/);
  assert.match(source, /fetchScheduleHolidayDatesForRange/);
  assert.match(source, /\/school\/schedules\/api\/holiday-dates/);
  assert.match(source, /holidayDates:\s*getScheduleHolidayDatesForRender\(\)/);
  assert.match(source, /isScheduleHolidayDate\(dateStr\)/);
  assert.match(source, /refreshScheduleViewWithHolidays/);
});

test('schedule routes expose holiday dates for schedule viewers', () => {
  const routeSource = read('MVC/routes/scheduleRoutes.js');
  assert.match(routeSource, /\/api\/holiday-dates/);
  assert.match(routeSource, /getScheduleHolidayDatesInRange/);
  assert.match(routeSource, /SECTIONS\.SCHOOL_SCHEDULES,\s*OPERATIONS\.READ_ALL/);
});

test('staging session import refreshes holidays after expanding view range', () => {
  const staging = read('public/scripts/masterScheduleViewerStaging.js');
  assert.match(staging, /deps\.setDateRangeFromIso\(start, end\)[\s\S]*deps\.refreshScheduleViewWithHolidays\(\)/);
  const core = read('public/scripts/masterScheduleViewer.js');
  assert.match(core, /scheduleState\.holidayRangeKey = ''/);
});

test('Master Schedule Viewer active class filter chip is wired in personSchedule', () => {
  const source = readMasterScheduleViewerJs();
  assert.match(source, /activeClassFilterId/);
  assert.match(source, /buildScheduleActiveClassChipHtml/);
  assert.match(source, /isScheduleEventInActiveClassFocus/);
  assert.match(source, /result\.activeClasses/);
  assert.match(source, /is-schedule-class-filter-muted/);
  assert.match(source, /resolveScheduleStageClassFromActiveFilter/);
  assert.match(source, /syncScheduleActiveClassChipAfterStaging/);
  assert.doesNotMatch(source, /!classes\.length \|\| !scheduleState\.loadedPersonIds/);
});

test('Master Schedule Viewer session context menu opens rolling enrollment', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  const source = readMasterScheduleViewerJs();
  assert.match(view, /btn_scheduleSessionContextRollingEnrollment/);
  assert.match(view, /schedule-session-context-header-icon/);
  assert.match(view, /aria-label="Rolling Enrollment \(opens in new tab\)"/);
  assert.match(view, /aria-label="Manage Session \(opens in new tab\)"/);
  assert.match(view, /bi-calendar-week/);
  assert.match(view, /bi-easel2/);
  assert.match(view, /btn_scheduleSessionContextInfo/);
  assert.match(view, /aria-label="Session info"/);
  assert.match(view, /scheduleSessionContextInfoModal/);
  assert.match(source, /openScheduleSessionContextInfoModal/);
  assert.match(source, /buildScheduleSessionContextInfoHtml/);
  assert.match(source, /scheduleSessionContextMenuTitle/);
  assert.match(source, /\/school\/classes\/edit\//);
  assert.match(source, /buildRollingEnrollmentUrlForClass/);
  assert.match(source, /rolling-enrollment/);
  assert.match(source, /canOpenRollingEnrollment/);
  assert.doesNotMatch(view, /schedule-session-context-action.*btn_scheduleSessionContextRollingEnrollment/);
  assert.doesNotMatch(view, /schedule-session-context-action.*btn_scheduleSessionContextOpenSession/);
});

test('Master Schedule Viewer session context menu shows status chip with picker', () => {
  const source = readMasterScheduleViewerJs();
  assert.match(source, /scheduleSessionContextStatusChip/);
  assert.match(source, /scheduleSessionContextStatusPicker/);
  assert.match(source, /closeScheduleSessionContextStatusPicker/);
  assert.match(source, /isScheduleSessionContextStatusItemActionable/);
  assert.match(source, /schedule-session-context-status-chip-toggle/);
  const css = read('public/styles/session-calendar.css');
  assert.match(css, /\.schedule-session-context-status-chip-toggle/);
  assert.match(css, /flex-direction: row/);
});
