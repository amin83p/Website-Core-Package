const assert = require('assert');
const path = require('path');
const test = require('node:test');

const policy = require(path.join(
  __dirname,
  '../packages/school/MVC/services/school/notificationCenterOperationPolicyService'
));
const runScope = require(path.join(
  __dirname,
  '../packages/school/MVC/services/school/notificationCenterRunScopeService'
));

test('deriveAccessFlags enforces NC scope tiers from target spec', () => {
  const ownerRead = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'SCP_OWNER' },
    readAll: { allowed: true, scopeId: 'SCP_OWNER' },
    update: { allowed: true, scopeId: 'SCP_OWNER' },
    configure: { allowed: true, scopeId: 'SCP_ORG' },
    upload: { allowed: true, scopeId: 'SCP_ORG' },
    del: { allowed: true, scopeId: 'SCP_ORG' }
  }, {});
  assert.equal(ownerRead.canOpen, true);
  assert.equal(ownerRead.canViewRuns, true);
  assert.equal(ownerRead.canRunNow, false);
  assert.equal(ownerRead.canConfigure, true);
  assert.equal(ownerRead.canDispatch, true);
  assert.equal(ownerRead.canDeleteOutbox, true);

  const deptRunner = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'SCP_DEPT' },
    readAll: { allowed: true, scopeId: 'SCP_DEPT' },
    update: { allowed: true, scopeId: 'SCP_DEPT' },
    configure: { allowed: false, scopeId: 'SCP_USER' },
    upload: { allowed: false, scopeId: 'SCP_USER' },
    del: { allowed: false, scopeId: 'SCP_USER' }
  }, {});
  assert.equal(deptRunner.canRunNow, true);
  assert.equal(deptRunner.canConfigure, false);
});

test('filterRunForViewer hides batches outside OWNER recipient scope', () => {
  const run = {
    id: 'run-1',
    batches: [
      {
        id: 'b1',
        recipientPersonId: 'teacher-a',
        items: [{ id: 'f1', title: 'S1', payload: {} }]
      },
      {
        id: 'b2',
        recipientPersonId: 'teacher-b',
        items: [{ id: 'f2', title: 'S2', payload: {} }]
      }
    ]
  };
  const access = { readAllScopeId: 'SCP_OWNER', isAdminViewer: false };
  const filtered = runScope.filterRunForViewer(run, { personId: 'teacher-a', id: 'u1' }, access);
  assert.equal(filtered.batches.length, 1);
  assert.equal(filtered.batches[0].recipientPersonId, 'teacher-a');
});

test('filterRunForViewer leaves org-wide runs unchanged', () => {
  const run = {
    id: 'run-1',
    batches: [{ id: 'b1', recipientPersonId: 't1', items: [{ id: 'f1' }] }]
  };
  const access = { readAllScopeId: 'SCP_ORG', isAdminViewer: false };
  const filtered = runScope.filterRunForViewer(run, { id: 'u1' }, access);
  assert.equal(filtered.batches.length, 1);
});
