const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const schoolDependencyService = require('../packages/school/MVC/services/school/schoolDependencyService');

test('forceUnlockActivityEntryTimesheetLocks clears entry and assignee locks without timesheet id match', () => {
  const activity = {
    id: 'act-1',
    locked: true,
    lockReason: 'timesheet_approved',
    lockedTimesheetId: 'ts-missing',
    entries: [{
      entryId: 'ENTRY-1',
      locked: true,
      lockReason: 'timesheet_approved',
      lockedTimesheetId: 'ts-missing',
      assignees: [{
        personId: 'p1',
        locked: true,
        lockReason: 'timesheet_approved',
        lockedTimesheetId: 'ts-missing'
      }]
    }, {
      entryId: 'ENTRY-2',
      locked: false,
      assignees: []
    }]
  };

  const result = schoolDependencyService.forceUnlockActivityEntryTimesheetLocks({
    activity,
    entryId: 'ENTRY-1',
    reqUser: { id: 'admin-1' },
    note: 'Orphaned after timesheet purge'
  });

  assert.equal(result.changed, true);
  assert.equal(result.entryId, 'ENTRY-1');
  const entry = result.activity.entries.find((row) => row.entryId === 'ENTRY-1');
  assert.equal(entry.locked, false);
  assert.equal(entry.lockReason, undefined);
  assert.equal(entry.lockedTimesheetId, undefined);
  assert.ok(entry.unlockedAt);
  assert.equal(entry.assignees[0].locked, false);
  assert.equal(entry.assignees[0].lockReason, undefined);
  assert.equal(result.activity.locked, false);
});

test('forceUnlockAllActivityTimesheetLocks clears only orphans and leaves live timesheet locks', () => {
  const activity = {
    id: 'act-2',
    locked: true,
    lockReason: 'timesheet_approved',
    entries: [{
      entryId: 'ENTRY-1',
      date: '2026-01-10',
      locked: true,
      lockReason: 'timesheet_approved',
      lockedTimesheetId: 'ts-gone',
      assignees: []
    }, {
      entryId: 'ENTRY-2',
      locked: true,
      lockReason: 'timesheet_approved',
      lockedTimesheetId: 'ts-live',
      assignees: []
    }, {
      entryId: 'ENTRY-3',
      locked: false,
      assignees: [{
        personId: 'p2',
        locked: true,
        lockReason: 'timesheet_approved',
        lockedTimesheetId: 'ts-gone'
      }]
    }]
  };

  const result = schoolDependencyService.forceUnlockAllActivityTimesheetLocks({
    activity,
    reqUser: { id: 'admin-1' },
    note: 'Cleanup orphan locks',
    existingTimesheetIds: ['ts-live']
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.unlockedEntryIds.sort(), ['ENTRY-1', 'ENTRY-3']);
  assert.deepEqual(result.skippedLiveLockEntryIds, ['ENTRY-2']);

  const orphan1 = result.activity.entries.find((row) => row.entryId === 'ENTRY-1');
  const live = result.activity.entries.find((row) => row.entryId === 'ENTRY-2');
  const orphan3 = result.activity.entries.find((row) => row.entryId === 'ENTRY-3');
  assert.equal(orphan1.locked, false);
  assert.equal(live.locked, true);
  assert.equal(live.lockedTimesheetId, 'ts-live');
  assert.equal(orphan3.assignees[0].locked, false);
  assert.equal(result.activity.locked, true);
});

test('listOrphanTimesheetLockedActivityEntries returns only orphan work sessions', () => {
  const activity = {
    entries: [{
      entryId: 'ENTRY-1',
      date: '2026-02-01',
      locked: true,
      lockReason: 'timesheet_approved',
      lockedTimesheetId: 'missing'
    }, {
      entryId: 'ENTRY-2',
      locked: true,
      lockReason: 'timesheet_approved',
      lockedTimesheetId: 'still-here'
    }]
  };
  const orphans = schoolDependencyService.listOrphanTimesheetLockedActivityEntries(activity, ['still-here']);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].entryId, 'ENTRY-1');
  assert.match(orphans[0].label, /ENTRY-1/);
  assert.equal(orphans[0].lockedTimesheetId, 'missing');
});

test('activity routes and controller expose super-admin force unlock endpoints', () => {
  const routes = read('packages/school/MVC/routes/activityRoutes.js');
  assert.match(routes, /force-unlock-timesheet/);
  assert.match(routes, /ctrl\.forceUnlockActivityTimesheetLocks/);
  assert.match(routes, /ctrl\.forceUnlockWorkSessionTimesheet/);

  const controller = read('packages/school/MVC/controllers/school/activityController.js');
  assert.match(controller, /isSuperAdmin\(req\.user\)/);
  assert.match(controller, /forceUnlockActivityWorkSessionTimesheetLocks/);
  assert.match(controller, /orphanTimesheetLockedWorkSessions/);
  assert.match(controller, /listOrphanActivityTimesheetLocks/);
});

test('activity form uses message modal for force unlock and lists orphans', () => {
  const source = read('packages/school/MVC/views/school/activity/activityForm.ejs');
  assert.match(source, /btnForceUnlockAllActivityTimesheetLocks/);
  assert.match(source, /Unlock orphan work sessions/);
  assert.match(source, /js-entry-force-unlock/);
  assert.match(source, /forceUnlockActivityTimesheetLocks/);
  assert.match(source, /activityForceUnlockReason/);
  assert.match(source, /buildOrphanListHtml/);
  assert.match(source, /orphanTimesheetLockedWorkSessions/);
  assert.doesNotMatch(source, /window\.prompt\s*\(/);
  assert.doesNotMatch(source, /window\.confirm\s*\(/);
  assert.doesNotMatch(source, /window\.alert\s*\(/);
});

test('activityService still exports enforceActivityLockRules for normal saves', () => {
  const source = read('packages/school/MVC/services/school/activityService.js');
  assert.match(source, /enforceActivityLockRules/);
  assert.match(source, /locked by an approved timesheet and cannot be modified/);
  assert.match(source, /forceUnlockActivityWorkSessionTimesheetLocks/);
  assert.match(source, /listOrphanActivityTimesheetLocks/);
  assert.match(source, /No orphan timesheet locks found/);
});
