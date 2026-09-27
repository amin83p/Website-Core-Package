'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const activityEntryIdService = require('../MVC/services/school/activityEntryIdService');
const activityWorkSessionService = require('../MVC/services/school/activityWorkSessionService');
const activityService = require('../MVC/services/school/activityService');
const schoolRecordAccessService = require('../MVC/services/school/schoolRecordAccessService');
const workSessionAccessService = require('../MVC/services/school/workSessionAccessService');

function buildBypassWorkSessionAccessBundle() {
  return {
    read: workSessionAccessService.buildBypassReadCapabilities(),
    readAll: workSessionAccessService.buildBypassReadAllCapabilities(),
    create: workSessionAccessService.buildBypassCreateCapabilities(),
    delete: workSessionAccessService.buildBypassDeleteCapabilities(),
    update: workSessionAccessService.buildBypassCapabilities()
  };
}

test('findEntry maps legacy ENTRY-N url to scoped ENT id', () => {
  const activityId = '198455';
  const activity = {
    id: activityId,
    entries: [{ entryId: 'ENT-198455-0002', date: '2026-03-10', startTime: '12:00', endTime: '19:00' }]
  };
  const found = activityWorkSessionService.findEntry(activity, 'ENTRY-2');
  assert.ok(found);
  assert.equal(found.entryId, 'ENT-198455-0002');
});

test('resolveEntryAfterActivitySave maps legacy entry id after ensureActivityEntryIds', () => {
  const activityId = '198455';
  const legacyEntries = [{ entryId: 'ENTRY-1', date: '2026-03-10', startTime: '12:00', endTime: '19:00' }];
  const ensured = activityEntryIdService.ensureActivityEntryIds(activityId, legacyEntries);
  assert.ok(ensured.reassigned > 0);
  const savedActivity = { id: activityId, entries: ensured.entries };
  const resolved = activityWorkSessionService.resolveEntryAfterActivitySave(
    savedActivity,
    'ENTRY-1',
    legacyEntries[0]
  );
  assert.ok(resolved.entry);
  assert.match(String(resolved.entryId), /^ENT-/);
  assert.equal(ensured.entries[0].legacyEntryId, 'ENTRY-1');
});

test('saveWorkSessionMetadata succeeds after entry id reassignment on save', async () => {
  const activityId = 'ACT_WS_1';
  const orgId = 'ORG_1';
  const priorEntry = {
    entryId: 'ENTRY-1',
    status: 'posted',
    date: '2026-03-10',
    startTime: '12:00',
    endTime: '19:00',
    durationHours: 7,
    assignees: [{
      personId: 'TEACHER_1',
      personName: 'Teacher',
      role: 'participant',
      status: 'attended',
      paid: true,
      paidHours: 7,
      completionStatus: 'completed',
      completedAt: '2026-03-10T12:00:00.000Z'
    }]
  };
  const activity = {
    id: activityId,
    orgId,
    status: 'posted',
    paid: true,
    evaluationType: 'completion',
    visibilityScope: 'school',
    entries: [priorEntry],
    attendees: priorEntry.assignees
  };

  let currentActivity = { ...activity };

  const originalGetActivity = activityService.getActivity;
  const originalSaveActivity = activityService.saveActivity;
  const originalResolveAccess = schoolRecordAccessService.resolveAccessFromUser;
  const originalAssertAccessible = schoolRecordAccessService.assertActivityWorkSessionAccessible;
  const originalResolveBundle = workSessionAccessService.resolveWorkSessionAccessBundle;
  const originalBuildLockDisplays = activityService.buildActivityAssigneeLockDisplays;
  const originalEligiblePersons = activityService.getEligiblePersons;
  const originalRepairLocks = require('../MVC/services/school/schoolDependencyService').repairActivityEntryTimesheetLocksIfNeeded;

  const schoolDependencyService = require('../MVC/services/school/schoolDependencyService');
  activityService.getActivity = async () => ({ ...currentActivity });
  schoolDependencyService.repairActivityEntryTimesheetLocksIfNeeded = async ({ entry }) => entry;
  workSessionAccessService.resolveWorkSessionAccessBundle = async () => buildBypassWorkSessionAccessBundle();
  schoolRecordAccessService.resolveAccessFromUser = () => ({ personId: 'ADMIN_1' });
  schoolRecordAccessService.assertActivityWorkSessionAccessible = () => {};
  activityService.buildActivityAssigneeLockDisplays = async () => ({});
  activityService.getEligiblePersons = async () => [{ personId: 'TEACHER_1', displayName: 'Teacher' }];
  activityService.saveActivity = async (payload) => {
    const ensured = activityEntryIdService.ensureActivityEntryIds(activityId, payload.entries);
    currentActivity = { ...payload, entries: ensured.entries };
    return currentActivity;
  };

  try {
    const result = await activityWorkSessionService.saveWorkSessionMetadata({
      activityId,
      entryId: 'ENTRY-1',
      reqUser: { id: 'ADMIN_1', activeOrgId: orgId, personId: 'ADMIN_1' },
      input: {
        assignees: [{
          personId: 'TEACHER_1',
          personName: 'Teacher',
          role: 'participant',
          status: 'attended',
          paid: true,
          paidHours: 7,
          completionStatus: 'pending'
        }]
      },
      accessContext: {}
    });
    assert.equal(result.context.entry.assignees[0].completionStatus, 'pending');
    assert.notEqual(String(result.context.entry.entryId), 'ENTRY-1');
  } finally {
    activityService.getActivity = originalGetActivity;
    activityService.saveActivity = originalSaveActivity;
    schoolRecordAccessService.resolveAccessFromUser = originalResolveAccess;
    schoolRecordAccessService.assertActivityWorkSessionAccessible = originalAssertAccessible;
    workSessionAccessService.resolveWorkSessionAccessBundle = originalResolveBundle;
    activityService.buildActivityAssigneeLockDisplays = originalBuildLockDisplays;
    activityService.getEligiblePersons = originalEligiblePersons;
    schoolDependencyService.repairActivityEntryTimesheetLocksIfNeeded = originalRepairLocks;
  }
});

test('saveWorkSessionMetadata preserves assignee paid hours independent of session duration', async () => {
  const activityId = 'ACT_WS_2';
  const orgId = 'ORG_1';
  const priorEntry = {
    entryId: 'ENT-ACT-2-0001',
    status: 'posted',
    date: '2026-03-10',
    startTime: '08:00',
    endTime: '18:00',
    durationHours: 10,
    assignees: [{
      personId: 'TEACHER_1',
      personName: 'Teacher',
      role: 'participant',
      status: 'attended',
      paid: true,
      paidHours: 10,
      startTime: '08:00',
      endTime: '18:00'
    }]
  };
  const activity = {
    id: activityId,
    orgId,
    status: 'posted',
    paid: true,
    evaluationType: 'attendance',
    visibilityScope: 'school',
    entries: [priorEntry],
    attendees: priorEntry.assignees
  };

  let currentActivity = { ...activity };

  const schoolDependencyService = require('../MVC/services/school/schoolDependencyService');
  const originalGetActivity = activityService.getActivity;
  const originalSaveActivity = activityService.saveActivity;
  const originalResolveAccess = schoolRecordAccessService.resolveAccessFromUser;
  const originalAssertAccessible = schoolRecordAccessService.assertActivityWorkSessionAccessible;
  const originalResolveBundle = workSessionAccessService.resolveWorkSessionAccessBundle;
  const originalBuildLockDisplays = activityService.buildActivityAssigneeLockDisplays;
  const originalEligiblePersons = activityService.getEligiblePersons;
  const originalRepairLocks = schoolDependencyService.repairActivityEntryTimesheetLocksIfNeeded;

  activityService.getActivity = async () => ({ ...currentActivity });
  schoolDependencyService.repairActivityEntryTimesheetLocksIfNeeded = async ({ entry }) => entry;
  workSessionAccessService.resolveWorkSessionAccessBundle = async () => buildBypassWorkSessionAccessBundle();
  schoolRecordAccessService.resolveAccessFromUser = () => ({ personId: 'ADMIN_1' });
  schoolRecordAccessService.assertActivityWorkSessionAccessible = () => {};
  activityService.buildActivityAssigneeLockDisplays = async () => ({});
  activityService.getEligiblePersons = async () => [{ personId: 'TEACHER_1', displayName: 'Teacher' }];
  activityService.saveActivity = async (payload) => {
    currentActivity = { ...payload };
    return currentActivity;
  };

  try {
    const result = await activityWorkSessionService.saveWorkSessionMetadata({
      activityId,
      entryId: 'ENT-ACT-2-0001',
      reqUser: { id: 'ADMIN_1', activeOrgId: orgId, personId: 'ADMIN_1' },
      input: {
        assignees: [{
          personId: 'TEACHER_1',
          personName: 'Teacher',
          role: 'participant',
          status: 'attended',
          paid: true,
          paidHours: 3,
          startTime: '09:00',
          endTime: '14:00'
        }]
      },
      accessContext: {}
    });
    assert.equal(result.context.entry.assignees[0].paidHours, 3);
    assert.equal(result.context.entry.assignees[0].startTime, '09:00');
    assert.equal(result.context.entry.assignees[0].endTime, '14:00');
  } finally {
    activityService.getActivity = originalGetActivity;
    activityService.saveActivity = originalSaveActivity;
    schoolRecordAccessService.resolveAccessFromUser = originalResolveAccess;
    schoolRecordAccessService.assertActivityWorkSessionAccessible = originalAssertAccessible;
    workSessionAccessService.resolveWorkSessionAccessBundle = originalResolveBundle;
    activityService.buildActivityAssigneeLockDisplays = originalBuildLockDisplays;
    activityService.getEligiblePersons = originalEligiblePersons;
    schoolDependencyService.repairActivityEntryTimesheetLocksIfNeeded = originalRepairLocks;
  }
});

test('saveWorkSessionMetadata rejects assignee end after session end', async () => {
  const activityId = 'ACT_WS_3';
  const orgId = 'ORG_1';
  const priorEntry = {
    entryId: 'ENT-ACT-3-0001',
    status: 'posted',
    date: '2026-03-10',
    startTime: '08:00',
    endTime: '18:00',
    durationHours: 10,
    assignees: [{
      personId: 'TEACHER_1',
      personName: 'Teacher',
      role: 'participant',
      status: 'attended',
      paid: true,
      paidHours: 4,
      startTime: '09:00',
      endTime: '13:00'
    }]
  };
  const activity = {
    id: activityId,
    orgId,
    status: 'posted',
    paid: true,
    evaluationType: 'attendance',
    visibilityScope: 'school',
    entries: [priorEntry],
    attendees: priorEntry.assignees
  };

  const schoolDependencyService = require('../MVC/services/school/schoolDependencyService');
  const originalGetActivity = activityService.getActivity;
  const originalResolveAccess = schoolRecordAccessService.resolveAccessFromUser;
  const originalAssertAccessible = schoolRecordAccessService.assertActivityWorkSessionAccessible;
  const originalResolveBundle = workSessionAccessService.resolveWorkSessionAccessBundle;
  const originalRepairLocks = schoolDependencyService.repairActivityEntryTimesheetLocksIfNeeded;

  activityService.getActivity = async () => ({ ...activity });
  schoolDependencyService.repairActivityEntryTimesheetLocksIfNeeded = async ({ entry }) => entry;
  workSessionAccessService.resolveWorkSessionAccessBundle = async () => buildBypassWorkSessionAccessBundle();
  schoolRecordAccessService.resolveAccessFromUser = () => ({ personId: 'ADMIN_1' });
  schoolRecordAccessService.assertActivityWorkSessionAccessible = () => {};

  try {
    await assert.rejects(
      () => activityWorkSessionService.saveWorkSessionMetadata({
        activityId,
        entryId: 'ENT-ACT-3-0001',
        reqUser: { id: 'ADMIN_1', activeOrgId: orgId, personId: 'ADMIN_1' },
        input: {
          assignees: [{
            personId: 'TEACHER_1',
            personName: 'Teacher',
            role: 'participant',
            status: 'attended',
            paid: true,
            paidHours: 4,
            startTime: '09:00',
            endTime: '19:00'
          }]
        },
        accessContext: {}
      }),
      /cannot be after the work session end time/
    );
  } finally {
    activityService.getActivity = originalGetActivity;
    schoolRecordAccessService.resolveAccessFromUser = originalResolveAccess;
    schoolRecordAccessService.assertActivityWorkSessionAccessible = originalAssertAccessible;
    workSessionAccessService.resolveWorkSessionAccessBundle = originalResolveBundle;
    schoolDependencyService.repairActivityEntryTimesheetLocksIfNeeded = originalRepairLocks;
  }
});

