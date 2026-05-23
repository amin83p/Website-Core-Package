const path = require('path');

const startupLogger = require('../utils/startupLogger');
const packageModuleResolverService = require('./packageModuleResolverService');

const ROUTE_METHODS = Object.freeze(['USE', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const ROUTE_METHOD_SET = new Set(ROUTE_METHODS);

let mountedRouteKeys = new Set();

function cleanText(value, max = 2000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizePackageId(value = '') {
  return cleanText(value, 80).toLowerCase();
}

function resolveProjectRoot() {
  return path.resolve(__dirname, '../../');
}

function normalizeMethod(value = 'USE') {
  const token = cleanText(value, 20).toUpperCase() || 'USE';
  if (!ROUTE_METHOD_SET.has(token)) {
    throw new Error(`Unsupported route method "${token}".`);
  }
  return token;
}

function normalizeRoutePath(value = '', label = 'path') {
  const raw = cleanText(value, 1200).replace(/\\/g, '/');
  if (!raw) throw new Error(`routes declaration requires ${label}.`);
  if (!raw.startsWith('/')) throw new Error(`${label} must start with "/".`);
  if (/\s/.test(raw)) throw new Error(`${label} must not include whitespace.`);
  if (raw.includes('//')) throw new Error(`${label} must not include empty segments.`);
  const normalized = raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
  if (!normalized) throw new Error(`${label} is invalid.`);
  return normalized;
}

function normalizeRouteDeclaration(declaration = {}, index = 0) {
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
    throw new Error(`routes[${index}] must be an object.`);
  }

  const method = normalizeMethod(declaration.method || 'USE');
  const routePath = normalizeRoutePath(declaration.path || declaration.mountPath || '', 'path');
  const router = cleanText(
    declaration.router
    || declaration.routerModule
    || declaration.routerPath
    || '',
    1600
  );
  const controller = cleanText(declaration.controller || '', 1600);
  const metadataOnly = declaration.metadataOnly === true;
  const active = declaration.active !== false;

  return {
    id: cleanText(declaration.id || declaration.name || '', 180) || `route-${index + 1}`,
    method,
    path: routePath,
    router,
    controller,
    metadataOnly,
    active
  };
}

function isRouterCandidate(value) {
  if (typeof value === 'function') return true;
  return Boolean(value && typeof value === 'object' && typeof value.handle === 'function');
}

function pickRouterExport(moduleValue) {
  if (isRouterCandidate(moduleValue)) return moduleValue;
  if (isRouterCandidate(moduleValue?.default)) return moduleValue.default;
  if (isRouterCandidate(moduleValue?.router)) return moduleValue.router;
  return null;
}

function resolveRouterModulePath(routerPath = '', context = {}, options = {}) {
  return packageModuleResolverService.resolvePackageModulePath(routerPath, context, options);
}

function createSummary(packageId = '') {
  return {
    packageId: normalizePackageId(packageId),
    requested: 0,
    prepared: 0,
    mounted: 0,
    skipped: 0,
    failed: 0,
    results: []
  };
}

function createResultRow(input = {}) {
  return {
    id: cleanText(input.id, 180),
    method: cleanText(input.method, 20).toUpperCase(),
    path: cleanText(input.path, 1200),
    router: cleanText(input.router, 1600),
    controller: cleanText(input.controller, 1600),
    metadataOnly: input.metadataOnly === true,
    status: cleanText(input.status, 60).toLowerCase(),
    message: cleanText(input.message, 2000)
  };
}

function addResult(summary = {}, row = {}) {
  summary.results.push(createResultRow(row));
}

async function registerManifestRoutes(context = {}, options = {}) {
  const packageId = normalizePackageId(context?.packageId || context?.manifest?.id || '');
  const summary = createSummary(packageId);
  const logger = options?.logger || startupLogger;
  const app = context?.app || options?.app || null;
  const declarations = Array.isArray(context?.manifest?.routes) ? context.manifest.routes : [];

  if (!packageId || !declarations.length) {
    return summary;
  }

  for (let index = 0; index < declarations.length; index += 1) {
    const declaration = declarations[index];
    summary.requested += 1;
    let normalized;
    try {
      normalized = normalizeRouteDeclaration(declaration, index);
    } catch (error) {
      summary.failed += 1;
      addResult(summary, {
        status: 'failed',
        message: error?.message || String(error)
      });
      continue;
    }

    if (!normalized.active) {
      summary.skipped += 1;
      addResult(summary, {
        ...normalized,
        status: 'skipped',
        message: 'Route declaration is inactive.'
      });
      continue;
    }

    summary.prepared += 1;

    if (normalized.metadataOnly) {
      addResult(summary, {
        ...normalized,
        status: 'prepared',
        message: 'Route metadata prepared (metadataOnly=true).'
      });
      continue;
    }

    if (normalized.method !== 'USE') {
      addResult(summary, {
        ...normalized,
        status: 'prepared',
        message: `Route metadata prepared. Runtime mount for method "${normalized.method}" is deferred.`
      });
      continue;
    }

    if (!normalized.router) {
      summary.failed += 1;
      addResult(summary, {
        ...normalized,
        status: 'failed',
        message: 'Route mount requires router module path.'
      });
      continue;
    }

    if (!app || typeof app.use !== 'function') {
      addResult(summary, {
        ...normalized,
        status: 'prepared',
        message: 'No express app context; route is prepared but not mounted.'
      });
      continue;
    }

    const routeKey = `${packageId}|${normalized.method}|${normalized.path}|${normalized.router}`.toLowerCase();
    if (mountedRouteKeys.has(routeKey)) {
      summary.skipped += 1;
      addResult(summary, {
        ...normalized,
        status: 'skipped',
        message: 'Route already mounted in this process.'
      });
      continue;
    }

    try {
      const routerModulePath = resolveRouterModulePath(normalized.router, context, options);
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const routerModule = require(routerModulePath);
      const router = pickRouterExport(routerModule);
      if (!router) {
        throw new Error(`Router export not found in module "${normalized.router}".`);
      }
      app.use(normalized.path, router);
      mountedRouteKeys.add(routeKey);
      summary.mounted += 1;
      addResult(summary, {
        ...normalized,
        status: 'mounted',
        message: 'Mounted.'
      });
    } catch (error) {
      summary.failed += 1;
      addResult(summary, {
        ...normalized,
        status: 'failed',
        message: error?.message || String(error)
      });
    }
  }

  if (logger && typeof logger.info === 'function' && (summary.requested || summary.mounted || summary.failed)) {
    logger.info('PACKAGE_ROUTES', 'REGISTER', `Processed route declarations for ${packageId}.`, {
      packageId,
      requested: summary.requested,
      prepared: summary.prepared,
      mounted: summary.mounted,
      failed: summary.failed
    });
  }

  return summary;
}

function resetMountedRoutes() {
  mountedRouteKeys = new Set();
}

function createLoaderHooks(options = {}) {
  return {
    registerRoutes: async (context = {}) => registerManifestRoutes(context, options)
  };
}

module.exports = {
  ROUTE_METHODS,
  normalizeRouteDeclaration,
  resolveRouterModulePath,
  registerManifestRoutes,
  resetMountedRoutes,
  createLoaderHooks
};
