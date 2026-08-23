const accessService = require('./index');

const UI_ACCESS_CACHE_TTL_MS = 30 * 1000;
const UI_ACCESS_CACHE_MAX_ENTRIES = 2000;
const uiAccessCache = new Map();

function normalizeText(value) {
  return String(value || '').trim();
}

function cacheKey(sectionId = '', operationId = '') {
  return `${normalizeText(sectionId)}::${normalizeText(operationId)}`;
}

function extractSessionId(req) {
  const token = String(req?.cookies?.auth_token || '').trim();
  const parts = token.split('.');
  return parts.length === 3 ? normalizeText(parts[2]) : '';
}

function resolveProfileKey(user = {}) {
  return [
    user.currentProfileMode,
    user.activeProfile?.id,
    user.activeProfile?.updatedAt || user.activeProfile?.audit?.lastUpdateDateTime,
    user.activePolicy?.id,
    user.activePolicy?.updatedAt || user.activePolicy?.audit?.lastUpdateDateTime,
    user.activeOrgPolicy?.id,
    user.activeOrgPolicy?.updatedAt || user.activeOrgPolicy?.audit?.lastUpdateDateTime
  ].map(normalizeText).join('|');
}

function globalCacheKey(req, sectionId = '', operationId = '') {
  const user = req?.user;
  const userId = normalizeText(user?.id);
  if (!userId) return '';
  return [
    userId,
    extractSessionId(req),
    normalizeText(user?.activeOrgId),
    resolveProfileKey(user),
    normalizeText(req?.ip),
    normalizeText(sectionId),
    normalizeText(operationId)
  ].join('::');
}

function getCachedUiAccess(req, sectionId = '', operationId = '') {
  const key = globalCacheKey(req, sectionId, operationId);
  if (!key) return { hit: false, value: false };

  const cached = uiAccessCache.get(key);
  if (!cached) return { hit: false, value: false };
  if (cached.expiresAt <= Date.now()) {
    uiAccessCache.delete(key);
    return { hit: false, value: false };
  }
  return { hit: true, value: cached.allowed === true };
}

function setCachedUiAccess(req, sectionId = '', operationId = '', allowed = false) {
  const key = globalCacheKey(req, sectionId, operationId);
  if (!key) return;

  if (uiAccessCache.size >= UI_ACCESS_CACHE_MAX_ENTRIES) {
    const oldestKey = uiAccessCache.keys().next().value;
    if (oldestKey) uiAccessCache.delete(oldestKey);
  }
  uiAccessCache.set(key, {
    allowed: allowed === true,
    expiresAt: Date.now() + UI_ACCESS_CACHE_TTL_MS
  });
}

function clearUiAccessCache() {
  uiAccessCache.clear();
}

function invalidateUiAccessCacheForUser(userId) {
  const prefix = `${normalizeText(userId)}::`;
  if (prefix === '::') return 0;
  let removed = 0;
  for (const key of Array.from(uiAccessCache.keys())) {
    if (!key.startsWith(prefix)) continue;
    uiAccessCache.delete(key);
    removed += 1;
  }
  return removed;
}

function getRequestCache(req) {
  if (!req || typeof req !== 'object') return new Map();
  if (!req.__accessUiEvaluationCache) {
    Object.defineProperty(req, '__accessUiEvaluationCache', {
      configurable: false,
      enumerable: false,
      writable: true,
      value: new Map()
    });
  }
  return req.__accessUiEvaluationCache;
}

async function canAccessTarget(req, target = {}) {
  const sectionId = normalizeText(target.sectionId);
  const operationId = normalizeText(target.operationId);
  if (!sectionId || !operationId || !req?.user) return false;

  const cache = getRequestCache(req);
  const key = cacheKey(sectionId, operationId);
  if (cache.has(key)) return cache.get(key);

  const globalCached = getCachedUiAccess(req, sectionId, operationId);
  if (globalCached.hit) {
    cache.set(key, globalCached.value);
    return globalCached.value;
  }

  let allowed = false;
  try {
    const evaluation = await accessService.evaluateAccess({
      user: req.user,
      sectionId,
      operationId,
      ipAddress: req.ip
    });
    allowed = evaluation?.allowed === true;
  } catch (_) {
    allowed = false;
  }

  cache.set(key, allowed);
  setCachedUiAccess(req, sectionId, operationId, allowed);
  return allowed;
}

async function canAccessAction(req, action = {}) {
  if (!action || typeof action !== 'object') return false;
  if (action.public === true) return true;

  const anyOf = Array.isArray(action.anyOf) ? action.anyOf : [];
  if (anyOf.length) {
    for (const target of anyOf) {
      // eslint-disable-next-line no-await-in-loop
      if (await canAccessTarget(req, target)) return true;
    }
    return false;
  }

  return canAccessTarget(req, action);
}

async function filterActions(req, actions = []) {
  const output = [];
  const list = Array.isArray(actions) ? actions : [];
  for (const action of list) {
    // eslint-disable-next-line no-await-in-loop
    if (await canAccessAction(req, action)) output.push(action);
  }
  return output;
}

async function accessFlags(req, sectionId, operations = {}) {
  const entries = Object.entries(operations || {});
  const result = {};
  for (const [key, operationId] of entries) {
    // eslint-disable-next-line no-await-in-loop
    result[key] = await canAccessTarget(req, { sectionId, operationId });
  }
  return result;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAction(action = {}, options = {}) {
  const classes = normalizeText(action.className || options.className || 'btn btn-outline-secondary btn-md mb-2');
  const href = normalizeText(action.href || '#');
  const icon = normalizeText(action.icon || '');
  const label = normalizeText(action.label || '');
  const title = normalizeText(action.title || label);
  const iconHtml = icon ? `<i class="bi ${escapeHtml(icon)} me-1"></i>` : '';
  return `<a href="${escapeHtml(href)}" class="${escapeHtml(classes)}" title="${escapeHtml(title)}">${iconHtml}${escapeHtml(label)}</a>`;
}

function renderActions(actions = [], options = {}) {
  return (Array.isArray(actions) ? actions : []).map((action) => renderAction(action, options));
}

module.exports = {
  clearUiAccessCache,
  invalidateUiAccessCacheForUser,
  accessFlags,
  canAccessAction,
  canAccessTarget,
  filterActions,
  renderAction,
  renderActions
};
