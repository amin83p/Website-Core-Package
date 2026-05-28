const express = require('express');
const http = require('http'); // Import HTTP module
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const expressLayouts = require('express-ejs-layouts');
const cookieParser = require('cookie-parser'); // ADD THIS
const expressSession = require('express-session');

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
const enforceSitePolicy = require('./MVC/middleware/siteStateMiddleware');
const sessionEnforcement = require('./MVC/middleware/sessionEnforcement');
const requestRatePhaseOne = require('./MVC/middleware/requestRateMonitor');
const settingService = require('./MVC/services/settingService'); // Import Setting Service
const appBrandingService = require('./MVC/services/appBrandingService');
const smsProviderService = require('./MVC/services/sms/smsProviderService');
const { registerCoreEntityQueryExecutors } = require('./MVC/models/queryExecutorBootstrap');
const dataBackendRuntimeService = require('./MVC/services/dataBackendRuntimeService');
const dataBackendRecoveryMiddleware = require('./MVC/middleware/dataBackendRecoveryMiddleware');
const packageLoaderService = require('./MVC/services/packageLoaderService');
const packageRegistryInstallerService = require('./MVC/services/packageRegistryInstallerService');
const packageNavigationService = require('./MVC/services/packageNavigationService');
const { getPackageStorageRootAbsolute } = require('./MVC/utils/packageStoragePathUtils');
const startupLogger = require('./MVC/utils/startupLogger');
const actionStateRetentionService = require('./MVC/services/actionStateRetentionService');
const { runWithRequestContext } = require('./MVC/utils/requestContextStore');
const uploadPathUtils = require('./MVC/utils/uploadPathUtils');
const { isRailwayProxyMode, getGatewayBaseUrl } = require('./MVC/utils/uploadModeUtils');
const { SESSION_SECRET } = require('./config/security');

const PORT    = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app); // Create explicit server

// Railway (and similar platforms) run Node behind a reverse proxy.
// express-rate-limit requires trusted proxy headers for correct client IP detection.
app.set('trust proxy', 1);

app.locals.dataBackend = dataBackendRuntimeService.getPublicBackendStatus();
//------middleware-----
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'MVC/views'))
app.use(expressLayouts);
app.set('layout', 'layouts/layout');
//
// Increase limit to 50MB (or more if needed)
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));
// app.use(express.urlencoded({ extended: true })); // ADD: For POST forms (login)
// app.use(express.json()); // ADD: For JSON requests (if needed)
app.use(cookieParser()); // ADD: For cookies (JWT storage)
const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
app.use(expressSession({
  name: 'admin_flow.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000
  }
}));
// 3. Enforce Session Limits (Reads cookies)
app.use(sessionEnforcement);

app.get('/site.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.setHeader('Cache-Control', 'no-cache');
  return res.json(appBrandingService.getManifest());
});

app.use(express.static(path.join(__dirname,'public')));
const uploadsStaticContext = {
  root: '',
  middleware: null
};
app.use('/uploads', (req, res, next) => {
  const uploadRoot = uploadPathUtils.getUploadRootAbsolute();
  if (!uploadsStaticContext.middleware || uploadsStaticContext.root !== uploadRoot) {
    uploadsStaticContext.root = uploadRoot;
    uploadsStaticContext.middleware = express.static(uploadRoot);
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
app.use(softAuth); 
app.use(dataBackendRecoveryMiddleware.exposeBackendStatus);
app.use(chatAccessLocals);
app.use((req, res, next) => {
  res.locals.appBrand = appBrandingService.getBrand();
  res.locals.appContact = appBrandingService.getContact();
  res.locals.appContactPage = appBrandingService.getContactPage();
  res.locals.publicMenu = appBrandingService.getPublicMenu(req.user || null);
  res.locals.publicMenuEndpointOptions = appBrandingService.getPublicMenuEndpointOptions();
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
// const ieltsRoutes = require(); // ✅ 1. Import Here


app.use('/', authRoutes);
app.use('/', homeRoutes);          //   /(home page)
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
//
app.use('/ielts', require('./MVC/routes/ielts/ieltsMainRoute'));

app.use('/benchpath', require('./MVC/routes/benchpath/benchpathMainRoute'));

app.use('/credit', require('./MVC/routes/credit/creditRoutes'));

app.use('/school', require('./MVC/routes/school/schoolMainRoute'));
app.use('/internal/file-gateway', fileGatewayRoutes);

// --- Background Tasks ---
// setInterval(() => {
//     actionStateModel.cleanupExpiredStates().catch(console.error);
// }, 10 * 60 * 1000);

let notFoundHandlerRegistered = false;
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
socketService.init(server);

// ✅ Initialize Settings (Load JSON to Memory)
async function startServer() {
  try {
    const dataBackend = await dataBackendRuntimeService.initializeDataBackend(process.env);
    registerCoreEntityQueryExecutors({ backendMode: dataBackend.mode });
    app.locals.dataBackend = dataBackendRuntimeService.getPublicBackendStatus();

    await settingService.init();
    try {
      const packageLoaderHooks = packageRegistryInstallerService.createLoaderHooks({
        backendMode: dataBackend.mode
      });
      const packageRootDir = getPackageStorageRootAbsolute();
      const packageLoadSummary = await packageLoaderService.loadEnabledPackages({
        app,
        backendMode: dataBackend.mode,
        packageRootDir,
        hooks: packageLoaderHooks
      });
      app.locals.packageLoadSummary = packageLoadSummary;
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
    actionStateRetentionService.start({ enabled: dataBackend.mode === 'mongo' });
    smsProviderService.logStartupDiagnostics();

    server.listen(PORT, () => {
      startupLogger.success('APP', 'HTTP_SERVER', 'Server listening.', { url: `http://localhost:${PORT}` });
      startupLogger.info('APP', 'SETTINGS_SNAPSHOT', 'Loaded settings.', { app: JSON.stringify(settingService.get().app || {}) });
    });
  } catch (err) {
    startupLogger.error('APP', 'BOOT', 'Failed to start server with current settings/backend configuration.', { error: err?.message || String(err) });
    console.error(err);
    process.exit(1);
  }
}

startServer();
