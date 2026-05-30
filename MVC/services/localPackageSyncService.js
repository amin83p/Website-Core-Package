const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const tar = require('tar');

const packageManifestService = require('./packageManifestService');
const fileGatewayClientService = require('./fileGatewayClientService');

const LOCAL_PACKAGE_REGISTRY_FILE = path.resolve(process.cwd(), '.local-runtime', 'package-sync', 'localPackageRegistry.json');
const DEFAULT_TARGET_ROOT = path.resolve(process.cwd(), 'packages');
const LOCAL_ONLY_ENV_KEYS = Object.freeze([
  'PACKAGE_LOCAL_DEV_MODE',
  'PACKAGE_RUNTIME_MOUNT_PATH_LOCAL',
  'PACKAGE_LOCAL_TARGET_ROOT',
  'PACKAGE_LOCAL_REGISTRY_FILE'
]);

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function isTrue(value) {
  const token = cleanText(value, 40).toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

function isProductionEnvironment(env = process.env) {
  const token = cleanText(env?.NODE_ENV, 40).toLowerCase();
  return token === 'production';
}

function collectLocalPackageEnvHints(env = process.env) {
  const keys = [];
  LOCAL_ONLY_ENV_KEYS.forEach((key) => {
    if (cleanText(env?.[key], 2000)) {
      keys.push(key);
    }
  });
  return keys;
}

function resolveLocalPackageMode(env = process.env) {
  const requested = isTrue(env?.PACKAGE_LOCAL_DEV_MODE);
  const production = isProductionEnvironment(env);
  const localEnvKeys = collectLocalPackageEnvHints(env);
  const localOnlyVarsPresent = localEnvKeys.length > 0;
  const productionLocked = production === true;
  const enabled = requested && !productionLocked;
  return {
    requested,
    enabled,
    production,
    productionLocked,
    localOnlyVarsPresent,
    localEnvKeys
  };
}

function isLocalPackageDevModeEnabled(env = process.env) {
  return resolveLocalPackageMode(env).enabled;
}

function normalizePackageId(value = '') {
  return cleanText(value, 120).toLowerCase();
}

function normalizeAbsolutePath(value = '', fallback = '') {
  const token = cleanText(value, 2000);
  if (token) return path.resolve(token);
  return fallback ? path.resolve(fallback) : '';
}

function isPathInside(basePath = '', candidatePath = '') {
  const base = path.resolve(String(basePath || ''));
  const candidate = path.resolve(String(candidatePath || ''));
  const rel = path.relative(base, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function toStoredPath(absolutePath = '') {
  const token = cleanText(absolutePath, 2500);
  if (!token) return '';
  if (/^[A-Za-z]+:\/\//.test(token) || token.startsWith('/app/')) {
    return token;
  }
  const projectRoot = path.resolve(process.cwd());
  const resolved = path.resolve(token);
  const rel = path.relative(projectRoot, resolved);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel.replace(/\\/g, '/');
  }
  return resolved.replace(/\\/g, '/');
}

function buildError(code, message, details = null) {
  const error = new Error(message || 'Local package sync operation failed.');
  error.code = cleanText(code, 120) || 'LOCAL_PACKAGE_SYNC_ERROR';
  if (details && typeof details === 'object') {
    error.details = details;
  }
  return error;
}

function resolveLocalSyncPaths(options = {}, env = process.env) {
  const sourceRoot = cleanText(options.sourceRoot || env.PACKAGE_RUNTIME_MOUNT_PATH_LOCAL || '', 2000);
  const targetRoot = normalizeAbsolutePath(
    options.targetRoot || env.PACKAGE_LOCAL_TARGET_ROOT || '',
    DEFAULT_TARGET_ROOT
  );
  return {
    sourceRoot,
    targetRoot
  };
}

function resolveRegistryCachePath(options = {}, env = process.env) {
  const envPath = cleanText(env.PACKAGE_LOCAL_REGISTRY_FILE, 2000);
  const inputPath = cleanText(options.registryFilePath, 2000);
  const selected = inputPath || envPath;
  if (selected) return path.resolve(selected);
  return LOCAL_PACKAGE_REGISTRY_FILE;
}

function normalizeCachePackageRow(row = {}) {
  if (!row || typeof row !== 'object') return null;
  const packageId = normalizePackageId(row.packageId || row.id || '');
  if (!packageId) return null;
  return {
    packageId,
    name: cleanText(row.name, 200) || packageId.toUpperCase(),
    version: cleanText(row.version, 120),
    mountPath: cleanText(row.mountPath, 500),
    manifestPath: cleanText(row.manifestPath, 2000),
    enabled: row.enabled !== false,
    syncedAt: cleanText(row.syncedAt, 120),
    sourcePath: cleanText(row.sourcePath, 2000),
    targetPath: cleanText(row.targetPath, 2000)
  };
}

function normalizeRuntimePackageRow(row = {}) {
  const packageId = normalizePackageId(row.packageId || row.id || '');
  return {
    folderName: cleanText(row.folderName, 200),
    packageDir: cleanText(row.packageDir, 2000),
    packageId,
    name: cleanText(row.name, 200),
    version: cleanText(row.version, 120),
    mountPath: cleanText(row.mountPath, 500),
    manifestPath: cleanText(row.manifestPath, 2000),
    valid: row.valid === true,
    reason: cleanText(row.reason, 2000)
  };
}

function normalizeArchivePath(entryPath = '') {
  const token = String(entryPath || '').replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
  if (!token) throw new Error('Archive contains an empty path.');
  if (path.posix.isAbsolute(token) || /^[A-Za-z]:/.test(token)) {
    throw new Error(`Archive contains an absolute path: ${token}`);
  }
  const parts = token.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) {
    throw new Error(`Archive contains unsafe path: ${token}`);
  }
  return parts.join('/');
}

function assertArchivePathInsidePackage(entryPath = '', packageId = '') {
  const normalized = normalizeArchivePath(entryPath);
  const expectedTop = normalizePackageId(packageId);
  if (!expectedTop) throw new Error('Package id is required for archive extraction.');
  if (normalized !== expectedTop && !normalized.startsWith(`${expectedTop}/`)) {
    throw new Error(`Archive path is outside package root "${expectedTop}": ${normalized}`);
  }
  return true;
}

function assertArchiveEntrySafe(entry = null, packageId = '') {
  const safeEntry = entry && typeof entry === 'object' ? entry : {};
  assertArchivePathInsidePackage(safeEntry.path || '', packageId);
  const entryType = cleanText(safeEntry.type, 80).toLowerCase();
  if (entryType === 'symboliclink' || entryType === 'link') {
    throw new Error(`Archive contains unsupported link entry at "${safeEntry.path || ''}".`);
  }
  return true;
}

async function resolveManifestPathForDirectory(packageDir = '') {
  const first = path.join(packageDir, 'package.manifest.json');
  try {
    await fs.access(first);
    return first;
  } catch (_) {
    const second = path.join(packageDir, 'manifest.json');
    await fs.access(second);
    return second;
  }
}

async function readPackageManifest(manifestPath = '', knownIds = []) {
  const raw = await fs.readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(String(raw || '').replace(/^\uFEFF/, '').trim() || '{}');
  return packageManifestService.validatePackageManifest(parsed, {
    knownIds: Array.isArray(knownIds) ? knownIds : []
  });
}

function normalizeSelectedPackageIds(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => normalizePackageId(item)).filter(Boolean)));
  }
  const token = normalizePackageId(value);
  return token ? [token] : [];
}

async function copyDirectory(sourceDir = '', targetDir = '') {
  if (typeof fs.cp === 'function') {
    await fs.cp(sourceDir, targetDir, { recursive: true, force: true, errorOnExist: false });
    return;
  }
  const stat = await fs.stat(sourceDir);
  if (!stat.isDirectory()) {
    throw new Error(`Source is not a directory: ${sourceDir}`);
  }
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      await copyDirectory(sourcePath, targetPath);
    } else {
      // eslint-disable-next-line no-await-in-loop
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function readLocalPackageRegistryCache(options = {}) {
  const filePath = resolveRegistryCachePath(options);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(String(raw || '').replace(/^\uFEFF/, '').trim() || '{}');
    const rows = Array.isArray(parsed.packages) ? parsed.packages : [];
    return {
      filePath,
      version: Number.parseInt(String(parsed.version || '1'), 10) || 1,
      generatedAt: cleanText(parsed.generatedAt, 120),
      sourceRoot: cleanText(parsed.sourceRoot, 2000),
      targetRoot: cleanText(parsed.targetRoot, 2000),
      packages: rows.map((row) => normalizeCachePackageRow(row)).filter(Boolean)
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        filePath,
        version: 1,
        generatedAt: '',
        sourceRoot: '',
        targetRoot: '',
        packages: []
      };
    }
    throw buildError(
      'LOCAL_PACKAGE_CACHE_READ_FAILED',
      `Unable to read local package cache file: ${filePath}`,
      { filePath, message: error?.message || String(error) }
    );
  }
}

async function writeLocalPackageRegistryCache(payload = {}, options = {}) {
  const filePath = resolveRegistryCachePath(options);
  const dirPath = path.dirname(filePath);
  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
}

async function scanMountedPackageSource(options = {}) {
  const localModeEnabled = isLocalPackageDevModeEnabled(options.env || process.env);
  const { sourceRoot, targetRoot } = resolveLocalSyncPaths(options, options.env || process.env);
  await fs.mkdir(targetRoot, { recursive: true });

  let payload = null;
  try {
    payload = await fileGatewayClientService.gatewayListRuntimePackages();
  } catch (error) {
    throw buildError(
      'LOCAL_PACKAGE_RUNTIME_GATEWAY_SCAN_FAILED',
      cleanText(error?.message || 'Unable to list runtime packages via gateway.', 1200),
      { source: 'gateway' }
    );
  }

  const rows = Array.isArray(payload?.packages)
    ? payload.packages.map((row) => normalizeRuntimePackageRow(row))
    : [];
  const validRows = rows.filter((row) => row.valid === true);

  return {
    localModeEnabled,
    sourceRoot,
    targetRoot: path.resolve(targetRoot),
    scannedAt: new Date().toISOString(),
    runtimeSource: 'gateway',
    runtime: payload?.runtime || {},
    packageCount: rows.length,
    validCount: validRows.length,
    invalidCount: rows.length - validRows.length,
    packages: rows
  };
}

async function extractRuntimePackageArchive({ packageId = '', archiveBuffer = null } = {}) {
  const normalizedPackageId = normalizePackageId(packageId);
  if (!normalizedPackageId) throw new Error('Package id is required.');
  if (!Buffer.isBuffer(archiveBuffer) || archiveBuffer.length <= 0) {
    throw new Error(`Downloaded archive for "${normalizedPackageId}" is empty.`);
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'local-package-sync-'));
  const archivePath = path.join(tempRoot, `${normalizedPackageId}.tar.gz`);
  await fs.writeFile(archivePath, archiveBuffer);

  const entryErrors = [];
  await tar.t({
    file: archivePath,
    strict: true,
    onentry: (entry) => {
      try {
        assertArchiveEntrySafe(entry, normalizedPackageId);
      } catch (error) {
        entryErrors.push(cleanText(error?.message || 'Invalid archive entry.', 1200));
      }
    }
  });
  if (entryErrors.length > 0) {
    throw new Error(entryErrors[0]);
  }

  await tar.x({
    file: archivePath,
    cwd: tempRoot,
    strict: true
  });

  const packageDir = path.resolve(path.join(tempRoot, normalizedPackageId));
  if (!isPathInside(tempRoot, packageDir)) {
    throw new Error(`Extracted package path is outside temp directory for "${normalizedPackageId}".`);
  }
  const stat = await fs.stat(packageDir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Extracted archive for "${normalizedPackageId}" is missing package root folder.`);
  }

  return {
    tempRoot,
    packageDir
  };
}

async function updateLocalCacheWithSyncedRows({ sourceRoot = '', targetRoot = '', syncedRows = [] } = {}, options = {}) {
  const current = await readLocalPackageRegistryCache(options);
  const byId = new Map();
  current.packages.forEach((row) => {
    if (!row?.packageId) return;
    byId.set(row.packageId, row);
  });

  syncedRows.forEach((row) => {
    if (!row?.packageId) return;
    const existing = byId.get(row.packageId);
    byId.set(row.packageId, {
      packageId: row.packageId,
      name: cleanText(row.name, 200) || row.packageId.toUpperCase(),
      version: cleanText(row.version, 120),
      mountPath: cleanText(row.mountPath, 500),
      manifestPath: cleanText(row.manifestPath, 2000),
      enabled: typeof existing?.enabled === 'boolean' ? existing.enabled : true,
      syncedAt: cleanText(row.syncedAt, 120) || new Date().toISOString(),
      sourcePath: cleanText(row.sourcePath, 2000),
      targetPath: cleanText(row.targetPath, 2000)
    });
  });

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceRoot: toStoredPath(sourceRoot),
    targetRoot: toStoredPath(targetRoot),
    packages: Array.from(byId.values()).sort((a, b) => a.packageId.localeCompare(b.packageId))
  };
  const filePath = await writeLocalPackageRegistryCache(payload, options);
  return {
    filePath,
    packageCount: payload.packages.length,
    generatedAt: payload.generatedAt
  };
}

async function syncMountedPackages(options = {}) {
  const syncAll = isTrue(options.syncAll);
  const scanReport = await scanMountedPackageSource(options);
  const validRows = scanReport.packages.filter((row) => row.valid === true);

  const requestedIds = normalizeSelectedPackageIds(options.selectedPackageIds || options.packageIds || []);
  const selectedRows = syncAll
    ? (requestedIds.length ? validRows.filter((row) => requestedIds.includes(row.packageId)) : validRows)
    : validRows.filter((row) => requestedIds.includes(row.packageId));

  if (!selectedRows.length) {
    throw buildError(
      'LOCAL_PACKAGE_SYNC_SELECTION_REQUIRED',
      syncAll
        ? 'No valid runtime packages are available to sync.'
        : 'Select at least one valid package to sync locally.'
    );
  }

  const targetRoot = path.resolve(scanReport.targetRoot);
  await fs.mkdir(targetRoot, { recursive: true });

  const syncedRows = [];
  const failures = [];

  for (const row of selectedRows) {
    const packageId = normalizePackageId(row.packageId);
    const targetDir = path.resolve(path.join(targetRoot, packageId));

    if (!isPathInside(targetRoot, targetDir)) {
      failures.push({
        packageId,
        message: `Rejected target path outside local package root: ${targetDir}`
      });
      continue;
    }

    let extracted = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      const download = await fileGatewayClientService.gatewayDownloadRuntimePackage(packageId);
      // eslint-disable-next-line no-await-in-loop
      extracted = await extractRuntimePackageArchive({
        packageId,
        archiveBuffer: download?.buffer
      });

      // Clear only the selected package target directory.
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(targetDir, { recursive: true, force: true });
      // eslint-disable-next-line no-await-in-loop
      await copyDirectory(extracted.packageDir, targetDir);
      // eslint-disable-next-line no-await-in-loop
      const targetManifestPath = await resolveManifestPathForDirectory(targetDir);
      // eslint-disable-next-line no-await-in-loop
      const copiedManifest = await readPackageManifest(targetManifestPath, []);
      const copiedId = normalizePackageId(copiedManifest.id);
      if (copiedId !== packageId) {
        throw buildError(
          'LOCAL_PACKAGE_SYNC_MANIFEST_MISMATCH',
          `Copied package id "${copiedId}" does not match expected id "${packageId}".`
        );
      }
      syncedRows.push({
        packageId,
        name: cleanText(copiedManifest.name, 200) || packageId.toUpperCase(),
        version: cleanText(copiedManifest.version, 120),
        mountPath: cleanText(copiedManifest.mountPath, 500),
        manifestPath: toStoredPath(targetManifestPath),
        sourcePath: cleanText(row.packageDir, 2000) || `railway-runtime:${packageId}`,
        targetPath: toStoredPath(targetDir),
        syncedAt: new Date().toISOString()
      });
    } catch (error) {
      failures.push({
        packageId,
        message: cleanText(error?.message || 'Unknown sync error.', 1200)
      });
    } finally {
      if (extracted?.tempRoot) {
        // eslint-disable-next-line no-await-in-loop
        await fs.rm(extracted.tempRoot, { recursive: true, force: true }).catch(() => null);
      }
    }
  }

  if (!syncedRows.length) {
    throw buildError(
      'LOCAL_PACKAGE_SYNC_FAILED',
      'No packages were synced. Review failure details.',
      { failures }
    );
  }

  const cache = await updateLocalCacheWithSyncedRows({
    sourceRoot: cleanText(scanReport?.runtime?.packageRootDir || scanReport?.sourceRoot || 'railway-runtime-gateway', 2000),
    targetRoot,
    syncedRows
  }, options);

  return {
    status: failures.length ? 'partial' : 'success',
    syncedCount: syncedRows.length,
    failedCount: failures.length,
    syncAll,
    sourceRoot: cleanText(scanReport?.runtime?.packageRootDir || scanReport?.sourceRoot || 'railway-runtime-gateway', 2000),
    targetRoot,
    runtimeSource: 'gateway',
    syncedPackages: syncedRows,
    failures,
    cache
  };
}

module.exports = {
  LOCAL_PACKAGE_REGISTRY_FILE,
  DEFAULT_TARGET_ROOT,
  LOCAL_ONLY_ENV_KEYS,
  isProductionEnvironment,
  resolveLocalPackageMode,
  collectLocalPackageEnvHints,
  isLocalPackageDevModeEnabled,
  resolveLocalSyncPaths,
  readLocalPackageRegistryCache,
  scanMountedPackageSource,
  syncMountedPackages
};
