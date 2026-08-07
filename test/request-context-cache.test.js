'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createTtlLruCache } = require('../MVC/services/cache/ttlLruCache');
const { cloneCacheValue } = require('../MVC/services/cache/cacheClone');
const websitePolicyCacheService = require('../MVC/services/cache/websitePolicyCacheService');
const authContextCacheService = require('../MVC/services/cache/authContextCacheService');
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
  assert.equal(settingsModel.DEFAULTS.app.requestCacheTtlSeconds, 60);
  assert.equal(settingsModel.DEFAULTS.app.requestCacheMaxEntries, 500);
  const appSettingsView = read('MVC/views/systemSettings/appSettings.ejs');
  assert.match(appSettingsView, /requestCacheTtlSeconds/);
  assert.match(appSettingsView, /requestCacheMaxEntries/);
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
