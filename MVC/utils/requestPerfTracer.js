const { getRequestContext, mergeRequestContext } = require('./requestContextStore');

function isEnabledFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isProductionEnv() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function isEnabled() {
  if (isProductionEnv()) return false;
  return isEnabledFlag(process.env.REQUEST_PERF_DEBUG) || isEnabledFlag(process.env.REQUEST_PATH_TIMING);
}

function isPerfSubFeatureEnabled(envKey) {
  if (!isEnabled()) return false;
  const token = String(process.env[envKey] || '').trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(token)) return false;
  if (isEnabledFlag(token)) return true;
  return !token;
}

function shouldProfileRequest(req) {
  if (!req || !req.url) return false;
  const ext = String(req.url).split('.').pop().toLowerCase();
  if (['css', 'js', 'jpg', 'jpeg', 'png', 'gif', 'ico', 'woff2', 'map', 'webp', 'svg'].includes(ext)) {
    return false;
  }
  return true;
}

function nowNs() {
  return process.hrtime.bigint();
}

function nsToMs(value) {
  return Number(value) / 1000000;
}

function createPerfState() {
  return {
    startedAt: nowNs(),
    phases: {},
    marks: [],
    dataOps: [],
    dataOpsTotalMs: 0,
    handlerStartedAt: null,
    preRenderAt: null,
    postRenderAt: null,
    viewRenderMs: 0
  };
}

function linkPerfState(req, state) {
  if (!req || !state) return;
  req._requestPerf = state;
  mergeRequestContext({ _requestPerf: state, _request: req });
}

function getPerfState(req = null) {
  if (req && req._requestPerf) return req._requestPerf;
  const ctx = getRequestContext();
  if (ctx?._requestPerf) return ctx._requestPerf;
  if (ctx?._request?._requestPerf) return ctx._request._requestPerf;
  return null;
}

function ensurePerfState(req = null) {
  const existing = getPerfState(req);
  if (existing) return existing;
  const state = createPerfState();
  if (req) linkPerfState(req, state);
  else mergeRequestContext({ _requestPerf: state });
  return state;
}

function recordPhase(phase, durationMs, req = null) {
  const state = ensurePerfState(req);
  if (!state) return;
  const key = String(phase || '').trim();
  if (!key) return;
  const safeMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (!state.phases[key]) state.phases[key] = 0;
  state.phases[key] += safeMs;
}

function mark(phase, req = null) {
  const state = ensurePerfState(req);
  if (!state) return;
  const key = String(phase || '').trim();
  if (!key) return;
  state.marks.push({ phase: key, at: nowNs() });
}

function recordDataOp(operation, entityType, durationMs) {
  const state = getPerfState() || getPerfState(getRequestContext()?._request);
  if (!state) return;
  const op = String(operation || '').trim() || 'unknown';
  const entity = String(entityType || '').trim() || 'unknown';
  const safeMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  state.dataOps.push({ op, entity, ms: safeMs });
  state.dataOpsTotalMs += safeMs;
}

function initRequest(req) {
  if (!isEnabled() || !shouldProfileRequest(req)) return;
  const state = ensurePerfState(req);
  linkPerfState(req, state);
  mark('request-start', req);
}

function installRenderTiming(req, res) {
  // Disabled by default: hooking res.render can interfere with express-ejs-layouts.
  if (!isEnabled() || process.env.REQUEST_PERF_RENDER_HOOK !== '1') {
    return;
  }
  const state = ensurePerfState(req);
  if (!state || res._requestPerfRenderHooked) return;
  res._requestPerfRenderHooked = true;

  const originalRender = res.render.bind(res);
  res.render = function renderWithPerf(view, options, callback) {
    const perf = getPerfState(req);
    if (perf) perf.preRenderAt = nowNs();

    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    const wrappedCallback = (err, html) => {
      const current = getPerfState(req);
      if (current && current.preRenderAt) {
        current.viewRenderMs += nsToMs(nowNs() - current.preRenderAt);
        current.postRenderAt = nowNs();
        current.preRenderAt = null;
      }
      if (typeof callback === 'function') {
        return callback(err, html);
      }
    };

    if (typeof callback === 'function') {
      return originalRender(view, options, wrappedCallback);
    }
    return originalRender(view, options, wrappedCallback);
  };
}

function markHandlerPhase(req = null) {
  const state = ensurePerfState(req);
  if (!state) return;
  state.handlerStartedAt = nowNs();
  mark('handler-start', req);
}

function summarizeDataOps(state) {
  const aggregate = new Map();
  for (const row of state.dataOps) {
    const key = `${row.op}:${row.entity}`;
    const current = aggregate.get(key) || { op: row.op, entity: row.entity, count: 0, totalMs: 0, maxMs: 0 };
    current.count += 1;
    current.totalMs += row.ms;
    current.maxMs = Math.max(current.maxMs, row.ms);
    aggregate.set(key, current);
  }
  const rows = Array.from(aggregate.values())
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 12);
  return {
    totalMs: roundMs(state.dataOpsTotalMs),
    callCount: state.dataOps.length,
    top: rows
  };
}

function buildSummary(req, res) {
  const state = getPerfState(req);
  if (!state) return null;

  const finishedAt = nowNs();
  const totalMs = nsToMs(finishedAt - state.startedAt);
  const viewRenderMs = state.viewRenderMs;
  const handlerMs = state.handlerStartedAt
    ? nsToMs((state.preRenderAt || state.postRenderAt || finishedAt) - state.handlerStartedAt)
    : 0;
  const preViewMs = Math.max(0, totalMs - viewRenderMs);

  const phases = { ...state.phases };
  if (handlerMs > 0) phases['route-handler'] = handlerMs;
  if (viewRenderMs > 0) phases['view-render'] = viewRenderMs;

  const middlewareMs = Object.entries(phases)
    .filter(([key]) => key !== 'route-handler' && key !== 'view-render')
    .reduce((sum, [, value]) => sum + value, 0);

  const accountedMs = roundMs(middlewareMs + handlerMs + viewRenderMs);

  return {
    method: String(req.method || '').trim(),
    path: String(req.originalUrl || req.url || '').slice(0, 300),
    statusCode: Number(res.statusCode || 0),
    requestId: String(req.requestId || '').trim(),
    totalMs: roundMs(totalMs),
    preViewMs: roundMs(preViewMs),
    middlewareMs: roundMs(middlewareMs),
    handlerMs: roundMs(handlerMs),
    viewRenderMs: roundMs(viewRenderMs),
    accountedMs,
    unaccountedMs: roundMs(Math.max(0, totalMs - accountedMs)),
    phases: Object.fromEntries(
      Object.entries(phases).map(([key, value]) => [key, roundMs(value)])
    ),
    dataOps: summarizeDataOps(state)
  };
}

function roundMs(value) {
  return Math.round(Number(value) * 10) / 10;
}

function finalize(req, res) {
  const summary = buildSummary(req, res);
  if (!summary) return;

  console.info(
    `[request-perf] ${summary.method} ${summary.path} ${summary.statusCode} total=${summary.totalMs}ms preView=${summary.preViewMs}ms handler=${summary.handlerMs}ms view=${summary.viewRenderMs}ms data=${summary.dataOps.totalMs}ms`
  );
}

function wrapMiddleware(phase, middleware) {
  const phaseName = String(phase || '').trim();
  if (!isPerfSubFeatureEnabled('REQUEST_PERF_MIDDLEWARE')) {
    return middleware;
  }
  return function timedMiddleware(req, res, next) {
    if (!isEnabled() || !shouldProfileRequest(req)) {
      return middleware(req, res, next);
    }

    initRequest(req);
    installRenderTiming(req, res);
    if (!res._requestPerfFinalizeHooked) {
      res._requestPerfFinalizeHooked = true;
      res.on('finish', () => finalize(req, res));
    }

    const startedAt = nowNs();
    let phaseRecorded = false;
    const recordSelfPhase = () => {
      if (phaseRecorded) return;
      phaseRecorded = true;
      recordPhase(phaseName, nsToMs(nowNs() - startedAt), req);
    };

    const wrappedNext = (err) => {
      recordSelfPhase();
      return next(err);
    };

    try {
      const result = middleware(req, res, wrappedNext);
      if (result && typeof result.then === 'function') {
        result.catch((error) => {
          if (!res.headersSent) return next(error);
          throw error;
        });
      }
    } catch (error) {
      recordSelfPhase();
      throw error;
    }
  };
}

function wrapDataMethod(target, methodName) {
  const original = target[methodName];
  if (typeof original !== 'function' || original.__requestPerfWrapped) return;

  async function wrappedDataMethod(...args) {
    if (!isEnabled()) {
      return original.apply(this, args);
    }
    const startedAt = nowNs();
    try {
      return await original.apply(this, args);
    } finally {
      const entityType = args[0];
      recordDataOp(methodName, entityType, nsToMs(nowNs() - startedAt));
    }
  }
  wrappedDataMethod.__requestPerfWrapped = true;
  target[methodName] = wrappedDataMethod;
}

let dataHooksInstalled = false;

function installDataHooks() {
  if (!isEnabled() || dataHooksInstalled || !isPerfSubFeatureEnabled('REQUEST_PERF_DATA')) return;
  dataHooksInstalled = true;

  const dataService = require('../services/dataService');
  const methods = [
    'fetchData',
    'fetchDataPaged',
    'getDataById',
    'addData',
    'updateData',
    'deleteData',
    'countData'
  ];

  for (const methodName of methods) {
    wrapDataMethod(dataService, methodName);
  }

  if (typeof dataService.getWebsitePolicy === 'function' && !dataService.getWebsitePolicy.__requestPerfWrapped) {
    const original = dataService.getWebsitePolicy;
    dataService.getWebsitePolicy = async function wrappedWebsitePolicy(...args) {
      if (!isEnabled()) return original.apply(this, args);
      const startedAt = nowNs();
      try {
        return await original.apply(this, args);
      } finally {
        recordDataOp('getWebsitePolicy', 'websitePolicy', nsToMs(nowNs() - startedAt));
      }
    };
    dataService.getWebsitePolicy.__requestPerfWrapped = true;
  }

  try {
    const schoolDataService = require('../../packages/school/MVC/services/school/schoolDataService');
    const schoolMethods = [
      'fetchData',
      'fetchDataPaged',
      'fetchAllData',
      'getDataById',
      'addData',
      'updateData',
      'deleteData',
      'countData'
    ];
    for (const methodName of schoolMethods) {
      if (typeof schoolDataService[methodName] === 'function') {
        const original = schoolDataService[methodName];
        if (original.__requestPerfWrapped) continue;
        schoolDataService[methodName] = async function wrappedSchoolDataMethod(...args) {
          if (!isEnabled()) return original.apply(this, args);
          const startedAt = nowNs();
          try {
            return await original.apply(this, args);
          } finally {
            const entityType = args[0];
            recordDataOp(methodName, `school:${entityType}`, nsToMs(nowNs() - startedAt));
          }
        };
        schoolDataService[methodName].__requestPerfWrapped = true;
      }
    }
  } catch (_) {
    // School package may be unavailable in some deployments.
  }
}

function initMiddleware(req, res, next) {
  if (!isEnabled() || !shouldProfileRequest(req)) return next();
  initRequest(req);
  linkPerfState(req, ensurePerfState(req));
  installRenderTiming(req, res);
  if (!res._requestPerfFinalizeHooked) {
    res._requestPerfFinalizeHooked = true;
    res.on('finish', () => finalize(req, res));
  }
  return next();
}

function markHandlerMiddleware(req, res, next) {
  if (isEnabled() && shouldProfileRequest(req)) {
    markHandlerPhase(req);
  }
  return next();
}

module.exports = {
  isEnabled,
  initRequest,
  installRenderTiming,
  installDataHooks,
  wrapMiddleware,
  initMiddleware,
  markHandlerMiddleware,
  finalize,
  recordPhase,
  mark,
  recordDataOp
};
