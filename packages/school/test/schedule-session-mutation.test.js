const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

const {
  isScheduledEditableSession,
  isSessionAdministrativelyLocked
} = require('../MVC/services/school/scheduleSessionMutationService');

test('isSessionAdministrativelyLocked detects explicit lock and approved timesheet lock', () => {
  assert.equal(isSessionAdministrativelyLocked({ locked: true }), true);
  assert.equal(isSessionAdministrativelyLocked({ locked: 'true' }), true);
  assert.equal(isSessionAdministrativelyLocked({ locked: false }), false);
});

test('isScheduledEditableSession requires scheduled status and unlocked session', () => {
  assert.equal(isScheduledEditableSession({ status: 'scheduled', locked: false }), true);
  assert.equal(isScheduledEditableSession({ status: 'completed', locked: false }), false);
  assert.equal(isScheduledEditableSession({ status: 'scheduled', locked: true }), false);
});

test('scheduleSessionMutationService rejects makeup and merge statuses with MANAGE_SESSION_REQUIRED', () => {
  const source = read('MVC/services/school/scheduleSessionMutationService.js');
  assert.match(source, /error\.code = 'MANAGE_SESSION_REQUIRED'/);
  assert.match(source, /makeUpRequired === true \|\| targetDefinition\?\.mergedSessionRequired === true/);
  assert.match(source, /SESSION_METADATA_CONFLICTS/);
  assert.match(source, /const \{ detectSessionConflicts \} = require\('\.\/sessionConflictDetectionService'\)/);
  assert.doesNotMatch(source, /^const sessionConflictDetectionService = require/m);
});

test('schedule routes expose saved session mutation endpoints', () => {
  const routeSource = read('MVC/routes/scheduleRoutes.js');
  assert.match(routeSource, /\/api\/update-class-session-schedule/);
  assert.match(routeSource, /\/api\/bulk-update-class-session-schedule/);
  assert.match(routeSource, /\/api\/update-class-session-status/);
  assert.match(routeSource, /\/api\/update-work-session-schedule/);
  assert.match(routeSource, /postUpdateClassSessionSchedule/);
  assert.match(routeSource, /postBulkUpdateClassSessionSchedule/);
  assert.match(
    routeSource,
    /\/api\/bulk-update-class-session-schedule'[\s\S]*?trackActionState\(SECTIONS\.SCHOOL_SCHEDULES,\s*OPERATIONS\.READ_ALL\),\s*\n\s*ctrl\.postBulkUpdateClassSessionSchedule/
  );
  assert.doesNotMatch(
    routeSource,
    /\/api\/bulk-update-class-session-schedule'[\s\S]*?requireToken:\s*true/
  );
  assert.match(routeSource, /postUpdateClassSessionStatus/);
  assert.match(routeSource, /postUpdateWorkSessionSchedule/);
});

test('master schedule bulk edit uses bulk update API instead of per-session posts', () => {
  const viewerSource = read('public/scripts/masterScheduleViewer.js');
  assert.match(viewerSource, /bulkUpdateClassSessionSchedule/);
  assert.match(viewerSource, /postBulkSavedSessionScheduleUpdates/);
  assert.match(viewerSource, /scheduleSavedBulkEditInFlight/);
  const bulkApplyIdx = viewerSource.indexOf('async function applyScheduleSavedBulkEditOverlay');
  const bulkFnSlice = viewerSource.slice(bulkApplyIdx, bulkApplyIdx + 4500);
  assert.doesNotMatch(bulkFnSlice, /applySavedSessionScheduleUpdate\(/);
});

test('master schedule status changes are not limited to scheduled sessions', () => {
  const viewerSource = read('public/scripts/masterScheduleViewer.js');
  assert.match(viewerSource, /function isClassSessionEligibleForStatusChange\(/);
  const statusFnIdx = viewerSource.indexOf('function canScheduleSessionChangeStatus(event)');
  const statusFnEnd = viewerSource.indexOf('function isScheduledClassSessionForQuickEdit(event)', statusFnIdx);
  const statusFnSlice = viewerSource.slice(statusFnIdx, statusFnEnd > statusFnIdx ? statusFnEnd : statusFnIdx + 400);
  assert.match(statusFnSlice, /isClassSessionEligibleForStatusChange\(event\)/);
  assert.doesNotMatch(statusFnSlice, /isScheduledClassSessionForQuickEdit\(event\)/);
  assert.doesNotMatch(statusFnSlice, /isScheduleOnScreenManageEnabled/);
});

test('master schedule context status picker does not require on-screen manage mode', () => {
  const viewerSource = read('public/scripts/masterScheduleViewer.js');
  const actionableIdx = viewerSource.indexOf('function isScheduleSessionContextStatusItemActionable(event, item)');
  const actionableEnd = viewerSource.indexOf('function buildScheduleSessionContextStatusPickerItemHtml', actionableIdx);
  const actionableSlice = viewerSource.slice(actionableIdx, actionableEnd > actionableIdx ? actionableEnd : actionableIdx + 500);
  assert.doesNotMatch(actionableSlice, /isScheduleOnScreenManageEnabled/);
  const classApplyIdx = viewerSource.indexOf('async function applyClassSessionStatusUpdate');
  const classApplyEnd = viewerSource.indexOf('async function applyWorkSessionStatusUpdate', classApplyIdx);
  const classApplySlice = viewerSource.slice(classApplyIdx, classApplyEnd > classApplyIdx ? classApplyEnd : classApplyIdx + 400);
  assert.doesNotMatch(classApplySlice, /isScheduleOnScreenManageEnabled/);
});
