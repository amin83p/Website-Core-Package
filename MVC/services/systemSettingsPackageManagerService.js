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
const {
  DEFAULT_PACKAGE_ROOT,
  getPackageStorageRootAbsolute,
  getPackageStorageRootCandidatesAbsolute
} = require('../utils/packageStoragePathUtils');

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
  if (token === 'zip') return 'zip';
  return '';
}

function normalizeCleanupMode(value = '') {
  const token = cleanText(value, 40).toLowerCase();
  if (token === 'keep-data') return 'keep-data';
  return 'full';
}

function normalizeDeleteSelection(value = null) {
  const source = sanitizeObject(value);
  const hasTables = Object.prototype.hasOwnProperty.call(source, 'tables');
  const hasFiles = Object.prototype.hasOwnProperty.call(source, 'files');
  const provided = source.provided === true || hasTables || hasFiles;
  const normalizeList = (input) => {
    if (Array.isArray(input)) {
      return input.map((item) => cleanText(item, 2000)).filter(Boolean);
    }
    if (typeof input === 'string') {
      return input.split(/\r?\n|,/).map((item) => cleanText(item, 2000)).filter(Boolean);
    }
    return [];
  };
  return {
    provided,
    tables: normalizeList(source.tables),
    files: normalizeList(source.files)
  };
}

function buildDeleteSelectionDecision(preview = {}, deleteSelectionInput = null) {
  const normalizedSelection = normalizeDeleteSelection(deleteSelectionInput);
  const tableRows = sanitizeArray(preview?.deletionInventory?.tables);
  const fileRows = sanitizeArray(preview?.deletionInventory?.files);
  const allowedTableIds = Array.from(new Set(
    tableRows.map((row) => cleanText(row?.id, 200)).filter(Boolean)
  ));
  const allowedFileIds = Array.from(new Set(
    fileRows.map((row) => cleanText(row?.id, 2000)).filter(Boolean)
  ));
  const allowedTableSet = new Set(allowedTableIds);
  const allowedFileSet = new Set(allowedFileIds);

  const resolvedTableIds = normalizedSelection.provided
    ? Array.from(new Set(normalizedSelection.tables))
    : allowedTableIds.slice();
  const resolvedFileIds = normalizedSelection.provided
    ? Array.from(new Set(normalizedSelection.files))
    : allowedFileIds.slice();

  const invalidTableIds = resolvedTableIds.filter((item) => !allowedTableSet.has(item));
  const invalidFileIds = resolvedFileIds.filter((item) => !allowedFileSet.has(item));
  if (invalidTableIds.length > 0 || invalidFileIds.length > 0) {
    const error = new Error('Delete selection includes unknown table/file ids.');
    error.code = 'PACKAGE_REMOVE_INVALID_SELECTION';
    error.details = {
      invalidTableIds,
      invalidFileIds
    };
    throw error;
  }

  return {
    provided: normalizedSelection.provided,
    tables: resolvedTableIds,
    files: resolvedFileIds,
    available: {
      tables: allowedTableIds.length,
      files: allowedFileIds.length
    }
  };
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

function normalizeIdList(value = []) {
  const source = Array.isArray(value) ? value : [];
  return Array.from(new Set(source.map((row) => cleanText(row, 220)).filter(Boolean)));
}

function countExpectedRuntimeUseRouteDeclarations(manifest = {}) {
  const declarations = Array.isArray(manifest?.routes) ? manifest.routes : [];
  return declarations.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    if (row.active === false) return false;
    if (row.metadataOnly === true) return false;
    const method = cleanText(row.method || 'USE', 20).toUpperCase();
    const router = cleanText(row.router || row.routerModule || row.routerModulePath || row.routerPath || '', 1200);
    return method === 'USE' && Boolean(router);
  }).length;
}

function buildRuntimeRouteMountError(context = {}, runtime = {}, reason = '') {
  const manifest = context?.manifest && typeof context.manifest === 'object' ? context.manifest : {};
  const routeSummary = runtime?.hooks?.routes || {};
  const error = new Error(
    reason || 'Runtime route mount failed for this package. Declarations were applied but runtime routes were not mounted correctly.'
  );
  error.code = 'PACKAGE_RUNTIME_ROUTE_MOUNT_FAILED';
  error.details = {
    packageId: cleanText(context?.packageId || manifest?.id, 120),
    packageName: cleanText(context?.packageName || manifest?.name, 200),
    mountPath: cleanText(manifest?.mountPath, 500),
    expectedUseRoutes: countExpectedRuntimeUseRouteDeclarations(manifest),
    runtimeRoutes: {
      requested: Number(routeSummary?.requested || 0),
      prepared: Number(routeSummary?.prepared || 0),
      mounted: Number(routeSummary?.mounted || 0),
      failed: Number(routeSummary?.failed || 0),
      results: sanitizeArray(routeSummary?.results)
    }
  };
  return error;
}

function assertRuntimeRouteMountHealth(context = {}, runtime = {}, options = {}) {
  const strict = options.strict === true;
  if (!strict) return;

  const manifest = context?.manifest && typeof context.manifest === 'object' ? context.manifest : {};
  const expectedUseRoutes = countExpectedRuntimeUseRouteDeclarations(manifest);
  if (expectedUseRoutes <= 0) return;

  const routesReport = runtime?.hooks?.routes || {};
  const failed = Number(routesReport?.failed || 0);
  const mounted = Number(routesReport?.mounted || 0);
  const alreadyMountedSkipped = sanitizeArray(routesReport?.results).filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const status = cleanText(row.status, 60).toLowerCase();
    if (status !== 'skipped') return false;
    const message = cleanText(row.message, 300).toLowerCase();
    return message.includes('already mounted in this process');
  }).length;
  const effectiveMounted = mounted + alreadyMountedSkipped;
  if (failed > 0) {
    throw buildRuntimeRouteMountError(context, runtime, 'Runtime route mount reported failed route declarations.');
  }
  if (effectiveMounted <= 0) {
    throw buildRuntimeRouteMountError(context, runtime, 'Runtime route mount reported zero mounted routes for active USE declarations.');
  }
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
  const upgradePreviewSessions = new Map();
  const UPGRADE_PREVIEW_TTL_MS = readPositiveInt(
    (overrides.env || process.env).PACKAGE_UPGRADE_PREVIEW_TTL_SECONDS,
    1800
  ) * 1000;
  const FAILED_ATTEMPT_MACHINE_MARKER = '[PACKAGE_FAILED_ATTEMPT]';
  const FAILED_ATTEMPT_REASON_CODES = {
    INSTALL_STATUS_FAILED: 'INSTALL_STATUS_FAILED',
    STARTUP_FAILURE_METADATA: 'STARTUP_FAILURE_METADATA',
    MACHINE_MARKER_WARNING: 'MACHINE_MARKER_WARNING',
    MACHINE_MARKER_ERROR: 'MACHINE_MARKER_ERROR'
  };

  function cleanupExpiredUpgradePreviewSessions(nowMs = Date.now()) {
    for (const [token, row] of upgradePreviewSessions.entries()) {
      const expiresAtMs = Number(row?.expiresAtMs || 0);
      if (!expiresAtMs || expiresAtMs <= nowMs) {
        upgradePreviewSessions.delete(token);
      }
    }
  }

  function issueUpgradePreviewAckToken(preview = {}, options = {}) {
    const isUpgrade = preview?.isUpgrade === true;
    const hasAckRequiredFindings = (
      Number(Array.isArray(preview?.blockingFindings) ? preview.blockingFindings.length : 0)
      + Number(Array.isArray(preview?.warningFindings) ? preview.warningFindings.length : 0)
    ) > 0;
    if (!isUpgrade || (preview?.requiresAcknowledgement !== true && !hasAckRequiredFindings)) return '';
    cleanupExpiredUpgradePreviewSessions();
    const token = crypto.randomBytes(24).toString('hex');
    const nowMs = Date.now();
    const expiresAtMs = nowMs + UPGRADE_PREVIEW_TTL_MS;
    upgradePreviewSessions.set(token, {
      token,
      packageId: normalizePackageId(preview?.packageId),
      currentVersion: cleanText(preview?.currentVersion, 120),
      nextVersion: cleanText(preview?.nextVersion, 120),
      installMethod: normalizeInstallMethod(options.installMethod || preview?.installMethod || ''),
      manifestChecksum: cleanText(options.manifestChecksum || '', 120),
      expiresAtMs,
      generatedAt: new Date(nowMs).toISOString(),
      previewSummary: {
        blockingCount: Number(preview?.blockingFindings?.length || 0),
        warningCount: Number(preview?.warningFindings?.length || 0)
      }
    });
    return token;
  }

  function validateUpgradePreviewAckToken(preview = {}, inputToken = '', options = {}) {
    const token = cleanText(inputToken, 240);
    const hasAckRequiredFindings = (
      Number(Array.isArray(preview?.blockingFindings) ? preview.blockingFindings.length : 0)
      + Number(Array.isArray(preview?.warningFindings) ? preview.warningFindings.length : 0)
    ) > 0;
    if (!preview?.isUpgrade || (preview?.requiresAcknowledgement !== true && !hasAckRequiredFindings)) {
      return { accepted: true, reason: 'not_required' };
    }
    cleanupExpiredUpgradePreviewSessions();
    if (!token) {
      const error = new Error('Upgrade preview acknowledgement is required before applying this package upgrade.');
      error.code = 'PACKAGE_UPGRADE_PREVIEW_REQUIRED';
      error.details = {
        packageId: normalizePackageId(preview?.packageId),
        currentVersion: cleanText(preview?.currentVersion, 120),
        nextVersion: cleanText(preview?.nextVersion, 120),
        blockingFindings: sanitizeArray(preview?.blockingFindings),
        warningFindings: sanitizeArray(preview?.warningFindings)
      };
      throw error;
    }
    const session = upgradePreviewSessions.get(token);
    if (!session) {
      const error = new Error('Upgrade preview acknowledgement token is invalid or expired. Re-run preview and confirm again.');
      error.code = 'PACKAGE_UPGRADE_PREVIEW_ACK_INVALID';
      throw error;
    }
    const expectedPackageId = normalizePackageId(preview?.packageId);
    const expectedNextVersion = cleanText(preview?.nextVersion, 120);
    const expectedMethod = normalizeInstallMethod(options.installMethod || preview?.installMethod || '');
    const expectedChecksum = cleanText(options.manifestChecksum || '', 120);
    const mismatched = (
      session.packageId !== expectedPackageId
      || session.nextVersion !== expectedNextVersion
      || (expectedMethod && session.installMethod && session.installMethod !== expectedMethod)
      || (expectedChecksum && session.manifestChecksum && session.manifestChecksum !== expectedChecksum)
    );
    if (mismatched) {
      const error = new Error('Upgrade preview acknowledgement does not match the selected package build. Re-run preview and confirm again.');
      error.code = 'PACKAGE_UPGRADE_PREVIEW_ACK_MISMATCH';
      error.details = {
        expected: {
          packageId: expectedPackageId,
          nextVersion: expectedNextVersion,
          installMethod: expectedMethod
        },
        actual: {
          packageId: session.packageId,
          nextVersion: session.nextVersion,
          installMethod: session.installMethod
        }
      };
      throw error;
    }
    upgradePreviewSessions.delete(token);
    return { accepted: true, reason: 'acknowledged' };
  }

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

  function buildPackageFilePurgePaths(packageId = '', options = {}) {
    const normalizedPackageId = normalizePackageId(packageId);
    if (!normalizedPackageId) {
      return [];
    }
    const configuredRoot = getPackageStorageRootAbsolute({
      packageRootDir: options.packageRootDir,
      ensureExists: false
    });
    const roots = [configuredRoot, DEFAULT_PACKAGE_ROOT]
      .map((root) => cleanText(root, 2000))
      .filter(Boolean)
      .filter((root, index, list) => list.findIndex((item) => item.toLowerCase() === root.toLowerCase()) === index);

    return roots.map((root) => ({
      root,
      path: deps.path.join(root, normalizedPackageId)
    }));
  }

  async function purgePackageFiles(packageId = '', options = {}) {
    const rows = buildPackageFilePurgePaths(packageId, options);
    const summary = {
      attemptedRoots: rows.map((row) => row.root),
      deletedPaths: [],
      missingPaths: [],
      failedPaths: []
    };
    for (const row of rows) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const exists = await pathExists(deps.fs, row.path);
        if (!exists) {
          summary.missingPaths.push(row.path);
          continue;
        }
        if (typeof deps.fs.rm !== 'function') {
          summary.failedPaths.push({
            path: row.path,
            message: 'File system rm() is unavailable in current runtime.'
          });
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await deps.fs.rm(row.path, { recursive: true, force: true });
        summary.deletedPaths.push(row.path);
      } catch (error) {
        summary.failedPaths.push({
          path: row.path,
          message: cleanText(error?.message || String(error), 500) || 'Unknown delete error.'
        });
      }
    }
    return summary;
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
    const upgradePreflight = sanitizeObject(resolved?.upgradePreflight);
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
          reinstallRecovery,
          upgradePreflightRequiredAck: upgradePreflight?.requiresAcknowledgement === true
        },
        artifacts: {
          previousRegistry,
          fileMutation: sanitizeObject(resolved.fileMutation),
          upgradePreflight
        }
      }, { backendMode, actor });
    const transactionId = cleanText(transaction?.id, 160);
    const beforeSnapshots = await captureManifestSnapshots(manifest, { backendMode });

    await markLifecyclePhase(transactionId, 'preflight', 'completed', {
      packageId,
      previousVersion: previousVersion || '',
      nextVersion,
      upgradePreflightRequiredAck: upgradePreflight?.requiresAcknowledgement === true,
      upgradePreflightBlockingCount: Number(upgradePreflight?.blockingFindings?.length || 0),
      upgradePreflightWarningCount: Number(upgradePreflight?.warningFindings?.length || 0)
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
      assertRuntimeRouteMountHealth(context, runtime, {
        strict: Boolean(options?.app && typeof options.app.use === 'function')
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
          builderPayloadReport,
          upgradePreflight
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
        upgradePreflight,
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
          dataLifecycleReport,
          upgradePreflight
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
    const packageRootDirs = getPackageStorageRootCandidatesAbsolute({ packageRootDir: options.packageRootDir });
    const manifestsByPackageId = new Map();

    for (const packageRootDir of packageRootDirs) {
      let dirEntries = [];
      try {
        // eslint-disable-next-line no-await-in-loop
        dirEntries = await deps.fs.readdir(packageRootDir, { withFileTypes: true });
      } catch (_) {
        continue;
      }

      for (const entry of dirEntries) {
        if (!entry || !entry.isDirectory()) continue;
        const manifestPath = path.join(packageRootDir, entry.name, 'package.manifest.json');
        // eslint-disable-next-line no-await-in-loop
        if (!(await fileExists(manifestPath))) continue;

        try {
          // eslint-disable-next-line no-await-in-loop
          const raw = JSON.parse(await deps.fs.readFile(manifestPath, 'utf8'));
          const manifest = deps.packageManifestService.validatePackageManifest(raw, { knownIds: [] });
          const normalizedPackageId = normalizePackageId(manifest.id);
          const candidateManifestPath = manifestPath.replace(/\\/g, '/');
          const existing = manifestsByPackageId.get(normalizedPackageId);
          const row = {
            packageId: manifest.id,
            name: manifest.name,
            version: manifest.version,
            mountPath: manifest.mountPath,
            manifestPath: candidateManifestPath,
            storedManifestPath: toStoredManifestPath(candidateManifestPath),
            declarationCounts: countDeclarations(manifest),
            valid: true
          };
          if (!existing || existing.valid !== true) {
            manifestsByPackageId.set(normalizedPackageId, row);
          }
        } catch (error) {
          const normalizedPackageId = normalizePackageId(entry.name);
          const candidateManifestPath = manifestPath.replace(/\\/g, '/');
          const existing = manifestsByPackageId.get(normalizedPackageId);
          if (!existing) {
            manifestsByPackageId.set(normalizedPackageId, {
              packageId: normalizedPackageId || '',
              name: cleanText(entry.name, 180),
              version: '',
              mountPath: '',
              manifestPath: candidateManifestPath,
              storedManifestPath: toStoredManifestPath(candidateManifestPath),
              declarationCounts: {},
              valid: false,
              error: cleanText(error?.message || String(error), 2000)
            });
          }
        }
      }
    }

    const manifests = Array.from(manifestsByPackageId.values());
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

  function normalizeManifestCandidatePath(inputPath = '') {
    const token = cleanText(inputPath, 1600).replace(/\\/g, '/');
    if (!token) return '';
    return token.replace(/\/+/g, '/');
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

  function collectManifestEntityTypes(manifest = {}) {
    const out = new Set();
    sanitizeArray(manifest?.dataEntities).forEach((row) => {
      if (typeof row === 'string') {
        const entity = cleanText(row, 200);
        if (entity) out.add(entity);
        return;
      }
      const source = sanitizeObject(row);
      const entity = cleanText(source.entityType || source.table || source.id, 200);
      if (entity) out.add(entity);
    });
    return Array.from(out);
  }

  async function collectBuilderPayloadEntityTypes(manifestContext = {}, options = {}) {
    if (
      !deps.packageBuilderService
      || typeof deps.packageBuilderService.previewBuilderPayloadDeletionInventory !== 'function'
    ) {
      return [];
    }
    try {
      const inventory = await deps.packageBuilderService.previewBuilderPayloadDeletionInventory({
        backendMode: cleanText(options.backendMode, 30) || undefined,
        packageId: cleanText(manifestContext?.manifest?.id, 120),
        packageName: cleanText(manifestContext?.manifest?.name, 200),
        manifest: manifestContext?.manifest || {},
        manifestPath: cleanText(manifestContext?.manifestPath, 2000)
      }, {
        backendMode: cleanText(options.backendMode, 30) || undefined,
        targetOrgId: cleanText(options.targetOrgId, 160)
      });
      return normalizeIdList(
        sanitizeArray(inventory?.tableRows).map((row) => cleanText(row?.entityType || row?.id, 200))
      );
    } catch (_) {
      return [];
    }
  }

  function buildDataSchemaMap(manifest = {}) {
    const map = new Map();
    sanitizeArray(manifest?.dataSchemas).forEach((row) => {
      const entityType = cleanText(row?.entityType, 200);
      if (!entityType) return;
      const key = entityType.toLowerCase();
      const signature = cleanText(row?.signature || row?.schemaHash, 200);
      map.set(key, {
        entityType,
        signature,
        fields: normalizeIdList(sanitizeArray(row?.fields).map((item) => cleanText(item, 240)))
      });
    });
    return map;
  }

  function resolveGuardScriptPath(packageDir = '', relativeScriptPath = '') {
    const safePackageDir = path.resolve(cleanText(packageDir, 2000));
    const scriptPath = cleanText(relativeScriptPath, 1800).replace(/\\/g, '/');
    if (!safePackageDir) throw new Error('Guard package directory is required.');
    if (!scriptPath) throw new Error('Guard script path is required.');
    if (path.isAbsolute(scriptPath)) throw new Error('Guard script path must be relative to package folder.');
    const absPath = path.resolve(safePackageDir, scriptPath);
    const rel = path.relative(safePackageDir, absPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Guard script escapes package boundary: ${relativeScriptPath}`);
    }
    return absPath;
  }

  async function executeUpgradeGuard(guard = {}, context = {}, options = {}) {
    const packageDir = path.dirname(path.resolve(cleanText(context?.manifestPath, 2000)));
    const scriptPath = resolveGuardScriptPath(packageDir, guard.script);
    if (!(await fileExists(scriptPath))) {
      throw new Error(`Upgrade guard script not found: ${guard.script}`);
    }
    let loaded;
    delete require.cache[require.resolve(scriptPath)];
    // eslint-disable-next-line global-require, import/no-dynamic-require
    loaded = require(scriptPath);
    const executable = typeof loaded === 'function'
      ? loaded
      : (typeof loaded?.run === 'function'
        ? loaded.run
        : (typeof loaded?.default === 'function' ? loaded.default : null));
    if (typeof executable !== 'function') {
      throw new Error(`Upgrade guard "${guard.id}" script does not export a runnable function.`);
    }
    const result = await Promise.resolve(executable({
      packageId: cleanText(context?.manifest?.id, 120),
      packageName: cleanText(context?.manifest?.name, 200),
      nextVersion: cleanText(context?.manifest?.version, 120),
      previousVersion: cleanText(context?.previousVersion, 120),
      currentManifest: context?.currentManifest || null,
      incomingManifest: context?.manifest || {},
      backendMode: cleanText(options.backendMode, 30) || 'json',
      targetOrgId: cleanText(options.targetOrgId, 120),
      operationContext: sanitizeObject(options.operationContext)
    }));
    const normalized = sanitizeObject(result);
    const status = cleanText(normalized.status, 40).toLowerCase() || 'ok';
    const message = cleanText(normalized.message, 1200);
    const warnings = sanitizeArray(normalized.warnings).map((row) => cleanText(row, 1200)).filter(Boolean);
    return {
      status,
      message,
      warnings,
      details: sanitizeObject(normalized.details)
    };
  }

  function buildPreflightFinding(category = '', code = '', severity = 'warning', message = '', details = {}) {
    return {
      category: cleanText(category, 80) || 'upgrade_preflight',
      code: cleanText(code, 120) || 'UPGRADE_PREFLIGHT',
      severity: cleanText(severity, 20).toLowerCase() === 'blocking' ? 'blocking' : 'warning',
      message: cleanText(message, 1600) || 'Upgrade compatibility review finding.',
      details: sanitizeObject(details)
    };
  }

  async function buildUpgradeCompatibilityPreview(resolved = {}, presence = {}, options = {}) {
    const manifest = resolved?.manifest || {};
    const packageId = normalizePackageId(manifest?.id);
    const packageName = cleanText(manifest?.name, 200);
    const nextVersion = cleanText(manifest?.version, 120);
    const currentVersion = cleanText(presence?.existing?.version, 120);
    const isUpgrade = Boolean(presence?.existing) && compareSemver(nextVersion, currentVersion || '0.0.0') > 0;
    const installMethod = normalizeInstallMethod(resolved?.installMethod || options.installMethod || '');
    const currentManifest = presence?.resolved?.manifest || null;
    const incomingManifestContext = {
      manifest,
      manifestPath: resolved?.manifestPath
    };
    const currentManifestContext = {
      manifest: currentManifest || {},
      manifestPath: presence?.resolved?.manifestPath || ''
    };

    const incomingEntities = new Set(collectManifestEntityTypes(manifest));
    const currentEntities = new Set(collectManifestEntityTypes(currentManifest || {}));
    const incomingPayloadEntities = await collectBuilderPayloadEntityTypes(incomingManifestContext, options);
    incomingPayloadEntities.forEach((entity) => incomingEntities.add(entity));
    if (currentManifest) {
      const currentPayloadEntities = await collectBuilderPayloadEntityTypes(currentManifestContext, options);
      currentPayloadEntities.forEach((entity) => currentEntities.add(entity));
    }

    const newEntities = Array.from(incomingEntities)
      .filter((entity) => !currentEntities.has(entity))
      .sort((a, b) => a.localeCompare(b))
      .map((entityType) => ({ entityType, reasonCode: 'NEW_ENTITY' }));

    const incomingSchemaMap = buildDataSchemaMap(manifest);
    const currentSchemaMap = buildDataSchemaMap(currentManifest || {});
    const schemaChanges = [];
    const keys = new Set([...incomingSchemaMap.keys(), ...currentSchemaMap.keys()]);
    keys.forEach((key) => {
      const nextRow = incomingSchemaMap.get(key) || null;
      const prevRow = currentSchemaMap.get(key) || null;
      if (!prevRow && nextRow) {
        schemaChanges.push({
          entityType: nextRow.entityType,
          changeType: 'added',
          previousSignature: '',
          nextSignature: nextRow.signature || '',
          reasonCode: 'DATA_SCHEMA_ADDED'
        });
        return;
      }
      if (prevRow && !nextRow) {
        schemaChanges.push({
          entityType: prevRow.entityType,
          changeType: 'removed',
          previousSignature: prevRow.signature || '',
          nextSignature: '',
          reasonCode: 'DATA_SCHEMA_REMOVED'
        });
        return;
      }
      if (!prevRow || !nextRow) return;
      if (cleanText(prevRow.signature, 200) !== cleanText(nextRow.signature, 200)) {
        schemaChanges.push({
          entityType: nextRow.entityType,
          changeType: 'signature_changed',
          previousSignature: prevRow.signature || '',
          nextSignature: nextRow.signature || '',
          reasonCode: 'DATA_SCHEMA_SIGNATURE_CHANGED'
        });
      }
    });

    const behaviorChecks = [];
    if (isUpgrade) {
      const guardRows = sanitizeArray(manifest?.upgradeGuards);
      for (const guard of guardRows) {
        const guardVersion = cleanText(guard?.version, 120);
        if (currentVersion && compareSemver(guardVersion, currentVersion) <= 0) {
          // eslint-disable-next-line no-continue
          continue;
        }
        const backendModes = sanitizeArray(guard?.backendModes).map((row) => cleanText(row, 40).toLowerCase());
        const backendMode = cleanText(options.backendMode, 40).toLowerCase() || 'json';
        if (backendModes.length && !backendModes.includes(backendMode)) {
          behaviorChecks.push({
            guardId: cleanText(guard?.id, 200),
            version: guardVersion,
            severity: cleanText(guard?.severity, 20) || 'blocking',
            status: 'skipped',
            code: 'UPGRADE_GUARD_SKIPPED_BACKEND',
            message: `Guard skipped for backend "${backendMode}".`,
            details: {}
          });
          // eslint-disable-next-line no-continue
          continue;
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          const result = await executeUpgradeGuard(guard, {
            manifest,
            manifestPath: resolved?.manifestPath,
            currentManifest,
            previousVersion: currentVersion
          }, options);
          const status = result.status === 'blocking' || result.status === 'warning'
            ? result.status
            : 'ok';
          behaviorChecks.push({
            guardId: cleanText(guard?.id, 200),
            version: guardVersion,
            severity: cleanText(guard?.severity, 20) || 'blocking',
            status,
            code: status === 'ok' ? 'UPGRADE_GUARD_OK' : 'UPGRADE_GUARD_REPORTED',
            message: result.message || `Upgrade guard "${cleanText(guard?.id, 200)}" completed.`,
            details: result.details || {},
            warnings: result.warnings || []
          });
        } catch (error) {
          behaviorChecks.push({
            guardId: cleanText(guard?.id, 200),
            version: guardVersion,
            severity: cleanText(guard?.severity, 20) || 'blocking',
            status: 'blocking',
            code: 'UPGRADE_GUARD_EXECUTION_FAILED',
            message: cleanText(error?.message || String(error), 1200) || 'Upgrade guard execution failed.',
            details: {}
          });
        }
      }
    }

    const findings = [];
    newEntities.forEach((row) => {
      findings.push(buildPreflightFinding(
        'new_entities',
        row.reasonCode || 'NEW_ENTITY',
        'blocking',
        `New entity/table "${row.entityType}" will be introduced by this package upgrade.`,
        row
      ));
    });
    schemaChanges.forEach((row) => {
      findings.push(buildPreflightFinding(
        'schema_changes',
        row.reasonCode || 'DATA_SCHEMA_CHANGED',
        'blocking',
        `Data schema contract changed for "${row.entityType}" (${row.changeType}).`,
        row
      ));
    });
    behaviorChecks.forEach((row) => {
      const status = cleanText(row?.status, 20).toLowerCase();
      if (status === 'ok' || status === 'skipped') return;
      const guardSeverity = cleanText(row?.severity, 20).toLowerCase() === 'warning' ? 'warning' : 'blocking';
      const effectiveSeverity = status === 'blocking' ? 'blocking' : guardSeverity;
      findings.push(buildPreflightFinding(
        'behavior_compat',
        cleanText(row?.code, 120) || 'UPGRADE_GUARD_REPORTED',
        effectiveSeverity,
        row?.message || `Upgrade guard "${row?.guardId || ''}" reported compatibility issues.`,
        row
      ));
    });

    if (isUpgrade && (!sanitizeArray(manifest?.dataSchemas).length || !sanitizeArray(currentManifest?.dataSchemas).length)) {
      findings.push(buildPreflightFinding(
        'contract',
        'DATA_SCHEMA_CONTRACT_INCOMPLETE',
        'warning',
        'Data schema contract is missing in current or incoming manifest. Confirm upgrade impact before apply.',
        {
          currentHasDataSchemas: sanitizeArray(currentManifest?.dataSchemas).length > 0,
          nextHasDataSchemas: sanitizeArray(manifest?.dataSchemas).length > 0
        }
      ));
    }
    if (isUpgrade && !sanitizeArray(manifest?.upgradeGuards).length) {
      findings.push(buildPreflightFinding(
        'contract',
        'UPGRADE_GUARD_CONTRACT_MISSING',
        'warning',
        'Incoming manifest does not declare upgrade compatibility guards. Confirm upgrade manually before apply.',
        {}
      ));
    }

    const blockingFindings = findings.filter((row) => row.severity === 'blocking');
    const warningFindings = findings.filter((row) => row.severity !== 'blocking');
    const requiresAcknowledgement = isUpgrade && findings.length > 0;
    const manifestChecksum = hashPayload({
      id: packageId,
      version: nextVersion,
      dataSchemas: sanitizeArray(manifest?.dataSchemas),
      upgradeGuards: sanitizeArray(manifest?.upgradeGuards),
      dataEntities: sanitizeArray(manifest?.dataEntities)
    });

    return {
      action: 'install-preview',
      isUpgrade,
      installMethod,
      packageId,
      packageName,
      currentVersion,
      nextVersion,
      newEntities,
      schemaChanges,
      behaviorChecks,
      blockingFindings,
      warningFindings,
      requiresAcknowledgement,
      manifestChecksum,
      ackToken: '',
      warnings: []
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
      const startupFailureMap = options?.startupFailureByPackage && typeof options.startupFailureByPackage === 'object'
        ? options.startupFailureByPackage
        : {};
      const startupFailure = startupFailureMap[packageId] && typeof startupFailureMap[packageId] === 'object'
        ? startupFailureMap[packageId]
        : null;
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
        startupFailure: startupFailure
          ? {
              code: cleanText(startupFailure?.code, 120).toUpperCase(),
              message: cleanText(startupFailure?.message, 1200),
              missingManifest: startupFailure?.missingManifest === true,
              autoDisabled: startupFailure?.autoDisabled === true
            }
          : null,
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
    const packageRuntimeRouter = options?.packageRuntimeRouter
      || app?.locals?.packageRuntimeRouter
      || null;
    const routesApp = packageRuntimeRouter && typeof packageRuntimeRouter.use === 'function'
      ? packageRuntimeRouter
      : app;
    const assetsApp = routesApp;
    const viewsApp = app && typeof app.get === 'function' && typeof app.set === 'function'
      ? app
      : routesApp;
    if (!routesApp || typeof routesApp.use !== 'function') {
      warnings.push('Runtime hook registration skipped because Express app context is unavailable in this request.');
      return {
        attempted: false,
        warnings,
        hooks: {},
        mountTarget: {
          routes: 'none',
          views: 'none',
          assets: 'none'
        }
      };
    }

    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const hooks = deps.packageRegistryInstallerService.createLoaderHooks({ backendMode });
    const runtimeContext = sanitizeObject(context);
    const report = {};

    try {
      report.routes = await hooks.registerRoutes({
        ...runtimeContext,
        app: routesApp
      });
      report.views = await hooks.registerViews({
        ...runtimeContext,
        app: viewsApp
      });
      report.assets = await hooks.registerAssets({
        ...runtimeContext,
        app: assetsApp
      });
      report.queryExecutors = await hooks.registerQueryExecutors(runtimeContext);
    } catch (error) {
      warnings.push(cleanText(error?.message || String(error), 1200) || 'Runtime hooks reported an error.');
    }

    return {
      attempted: true,
      warnings,
      hooks: report,
      mountTarget: {
        routes: routesApp === packageRuntimeRouter ? 'packageRuntimeRouter' : 'app',
        views: viewsApp === app ? 'app' : (viewsApp === packageRuntimeRouter ? 'packageRuntimeRouter' : 'none'),
        assets: assetsApp === packageRuntimeRouter ? 'packageRuntimeRouter' : 'app'
      }
    };
  }

  function buildRegistryPayload(manifest = {}, options = {}) {
    const mode = cleanText(options.mode, 40).toLowerCase() || 'enable';
    const packageSource = cleanText(options.packageSource, 120) || 'manual';
    const clearWarnings = mode === 'enable';
    return {
      packageId: manifest.id,
      version: manifest.version,
      enabled: mode === 'enable',
      installStatus: mode === 'remove' ? 'removed' : mode === 'disable' ? 'disabled' : 'enabled',
      ...(clearWarnings ? { lastWarning: '', lastError: '' } : {}),
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
      const normalizedLocalPath = normalizeManifestCandidatePath(localPath);
      const selected = localRows.find((row) => {
        const rowStoredPath = normalizeManifestCandidatePath(row?.storedManifestPath);
        const rowManifestPath = normalizeManifestCandidatePath(row?.manifestPath);
        return rowStoredPath === normalizedLocalPath || rowManifestPath === normalizedLocalPath;
      });
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

  function buildPreviewResponse(preview = {}, options = {}) {
    const installMethod = normalizeInstallMethod(options.installMethod || preview?.installMethod || '');
    const token = issueUpgradePreviewAckToken(preview, {
      installMethod,
      manifestChecksum: cleanText(preview?.manifestChecksum, 120)
    });
    const session = token ? upgradePreviewSessions.get(token) : null;
    return {
      ...preview,
      action: cleanText(options.action, 80) || 'install-preview',
      installMethod,
      ackToken: token,
      ackExpiresAt: session ? new Date(Number(session.expiresAtMs || 0)).toISOString() : '',
      generatedAt: new Date().toISOString()
    };
  }

  async function previewPackageInstall(input = {}, options = {}) {
    const resolved = await resolveInstallManifest(input, options);
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const packageId = normalizePackageId(resolved?.manifest?.id || '');
    const presence = packageId
      ? await inspectPackagePresence(packageId, { ...options, backendMode })
      : { existing: null, resolved: null };
    const preview = await buildUpgradeCompatibilityPreview(resolved, presence, {
      ...options,
      installMethod: resolved?.installMethod || 'path',
      backendMode
    });
    return buildPreviewResponse(preview, {
      action: 'install-preview',
      installMethod: resolved?.installMethod || 'path'
    });
  }

  async function installPackage(input = {}, options = {}) {
    const resolved = await resolveInstallManifest(input, options);
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const packageId = normalizePackageId(resolved?.manifest?.id || '');
    const presence = packageId
      ? await inspectPackagePresence(packageId, { ...options, backendMode })
      : { resolved: null, missingFilesRecoveryEligible: false };
    const preflight = await buildUpgradeCompatibilityPreview(resolved, presence, {
      ...options,
      installMethod: resolved?.installMethod || 'path',
      backendMode
    });
    validateUpgradePreviewAckToken(preflight, cleanText(input?.upgradeAckToken, 240), {
      installMethod: resolved?.installMethod || 'path',
      manifestChecksum: cleanText(preflight?.manifestChecksum, 120)
    });
    return installResolvedManifest({
      ...resolved,
      action: 'install',
      packageSource: 'manual',
      previousResolved: presence.resolved || null,
      allowSameVersionRecovery: presence.missingFilesRecoveryEligible === true,
      upgradePreflight: preflight
    }, options);
  }

  async function previewPackageInstallZip(input = {}, options = {}) {
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

    const stagingRoot = await deps.fs.mkdtemp(path.join(os.tmpdir(), 'pkg-preview-zip-'));
    try {
      const extracted = await extractZipToStaging(zipBuffer, stagingRoot);
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
      const resolved = {
        installMethod: 'zip',
        manifest,
        manifestPath: extracted.manifestPath,
        activationMode: 'manual-zip-preview'
      };
      const preview = await buildUpgradeCompatibilityPreview(resolved, presence, {
        ...options,
        installMethod: 'zip',
        backendMode
      });
      return buildPreviewResponse(preview, {
        action: 'install-zip-preview',
        installMethod: 'zip'
      });
    } finally {
      await deps.fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    }
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
      const preflight = await buildUpgradeCompatibilityPreview({
        installMethod: 'zip',
        manifest,
        manifestPath: extracted.manifestPath,
        activationMode: 'manual-zip'
      }, presence, {
        ...options,
        installMethod: 'zip',
        backendMode
      });
      validateUpgradePreviewAckToken(preflight, cleanText(input?.upgradeAckToken, 240), {
        installMethod: 'zip',
        manifestChecksum: cleanText(preflight?.manifestChecksum, 120)
      });
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
        allowSameVersionRecovery: presence.missingFilesRecoveryEligible === true,
        upgradePreflight: preflight
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
    try {
      assertRuntimeRouteMountHealth(context, runtime, {
        strict: Boolean(options?.app && typeof options.app.use === 'function')
      });
    } catch (runtimeError) {
      await deps.packageRegistryService.setPackageEnabled(packageId, false, {
        backendMode,
        actor
      }).catch(() => null);
      throw runtimeError;
    }
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

  function resolveTargetOrgIdFromInstallTransaction(transaction = {}) {
    const direct = cleanText(
      transaction?.artifacts?.builderPayloadReport?.targetOrgId
      || transaction?.artifacts?.builderPayload?.targetOrgId
      || '',
      120
    );
    if (!direct) return '';
    return direct.replace(/^ORG_/i, '');
  }

  function buildCriticalDeletionInventory(packageId = '') {
    const normalizedPackageId = normalizePackageId(packageId);
    return [
      {
        id: 'critical:registry',
        label: `Remove package registry row (${normalizedPackageId || 'package'})`,
        mandatory: true,
        selected: true
      },
      {
        id: 'critical:declarations',
        label: 'Remove package declarations (sections/roles/symbols/access/routes metadata)',
        mandatory: true,
        selected: true
      },
      {
        id: 'critical:source',
        label: 'Remove package source folder from package storage root',
        mandatory: true,
        selected: true
      }
    ];
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
    const deletionInventory = {
      critical: buildCriticalDeletionInventory(packageId),
      tables: [],
      files: [],
      summary: {
        tableCount: 0,
        fileCount: 0
      }
    };
    if (!existing) {
      return {
        packageId,
        mode: 'registry_only_remove',
        blocked: Boolean(dataOnlyPreview?.blocked),
        blockedReasons: sanitizeArray(dataOnlyPreview?.blockedReasons),
        modifiedRecords: sanitizeArray(dataOnlyPreview?.modifiedRecords),
        dataImpact: sanitizeObject(dataOnlyPreview?.dataImpact),
        summaryByEntity: {},
        deletionInventory,
        warnings: [
          'Package registry row was not found. Remove action can proceed as no-op.',
          ...sanitizeArray(dataOnlyPreview?.warnings)
        ],
        previewTransactionId: ''
      };
    }

    if (!presence.manifestResolved) {
      const blockedReasons = [
        cleanText(
          presence.manifestResolutionError || 'Manifest file was not found for this package. Full cleanup remove is blocked.',
          1200
        ),
        ...sanitizeArray(dataOnlyPreview?.blockedReasons)
      ].filter(Boolean);
      const modifiedRecords = sanitizeArray(dataOnlyPreview?.modifiedRecords);
      const previewWarnings = [
        'Full cleanup remove requires a resolvable package manifest and builder payload files.',
        ...sanitizeArray(dataOnlyPreview?.warnings)
      ];
      const previewTransaction = await startLifecycleTransaction({
        packageId,
        packageName: cleanText(existing?.metadata?.packageName, 200) || packageId.toUpperCase(),
        packageVersion: cleanText(existing?.version, 120),
        action: 'uninstall-preview',
        metadata: {
          mode: 'blocked_missing_manifest',
          manifestResolved: false
        },
        artifacts: {
          dataImpact: sanitizeObject(dataOnlyPreview?.dataImpact)
        }
      }, { backendMode, actor });
      const previewTransactionId = cleanText(previewTransaction?.id, 160);
      await completeLifecycleTransaction(previewTransactionId, {
        status: 'blocked',
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
        mode: 'blocked_missing_manifest',
        blocked: true,
        blockedReasons,
        modifiedRecords,
        dataImpact: sanitizeObject(dataOnlyPreview?.dataImpact),
        summaryByEntity: {},
        deletionInventory,
        warnings: previewWarnings,
        previewTransactionId
      };
    }

    const resolved = presence.resolved;
    let builderDeletionInventory = {
      payloadFound: false,
      orgRemapRequired: false,
      targetOrgId: '',
      tableRows: [],
      fileRows: [],
      warnings: []
    };

    const latestInstallTx = await findLatestSuccessfulInstallTransaction(packageId, { backendMode });
    const installedTargetOrgId = resolveTargetOrgIdFromInstallTransaction(latestInstallTx);
    if (
      deps.packageBuilderService
      && typeof deps.packageBuilderService.previewBuilderPayloadDeletionInventory === 'function'
    ) {
      try {
        builderDeletionInventory = await deps.packageBuilderService.previewBuilderPayloadDeletionInventory({
          backendMode,
          packageId: resolved.manifest.id,
          packageName: resolved.manifest.name,
          manifest: resolved.manifest,
          manifestPath: resolved.manifestPath
        }, {
          backendMode,
          targetOrgId: installedTargetOrgId || cleanText(options.targetOrgId, 160)
        });
      } catch (error) {
        builderDeletionInventory = {
          payloadFound: false,
          orgRemapRequired: false,
          targetOrgId: '',
          tableRows: [],
          fileRows: [],
          warnings: [cleanText(error?.message || String(error), 1200)]
        };
      }
    }
    deletionInventory.tables = sanitizeArray(builderDeletionInventory?.tableRows);
    deletionInventory.files = sanitizeArray(builderDeletionInventory?.fileRows);
    deletionInventory.summary = {
      tableCount: deletionInventory.tables.length,
      fileCount: deletionInventory.files.length
    };

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
    previewWarnings.push(...sanitizeArray(builderDeletionInventory?.warnings));
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
      deletionInventory,
      warnings: previewWarnings,
      previewTransactionId
    };
  }

  async function removePackage(packageIdInput = '', options = {}) {
    const actor = buildActor(options.actor || null);
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const packageId = normalizePackageId(packageIdInput);
    if (!packageId) throw new Error('Package id is required.');
    const cleanupMode = normalizeCleanupMode(options.cleanupMode);
    const forceRemove = options.force === true;
    const destructiveCleanup = cleanupMode !== 'keep-data' || forceRemove;
    const appliedCleanupMode = destructiveCleanup ? 'full' : 'keep-data';

    const preview = options.preview && typeof options.preview === 'object'
      ? options.preview
      : await previewPackageUninstallImpact(packageId, options);
    const hasRisk = sanitizeArray(preview?.modifiedRecords).length > 0;
    const deleteSelectionDecision = destructiveCleanup
      ? buildDeleteSelectionDecision(preview, options.deleteSelection)
      : {
        provided: normalizeDeleteSelection(options.deleteSelection).provided,
        tables: [],
        files: [],
        available: { tables: 0, files: 0 }
      };

    const lifecycleTx = await startLifecycleTransaction({
      packageId,
      packageName: cleanText(preview?.packageName, 200) || packageId.toUpperCase(),
      packageVersion: cleanText(preview?.version, 120),
      action: destructiveCleanup ? 'remove' : 'remove-keep-data',
      metadata: {
        force: forceRemove,
        cleanupMode: appliedCleanupMode,
        previewTransactionId: cleanText(preview?.previewTransactionId, 160),
        providedPreviewTransactionId: cleanText(options.previewTransactionId, 160),
        deleteSelectionProvided: deleteSelectionDecision.provided === true
      },
      artifacts: {
        modifiedRecords: sanitizeArray(preview?.modifiedRecords),
        deleteSelection: {
          tables: deleteSelectionDecision.tables,
          files: deleteSelectionDecision.files
        }
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
    let mode = appliedCleanupMode === 'full' ? 'full_cleanup' : 'keep_data';
    const lifecycleOperations = [];
    let payloadCleanupReport = {
      applied: false,
      payloadFound: false,
      orgRemapRequired: false,
      targetOrgId: '',
      rowSummary: { deleted: 0, skipped: 0, failed: 0, skippedWithoutId: [] },
      fileSummary: { deleted: 0, skipped: 0, failed: 0 },
      warnings: []
    };
    let dataLifecycleReport = {
      dataSummary: { migrations: { applied: 0, skipped: 0, failed: 0 }, seeders: { applied: 0, skipped: 0, failed: 0 } },
      appliedSteps: [],
      skippedSteps: [],
      failedStep: null,
      rollbackApplied: false,
      warnings: [],
      dataImpact: {}
    };
    let selectionApplied = {
      tablesSelected: deleteSelectionDecision.tables.length,
      filesSelected: deleteSelectionDecision.files.length
    };
    let inventorySummary = {
      tables: {
        available: deleteSelectionDecision.available.tables,
        selected: deleteSelectionDecision.tables.length,
        deleted: 0,
        retained: 0,
        failed: 0,
        skipped: 0
      },
      files: {
        available: deleteSelectionDecision.available.files,
        selected: deleteSelectionDecision.files.length,
        deleted: 0,
        retained: 0,
        failed: 0,
        skipped: 0
      }
    };
    let filePurgeSummary = {
      attemptedRoots: [],
      deletedPaths: [],
      missingPaths: [],
      failedPaths: []
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
      if (destructiveCleanup && existing) {
        const error = new Error(
          cleanText(preview?.blockedReasons?.[0], 1200)
          || 'Package manifest/payload is unavailable. Full cleanup remove is blocked to prevent orphaned package data.'
        );
        error.code = 'PACKAGE_REMOVE_MANIFEST_REQUIRED';
        throw error;
      }
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
      if (destructiveCleanup) {
        const latestInstallTx = await findLatestSuccessfulInstallTransaction(packageId, { backendMode });
        const installedTargetOrgId = resolveTargetOrgIdFromInstallTransaction(latestInstallTx);
        if (
          deps.packageBuilderService
          && typeof deps.packageBuilderService.removeBuilderPayloadIfPresent === 'function'
        ) {
          payloadCleanupReport = await deps.packageBuilderService.removeBuilderPayloadIfPresent(context, {
            backendMode,
            actor,
            targetOrgId: installedTargetOrgId || cleanText(options.targetOrgId, 160),
            requirePayload: true,
            deleteSelection: {
              provided: true,
              tables: deleteSelectionDecision.tables,
              files: deleteSelectionDecision.files
            }
          });
          selectionApplied = sanitizeObject(payloadCleanupReport?.selectionApplied) && Object.keys(sanitizeObject(payloadCleanupReport?.selectionApplied)).length
            ? sanitizeObject(payloadCleanupReport.selectionApplied)
            : selectionApplied;
          inventorySummary = {
            tables: {
              available: deleteSelectionDecision.available.tables,
              selected: Number(selectionApplied.tablesSelected || deleteSelectionDecision.tables.length) || 0,
              deleted: Number(payloadCleanupReport?.tableSummary?.deleted || 0) || 0,
              retained: Number(payloadCleanupReport?.tableSummary?.retained || 0) || 0,
              failed: Number(payloadCleanupReport?.tableSummary?.failed || 0) || 0,
              skipped: Number(payloadCleanupReport?.tableSummary?.skipped || 0) || 0
            },
            files: {
              available: deleteSelectionDecision.available.files,
              selected: Number(selectionApplied.filesSelected || deleteSelectionDecision.files.length) || 0,
              deleted: Number(payloadCleanupReport?.fileSummary?.deleted || 0) || 0,
              retained: Number(payloadCleanupReport?.fileSummary?.retained || 0) || 0,
              failed: Number(payloadCleanupReport?.fileSummary?.failed || 0) || 0,
              skipped: Number(payloadCleanupReport?.fileSummary?.skipped || 0) || 0
            }
          };
          warnings.push(...sanitizeArray(payloadCleanupReport?.warnings));
          lifecycleOperations.push({
            entityType: 'builderPayload',
            identityKey: `packageId:${packageId}`,
            ownership: { packageId, packageName: cleanText(manifest?.name, 200) },
            operation: payloadCleanupReport?.applied === true ? 'removed' : 'skipped',
            reason: payloadCleanupReport?.applied === true
              ? 'Builder payload rows/files removed.'
              : 'Builder payload cleanup skipped.',
            afterPayload: sanitizeObject(payloadCleanupReport),
            afterHash: hashPayload(sanitizeObject(payloadCleanupReport))
          });
        } else {
          const error = new Error('Builder payload cleanup service is unavailable in current runtime.');
          error.code = 'PACKAGE_REMOVE_PAYLOAD_SERVICE_UNAVAILABLE';
          throw error;
        }
      }
      if (
        deps.packageDataLifecycleService
        && typeof deps.packageDataLifecycleService.runPackageDataUninstallLifecycle === 'function'
      ) {
        dataLifecycleReport = await deps.packageDataLifecycleService.runPackageDataUninstallLifecycle(context, {
          backendMode,
          actor,
          transactionId,
          cleanupMode: appliedCleanupMode,
          force: false,
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
    filePurgeSummary = await purgePackageFiles(packageId, options);
    filePurgeSummary.deletedPaths.forEach((targetPath) => {
      lifecycleOperations.push({
        entityType: 'packageFiles',
        identityKey: `path:${targetPath}`,
        ownership: { packageId, packageName: cleanText(manifest?.name || existing?.metadata?.packageName, 200) },
        operation: 'removed',
        reason: 'Package source folder removed as part of package uninstall.'
      });
    });
    filePurgeSummary.missingPaths.forEach((targetPath) => {
      lifecycleOperations.push({
        entityType: 'packageFiles',
        identityKey: `path:${targetPath}`,
        ownership: { packageId, packageName: cleanText(manifest?.name || existing?.metadata?.packageName, 200) },
        operation: 'skipped',
        reason: 'Package source folder was not found.'
      });
    });
    filePurgeSummary.failedPaths.forEach((row) => {
      warnings.push(`Failed to delete package folder "${row.path}": ${row.message}`);
      lifecycleOperations.push({
        entityType: 'packageFiles',
        identityKey: `path:${cleanText(row.path, 2000)}`,
        ownership: { packageId, packageName: cleanText(manifest?.name || existing?.metadata?.packageName, 200) },
        operation: 'skipped',
        reason: `Delete failed: ${cleanText(row.message, 500)}`
      });
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
        cleanupMode: appliedCleanupMode,
        previewTransactionId: cleanText(preview?.previewTransactionId, 160),
        selectionApplied,
        inventorySummary,
        payloadCleanupReport,
        dataLifecycleReport,
        filePurgeSummary
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
      cleanupMode: appliedCleanupMode,
      selectionApplied,
      inventorySummary,
      summaryByEntity: createLifecycleSummaryByEntity(lifecycleOperations),
      blockedReasons: sanitizeArray(preview?.blockedReasons),
      modifiedRecords: sanitizeArray(preview?.modifiedRecords),
      payloadCleanupReport: sanitizeObject(payloadCleanupReport),
      dataImpact: sanitizeObject(dataLifecycleReport?.dataImpact),
      dataSummary: sanitizeObject(dataLifecycleReport?.dataSummary),
      appliedSteps: sanitizeArray(dataLifecycleReport?.appliedSteps),
      skippedSteps: sanitizeArray(dataLifecycleReport?.skippedSteps),
      failedStep: dataLifecycleReport?.failedStep || null,
      rollbackApplied: dataLifecycleReport?.rollbackApplied === true,
      filePurgeSummary: sanitizeObject(filePurgeSummary),
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

  function buildFailedAttemptCandidatePreview(row = {}) {
    const reasonCodes = [];
    const status = cleanText(row?.installStatus, 80).toLowerCase();
    if (status === 'failed') {
      reasonCodes.push(FAILED_ATTEMPT_REASON_CODES.INSTALL_STATUS_FAILED);
    }

    const startupFailure = row?.startupFailure && typeof row.startupFailure === 'object'
      ? row.startupFailure
      : null;
    if (
      startupFailure
      && (
        startupFailure?.missingManifest === true
        || startupFailure?.autoDisabled === true
        || cleanText(startupFailure?.code, 120)
        || cleanText(startupFailure?.message, 1200)
      )
    ) {
      reasonCodes.push(FAILED_ATTEMPT_REASON_CODES.STARTUP_FAILURE_METADATA);
    }

    const lastWarning = cleanText(row?.lastWarning, 1200);
    const lastError = cleanText(row?.lastError, 1200);
    if (lastWarning.includes(FAILED_ATTEMPT_MACHINE_MARKER)) {
      reasonCodes.push(FAILED_ATTEMPT_REASON_CODES.MACHINE_MARKER_WARNING);
    }
    if (lastError.includes(FAILED_ATTEMPT_MACHINE_MARKER)) {
      reasonCodes.push(FAILED_ATTEMPT_REASON_CODES.MACHINE_MARKER_ERROR);
    }

    return {
      packageId: normalizePackageId(row?.packageId),
      name: cleanText(row?.name, 200),
      installStatus: cleanText(row?.installStatus, 80),
      reasonCodes: Array.from(new Set(reasonCodes)),
      eligible: reasonCodes.length > 0
    };
  }

  async function runFallbackFailedAttemptCleanup(packageId = '', options = {}) {
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const actor = buildActor(options.actor || null);
    const warnings = [];
    let registryRemoved = false;
    try {
      registryRemoved = await deps.packageRegistryService.removePackageRegistry(packageId, { backendMode });
    } catch (error) {
      warnings.push(`Registry cleanup failed: ${cleanText(error?.message || String(error), 500) || 'unknown error'}`);
    }
    const filePurgeSummary = await purgePackageFiles(packageId, options);
    filePurgeSummary.failedPaths.forEach((row) => {
      warnings.push(`Package file cleanup failed for "${cleanText(row?.path, 1200)}": ${cleanText(row?.message, 500) || 'unknown error'}`);
    });
    if (!registryRemoved && !filePurgeSummary.deletedPaths.length) {
      const error = new Error('Fallback cleanup could not remove package registry row or package files.');
      error.code = 'PACKAGE_FAILED_ATTEMPT_CLEANUP_FAILED';
      error.details = {
        packageId,
        registryRemoved,
        filePurgeSummary
      };
      throw error;
    }

    const lifecycleTx = await startLifecycleTransaction({
      packageId,
      packageName: packageId.toUpperCase(),
      packageVersion: '',
      action: 'cleanup-failed-attempt',
      metadata: {
        fallback: true
      },
      artifacts: {
        filePurgeSummary
      }
    }, { backendMode, actor });
    const transactionId = cleanText(lifecycleTx?.id, 160);
    const operations = [];
    operations.push({
      entityType: 'packageRegistry',
      identityKey: `packageId:${packageId}`,
      ownership: { packageId, packageName: packageId.toUpperCase() },
      operation: registryRemoved ? 'removed' : 'skipped',
      reason: registryRemoved ? 'Registry row removed in fallback failed-attempt cleanup.' : 'Registry row not found during fallback cleanup.'
    });
    filePurgeSummary.deletedPaths.forEach((targetPath) => {
      operations.push({
        entityType: 'packageFiles',
        identityKey: `path:${targetPath}`,
        ownership: { packageId, packageName: packageId.toUpperCase() },
        operation: 'removed',
        reason: 'Package source folder removed in fallback failed-attempt cleanup.'
      });
    });
    filePurgeSummary.missingPaths.forEach((targetPath) => {
      operations.push({
        entityType: 'packageFiles',
        identityKey: `path:${targetPath}`,
        ownership: { packageId, packageName: packageId.toUpperCase() },
        operation: 'skipped',
        reason: 'Package source folder missing during fallback cleanup.'
      });
    });
    filePurgeSummary.failedPaths.forEach((row) => {
      operations.push({
        entityType: 'packageFiles',
        identityKey: `path:${cleanText(row?.path, 2000)}`,
        ownership: { packageId, packageName: packageId.toUpperCase() },
        operation: 'skipped',
        reason: `Delete failed: ${cleanText(row?.message, 500)}`
      });
    });
    await appendLifecycleOperations(transactionId, operations, { backendMode, actor }).catch(() => null);
    await completeLifecycleTransaction(transactionId, {
      status: 'success',
      phase: 'commit',
      warnings,
      artifacts: {
        fallback: true,
        registryRemoved,
        filePurgeSummary
      },
      summaryByEntity: createLifecycleSummaryByEntity(operations)
    }, { backendMode, actor }).catch(() => null);

    return {
      packageId,
      fallback: true,
      transactionId,
      registryRemoved,
      filePurgeSummary,
      warnings
    };
  }

  async function cleanupFailedInstallAttempts(options = {}) {
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const snapshot = await listPackageSnapshot({ ...options, backendMode });
    const rows = sanitizeArray(snapshot?.installedPackages);
    const previewRows = rows.map((row) => buildFailedAttemptCandidatePreview(row));
    const candidates = previewRows.filter((row) => row.eligible === true);
    const report = {
      action: 'cleanup-failed-attempts',
      preview: {
        scannedCount: rows.length,
        candidateCount: candidates.length,
        candidates: previewRows
      },
      candidateCount: candidates.length,
      cleanedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      results: [],
      warnings: []
    };

    for (const row of candidates) {
      const packageId = normalizePackageId(row?.packageId);
      const item = {
        packageId,
        name: cleanText(row?.name, 200),
        installStatus: cleanText(row?.installStatus, 80),
        reasonCodes: sanitizeArray(row?.reasonCodes).map((token) => cleanText(token, 120)).filter(Boolean),
        result: 'pending',
        transactionId: '',
        mode: '',
        message: '',
        warnings: []
      };
      if (!packageId) {
        item.result = 'skipped';
        item.message = 'Package row has no valid package id.';
        report.skippedCount += 1;
        report.results.push(item);
        continue;
      }

      try {
        // eslint-disable-next-line no-await-in-loop
        const removed = await removePackage(packageId, {
          ...options,
          backendMode,
          force: true,
          cleanupMode: 'full',
          deleteSelection: null
        });
        item.result = 'cleaned';
        item.transactionId = cleanText(removed?.transactionId, 160);
        item.mode = cleanText(removed?.mode, 80);
        item.message = 'Full cleanup remove completed.';
        item.warnings = sanitizeArray(removed?.warnings).slice(0, 8);
        report.cleanedCount += 1;
      } catch (error) {
        const code = cleanText(error?.code, 120).toUpperCase();
        if (code === 'PACKAGE_REMOVE_MANIFEST_REQUIRED') {
          try {
            // eslint-disable-next-line no-await-in-loop
            const fallback = await runFallbackFailedAttemptCleanup(packageId, {
              ...options,
              backendMode
            });
            item.result = 'cleaned_with_warnings';
            item.transactionId = cleanText(fallback?.transactionId, 160);
            item.mode = 'fallback';
            item.message = 'Fallback cleanup applied (registry/files).';
            item.warnings = sanitizeArray(fallback?.warnings).slice(0, 8);
            report.cleanedCount += 1;
          } catch (fallbackError) {
            item.result = 'failed';
            item.message = cleanText(fallbackError?.message || String(fallbackError), 1200) || 'Failed to cleanup failed install attempt.';
            item.warnings = [cleanText(error?.message || String(error), 1200)].filter(Boolean);
            report.failedCount += 1;
          }
        } else {
          item.result = 'failed';
          item.message = cleanText(error?.message || String(error), 1200) || 'Failed to cleanup failed install attempt.';
          report.failedCount += 1;
        }
      }
      report.results.push(item);
    }

    if (report.failedCount > 0) {
      report.warnings.push(`Failed to clean ${report.failedCount} package install attempt(s).`);
    }
    if (!report.candidateCount) {
      report.warnings.push('No failed package install attempts were detected.');
    }
    return report;
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
    try {
      assertRuntimeRouteMountHealth(context, runtime, {
        strict: Boolean(options?.app && typeof options.app.use === 'function')
      });
    } catch (runtimeError) {
      await deps.packageRegistryService.setPackageEnabled(packageId, false, {
        backendMode,
        actor: buildActor(options.actor || null)
      }).catch(() => null);
      throw runtimeError;
    }
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
    previewPackageInstall,
    previewPackageInstallZip,
    installPackage,
    installPackageZip,
    enablePackage,
    pausePackage,
    removePackage,
    syncPackage,
    cleanupFailedInstallAttempts,
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
