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
const packageLifecycleTransactionService = require('./packageLifecycleTransactionService');
const packageDataLifecycleService = require('./packageDataLifecycleService');
const systemSettingsPackageBuilderService = require('./systemSettingsPackageBuilderService');
const operationRepository = require('../repositories/operationRepository');
const roleRepository = require('../repositories/roleRepository');
const sectionRepository = require('../repositories/sectionRepository');
const symbolRepository = require('../repositories/symbolRepository');
const accessRepository = require('../repositories/accessRepository');
const systemSettingsRepository = require('../repositories/systemSettingsRepository');
const uploadFolderSettingsService = require('./uploadFolderSettingsService');
const { getPackageStorageRootAbsolute } = require('../utils/packageStoragePathUtils');

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

function evaluateInstallVersionGate(incomingVersion = '', existingVersion = '', options = {}) {
  const nextVersion = cleanText(incomingVersion, 120);
  const previousVersion = cleanText(existingVersion, 120);
  if (!previousVersion) {
    return { allowed: true, reinstallRecovery: false, reason: '' };
  }
  const semverOrder = compareSemver(nextVersion, previousVersion);
  if (semverOrder > 0) {
    return { allowed: true, reinstallRecovery: false, reason: '' };
  }
  if (semverOrder === 0 && options.allowSameVersionRecovery === true) {
    return { allowed: true, reinstallRecovery: true, reason: 'missing_files_recovery' };
  }
  return {
    allowed: false,
    reinstallRecovery: false,
    reason: semverOrder === 0 ? 'same_version_blocked' : 'older_version_blocked'
  };
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

function sanitizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sanitizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getOwnershipFromRow(row = {}) {
  const source = sanitizeObject(row);
  return {
    packageId: normalizePackageId(source.packageId || source?.package?.id || source?.metadata?.packageId || ''),
    packageName: cleanText(source.packageName || source?.package?.name || source?.metadata?.packageName || '', 200)
  };
}

function normalizeOrgToken(value) {
  const token = cleanText(value, 120);
  return token || '';
}

function createDependencies(overrides = {}) {
  return {
    fs: overrides.fs || fs,
    path: overrides.path || path,
    packageManifestService: overrides.packageManifestService || packageManifestService,
    packageRegistryService: overrides.packageRegistryService || packageRegistryService,
    packageRegistryInstallerService: overrides.packageRegistryInstallerService || packageRegistryInstallerService,
    packageLoaderService: overrides.packageLoaderService || packageLoaderService,
    packageNavigationService: overrides.packageNavigationService || packageNavigationService,
    packageLifecycleTransactionService: overrides.packageLifecycleTransactionService || packageLifecycleTransactionService,
    packageDataLifecycleService: overrides.packageDataLifecycleService || packageDataLifecycleService,
    packageBuilderService: overrides.packageBuilderService || systemSettingsPackageBuilderService,
    operationRepository: overrides.operationRepository || operationRepository,
    roleRepository: overrides.roleRepository || roleRepository,
    sectionRepository: overrides.sectionRepository || sectionRepository,
    symbolRepository: overrides.symbolRepository || symbolRepository,
    accessRepository: overrides.accessRepository || accessRepository,
    systemSettingsRepository: overrides.systemSettingsRepository || systemSettingsRepository,
    uploadFolderSettingsService: overrides.uploadFolderSettingsService || uploadFolderSettingsService
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

  function hashPayload(value) {
    if (deps.packageLifecycleTransactionService && typeof deps.packageLifecycleTransactionService.hashPayload === 'function') {
      return deps.packageLifecycleTransactionService.hashPayload(value);
    }
    return crypto.createHash('sha256').update(JSON.stringify(value === undefined ? null : value)).digest('hex');
  }

  function createLifecycleSummaryByEntity(entityOperations = []) {
    if (
      deps.packageLifecycleTransactionService
      && typeof deps.packageLifecycleTransactionService.summarizeEntityOperations === 'function'
    ) {
      return deps.packageLifecycleTransactionService.summarizeEntityOperations(entityOperations);
    }
    const rows = sanitizeArray(entityOperations);
    const summary = {};
    rows.forEach((row) => {
      const entityType = cleanText(row?.entityType, 80).toLowerCase() || 'other';
      const operation = cleanText(row?.operation, 80).toLowerCase() || 'recorded';
      if (!summary[entityType]) summary[entityType] = {};
      summary[entityType][operation] = Number(summary[entityType][operation] || 0) + 1;
    });
    return summary;
  }

  async function startLifecycleTransaction(input = {}, options = {}) {
    if (!deps.packageLifecycleTransactionService || typeof deps.packageLifecycleTransactionService.startTransaction !== 'function') {
      return null;
    }
    const actor = buildActor(options.actor || null);
    return deps.packageLifecycleTransactionService.startTransaction(input, {
      backendMode: options.backendMode,
      actor
    });
  }

  async function markLifecyclePhase(transactionId = '', phaseName = '', status = 'in_progress', details = {}, options = {}) {
    if (!transactionId) return null;
    if (!deps.packageLifecycleTransactionService || typeof deps.packageLifecycleTransactionService.markPhase !== 'function') {
      return null;
    }
    const actor = buildActor(options.actor || null);
    return deps.packageLifecycleTransactionService.markPhase(transactionId, phaseName, status, details, {
      backendMode: options.backendMode,
      actor
    });
  }

  async function appendLifecycleOperations(transactionId = '', rows = [], options = {}) {
    if (!transactionId) return null;
    if (!deps.packageLifecycleTransactionService || typeof deps.packageLifecycleTransactionService.appendEntityOperations !== 'function') {
      return null;
    }
    const actor = buildActor(options.actor || null);
    return deps.packageLifecycleTransactionService.appendEntityOperations(transactionId, rows, {
      backendMode: options.backendMode,
      actor
    });
  }

  async function completeLifecycleTransaction(transactionId = '', patch = {}, options = {}) {
    if (!transactionId) return null;
    if (!deps.packageLifecycleTransactionService || typeof deps.packageLifecycleTransactionService.completeTransaction !== 'function') {
      return null;
    }
    const actor = buildActor(options.actor || null);
    return deps.packageLifecycleTransactionService.completeTransaction(transactionId, patch, {
      backendMode: options.backendMode,
      actor
    });
  }

  function mapDeclarationResultToEntityType(category = '') {
    const token = cleanText(category, 80).toLowerCase();
    if (token === 'uploadfolders') return 'uploadFolders';
    if (['operations', 'roles', 'sections', 'symbols', 'accesses'].includes(token)) return token;
    return token || 'other';
  }

  function mapDeclarationResultToOperation(status = '') {
    const token = cleanText(status, 80).toLowerCase();
    if (['created', 'updated', 'skipped', 'deactivated', 'removed', 'failed'].includes(token)) return token;
    return 'recorded';
  }

  function declarationSummaryToLifecycleOperations(summary = {}, options = {}) {
    const rows = sanitizeArray(summary?.results);
    const now = new Date().toISOString();
    return rows.map((row) => {
      const afterPayload = sanitizeObject(row);
      const beforePayload = options.beforePayload || null;
      const entityType = mapDeclarationResultToEntityType(row?.category);
      return {
        entityType,
        identityKey: cleanText(row?.key || row?.id || `${entityType}:${row?.message || ''}`, 400),
        ownership: sanitizeObject(options.ownership),
        operation: mapDeclarationResultToOperation(row?.status),
        reason: cleanText(row?.message || '', 1200),
        beforePayload,
        afterPayload,
        beforeHash: hashPayload(beforePayload),
        afterHash: hashPayload(afterPayload),
        recordedAt: now
      };
    }).filter((row) => row.identityKey);
  }

  function dataLifecycleSummaryToOperations(report = {}, options = {}) {
    const rows = [];
    const now = new Date().toISOString();
    const ownership = sanitizeObject(options.ownership);
    const pushStep = (step = {}, operation = 'applied', reasonPrefix = '') => {
      const stepId = cleanText(step?.stepId, 200);
      const stepType = cleanText(step?.stepType, 40).toLowerCase();
      const direction = cleanText(step?.direction, 40).toLowerCase();
      if (!stepId || !stepType) return;
      rows.push({
        entityType: 'packageDataLifecycle',
        identityKey: `${stepType}:${stepId}:${direction || operation}`,
        ownership,
        operation,
        reason: cleanText(`${reasonPrefix}${step?.message || ''}`, 1200),
        beforePayload: null,
        afterPayload: sanitizeObject(step?.artifacts),
        beforeHash: hashPayload(null),
        afterHash: hashPayload(sanitizeObject(step?.artifacts)),
        recordedAt: now
      });
    };

    sanitizeArray(report?.appliedSteps).forEach((step) => pushStep(step, 'applied'));
    sanitizeArray(report?.skippedSteps).forEach((step) => pushStep(step, 'skipped', 'Skipped: '));
    if (report?.failedStep) {
      pushStep(report.failedStep, 'failed', 'Failed: ');
    }
    return rows;
  }

  function getManifestDeclarationTargets(manifest = {}) {
    const targets = [];
    const operations = sanitizeArray(manifest?.operations);
    operations.forEach((row) => {
      const name = cleanText(row?.name, 180).toUpperCase();
      if (!name) return;
      targets.push({ entityType: 'operations', identityKey: `name:${name}`, payload: { name } });
    });

    const roles = sanitizeArray(manifest?.roles);
    roles.forEach((row) => {
      const key = cleanText(row?.key, 180).toLowerCase();
      if (!key) return;
      targets.push({ entityType: 'roles', identityKey: `key:${key}`, payload: { key } });
    });

    const sections = sanitizeArray(manifest?.sections);
    sections.forEach((row) => {
      const name = cleanText(row?.name, 180).toUpperCase();
      if (!name) return;
      targets.push({ entityType: 'sections', identityKey: `name:${name}`, payload: { name } });
    });

    const symbols = sanitizeArray(manifest?.symbols);
    symbols.forEach((row) => {
      const name = cleanText(row?.name, 200).toUpperCase();
      const orgId = normalizeOrgToken(row?.orgId || 'SYSTEM') || 'SYSTEM';
      if (!name) return;
      targets.push({
        entityType: 'symbols',
        identityKey: `name:${name}|org:${orgId}`,
        payload: { name, orgId }
      });
    });

    const accesses = sanitizeArray(manifest?.accesses);
    accesses.forEach((row) => {
      const name = cleanText(row?.name, 200).toUpperCase();
      const orgId = normalizeOrgToken(row?.orgId || '');
      if (!name) return;
      targets.push({
        entityType: 'accesses',
        identityKey: `name:${name}|org:${orgId || 'GLOBAL'}`,
        payload: { name, orgId }
      });
    });

    const uploadFolders = sanitizeArray(manifest?.uploadFolders);
    uploadFolders.forEach((row) => {
      const key = cleanText(row?.key, 220);
      if (!key) return;
      targets.push({ entityType: 'uploadFolders', identityKey: `key:${key}`, payload: { key } });
    });
    return targets;
  }

  async function resolveCurrentEntityRecord(target = {}, options = {}) {
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const entityType = target.entityType;
    if (entityType === 'operations') {
      return deps.operationRepository.getByName(target?.payload?.name, { backendMode });
    }
    if (entityType === 'roles') {
      return deps.roleRepository.getByKey(target?.payload?.key, { backendMode });
    }
    if (entityType === 'sections') {
      return deps.sectionRepository.getByName(target?.payload?.name, { backendMode });
    }
    if (entityType === 'symbols') {
      const rows = await deps.symbolRepository.list({
        backendMode,
        query: {
          name__eq: target?.payload?.name,
          orgId__eq: target?.payload?.orgId,
          limit: 1
        }
      });
      return Array.isArray(rows) && rows[0] ? rows[0] : null;
    }
    if (entityType === 'accesses') {
      const rows = await deps.accessRepository.list({
        backendMode,
        query: {
          name__eq: target?.payload?.name,
          orgId__eq: target?.payload?.orgId || '',
          limit: 1
        }
      });
      return Array.isArray(rows) && rows[0] ? rows[0] : null;
    }
    if (entityType === 'uploadFolders') {
      const settings = await deps.systemSettingsRepository.getSettings({ backendMode });
      const currentFolders = settings?.app?.uploadFolders || {};
      const definitions = deps.uploadFolderSettingsService.getUploadFolderDefinitions();
      const definition = sanitizeArray(definitions).find((row) => cleanText(row?.key, 220) === target?.payload?.key) || null;
      return {
        key: target?.payload?.key,
        value: cleanText(currentFolders[target?.payload?.key], 800),
        definition
      };
    }
    return null;
  }

  async function captureManifestSnapshots(manifest = {}, options = {}) {
    const targets = getManifestDeclarationTargets(manifest);
    const rows = [];
    for (const target of targets) {
      // eslint-disable-next-line no-await-in-loop
      const current = await resolveCurrentEntityRecord(target, options).catch(() => null);
      const ownership = getOwnershipFromRow(current || {});
      const payload = current ? sanitizeObject(current) : null;
      rows.push({
        entityType: target.entityType,
        identityKey: target.identityKey,
        ownership,
        hash: hashPayload(payload),
        payload
      });
    }
    return rows;
  }

  function buildSnapshotLookup(rows = []) {
    const map = new Map();
    sanitizeArray(rows).forEach((row) => {
      const key = `${cleanText(row?.entityType, 80)}::${cleanText(row?.identityKey, 400)}`;
      map.set(key, row);
    });
    return map;
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
      const error = new Error(
        'No trusted package public key is configured for ZIP install verification. ' +
        'Set PACKAGE_INSTALL_ED25519_PUBLIC_KEYS in the core .env (or app.packageInstallEd25519PublicKeys), then restart.'
      );
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

    const error = new Error(
      'Package signature verification failed. Ensure the ZIP was signed with the private key paired to configured trusted public key(s).'
    );
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
    const packageRootDir = getPackageStorageRootAbsolute({ packageRootDir: options.packageRootDir, ensureExists: true });
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

    return {
      destinationDir,
      backupDir: hadExistingDestination ? backupDir : '',
      hadExistingDestination
    };
  }

  async function cleanupPackageBackup(backupDir = '') {
    const token = cleanText(backupDir, 1600);
    if (!token) return;
    if (!(await pathExists(deps.fs, token))) return;
    await deps.fs.rm(token, { recursive: true, force: true }).catch(() => {});
  }

  async function restorePackageDirectoryFromBackup(packageId = '', backupDir = '', options = {}) {
    const packageRootDir = getPackageStorageRootAbsolute({ packageRootDir: options.packageRootDir, ensureExists: true });
    const destinationDir = path.join(packageRootDir, packageId);
    const backupPath = cleanText(backupDir, 1600);
    if (!backupPath) return false;
    if (!(await pathExists(deps.fs, backupPath))) return false;

    if (await pathExists(deps.fs, destinationDir)) {
      await deps.fs.rm(destinationDir, { recursive: true, force: true }).catch(() => {});
    }
    await deps.fs.rename(backupPath, destinationDir);
    return true;
  }

  async function installResolvedManifest(resolved = {}, options = {}) {
    const actor = buildActor(options.actor || null);
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const manifest = resolved.manifest;
    const packageId = normalizePackageId(manifest?.id);
    if (!packageId) throw new Error('Manifest package id is required.');
    const previousRegistry = await deps.packageRegistryService.getPackageRegistryById(packageId, { backendMode });
    const previousVersion = cleanText(previousRegistry?.version, 120);
    const nextVersion = cleanText(manifest?.version, 120);
    const versionDecision = evaluateInstallVersionGate(nextVersion, previousVersion, {
      allowSameVersionRecovery: resolved.allowSameVersionRecovery === true
    });
    if (!versionDecision.allowed) {
      throw new Error(`Package version must be newer than installed version ${previousVersion}.`);
    }
    const reinstallRecovery = versionDecision.reinstallRecovery === true;
    const isUpgrade = Boolean(previousRegistry);
    const txAction = cleanText(resolved.action, 80) || (isUpgrade ? 'upgrade' : 'install');
    const transaction = resolved.transactionId
      ? { id: cleanText(resolved.transactionId, 160) }
      : await startLifecycleTransaction({
        packageId,
        packageName: cleanText(manifest?.name, 200),
        packageVersion: nextVersion,
        action: txAction,
        metadata: {
          installMethod: cleanText(resolved.installMethod, 80),
          activationMode: cleanText(resolved.activationMode, 120),
          manifestPath: toStoredManifestPath(resolved.manifestPath || ''),
          previousVersion,
          reinstallRecovery
        },
        artifacts: {
          previousRegistry,
          fileMutation: sanitizeObject(resolved.fileMutation)
        }
      }, { backendMode, actor });
    const transactionId = cleanText(transaction?.id, 160);
    const beforeSnapshots = await captureManifestSnapshots(manifest, { backendMode });

    await markLifecyclePhase(transactionId, 'preflight', 'completed', {
      packageId,
      previousVersion: previousVersion || '',
      nextVersion
    }, { backendMode, actor });
    await markLifecyclePhase(transactionId, 'apply', 'in_progress', {}, { backendMode, actor });

    const warnings = [];
    if (reinstallRecovery) {
      warnings.push('Missing package files were detected. Same-version reinstall recovery mode was applied.');
    }
    const lifecycleOperations = [];
    const context = {
      backendMode,
      packageId: manifest.id,
      packageName: manifest.name,
      manifest,
      manifestPath: resolved.manifestPath
    };
    let result = null;
    let declarationSummary = null;
    let runtime = { attempted: false, warnings: [], hooks: {} };
    let navigation = { refreshed: false };
    let dataLifecycleReport = {
      dataSummary: { migrations: { applied: 0, skipped: 0, failed: 0 }, seeders: { applied: 0, skipped: 0, failed: 0 } },
      appliedSteps: [],
      skippedSteps: [],
      failedStep: null,
      rollbackApplied: false,
      warnings: []
    };
    let builderPayloadReport = {
      applied: false,
      orgRemapRequired: false,
      dataSummary: { entityCount: 0, upserted: 0 },
      fileSummary: { copied: 0 },
      warnings: []
    };
    let installationSucceeded = false;

    try {
      if (
        deps.packageBuilderService
        && typeof deps.packageBuilderService.applyBuilderPayloadIfPresent === 'function'
      ) {
        builderPayloadReport = await deps.packageBuilderService.applyBuilderPayloadIfPresent({
          packageId: manifest.id,
          packageName: manifest.name,
          packageVersion: manifest.version,
          manifestPath: resolved.manifestPath
        }, {
          backendMode,
          dryRun: true,
          targetOrgId: normalizeOrgToken(options.targetOrgId || ''),
          actor
        });
      }

      if (isUpgrade && resolved.previousResolved?.manifest) {
        const previousContext = {
          backendMode,
          packageId,
          packageName: cleanText(resolved.previousResolved.manifest.name, 200) || cleanText(previousRegistry?.metadata?.packageName, 200),
          manifest: resolved.previousResolved.manifest,
          manifestPath: resolved.previousResolved.manifestPath || ''
        };
        const removeSummary = await deps.packageRegistryInstallerService.removePackageRegistryDeclarations(previousContext, {
          action: 'remove',
          backendMode
        });
        lifecycleOperations.push(...declarationSummaryToLifecycleOperations(removeSummary, {
          ownership: { packageId, packageName: previousContext.packageName }
        }));
      }

      if (
        deps.packageDataLifecycleService
        && (
          typeof deps.packageDataLifecycleService.runPackageDataInstallLifecycle === 'function'
          || typeof deps.packageDataLifecycleService.runPackageDataUpgradeLifecycle === 'function'
        )
      ) {
        const dataContext = {
          backendMode,
          packageId: manifest.id,
          packageVersion: manifest.version,
          previousVersion,
          packageName: manifest.name,
          manifest,
          manifestPath: resolved.manifestPath
        };
        dataLifecycleReport = isUpgrade
          // eslint-disable-next-line no-await-in-loop
          ? await deps.packageDataLifecycleService.runPackageDataUpgradeLifecycle(dataContext, {
              backendMode,
              actor,
              transactionId
            })
          : await deps.packageDataLifecycleService.runPackageDataInstallLifecycle(dataContext, {
              backendMode,
              actor,
              transactionId
            });
        warnings.push(...sanitizeArray(dataLifecycleReport?.warnings));
        lifecycleOperations.push(...dataLifecycleSummaryToOperations(dataLifecycleReport, {
          ownership: { packageId, packageName: cleanText(manifest?.name, 200) }
        }));
        if (dataLifecycleReport?.failedStep) {
          throw new Error(cleanText(dataLifecycleReport.failedStep.message, 1600) || 'Package data lifecycle failed.');
        }
      }

      const payload = buildRegistryPayload(manifest, {
        mode: 'enable',
        manifestPath: resolved.manifestPath,
        activationMode: resolved.activationMode,
        packageSource: resolved.packageSource || ''
      });
      result = await deps.packageRegistryService.upsertPackageRegistry(payload, {
        backendMode,
        actor
      });
      declarationSummary = await deps.packageRegistryInstallerService.installPackageRegistryDeclarations(context, {
        backendMode
      });
      lifecycleOperations.push(...declarationSummaryToLifecycleOperations(declarationSummary, {
        ownership: { packageId, packageName: cleanText(manifest?.name, 200) }
      }));
      runtime = await applyRuntimeEnableHooks(context, {
        backendMode,
        app: options.app || null
      });
      navigation = await refreshNavigationSnapshot({ backendMode });
      warnings.push(...runtime.warnings);
      if (navigation.warning) warnings.push(navigation.warning);

      if (
        deps.packageBuilderService
        && typeof deps.packageBuilderService.applyBuilderPayloadIfPresent === 'function'
      ) {
        builderPayloadReport = await deps.packageBuilderService.applyBuilderPayloadIfPresent({
          packageId: manifest.id,
          packageName: manifest.name,
          packageVersion: manifest.version,
          manifestPath: resolved.manifestPath
        }, {
          backendMode,
          targetOrgId: normalizeOrgToken(options.targetOrgId || ''),
          actor
        });
        warnings.push(...sanitizeArray(builderPayloadReport?.warnings));
      }

      const afterSnapshots = await captureManifestSnapshots(manifest, { backendMode });
      await markLifecyclePhase(transactionId, 'apply', 'completed', {
        updatedVersion: nextVersion
      }, { backendMode, actor });
      await markLifecyclePhase(transactionId, 'commit', 'in_progress', {}, { backendMode, actor });
      await appendLifecycleOperations(transactionId, lifecycleOperations, { backendMode, actor });
      await completeLifecycleTransaction(transactionId, {
        status: 'success',
        phase: 'commit',
        warnings,
        artifacts: {
          previousRegistry,
          fileMutation: sanitizeObject(resolved.fileMutation),
          beforeSnapshots,
          afterSnapshots,
          dataLifecycleReport,
          builderPayloadReport
        },
        summaryByEntity: createLifecycleSummaryByEntity(lifecycleOperations)
      }, { backendMode, actor });

      const report = {
        action: isUpgrade ? 'upgrade' : (resolved.action || 'install'),
        mode: reinstallRecovery ? 'reinstall_recovery' : 'normal',
        packageId: manifest.id,
        packageName: manifest.name,
        version: manifest.version,
        installMethod: resolved.installMethod || 'path',
        transactionId,
        phase: 'commit',
        summaryByEntity: createLifecycleSummaryByEntity(lifecycleOperations),
        dataSummary: sanitizeObject(dataLifecycleReport?.dataSummary),
        payloadSummary: {
          applied: builderPayloadReport?.applied === true,
          orgRemapRequired: builderPayloadReport?.orgRemapRequired === true,
          targetOrgId: cleanText(builderPayloadReport?.targetOrgId, 120),
          dataSummary: sanitizeObject(builderPayloadReport?.dataSummary),
          fileSummary: sanitizeObject(builderPayloadReport?.fileSummary)
        },
        appliedSteps: sanitizeArray(dataLifecycleReport?.appliedSteps),
        skippedSteps: sanitizeArray(dataLifecycleReport?.skippedSteps),
        failedStep: dataLifecycleReport?.failedStep || null,
        rollbackApplied: dataLifecycleReport?.rollbackApplied === true,
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
      installationSucceeded = true;
      return report;
    } catch (error) {
      const rollbackWarnings = [];
      let rollbackApplied = false;
      let dataRollbackApplied = false;
      try {
        await markLifecyclePhase(transactionId, 'rollback', 'in_progress', {
          reason: cleanText(error?.message || String(error), 1200)
        }, { backendMode, actor });
      } catch (_) {
        // Continue rollback best-effort.
      }

      try {
        if (
          deps.packageDataLifecycleService
          && typeof deps.packageDataLifecycleService.runPackageDataUninstallLifecycle === 'function'
          && sanitizeArray(dataLifecycleReport?.appliedSteps).length
        ) {
          const dataRollback = await deps.packageDataLifecycleService.runPackageDataUninstallLifecycle({
            backendMode,
            packageId: manifest.id,
            packageVersion: manifest.version,
            packageName: manifest.name,
            manifest,
            manifestPath: resolved.manifestPath
          }, {
            backendMode,
            actor,
            transactionId,
            force: true
          });
          dataRollbackApplied = dataRollback?.rollbackApplied === true;
          rollbackWarnings.push(...sanitizeArray(dataRollback?.warnings));
          lifecycleOperations.push(...dataLifecycleSummaryToOperations(dataRollback, {
            ownership: { packageId, packageName: cleanText(manifest?.name, 200) }
          }));
        }

        const removeNewContext = {
          backendMode,
          packageId,
          packageName: manifest.name,
          manifest,
          manifestPath: resolved.manifestPath
        };
        await deps.packageRegistryInstallerService.removePackageRegistryDeclarations(removeNewContext, {
          action: 'remove',
          backendMode
        }).catch(() => null);

        if (isUpgrade && resolved.previousResolved?.manifest) {
          const restoreContext = {
            backendMode,
            packageId,
            packageName: cleanText(resolved.previousResolved.manifest.name, 200),
            manifest: resolved.previousResolved.manifest,
            manifestPath: resolved.previousResolved.manifestPath || ''
          };
          await deps.packageRegistryInstallerService.installPackageRegistryDeclarations(restoreContext, { backendMode }).catch(() => null);
        }

        if (previousRegistry) {
          await deps.packageRegistryService.upsertPackageRegistry(previousRegistry, { backendMode, actor }).catch(() => null);
        } else {
          await deps.packageRegistryService.removePackageRegistry(packageId, { backendMode }).catch(() => null);
        }

        const fileMutation = sanitizeObject(resolved.fileMutation);
        if (fileMutation.backupDir) {
          await restorePackageDirectoryFromBackup(packageId, fileMutation.backupDir, {
            packageRootDir: options.packageRootDir
          }).catch((restoreError) => {
            rollbackWarnings.push(cleanText(restoreError?.message || String(restoreError), 1200));
          });
        }
        rollbackApplied = true;
      } catch (rollbackError) {
        rollbackWarnings.push(cleanText(rollbackError?.message || String(rollbackError), 1200));
      } finally {
        const fileMutation = sanitizeObject(resolved.fileMutation);
        if (fileMutation.backupDir && rollbackApplied) {
          await cleanupPackageBackup(fileMutation.backupDir).catch(() => {});
        }
      }

      const failureMessage = cleanText(error?.message || String(error), 2000);
      await completeLifecycleTransaction(transactionId, {
        status: rollbackApplied ? 'rollback_applied' : 'rollback_failed',
        phase: 'rollback',
        warnings: [...warnings, ...rollbackWarnings],
        blockedReasons: [failureMessage],
        rollback: {
          applied: rollbackApplied,
          dataRollbackApplied,
          warnings: rollbackWarnings
        },
        artifacts: {
          previousRegistry,
          fileMutation: sanitizeObject(resolved.fileMutation),
          beforeSnapshots,
          dataLifecycleReport
        },
        summaryByEntity: createLifecycleSummaryByEntity(lifecycleOperations)
      }, { backendMode, actor }).catch(() => null);
      if (transactionId) {
        error.transactionId = transactionId;
      }
      throw error;
    } finally {
      const fileMutation = sanitizeObject(resolved.fileMutation);
      if (fileMutation.backupDir && installationSucceeded) {
        await cleanupPackageBackup(fileMutation.backupDir).catch(() => {});
      }
    }
  }

  async function discoverLocalManifests(options = {}) {
    const packageRootDir = getPackageStorageRootAbsolute({ packageRootDir: options.packageRootDir });
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
    const packageRootDir = getPackageStorageRootAbsolute({ packageRootDir: options.packageRootDir });
    let manifestPath = await deps.packageLoaderService.resolveManifestPath(packageId, row, packageRootDir);
    let manifest = null;
    if (manifestPath) {
      const rawManifest = await deps.packageLoaderService.readManifestFile(manifestPath);
      manifest = deps.packageManifestService.validatePackageManifest(rawManifest, { knownIds: [] });
    }
    if (!manifestPath || !manifest) {
      const localRows = await discoverLocalManifests({ ...options, packageRootDir });
      const localMatch = localRows.find((entry) => (
        normalizePackageId(entry?.packageId) === packageId && entry?.valid === true
      ));
      if (localMatch?.manifestPath) {
        const resolved = await resolveManifestFromPath(localMatch.manifestPath);
        manifestPath = resolved.manifestPath;
        manifest = resolved.manifest;
      }
    }
    if (!manifestPath || !manifest) return null;
    return {
      manifest,
      manifestPath
    };
  }

  async function inspectPackagePresence(packageIdInput = '', options = {}) {
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const packageId = normalizePackageId(packageIdInput);
    if (!packageId) {
      return {
        packageId: '',
        hasRegistryRow: false,
        manifestResolved: false,
        missingFilesRecoveryEligible: false,
        existing: null,
        resolved: null,
        manifestResolutionError: ''
      };
    }

    const existing = await deps.packageRegistryService.getPackageRegistryById(packageId, { backendMode });
    if (!existing) {
      return {
        packageId,
        hasRegistryRow: false,
        manifestResolved: false,
        missingFilesRecoveryEligible: false,
        existing: null,
        resolved: null,
        manifestResolutionError: ''
      };
    }

    let resolved = null;
    let manifestResolutionError = '';
    try {
      resolved = await resolveManifestForRegistryRow(existing, options);
    } catch (error) {
      manifestResolutionError = cleanText(error?.message || String(error), 1200);
    }
    const manifestResolved = Boolean(resolved?.manifest);
    return {
      packageId,
      hasRegistryRow: true,
      manifestResolved,
      missingFilesRecoveryEligible: !manifestResolved,
      existing,
      resolved,
      manifestResolutionError
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
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const packageId = normalizePackageId(resolved?.manifest?.id || '');
    const presence = packageId
      ? await inspectPackagePresence(packageId, { ...options, backendMode })
      : { resolved: null, missingFilesRecoveryEligible: false };
    return installResolvedManifest({
      ...resolved,
      action: 'install',
      packageSource: 'manual',
      previousResolved: presence.resolved || null,
      allowSameVersionRecovery: presence.missingFilesRecoveryEligible === true
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

    const packageRootDir = getPackageStorageRootAbsolute({ packageRootDir: options.packageRootDir, ensureExists: true });
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
      const presence = await inspectPackagePresence(manifest.id, { ...options, backendMode });
      const existing = presence.existing;
      const existingVersion = cleanText(existing?.version, 120);
      const previousResolved = presence.resolved || null;
      const transaction = await startLifecycleTransaction({
        packageId: manifest.id,
        packageName: cleanText(manifest?.name, 200),
        packageVersion: cleanText(manifest?.version, 120),
        action: existing ? 'upgrade-zip' : 'install-zip',
        metadata: {
          installMethod: 'zip',
          previousVersion: existingVersion || '',
          source: 'manual-zip',
          missingFilesRecoveryEligible: presence.missingFilesRecoveryEligible === true
        },
        artifacts: {
          previousRegistry: existing || null
        }
      }, { backendMode, actor: options.actor || null });
      const transactionId = cleanText(transaction?.id, 160);
      await markLifecyclePhase(transactionId, 'preflight', 'completed', {
        packageId: manifest.id,
        previousVersion: existingVersion || '',
        nextVersion: cleanText(manifest?.version, 120)
      }, { backendMode, actor: options.actor || null });
      await markLifecyclePhase(transactionId, 'apply', 'in_progress', {
        stage: 'extract-and-replace-directory'
      }, { backendMode, actor: options.actor || null });

      const extractedPackageDir = path.join(stagingDir, extracted.topFolder);
      const fileMutation = await replacePackageDirectory(extractedPackageDir, manifest.id, { packageRootDir });
      const installedManifestPath = path.join(fileMutation.destinationDir, 'package.manifest.json');
      report = await installResolvedManifest({
        action: 'install-zip',
        installMethod: 'zip',
        activationMode: 'manual-zip',
        manifest,
        manifestPath: installedManifestPath,
        packageSource: 'manual-zip',
        transactionId,
        previousResolved,
        fileMutation,
        allowSameVersionRecovery: presence.missingFilesRecoveryEligible === true
      }, options);
      report.signature = { verified: true };
      report.source = 'manual-zip';
      report.extractedPath = toStoredManifestPath(fileMutation.destinationDir);
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

  async function findLatestSuccessfulInstallTransaction(packageId = '', options = {}) {
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    if (!deps.packageLifecycleTransactionService || typeof deps.packageLifecycleTransactionService.listPackageTransactions !== 'function') {
      return null;
    }
    const rows = await deps.packageLifecycleTransactionService.listPackageTransactions(packageId, {
      backendMode,
      query: {
        packageId__eq: packageId,
        limit: 200
      }
    });
    const list = sanitizeArray(rows);
    const installLike = new Set(['install', 'install-zip', 'upgrade', 'upgrade-zip']);
    return list
      .filter((row) => row && installLike.has(cleanText(row.action, 80).toLowerCase()) && cleanText(row.status, 80).toLowerCase() === 'success')
      .sort((a, b) => String(b.finishedAt || b.audit?.lastUpdateDateTime || '').localeCompare(String(a.finishedAt || a.audit?.lastUpdateDateTime || '')))[0] || null;
  }

  async function previewPackageUninstallImpact(packageIdInput = '', options = {}) {
    const actor = buildActor(options.actor || null);
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const packageId = normalizePackageId(packageIdInput);
    if (!packageId) throw new Error('Package id is required.');

    const presence = await inspectPackagePresence(packageId, { ...options, backendMode });
    const existing = presence.existing;
    const dataOnlyPreview = (
      deps.packageDataLifecycleService
      && typeof deps.packageDataLifecycleService.previewPackageDataUninstallImpact === 'function'
    )
      ? await deps.packageDataLifecycleService.previewPackageDataUninstallImpact({
          backendMode,
          packageId
        }, {
          backendMode,
          actor
        }).catch(() => null)
      : null;
    if (!existing) {
      return {
        packageId,
        mode: 'registry_only_remove',
        blocked: Boolean(dataOnlyPreview?.blocked),
        blockedReasons: sanitizeArray(dataOnlyPreview?.blockedReasons),
        modifiedRecords: sanitizeArray(dataOnlyPreview?.modifiedRecords),
        dataImpact: sanitizeObject(dataOnlyPreview?.dataImpact),
        summaryByEntity: {},
        warnings: [
          'Package registry row was not found. Remove action can proceed as no-op.',
          ...sanitizeArray(dataOnlyPreview?.warnings)
        ],
        previewTransactionId: ''
      };
    }

    if (!presence.manifestResolved) {
      const blockedReasons = sanitizeArray(dataOnlyPreview?.blockedReasons);
      const modifiedRecords = sanitizeArray(dataOnlyPreview?.modifiedRecords);
      const previewWarnings = [
        cleanText(
          presence.manifestResolutionError || 'Manifest file was not found for this package. Registry-only remove is available.',
          1200
        ),
        'Declaration and manifest-based data rollback preview was skipped because package files are missing.',
        ...sanitizeArray(dataOnlyPreview?.warnings)
      ];
      const previewTransaction = await startLifecycleTransaction({
        packageId,
        packageName: cleanText(existing?.metadata?.packageName, 200) || packageId.toUpperCase(),
        packageVersion: cleanText(existing?.version, 120),
        action: 'uninstall-preview',
        metadata: {
          mode: 'registry_only_remove',
          manifestResolved: false
        },
        artifacts: {
          dataImpact: sanitizeObject(dataOnlyPreview?.dataImpact)
        }
      }, { backendMode, actor });
      const previewTransactionId = cleanText(previewTransaction?.id, 160);
      await completeLifecycleTransaction(previewTransactionId, {
        status: blockedReasons.length ? 'blocked' : 'success',
        phase: 'commit',
        warnings: previewWarnings,
        blockedReasons,
        modifiedRecords,
        artifacts: {
          dataImpact: sanitizeObject(dataOnlyPreview?.dataImpact)
        },
        summaryByEntity: {}
      }, { backendMode, actor });

      return {
        packageId,
        packageName: cleanText(existing?.metadata?.packageName, 200) || packageId.toUpperCase(),
        version: cleanText(existing?.version, 120),
        mode: 'registry_only_remove',
        blocked: blockedReasons.length > 0,
        blockedReasons,
        modifiedRecords,
        dataImpact: sanitizeObject(dataOnlyPreview?.dataImpact),
        summaryByEntity: {},
        warnings: previewWarnings,
        previewTransactionId
      };
    }

    const resolved = presence.resolved;

    const latestInstallTx = await findLatestSuccessfulInstallTransaction(packageId, { backendMode });
    const baselineRows = sanitizeArray(latestInstallTx?.artifacts?.afterSnapshots);
    const currentRows = await captureManifestSnapshots(resolved.manifest, { backendMode });
    const baselineMap = buildSnapshotLookup(baselineRows);
    const currentMap = buildSnapshotLookup(currentRows);
    const keys = new Set([...baselineMap.keys(), ...currentMap.keys()]);
    const modifiedRecords = [];

    keys.forEach((key) => {
      const baseline = baselineMap.get(key) || null;
      const current = currentMap.get(key) || null;
      const baselineHash = cleanText(baseline?.hash, 120) || hashPayload(baseline?.payload || null);
      const currentHash = cleanText(current?.hash, 120) || hashPayload(current?.payload || null);
      if (baselineHash === currentHash) return;
      modifiedRecords.push({
        entityType: cleanText(current?.entityType || baseline?.entityType, 80),
        identityKey: cleanText(current?.identityKey || baseline?.identityKey, 400),
        ownership: sanitizeObject(current?.ownership || baseline?.ownership),
        installedHash: baselineHash,
        currentHash,
        installedPayload: baseline?.payload || null,
        currentPayload: current?.payload || null
      });
    });

    const blockedReasons = modifiedRecords.length
      ? ['Detected customized package-owned records modified since install baseline.']
      : [];
    const previewWarnings = [];
    if (!latestInstallTx) {
      previewWarnings.push('No successful install baseline transaction was found. Review impact details carefully before force removal.');
    }
    if (dataOnlyPreview) {
      previewWarnings.push(...sanitizeArray(dataOnlyPreview.warnings));
      blockedReasons.push(...sanitizeArray(dataOnlyPreview.blockedReasons));
    }
    const mergedModifiedRecords = [
      ...modifiedRecords,
      ...sanitizeArray(dataOnlyPreview?.modifiedRecords)
    ];
    const mergedBlockedReasons = Array.from(new Set(blockedReasons.filter(Boolean)));

    const previewTransaction = await startLifecycleTransaction({
      packageId,
      packageName: cleanText(existing?.metadata?.packageName, 200) || packageId.toUpperCase(),
      packageVersion: cleanText(existing?.version, 120),
      action: 'uninstall-preview',
      metadata: {
        baselineTransactionId: cleanText(latestInstallTx?.id, 160)
      },
      artifacts: {
        baselineSnapshots: baselineRows,
        currentSnapshots: currentRows
      }
    }, { backendMode, actor });
    const previewTransactionId = cleanText(previewTransaction?.id, 160);
    await completeLifecycleTransaction(previewTransactionId, {
      status: mergedBlockedReasons.length ? 'blocked' : 'success',
      phase: 'commit',
      warnings: previewWarnings,
      blockedReasons: mergedBlockedReasons,
      modifiedRecords: mergedModifiedRecords,
      artifacts: {
        baselineSnapshots: baselineRows,
        currentSnapshots: currentRows,
        dataImpact: sanitizeObject(dataOnlyPreview?.dataImpact)
      }
    }, { backendMode, actor });

    const operationRows = mergedModifiedRecords.map((row) => ({
      entityType: row.entityType,
      identityKey: row.identityKey,
      ownership: row.ownership,
      operation: 'updated',
      reason: 'modified_since_install',
      beforePayload: row.installedPayload,
      afterPayload: row.currentPayload,
      beforeHash: row.installedHash,
      afterHash: row.currentHash
    }));
    await appendLifecycleOperations(previewTransactionId, operationRows, { backendMode, actor }).catch(() => null);

    return {
      packageId,
      packageName: cleanText(existing?.metadata?.packageName, 200) || packageId.toUpperCase(),
      version: cleanText(existing?.version, 120),
      mode: 'normal',
      blocked: mergedBlockedReasons.length > 0,
      blockedReasons: mergedBlockedReasons,
      modifiedRecords: mergedModifiedRecords,
      dataImpact: sanitizeObject(dataOnlyPreview?.dataImpact),
      summaryByEntity: createLifecycleSummaryByEntity(operationRows),
      warnings: previewWarnings,
      previewTransactionId
    };
  }

  async function removePackage(packageIdInput = '', options = {}) {
    const actor = buildActor(options.actor || null);
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const packageId = normalizePackageId(packageIdInput);
    if (!packageId) throw new Error('Package id is required.');
    const forceRemove = options.force === true;
    const previewTransactionId = cleanText(options.previewTransactionId, 160);
    const forceToken = cleanText(options.forceToken, 200);
    const expectedForceToken = `REMOVE ${packageId}`.toUpperCase();

    const preview = options.preview && typeof options.preview === 'object'
      ? options.preview
      : await previewPackageUninstallImpact(packageId, options);
    const hasRisk = sanitizeArray(preview?.modifiedRecords).length > 0;
    if (forceRemove) {
      if (!previewTransactionId) {
        const error = new Error('Force remove requires a valid uninstall preview transaction id.');
        error.code = 'UNINSTALL_FORCE_TOKEN_REQUIRED';
        throw error;
      }
      if (forceToken.toUpperCase() !== expectedForceToken) {
        const error = new Error(`Force remove confirmation token mismatch. Expected "${expectedForceToken}".`);
        error.code = 'UNINSTALL_FORCE_TOKEN_REQUIRED';
        throw error;
      }
      if (
        deps.packageLifecycleTransactionService
        && typeof deps.packageLifecycleTransactionService.getTransactionById === 'function'
      ) {
        const previewTx = await deps.packageLifecycleTransactionService.getTransactionById(previewTransactionId, { backendMode });
        const previewPackageId = normalizePackageId(previewTx?.packageId || '');
        if (!previewTx || previewPackageId !== packageId) {
          const error = new Error('Force remove preview token is invalid or belongs to another package.');
          error.code = 'UNINSTALL_FORCE_TOKEN_REQUIRED';
          throw error;
        }
      }
    }

    const lifecycleTx = await startLifecycleTransaction({
      packageId,
      packageName: cleanText(preview?.packageName, 200) || packageId.toUpperCase(),
      packageVersion: cleanText(preview?.version, 120),
      action: forceRemove ? 'remove-force' : 'remove',
      metadata: {
        force: forceRemove,
        previewTransactionId: cleanText(preview?.previewTransactionId, 160),
        providedPreviewTransactionId: previewTransactionId
      },
      artifacts: {
        modifiedRecords: sanitizeArray(preview?.modifiedRecords)
      }
    }, { backendMode, actor });
    const transactionId = cleanText(lifecycleTx?.id, 160);
    await markLifecyclePhase(transactionId, 'preflight', 'completed', {
      hasRisk,
      modifiedCount: sanitizeArray(preview?.modifiedRecords).length
    }, { backendMode, actor });
    await markLifecyclePhase(transactionId, 'apply', 'in_progress', {}, { backendMode, actor });

    const warnings = [];
    const existing = await deps.packageRegistryService.getPackageRegistryById(packageId, { backendMode });
    let declarationSummary = null;
    let manifest = null;
    let manifestPath = '';
    let mode = cleanText(preview?.mode, 80).toLowerCase() || 'normal';
    const lifecycleOperations = [];
    let dataLifecycleReport = {
      dataSummary: { migrations: { applied: 0, skipped: 0, failed: 0 }, seeders: { applied: 0, skipped: 0, failed: 0 } },
      appliedSteps: [],
      skippedSteps: [],
      failedStep: null,
      rollbackApplied: false,
      warnings: [],
      dataImpact: {}
    };

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
    if (!manifest) {
      mode = 'registry_only_remove';
    }

    if (manifest) {
      const context = {
        backendMode,
        packageId: manifest.id,
        packageName: manifest.name,
        manifest,
        manifestPath
      };
      if (
        deps.packageDataLifecycleService
        && typeof deps.packageDataLifecycleService.runPackageDataUninstallLifecycle === 'function'
      ) {
        dataLifecycleReport = await deps.packageDataLifecycleService.runPackageDataUninstallLifecycle(context, {
          backendMode,
          actor,
          transactionId,
          force: forceRemove,
          preview
        });
        warnings.push(...sanitizeArray(dataLifecycleReport?.warnings));
        lifecycleOperations.push(...dataLifecycleSummaryToOperations(dataLifecycleReport, {
          ownership: { packageId, packageName: cleanText(manifest?.name, 200) }
        }));
        if (dataLifecycleReport?.failedStep) {
          throw new Error(cleanText(dataLifecycleReport.failedStep.message, 1600) || 'Package data uninstall lifecycle failed.');
        }
      }

      declarationSummary = await deps.packageRegistryInstallerService.removePackageRegistryDeclarations(context, {
        action: 'remove',
        backendMode
      });
      lifecycleOperations.push(...declarationSummaryToLifecycleOperations(declarationSummary, {
        ownership: { packageId, packageName: cleanText(manifest?.name, 200) }
      }));
    } else {
      warnings.push('Declaration remove sync was skipped because manifest was unavailable.');
      warnings.push('Package data rollback was skipped because manifest-backed declarations were unavailable.');
      lifecycleOperations.push({
        entityType: 'packageManifest',
        identityKey: `packageId:${packageId}`,
        ownership: { packageId, packageName: cleanText(existing?.metadata?.packageName, 200) || packageId.toUpperCase() },
        operation: 'skipped',
        reason: 'Manifest unavailable; declaration/data rollback skipped.'
      });
    }

    const removed = await deps.packageRegistryService.removePackageRegistry(packageId, { backendMode });
    lifecycleOperations.push({
      entityType: 'packageRegistry',
      identityKey: `packageId:${packageId}`,
      ownership: { packageId, packageName: cleanText(manifest?.name || existing?.metadata?.packageName, 200) },
      operation: removed === true ? 'removed' : 'skipped',
      reason: removed === true ? 'Registry row removed.' : 'Registry row not found.'
    });
    const navigation = await refreshNavigationSnapshot({ backendMode });
    if (navigation.warning) warnings.push(navigation.warning);

    warnings.push('Runtime route unmount is not supported in-process; restart the app to fully remove mounted service routes.');
    await appendLifecycleOperations(transactionId, lifecycleOperations, { backendMode, actor }).catch(() => null);
    await markLifecyclePhase(transactionId, 'apply', 'completed', {
      registryRemoved: removed === true
    }, { backendMode, actor }).catch(() => null);
    await completeLifecycleTransaction(transactionId, {
      status: 'success',
      phase: 'commit',
      warnings,
      modifiedRecords: sanitizeArray(preview?.modifiedRecords),
      artifacts: {
        previewTransactionId: cleanText(preview?.previewTransactionId, 160),
        dataLifecycleReport
      },
      summaryByEntity: createLifecycleSummaryByEntity(lifecycleOperations)
    }, { backendMode, actor }).catch(() => null);

    return {
      action: 'remove',
      mode,
      packageId,
      packageName: cleanText(manifest?.name || existing?.metadata?.packageName || packageId.toUpperCase(), 200),
      version: cleanText(existing?.version || manifest?.version, 120),
      transactionId,
      phase: 'commit',
      summaryByEntity: createLifecycleSummaryByEntity(lifecycleOperations),
      blockedReasons: sanitizeArray(preview?.blockedReasons),
      modifiedRecords: sanitizeArray(preview?.modifiedRecords),
      dataImpact: sanitizeObject(dataLifecycleReport?.dataImpact),
      dataSummary: sanitizeObject(dataLifecycleReport?.dataSummary),
      appliedSteps: sanitizeArray(dataLifecycleReport?.appliedSteps),
      skippedSteps: sanitizeArray(dataLifecycleReport?.skippedSteps),
      failedStep: dataLifecycleReport?.failedStep || null,
      rollbackApplied: dataLifecycleReport?.rollbackApplied === true,
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

  async function listPackageTransactions(packageIdInput = '', options = {}) {
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const packageId = normalizePackageId(packageIdInput);
    if (!packageId) throw new Error('Package id is required.');
    if (!deps.packageLifecycleTransactionService || typeof deps.packageLifecycleTransactionService.listPackageTransactions !== 'function') {
      return [];
    }
    const rows = await deps.packageLifecycleTransactionService.listPackageTransactions(packageId, {
      backendMode,
      query: {
        packageId__eq: packageId,
        limit: readPositiveInt(options.limit, 50)
      }
    });
    return sanitizeArray(rows);
  }

  async function getPackageTransactionById(transactionIdInput = '', options = {}) {
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const transactionId = cleanText(transactionIdInput, 160);
    if (!transactionId) throw new Error('Transaction id is required.');
    if (!deps.packageLifecycleTransactionService || typeof deps.packageLifecycleTransactionService.getTransactionById !== 'function') {
      return null;
    }
    return deps.packageLifecycleTransactionService.getTransactionById(transactionId, { backendMode });
  }

  return {
    discoverLocalManifests,
    listPackageSnapshot,
    installPackage,
    installPackageZip,
    enablePackage,
    pausePackage,
    removePackage,
    syncPackage,
    previewPackageUninstallImpact,
    listPackageTransactions,
    getPackageTransactionById
  };
}

const defaultService = createService();

module.exports = {
  ...defaultService,
  createService,
  createDependencies
};
