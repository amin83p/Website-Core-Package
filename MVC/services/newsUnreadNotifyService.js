'use strict';

const { idsEqual, toPublicId } = require('../utils/idAdapter');
const newsVisibilityService = require('./newsVisibilityService');
const newsUnreadNotifyPolicyService = require('./newsUnreadNotifyPolicyService');
const userSettingsService = require('./userSettingsService');
const { buildNewsScope } = require('./security/dataScopeBuilder');

const READ_IDS_KEY = newsUnreadNotifyPolicyService.READ_ARTICLE_IDS_KEY;
const MAX_READ_CACHE = newsUnreadNotifyPolicyService.MAX_READ_ID_CACHE;

function isPublishedItem(item = {}) {
  return String(item?.status || '').trim().toLowerCase() === 'published';
}

function parsePublishMs(item = {}) {
  const raw = item?.meta?.publishDate
    || item?.audit?.createDateTime
    || item?.createdAt
    || '';
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : 0;
}

function inNotifyDateWindow(publishMs, policy = {}) {
  if (!publishMs) return true;
  const start = String(policy.notifyStartDate || '').trim();
  const end = String(policy.notifyEndDate || '').trim();
  if (start) {
    const startMs = Date.parse(`${start}T00:00:00.000Z`);
    if (Number.isFinite(startMs) && publishMs < startMs) return false;
  }
  if (end) {
    const endMs = Date.parse(`${end}T23:59:59.999Z`);
    if (Number.isFinite(endMs) && publishMs > endMs) return false;
  }
  return true;
}

function matchesCategory(item = {}, policy = {}) {
  const allowed = Array.isArray(policy.categories) ? policy.categories : [];
  if (!allowed.length) return true;
  const category = String(item?.meta?.category || 'General').trim().toLowerCase();
  return allowed.some((name) => String(name || '').trim().toLowerCase() === category);
}

function filterCandidateArticles(rows = [], policy = {}, user = null) {
  const scope = buildNewsScope(user || null);
  const visible = newsVisibilityService.filterVisibleNews(rows, scope);
  return visible.filter((item) => {
    if (!isPublishedItem(item)) return false;
    if (!inNotifyDateWindow(parsePublishMs(item), policy)) return false;
    return matchesCategory(item, policy);
  });
}

function analyticsHasUserRead(item = {}, userId = '') {
  const id = toPublicId(userId);
  if (!id) return false;
  const logs = Array.isArray(item?.analytics) ? item.analytics : [];
  return logs.some((row) => idsEqual(row?.userId, id));
}

function normalizeReadIdSet(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  list.forEach((entry) => {
    const token = toPublicId(entry) || String(entry || '').trim();
    if (!token || seen.has(token)) return;
    seen.add(token);
    out.push(token);
  });
  return out;
}

function articleHrefToken(item = {}) {
  const slug = String(item?.meta?.slug || '').trim();
  const id = toPublicId(item?.id) || String(item?.id || '').trim();
  return slug || id || '';
}

function mapUnreadItem(item = {}) {
  const token = articleHrefToken(item);
  return {
    id: toPublicId(item?.id) || String(item?.id || '').trim(),
    title: String(item?.meta?.title || 'Untitled').trim() || 'Untitled',
    category: String(item?.meta?.category || 'General').trim() || 'General',
    publishDate: item?.meta?.publishDate || item?.audit?.createDateTime || '',
    url: token ? `/news/article/${encodeURIComponent(token)}` : '/news'
  };
}

function collectReadIdsFromAnalytics(candidates = [], userId = '') {
  const id = toPublicId(userId);
  if (!id) return [];
  const found = [];
  candidates.forEach((item) => {
    if (!analyticsHasUserRead(item, id)) return;
    const newsId = toPublicId(item?.id) || String(item?.id || '').trim();
    if (newsId) found.push(newsId);
  });
  return found;
}

function isArticleRead(item = {}, userId = '', readIdSet = new Set()) {
  const newsId = toPublicId(item?.id) || String(item?.id || '').trim();
  if (newsId && readIdSet.has(newsId)) return true;
  return analyticsHasUserRead(item, userId);
}

async function ensureReadIdCache(userId, candidates = [], options = {}) {
  const id = toPublicId(userId);
  if (!id) return new Set();

  const existing = normalizeReadIdSet(
    await userSettingsService.getSetting(id, READ_IDS_KEY, [], options)
  );
  if (existing.length > 0) {
    return new Set(existing);
  }

  const fromAnalytics = collectReadIdsFromAnalytics(candidates, id);
  if (!fromAnalytics.length) return new Set();

  const merged = normalizeReadIdSet(fromAnalytics).slice(-MAX_READ_CACHE);
  try {
    await userSettingsService.setSetting(id, READ_IDS_KEY, merged, id, options);
  } catch (_) {
    // Non-critical cache warm-up.
  }
  return new Set(merged);
}

async function appendReadArticleId(userId, newsId, options = {}) {
  const uid = toPublicId(userId);
  const nid = toPublicId(newsId) || String(newsId || '').trim();
  if (!uid || !nid) return;

  const current = normalizeReadIdSet(
    await userSettingsService.getSetting(uid, READ_IDS_KEY, [], options)
  );
  if (current.some((entry) => idsEqual(entry, nid))) return;

  const next = [...current, nid];
  const trimmed = next.length > MAX_READ_CACHE ? next.slice(-MAX_READ_CACHE) : next;
  await userSettingsService.setSetting(uid, READ_IDS_KEY, trimmed, uid, options);
}

function createService(deps = {}) {
  const getAccessibleNews = deps.getAccessibleNews
    || (async (user) => {
      const dataService = require('./dataService');
      return dataService.getAccessibleNews(user);
    });
  const getPolicy = deps.getPolicy || (() => newsUnreadNotifyPolicyService.getPolicySync());

  async function getUnreadForUser(user, options = {}) {
    const policy = getPolicy();
    if (!policy.enabled) {
      return { enabled: false, hasUnread: false, count: 0, items: [] };
    }
    if (!user) {
      return { enabled: true, hasUnread: false, count: 0, items: [] };
    }

    const allNews = await getAccessibleNews(user);
    const candidates = filterCandidateArticles(allNews, policy, user);
    const userId = toPublicId(user.id || user.userId);
    const readIdSet = await ensureReadIdCache(userId, candidates, options);

    const unread = candidates.filter((item) => !isArticleRead(item, userId, readIdSet));
    unread.sort((a, b) => parsePublishMs(b) - parsePublishMs(a));
    const items = unread.map((item) => mapUnreadItem(item));

    return {
      enabled: true,
      hasUnread: items.length > 0,
      count: items.length,
      items
    };
  }

  return {
    filterCandidateArticles,
    inNotifyDateWindow,
    matchesCategory,
    isArticleRead,
    appendReadArticleId,
    getUnreadForUser
  };
}

const defaultService = createService();

module.exports = {
  createService,
  filterCandidateArticles,
  inNotifyDateWindow,
  matchesCategory,
  isArticleRead,
  analyticsHasUserRead,
  appendReadArticleId: defaultService.appendReadArticleId.bind(defaultService),
  getUnreadForUser: defaultService.getUnreadForUser.bind(defaultService)
};
