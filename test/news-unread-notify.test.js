'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const policyService = require('../MVC/services/newsUnreadNotifyPolicyService');
const {
  createService,
  inNotifyDateWindow,
  matchesCategory,
  isArticleRead,
  analyticsHasUserRead
} = require('../MVC/services/newsUnreadNotifyService');

test('news unread policy normalizes form input and validates date order', () => {
  const normalized = policyService.validatePolicyInput(
    policyService.normalizePolicyFromForm({
      newsUnreadNotifyEnabled: 'true',
      newsUnreadNotifyStartDate: '2026-01-01',
      newsUnreadNotifyEndDate: '2026-12-31',
      newsUnreadNotifyCategories: ['Announcements', 'General']
    })
  );
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.notifyStartDate, '2026-01-01');
  assert.equal(normalized.notifyEndDate, '2026-12-31');
  assert.deepEqual(normalized.categories, ['Announcements', 'General']);

  assert.throws(
    () => policyService.validatePolicyInput({
      enabled: true,
      notifyStartDate: '2026-12-01',
      notifyEndDate: '2026-01-01',
      categories: []
    }),
    /start date must be on or before/
  );
});

test('news unread filters publish dates and categories', () => {
  const publishMs = Date.parse('2026-06-15T12:00:00.000Z');
  assert.equal(
    inNotifyDateWindow(publishMs, { notifyStartDate: '2026-06-01', notifyEndDate: '2026-06-30' }),
    true
  );
  assert.equal(
    inNotifyDateWindow(publishMs, { notifyStartDate: '2026-07-01', notifyEndDate: '' }),
    false
  );

  const item = { meta: { category: 'Announcements' } };
  assert.equal(matchesCategory(item, { categories: [] }), true);
  assert.equal(matchesCategory(item, { categories: ['Announcements'] }), true);
  assert.equal(matchesCategory(item, { categories: ['General'] }), false);
});

test('news unread read detection uses settings cache and analytics', () => {
  const item = {
    id: 'NEWS_001',
    analytics: [{ userId: 'USR_1', timestamp: '2026-01-01T00:00:00.000Z' }]
  };
  assert.equal(analyticsHasUserRead(item, 'USR_1'), true);
  assert.equal(isArticleRead(item, 'USR_2', new Set()), false);
  assert.equal(isArticleRead(item, 'USR_1', new Set(['NEWS_999'])), true);
  assert.equal(isArticleRead({ id: 'NEWS_002' }, 'USR_1', new Set(['NEWS_002'])), true);
});

test('news unread service returns disabled payload when policy is off', async () => {
  const svc = createService({
    getPolicy: () => ({ enabled: false, notifyStartDate: '', notifyEndDate: '', categories: [] }),
    getAccessibleNews: async () => []
  });
  const result = await svc.getUnreadForUser({ id: 'USR_1' });
  assert.equal(result.enabled, false);
  assert.equal(result.hasUnread, false);
  assert.equal(result.count, 0);
});

test('news unread service lists unread articles for user', async () => {
  const rows = [
    {
      id: 'NEWS_A',
      status: 'published',
      visibility: 'users',
      meta: { title: 'Alpha', category: 'General', slug: 'alpha', publishDate: '2026-06-01' },
      analytics: []
    },
    {
      id: 'NEWS_B',
      status: 'published',
      visibility: 'users',
      meta: { title: 'Beta', category: 'Announcements', slug: 'beta', publishDate: '2026-06-02' },
      analytics: [{ userId: 'USR_1' }]
    }
  ];
  const userSettingsService = require('../MVC/services/userSettingsService');
  const originalGet = userSettingsService.getSetting;
  const originalSet = userSettingsService.setSetting;
  userSettingsService.getSetting = async () => [];
  userSettingsService.setSetting = async () => ({});

  try {
    const svc = createService({
      getPolicy: () => ({ enabled: true, notifyStartDate: '', notifyEndDate: '', categories: [] }),
      getAccessibleNews: async () => rows
    });
    const result = await svc.getUnreadForUser({ id: 'USR_1', activeOrgId: '900000' });
    assert.equal(result.enabled, true);
    assert.equal(result.hasUnread, true);
    assert.equal(result.count, 1);
    assert.equal(result.items[0].id, 'NEWS_A');
    assert.equal(result.items[0].url, '/news/article/alpha');
  } finally {
    userSettingsService.getSetting = originalGet;
    userSettingsService.setSetting = originalSet;
  }
});

test('news unread side control script exposes broadcast UI hooks', () => {
  const source = read('public/scripts/newsUnreadSideControl.js');
  assert.match(source, /news-unread-side-control--broadcast/);
  assert.match(source, /newsUnreadListModal/);
  assert.match(source, /\/news\/api\/unread/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /news-unread-list-modal__item/);
});

test('layout wires news unread script when enabled', () => {
  const layout = read('MVC/views/layouts/layout.ejs');
  assert.match(layout, /layoutNewsUnreadSideControl/);
  assert.match(layout, /newsUnreadSideControl\.js/);
});

test('news routes register unread API', () => {
  const routes = read('MVC/routes/newsRoutes.js');
  assert.match(routes, /\/api\/unread/);
});
