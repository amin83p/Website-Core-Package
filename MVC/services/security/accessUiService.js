const accessService = require('./index');

function normalizeText(value) {
  return String(value || '').trim();
}

function cacheKey(sectionId = '', operationId = '') {
  return `${normalizeText(sectionId)}::${normalizeText(operationId)}`;
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
  accessFlags,
  canAccessAction,
  canAccessTarget,
  filterActions,
  renderAction,
  renderActions
};
