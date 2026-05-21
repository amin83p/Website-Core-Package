const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const logger = require('../utils/logger');
const { buildEffectiveRouteCatalog, findRouteGroupMatch } = require('../utils/requestRateRouteCatalog');
const { blockTargetsUser } = require('../services/security/effectiveAccessResolverService');

const LOG_SECTION_ID = '000000';
const LOG_OPERATION_ID = 'OP9003';

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  mode: 'monitor', // monitor | enforce
  logCooldownMs: 60 * 1000,
  excludePaths: ['/health', '/favicon.ico'],
  phase2: {
    enabled: false,
    enforceGroups: ['auth', 'heavy']
  },
  phase3: {
    enabled: true
  },
  routeCatalog: {
    disabledRouteIds: [],
    groupOverrides: {},
    routeSettings: {}
  },
  routeOverrides: [],
  groups: {
    auth: { windowMs: 15 * 60 * 1000, max: 30, keyMode: 'username_ip' },
    picker: { windowMs: 60 * 1000, max: 120, keyMode: 'user_or_ip' },
    write: { windowMs: 60 * 1000, max: 80, keyMode: 'user_or_ip' },
    heavy: { windowMs: 10 * 60 * 1000, max: 20, keyMode: 'user_or_ip' },
    global: { windowMs: 60 * 1000, max: 300, keyMode: 'user_or_ip' }
  }
});

const logCooldown = new Map();
const specificLimiterCache = new Map();

function toPositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizePath(req) {
  const raw = String(req.path || req.originalUrl || '/');
  return raw.split('?')[0].toLowerCase();
}

function isAjaxOrApiRequest(req) {
  const accepts = String(req.headers.accept || '').toLowerCase();
  return Boolean(req.xhr || req.headers['x-ajax-request']) || accepts.includes('application/json') || normalizePath(req).startsWith('/api/');
}

function getConfig(req) {
  const websitePolicyConfig = (req.websitePolicy && req.websitePolicy.requestControl) || {};
  const rawOrgPolicyConfig = (req.user && req.user.activeOrgPolicy && req.user.activeOrgPolicy.requestControl) || {};
  const orgRequestControlApplies = blockTargetsUser(rawOrgPolicyConfig, req?.user?.id || '');
  const orgPolicyConfig = orgRequestControlApplies ? rawOrgPolicyConfig : {};
  const orgCustomRoutes = Array.isArray(orgPolicyConfig.customRoutes)
    ? orgPolicyConfig.customRoutes
    : (Array.isArray(orgPolicyConfig.routeOverrides) ? orgPolicyConfig.routeOverrides : []);

  const policyConfig = { ...(websitePolicyConfig || {}) };
  const effectiveCatalog = buildEffectiveRouteCatalog(policyConfig).filter((r) => r && r.enabled);
  const websiteOverrides = normalizeRouteOverrideList(policyConfig.routeOverrides || []);
  const websiteRules = [
    ...effectiveCatalog.map((r) => ({
      method: String(r.method || '*').toUpperCase(),
      matchType: String(r.matchType || 'prefix').toLowerCase(),
      path: normalizeOverridePath(r.path || '')
    })),
    ...websiteOverrides.map((r) => ({
      method: String(r.method || '*').toUpperCase(),
      matchType: String(r.matchType || 'prefix').toLowerCase(),
      path: normalizeOverridePath(r.path || '')
    }))
  ].filter((r) => !!r.path);

  const normalizedOrgCustomRoutes = normalizeRouteOverrideList(orgCustomRoutes).filter((r) => !hasWebsiteRuleConflict(r, websiteRules));
  policyConfig.routeOverrides = [...websiteOverrides, ...normalizedOrgCustomRoutes];
  const hasActiveOrgCustomRoutes = normalizedOrgCustomRoutes.some((r) => r.enabled === true);
  const websitePhase3Enabled = (policyConfig.phase3 && typeof policyConfig.phase3.enabled !== 'undefined')
    ? Boolean(policyConfig.phase3.enabled)
    : DEFAULT_CONFIG.phase3.enabled;

  const policyGroups = policyConfig.groups || {};

  return {
    ...DEFAULT_CONFIG,
    ...policyConfig,
    phase2: {
      enabled: Boolean(policyConfig.phase2 && policyConfig.phase2.enabled),
      enforceGroups: Array.isArray(policyConfig.phase2?.enforceGroups) && policyConfig.phase2.enforceGroups.length > 0
        ? policyConfig.phase2.enforceGroups.map((g) => String(g || '').trim().toLowerCase()).filter(Boolean)
        : [...DEFAULT_CONFIG.phase2.enforceGroups]
    },
    phase3: {
      // Organization custom routes must stay effective even when website phase3 toggle is off.
      enabled: websitePhase3Enabled || hasActiveOrgCustomRoutes
    },
    routeCatalog: {
      ...DEFAULT_CONFIG.routeCatalog,
      ...(policyConfig.routeCatalog || {})
    },
    routeOverrides: Array.isArray(policyConfig.routeOverrides) ? policyConfig.routeOverrides : [...DEFAULT_CONFIG.routeOverrides],
    groups: {
      ...DEFAULT_CONFIG.groups,
      ...policyGroups,
      auth: { ...DEFAULT_CONFIG.groups.auth, ...(policyGroups.auth || {}) },
      picker: { ...DEFAULT_CONFIG.groups.picker, ...(policyGroups.picker || {}) },
      write: { ...DEFAULT_CONFIG.groups.write, ...(policyGroups.write || {}) },
      heavy: { ...DEFAULT_CONFIG.groups.heavy, ...(policyGroups.heavy || {}) },
      global: { ...DEFAULT_CONFIG.groups.global, ...(policyGroups.global || {}) }
    },
    policyScope: normalizedOrgCustomRoutes.length > 0 ? 'website+org_custom_routes' : 'website'
  };
}

function normalizeRulePath(path) {
  const p = normalizeOverridePath(path || '');
  if (!p) return '';
  return p.endsWith('/') && p.length > 1 ? p.slice(0, -1) : p;
}

function methodsOverlap(aMethod, bMethod) {
  const a = String(aMethod || '*').toUpperCase();
  const b = String(bMethod || '*').toUpperCase();
  return a === '*' || b === '*' || a === b;
}

function pathsOverlap(aPath, bPath) {
  const a = normalizeRulePath(aPath);
  const b = normalizeRulePath(bPath);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function hasWebsiteRuleConflict(orgRule, websiteRules) {
  return websiteRules.some((siteRule) => methodsOverlap(orgRule.method, siteRule.method) && pathsOverlap(orgRule.path, siteRule.path));
}

function isExcluded(req, config) {
  if (req.method === 'OPTIONS') return true;
  const path = normalizePath(req);
  const excludes = Array.isArray(config.excludePaths) ? config.excludePaths : [];
  return excludes.some((entry) => {
    const p = String(entry || '').trim().toLowerCase();
    if (!p) return false;
    return path === p || path.startsWith(`${p}/`);
  });
}

function isAuthRequest(req) {
  const path = normalizePath(req);
  return path === '/login' ||
    path === '/force-login' ||
    path === '/captcha' ||
    path.startsWith('/login/') ||
    path.startsWith('/force-login/') ||
    path.startsWith('/captcha/') ||
    path === '/auth/microsoft' ||
    path.startsWith('/auth/microsoft/');
}

function isHeavyRequest(req) {
  const path = normalizePath(req);
  return /(\/export\b|\/import\b|\/generate\b|\/download\b|\/sample-data\b)/i.test(path);
}

function isWriteRequest(req) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase());
}

function isPickerRequest(req) {
  if (String(req.method || '').toUpperCase() !== 'GET') return false;
  const path = normalizePath(req);
  const hasQ = req.query && Object.prototype.hasOwnProperty.call(req.query, 'q');
  if (!hasQ) return false;

  if (/\/(picker|eligible-|available-|search)\b/i.test(path)) return true;
  return isAjaxOrApiRequest(req);
}

function classifyRequest(req, config) {
  if (isExcluded(req, config)) return 'excluded';
  if (isAuthRequest(req)) return 'auth';
  if (isHeavyRequest(req)) return 'heavy';
  if (isWriteRequest(req)) return 'write';
  if (isPickerRequest(req)) return 'picker';
  return 'global';
}

function normalizeOverrideMatchType(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'exact' || v === 'prefix' || v === 'contains') return v;
  return 'prefix';
}

function normalizeOverrideMode(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'monitor' || v === 'enforce' || v === 'inherit') return v;
  return 'inherit';
}

function normalizeOverrideMethod(value) {
  const v = String(value || '').trim().toUpperCase();
  if (v === '*' || v === 'GET' || v === 'POST' || v === 'PUT' || v === 'PATCH' || v === 'DELETE') return v;
  return '*';
}

function normalizeOverrideKeyMode(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'ip' || v === 'user_or_ip' || v === 'username_ip') return v;
  return '';
}

function normalizeOverrideGroup(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'auth' || v === 'picker' || v === 'write' || v === 'heavy' || v === 'global') return v;
  return '';
}

function normalizeOverridePath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.startsWith('/') ? raw.toLowerCase() : `/${raw.toLowerCase()}`;
}

function parseDateMs(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function normalizeRouteOverride(raw, index) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = String(source.id || `override_${index + 1}`).trim();
  const label = String(source.label || source.path || id).trim();
  const method = normalizeOverrideMethod(source.method);
  const matchType = normalizeOverrideMatchType(source.matchType);
  const path = normalizeOverridePath(source.path);
  const enabled = source.enabled === true || String(source.enabled || '').toLowerCase() === 'true';
  const startAtMs = parseDateMs(source.startAt);
  const endAtMs = parseDateMs(source.endAt);
  const windowMs = toPositiveInt(source.windowMs, null);
  const max = toPositiveInt(source.max, null);
  const keyMode = normalizeOverrideKeyMode(source.keyMode);
  const mode = normalizeOverrideMode(source.mode);
  const group = normalizeOverrideGroup(source.group);
  const priorityRaw = Number.parseInt(source.priority, 10);
  const priority = Number.isFinite(priorityRaw) ? priorityRaw : 0;

  if (!path) return null;

  return {
    id,
    label,
    enabled,
    method,
    matchType,
    path,
    startAtMs,
    endAtMs,
    windowMs,
    max,
    keyMode,
    mode,
    group,
    priority
  };
}

function normalizeRouteOverrideList(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  const normalized = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = normalizeRouteOverride(list[i], i);
    if (item) normalized.push(item);
  }
  return normalized;
}

function isOverrideActive(ov, nowMs) {
  if (!ov.enabled) return false;
  if (ov.startAtMs && nowMs < ov.startAtMs) return false;
  if (ov.endAtMs && nowMs > ov.endAtMs) return false;
  if (ov.startAtMs && ov.endAtMs && ov.startAtMs > ov.endAtMs) return false;
  return true;
}

function matchOverridePath(ov, path) {
  const p = String(ov.path || '').toLowerCase();
  if (!p) return false;
  if (ov.matchType === 'exact') return path === p;
  if (ov.matchType === 'contains') return path.includes(p);
  return path === p || path.startsWith(`${p}/`);
}

function matchOverrideMethod(ov, method) {
  if (ov.method === '*') return true;
  return ov.method === method;
}

function overrideTypeScore(matchType) {
  if (matchType === 'exact') return 3000;
  if (matchType === 'prefix') return 2000;
  if (matchType === 'contains') return 1000;
  return 0;
}

function findActiveRouteOverride(req, cfg) {
  const nowMs = Date.now();
  const method = String(req.method || 'GET').toUpperCase();
  const path = normalizePath(req);
  const overrides = normalizeRouteOverrideList(cfg.routeOverrides);

  const candidates = overrides.filter((ov) => isOverrideActive(ov, nowMs) && matchOverrideMethod(ov, method) && matchOverridePath(ov, path));
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    const ta = overrideTypeScore(a.matchType);
    const tb = overrideTypeScore(b.matchType);
    if (ta !== tb) return tb - ta;
    return String(b.path || '').length - String(a.path || '').length;
  });

  return candidates[0];
}

function resolveRequestRateContext(req, cfg) {
  if (req._requestRateContext) return req._requestRateContext;

  if (isExcluded(req, cfg)) {
    req._requestRateContext = { group: 'excluded', matchedRoute: null, matchedOverride: null };
    return req._requestRateContext;
  }

  const phase3Enabled = Boolean(cfg.phase3 && cfg.phase3.enabled);
  if (!phase3Enabled) {
    req._requestRateContext = { group: classifyRequest(req, cfg), matchedRoute: null, matchedOverride: null };
    return req._requestRateContext;
  }

  const effectiveCatalog = buildEffectiveRouteCatalog(cfg);
  const matchedRoute = findRouteGroupMatch(req, effectiveCatalog);
  const matchedOverride = findActiveRouteOverride(req, cfg);
  const fallbackGroup = matchedRoute && matchedRoute.group ? String(matchedRoute.group).toLowerCase() : classifyRequest(req, cfg);
  const group = matchedOverride && matchedOverride.group ? matchedOverride.group : fallbackGroup;

  req._requestRateContext = { group, matchedRoute: matchedRoute || null, matchedOverride: matchedOverride || null };
  return req._requestRateContext;
}

function buildClientKey(req, keyMode) {
  const ipKey = ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown');
  const userId = req.user && req.user.id ? String(req.user.id) : '';

  if (keyMode === 'ip') {
    return `ip:${ipKey}`;
  }

  if (keyMode === 'username_ip') {
    const rawUsername = req.body?.username || req.query?.username || req.user?.username || 'anon';
    const username = String(rawUsername).trim().toLowerCase() || 'anon';
    return `u:${username}|ip:${ipKey}`;
  }

  if (userId) {
    return `uid:${userId}`;
  }
  return `ip:${ipKey}`;
}

function shouldLog(cooldownKey, cooldownMs) {
  const now = Date.now();
  const last = logCooldown.get(cooldownKey) || 0;
  if ((now - last) < cooldownMs) return false;
  logCooldown.set(cooldownKey, now);

  if (logCooldown.size > 6000) {
    const threshold = now - (cooldownMs * 3);
    for (const [key, ts] of logCooldown.entries()) {
      if (ts < threshold) logCooldown.delete(key);
    }
  }
  return true;
}

function shouldEnforceForGroup(cfg, groupName) {
  const mode = String(cfg.mode || 'monitor').toLowerCase();
  if (mode === 'enforce') return true;
  const phase2Enabled = Boolean(cfg.phase2 && cfg.phase2.enabled);
  const phase2Groups = Array.isArray(cfg.phase2?.enforceGroups) ? cfg.phase2.enforceGroups : [];
  return phase2Enabled && phase2Groups.includes(String(groupName || '').toLowerCase());
}

function shouldEnforceForRoute(cfg, groupName, routeSetting) {
  const specificMode = String(routeSetting?.mode || 'inherit').toLowerCase();
  if (specificMode === 'enforce') return true;
  if (specificMode === 'monitor') return false;
  return shouldEnforceForGroup(cfg, groupName);
}

function getEffectiveRouteSpecificConfig(cfg, context) {
  const groupName = String(context?.group || 'global').toLowerCase();
  const groupDefaults = cfg.groups[groupName] || cfg.groups.global || DEFAULT_CONFIG.groups.global;
  const matchedOverride = context?.matchedOverride || null;

  if (matchedOverride) {
    const windowMs = toPositiveInt(matchedOverride.windowMs, toPositiveInt(groupDefaults.windowMs, 60 * 1000));
    const max = toPositiveInt(matchedOverride.max, toPositiveInt(groupDefaults.max, 60));
    const keyMode = String(matchedOverride.keyMode || groupDefaults.keyMode || 'user_or_ip');
    const mode = String(matchedOverride.mode || 'inherit').toLowerCase();
    const enforce = shouldEnforceForRoute(cfg, groupName, { mode });
    return {
      source: 'override',
      routeId: matchedOverride.id,
      routeLabel: matchedOverride.label,
      groupName,
      windowMs,
      max,
      keyMode,
      enforce,
      mode,
      overridePath: matchedOverride.path,
      overrideMethod: matchedOverride.method
    };
  }

  const matchedRoute = context?.matchedRoute || null;
  if (!matchedRoute) return null;
  const setting = matchedRoute.routeSetting || {};
  if (!setting.enabled) return null;

  const windowMs = toPositiveInt(setting.windowMs, toPositiveInt(groupDefaults.windowMs, 60 * 1000));
  const max = toPositiveInt(setting.max, toPositiveInt(groupDefaults.max, 60));
  const keyMode = String(setting.keyMode || groupDefaults.keyMode || 'user_or_ip');
  const enforce = shouldEnforceForRoute(cfg, groupName, setting);
  const mode = String(setting.mode || 'inherit').toLowerCase();

  return {
    source: 'catalog',
    routeId: matchedRoute.id,
    routeLabel: matchedRoute.label || matchedRoute.id,
    groupName,
    windowMs,
    max,
    keyMode,
    enforce,
    mode
  };
}

function createSpecificLimiter(spec) {
  return rateLimit({
    windowMs: spec.windowMs,
    limit: spec.max,
    keyGenerator: (req) => buildClientKey(req, spec.keyMode),
    legacyHeaders: false,
    standardHeaders: false,
    handler: (req, res, next) => {
      const cfg = getConfig(req);
      const enforce = Boolean(req._requestRateSpecificConfig?.enforce);
      const monitorOnly = !enforce;
      const cooldownMs = toPositiveInt(cfg.logCooldownMs, DEFAULT_CONFIG.logCooldownMs);
      const key = req.rateLimit?.key || buildClientKey(req, spec.keyMode);
      const cooldownKey = `route:${spec.routeId}|${key}`;

      if (shouldLog(cooldownKey, cooldownMs) && typeof logger._push === 'function') {
        logger._push(
          LOG_SECTION_ID,
          LOG_OPERATION_ID,
          req.user || null,
          'DENIED',
          {
            monitorOnly,
            routeSpecific: true,
            routeSpecificSource: spec.source,
            routeId: spec.routeId,
            routeLabel: spec.routeLabel,
            specificMode: spec.mode,
            policyScope: cfg.policyScope || 'website',
            rateLimitGroup: spec.groupName,
            requestId: req.requestId || req.headers['x-request-id'] || '',
            overridePath: spec.overridePath || '',
            overrideMethod: spec.overrideMethod || '',
            ip: req.ip,
            method: req.method,
            path: normalizePath(req),
            key,
            limit: req.rateLimit?.limit ?? spec.max,
            used: req.rateLimit?.used ?? null,
            remaining: req.rateLimit?.remaining ?? null,
            resetTime: req.rateLimit?.resetTime instanceof Date ? req.rateLimit.resetTime.toISOString() : null
          }
        );
      }

      if (monitorOnly) return next();

      const retryAfterSeconds = req.rateLimit?.resetTime instanceof Date
        ? Math.max(1, Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000))
        : null;
      if (retryAfterSeconds && !res.headersSent) {
        res.setHeader('Retry-After', String(retryAfterSeconds));
      }

      if (isAjaxOrApiRequest(req)) {
        return res.status(429).json({
          status: 'error',
          message: 'Too many requests. Please try again later.',
          group: spec.groupName,
          routeId: spec.routeId
        });
      }

      return res.status(429).render('error', {
        title: 'Too Many Requests',
        message: 'Too many requests. Please wait and retry.',
        statusCode: 429,
        user: req.user || null
      });
    }
  });
}

function getSpecificLimiter(spec) {
  const key = `${spec.source || 'catalog'}|${spec.routeId}|${spec.windowMs}|${spec.max}|${spec.keyMode}|${spec.mode}|${spec.enforce ? '1' : '0'}`;
  if (!specificLimiterCache.has(key)) {
    specificLimiterCache.set(key, createSpecificLimiter(spec));
    if (specificLimiterCache.size > 500) {
      const first = specificLimiterCache.keys().next().value;
      if (first) specificLimiterCache.delete(first);
    }
  }
  return specificLimiterCache.get(key);
}

function routeSpecificLimiter(req, res, next) {
  const cfg = getConfig(req);
  if (!cfg.enabled) return next();
  if (!Boolean(cfg.phase3 && cfg.phase3.enabled)) return next();

  const context = resolveRequestRateContext(req, cfg);
  if (!context || context.group === 'excluded') return next();

  const specific = getEffectiveRouteSpecificConfig(cfg, context);
  if (!specific) return next();

  req._requestRateSpecificConfig = specific;
  req._requestRateHandledBySpecific = true;
  const limiter = getSpecificLimiter(specific);
  return limiter(req, res, next);
}

function createGroupLimiter(groupName) {
  const defaults = DEFAULT_CONFIG.groups[groupName];

  return rateLimit({
    windowMs: defaults.windowMs,
    limit: (req) => {
      const cfg = getConfig(req);
      return toPositiveInt(cfg.groups[groupName]?.max, defaults.max);
    },
    keyGenerator: (req) => {
      const cfg = getConfig(req);
      const keyMode = String(cfg.groups[groupName]?.keyMode || defaults.keyMode);
      return buildClientKey(req, keyMode);
    },
    legacyHeaders: false,
    standardHeaders: false,
    skip: (req) => {
      const cfg = getConfig(req);
      if (!cfg.enabled) return true;
      if (req._requestRateHandledBySpecific) return true;
      const context = resolveRequestRateContext(req, cfg);
      if (context.group !== groupName) return true;
      return false;
    },
    handler: (req, res, next) => {
      const cfg = getConfig(req);
      const enforceByGroup = shouldEnforceForGroup(cfg, groupName);
      const monitorOnly = !enforceByGroup;

      const cooldownMs = toPositiveInt(cfg.logCooldownMs, DEFAULT_CONFIG.logCooldownMs);
      const key = req.rateLimit?.key || buildClientKey(req, defaults.keyMode);
      const cooldownKey = `${groupName}|${key}`;

      if (shouldLog(cooldownKey, cooldownMs) && typeof logger._push === 'function') {
        logger._push(
          LOG_SECTION_ID,
          LOG_OPERATION_ID,
          req.user || null,
          'DENIED',
          {
            monitorOnly,
            enforceByGroup,
            policyScope: cfg.policyScope || 'website',
            rateLimitGroup: groupName,
            requestId: req.requestId || req.headers['x-request-id'] || '',
            ip: req.ip,
            method: req.method,
            path: normalizePath(req),
            key,
            limit: req.rateLimit?.limit ?? defaults.max,
            used: req.rateLimit?.used ?? null,
            remaining: req.rateLimit?.remaining ?? null,
            resetTime: req.rateLimit?.resetTime instanceof Date ? req.rateLimit.resetTime.toISOString() : null
          }
        );
      }

      if (monitorOnly) return next();

      const retryAfterSeconds = req.rateLimit?.resetTime instanceof Date
        ? Math.max(1, Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000))
        : null;
      if (retryAfterSeconds && !res.headersSent) {
        res.setHeader('Retry-After', String(retryAfterSeconds));
      }

      if (isAjaxOrApiRequest(req)) {
        return res.status(429).json({
          status: 'error',
          message: 'Too many requests. Please try again later.',
          group: groupName
        });
      }

      return res.status(429).render('error', {
        title: 'Too Many Requests',
        message: 'Too many requests. Please wait and retry.',
        statusCode: 429,
        user: req.user || null
      });
    }
  });
}

const phaseOneMonitor = [
  routeSpecificLimiter,
  createGroupLimiter('auth'),
  createGroupLimiter('heavy'),
  createGroupLimiter('write'),
  createGroupLimiter('picker'),
  createGroupLimiter('global')
];

function requestRatePhaseOne(req, res, next) {
  let i = 0;
  const run = (err) => {
    if (err) return next(err);
    const mw = phaseOneMonitor[i++];
    if (!mw) return next();
    return mw(req, res, run);
  };
  return run();
}

module.exports = requestRatePhaseOne;
