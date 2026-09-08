'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const timesheetImportPolicyService = require('../MVC/services/school/timesheetImportPolicyService');
const timesheetImportLifecycleService = require('../MVC/services/school/timesheetImportLifecycleService');

test('validatePolicyInput requires activity when import toggles are enabled', () => {
  assert.throws(
    () => timesheetImportPolicyService.validatePolicyInput({
      allowImportInTimesheetManagement: true,
      importActivityId: ''
    }),
    /legacy import activity/i
  );
});

test('validatePolicyInput accepts disabled import without activity', () => {
  const policy = timesheetImportPolicyService.validatePolicyInput({
    allowImportInTimesheetManagement: false,
    allowImportInMyTimesheets: false,
    importActivityId: ''
  });
  assert.equal(policy.importActivityId, '');
  assert.equal(policy.importTargetStatus, 'draft');
});

test('validatePolicyInput rejects unknown import target status', () => {
  assert.throws(
    () => timesheetImportPolicyService.validatePolicyInput({
      importTargetStatus: 'archived'
    }),
    /invalid imported timesheet status/i
  );
});

test('resolveImportTargetStatusForScope caps My Timesheets to draft', () => {
  const policy = {
    importTargetStatus: 'processed',
    allowImportInTimesheetManagement: true,
    allowImportInMyTimesheets: true,
    importActivityId: 'ACT_1'
  };
  assert.equal(timesheetImportPolicyService.resolveImportTargetStatusForScope(policy, 'management'), 'processed');
  assert.equal(timesheetImportPolicyService.resolveImportTargetStatusForScope(policy, 'my_timesheets'), 'draft');
});

test('isImportAllowedForScope respects page toggles', () => {
  const policy = {
    importActivityId: 'ACT_1',
    allowImportInTimesheetManagement: true,
    allowImportInMyTimesheets: false,
    importTargetStatus: 'submitted'
  };
  assert.equal(timesheetImportPolicyService.isImportAllowedForScope(policy, 'management'), true);
  assert.equal(timesheetImportPolicyService.isImportAllowedForScope(policy, 'my_timesheets'), false);
});
