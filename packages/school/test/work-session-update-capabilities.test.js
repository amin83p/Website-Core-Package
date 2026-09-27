'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const workSessionAccessService = require('../MVC/services/school/workSessionAccessService');

test('buildCapabilitiesForScope OWNER allows status only on own row', () => {
  const caps = workSessionAccessService.buildCapabilitiesForScope('OWNER');
  assert.equal(caps.canEditOwnAssigneeStatus, true);
  assert.equal(caps.canEditOwnAssigneeRole, false);
  assert.equal(caps.canEditOwnAssigneeTiming, false);
  assert.equal(caps.canEditOwnAssigneePaidHours, false);
  assert.equal(caps.requiresAssigneeVisibility, true);
});

test('buildCapabilitiesForScope DIVISION adds role timing and notes', () => {
  const caps = workSessionAccessService.buildCapabilitiesForScope('DIVISION');
  assert.equal(caps.canEditOwnAssigneeRole, true);
  assert.equal(caps.canEditOwnAssigneeTiming, true);
  assert.equal(caps.canEditOwnAssigneeNotes, true);
  assert.equal(caps.canEditOwnAssigneePayable, false);
});

test('buildCapabilitiesForScope DEPARTMENT adds payable and paid hours', () => {
  const caps = workSessionAccessService.buildCapabilitiesForScope('DEPARTMENT');
  assert.equal(caps.canEditOwnAssigneePayable, true);
  assert.equal(caps.canEditOwnAssigneePaidHours, true);
  assert.equal(caps.canEditOwnAssigneeRole, true);
});

test('buildCapabilitiesForScope ORGANIZATION locks structural metadata when assignees locked', () => {
  const open = workSessionAccessService.buildCapabilitiesForScope('ORGANIZATION', { hasLockedAssignees: false });
  assert.equal(open.canEditSessionMetadataFull, true);
  assert.equal(open.canManageAssigneeRoster, true);

  const locked = workSessionAccessService.buildCapabilitiesForScope('ORGANIZATION', { hasLockedAssignees: true });
  assert.equal(locked.canEditSessionMetadataFull, false);
  assert.equal(locked.canEditSessionMetadataPartial, true);
});

test('assertSessionMetadataChanges blocks date change under partial metadata edit', () => {
  assert.throws(
    () => workSessionAccessService.assertSessionMetadataChanges({
      capabilities: workSessionAccessService.buildCapabilitiesForScope('ORGANIZATION', { hasLockedAssignees: true }),
      priorEntry: { date: '2026-03-01', startTime: '08:00', endTime: '12:00', status: 'posted' },
      input: { date: '2026-03-02' },
      nextAssigneePersonIds: ['P1'],
      priorEntryAssignees: [{ personId: 'P1' }]
    }),
    /Date, time, and status cannot be changed/
  );
});

test('assertAssigneeFieldChanges blocks role change for OWNER scope', () => {
  assert.throws(
    () => workSessionAccessService.assertAssigneeFieldChanges({
      capabilities: workSessionAccessService.buildCapabilitiesForScope('OWNER'),
      assignee: { personId: 'P1', role: 'teacher' },
      prior: { personId: 'P1', role: 'teacher' },
      isSelf: true,
      input: { role: 'staff' },
      evaluationType: 'attendance'
    }),
    /cannot change assignee role/
  );
});

test('resolveUpdateCapabilities allows Family A bypass admins', async () => {
  const user = {
    id: 'USER_BYPASS',
    activeOrgId: 'ORG_1',
    activeProfile: {
      active: true,
      orgId: 'ORG_1',
      adminCategories: ['SCHOOL'],
      sections: []
    }
  };
  const caps = await workSessionAccessService.resolveUpdateCapabilities(user, {});
  assert.equal(caps.isBypassAdmin, true);
  assert.equal(caps.canManageAssigneeRoster, true);
});

test('canEditAssigneeRow respects locked assignee rows', () => {
  const caps = workSessionAccessService.buildCapabilitiesForScope('DEPARTMENT');
  assert.equal(workSessionAccessService.canEditAssigneeRow(caps, { isSelf: true, locked: true }), false);
  assert.equal(workSessionAccessService.canEditAssigneeRow(caps, { isSelf: true, locked: false }), true);
});

test('Family A bypass resolves full manage capabilities', async () => {
  const user = {
    id: 'USER_CAT',
    activeOrgId: 'ORG_1',
    activeProfile: {
      active: true,
      orgId: 'ORG_1',
      adminCategories: ['SCHOOL'],
      sections: []
    }
  };
  const caps = await workSessionAccessService.resolveUpdateCapabilities(user, {});
  assert.equal(caps.isBypassAdmin, true);
  assert.equal(caps.canManageAssigneeRoster, true);
});
