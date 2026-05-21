const settingService = require('../services/settingService');

function parseSearchKeywords(value) {
  return String(value || '')
    .split(/[,\|;]/)
    .map((part) => String(part || '').trim().toLowerCase())
    .filter(Boolean);
}

function getSearchKeywordSet() {
  const configuredRaw = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
  const configured = parseSearchKeywords(configuredRaw);
  const fallback = ['aaa', '---'];
  const all = new Set([...fallback, ...configured]);
  return all;
}

function normalizeSearchKeyword(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.toLowerCase();
  return getSearchKeywordSet().has(normalized) ? '' : raw;
}

exports.normalizeSearchKeyword = normalizeSearchKeyword;

exports.isAjax = (req) => {
  if (!req) return false;
  if (req.xhr) return true;

  const xAjaxHeader = req.headers?.['x-ajax-request'];
  if (xAjaxHeader !== undefined) return Boolean(xAjaxHeader);

  const xRequestedWith = String(req.headers?.['x-requested-with'] || '').toLowerCase();
  if (xRequestedWith === 'xmlhttprequest') return true;

  return false;
}

exports.inferSearchableFields = async (records = [], options = {}) => {
  const {
    exclude = ['audit', 'meta', 'attachments', 'files'],
    include = null,          // optional allow-list override
    sampleSize = 3
  } = options;

  const arr = Array.isArray(records) ? records : [];
  const sample = arr.slice(0, sampleSize);

  const keys = new Set();

  for (const item of sample) {
    if (!item || typeof item !== 'object') continue;

    for (const k of Object.keys(item)) {
      if (exclude.includes(k)) continue;
      if (include && !include.includes(k)) continue;

      const v = item[k];
      // keep only simple primitives by default (good for generic search)
      if (v === null) continue;
      if (['string', 'number', 'boolean'].includes(typeof v)) keys.add(k);
    }
  }

  // Always include id if present
  if (sample[0] && Object.prototype.hasOwnProperty.call(sample[0], 'id')) keys.add('id');

  return Array.from(keys);
}

// /MVC/utils/buildDataServiceQuery.js
exports.buildDataServiceQuery = async (qs = {}, options = {}) => {
  const {
    // If null => accept all non-reserved keys as exact filters (even in search-scheme)
    allowedExactKeys = ['id','userId','sectionId','targetKey','operationId','status','startDate','endDate'],

    // Validate client-selected search fields (optional)
    allowedSearchFields = null,

    // Default fields when "all" or nothing selected (optional)
    defaultSearchFields = null,

    // Optional passthrough for pagination/sort keys
    allowMetaKeys = true
  } = options;

  const RESERVED = new Set(['q', 'type', 'searchField', 'searchFields', 'page', 'limit', 'sort', 'order']);

  const out = {};

  const toStr = (v) => (v === undefined || v === null) ? '' : String(v).trim();
  const hasVal = (v) => toStr(v) !== '';

  const normalizeType = (raw) => {
    const t = toStr(raw).toLowerCase().replace(/\s+/g, '_');
    const map = {
      contains: 'contains',
      contain: 'contains',

      startswith: 'starts_with',
      starts_with: 'starts_with',
      startswith_: 'starts_with',
      starts: 'starts_with',
      prefix: 'starts_with',

      exactmatch: 'exact_match',
      exact_match: 'exact_match',
      exact: 'exact_match',
      equals: 'exact_match',
      eq: 'exact_match'
    };
    return map[t] || null;
  };

  const normalizedQ = normalizeSearchKeyword(qs.q);
  const hasNormalizedQ = normalizedQ !== '';

  // Detect whether query uses the "search scheme"
  const isSearchScheme =
    hasNormalizedQ ||
    hasVal(qs.type) ||
    hasVal(qs.searchFields) ||
    hasVal(qs.searchField);

  // ✅ If NOT search-scheme: allow all non-reserved keys as exact filters
  // ✅ If search-scheme: use allowlist (unless allowedExactKeys === null)
  const effectiveAllowedExactKeys = isSearchScheme ? allowedExactKeys : null;

  // ---- free-text query
  if (hasNormalizedQ) out.q = normalizedQ;

  // ---- type normalization for q search
  const normalizedType = normalizeType(qs.type);
  if (normalizedType) out.type = normalizedType;

  // ---- searchFields normalization (string CSV or array)
  // Accept either searchField (single) or searchFields (csv/array)
  let fieldsRaw = qs.searchFields ?? qs.searchField;
  let fields = [];

  if (Array.isArray(fieldsRaw)) {
    fields = fieldsRaw.map(toStr).filter(Boolean);
  } else {
    const s = toStr(fieldsRaw);
    if (s) fields = s.split(',').map(f => f.trim()).filter(Boolean);
  }

  // Handle "all"
  const isAll =
    fields.length === 0 ||
    (fields.length === 1 && fields[0].toLowerCase() === 'all');

  if (!isAll) {
    // Validate against allowlist if provided
    if (Array.isArray(allowedSearchFields) && allowedSearchFields.length) {
      fields = fields.filter(f => allowedSearchFields.includes(f));
    }
    // genericFilter accepts csv string OR array; you are using csv
    if (fields.length === 1) out.searchFields = fields[0];
    else if (fields.length > 1) out.searchFields = fields.join(',');
  } else if (Array.isArray(defaultSearchFields) && defaultSearchFields.length) {
    const defaults = defaultSearchFields.map(toStr).filter(Boolean);
    if (defaults.length === 1) out.searchFields = defaults[0];
    else if (defaults.length > 1) out.searchFields = defaults.join(',');
  }

  // ---- Meta keys + pagination defaults
  if (allowMetaKeys) {
    const defaultSize = settingService.getValue('app', 'defaultPageSize');// || 20;

    const pageInt = parseInt(toStr(qs.page), 10);
    const limitInt = parseInt(toStr(qs.limit), 10);

    out.page = Number.isFinite(pageInt) && pageInt > 0 ? pageInt : 1;
    out.limit = Number.isFinite(limitInt) && limitInt > 0 ? limitInt : defaultSize;

    if (hasVal(qs.sort)) out.sort = toStr(qs.sort);
    if (hasVal(qs.order)) out.order = toStr(qs.order);
  }

  // ---- Exact filters
  // Filter-mode (no q/type/searchFields): include all non-reserved keys
  // Search-scheme: include only allowedExactKeys (unless allowedExactKeys === null)
  const includeKey = (key) => {
    if (RESERVED.has(key)) return false;
    if (effectiveAllowedExactKeys === null) return true;
    return Array.isArray(effectiveAllowedExactKeys) && effectiveAllowedExactKeys.includes(key);
  };

  for (const [key, val] of Object.entries(qs)) {
    if (!includeKey(key)) continue;

    // Normalize arrays (e.g. ?status=a&status=b):
    // take the first non-empty (genericFilter doesn't support OR semantics)
    if (Array.isArray(val)) {
      const first = val.map(toStr).find(Boolean);
      if (first) out[key] = first;
      continue;
    }

    const s = toStr(val);
    if (!s) continue; // drop empty strings like id=
    out[key] = s;
  }

  return out;
};

function str(v) {
  return String(v ?? '').trim();
}

