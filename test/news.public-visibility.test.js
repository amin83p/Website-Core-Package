const test = require('node:test');
const assert = require('node:assert/strict');

const newsVisibilityService = require('../MVC/services/newsVisibilityService');

const SAMPLE_NEWS = Object.freeze([
  { id: 'published-public', status: 'published', visibility: 'public' },
  { id: 'draft-public', status: 'draft', visibility: 'public' },
  { id: 'archived-public', status: 'archived', visibility: 'public' },
  { id: 'published-users', status: 'published', visibility: 'users' },
  { id: 'published-org-active', status: 'published', visibility: 'org', targetOrgId: '900000' },
  { id: 'published-org-array', status: 'published', visibility: 'org', targetOrgIds: ['900000'] },
  { id: 'published-org-other', status: 'published', visibility: 'org', targetOrgId: '900001' }
]);

function ids(rows = []) {
  return rows.map((row) => row.id).sort();
}

test('news visibility lets guests see only published public articles', () => {
  const visible = newsVisibilityService.filterVisibleNews(SAMPLE_NEWS, {
    canViewAll: false,
    isAuthenticated: false,
    activeOrgId: null
  });

  assert.deepEqual(ids(visible), ['published-public']);
});

test('news visibility lets authenticated users see public, users-only, and active-org articles', () => {
  const visible = newsVisibilityService.filterVisibleNews(SAMPLE_NEWS, {
    canViewAll: false,
    isAuthenticated: true,
    activeOrgId: '900000'
  });

  assert.deepEqual(ids(visible), [
    'published-org-active',
    'published-org-array',
    'published-public',
    'published-users'
  ]);
});

test('news visibility blocks authenticated users from other organizations', () => {
  const visible = newsVisibilityService.filterVisibleNews(SAMPLE_NEWS, {
    canViewAll: false,
    isAuthenticated: true,
    activeOrgId: '900002'
  });

  assert.deepEqual(ids(visible), ['published-public', 'published-users']);
});

test('news visibility preserves canViewAll behavior for admin management contexts', () => {
  const visible = newsVisibilityService.filterVisibleNews(SAMPLE_NEWS, {
    canViewAll: true,
    isAuthenticated: true,
    activeOrgId: '900000'
  });

  assert.deepEqual(ids(visible), ids(SAMPLE_NEWS));
});

test('news JSON query executor uses the shared public visibility rules', async () => {
  const newsModel = require('../MVC/models/newsModel');
  const { registerCoreEntityQueryExecutors } = require('../MVC/models/queryExecutorBootstrap');
  const { getEntityQueryExecutor } = require('../MVC/models/queryExecutionBridge');

  const originalGetAllNews = newsModel.getAllNews;
  newsModel.getAllNews = async () => SAMPLE_NEWS.map((row) => ({ ...row }));

  try {
    registerCoreEntityQueryExecutors({ backendMode: 'json' });
    const executor = getEntityQueryExecutor('news');
    assert.equal(typeof executor, 'function');

    const guestRows = await executor({
      query: {},
      scope: { canViewAll: false, isAuthenticated: false, activeOrgId: null },
      fallback: {}
    });
    assert.deepEqual(ids(guestRows), ['published-public']);

    const userRows = await executor({
      query: {},
      scope: { canViewAll: false, isAuthenticated: true, activeOrgId: '900000' },
      fallback: {}
    });
    assert.deepEqual(ids(userRows), [
      'published-org-active',
      'published-org-array',
      'published-public',
      'published-users'
    ]);
  } finally {
    newsModel.getAllNews = originalGetAllNews;
  }
});

test('news Mongo scope filter allows guest access to published public articles', () => {
  const filter = newsVisibilityService.buildMongoNewsScopeFilter({
    canViewAll: false,
    isAuthenticated: false,
    activeOrgId: null
  });

  assert.deepEqual(filter, {
    $and: [
      { status: { $regex: /^published$/i } },
      { $or: [{ visibility: { $regex: /^public$/i } }] }
    ]
  });
});
