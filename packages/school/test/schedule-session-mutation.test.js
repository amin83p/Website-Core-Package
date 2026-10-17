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
