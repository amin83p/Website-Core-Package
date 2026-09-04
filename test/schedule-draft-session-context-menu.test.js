const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('person schedule includes draft session context menu and attempt tracking', () => {
  const view = read('packages/school/MVC/views/school/schedule/personSchedule.ejs');
  const partial = read('packages/school/MVC/views/school/partials/scheduleDraftSessionContextMenu.ejs');
  assert.match(partial, /id="scheduleDraftSessionContextMenu"/);
  assert.match(partial, /id="scheduleDraftAttemptPickerModal"/);
  assert.match(view, /scheduleDraftSessionContextMenu/);
  assert.match(view, /bindScheduleDraftSessionContextMenu/);
  assert.match(view, /draftBatchesByPersonId/);
  assert.match(view, /resolveScheduleDraftEventFromTarget/);
  assert.match(view, /data-event-type="schedule_draft"/);
  assert.match(view, /stagingAttemptId/);
  assert.match(view, /session-enrollment-stage-standalone/);
  assert.match(view, /overlay\.style\.display = 'flex'/);
  assert.match(view, /runScheduleDraftDeleteAll\(event, source\)/);
  assert.match(view, /runScheduleDraftEditAll\(event, source\)/);
});

test('bindCalendarDragCreate requires drag before completing', () => {
  const core = read('packages/school/public/scripts/sessionCalendarCore.js');
  const dragCreateBlock = core.slice(core.indexOf('function bindCalendarDragCreate'), core.indexOf('function bindCalendarDragMove'));
  assert.match(dragCreateBlock, /if \(!state\.dragged\) \{/);
  assert.doesNotMatch(dragCreateBlock, /anchorSnappedOffset \+ 60/);
  assert.match(dragCreateBlock, /onDragCancelled/);
});

test('bindCalendarDragMove preserves fixed duration at timeline end', () => {
  const core = read('packages/school/public/scripts/sessionCalendarCore.js');
  assert.match(core, /resolveDayCellFromVerticalRow/);
  assert.match(core, /endOffset > TOTAL_MINUTES/);
  assert.match(core, /snappedStart = Math\.max\(0, endOffset - fixedDuration\)/);
});

test('partial calendar modal guards staged draft menu to partial mode', () => {
  const modal = read('packages/school/public/scripts/sessionEnrollmentCalendarModal.js');
  assert.match(modal, /isPartialMode\(\) && eventRow\?\.isStaged === true/);
  assert.match(modal, /ScheduleDraftSessionMenu/);
  assert.match(modal, /stagingAttempts/);
  assert.match(modal, /syncFromParentDrafts/);
  assert.match(modal, /deleteStagedSession/);
  assert.match(modal, /editStagedAttempt/);
});

test('session calendar core exports draft move and conflict helpers', () => {
  const core = read('packages/school/public/scripts/sessionCalendarCore.js');
  assert.match(core, /function checkScheduleTimeConflict/);
  assert.match(core, /function bindCalendarDragMove/);
  assert.match(core, /checkScheduleTimeConflict,/);
  assert.match(core, /bindCalendarDragMove,/);
});

test('session-calendar.css includes draft context-menu cursor styles', () => {
  const css = read('public/styles/session-calendar.css');
  assert.match(css, /\.is-schedule-draft/);
  assert.match(css, /data-event-type="schedule_draft"/);
  assert.match(css, /cursor:\s*context-menu/);
  assert.match(css, /is-schedule-draft-moving/);
});

test('person schedule filters blocking events for conflict checks', () => {
  const view = read('packages/school/MVC/views/school/schedule/personSchedule.ejs');
  assert.match(view, /function doesScheduleEventBlockConflicts/);
  assert.match(view, /scheduleDisplayOnly !== true && event\?\.blocksConflicts !== false/);
  assert.match(view, /\.filter\(\(ev\) => doesScheduleEventBlockConflicts\(ev\)\)/);
});

test('commitScheduleStageCreate passes full schedule as existingSessions', () => {
  const view = read('packages/school/MVC/views/school/schedule/personSchedule.ejs');
  const block = view.slice(view.indexOf('async function commitScheduleStageCreate'), view.indexOf('function openScheduleStageModal'));
  assert.match(block, /existingSessions:\s*collectScheduleConflictSessionsForPerson/);
  assert.match(block, /conflictScheduleEvents\s*=\s*collectScheduleConflictSessionsForPerson/);
});

test('applyDraftStagedSessionsToSchedule merges batches by attemptId', () => {
  const view = read('packages/school/MVC/views/school/schedule/personSchedule.ejs');
  const block = view.slice(view.indexOf('function applyDraftStagedSessionsToSchedule'), view.indexOf('async function commitScheduleStageCreate'));
  assert.match(block, /payloadAttemptIds/);
  assert.match(block, /!payloadAttemptIds\.has\(attemptId\)/);
  assert.match(block, /payloadBatchById/);
  assert.match(block, /keptBatches/);
  assert.match(block, /keptDrafts/);
});

test('bindCalendarDragMove uses X-based day column resolution', () => {
  const core = read('packages/school/public/scripts/sessionCalendarCore.js');
  assert.match(core, /function resolveDayCellFromDaysRowX/);
  const dragMoveBlock = core.slice(core.indexOf('function bindCalendarDragMove'), core.indexOf('function clearVerticalTimeHover'));
  assert.match(dragMoveBlock, /resolveDayCellFromDaysRowX/);
  assert.match(dragMoveBlock, /is-schedule-draft-moving/);
});

test('partial modal merges conflictScheduleEvents into conflict checks', () => {
  const modal = read('packages/school/public/scripts/sessionEnrollmentCalendarModal.js');
  assert.match(modal, /conflictScheduleEvents/);
  assert.match(modal, /getPartialBlockingScheduleEvents/);
  assert.match(modal, /existingSessions:\s*getPartialBlockingScheduleEvents\(\)/);
});

test('uiConfirm uses explicit Yes/No buttons', () => {
  const view = read('packages/school/MVC/views/school/schedule/personSchedule.ejs');
  assert.match(view, /return res === 'Yes'/);
  assert.match(view, /text: 'No', class: 'btn-secondary btn-md'/);
  assert.match(view, /text: 'Yes', class: 'btn-danger btn-md'/);
  assert.doesNotMatch(view, /type: 'confirm'/);
});

test('delete all staged routes through promptDeleteDraftAttempt', () => {
  const view = read('packages/school/MVC/views/school/schedule/personSchedule.ejs');
  assert.match(view, /async function promptDeleteDraftAttempt/);
  assert.match(view, /void promptDeleteDraftAttempt\(attempts\[0\]\.attemptId, source\)/);
  assert.match(view, /void promptDeleteDraftAttempt\(attemptId, pickerSource\)/);
});

test('bindCalendarDragResize is exported for draft duration resize', () => {
  const core = read('packages/school/public/scripts/sessionCalendarCore.js');
  assert.match(core, /function bindCalendarDragResize/);
  assert.match(core, /bindCalendarDragResize,/);
  assert.match(core, /session-cal-draft-resize-handle/);
});

test('draft blocks include resize handle markup', () => {
  const view = read('packages/school/MVC/views/school/schedule/personSchedule.ejs');
  assert.match(view, /buildScheduleDraftResizeHandlesHtml/);
  assert.match(view, /session-cal-draft-resize-handle-top/);
});

test('schedule loaded chip includes auto-detect toggle', () => {
  const view = read('packages/school/MVC/views/school/schedule/personSchedule.ejs');
  assert.match(view, /initialScheduleViewerPrefs/);
  assert.match(view, /persistScheduleViewerPreferencesPartial/);
  assert.match(view, /data-schedule-auto-detect-toggle/);
  assert.match(view, /schedule-loaded-at-wrap/);
  assert.match(view, /schedule-loaded-at-chip-shell/);
  assert.match(view, /function isScheduleDraftWorkActive/);
});

test('draft context menu includes move session modal and omits adjust start time', () => {
  const partial = read('packages/school/MVC/views/school/partials/scheduleDraftSessionContextMenu.ejs');
  assert.doesNotMatch(partial, /btn_scheduleDraftContextAdjustStart/);
  assert.doesNotMatch(partial, /Adjust start time/);
  assert.match(partial, /btn_scheduleDraftContextMoveSession/);
  assert.match(partial, /Move session/);
  assert.match(partial, /id="scheduleDraftMoveOverlay"/);
  const view = read('packages/school/MVC/views/school/schedule/personSchedule.ejs');
  assert.match(view, /openScheduleDraftMoveOverlay/);
  assert.match(view, /moveStagedSession/);
});

test('double-click on staged sessions opens edit overlay in master schedule and partial modal', () => {
  const view = read('packages/school/MVC/views/school/schedule/personSchedule.ejs');
  const modal = read('packages/school/public/scripts/sessionEnrollmentCalendarModal.js');
  assert.match(view, /visualArea\.addEventListener\('dblclick'/);
  assert.match(view, /openScheduleDraftEditFromTarget/);
  assert.match(view, /openScheduleDraftEditOverlay\(draftEvent, source\)/);
  assert.match(modal, /handleHostDblClick/);
  assert.match(modal, /addEventListener\('dblclick', handleHostDblClick\)/);
  assert.match(modal, /ScheduleDraftSessionMenu\.openEditOverlay\(eventRow, 'partialModal'\)/);
});

test('staged session multi-select state, controls, and bulk actions', () => {
  const view = read('packages/school/MVC/views/school/schedule/personSchedule.ejs');
  const partial = read('packages/school/MVC/views/school/partials/scheduleDraftSessionContextMenu.ejs');
  const modal = read('packages/school/public/scripts/sessionEnrollmentCalendarModal.js');
  assert.match(view, /selectedDraftSessionIdsByPersonId/);
  assert.match(view, /scheduleDraftSelectHtml/);
  assert.match(view, /data-schedule-draft-select/);
  assert.match(view, /Clear staged session selections before selecting saved sessions/);
  assert.match(view, /Clear saved session selections before selecting staged sessions/);
  assert.match(view, /data-schedule-save-workspace/);
  assert.match(view, /saveScheduleWorkspace/);
  assert.match(view, /data-schedule-clear-all-selected/);
  assert.match(view, /clearAllScheduleSelections/);
  assert.match(view, /Staged sessions, selections, and other unsaved changes are not saved/);
  assert.match(view, /openBulkEditOverlay/);
  assert.match(view, /applyBulkDraftSessionTimes/);
  assert.match(view, /promptDeleteSelectedDraftSessions/);
  assert.match(partial, /scheduleDraftSessionContextMenuBulk/);
  assert.match(partial, /btn_scheduleDraftContextEditAllSelected/);
  assert.match(partial, /btn_scheduleDraftContextDeleteAllSelected/);
  assert.match(partial, /scheduleDraftBulkEditOverlay/);
  assert.match(partial, /scheduleDraftBulkEditStartTime/);
  assert.match(partial, /scheduleDraftBulkEditEndTime/);
  assert.match(modal, /buildPartialEnrollmentBlockHtml/);
  assert.match(modal, /deleteSelectedStagedSessions/);
  assert.match(modal, /applyBulkStagedSessionTimes/);
});

test('session-calendar.css includes draft multi-select toolbar styles', () => {
  const css = read('packages/school/public/styles/session-calendar.css');
  assert.match(css, /\.schedule-draft-select/);
  assert.match(css, /\.schedule-save-drafts-btn/);
});

test('saved session schedule editing styles and context menu wiring', () => {
  const css = read('packages/school/public/styles/session-calendar.css');
  const view = read('packages/school/MVC/views/school/schedule/personSchedule.ejs');
  assert.match(css, /\.schedule-session-context-status-item\.is-actionable/);
  assert.match(css, /\[data-event-type="class_session"\]\[data-schedule-editable="1"\]/);
  assert.match(view, /data-schedule-session-status/);
  assert.match(view, /data-requires-manage-session/);
  assert.match(view, /buildWorkSessionStatusMenuItems/);
  assert.match(view, /shouldOpenSessionOnClick/);
  assert.match(view, /buildScheduleSessionBlockClickHandler/);
  assert.match(view, /btn_scheduleSessionContextOpenSession/);
  assert.match(view, /rerenderScheduleSessionBlockFromState/);
});
