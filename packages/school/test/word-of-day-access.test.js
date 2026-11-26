'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const wordOfDayAccessService = require('../MVC/services/school/wordOfDayAccessService');
const wordOfDayOperationPolicyService = require('../MVC/services/school/wordOfDayOperationPolicyService');

const ownerAccess = {
  canViewEntries: true,
  canUpdateWords: true,
  canResolveWords: true,
  canDeleteWords: true,
  readAllScopeId: 'SCP_OWNER',
  updateScopeId: 'SCP_OWNER',
  resolveScopeId: 'SCP_OWNER',
  deleteScopeId: 'SCP_OWNER',
  adminFlags: {}
};

test('row visibility owner sees only own words', () => {
  const rowMine = { id: '1', authorUserId: 'U1', audit: { createDateTime: '2026-01-01T00:00:00.000Z' }, status: 'saved' };
  const rowOther = { id: '2', authorUserId: 'U2', audit: { createDateTime: '2026-01-01T00:00:00.000Z' }, status: 'saved' };
  assert.equal(wordOfDayAccessService.rowVisibleInList(rowMine, ownerAccess, 'U1', '2026', 'active'), true);
  assert.equal(wordOfDayAccessService.rowVisibleInList(rowOther, ownerAccess, 'U1', '2026', 'active'), false);
});

test('department scope filters to current year', () => {
  const access = {
    canViewEntries: true,
    readAllScopeId: 'SCP_DEPT',
    adminFlags: {}
  };
  const thisYear = { id: '3', authorUserId: 'U9', audit: { createDateTime: '2026-06-01T00:00:00.000Z' }, status: 'saved' };
  const lastYear = { id: '4', authorUserId: 'U9', audit: { createDateTime: '2025-06-01T00:00:00.000Z' }, status: 'saved' };
  assert.equal(wordOfDayAccessService.rowVisibleInList(thisYear, access, 'U1', '2026', 'active'), true);
  assert.equal(wordOfDayAccessService.rowVisibleInList(lastYear, access, 'U1', '2026', 'active'), false);
});

test('resolve transition owner submitted to reopened', () => {
  const row = { id: '5', authorUserId: 'U1', status: 'submitted', audit: { createDateTime: '2026-02-01T00:00:00.000Z' } };
  assert.equal(wordOfDayAccessService.canResolveTransition(row, 'reopened', ownerAccess, 'U1', '2026'), true);
  assert.equal(wordOfDayAccessService.canResolveTransition(row, 'approved', ownerAccess, 'U1', '2026'), false);
});

test('archived words hidden from default list', () => {
  const access = {
    canViewEntries: true,
    readAllScopeId: 'SCP_ORG',
    adminFlags: {}
  };
  const archived = { id: '6', status: 'archived', audit: { createDateTime: '2026-01-01T00:00:00.000Z' } };
  assert.equal(wordOfDayAccessService.rowVisibleInList(archived, access, 'U1', '2026', 'active'), false);
  assert.equal(wordOfDayAccessService.rowVisibleInList(archived, access, 'U1', '2026', 'archived'), true);
});

test('configure scope allows organization tier', () => {
  assert.equal(wordOfDayOperationPolicyService.canConfigureAtScope('SCP_ORG'), true);
  assert.equal(wordOfDayOperationPolicyService.canConfigureAtScope('SCP_OWNER'), false);
});

const orgUpdateAccess = {
  canViewEntries: true,
  canUpdateWords: true,
  readAllScopeId: 'SCP_ORG',
  updateScopeId: 'SCP_ORG',
  adminFlags: {}
};

const familyBAdminUpdate = {
  canViewEntries: true,
  canUpdateWords: true,
  readAllScopeId: 'SCP_ORG',
  updateScopeId: 'SCP_ADMIN',
  adminFlags: {}
};

const familyABypassUpdate = {
  canViewEntries: true,
  canUpdateWords: true,
  readAllScopeId: 'SCP_ORG',
  updateScopeId: 'SCP_OWNER',
  adminFlags: { update: true }
};

test('canSubmitEntryViaSave Family A and Family B admin', () => {
  const approved = {
    id: '10',
    authorUserId: 'U2',
    status: 'approved',
    audit: { createDateTime: '2026-03-01T00:00:00.000Z' }
  };
  assert.equal(wordOfDayAccessService.canSubmitEntryViaSave(approved, familyABypassUpdate, 'U1', '2026'), true);
  assert.equal(wordOfDayAccessService.canSubmitEntryViaSave(approved, familyBAdminUpdate, 'U1', '2026'), true);
  assert.equal(wordOfDayAccessService.canSubmitEntryViaSave(approved, orgUpdateAccess, 'U1', '2026'), false);
});

test('canSubmitEntryViaSave owner and org tiers', () => {
  const savedMine = { id: '11', authorUserId: 'U1', status: 'saved', audit: { createDateTime: '2026-01-01T00:00:00.000Z' } };
  const submittedMine = { id: '12', authorUserId: 'U1', status: 'submitted', audit: { createDateTime: '2026-01-01T00:00:00.000Z' } };
  assert.equal(wordOfDayAccessService.canSubmitEntryViaSave(savedMine, ownerAccess, 'U1', '2026'), true);
  assert.equal(wordOfDayAccessService.canSubmitEntryViaSave(submittedMine, ownerAccess, 'U1', '2026'), false);
  assert.equal(wordOfDayAccessService.canSubmitEntryViaSave(submittedMine, orgUpdateAccess, 'U1', '2026'), true);
});

test('canClearWorkflowNote mirrors canChangeAuthorOnEdit (Family A and admin update scope)', () => {
  const adminUpdate = wordOfDayOperationPolicyService.deriveAccessFlags({
    update: { allowed: true, scopeId: 'SCP_ADMIN' }
  }, {});
  assert.equal(adminUpdate.canClearWorkflowNote, true);
  assert.equal(adminUpdate.canClearWorkflowNote, adminUpdate.canChangeAuthorOnEdit);

  const bypass = wordOfDayOperationPolicyService.deriveAccessFlags({
    update: { allowed: true, scopeId: 'SCP_OWNER' }
  }, { update: true });
  assert.equal(bypass.canClearWorkflowNote, true);

  const ownerUpdate = wordOfDayOperationPolicyService.deriveAccessFlags({
    update: { allowed: true, scopeId: 'SCP_OWNER' }
  }, {});
  assert.equal(ownerUpdate.canClearWorkflowNote, false);
});

test('canChangeAuthorOnEdit for Family A bypass and Family B admin update', () => {
  const adminUpdate = wordOfDayOperationPolicyService.deriveAccessFlags({
    update: { allowed: true, scopeId: 'SCP_ADMIN' }
  }, {});
  assert.equal(adminUpdate.canChangeAuthorOnEdit, true);

  const bypass = wordOfDayOperationPolicyService.deriveAccessFlags({
    update: { allowed: true, scopeId: 'SCP_OWNER' }
  }, { update: true });
  assert.equal(bypass.canChangeAuthorOnEdit, true);

  const ownerUpdate = wordOfDayOperationPolicyService.deriveAccessFlags({
    update: { allowed: true, scopeId: 'SCP_OWNER' }
  }, {});
  assert.equal(ownerUpdate.canChangeAuthorOnEdit, false);
});