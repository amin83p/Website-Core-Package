'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const activityWorkSessionService = require('../MVC/services/school/activityWorkSessionService');
const activityService = require('../MVC/services/school/activityService');
const schoolRecordAccessService = require('../MVC/services/school/schoolRecordAccessService');
const workSessionAccessService = require('../MVC/services/school/workSessionAccessService');
const schoolDependencyService = require('../MVC/services/school/schoolDependencyService');
const schoolDataService = require('../MVC/services/school/schoolDataService');

function buildActivityFixture() {
  const priorEntry = {
    entryId: 'ENT-ACT-1-0001',
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
      endTime: '13:00',
      notes: ''
    }]
  };
  return {
    id: 'ACT_1',
    orgId: 'ORG_1',
    status: 'posted',
    paid: true,
    evaluationType: 'attendance',
    visibilityScope: 'school',
    entries: [priorEntry],
    attendees: priorEntry.assignees
  };
}

test('saveAssigneeRow updates paid hours without timing permission', async () => {
  const activity = buildActivityFixture();
  let stored = { ...activity };

  const originalGetActivity = activityService.getActivity;
  const originalRepair = schoolDependencyService.repairActivityEntryTimesheetLocksIfNeeded;
  const originalResolveAccess = schoolRecordAccessService.resolveAccessFromUser;
  const originalAssertAccessible = schoolRecordAccessService.assertActivityWorkSessionAccessible;
  const originalResolveCaps = workSessionAccessService.resolveUpdateCapabilities;
  const originalBuildLockDisplays = activityService.buildActivityAssigneeLockDisplays;
  const originalEligiblePersons = activityService.getEligiblePersons;
  const originalGetData = schoolDataService.getDataById;
  const originalUpdateData = schoolDataService.updateData;
  const originalAssertNotReferenced = schoolDependencyService.assertActivityAssigneeNotReferencedBySubmittedTimesheet;

  activityService.getActivity = async () => ({ ...stored });
  schoolDependencyService.repairActivityEntryTimesheetLocksIfNeeded = async ({ entry }) => entry;
  schoolDependencyService.assertActivityAssigneeNotReferencedBySubmittedTimesheet = async () => {};
  workSessionAccessService.resolveUpdateCapabilities = async () => (
    workSessionAccessService.buildCapabilitiesForScope('DEPARTMENT')
  );
  schoolRecordAccessService.resolveAccessFromUser = () => ({
    personId: 'TEACHER_1',
    scopeName: 'DEPARTMENT',
    scopeMode: 'assignment',
    denyAll: false
  });
  schoolRecordAccessService.assertActivityWorkSessionAccessible = () => {};
  activityService.buildActivityAssigneeLockDisplays = async () => ({});
  activityService.getEligiblePersons = async () => [{ personId: 'TEACHER_1', displayName: 'Teacher' }];
  schoolDataService.getDataById = async () => ({ ...stored });
  schoolDataService.updateData = async (_type, _id, payload) => {
    stored = payload;
    return payload;
  };

  try {
    await activityWorkSessionService.saveAssigneeRow({
      activityId: 'ACT_1',
      entryId: 'ENT-ACT-1-0001',
      personId: 'TEACHER_1',
      reqUser: { id: 'TEACHER_1', personId: 'TEACHER_1', activeOrgId: 'ORG_1' },
      input: {
        personId: 'TEACHER_1',
        paidHours: '2.50',
        status: 'attended'
      },
      accessContext: {}
    });
    const assignee = stored.entries[0].assignees[0];
    assert.equal(assignee.paidHours, 2.5);
    assert.equal(assignee.startTime, '09:00');
    assert.equal(assignee.endTime, '13:00');
  } finally {
    activityService.getActivity = originalGetActivity;
    schoolDependencyService.repairActivityEntryTimesheetLocksIfNeeded = originalRepair;
    schoolDependencyService.assertActivityAssigneeNotReferencedBySubmittedTimesheet = originalAssertNotReferenced;
    schoolRecordAccessService.resolveAccessFromUser = originalResolveAccess;
    schoolRecordAccessService.assertActivityWorkSessionAccessible = originalAssertAccessible;
    workSessionAccessService.resolveUpdateCapabilities = originalResolveCaps;
    activityService.buildActivityAssigneeLockDisplays = originalBuildLockDisplays;
    activityService.getEligiblePersons = originalEligiblePersons;
    schoolDataService.getDataById = originalGetData;
    schoolDataService.updateData = originalUpdateData;
  }
});

test('saveAssigneeRow rejects paid hours above assignee span', async () => {
  const activity = buildActivityFixture();
  let stored = { ...activity };

  const originalGetActivity = activityService.getActivity;
  const originalRepair = schoolDependencyService.repairActivityEntryTimesheetLocksIfNeeded;
  const originalResolveAccess = schoolRecordAccessService.resolveAccessFromUser;
  const originalAssertAccessible = schoolRecordAccessService.assertActivityWorkSessionAccessible;
  const originalResolveCaps = workSessionAccessService.resolveUpdateCapabilities;
  const originalBuildLockDisplays = activityService.buildActivityAssigneeLockDisplays;
  const originalEligiblePersons = activityService.getEligiblePersons;
  const originalGetData = schoolDataService.getDataById;
  const originalUpdateData = schoolDataService.updateData;
  const originalAssertNotReferenced = schoolDependencyService.assertActivityAssigneeNotReferencedBySubmittedTimesheet;

  activityService.getActivity = async () => ({ ...stored });
  schoolDependencyService.repairActivityEntryTimesheetLocksIfNeeded = async ({ entry }) => entry;
  schoolDependencyService.assertActivityAssigneeNotReferencedBySubmittedTimesheet = async () => {};
  workSessionAccessService.resolveUpdateCapabilities = async () => (
    workSessionAccessService.buildCapabilitiesForScope('DEPARTMENT')
  );
  schoolRecordAccessService.resolveAccessFromUser = () => ({
    personId: 'TEACHER_1',
    scopeName: 'DEPARTMENT',
    scopeMode: 'assignment',
    denyAll: false
  });
  schoolRecordAccessService.assertActivityWorkSessionAccessible = () => {};
  activityService.buildActivityAssigneeLockDisplays = async () => ({});
  activityService.getEligiblePersons = async () => [{ personId: 'TEACHER_1', displayName: 'Teacher' }];
  schoolDataService.getDataById = async () => ({ ...stored });
  schoolDataService.updateData = async (_type, _id, payload) => {
    stored = payload;
    return payload;
  };

  try {
    await assert.rejects(
      () => activityWorkSessionService.saveAssigneeRow({
        activityId: 'ACT_1',
        entryId: 'ENT-ACT-1-0001',
        personId: 'TEACHER_1',
        reqUser: { id: 'TEACHER_1', personId: 'TEACHER_1', activeOrgId: 'ORG_1' },
        input: {
          personId: 'TEACHER_1',
          paidHours: '6',
          status: 'attended'
        },
        accessContext: {}
      }),
      /Paid hours cannot exceed/
    );
  } finally {
    activityService.getActivity = originalGetActivity;
    schoolDependencyService.repairActivityEntryTimesheetLocksIfNeeded = originalRepair;
    schoolDependencyService.assertActivityAssigneeNotReferencedBySubmittedTimesheet = originalAssertNotReferenced;
    schoolRecordAccessService.resolveAccessFromUser = originalResolveAccess;
    schoolRecordAccessService.assertActivityWorkSessionAccessible = originalAssertAccessible;
    workSessionAccessService.resolveUpdateCapabilities = originalResolveCaps;
    activityService.buildActivityAssigneeLockDisplays = originalBuildLockDisplays;
    activityService.getEligiblePersons = originalEligiblePersons;
    schoolDataService.getDataById = originalGetData;
    schoolDataService.updateData = originalUpdateData;
  }
});
