'use strict';

const systemSettingsModel = require('../models/systemSettingsModel');

const DEFAULT_NEWS_UNREAD_NOTIFY = Object.freeze({
  enabled: true,
  notifyStartDate: '',
  notifyEndDate: '',
  categories: []
});

const READ_ARTICLE_IDS_KEY = 'news.readArticleIds';
const MAX_READ_ID_CACHE = 2000;

function cleanDateToken(value) {
  const token = String(value ?? '').trim();
  if (!token) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return null;
  const parsed = Date.parse(`${token}T12:00:00.000Z`);
  if (!Number.isFinite(parsed)) return null;
  return token;
}

function normalizeCategoryList(raw) {
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const seen = new Set();
  const out = [];
  list.forEach((entry) => {
    const name = String(entry || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  });
  return out;
}

function normalizePolicyFromStored(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const start = cleanDateToken(source.notifyStartDate);
  const end = cleanDateToken(source.notifyEndDate);
  return {
    enabled: source.enabled !== false,
    notifyStartDate: start === null ? '' : (start || ''),
    notifyEndDate: end === null ? '' : (end || ''),
    categories: normalizeCategoryList(source.categories)
  };
}

function normalizePolicyFromForm(body = {}) {
  const source = body && typeof body === 'object' ? body : {};
  let categories = [];
  const rawCats = source.newsUnreadNotifyCategories;
  if (Array.isArray(rawCats)) {
    categories = rawCats;
  } else if (rawCats) {
    categories = [rawCats];
  }
  const startRaw = cleanDateToken(source.newsUnreadNotifyStartDate);
  const endRaw = cleanDateToken(source.newsUnreadNotifyEndDate);
  if (startRaw === null) {
    throw new Error('News unread notify start date must be YYYY-MM-DD.');
  }
  if (endRaw === null) {
    throw new Error('News unread notify end date must be YYYY-MM-DD.');
  }
  return normalizePolicyFromStored({
    enabled: source.newsUnreadNotifyEnabled === 'true',
    notifyStartDate: startRaw,
    notifyEndDate: endRaw,
    categories
  });
}

function validatePolicyInput(policy = {}) {
  const normalized = normalizePolicyFromStored(policy);
  const { notifyStartDate, notifyEndDate } = normalized;
  if (notifyStartDate && notifyEndDate && notifyStartDate > notifyEndDate) {
    throw new Error('News unread notify start date must be on or before the end date.');
  }
  return normalized;
}

function getPolicySync() {
  const settings = systemSettingsModel.getSettingsSync();
  const appPolicy = settings?.app?.newsUnreadNotify;
  return normalizePolicyFromStored({
    ...DEFAULT_NEWS_UNREAD_NOTIFY,
    ...(appPolicy && typeof appPolicy === 'object' ? appPolicy : {})
  });
}

function enrichPolicyForDisplay(raw = {}) {
  return normalizePolicyFromStored(raw);
}

module.exports = {
  DEFAULT_NEWS_UNREAD_NOTIFY,
  READ_ARTICLE_IDS_KEY,
  MAX_READ_ID_CACHE,
  normalizePolicyFromStored,
  normalizePolicyFromForm,
  validatePolicyInput,
  getPolicySync,
  enrichPolicyForDisplay
};
