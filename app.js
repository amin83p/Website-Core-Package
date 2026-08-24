const express = require('express');
const http = require('http'); // Import HTTP module
const net = require('net');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const expressLayouts = require('express-ejs-layouts');
const cookieParser = require('cookie-parser'); // ADD THIS
const expressSession = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const crypto = require('crypto');

function loadLocalEnvFile() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    console.warn(`[env] Unable to load .env file: ${error.message}`);
  }
}

loadLocalEnvFile();

const socketService = require('./MVC/services/socketService');
// app.js (or wherever you define middleware)
const logger = require('./MVC/utils/logger');
// Import Middleware & Models (Defined at top)
const { softAuth } = require('./MVC/middleware/authMiddleware'); // New helper
const chatAccessLocals = require('./MVC/middleware/chatAccessLocalsMiddleware');
const orgTimezoneLocals = require('./MVC/middleware/orgTimezoneLocalsMiddleware');
const enforceSitePolicy = require('./MVC/middleware/siteStateMiddleware');
const sessionEnforcement = require('./MVC/middleware/sessionEnforcement');
const requestRatePhaseOne = require('./MVC/middleware/requestRateMonitor');
const settingService = require('./MVC/services/settingService'); // Import Setting Service
const appBrandingService = require('./MVC/services/appBrandingService');
const smsProviderService = require('./MVC/services/sms/smsProviderService');
const adminAuthorityService = require('./MVC/services/adminAuthorityService');
const { registerCoreEntityQueryExecutors } = require('./MVC/models/queryExecutorBootstrap');
const dataBackendRuntimeService = require('./MVC/services/dataBackendRuntimeService');
const dataBackendRecoveryMiddleware = require('./MVC/middleware/dataBackendRecoveryMiddleware');
const packageLoaderService = require('./MVC/services/packageLoaderService');
const packageRegistryService = require('./MVC/services/packageRegistryService');
const packageRegistryInstallerService = require('./MVC/services/packageRegistryInstallerService');
const packageNavigationService = require('./MVC/services/packageNavigationService');
const { getPackageStorageRootAbsolute } = require('./MVC/utils/packageStoragePathUtils');
const startupLogger = require('./MVC/utils/startupLogger');
const actionStateRetentionService = require('./MVC/services/actionStateRetentionService');
const { runWithRequestContext } = require('./MVC/utils/requestContextStore');
const uploadPathUtils = require('./MVC/utils/uploadPathUtils');
const { isRailwayProxyMode, getGatewayBaseUrl } = require('./MVC/utils/uploadModeUtils');
const buildVersionResolver = require('./MVC/utils/buildVersionResolver');
const { buildStaticAssetUrl } = require('./MVC/utils/staticAssetUrl');
const staticAssetMiddleware = require('./MVC/middleware/staticAssetMiddleware');
const { SESSION_SECRET } = require('./config/security');
const { resolveDataBackendConfig } = require('./config/dataBackend');
const { MongoSessionStore } = require('./MVC/infrastructure/mongo/mongoSessionStore');
const { isHtmlNavigationRequest } = require('./MVC/utils/pagePathUtils');

function normalizeListenTarget(value) {
  if (typeof value === 'number') return value;
  const token = String(value || '').trim();
  if (/^\d+$/.test(token)) {
    const port = Number.parseInt(token, 10);
    if (Number.isInteger(port) && port >= 0 && port <= 65535) return port;
  }
  return token || 3000;
}

function describeListenTarget(value) {
  return typeof value === 'number' ? `http://localhost:${value}` : String(value || '');
}

function normalizeListenError(error, value) {
  if (error?.code !== 'EADDRINUSE') return error;
  const friendly = new Error(`${describeListenTarget(value)} is already in use. Stop the existing app process or choose a different PORT.`);
  friendly.code = error.code;
  friendly.cause = error;
  return friendly;
}

function assertListenTargetAvailable(value) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    let settled = false;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      probe.removeAllListeners('error');
      if (error) {
        reject(normalizeListenError(error, value));
        return;
      }
      resolve();
    };

    probe.once('error', finish);
    probe.listen(value, () => {
      probe.close(() => finish());
    });
  });
}

function listenHttpServer(httpServer, value, onListening) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      httpServer.off('error', onError);
    };
    const onError = (error) => {
      cleanup();
      reject(normalizeListenError(error, value));
    };
    httpServer.once('error', onError);
    httpServer.listen(value, () => {
      cleanup();
      if (typeof onListening === 'function') onListening();
      resolve();
    });
  });
}

const PORT = normalizeListenTarget(process.env.PORT || 3000);
const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const DEFAULT_PACKAGE_STARTUP_RECOVERY_WINDOW_MS = 300000;
const DEFAULT_PACKAGE_STARTUP_RECOVERY_INTERVAL_MS = 15000;
const DEFAULT_PACKAGE_RUNTIME_RECONCILE_INTERVAL_MS = 60000;

function cleanRuntimeToken(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

function requestHostIsLocal(req) {
  const host = String(req?.hostname || req?.headers?.host || '').trim().toLowerCase();
  const withoutPort = host.startsWith('[')
    ? host.replace(/^\[|\].*$/g, '')
    : host.split(':')[0];
  return ['localhost', '127.0.0.1', '::1'].includes(withoutPort);
}

function hasRailwayRuntimeEnv(env = process.env) {
  return Boolean(
    env.RAILWAY_ENVIRONMENT
    || env.RAILWAY_PROJECT_ID
    || env.RAILWAY_SERVICE_ID
    || env.RAILWAY_DEPLOYMENT_ID
    || env.RAILWAY_REPLICA_ID
  );
}

function resolvePageDiagnosticsRuntime(req, env = process.env) {
  const nodeEnv = cleanRuntimeToken(env.NODE_ENV || '');
  const railway = hasRailwayRuntimeEnv(env);
  const local = requestHostIsLocal(req) || (!railway && nodeEnv !== 'production');
  return {
    kind: local ? 'local' : (railway ? 'railway' : 'server'),
    nodeEnv: nodeEnv || 'development',
    isProduction: nodeEnv === 'production'
  };
}

function createSessionStore() {
  const backendConfig = resolveDataBackendConfig(process.env);
  const useMongoStore = isProduction && backendConfig.mode === 'mongo' && backendConfig.mongo?.ready;
  return useMongoStore ? new MongoSessionStore() : null;
}

const app = express();
const server = http.createServer(app); // Create explicit server
const sessionStore = createSessionStore();
app.locals.httpServer = server;
app.locals.sessionStore = sessionStore;

// Railway (and similar platforms) run Node behind a reverse proxy.
// express-rate-limit requires trusted proxy headers for correct client IP detection.
app.set('trust proxy', 1);

app.locals.dataBackend = dataBackendRuntimeService.getPublicBackendStatus();
const BUILD_VERSION_CONFIG_PATH = path.join(__dirname, 'config', 'build-version.json');

function readRepoBuildVersionValue() {
  try {
    if (!fs.existsSync(BUILD_VERSION_CONFIG_PATH)) return '';
    const parsed = JSON.parse(fs.readFileSync(BUILD_VERSION_CONFIG_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return '';
    return String(parsed.buildVersion || '').trim();
  } catch (_) {
    return '';
  }
}

function cleanBuildVersionToken(value = '') {
  const token = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{6}$/.test(token)) return '';
  return token;
}

function refreshBuildVersionLocals() {
  const settings = settingService.get();
  const buildVersionOverride = String(settings?.app?.buildVersionOverride || '').trim();
  app.locals.buildVersion = buildVersionResolver.resolveBuildVersion({
    buildVersionOverride,
    repoBuildVersion: readRepoBuildVersionValue()
  });
  app.locals.buildVersionShort = cleanBuildVersionToken(app.locals.buildVersion?.shortHash);
  return app.locals.buildVersion;
}

app.locals.refreshBuildVersion = refreshBuildVersionLocals;
app.locals.buildVersion = { shortHash: '', source: '' };
app.locals.buildVersionShort = '';
app.locals.staticAssetUrl = (assetPath) => buildStaticAssetUrl(assetPath, app.locals.buildVersionShort);

function resolveAppUiSettings() {
  const settings = settingService.get();
  const appSettings = settings && settings.app && typeof settings.app === 'object' ? settings.app : {};
  const rawPickerDelay = Number.parseInt(String(appSettings.genericPickerSearchDebounceMs ?? ''), 10);
  const genericPickerSearchDebounceMs = Number.isFinite(rawPickerDelay)
    ? Math.max(0, Math.min(2000, rawPickerDelay))
    : 400;
  return {
    genericPickerSearchDebounceMs
  };
}

function isEnabledFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isRequestPathTimingEnabled(env = process.env) {
  return !isProduction && isEnabledFlag(env.REQUEST_PATH_TIMING);
}

function createRequestPathTimingMiddleware(label) {
  const timingEnabled = isRequestPathTimingEnabled();
  return (req, res, next) => {
    if (!timingEnabled || !isHtmlNavigationRequest(req)) return next();
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1000000;
      const requestPath = String(req.originalUrl || req.url || '').slice(0, 300);
      console.info(`[request-path] ${label} ${req.method} ${requestPath} ${res.statusCode} ${elapsedMs.toFixed(1)}ms`);
    });
    return next();
  };
}

function createAppStaticMiddleware(rootPath, cacheProfile = 'static') {
  return staticAssetMiddleware.createStaticAssetMiddleware(rootPath, {
    isProduction,
    cacheProfile,
    getBuildVersionShort: () => cleanBuildVersionToken(app.locals.buildVersionShort)
  });
}
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'MVC/views'))
app.use(expressLayouts);
app.set('layout', 'layouts/layout');

// Helmet for HTTP Security Headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://code.jquery.com", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com", "https://unpkg.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      connectSrc: ["'self'", "ws:", "wss:", "https:", "http:"],
      frameSrc: ["'self'", "https:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(compression({
  threshold: 1024,
  filter(req, res) {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

const packageAssetRuntimeRouter = express.Router();
app.locals.packageAssetRuntimeRouter = packageAssetRuntimeRouter;

app.get('/site.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.setHeader('Cache-Control', 'no-cache');
  return res.json(appBrandingService.getManifest());
});

app.use(createAppStaticMiddleware(path.join(__dirname, 'public')));
const uploadsStaticContext = {
  root: '',
  middleware: null
};
app.use('/uploads', (req, res, next) => {
  const uploadRoot = uploadPathUtils.getUploadRootAbsolute();
  if (!uploadsStaticContext.middleware || uploadsStaticContext.root !== uploadRoot) {
    uploadsStaticContext.root = uploadRoot;
    uploadsStaticContext.middleware = createAppStaticMiddleware(uploadRoot, 'upload');
  }

  const requestedDiskPath = uploadPathUtils.fromUploadsUrlToDiskPath(req.originalUrl || req.url, uploadRoot);
  const hasLocalArtifact = Boolean(requestedDiskPath && fs.existsSync(requestedDiskPath));

  if (isRailwayProxyMode()) {
    const gatewayBaseUrl = getGatewayBaseUrl();
    if (gatewayBaseUrl) {
      let isSameHost = false;
      try {
        const gatewayHost = new URL(gatewayBaseUrl).host.toLowerCase();
        const requestHost = String(req.get('host') || '').toLowerCase();
        isSameHost = gatewayHost === requestHost;
      } catch (_) {
        isSameHost = false;
      }
      // In local/dev flows we may have build artifacts on local disk while proxy mode is still enabled.
      // Prefer serving local files when they exist; otherwise keep gateway redirect behavior.
      if (!isSameHost && !hasLocalArtifact) {
        const suffix = String(req.originalUrl || '').replace(/^\/uploads/, '');
        const targetUrl = `${gatewayBaseUrl}/uploads${suffix}`;
        return res.redirect(307, targetUrl);
      }
    }
  }

  return uploadsStaticContext.middleware(req, res, next);
});
app.use(packageAssetRuntimeRouter);

// Increase limit to 50MB (or more if needed)
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));
app.use(cookieParser(SESSION_SECRET)); // Use session secret for signed cookies if needed
app.use(expressSession({
  name: 'admin_flow.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: sessionStore ? false : true,
  ...(sessionStore ? { store: sessionStore } : {}),
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    // Keep CSRF/session cookie alive during long in-page work (e.g. Manage Session).
    maxAge: 12 * 60 * 60 * 1000
  }
}));

// CSRF Protection
app.use((req, res, next) => {
  // 1. Generate token if it doesn't exist in session
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  
  // 2. Expose to locals for views
  res.locals.csrfToken = req.session ? req.session.csrfToken : '';

  // 3. Check token for mutating methods
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    // Exclude specific routes if needed
    if (req.originalUrl.startsWith('/internal/file-gateway/')) {
      return next();
    }

    const tokenSent = req.headers['csrf-token']
      || req.headers['x-csrf-token']
      || (req.body && req.body._csrf)
      || (req.query && req.query._csrf);
    
    if (!req.session || !tokenSent || tokenSent !== req.session.csrfToken) {
      const isAjax = req.headers['x-ajax-request'] || req.xhr || (req.headers.accept && req.headers.accept.includes('json'));
      const message = !tokenSent
        ? 'Invalid or missing CSRF token.'
        : 'Invalid or missing CSRF token. Please refresh the page and try again.';
      if (isAjax) {
        return res.status(403).json({ status: 'error', message });
      }
      return res.status(403).send(message);
    }
  }
  
  next();
});

// 3. Enforce Session Limits (Reads cookies)
app.use(sessionEnforcement);
//Middle wares
///const {userAuth} = require('./MVC/middleware/authMiddleware');
const {timeCheckMiddleware} = require('./MVC/middleware/timeCheckMiddleware');
//app.use(userAuth);
app.use(timeCheckMiddleware);
//
// --- Custom Middleware Stack ---

// 1. Request Correlation ID
app.use((req, res, next) => {
  const inbound = String(req.headers['x-request-id'] || '').trim();
  const requestId = inbound || (typeof randomUUID === 'function'
    ? randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

app.use((req, res, next) => {
  runWithRequestContext({
    requestId: String(req.requestId || '').trim(),
    actionStateId: '',
    actionStateHasStructuredChanges: false,
    request: {
      method: req.method,
      url: req.originalUrl || req.url || '',
      ip: req.ip || req.socket?.remoteAddress || '',
      userAgent: req.headers['user-agent'] || '',
      requestId: String(req.requestId || '').trim()
    },
    actor: {}
  }, next);
});

// 1. Logger
app.use((req, res, next) => {
  const ext = req.url.split('.').pop().toLowerCase();
  if (['css', 'js', 'jpg', 'png', 'ico', 'woff2'].includes(ext)) return next();
  const start = Date.now();
  res.on('finish', () => logger.http(req, res, Date.now() - start));
  next();
});

// 2. Soft Auth (Populate req.user if token exists, but don't block)
app.use(createRequestPathTimingMiddleware('authenticated-html'));
app.use(softAuth); 
app.use(sessionEnforcement.trackCurrentPathAfterAuth);
app.use(orgTimezoneLocals);
app.use(dataBackendRecoveryMiddleware.exposeBackendStatus);
app.use(chatAccessLocals);
app.use((req, res, next) => {
  res.locals.appBrand = appBrandingService.getBrand();
  res.locals.appContact = appBrandingService.getContact();
  res.locals.appContactPage = appBrandingService.getContactPage();
  res.locals.publicMenu = appBrandingService.getPublicMenu(req.user || null);
  res.locals.publicMenuEndpointOptions = appBrandingService.getPublicMenuEndpointOptions();
  res.locals.appUiSettings = resolveAppUiSettings();
  res.locals.buildVersionShort = cleanBuildVersionToken(req.app?.locals?.buildVersionShort);
  res.locals.requestId = String(req.requestId || '').trim();
  res.locals.originalUrl = String(req.originalUrl || req.url || '').trim();
  res.locals.pageDiagnosticsRuntime = null;
  res.locals.staticAssetUrl = (assetPath) => buildStaticAssetUrl(assetPath, res.locals.buildVersionShort);
  res.locals.canUseAdminAuthenticator = Boolean(
    req.user && adminAuthorityService.hasAnyAdminPrivilege(req.user)
  );
  res.locals.canViewActiveUsers = false;
  res.locals.canUsePageDiagnostics = false;
  res.locals.pageDiagnosticsEnabled = false;
  res.locals.pageDiagnosticsPreferenceEndpoint = '/debug/client-diagnostics/preference';
  if (req.user) {
    const canViewActiveUsers = req.user.canViewActiveUsers === true || req.user.uiAccess?.canViewActiveUsers === true;
    const canUsePageDiagnostics = req.user.canUsePageDiagnostics === true || req.user.uiAccess?.canUsePageDiagnostics === true;
    res.locals.canViewActiveUsers = canViewActiveUsers;
    res.locals.canUsePageDiagnostics = canUsePageDiagnostics;
    res.locals.pageDiagnosticsEnabled = canUsePageDiagnostics && req.user.pageDiagnosticsEnabled !== false;
    if (canUsePageDiagnostics) {
      res.locals.pageDiagnosticsRuntime = resolvePageDiagnosticsRuntime(req);
    }
  }
  next();
});
app.use(dataBackendRecoveryMiddleware.enforceRecoveryMode);
// 3. Site Policy Enforcer (Maintenance Mode, Global Bans)
app.use(enforceSitePolicy);
// 4. Phase 1 request-rate monitor (non-blocking by default)
app.use(requestRatePhaseOne);
//

//------routing------
const homeRoutes    = require('./MVC/routes/homeRoutes');
const contactRoutes = require('./MVC/routes/contactRoutes'); 

const userRoutes = require('./MVC/routes/userRoutes'); // ADD THIS
const profileRoutes = require('./MVC/routes/profileRoutes');
const authRoutes = require('./MVC/routes/authRoutes');
const sectionRoutes = require('./MVC/routes/sectionRoutes');
const operationRoutes = require('./MVC/routes/operationRoutes');
const roleRoutes = require('./MVC/routes/roleRoutes');
const scopeRoutes = require('./MVC/routes/scopeRoutes');
const accessRoutes = require('./MVC/routes/accessRoutes');
const restrictedRoutes = require('./MVC/routes/restrictedRoutes');
const tableSettingsRoutes = require('./MVC/routes/tableSettingsRoutes');
const userSettingsRoutes = require('./MVC/routes/userSettingsRoutes');
const verifyAdmin = require('./MVC/routes/securityRoutes');
const fileRoutes = require('./MVC/routes/fileRoutes');
const dashboardPanels = require('./MVC/routes/dashboardRoutes');
const personsrRouts = require('./MVC/routes/personRoutes');
const organizationRoutes = require('./MVC/routes/organizationRoutes');
const contractsRoutes =  require('./MVC/routes/contractRoutes')
const logRoutes = require('./MVC/routes/logRoutes');
const accessPolicyRoutes = require('./MVC/routes/accessPolicyRoutes');
const debugRoutes = require('./MVC/routes/debugRoutes');
const actionStateRoutes = require('./MVC/routes/actionStateRoutes');
const trackActivityRoutes = require('./MVC/routes/trackActivityRoutes');
const activeUsersRoutes = require('./MVC/routes/activeUsersRoutes');
const organizationPolicies = require('./MVC/routes/orgPolicyRoutes');
const websitePolicyRoutes = require('./MVC/routes/websitePolicyRoutes');
const symbolRoutes = require('./MVC/routes/symbolRoutes');
const styleRoutes = require('./MVC/routes/styleRoutes');
const sessionRoutes = require('./MVC/routes/sessionRoutes');
const newsRoutes = require('./MVC/routes/newsRoutes');
const chatRoutes = require('./MVC/routes/chatRoutes');
const taskRoutes = require('./MVC/routes/taskRoutes');
const newsletterRoutes = require('./MVC/routes/newsletterRoutes');
const subscriptionGroupRoutes = require('./MVC/routes/subscriptionGroupRoutes');
const userMembershipRoutes = require('./MVC/routes/userMembershipRoutes');
const systemSettingsRoutes = require('./MVC/routes/systemSettingsRoutes');
const helpRoutes = require('./MVC/routes/helpRoutes');
const docsRoutes = require('./MVC/routes/docsRoutes');
const emailManagementRoutes = require('./MVC/routes/emailManagementRoutes');
const activityQuotaRoutes = require('./MVC/routes/activityQuota/activityQuotaMainRoute');
const fileGatewayRoutes = require('./MVC/routes/internal/fileGatewayRoutes');
app.use('/', authRoutes);
app.use('/', homeRoutes);          //   /(home page)
app.use('/', restrictedRoutes);
app.use('/contact', contactRoutes);

app.use('/websitePolicy', websitePolicyRoutes);
app.use('/users', userRoutes);
app.use('/sessions', sessionRoutes);
app.use('/profile', profileRoutes);
app.use('/sections', sectionRoutes);
app.use('/operations', operationRoutes);
app.use('/roles', roleRoutes);
app.use('/scopes', scopeRoutes);
app.use('/accesses', accessRoutes);
app.use('/tableSettings', tableSettingsRoutes);
app.use('/userSettings', userSettingsRoutes);
app.use('/verify-admin', verifyAdmin)
app.use('/files', fileRoutes);
app.use('/dashboard', dashboardPanels);
app.use('/persons', personsrRouts);
app.use('/organizations', organizationRoutes);
app.use('/contracts', contractsRoutes);
app.use('/logs', logRoutes);
app.use('/accessPolicies', accessPolicyRoutes);
app.use('/debug', debugRoutes);
app.use('/actionStates', actionStateRoutes);
app.use('/security', trackActivityRoutes);
app.use('/security', activeUsersRoutes);
app.use('/organizationPolicies', organizationPolicies);
app.use('/symbols', symbolRoutes);
app.use('/styles', styleRoutes);
app.use('/news', newsRoutes);
app.use('/chat', chatRoutes);
app.use('/tasks', taskRoutes);
app.use('/newsletter', newsletterRoutes);
app.use('/subscriptionGroup', subscriptionGroupRoutes);
app.use('/memberships', userMembershipRoutes);
app.use('/systemSettings', systemSettingsRoutes);
app.use('/help', helpRoutes);
app.use('/docs', docsRoutes);
app.use('/email-management', emailManagementRoutes);
app.use('/activity-quota', activityQuotaRoutes);


app.use('/internal/file-gateway', fileGatewayRoutes);

// Package runtime container stays mounted before 404 so package actions can activate routes live.
const packageRuntimeRouter = express.Router();
app.locals.packageRuntimeRouter = packageRuntimeRouter;
app.use(packageRuntimeRouter);

// --- Background Tasks ---
// setInterval(() => {
//     actionStateModel.cleanupExpiredStates().catch(console.error);
// }, 10 * 60 * 1000);

let notFoundHandlerRegistered = false;
let packageStartupRecoveryTimer = null;
let packageRuntimeReconcileTimer = null;
function registerNotFoundHandler() {
  if (notFoundHandlerRegistered) return;
  notFoundHandlerRegistered = true;
  app.use((req, res) => {
    res.status(404).render('404', {
      title: 'Not Found',
      user: req.user || null
    });
  });
}

// ✅ Initialize Socket.io
function readPositiveInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function isTrue(value, fallback = false) {
  const token = String(value || '').trim().toLowerCase();
  if (!token) return fallback;
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

function resolvePackageStartupRecoverySettings(env = process.env) {
  const enabled = isTrue(env.PACKAGE_STARTUP_RECOVERY_ENABLED, true);
  const windowMs = readPositiveInt(env.PACKAGE_STARTUP_RECOVERY_WINDOW_MS, DEFAULT_PACKAGE_STARTUP_RECOVERY_WINDOW_MS);
  const intervalMs = Math.min(
    windowMs,
    readPositiveInt(env.PACKAGE_STARTUP_RECOVERY_INTERVAL_MS, DEFAULT_PACKAGE_STARTUP_RECOVERY_INTERVAL_MS)
  );
  return {
    enabled,
    windowMs,
    intervalMs: Math.max(1000, intervalMs)
  };
}

function normalizePackageId(value = '') {
  return String(value || '').trim().toLowerCase();
}

function shouldRetryPackageFailure(row = {}) {
  const code = String(row?.code || '').trim().toUpperCase();
  const message = String(row?.message || '').trim();
  if (row?.missingManifest === true) return true;
  if (code === 'PACKAGE_MANIFEST_NOT_FOUND') return true;
  if (code === 'PACKAGE_RUNTIME_ROUTE_MOUNT_FAILED') return true;
  if (/no manifest file found/i.test(message)) return true;
  if (/runtime route|route mount/i.test(message)) return true;
  return false;
}

function collectRecoverablePackageIds(summary = {}) {
  const failures = Array.isArray(summary?.failed) ? summary.failed : [];
  return Array.from(new Set(
    failures
      .filter((row) => shouldRetryPackageFailure(row))
      .map((row) => normalizePackageId(row?.packageId || ''))
      .filter(Boolean)
  ));
}

function mergePackageLoadSummary(baseSummary = {}, latestSummary = {}) {
  const existingLoaded = Array.isArray(baseSummary?.loaded) ? baseSummary.loaded : [];
  const latestLoaded = Array.isArray(latestSummary?.loaded) ? latestSummary.loaded : [];
  const loadedMap = new Map();
  existingLoaded.forEach((row) => {
    const packageId = normalizePackageId(row?.packageId || '');
    if (!packageId) return;
    loadedMap.set(packageId, row);
  });
  latestLoaded.forEach((row) => {
    const packageId = normalizePackageId(row?.packageId || '');
    if (!packageId) return;
    loadedMap.set(packageId, row);
  });

  const loadedIds = new Set(Array.from(loadedMap.keys()));
  const existingFailed = Array.isArray(baseSummary?.failed) ? baseSummary.failed : [];
  const latestFailed = Array.isArray(latestSummary?.failed) ? latestSummary.failed : [];
  const failedMap = new Map();

  existingFailed.forEach((row) => {
    const packageId = normalizePackageId(row?.packageId || '');
    if (!packageId || loadedIds.has(packageId)) return;
    failedMap.set(packageId, row);
  });
  latestFailed.forEach((row) => {
    const packageId = normalizePackageId(row?.packageId || '');
    if (!packageId || loadedIds.has(packageId)) return;
    failedMap.set(packageId, row);
  });

  const loaded = Array.from(loadedMap.values());
  const failed = Array.from(failedMap.values());
  return {
    ...baseSummary,
    finishedAt: new Date().toISOString(),
    loaded,
    failed,
    loadedCount: loaded.length,
    failedCount: failed.length
  };
}

function collectLoadedPackageIds(summary = {}) {
  const loaded = Array.isArray(summary?.loaded) ? summary.loaded : [];
  return Array.from(new Set(
    loaded
      .map((row) => normalizePackageId(row?.packageId || ''))
      .filter(Boolean)
  ));
}

function collectFailedPackageIds(summary = {}) {
  const failed = Array.isArray(summary?.failed) ? summary.failed : [];
  return Array.from(new Set(
    failed
      .map((row) => normalizePackageId(row?.packageId || ''))
      .filter(Boolean)
  ));
}

async function collectEnabledRegistryPackageIds(backendMode = '') {
  const rows = await packageRegistryService.listPackageRegistry({ backendMode });
  return Array.from(new Set(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row && row.enabled === true)
      .map((row) => normalizePackageId(row?.packageId || row?.id || ''))
      .filter(Boolean)
  ));
}

function resolvePackageRuntimeReconcileSettings(env = process.env) {
  return {
    enabled: isTrue(env.PACKAGE_RUNTIME_RECONCILE_ENABLED, true),
    intervalMs: Math.max(
      5000,
      readPositiveInt(env.PACKAGE_RUNTIME_RECONCILE_INTERVAL_MS, DEFAULT_PACKAGE_RUNTIME_RECONCILE_INTERVAL_MS)
    )
  };
}

function stopPackageStartupRecoveryLoop() {
  if (packageStartupRecoveryTimer) {
    clearInterval(packageStartupRecoveryTimer);
    packageStartupRecoveryTimer = null;
  }
}

function stopPackageRuntimeReconcileLoop() {
  if (packageRuntimeReconcileTimer) {
    clearInterval(packageRuntimeReconcileTimer);
    packageRuntimeReconcileTimer = null;
  }
}

function startPackageRuntimeReconcileLoop({
  backendMode = '',
  packageRootDir = '',
  packageLoaderHooks = {},
  packageRuntimeRouter = null,
  packageAssetRuntimeRouter = null
} = {}) {
  stopPackageRuntimeReconcileLoop();
  const settings = resolvePackageRuntimeReconcileSettings(process.env);
  if (!settings.enabled) {
    startupLogger.info('PACKAGE_LOADER', 'RUNTIME_RECONCILE_DISABLED', 'Runtime package reconcile loop is disabled by environment flag.');
    return;
  }

  const state = { running: false };
  const runTick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      const enabledPackageIds = await collectEnabledRegistryPackageIds(backendMode);
      const loadedPackageIds = new Set(collectLoadedPackageIds(app.locals.packageLoadSummary || {}));
      const failedPackageIds = new Set(collectFailedPackageIds(app.locals.packageLoadSummary || {}));
      const missingPackageIds = enabledPackageIds.filter((packageId) => (
        !loadedPackageIds.has(packageId)
        && !failedPackageIds.has(packageId)
      ));
      if (!missingPackageIds.length) return;

      startupLogger.warn('PACKAGE_LOADER', 'RUNTIME_RECONCILE_FOUND', 'Enabled packages are missing from the active runtime router; loading them now.', {
        packageIds: missingPackageIds.join(',')
      });

      const latestSummary = await packageLoaderService.loadEnabledPackages({
        app,
        packageRuntimeRouter,
        packageAssetRuntimeRouter,
        backendMode,
        packageRootDir,
        hooks: packageLoaderHooks,
        packageIds: missingPackageIds,
        continueOnError: true
      });
      app.locals.packageLoadSummary = mergePackageLoadSummary(app.locals.packageLoadSummary || {}, latestSummary);

      if (Array.isArray(latestSummary?.loaded) && latestSummary.loaded.length) {
        startupLogger.success('PACKAGE_LOADER', 'RUNTIME_RECONCILE_LOADED', 'Runtime package reconcile loaded missing packages.', {
          loadedPackageIds: latestSummary.loaded.map((row) => normalizePackageId(row?.packageId || '')).filter(Boolean).join(',')
        });
      }
    } catch (error) {
      startupLogger.warn('PACKAGE_LOADER', 'RUNTIME_RECONCILE_FAIL', 'Runtime package reconcile tick failed.', {
        error: error?.message || String(error)
      });
    } finally {
      state.running = false;
    }
  };

  packageRuntimeReconcileTimer = setInterval(() => {
    void runTick();
  }, settings.intervalMs);
  void runTick();
}

function startPackageStartupRecoveryLoop({
  initialSummary = {},
  backendMode = '',
  packageRootDir = '',
  packageLoaderHooks = {},
  packageRuntimeRouter = null,
  packageAssetRuntimeRouter = null
} = {}) {
  stopPackageStartupRecoveryLoop();
  const settings = resolvePackageStartupRecoverySettings(process.env);
  if (!settings.enabled) {
    startupLogger.info('PACKAGE_LOADER', 'RECOVERY_DISABLED', 'Startup recovery loop is disabled by environment flag.');
    return;
  }

  const pendingIds = new Set(collectRecoverablePackageIds(initialSummary));
  if (!pendingIds.size) return;

  const deadline = Date.now() + settings.windowMs;
  const state = {
    running: false
  };

  startupLogger.warn('PACKAGE_LOADER', 'RECOVERY_START', 'Starting background package startup recovery loop.', {
    packageCount: pendingIds.size,
    windowMs: settings.windowMs,
    intervalMs: settings.intervalMs
  });

  const runTick = async () => {
    if (state.running) return;
    if (!pendingIds.size) {
      stopPackageStartupRecoveryLoop();
      return;
    }
    if (Date.now() >= deadline) {
      startupLogger.warn('PACKAGE_LOADER', 'RECOVERY_TIMEOUT', 'Package startup recovery window expired.', {
        pendingPackageIds: Array.from(pendingIds).join(',')
      });
      stopPackageStartupRecoveryLoop();
      return;
    }

    state.running = true;
    try {
      const latestSummary = await packageLoaderService.loadEnabledPackages({
        app,
        packageRuntimeRouter,
        packageAssetRuntimeRouter,
        backendMode,
        packageRootDir,
        hooks: packageLoaderHooks,
        packageIds: Array.from(pendingIds),
        continueOnError: true
      });
      app.locals.packageLoadSummary = mergePackageLoadSummary(app.locals.packageLoadSummary || {}, latestSummary);

      const loadedRows = Array.isArray(latestSummary?.loaded) ? latestSummary.loaded : [];
      loadedRows.forEach((row) => {
        const packageId = normalizePackageId(row?.packageId || '');
        if (!packageId) return;
        pendingIds.delete(packageId);
      });

      if (!pendingIds.size) {
        startupLogger.success('PACKAGE_LOADER', 'RECOVERY_COMPLETE', 'Background package startup recovery completed.', {
          loadedCount: loadedRows.length
        });
        stopPackageStartupRecoveryLoop();
      }
    } catch (error) {
      startupLogger.warn('PACKAGE_LOADER', 'RECOVERY_TICK_FAIL', 'Package startup recovery tick failed.', {
        error: error?.message || String(error)
      });
    } finally {
      state.running = false;
    }
  };

  packageStartupRecoveryTimer = setInterval(() => {
    void runTick();
  }, settings.intervalMs);
  void runTick();
}

socketService.init(server);

// ✅ Initialize Settings (Load JSON to Memory)
async function startServer() {
  try {
    await assertListenTargetAvailable(PORT);
    const dataBackend = await dataBackendRuntimeService.initializeDataBackend(process.env);
    registerCoreEntityQueryExecutors({ backendMode: dataBackend.mode });
    app.locals.dataBackend = dataBackendRuntimeService.getPublicBackendStatus();
    if (sessionStore && typeof sessionStore.ensureIndexes === 'function') {
      await sessionStore.ensureIndexes();
      startupLogger.success('SESSION', 'STORE', 'Mongo session store initialized.', {
        collection: sessionStore.collectionName
      });
    }

    await settingService.init();
    try {
      const domainOpsService = require('./MVC/services/data/domainOpsService');
      const { ensureWriteHeavyRateLimitEnforcement } = require('./MVC/services/security/requestRateEnforcementBootstrap');
      await ensureWriteHeavyRateLimitEnforcement({
        getWebsitePolicy: () => domainOpsService.getWebsitePolicy(),
        updateWebsitePolicy: (updates, user) => domainOpsService.updateWebsitePolicy(updates, user)
      });
    } catch (rateLimitBootstrapError) {
      startupLogger.warn('REQUEST_RATE', 'PHASE2_ENFORCE', 'Unable to ensure write/heavy rate-limit enforcement.', {
        error: rateLimitBootstrapError?.message || String(rateLimitBootstrapError)
      });
    }
    try {
      const {
        resolveRequestCacheTtlMs,
        resolveRequestCacheMaxEntries
      } = require('./MVC/services/cache/requestCacheConfig');
      startupLogger.info(
        'REQUEST_CACHE',
        'ENABLED',
        `Request cache enabled: ttl=${Math.round(resolveRequestCacheTtlMs() / 1000)}s maxEntries=${resolveRequestCacheMaxEntries()}`
      );
    } catch (_) {
      // ignore
    }
    try {
      const {
        resolveDefaultPageSize,
        MAX_PAGE_SIZE
      } = require('./packages/school/MVC/services/school/schoolPaginationUtils');
      startupLogger.info(
        'SCHOOL_LIST',
        'DEFAULTS',
        `School list defaults: pageSize=${resolveDefaultPageSize()} maxPageSize=${MAX_PAGE_SIZE}`
      );
    } catch (_) {
      // ignore
    }
    refreshBuildVersionLocals();
    try {
      const packageLoaderHooks = packageRegistryInstallerService.createLoaderHooks({
        backendMode: dataBackend.mode,
        staticFactory: (rootPath) => createAppStaticMiddleware(rootPath)
      });
      const packageRootDir = getPackageStorageRootAbsolute();
      const packageLoadSummary = await packageLoaderService.loadEnabledPackages({
        app,
        packageRuntimeRouter,
        packageAssetRuntimeRouter,
        backendMode: dataBackend.mode,
        packageRootDir,
        hooks: packageLoaderHooks
      });
      app.locals.packageLoadSummary = packageLoadSummary;
      startPackageStartupRecoveryLoop({
        initialSummary: packageLoadSummary,
        backendMode: dataBackend.mode,
        packageRootDir,
        packageLoaderHooks,
        packageRuntimeRouter,
        packageAssetRuntimeRouter
      });
      startPackageRuntimeReconcileLoop({
        backendMode: dataBackend.mode,
        packageRootDir,
        packageLoaderHooks,
        packageRuntimeRouter,
        packageAssetRuntimeRouter
      });
    } catch (packageLoaderError) {
      startupLogger.warn('PACKAGE_LOADER', 'STARTUP', 'Package loader failed during startup; continuing with core + hardcoded routes.', {
        error: packageLoaderError?.message || String(packageLoaderError)
      });
      app.locals.packageLoadSummary = {
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        enabledCount: 0,
        loadedCount: 0,
        failedCount: 1,
        loaded: [],
        failed: [{ packageId: '', message: packageLoaderError?.message || String(packageLoaderError) }]
      };
    }
    registerNotFoundHandler();
    try {
      const packageNavigationSnapshot = await packageNavigationService.refreshNavigationRegistry({
        backendMode: dataBackend.mode
      });
      app.locals.packageNavigationSnapshot = packageNavigationSnapshot;
    } catch (packageNavigationError) {
      startupLogger.warn('PACKAGE_NAV', 'STARTUP', 'Package navigation registry failed to refresh; continuing with static defaults.', {
        error: packageNavigationError?.message || String(packageNavigationError)
      });
      app.locals.packageNavigationSnapshot = null;
    }
    await listenHttpServer(server, PORT, () => {
      startupLogger.success('APP', 'HTTP_SERVER', 'Server listening.', { url: describeListenTarget(PORT) });
      const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
      const appSettingsSnapshot = (() => {
        const appSettings = settingService.get().app || {};
        return {
          appName: appSettings.brand?.appName || '',
          appShortName: appSettings.brand?.appShortName || '',
          defaultPageSize: appSettings.defaultPageSize || 0,
          buildVersion: appSettings.buildVersionOverride || '',
          publicMenuItems: Array.isArray(appSettings.publicMenu?.items) ? appSettings.publicMenu.items.length : 0,
          uploadsPath: appSettings.uploadsPath || '',
          dataBackend: runtimeBackend?.mode || dataBackend?.mode || 'json',
          dataBackendRequested: runtimeBackend?.requested || runtimeBackend?.runtime?.requestedMode || '',
          dataBackendRecovery: Boolean(runtimeBackend?.fallback?.active)
        };
      })();
      startupLogger.info('APP', 'SETTINGS_SNAPSHOT', 'Loaded settings summary.', appSettingsSnapshot);
    });
    actionStateRetentionService.start({ enabled: dataBackend.mode === 'mongo' });
    smsProviderService.logStartupDiagnostics();
  } catch (err) {
    if (err?.code === 'EADDRINUSE') {
      startupLogger.error('APP', 'HTTP_SERVER', err.message, { target: describeListenTarget(PORT) });
      console.error(err.message);
      process.exit(1);
    }
    startupLogger.error('APP', 'BOOT', 'Failed to start server with current settings/backend configuration.', { error: err?.message || String(err) });
    console.error(err);
    process.exit(1);
  }
}

startServer();
