const fs = require('fs').promises;
const path = require('path');

const startupLogger = require('../utils/startupLogger');
const packageRegistryService = require('./packageRegistryService');
const packageManifestService = require('./packageManifestService');

const DEFAULT_MANIFEST_FILES = Object.freeze([
  'package.manifest.json',
  'manifest.json'
]);

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
  await hooks.registerRoutes(context);
  await hooks.registerViews(context);
  await hooks.registerAssets(context);
  await hooks.registerRegistryData(context);
  await hooks.registerUploadFolders(context);
  await hooks.registerQueryExecutors(context);
}

function summarizeRegistryRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((row) => row && row.enabled === true);
}

async function loadEnabledPackages(options = {}) {
  const startedAt = new Date().toISOString();
  const backendMode = cleanText(options.backendMode, 30) || undefined;
  const packageRootDir = path.resolve(
    String(options.packageRootDir || path.join(resolveProjectRoot(), 'packages'))
  );
  const hooks = createLoaderHooks(options.hooks || {});
  const logger = options.logger || startupLogger;
  const continueOnError = options.continueOnError !== false;

  const summary = {
    startedAt,
    finishedAt: '',
    backendMode: backendMode || '',
    packageRootDir,
    enabledCount: 0,
    loadedCount: 0,
    failedCount: 0,
    loaded: [],
    failed: []
  };

  const registryRows = await packageRegistryService.listPackageRegistry({
    backendMode
  });
  const enabledRows = summarizeRegistryRows(registryRows);
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
      const manifestPath = await resolveManifestPath(packageId, row, packageRootDir);
      if (!manifestPath) {
        throw new Error('No manifest file found for this enabled package.');
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
      if (logger && typeof logger.success === 'function') {
        logger.success('PACKAGE_LOADER', 'LOAD_OK', `Loaded package ${manifest.id}.`, {
          mountPath: manifest.mountPath,
          manifestPath
        });
      }
    } catch (error) {
      const reason = cleanText(error?.message || String(error), 4000) || 'Unknown package load error.';
      const failure = {
        packageId,
        message: reason
      };
      summary.failed.push(failure);
      if (logger && typeof logger.warn === 'function') {
        logger.warn('PACKAGE_LOADER', 'LOAD_FAIL', `Skipped package ${packageId || '(unknown)'}.`, {
          ...baseMeta,
          reason
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
