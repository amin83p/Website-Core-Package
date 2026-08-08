'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createTtlLruCache } = require('../MVC/services/cache/ttlLruCache');
const { cloneCacheValue } = require('../MVC/services/cache/cacheClone');
const websitePolicyCacheService = require('../MVC/services/cache/websitePolicyCacheService');
const authContextCacheService = require('../MVC/services/cache/authContextCacheService');
const authContextInvalidationService = require('../MVC/services/cache/authContextInvalidationService');
const requestCacheConfig = require('../MVC/services/cache/requestCacheConfig');
const sessionService = require('../MVC/services/SessionService');
const authService = require('../MVC/services/authService');
const dataService = require('../MVC/services/dataService');
const domainOpsService = require('../MVC/services/data/domainOpsService');
const websitePolicyRepository = require('../MVC/repositories/websitePolicyRepository');
const settingsModel = require('../MVC/models/systemSettingsModel');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('ttlLruCache returns hits until expiry and enforces max entries', () => {
  const cache = createTtlLruCache({ maxEntries: 2, defaultTtlMs: 1000, name: 'test-cache' });
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.stats().hits, 1);

  cache.set('c', 3);
  assert.equal(cache.get('b'), null);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
});

test('ttlLruCache deleteByPrefix removes user session keys', () => {
  const cache = createTtlLruCache({ maxEntries: 10, defaultTtlMs: 1000 });
  cache.set('USR_1:SES_A', { id: 'USR_1' });
  cache.set('USR_1:SES_B', { id: 'USR_1' });
  cache.set('USR_2:SES_C', { id: 'USR_2' });
  assert.equal(cache.deleteByPrefix('USR_1:'), 2);
  assert.equal(cache.get('USR_2:SES_C')?.id, 'USR_2');
});

test('system settings defaults include request cache configuration', () => {
  assert.equal(settingsModel.DEFAULTS.app.requestCacheTtlSeconds, 900);
  assert.equal(settingsModel.DEFAULTS.app.requestCacheMaxEntries, 500);
  assert.equal(requestCacheConfig.DEFAULT_TTL_SECONDS, 900);
  assert.equal(requestCacheConfig.MAX_TTL_SECONDS, 900);
  const appSettingsView = read('MVC/views/systemSettings/appSettings.ejs');
  assert.match(appSettingsView, /requestCacheTtlSeconds/);
  assert.match(appSettingsView, /requestCacheMaxEntries/);
  assert.match(appSettingsView, /max="900"/);
});

test('website policy cache avoids repeated repository reads within TTL', async () => {
  let reads = 0;
  const originalGetPolicy = websitePolicyRepository.getPolicy;
  websitePolicyRepository.getPolicy = async () => {
    reads += 1;
    return { id: 'website-policy', features: { publicAccess: true } };
  };

  try {
    websitePolicyCacheService.clearWebsitePolicyCache();
    const first = await websitePolicyCacheService.getWebsitePolicy();
    const second = await websitePolicyCacheService.getWebsitePolicy();
    assert.equal(reads, 1);
    assert.equal(first.features.publicAccess, true);
    assert.equal(second.features.publicAccess, true);
  } finally {
    websitePolicyRepository.getPolicy = originalGetPolicy;
    websitePolicyCacheService.clearWebsitePolicyCache();
  }
});

test('domainOpsService updateWebsitePolicy invalidates cached policy', async () => {
  let reads = 0;
  const originalGetPolicy = websitePolicyRepository.getPolicy;
  const originalUpdatePolicy = websitePolicyRepository.updatePolicy;
  websitePolicyRepository.getPolicy = async () => {
    reads += 1;
    return { id: 'website-policy', maintenance: { enabled: false } };
  };
  websitePolicyRepository.updatePolicy = async (updates) => ({ id: 'website-policy', ...updates });

  try {
    websitePolicyCacheService.clearWebsitePolicyCache();
    await domainOpsService.getWebsitePolicy();
    await domainOpsService.getWebsitePolicy();
    assert.equal(reads, 1);

    await domainOpsService.updateWebsitePolicy({ maintenance: { enabled: true } }, { id: 'USR_1' });
    await domainOpsService.getWebsitePolicy();
    assert.equal(reads, 2);
  } finally {
    websitePolicyRepository.getPolicy = originalGetPolicy;
    websitePolicyRepository.updatePolicy = originalUpdatePolicy;
    websitePolicyCacheService.clearWebsitePolicyCache();
  }
});

test('getUserFromToken uses auth context cache for repeated token hydration', async () => {
  const loginUser = {
    id: 'USR_CACHE_1',
    username: 'cache.user',
    email: 'cache.user@example.com',
    accessLevel: 'admin',
    active: true,
    status: 'active',
    isVirtualSuperAdmin: true,
    primaryOrgId: 'SYSTEM',
    organizations: []
  };
  const token = authService.generateToken({
    id: loginUser.id,
    username: loginUser.username,
    accessLevel: loginUser.accessLevel
  }, 60);

  let userReads = 0;
  const originals = {
    getDataById: dataService.getDataById,
    fetchData: dataService.fetchData,
    updateData: dataService.updateData,
    OrgHasActiveContract: dataService.OrgHasActiveContract
  };

  authContextCacheService.clearAuthContextCache();

  dataService.getDataById = async (entityType, id) => {
    if (entityType === 'users' && id === loginUser.id) {
      userReads += 1;
      return { ...loginUser };
    }
    return null;
  };
  dataService.fetchData = async () => [];
  dataService.updateData = async () => ({});
  dataService.OrgHasActiveContract = async () => false;

  try {
    await authService.getUserFromToken(token);
    await authService.getUserFromToken(token);
    assert.equal(userReads, 1);
  } finally {
    Object.assign(dataService, originals);
    authContextCacheService.clearAuthContextCache();
  }
});

test('mutating hydrated user does not alter cached auth context', async () => {
  const loginUser = {
    id: 'USR_CACHE_2',
    username: 'clone.user',
    accessLevel: 'admin',
    active: true,
    status: 'active',
    isVirtualSuperAdmin: true,
    primaryOrgId: 'SYSTEM',
    organizations: []
  };
  const token = authService.generateToken({
    id: loginUser.id,
    username: loginUser.username,
    accessLevel: loginUser.accessLevel
  }, 60);

  const originals = {
    getDataById: dataService.getDataById,
    fetchData: dataService.fetchData,
    updateData: dataService.updateData,
    OrgHasActiveContract: dataService.OrgHasActiveContract
  };

  authContextCacheService.clearAuthContextCache();
  dataService.getDataById = async (entityType, id) => (
    entityType === 'users' && id === loginUser.id ? { ...loginUser } : null
  );
  dataService.fetchData = async () => [];
  dataService.updateData = async () => ({});
  dataService.OrgHasActiveContract = async () => false;

  try {
    const first = await authService.getUserFromToken(token);
    first.siteWarnings = ['mutated'];
    const second = await authService.getUserFromToken(token);
    assert.deepEqual(second.siteWarnings, undefined);
  } finally {
    Object.assign(dataService, originals);
    authContextCacheService.clearAuthContextCache();
  }
});

test('switchOrganization invalidates cached auth context for the user', async () => {
  const loginUser = {
    id: 'USR_CACHE_3',
    username: 'switch.cache',
    active: true,
    status: 'active',
    isVirtualSuperAdmin: true,
    primaryOrgId: 'SYSTEM',
    organizations: []
  };
  const token = authService.generateToken({
    id: loginUser.id,
    username: loginUser.username,
    accessLevel: loginUser.accessLevel
  }, 60);

  let userReads = 0;
  const state = { primaryOrgId: 'SYSTEM' };
  const originals = {
    getDataById: dataService.getDataById,
    fetchData: dataService.fetchData,
    updateData: dataService.updateData,
    OrgHasActiveContract: dataService.OrgHasActiveContract
  };

  authContextCacheService.clearAuthContextCache();
  dataService.getDataById = async (entityType, id) => {
    if (entityType === 'users' && id === loginUser.id) {
      userReads += 1;
      return { ...loginUser, primaryOrgId: state.primaryOrgId };
    }
    if (entityType === 'organizations' && id === 'ORG_SWITCH') {
      return { id: 'ORG_SWITCH', active: true, identity: { displayName: 'Org Switch' } };
    }
    return null;
  };
  dataService.fetchData = async (entityType) => {
    if (entityType === 'organizations') {
      return [{ id: 'ORG_SWITCH', active: true, identity: { displayName: 'Org Switch' } }];
    }
    return [];
  };
  dataService.updateData = async (entityType, _id, payload) => {
    if (entityType === 'users' && payload?.primaryOrgId) {
      state.primaryOrgId = payload.primaryOrgId;
    }
    return {};
  };
  dataService.OrgHasActiveContract = async () => true;

  try {
    await authService.getUserFromToken(token);
    await authService.getUserFromToken(token);
    assert.equal(userReads, 1);

    const switched = await authService.switchOrganization(loginUser.id, 'ORG_SWITCH', null);
    assert.equal(switched.success, true);

    const refreshed = await authService.getUserFromToken(token);
    assert.equal(userReads, 3);
    assert.equal(refreshed.activeOrgId, 'ORG_SWITCH');
  } finally {
    Object.assign(dataService, originals);
    authContextCacheService.clearAuthContextCache();
  }
});

test('cloneCacheValue returns independent object copies', () => {
  const source = { allowedOrgs: [{ orgId: 'ORG_1', name: 'One' }], siteWarnings: [] };
  const clone = cloneCacheValue(source);
  clone.allowedOrgs[0].name = 'Changed';
  clone.siteWarnings.push('warn');
  assert.equal(source.allowedOrgs[0].name, 'One');
  assert.equal(source.siteWarnings.length, 0);
});

test('invalidateAuthContextForUser clears every session cache key for that user', () => {
  authContextCacheService.clearAuthContextCache();
  authContextCacheService.setCachedAuthContext('USR_MULTI', 'SES_A', { id: 'USR_MULTI', session: 'A' });
  authContextCacheService.setCachedAuthContext('USR_MULTI', 'SES_B', { id: 'USR_MULTI', session: 'B' });
  authContextCacheService.setCachedAuthContext('USR_OTHER', 'SES_C', { id: 'USR_OTHER' });

  const removed = authContextCacheService.invalidateAuthContextForUser('USR_MULTI');
  assert.equal(removed, 2);
  assert.equal(authContextCacheService.getCachedAuthContext('USR_MULTI', 'SES_A'), null);
  assert.equal(authContextCacheService.getCachedAuthContext('USR_MULTI', 'SES_B'), null);
  assert.equal(authContextCacheService.getCachedAuthContext('USR_OTHER', 'SES_C')?.id, 'USR_OTHER');
});

test('invalidateAuthContextForAccessProfileId invalidates system and org-local profile users', async () => {
  const profileId = 'APF_LOCAL_1';
  const originals = {
    fetchData: dataService.fetchData
  };

  dataService.fetchData = async (entityType, query = {}) => {
    if (entityType === 'users' && query.searchFields === 'systemAccessProfileId') {
      return [{ id: 'USR_SYS' }];
    }
    if (entityType === 'users' && !query.searchFields) {
      return [
        { id: 'USR_SYS' },
        { id: 'USR_ORG', organizations: [{ orgId: 'ORG_1', accessProfileIds: [profileId] }] },
        { id: 'USR_NONE', organizations: [{ orgId: 'ORG_2', accessProfileIds: ['OTHER'] }] }
      ];
    }
    return [];
  };

  authContextCacheService.clearAuthContextCache();
  authContextCacheService.setCachedAuthContext('USR_SYS', 'SES_1', { id: 'USR_SYS' });
  authContextCacheService.setCachedAuthContext('USR_ORG', 'SES_2', { id: 'USR_ORG' });
  authContextCacheService.setCachedAuthContext('USR_NONE', 'SES_3', { id: 'USR_NONE' });

  try {
    const result = await authContextInvalidationService.invalidateAuthContextForAccessProfileId(profileId);
    assert.equal(result.userCount, 2);
    assert.equal(authContextCacheService.getCachedAuthContext('USR_SYS', 'SES_1'), null);
    assert.equal(authContextCacheService.getCachedAuthContext('USR_ORG', 'SES_2'), null);
    assert.equal(authContextCacheService.getCachedAuthContext('USR_NONE', 'SES_3')?.id, 'USR_NONE');
  } finally {
    Object.assign(dataService, originals);
    authContextCacheService.clearAuthContextCache();
  }
});

test('invalidateAuthContextForOrgId invalidates members and primary-org users', async () => {
  const orgId = 'ORG_TARGET';
  const originals = { fetchData: dataService.fetchData };

  dataService.fetchData = async (entityType) => {
    if (entityType !== 'users') return [];
    return [
      { id: 'USR_MEMBER', organizations: [{ orgId: orgId }] },
      { id: 'USR_PRIMARY', primaryOrgId: orgId, organizations: [] },
      { id: 'USR_OUTSIDER', primaryOrgId: 'OTHER', organizations: [{ orgId: 'OTHER' }] }
    ];
  };

  authContextCacheService.clearAuthContextCache();
  authContextCacheService.setCachedAuthContext('USR_MEMBER', 'SES_M', { id: 'USR_MEMBER' });
  authContextCacheService.setCachedAuthContext('USR_PRIMARY', 'SES_P', { id: 'USR_PRIMARY' });
  authContextCacheService.setCachedAuthContext('USR_OUTSIDER', 'SES_O', { id: 'USR_OUTSIDER' });

  try {
    const result = await authContextInvalidationService.invalidateAuthContextForOrgId(orgId);
    assert.equal(result.userCount, 2);
    assert.equal(authContextCacheService.getCachedAuthContext('USR_MEMBER', 'SES_M'), null);
    assert.equal(authContextCacheService.getCachedAuthContext('USR_PRIMARY', 'SES_P'), null);
    assert.equal(authContextCacheService.getCachedAuthContext('USR_OUTSIDER', 'SES_O')?.id, 'USR_OUTSIDER');
  } finally {
    Object.assign(dataService, originals);
    authContextCacheService.clearAuthContextCache();
  }
});

test('terminateAllSessionsForUser removes session rows and auth cache entries', async () => {
  const userId = 'USR_SESSIONS';
  const originals = {
    fetchData: dataService.fetchData,
    getDataById: dataService.getDataById,
    deleteData: dataService.deleteData
  };
  const deletedSessionIds = [];

  dataService.fetchData = async (entityType, query = {}) => {
    if (entityType === 'sessions' && query.searchFields === 'userId') {
      return [{ id: 'SES_ONE', userId }, { id: 'SES_TWO', userId }];
    }
    return [];
  };
  dataService.getDataById = async (entityType, id) => {
    if (entityType === 'sessions') return { id, userId };
    return null;
  };
  dataService.deleteData = async (entityType, id) => {
    if (entityType === 'sessions') deletedSessionIds.push(id);
    return { id };
  };

  authContextCacheService.clearAuthContextCache();
  authContextCacheService.setCachedAuthContext(userId, 'SES_ONE', { id: userId });
  authContextCacheService.setCachedAuthContext(userId, 'SES_TWO', { id: userId });

  try {
    const result = await sessionService.terminateAllSessionsForUser(userId);
    assert.equal(result.terminated, 2);
    assert.deepEqual(deletedSessionIds.sort(), ['SES_ONE', 'SES_TWO']);
    assert.equal(authContextCacheService.getCachedAuthContext(userId, 'SES_ONE'), null);
    assert.equal(authContextCacheService.getCachedAuthContext(userId, 'SES_TWO'), null);
  } finally {
    Object.assign(dataService, originals);
    authContextCacheService.clearAuthContextCache();
  }
});
