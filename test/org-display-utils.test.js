const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveActiveOrgDisplay,
  userCanUseSystemOrgContext
} = require('../MVC/utils/orgDisplayUtils');

test('resolveActiveOrgDisplay shows member org for standard user without system context', () => {
  const display = resolveActiveOrgDisplay({
    activeOrgId: '',
    allowedOrgs: [
      { orgId: 'ORG-1', name: 'Demo School', role: 'Teacher', isSelectable: true }
    ]
  });
  assert.equal(display.name, 'Demo School');
  assert.equal(display.role, 'Teacher');
  assert.notEqual(display.name, 'System / Global');
});

test('resolveActiveOrgDisplay remaps stale SYSTEM active org for standard users', () => {
  const display = resolveActiveOrgDisplay({
    activeOrgId: 'SYSTEM',
    allowedOrgs: [
      { orgId: 'ORG-2', name: 'West Campus', role: 'Member', isSelectable: true }
    ]
  });
  assert.equal(display.orgId, 'ORG-2');
  assert.equal(display.name, 'West Campus');
  assert.equal(display.role, 'Member');
});

test('resolveActiveOrgDisplay keeps System / Global for system-profile users in SYSTEM mode', () => {
  assert.equal(userCanUseSystemOrgContext({ systemAccessProfileId: 'PROF-1' }), true);
  const display = resolveActiveOrgDisplay({
    systemAccessProfileId: 'PROF-1',
    activeOrgId: 'SYSTEM',
    currentProfileMode: 'SYSTEM',
    allowedOrgs: [
      { orgId: 'SYSTEM', name: 'SYSTEM / GLOBAL MODE', role: 'Super Admin' },
      { orgId: 'ORG-3', name: 'East Campus', role: 'Member', isSelectable: true }
    ]
  });
  assert.match(display.name, /SYSTEM|System \/ Global/i);
  assert.equal(display.role, 'Super Admin');
});
