const RATE_GROUPS = ['auth', 'picker', 'write', 'heavy', 'global'];

const ROUTE_CATALOG = [
  {
    id: 'auth_login',
    label: 'Login Submit',
    method: 'POST',
    matchType: 'exact',
    path: '/login',
    defaultGroup: 'auth',
    locked: true
  },
  {
    id: 'auth_force_login',
    label: 'Force Login Submit',
    method: 'POST',
    matchType: 'exact',
    path: '/force-login',
    defaultGroup: 'auth',
    locked: true
  },
  {
    id: 'auth_captcha',
    label: 'Captcha Fetch',
    method: 'GET',
    matchType: 'exact',
    path: '/captcha',
    defaultGroup: 'auth',
    locked: true
  },
  {
    id: 'heavy_export_any',
    label: 'Any Export Route',
    method: '*',
    matchType: 'contains',
    path: '/export',
    defaultGroup: 'heavy',
    locked: false
  },
  {
    id: 'heavy_import_any',
    label: 'Any Import Route',
    method: '*',
    matchType: 'contains',
    path: '/import',
    defaultGroup: 'heavy',
    locked: false
  },
  {
    id: 'heavy_generate_any',
    label: 'Any Generate Route',
    method: '*',
    matchType: 'contains',
    path: '/generate',
    defaultGroup: 'heavy',
    locked: false
  },
  {
    id: 'heavy_download_any',
    label: 'Any Download Route',
    method: '*',
    matchType: 'contains',
    path: '/download',
    defaultGroup: 'heavy',
    locked: false
  },
  {
    id: 'heavy_sample_data',
    label: 'Sample Data Generator',
    method: '*',
    matchType: 'prefix',
    path: '/school/sample-data',
    defaultGroup: 'heavy',
    locked: false
  },
  {
    id: 'heavy_data_maintenance',
    label: 'School Data Maintenance',
    method: '*',
    matchType: 'prefix',
    path: '/school/data-maintenance',
    defaultGroup: 'heavy',
    locked: false
  },
  {
    id: 'picker_search_q',
    label: 'Search Endpoints With q',
    method: 'GET',
    matchType: 'contains',
    path: '/search',
    defaultGroup: 'picker',
    locked: false,
    requiresQuery: ['q']
  },
  {
    id: 'picker_eligible_q',
    label: 'Eligible Endpoints With q',
    method: 'GET',
    matchType: 'contains',
    path: '/eligible-',
    defaultGroup: 'picker',
    locked: false,
    requiresQuery: ['q']
  },
  {
    id: 'picker_available_q',
    label: 'Available Endpoints With q',
    method: 'GET',
    matchType: 'contains',
    path: '/available-',
    defaultGroup: 'picker',
    locked: false,
    requiresQuery: ['q']
  },
  {
    id: 'picker_api_q',
    label: 'API Endpoints With q',
    method: 'GET',
    matchType: 'prefix',
    path: '/api',
    defaultGroup: 'picker',
    locked: false,
    requiresQuery: ['q']
  }
];

const routeById = new Map(ROUTE_CATALOG.map((rule) => [rule.id, rule]));
const groupOrder = new Map(RATE_GROUPS.map((g, idx) => [g, idx]));

function normalizePath(raw) {
  return String(raw || '/').split('?')[0].toLowerCase();
}

function isValidGroup(group) {
  return RATE_GROUPS.includes(String(group || '').toLowerCase());
}

function normalizePositiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeKeyMode(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'ip' || v === 'user_or_ip' || v === 'username_ip') return v;
  return '';
}

function normalizeSpecificMode(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'monitor' || v === 'enforce') return v;
  return 'inherit';
}

function sanitizeRouteSpecificSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const enabled = String(src.enabled || '').toLowerCase() === 'true' || src.enabled === true;
  const windowMs = normalizePositiveInt(src.windowMs);
  const max = normalizePositiveInt(src.max);
  const keyMode = normalizeKeyMode(src.keyMode);
  const mode = normalizeSpecificMode(src.mode);

  return {
    enabled,
    windowMs,
    max,
    keyMode,
    mode
  };
}

function sanitizeRouteCatalogOverrides(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const disabledSource = Array.isArray(source.disabledRouteIds) ? source.disabledRouteIds : [];
  const groupSource = source.groupOverrides && typeof source.groupOverrides === 'object' ? source.groupOverrides : {};
  const settingsSource = source.routeSettings && typeof source.routeSettings === 'object' ? source.routeSettings : {};

  const disabledRouteIds = [];
  for (const idRaw of disabledSource) {
    const id = String(idRaw || '').trim();
    const base = routeById.get(id);
    if (!base || base.locked) continue;
    disabledRouteIds.push(id);
  }

  const groupOverrides = {};
  for (const [idRaw, groupRaw] of Object.entries(groupSource)) {
    const id = String(idRaw || '').trim();
    const base = routeById.get(id);
    if (!base || base.locked) continue;
    const group = String(groupRaw || '').trim().toLowerCase();
    if (!isValidGroup(group)) continue;
    if (group !== base.defaultGroup) {
      groupOverrides[id] = group;
    }
  }

  const routeSettings = {};
  for (const [idRaw, settingRaw] of Object.entries(settingsSource)) {
    const id = String(idRaw || '').trim();
    const base = routeById.get(id);
    if (!base) continue;
    const normalized = sanitizeRouteSpecificSettings(settingRaw);
    if (!normalized.enabled && !normalized.windowMs && !normalized.max && !normalized.keyMode && normalized.mode === 'inherit') {
      continue;
    }
    routeSettings[id] = normalized;
  }

  return {
    disabledRouteIds: Array.from(new Set(disabledRouteIds)),
    groupOverrides,
    routeSettings
  };
}

function getRouteCatalogOverrides(requestControl) {
  const overrides = requestControl && requestControl.routeCatalog ? requestControl.routeCatalog : {};
  return sanitizeRouteCatalogOverrides(overrides);
}

function buildEffectiveRouteCatalog(requestControl) {
  const overrides = getRouteCatalogOverrides(requestControl);
  const disabledSet = new Set(overrides.disabledRouteIds || []);
  const groupOverrides = overrides.groupOverrides || {};
  const settings = overrides.routeSettings || {};

  return ROUTE_CATALOG.map((base) => {
    const group = isValidGroup(groupOverrides[base.id]) ? groupOverrides[base.id] : base.defaultGroup;
    const enabled = base.locked ? true : !disabledSet.has(base.id);
    const routeSetting = sanitizeRouteSpecificSettings(settings[base.id] || {});
    return {
      ...base,
      group,
      enabled,
      routeSetting
    };
  });
}

function buildRouteCatalogViewModel(requestControl) {
  const rows = buildEffectiveRouteCatalog(requestControl);
  rows.sort((a, b) => {
    const ga = groupOrder.get(a.group) ?? 999;
    const gb = groupOrder.get(b.group) ?? 999;
    if (ga !== gb) return ga - gb;
    return String(a.label || a.id).localeCompare(String(b.label || b.id));
  });
  return rows;
}

function methodMatches(rule, reqMethod) {
  const m = String(rule.method || '*').toUpperCase();
  if (m === '*') return true;
  return m === String(reqMethod || '').toUpperCase();
}

function pathMatches(rule, path) {
  const p = String(rule.path || '').toLowerCase();
  const target = normalizePath(path);
  const type = String(rule.matchType || 'exact').toLowerCase();

  if (type === 'exact') return target === p;
  if (type === 'prefix') return target === p || target.startsWith(`${p}/`);
  if (type === 'contains') return target.includes(p);
  return false;
}

function queryMatches(rule, req) {
  if (!Array.isArray(rule.requiresQuery) || rule.requiresQuery.length === 0) return true;
  for (const key of rule.requiresQuery) {
    if (!Object.prototype.hasOwnProperty.call(req.query || {}, key)) return false;
  }
  return true;
}

function priorityOf(rule) {
  const type = String(rule.matchType || 'exact').toLowerCase();
  if (type === 'exact') return 3000;
  if (type === 'prefix') return 2000;
  if (type === 'contains') return 1000;
  return 0;
}

function findRouteGroupMatch(req, effectiveCatalog) {
  const method = String(req.method || 'GET').toUpperCase();
  const path = normalizePath(req.path || req.originalUrl || '/');
  const rules = Array.isArray(effectiveCatalog) ? effectiveCatalog : [];

  const matches = rules.filter((rule) => {
    if (!rule.enabled) return false;
    if (!methodMatches(rule, method)) return false;
    if (!queryMatches(rule, req)) return false;
    return pathMatches(rule, path);
  });

  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    const pa = priorityOf(a);
    const pb = priorityOf(b);
    if (pa !== pb) return pb - pa;
    return String(b.path || '').length - String(a.path || '').length;
  });

  return matches[0];
}

module.exports = {
  RATE_GROUPS,
  ROUTE_CATALOG,
  sanitizeRouteCatalogOverrides,
  getRouteCatalogOverrides,
  buildEffectiveRouteCatalog,
  buildRouteCatalogViewModel,
  findRouteGroupMatch
};
