const fs = require('fs').promises;
const path = require('path');

const startupLogger = require('../utils/startupLogger');
const packageRegistryService = require('./packageRegistryService');
const packageManifestService = require('./packageManifestService');
const localPackageSyncService = require('./localPackageSyncService');
const { getPackageStorageRootAbsolute } = require('../utils/packageStoragePathUtils');

const DEFAULT_MANIFEST_FILES = Object.freeze([
  'package.manifest.json',
  'manifest.json'
]);
const DEFAULT_MANIFEST_RETRY_MS = 15000;
const DEFAULT_MANIFEST_RETRY_INTERVAL_MS = 1000;

function cleanText(value, max = 2000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizePackageId(value = '') {
  return cleanText(value, 80).toLowerCase();
}

function normalizePackageIdList(raw = []) {
  const rows = Array.isArray(raw) ? raw : [raw];
  return Array.from(new Set(
    rows.map((item) => normalizePackageId(item)).filter(Boolean)
  ));
}

function readPositiveInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveManifestRetrySettings(env = process.env) {
  const retryMs = readPositiveInt(env.PACKAGE_STARTUP_MANIFEST_RETRY_MS, DEFAULT_MANIFEST_RETRY_MS);
  const retryIntervalMs = readPositiveInt(
    env.PACKAGE_STARTUP_MANIFEST_RETRY_INTERVAL_MS,
    DEFAULT_MANIFEST_RETRY_INTERVAL_MS
  );
  return {
    retryMs,
    retryIntervalMs: Math.min(retryMs, Math.max(1, retryIntervalMs))
  };
}

function waitForMs(ms = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function resolveProjectRoot() {
  return path.resolve(__dirname, '../../');
}

async function fileExists(filePath = '') {
  try {
    await fs.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

function createLoaderHooks(customHooks = {}) {
  const provided = customHooks && typeof customHooks === 'object' ? customHooks : {};
  return {
    registerRoutes: typeof provided.registerRoutes === 'function' ? provided.registerRoutes : async () => {},
    registerViews: typeof provided.registerViews === 'function' ? provided.registerViews : async () => {},
    registerAssets: typeof provided.registerAssets === 'function' ? provided.registerAssets : async () => {},
    registerRegistryData: typeof provided.registerRegistryData === 'function' ? provided.registerRegistryData : async () => {},
    registerUploadFolders: typeof provided.registerUploadFolders === 'function' ? provided.registerUploadFolders : async () => {},
    registerQueryExecutors: typeof provided.registerQueryExecutors === 'function' ? provided.registerQueryExecutors : async () => {}
  };
}

function resolveManifestCandidates(packageId = '', registryRow = {}, packageRootDir = '') {
  const projectRoot = resolveProjectRoot();
  const token = normalizePackageId(packageId);
  const candidates = [];

  const manifestPathMeta = cleanText(registryRow?.metadata?.manifestPath || registryRow?.manifestPath || '', 1600);
  if (manifestPathMeta) {
    const resolvedMetaPath = path.isAbsolute(manifestPathMeta)
      ? manifestPathMeta
      : path.resolve(projectRoot, manifestPathMeta);
    candidates.push(resolvedMetaPath);
  }

  if (token) {
    DEFAULT_MANIFEST_FILES.forEach((fileName) => {
      candidates.push(path.resolve(packageRootDir, token, fileName));
    });
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = String(candidate || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function resolveManifestPath(packageId = '', registryRow = {}, packageRootDir = '') {
  const candidates = resolveManifestCandidates(packageId, registryRow, packageRootDir);
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await fileExists(candidate)) return candidate;
  }
  return '';
}

async function resolveManifestPathWithRetry(packageId = '', registryRow = {}, packageRootDir = '', settings = {}) {
  const retryMs = readPositiveInt(settings?.retryMs, 0);
  const retryIntervalMs = readPositiveInt(settings?.retryIntervalMs, 1);
  const startedAt = Date.now();

  // First attempt always runs immediately.
  // Additional attempts run only inside the configured retry window.
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const resolved = await resolveManifestPath(packageId, registryRow, packageRootDir);
    if (resolved) return resolved;
    if (retryMs <= 0) return '';

    const elapsed = Date.now() - startedAt;
    if (elapsed >= retryMs) return '';
    const remaining = retryMs - elapsed;
    // eslint-disable-next-line no-await-in-loop
    await waitForMs(Math.min(retryIntervalMs, remaining));
  }
}

async function readManifestFile(manifestPath = '') {
  const raw = await fs.readFile(manifestPath, 'utf8');
  const cleaned = String(raw || '').replace(/^\uFEFF/, '').trim();
  if (!cleaned) throw new Error('Manifest file is empty.');
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`Invalid manifest JSON: ${error.message}`);
  }
}

async function runLoaderHooks(hooks, context = {}) {
  const app = context?.app && typeof context.app === 'object' ? context.app : null;
  const runtimeRouter = context?.packageRuntimeRouter && typeof context.packageRuntimeRouter === 'object'
    ? context.packageRuntimeRouter
    : (app?.locals?.packageRuntimeRouter && typeof app.locals.packageRuntimeRouter === 'object'
      ? app.locals.packageRuntimeRouter
      : null);
  const routesApp = runtimeRouter && typeof runtimeRouter.use === 'function' ? runtimeRouter : app;
  const assetsApp = runtimeRouter && typeof runtimeRouter.use === 'function' ? runtimeRouter : app;
  const viewsApp = app && typeof app.get === 'function' && typeof app.set === 'function'
    ? app
    : ((runtimeRouter && typeof runtimeRouter.get === 'function' && typeof runtimeRouter.set === 'function')
      ? runtimeRouter
      : app);

  await hooks.registerRoutes({ ...context, app: routesApp });
  await hooks.registerViews({ ...context, app: viewsApp });
  await hooks.registerAssets({ ...context, app: assetsApp });
  await hooks.registerRegistryData(context);
  await hooks.registerUploadFolders(context);
  await hooks.registerQueryExecutors(context);
}

function summarizeRegistryRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((row) => row && row.enabled === true);
}

function summarizeLocalCacheRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((row) => {
      const packageId = normalizePackageId(row?.packageId || row?.id || '');
      if (!packageId) return null;
      return {
        packageId,
        enabled: row?.enabled !== false,
        installStatus: row?.enabled === false ? 'disabled' : 'enabled',
        metadata: {
          manifestPath: cleanText(row?.manifestPath, 2000),
          packageName: cleanText(row?.name, 200),
          mountPath: cleanText(row?.mountPath, 500)
        }
      };
    })
    .filter((row) => row && row.enabled === true);
}

async function loadEnabledPackages(options = {}) {
  const startedAt = new Date().toISOString();
  const backendMode = cleanText(options.backendMode, 30) || undefined;
  const packageRootDir = getPackageStorageRootAbsolute({ packageRootDir: options.packageRootDir });
  const hooks = createLoaderHooks(options.hooks || {});
  const logger = options.logger || startupLogger;
  const continueOnError = options.continueOnError !== false;
  const modeState = localPackageSyncService.resolveLocalPackageMode(options.env || process.env);
  const localDevMode = modeState.enabled;
  const manifestRetrySettings = resolveManifestRetrySettings(options.env || process.env);
  const selectedPackageIds = normalizePackageIdList(options.packageIds || options.packageId || []);

  const summary = {
    startedAt,
    finishedAt: '',
    backendMode: backendMode || '',
    packageRootDir,
    enabledCount: 0,
    loadedCount: 0,
    failedCount: 0,
    loaded: [],
    failed: [],
    localDevMode,
    localModeRequested: modeState.requested === true,
    localModeProductionLocked: modeState.productionLocked === true,
    localModeEnvHints: Array.isArray(modeState.localEnvKeys) ? modeState.localEnvKeys : [],
    source: localDevMode ? 'local-cache' : 'registry',
    localRegistryFilePath: '',
    localRegistryCacheExists: false,
    selectedPackageIds,
    manifestRetry: {
      retryMs: manifestRetrySettings.retryMs,
      retryIntervalMs: manifestRetrySettings.retryIntervalMs
    }
  };

  if (modeState.production && modeState.localOnlyVarsPresent && logger && typeof logger.warn === 'function') {
    logger.warn(
      'PACKAGE_LOADER',
      'LOCAL_MODE_IGNORED_IN_PRODUCTION',
      'Local package sync env vars are present but ignored in production; using registry mode.',
      { localEnvKeys: modeState.localEnvKeys.join(',') }
    );
  }

  let enabledRows = [];
  if (localDevMode) {
    const cache = await localPackageSyncService.readLocalPackageRegistryCache();
    summary.localRegistryFilePath = cleanText(cache?.filePath, 2000);
    summary.localRegistryCacheExists = await fileExists(summary.localRegistryFilePath);
    enabledRows = summarizeLocalCacheRows(cache?.packages || []);
    if (!summary.localRegistryCacheExists && logger && typeof logger.warn === 'function') {
      logger.warn('PACKAGE_LOADER', 'LOCAL_CACHE_MISSING', 'Local package cache is missing; skipping dynamic package load.', {
        localRegistryFilePath: summary.localRegistryFilePath
      });
    } else if (!enabledRows.length && logger && typeof logger.warn === 'function') {
      logger.warn('PACKAGE_LOADER', 'LOCAL_CACHE_EMPTY', 'Local package cache has no enabled packages; skipping dynamic package load.', {
        localRegistryFilePath: summary.localRegistryFilePath
      });
    }
  } else {
    const registryRows = await packageRegistryService.listPackageRegistry({
      backendMode
    });
    enabledRows = summarizeRegistryRows(registryRows);
  }

  if (selectedPackageIds.length) {
    enabledRows = enabledRows.filter((row) => selectedPackageIds.includes(normalizePackageId(row?.packageId || row?.id || '')));
  }

  summary.enabledCount = enabledRows.length;

  const loadedIds = new Set();
  for (const row of enabledRows) {
    const packageId = normalizePackageId(row?.packageId || row?.id || '');
    const baseMeta = {
      packageId: packageId || '',
      registryId: cleanText(row?.id, 120),
      installStatus: cleanText(row?.installStatus, 80)
    };

    try {
      packageManifestService.assertValidPackageId(packageId, 'packageId');
      const manifestPath = await resolveManifestPathWithRetry(
        packageId,
        row,
        packageRootDir,
        manifestRetrySettings
      );
      if (!manifestPath) {
        const missingManifestError = new Error('No manifest file found for this enabled package.');
        missingManifestError.code = 'PACKAGE_MANIFEST_NOT_FOUND';
        throw missingManifestError;
      }

      const rawManifest = await readManifestFile(manifestPath);
      const manifest = packageManifestService.validatePackageManifest(rawManifest, {
        knownIds: [...loadedIds]
      });
      if (manifest.id !== packageId) {
        throw new Error(`Manifest id "${manifest.id}" does not match registry packageId "${packageId}".`);
      }

      await runLoaderHooks(hooks, {
        app: options.app || null,
        packageRuntimeRouter: options.packageRuntimeRouter || options.app?.locals?.packageRuntimeRouter || null,
        backendMode,
        packageId,
        manifest,
        manifestPath,
        packageRootDir,
        registryRow: row
      });

      loadedIds.add(manifest.id);
      summary.loaded.push({
        packageId: manifest.id,
        name: manifest.name,
        version: manifest.version,
        mountPath: manifest.mountPath,
        manifestPath
      });
      if (
        !localDevMode
        && (
          row?.enabled !== true
          || cleanText(row?.installStatus, 80).toLowerCase() !== 'enabled'
          || Boolean(cleanText(row?.lastWarning, 10))
          || Boolean(cleanText(row?.lastError, 10))
        )
      ) {
        await packageRegistryService.upsertPackageRegistry({
          packageId: manifest.id,
          enabled: true,
          installStatus: 'enabled',
          lastWarning: '',
          lastError: ''
        }, {
          backendMode,
          actor: { id: 'SYSTEM', username: 'SYSTEM' }
        }).catch(() => null);
      }
      if (logger && typeof logger.success === 'function') {
        logger.success('PACKAGE_LOADER', 'LOAD_OK', `Loaded package ${manifest.id}.`, {
          mountPath: manifest.mountPath,
          manifestPath
        });
      }
    } catch (error) {
      const reason = cleanText(error?.message || String(error), 4000) || 'Unknown package load error.';
      const isMissingManifest = cleanText(error?.code, 80) === 'PACKAGE_MANIFEST_NOT_FOUND';
      const failure = {
        packageId,
        message: reason,
        autoDisabled: false,
        code: cleanText(error?.code, 120).toUpperCase(),
        missingManifest: isMissingManifest
      };
      summary.failed.push(failure);
      if (logger && typeof logger.warn === 'function') {
        logger.warn('PACKAGE_LOADER', 'LOAD_FAIL', `Skipped package ${packageId || '(unknown)'}.`, {
          ...baseMeta,
          reason,
          missingManifest: isMissingManifest
        });
      }
      if (!continueOnError) {
        throw error;
      }
    }
  }

  summary.loadedCount = summary.loaded.length;
  summary.failedCount = summary.failed.length;
  summary.finishedAt = new Date().toISOString();

  if (logger && typeof logger.info === 'function') {
    logger.info('PACKAGE_LOADER', 'SUMMARY', 'Package loader finished.', {
      enabled: summary.enabledCount,
      loaded: summary.loadedCount,
      failed: summary.failedCount
    });
  }

  return summary;
}

module.exports = {
  DEFAULT_MANIFEST_FILES,
  createLoaderHooks,
  resolveManifestCandidates,
  resolveManifestPath,
  readManifestFile,
  loadEnabledPackages
};
