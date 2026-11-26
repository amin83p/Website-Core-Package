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