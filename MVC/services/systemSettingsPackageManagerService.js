const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const PizZip = require('pizzip');

const packageManifestService = require('./packageManifestService');
const packageRegistryService = require('./packageRegistryService');
const packageRegistryInstallerService = require('./packageRegistryInstallerService');
const packageLoaderService = require('./packageLoaderService');
const packageNavigationService = require('./packageNavigationService');

const SYSTEM_ACTOR_ID = 'SYSTEM_SETTINGS_PACKAGE_MANAGER';

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizePackageId(value = '') {
  return cleanText(value, 120).toLowerCase();
}

function resolveProjectRoot() {
  return path.resolve(__dirname, '../../');
}

function normalizeInstallMethod(value = '') {
  const token = cleanText(value, 40).toLowerCase();
  if (!token) return '';
  if (token === 'local') return 'local';
  if (token === 'path') return 'path';
  if (token === 'json') return 'json';
  return '';
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getZipInstallLimits(env = process.env) {
  const maxUploadMb = readPositiveInt(env.PACKAGE_ZIP_INSTALL_MAX_UPLOAD_MB, 50);
  const maxExtractedMb = readPositiveInt(env.PACKAGE_ZIP_INSTALL_MAX_EXTRACTED_MB, 250);
  const maxFiles = readPositiveInt(env.PACKAGE_ZIP_INSTALL_MAX_FILES, 5000);
  return {
    maxUploadBytes: maxUploadMb * 1024 * 1024,
    maxExtractedBytes: maxExtractedMb * 1024 * 1024,
    maxFiles
  };
}

function parseKeyCandidates(value = '') {
  const token = String(value || '').trim();
  if (!token) return [];
  return token
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadTrustedPublicKeys(options = {}) {
  if (Array.isArray(options.trustedPublicKeys) && options.trustedPublicKeys.length) {
    return options.trustedPublicKeys.map((item) => String(item || '').trim()).filter(Boolean);
  }
  const envList = [
    ...parseKeyCandidates(process.env.PACKAGE_INSTALL_ED25519_PUBLIC_KEYS || ''),
    ...parseKeyCandidates(process.env.PACKAGE_INSTALL_ED25519_PUBLIC_KEY || '')
  ];
  return envList;
}

function parsePublicKey(input = '') {
  const token = String(input || '').trim();
  if (!token) throw new Error('Trusted public key is empty.');
  if (token.includes('BEGIN PUBLIC KEY')) {
    return crypto.createPublicKey({ key: token, format: 'pem' });
  }
  const der = Buffer.from(token.replace(/\s+/g, ''), 'base64');
  if (!der.length) throw new Error('Trusted public key is invalid.');
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function parseDetachedSignatureBuffer(rawBuffer = Buffer.alloc(0)) {
  if (!Buffer.isBuffer(rawBuffer) || !rawBuffer.length) {
    throw new Error('Signature file is empty.');
  }
  const text = rawBuffer.toString('utf8').trim();
  const compact = text.replace(/\s+/g, '');
  if (compact && /^[A-Za-z0-9+/=]+$/.test(compact) && compact.length % 4 === 0) {
    try {
      const decoded = Buffer.from(compact, 'base64');
      if (decoded.length) return decoded;
    } catch (_) {
      // fallback to raw buffer
    }
  }
  return rawBuffer;
}

function normalizeZipEntryPath(entryName = '') {
  const token = String(entryName || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!token) return '';
  const parts = token.split('/').filter(Boolean);
  if (!parts.length) return '';
  for (const part of parts) {
    if (part === '.' || part === '..') {
      throw new Error(`ZIP entry contains unsafe path token: ${entryName}`);
    }
  }
  return parts.join('/');
}

function parseSemver(version = '') {
  const token = cleanText(version, 120);
  const [coreAndPre] = token.split('+');
  const [core, prereleaseRaw = ''] = String(coreAndPre || '').split('-');
  const coreParts = core.split('.').map((item) => Number.parseInt(item, 10));
  const prerelease = prereleaseRaw ? prereleaseRaw.split('.') : [];
  return { coreParts, prerelease };
}

function compareSemver(a = '', b = '') {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (let index = 0; index < 3; index += 1) {
    const l = Number.isFinite(left.coreParts[index]) ? left.coreParts[index] : 0;
    const r = Number.isFinite(right.coreParts[index]) ? right.coreParts[index] : 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }

  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;

  const max = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < max; index += 1) {
    const l = left.prerelease[index];
    const r = right.prerelease[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const lNumeric = /^\d+$/.test(l);
    const rNumeric = /^\d+$/.test(r);
    if (lNumeric && rNumeric) {
      const lNum = Number.parseInt(l, 10);
      const rNum = Number.parseInt(r, 10);
      if (lNum > rNum) return 1;
      if (lNum < rNum) return -1;
      continue;
    }
    if (lNumeric && !rNumeric) return -1;
    if (!lNumeric && rNumeric) return 1;
    if (l > r) return 1;
    if (l < r) return -1;
  }

  return 0;
}

async function pathExists(localFs, filePath = '') {
  try {
    await localFs.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

function countDeclarations(manifest = {}) {
  const countObjectDeclaration = (value) => (
    value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length
      ? 1
      : 0
  );
  return {
    routes: Array.isArray(manifest.routes) ? manifest.routes.length : 0,
    views: countObjectDeclaration(manifest.views),
    assets: countObjectDeclaration(manifest.assets),
    operations: Array.isArray(manifest.operations) ? manifest.operations.length : 0,
    roles: Array.isArray(manifest.roles) ? manifest.roles.length : 0,
    sections: Array.isArray(manifest.sections) ? manifest.sections.length : 0,
    symbols: Array.isArray(manifest.symbols) ? manifest.symbols.length : 0,
    accesses: Array.isArray(manifest.accesses) ? manifest.accesses.length : 0,
    uploadFolders: Array.isArray(manifest.uploadFolders) ? manifest.uploadFolders.length : 0,
    menuEntries: Array.isArray(manifest.menuEntries) ? manifest.menuEntries.length : 0,
    dashboardEntries: Array.isArray(manifest.dashboardEntries) ? manifest.dashboardEntries.length : 0,
    queryExecutors: Array.isArray(manifest.queryExecutors) ? manifest.queryExecutors.length : 0
  };
}

function toStoredManifestPath(absPath = '') {
  const token = cleanText(absPath, 1600);
  if (!token) return '';
  const projectRoot = resolveProjectRoot();
  const resolved = path.resolve(token);
  const rel = path.relative(projectRoot, resolved);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel.replace(/\\/g, '/');
  }
  return resolved.replace(/\\/g, '/');
}

function buildActor(actor = null) {
  if (actor && typeof actor === 'object') {
    return {
      id: cleanText(actor.id || actor.username || actor.email || '', 160) || SYSTEM_ACTOR_ID,
      username: cleanText(actor.username || actor.email || actor.id || '', 200) || SYSTEM_ACTOR_ID
    };
  }
  return {
    id: SYSTEM_ACTOR_ID,
    username: SYSTEM_ACTOR_ID
  };
}

function createDependencies(overrides = {}) {
  return {
    fs: overrides.fs || fs,
    path: overrides.path || path,
    packageManifestService: overrides.packageManifestService || packageManifestService,
    packageRegistryService: overrides.packageRegistryService || packageRegistryService,
    packageRegistryInstallerService: overrides.packageRegistryInstallerService || packageRegistryInstallerService,
    packageLoaderService: overrides.packageLoaderService || packageLoaderService,
    packageNavigationService: overrides.packageNavigationService || packageNavigationService
  };
}

function createService(overrides = {}) {
  const deps = createDependencies(overrides);
  const zipLimits = getZipInstallLimits(overrides.env || process.env);

  async function fileExists(filePath = '') {
    try {
      await deps.fs.access(filePath);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function verifyZipSignature(zipBuffer = Buffer.alloc(0), signatureBuffer = Buffer.alloc(0), options = {}) {
    if (!Buffer.isBuffer(zipBuffer) || !zipBuffer.length) {
      throw new Error('Package ZIP file is required.');
    }
    if (!Buffer.isBuffer(signatureBuffer) || !signatureBuffer.length) {
      throw new Error('Package signature file is required.');
    }

    const trustedKeys = loadTrustedPublicKeys(options);
    if (!trustedKeys.length) {
      const error = new Error('No trusted package public key is configured for ZIP install verification.');
      error.code = 'ZIP_SIGNATURE_NOT_CONFIGURED';
      throw error;
    }

    const signature = parseDetachedSignatureBuffer(signatureBuffer);
    for (const keyText of trustedKeys) {
      try {
        const keyObject = parsePublicKey(keyText);
        if (crypto.verify(null, zipBuffer, keyObject, signature)) {
          return { verified: true };
        }
      } catch (_) {
        // Continue to next key and report generic failure below.
      }
    }

    const error = new Error('Package signature verification failed.');
    error.code = 'ZIP_SIGNATURE_INVALID';
    throw error;
  }

  function inspectZipArchive(zipBuffer = Buffer.alloc(0)) {
    let zip;
    try {
      zip = new PizZip(zipBuffer);
    } catch (error) {
      const wrapped = new Error(`ZIP archive is invalid: ${error.message}`);
      wrapped.code = 'ZIP_INVALID';
      throw wrapped;
    }
    const entries = Object.entries(zip.files || {});
    if (!entries.length) {
      throw new Error('ZIP archive is empty.');
    }

    const topLevelFolders = new Set();
    const fileEntries = [];
    for (const [entryName, entry] of entries) {
      const safeName = normalizeZipEntryPath(entryName);
      if (!safeName) continue;
      const parts = safeName.split('/');
      if (!parts.length) continue;
      topLevelFolders.add(parts[0]);
      if (entry?.dir) continue;
      fileEntries.push({ safeName, entry });
    }

    if (topLevelFolders.size !== 1) {
      throw new Error('ZIP must contain exactly one top-level package folder.');
    }
    const [topFolder] = [...topLevelFolders];
    const manifestEntryPath = `${topFolder}/package.manifest.json`;
    const hasManifest = fileEntries.some((row) => row.safeName === manifestEntryPath);
    if (!hasManifest) {
      throw new Error('ZIP package manifest not found at <package-folder>/package.manifest.json.');
    }

    return {
      topFolder,
      fileEntries,
      manifestEntryPath
    };
  }

  async function extractZipToStaging(zipBuffer = Buffer.alloc(0), stagingDir = '') {
    const archive = inspectZipArchive(zipBuffer);
    const fileEntries = archive.fileEntries || [];
    if (fileEntries.length > zipLimits.maxFiles) {
      throw new Error(`ZIP contains too many files. Maximum allowed is ${zipLimits.maxFiles}.`);
    }

    let extractedBytes = 0;
    for (const row of fileEntries) {
      const relativeName = row.safeName;
      const outputPath = path.join(stagingDir, relativeName);
      const outputRelative = path.relative(stagingDir, outputPath);
      if (!outputRelative || outputRelative.startsWith('..') || path.isAbsolute(outputRelative)) {
        throw new Error(`ZIP entry is outside extraction boundary: ${relativeName}`);
      }
      const parentDir = path.dirname(outputPath);
      await deps.fs.mkdir(parentDir, { recursive: true });
      const payload = row.entry.asNodeBuffer();
      extractedBytes += payload.length;
      if (extractedBytes > zipLimits.maxExtractedBytes) {
        throw new Error('ZIP extracted content exceeds configured maximum size.');
      }
      await deps.fs.writeFile(outputPath, payload);
    }

    return {
      topFolder: archive.topFolder,
      manifestPath: path.join(stagingDir, archive.manifestEntryPath),
      extractedFileCount: fileEntries.length,
      extractedBytes
    };
  }

  async function replacePackageDirectory(sourcePackageDir = '', packageId = '', options = {}) {
    const packageRootDir = path.resolve(String(options.packageRootDir || path.join(resolveProjectRoot(), 'packages')));
    const destinationDir = path.join(packageRootDir, packageId);
    const backupDir = path.join(packageRootDir, `.${packageId}.backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    let hadExistingDestination = false;

    await deps.fs.mkdir(packageRootDir, { recursive: true });
    if (await pathExists(deps.fs, destinationDir)) {
      hadExistingDestination = true;
      await deps.fs.rename(destinationDir, backupDir);
    }

    try {
      await deps.fs.rename(sourcePackageDir, destinationDir);
    } catch (error) {
      if (hadExistingDestination && await pathExists(deps.fs, backupDir)) {
        await deps.fs.rename(backupDir, destinationDir).catch(() => {});
      }
      throw error;
    }

    if (hadExistingDestination && await pathExists(deps.fs, backupDir)) {
      await deps.fs.rm(backupDir, { recursive: true, force: true });
    }
    return destinationDir;
  }

  async function installResolvedManifest(resolved = {}, options = {}) {
    const actor = buildActor(options.actor || null);
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const manifest = resolved.manifest;
    const context = {
      backendMode,
      packageId: manifest.id,
      packageName: manifest.name,
      manifest,
      manifestPath: resolved.manifestPath
    };

    const payload = buildRegistryPayload(manifest, {
      mode: 'enable',
      manifestPath: resolved.manifestPath,
      activationMode: resolved.activationMode,
      packageSource: resolved.packageSource || ''
    });
    const result = await deps.packageRegistryService.upsertPackageRegistry(payload, {
      backendMode,
      actor
    });
    const declarationSummary = await deps.packageRegistryInstallerService.installPackageRegistryDeclarations(context, {
      backendMode
    });
    const runtime = await applyRuntimeEnableHooks(context, {
      backendMode,
      app: options.app || null
    });
    const navigation = await refreshNavigationSnapshot({ backendMode });

    const warnings = [];
    warnings.push(...runtime.warnings);
    if (navigation.warning) warnings.push(navigation.warning);

    return {
      action: resolved.action || 'install',
      packageId: manifest.id,
      packageName: manifest.name,
      version: manifest.version,
      installMethod: resolved.installMethod || 'path',
      registry: {
        enabled: result?.enabled === true,
        installStatus: cleanText(result?.installStatus, 80),
        manifestPath: payload?.metadata?.manifestPath || ''
      },
      declarationSummary,
      runtime,
      navigation,
      restartRecommended: false,
      warnings
    };
  }

  async function discoverLocalManifests(options = {}) {
    const packageRootDir = path.resolve(
      String(options.packageRootDir || path.join(resolveProjectRoot(), 'packages'))
    );
    let dirEntries = [];
    try {
      dirEntries = await deps.fs.readdir(packageRootDir, { withFileTypes: true });
    } catch (_) {
      return [];
    }

    const manifests = [];
    for (const entry of dirEntries) {
      if (!entry || !entry.isDirectory()) continue;
      const manifestPath = path.join(packageRootDir, entry.name, 'package.manifest.json');
      // eslint-disable-next-line no-await-in-loop
      if (!(await fileExists(manifestPath))) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        const raw = JSON.parse(await deps.fs.readFile(manifestPath, 'utf8'));
        const manifest = deps.packageManifestService.validatePackageManifest(raw, { knownIds: [] });
        manifests.push({
          packageId: manifest.id,
          name: manifest.name,
          version: manifest.version,
          mountPath: manifest.mountPath,
          manifestPath: manifestPath.replace(/\\/g, '/'),
          storedManifestPath: toStoredManifestPath(manifestPath),
          declarationCounts: countDeclarations(manifest),
          valid: true
        });
      } catch (error) {
        manifests.push({
          packageId: normalizePackageId(entry.name),
          name: cleanText(entry.name, 180),
          version: '',
          mountPath: '',
          manifestPath: manifestPath.replace(/\\/g, '/'),
          storedManifestPath: toStoredManifestPath(manifestPath),
          declarationCounts: {},
          valid: false,
          error: cleanText(error?.message || String(error), 2000)
        });
      }
    }

    manifests.sort((a, b) => String(a.packageId || '').localeCompare(String(b.packageId || '')));
    return manifests;
  }

  async function resolveManifestFromPath(inputPath = '') {
    const token = cleanText(inputPath, 1600);
    if (!token) throw new Error('Manifest path is required.');
    const projectRoot = resolveProjectRoot();
    const absPath = path.isAbsolute(token)
      ? path.resolve(token)
      : path.resolve(projectRoot, token);
    const raw = JSON.parse(await deps.fs.readFile(absPath, 'utf8'));
    const manifest = deps.packageManifestService.validatePackageManifest(raw, { knownIds: [] });
    return {
      manifest,
      manifestPath: absPath
    };
  }

  async function resolveManifestForRegistryRow(row = {}, options = {}) {
    const packageId = normalizePackageId(row?.packageId || row?.id || '');
    if (!packageId) return null;
    const packageRootDir = path.resolve(
      String(options.packageRootDir || path.join(resolveProjectRoot(), 'packages'))
    );
    const manifestPath = await deps.packageLoaderService.resolveManifestPath(packageId, row, packageRootDir);
    if (!manifestPath) return null;
    const rawManifest = await deps.packageLoaderService.readManifestFile(manifestPath);
    const manifest = deps.packageManifestService.validatePackageManifest(rawManifest, { knownIds: [] });
    return {
      manifest,
      manifestPath
    };
  }

  async function listPackageSnapshot(options = {}) {
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const localManifests = await discoverLocalManifests(options);
    const registryRows = await deps.packageRegistryService.listPackageRegistry({ backendMode });
    const installedPackages = [];

    for (const row of registryRows) {
      const packageId = normalizePackageId(row?.packageId || row?.id || '');
      if (!packageId) continue;
      const warnings = [];
      let manifestInfo = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        manifestInfo = await resolveManifestForRegistryRow(row, options);
      } catch (error) {
        warnings.push(cleanText(error?.message || String(error), 800));
      }

      const manifest = manifestInfo?.manifest || null;
      const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      installedPackages.push({
        packageId,
        name: cleanText(manifest?.name || metadata.packageName || packageId.toUpperCase(), 200),
        version: cleanText(row?.version || manifest?.version, 120),
        enabled: row?.enabled === true,
        installStatus: cleanText(row?.installStatus, 80),
        manifestPath: cleanText(
          manifestInfo?.manifestPath
            ? toStoredManifestPath(manifestInfo.manifestPath)
            : metadata.manifestPath,
          1600
        ),
        mountPath: cleanText(manifest?.mountPath || metadata.mountPath, 500),
        updatedAt: cleanText(row?.updatedAt || row?.audit?.lastUpdateDateTime, 80),
        installedAt: cleanText(row?.installedAt || row?.audit?.createDateTime, 80),
        lastError: cleanText(row?.lastError, 2000),
        lastWarning: cleanText(row?.lastWarning, 1200),
        declarationCounts: metadata?.declarationCounts || (manifest ? countDeclarations(manifest) : {}),
        warnings
      });
    }

    installedPackages.sort((a, b) => a.packageId.localeCompare(b.packageId));
    return {
      localManifests,
      installedPackages
    };
  }

  async function refreshNavigationSnapshot(options = {}) {
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    try {
      const snapshot = await deps.packageNavigationService.refreshNavigationRegistry({ backendMode });
      return {
        refreshed: true,
        packageCount: Array.isArray(snapshot?.packages) ? snapshot.packages.length : 0
      };
    } catch (error) {
      return {
        refreshed: false,
        warning: cleanText(error?.message || String(error), 1200)
      };
    }
  }

  async function applyRuntimeEnableHooks(context = {}, options = {}) {
    const warnings = [];
    const app = options?.app || null;
    if (!app || typeof app.use !== 'function') {
      warnings.push('Runtime hook registration skipped because Express app context is unavailable in this request.');
      return {
        attempted: false,
        warnings,
        hooks: {}
      };
    }

    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const hooks = deps.packageRegistryInstallerService.createLoaderHooks({ backendMode });
    const report = {};

    try {
      report.routes = await hooks.registerRoutes(context);
      report.views = await hooks.registerViews(context);
      report.assets = await hooks.registerAssets(context);
      report.queryExecutors = await hooks.registerQueryExecutors(context);
    } catch (error) {
      warnings.push(cleanText(error?.message || String(error), 1200) || 'Runtime hooks reported an error.');
    }

    return {
      attempted: true,
      warnings,
      hooks: report
    };
  }

  function buildRegistryPayload(manifest = {}, options = {}) {
    const mode = cleanText(options.mode, 40).toLowerCase() || 'enable';
    const packageSource = cleanText(options.packageSource, 120) || 'manual';
    return {
      packageId: manifest.id,
      version: manifest.version,
      enabled: mode === 'enable',
      installStatus: mode === 'remove' ? 'removed' : mode === 'disable' ? 'disabled' : 'enabled',
      metadata: {
        packageName: manifest.name,
        mountPath: manifest.mountPath,
        manifestPath: toStoredManifestPath(options.manifestPath),
        activatedBy: SYSTEM_ACTOR_ID,
        activationMode: cleanText(options.activationMode, 120) || 'manual',
        packageSource,
        declarationCounts: countDeclarations(manifest)
      }
    };
  }

  async function resolveInstallManifest(input = {}, options = {}) {
    const installMethod = normalizeInstallMethod(input.installMethod);
    if (!installMethod) throw new Error('Install method is required.');

    if (installMethod === 'json') {
      const rawJson = cleanText(input.manifestJson, 400000);
      if (!rawJson) throw new Error('Manifest JSON is required for json install method.');
      let parsed;
      try {
        parsed = JSON.parse(rawJson);
      } catch (error) {
        throw new Error(`Manifest JSON is invalid: ${error.message}`);
      }
      return {
        installMethod,
        manifest: deps.packageManifestService.validatePackageManifest(parsed, { knownIds: [] }),
        manifestPath: '',
        activationMode: 'manual-json'
      };
    }

    if (installMethod === 'local') {
      const localPath = cleanText(input.localManifestPath, 1600);
      if (!localPath) throw new Error('Select one local manifest path.');
      const localRows = await discoverLocalManifests(options);
      const selected = localRows.find((row) => row.storedManifestPath === localPath || row.manifestPath === localPath);
      if (!selected) {
        throw new Error('Selected local manifest was not found. Refresh and try again.');
      }
      if (selected.valid !== true) {
        throw new Error(selected.error || 'Selected local manifest is invalid.');
      }
      const resolved = await resolveManifestFromPath(selected.manifestPath);
      return {
        installMethod,
        manifest: resolved.manifest,
        manifestPath: resolved.manifestPath,
        activationMode: 'local-discovery'
      };
    }

    const resolved = await resolveManifestFromPath(input.manifestPath);
    return {
      installMethod: 'path',
      manifest: resolved.manifest,
      manifestPath: resolved.manifestPath,
      activationMode: 'manual-path'
    };
  }

  async function installPackage(input = {}, options = {}) {
    const resolved = await resolveInstallManifest(input, options);
    return installResolvedManifest({
      ...resolved,
      action: 'install',
      packageSource: 'manual'
    }, options);
  }

  async function installPackageZip(input = {}, options = {}) {
    const zipBuffer = input?.zipBuffer;
    const signatureBuffer = input?.signatureBuffer;
    if (!Buffer.isBuffer(zipBuffer) || !zipBuffer.length) {
      throw new Error('Package ZIP file is required.');
    }
    if (!Buffer.isBuffer(signatureBuffer) || !signatureBuffer.length) {
      throw new Error('Package signature file is required.');
    }
    if (zipBuffer.length > zipLimits.maxUploadBytes) {
      throw new Error('Package ZIP exceeds configured maximum upload size.');
    }

    await verifyZipSignature(zipBuffer, signatureBuffer, options);

    const packageRootDir = path.resolve(
      String(options.packageRootDir || path.join(resolveProjectRoot(), 'packages'))
    );
    const stagingRootParent = path.join(packageRootDir, '.zip-install-staging');
    await deps.fs.mkdir(stagingRootParent, { recursive: true });

    const stagingDir = await deps.fs.mkdtemp(path.join(stagingRootParent, 'pkg-'));
    let report = null;
    try {
      const extracted = await extractZipToStaging(zipBuffer, stagingDir);
      const rawManifest = JSON.parse(await deps.fs.readFile(extracted.manifestPath, 'utf8'));
      const manifest = deps.packageManifestService.validatePackageManifest(rawManifest, { knownIds: [] });

      const topFolderId = normalizePackageId(extracted.topFolder);
      if (!topFolderId || topFolderId !== manifest.id) {
        throw new Error(
          `ZIP folder identity mismatch. Top-level folder "${extracted.topFolder}" must match manifest id "${manifest.id}".`
        );
      }

      const backendMode = cleanText(options.backendMode, 30) || undefined;
      const existing = await deps.packageRegistryService.getPackageRegistryById(manifest.id, { backendMode });
      const existingVersion = cleanText(existing?.version, 120);
      if (existingVersion && compareSemver(manifest.version, existingVersion) <= 0) {
        throw new Error(`Package version must be newer than installed version ${existingVersion}.`);
      }

      const extractedPackageDir = path.join(stagingDir, extracted.topFolder);
      const installedDir = await replacePackageDirectory(extractedPackageDir, manifest.id, { packageRootDir });
      const installedManifestPath = path.join(installedDir, 'package.manifest.json');
      report = await installResolvedManifest({
        action: 'install-zip',
        installMethod: 'zip',
        activationMode: 'manual-zip',
        manifest,
        manifestPath: installedManifestPath,
        packageSource: 'manual-zip'
      }, options);
      report.signature = { verified: true };
      report.source = 'manual-zip';
      report.extractedPath = toStoredManifestPath(installedDir);
      report.zip = {
        extractedFiles: extracted.extractedFileCount,
        extractedBytes: extracted.extractedBytes
      };
      return report;
    } finally {
      await deps.fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function enablePackage(packageIdInput = '', options = {}) {
    const actor = buildActor(options.actor || null);
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const packageId = normalizePackageId(packageIdInput);
    if (!packageId) throw new Error('Package id is required.');

    const existing = await deps.packageRegistryService.getPackageRegistryById(packageId, { backendMode });
    if (!existing) throw new Error('Package is not in registry. Install it first.');

    const resolved = await resolveManifestForRegistryRow(existing, options);
    if (!resolved || !resolved.manifest) {
      throw new Error('Manifest file was not found for this package. Update manifest path metadata and try again.');
    }

    const manifest = resolved.manifest;
    const context = {
      backendMode,
      packageId: manifest.id,
      packageName: manifest.name,
      manifest,
      manifestPath: resolved.manifestPath
    };

    const payload = buildRegistryPayload(manifest, {
      mode: 'enable',
      manifestPath: resolved.manifestPath,
      activationMode: 'system-settings-enable'
    });

    const result = await deps.packageRegistryService.upsertPackageRegistry(payload, {
      backendMode,
      actor
    });
    const declarationSummary = await deps.packageRegistryInstallerService.installPackageRegistryDeclarations(context, {
      backendMode
    });
    const runtime = await applyRuntimeEnableHooks(context, {
      backendMode,
      app: options.app || null
    });
    const navigation = await refreshNavigationSnapshot({ backendMode });

    const warnings = [];
    warnings.push(...runtime.warnings);
    if (navigation.warning) warnings.push(navigation.warning);

    return {
      action: 'enable',
      packageId: manifest.id,
      packageName: manifest.name,
      version: manifest.version,
      registry: {
        enabled: result?.enabled === true,
        installStatus: cleanText(result?.installStatus, 80),
        manifestPath: payload?.metadata?.manifestPath || ''
      },
      declarationSummary,
      runtime,
      navigation,
      restartRecommended: false,
      warnings
    };
  }

  async function pausePackage(packageIdInput = '', options = {}) {
    const actor = buildActor(options.actor || null);
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const packageId = normalizePackageId(packageIdInput);
    if (!packageId) throw new Error('Package id is required.');

    const warnings = [];
    const existing = await deps.packageRegistryService.getPackageRegistryById(packageId, { backendMode });
    let declarationSummary = null;
    let manifest = null;
    let manifestPath = '';

    if (existing) {
      try {
        const resolved = await resolveManifestForRegistryRow(existing, options);
        manifest = resolved?.manifest || null;
        manifestPath = resolved?.manifestPath || '';
      } catch (error) {
        warnings.push(cleanText(error?.message || String(error), 1200));
      }
    } else {
      warnings.push('Package registry row was not found. Disable action ran in no-op mode.');
    }

    if (manifest) {
      const context = {
        backendMode,
        packageId: manifest.id,
        packageName: manifest.name,
        manifest,
        manifestPath
      };
      declarationSummary = await deps.packageRegistryInstallerService.removePackageRegistryDeclarations(context, {
        action: 'disable',
        backendMode
      });
    } else {
      warnings.push('Declaration disable sync was skipped because manifest was unavailable.');
    }

    const result = await deps.packageRegistryService.setPackageEnabled(packageId, false, {
      backendMode,
      actor
    });
    const navigation = await refreshNavigationSnapshot({ backendMode });
    if (navigation.warning) warnings.push(navigation.warning);

    warnings.push('Runtime route unmount is not supported in-process; restart the app to fully apply paused service state.');

    return {
      action: 'pause',
      packageId,
      packageName: cleanText(manifest?.name || existing?.metadata?.packageName || packageId.toUpperCase(), 200),
      version: cleanText(existing?.version || manifest?.version, 120),
      registry: {
        enabled: result?.enabled === true,
        installStatus: cleanText(result?.installStatus, 80)
      },
      declarationSummary,
      runtime: {
        attempted: false,
        hooks: {}
      },
      navigation,
      restartRecommended: true,
      warnings
    };
  }

  async function removePackage(packageIdInput = '', options = {}) {
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const packageId = normalizePackageId(packageIdInput);
    if (!packageId) throw new Error('Package id is required.');

    const warnings = [];
    const existing = await deps.packageRegistryService.getPackageRegistryById(packageId, { backendMode });
    let declarationSummary = null;
    let manifest = null;
    let manifestPath = '';

    if (existing) {
      try {
        const resolved = await resolveManifestForRegistryRow(existing, options);
        manifest = resolved?.manifest || null;
        manifestPath = resolved?.manifestPath || '';
      } catch (error) {
        warnings.push(cleanText(error?.message || String(error), 1200));
      }
    } else {
      warnings.push('Package registry row was not found. Remove action ran in no-op mode.');
    }

    if (manifest) {
      const context = {
        backendMode,
        packageId: manifest.id,
        packageName: manifest.name,
        manifest,
        manifestPath
      };
      declarationSummary = await deps.packageRegistryInstallerService.removePackageRegistryDeclarations(context, {
        action: 'remove',
        backendMode
      });
    } else {
      warnings.push('Declaration remove sync was skipped because manifest was unavailable.');
    }

    const removed = await deps.packageRegistryService.removePackageRegistry(packageId, { backendMode });
    const navigation = await refreshNavigationSnapshot({ backendMode });
    if (navigation.warning) warnings.push(navigation.warning);

    warnings.push('Runtime route unmount is not supported in-process; restart the app to fully remove mounted service routes.');

    return {
      action: 'remove',
      packageId,
      packageName: cleanText(manifest?.name || existing?.metadata?.packageName || packageId.toUpperCase(), 200),
      version: cleanText(existing?.version || manifest?.version, 120),
      registry: {
        removed: removed === true
      },
      declarationSummary,
      runtime: {
        attempted: false,
        hooks: {}
      },
      navigation,
      restartRecommended: true,
      warnings
    };
  }

  async function syncPackage(packageIdInput = '', options = {}) {
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const packageId = normalizePackageId(packageIdInput);
    if (!packageId) throw new Error('Package id is required.');

    const existing = await deps.packageRegistryService.getPackageRegistryById(packageId, { backendMode });
    if (!existing) throw new Error('Package is not in registry. Install it first.');
    const resolved = await resolveManifestForRegistryRow(existing, options);
    if (!resolved || !resolved.manifest) {
      throw new Error('Manifest file was not found for this package.');
    }

    const manifest = resolved.manifest;
    const context = {
      backendMode,
      packageId: manifest.id,
      packageName: manifest.name,
      manifest,
      manifestPath: resolved.manifestPath
    };

    const declarationSummary = await deps.packageRegistryInstallerService.installPackageRegistryDeclarations(context, {
      backendMode
    });
    const runtime = await applyRuntimeEnableHooks(context, {
      backendMode,
      app: options.app || null
    });
    const navigation = await refreshNavigationSnapshot({ backendMode });
    const warnings = [];
    warnings.push(...runtime.warnings);
    if (navigation.warning) warnings.push(navigation.warning);

    return {
      action: 'sync',
      packageId: manifest.id,
      packageName: manifest.name,
      version: manifest.version,
      registry: {
        enabled: existing?.enabled === true,
        installStatus: cleanText(existing?.installStatus, 80)
      },
      declarationSummary,
      runtime,
      navigation,
      restartRecommended: false,
      warnings
    };
  }

  return {
    discoverLocalManifests,
    listPackageSnapshot,
    installPackage,
    installPackageZip,
    enablePackage,
    pausePackage,
    removePackage,
    syncPackage
  };
}

const defaultService = createService();

module.exports = {
  ...defaultService,
  createService,
  createDependencies
};
