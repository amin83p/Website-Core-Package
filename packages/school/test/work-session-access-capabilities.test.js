'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const workSessionAccessService = require('../MVC/services/school/workSessionAccessService');

test('buildReadAllCapabilitiesForScope limits assignee visibility for DEPARTMENT', () => {
  const caps = workSessionAccessService.buildReadAllCapabilitiesForScope('DEPARTMENT');
  assert.equal(caps.canViewAnyData, true);
  assert.equal(caps.requiresAssigneeEntryFilter, true);
  assert.equal(caps.canViewAllAssignees, false);
  assert.equal(caps.canViewSessionDetailsReadOnly, true);
});

test('buildReadAllCapabilitiesForScope allows all assignees for ORGANIZATION', () => {
  const caps = workSessionAccessService.buildReadAllCapabilitiesForScope('ORGANIZATION');
  assert.equal(caps.canViewAllAssignees, true);
  assert.equal(caps.requiresAssigneeEntryFilter, false);
});

test('buildCreateCapabilitiesForScope denies DEPARTMENT and allows ORGANIZATION', () => {
  assert.equal(workSessionAccessService.buildCreateCapabilitiesForScope('DEPARTMENT').canAddAssignees, false);
  assert.equal(workSessionAccessService.buildCreateCapabilitiesForScope('ORGANIZATION').canAddAssignees, true);
});

test('buildDeleteCapabilitiesForScope denies OWNER and allows ADMIN scope', () => {
  assert.equal(workSessionAccessService.buildDeleteCapabilitiesForScope('OWNER').canRemoveAssignees, false);
  assert.equal(workSessionAccessService.buildDeleteCapabilitiesForScope('ADMIN').canRemoveAssignees, true);
});

test('assertAssigneeRosterChanges requires CREATE and DELETE capabilities', () => {
  assert.throws(
    () => workSessionAccessService.assertAssigneeRosterChanges({
      priorEntryAssignees: [{ personId: 'P1' }],
      nextAssigneePersonIds: ['P1', 'P2'],
      createCapabilities: workSessionAccessService.buildCreateCapabilitiesForScope('DEPARTMENT'),
      deleteCapabilities: workSessionAccessService.buildDeleteCapabilitiesForScope('DEPARTMENT')
    }),
    /cannot add assignees/
  );
  assert.throws(
    () => workSessionAccessService.assertAssigneeRosterChanges({
      priorEntryAssignees: [{ personId: 'P1' }, { personId: 'P2' }],
      nextAssigneePersonIds: ['P1'],
      createCapabilities: workSessionAccessService.buildCreateCapabilitiesForScope('ORGANIZATION'),
      deleteCapabilities: workSessionAccessService.buildDeleteCapabilitiesForScope('DEPARTMENT')
    }),
    /cannot remove assignees/
  );
  assert.doesNotThrow(
    () => workSessionAccessService.assertAssigneeRosterChanges({
      priorEntryAssignees: [{ personId: 'P1' }],
      nextAssigneePersonIds: ['P1', 'P2'],
      createCapabilities: workSessionAccessService.buildCreateCapabilitiesForScope('ORGANIZATION'),
      deleteCapabilities: workSessionAccessService.buildDeleteCapabilitiesForScope('ORGANIZATION')
    })
  );
});

test('buildReadCapabilitiesForScope denies USER scope page open', () => {
  assert.equal(workSessionAccessService.buildReadCapabilitiesForScope('USER').canOpenPage, false);
  assert.equal(workSessionAccessService.buildReadCapabilitiesForScope('OWNER').canOpenPage, true);
});

test('only org and admin scopes can mark assignee excused on self-edit', () => {
  assert.equal(workSessionAccessService.buildCapabilitiesForScope('ORGANIZATION').canMarkAssigneeExcused, true);
  assert.equal(workSessionAccessService.buildCapabilitiesForScope('ADMIN').canMarkAssigneeExcused, true);
  assert.equal(workSessionAccessService.buildCapabilitiesForScope('DEPARTMENT').canMarkAssigneeExcused, false);
  assert.equal(workSessionAccessService.buildCapabilitiesForScope('DIVISION').canMarkAssigneeExcused, false);
  assert.equal(workSessionAccessService.buildCapabilitiesForScope('OWNER').canMarkAssigneeExcused, false);

  const departmentSelf = workSessionAccessService.buildAssigneeFieldCapabilities(
    workSessionAccessService.buildCapabilitiesForScope('DEPARTMENT'),
    { isSelf: true, locked: false }
  );
  assert.equal(departmentSelf.canMarkExcused, false);

  assert.throws(
    () => workSessionAccessService.assertAssigneeFieldChanges({
      capabilities: workSessionAccessService.buildCapabilitiesForScope('DEPARTMENT'),
      assignee: { status: 'attended' },
      prior: { status: 'attended' },
      isSelf: true,
      input: { status: 'excused' },
      evaluationType: 'attendance'
    }),
    /cannot mark attendance as excused/i
  );
});
