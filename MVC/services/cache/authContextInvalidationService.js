'use strict';

const dataService = require('../dataService');
const { SYSTEM_CONTEXT } = require('../../../config/constants');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');
const {
  invalidateAuthContextForUser,
  invalidateAuthContextForSession,
  clearAuthContextCache
} = require('./authContextCacheService');

function normalizeUserIdList(userIds = []) {
  const out = [];
  const seen = new Set();
  (Array.isArray(userIds) ? userIds : [userIds]).forEach((id) => {
    const normalized = toPublicId(id);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
}

function invalidateAuthContextForUserIds(userIds = []) {
  const ids = normalizeUserIdList(userIds);
  let removed = 0;
  ids.forEach((userId) => {
    removed += invalidateAuthContextForUser(userId);
  });
  return { userCount: ids.length, cacheEntriesRemoved: removed };
}

/**
 * Alias clarifying that invalidateAuthContextForUser clears all session cache keys for a user.
 */
function invalidateAuthContextForAllSessionsOfUser(userId) {
  return invalidateAuthContextForUser(userId);
}

async function fetchUserIdsByPersonId(personId) {
  const targetPersonId = toPublicId(personId);
  if (!targetPersonId) return [];
  const rows = await dataService.fetchData('users', {
    q: targetPersonId,
    type: 'exact_match',
    searchFields: 'personId'
  }, SYSTEM_CONTEXT);
  return normalizeUserIdList((Array.isArray(rows) ? rows : []).map((row) => row?.id));
}

async function invalidateAuthContextForPersonId(personId) {
  const userIds = await fetchUserIdsByPersonId(personId);
  return invalidateAuthContextForUserIds(userIds);
}

function userHasOrgMembership(userRow = {}, orgId = '') {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) return false;
  if (idsEqual(userRow?.primaryOrgId, targetOrgId)) return true;
  const orgs = Array.isArray(userRow?.organizations) ? userRow.organizations : [];
  return orgs.some((org) => idsEqual(org?.orgId, targetOrgId));
}

async function fetchUserIdsForOrgId(orgId) {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) return [];
  const users = await dataService.fetchData('users', {}, SYSTEM_CONTEXT);
  const matched = (Array.isArray(users) ? users : []).filter((row) => userHasOrgMembership(row, targetOrgId));
  return normalizeUserIdList(matched.map((row) => row?.id));
}

async function invalidateAuthContextForOrgId(orgId) {
  const userIds = await fetchUserIdsForOrgId(orgId);
  return invalidateAuthContextForUserIds(userIds);
}

function userReferencesAccessProfile(userRow = {}, profileId = '') {
  const targetProfileId = toPublicId(profileId);
  if (!targetProfileId) return false;
  if (idsEqual(userRow?.systemAccessProfileId, targetProfileId)) return true;
  const orgs = Array.isArray(userRow?.organizations) ? userRow.organizations : [];
  return orgs.some((org) => {
    const ids = Array.isArray(org?.accessProfileIds) ? org.accessProfileIds : [];
    return ids.some((id) => idsEqual(id, targetProfileId));
  });
}

async function fetchUserIdsForAccessProfileId(profileId) {
  const targetProfileId = toPublicId(profileId);
  if (!targetProfileId) return [];
  const bySystem = await dataService.fetchData('users', {
    q: targetProfileId,
    type: 'exact_match',
    searchFields: 'systemAccessProfileId'
  }, SYSTEM_CONTEXT);
  const systemIds = normalizeUserIdList((Array.isArray(bySystem) ? bySystem : []).map((row) => row?.id));
  const allUsers = await dataService.fetchData('users', {}, SYSTEM_CONTEXT);
  const orgLocalIds = normalizeUserIdList(
    (Array.isArray(allUsers) ? allUsers : [])
      .filter((row) => userReferencesAccessProfile(row, targetProfileId))
      .map((row) => row?.id)
  );
  return normalizeUserIdList([...systemIds, ...orgLocalIds]);
}

async function invalidateAuthContextForAccessProfileId(profileId) {
  const userIds = await fetchUserIdsForAccessProfileId(profileId);
  return invalidateAuthContextForUserIds(userIds);
}

function invalidateAuthContextForAllUsers() {
  clearAuthContextCache();
  return { cleared: true };
}

/**
 * Invalidate all cached hydrations and terminate every DB session for the user (forced logout).
 */
async function hardRevokeAuthContextForUser(userId) {
  invalidateAuthContextForUser(userId);
  const sessionService = require('../SessionService');
  const sessionResult = await sessionService.terminateAllSessionsForUser(userId);
  return {
    invalidated: true,
    sessionsTerminated: sessionResult?.terminated ?? 0
  };
}

module.exports = {
  invalidateAuthContextForUserIds,
  invalidateAuthContextForAllSessionsOfUser,
  invalidateAuthContextForPersonId,
  invalidateAuthContextForOrgId,
  invalidateAuthContextForAccessProfileId,
  invalidateAuthContextForAllUsers,
  hardRevokeAuthContextForUser,
  fetchUserIdsByPersonId,
  fetchUserIdsForOrgId,
  fetchUserIdsForAccessProfileId
};
