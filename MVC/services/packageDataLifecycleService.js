const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getPackageStorageRootAbsolute } = require('../utils/packageStoragePathUtils');

const packageLifecycleExecutionLedgerService = require('./packageLifecycleExecutionLedgerService');
const packageDataOwnershipService = require('./packageDataOwnershipService');

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizePackageId(value = '') {
  return cleanText(value, 120).toLowerCase();
}

function sanitizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sanitizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeModeList(value = []) {
  const rows = sanitizeArray(value)
    .map((row) => cleanText(row, 40).toLowerCase())
    .filter(Boolean);
  return rows.length ? Array.from(new Set(rows)) : ['json', 'mongo'];
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

function hashPayload(value) {
  const raw = JSON.stringify(value === undefined ? null : value);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function buildActor(actor = null) {
  if (actor && typeof actor === 'object') {
    return {
      id: cleanText(actor.id || actor.username || actor.email || '', 160) || 'SYSTEM',
      username: cleanText(actor.username || actor.email || actor.id || '', 200) || 'SYSTEM'
    };
  }
  return { id: 'SYSTEM', username: 'SYSTEM' };
}

function resolvePackageDir(input = {}, options = {}) {
  const packageId = normalizePackageId(input.packageId || input.manifest?.id || '');
  const packageRootDir = getPackageStorageRootAbsolute({ packageRootDir: options.packageRootDir });
  const declaredManifestPath = cleanText(input.manifestPath, 1800);
  if (declaredManifestPath) {
    const absManifestPath = path.resolve(declaredManifestPath);
    return {
      packageDir: path.dirname(absManifestPath),
      packageRootDir,
      packageId
    };
  }
  return {
    packageDir: path.join(packageRootDir, packageId),
    packageRootDir,
    packageId
  };
}

function ensureInsidePackage(packageDir = '', relativeScriptPath = '') {
  const packageRoot = path.resolve(packageDir);
  const token = cleanText(relativeScriptPath, 1800);
  if (!token) throw new Error('Script path is required.');
  if (path.isAbsolute(token)) throw new Error(`Script path must be relative: ${token}`);
  const resolved = path.resolve(packageRoot, token);
  const rel = path.relative(packageRoot, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Script path escapes package boundary: ${relativeScriptPath}`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Script file not found: ${relativeScriptPath}`);
  }
  return resolved;
}

function resolveExecutable(moduleExports = null, methodName = '') {
  if (typeof moduleExports === 'function') return moduleExports;
  if (!moduleExports || typeof moduleExports !== 'object') {
    throw new Error('Script module must export a function or object.');
  }
  const method = cleanText(methodName, 40);
  if (method && typeof moduleExports[method] === 'function') return moduleExports[method];
  if (typeof moduleExports.run === 'function') return moduleExports.run;
  if (typeof moduleExports.default === 'function') return moduleExports.default;
  throw new Error(`Script does not expose executable method for "${method || 'run'}".`);
}

async function executeWithTimeout(fn, timeoutMs = 15000) {
  const timeout = Number.parseInt(String(timeoutMs || ''), 10);
  const safeTimeout = Number.isFinite(timeout) && timeout > 0 ? timeout : 15000;
  let timer = null;
  return Promise.race([
    Promise.resolve().then(() => fn()),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Package data script timed out after ${safeTimeout}ms.`)), safeTimeout);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function normalizeStepResult(raw = {}, defaults = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const ownershipRecordsRaw = sanitizeArray(source.ownershipRecords);
  const ownershipRecords = ownershipRecordsRaw.map((row) => ({
    entityType: cleanText(row?.entityType, 80).toLowerCase(),
    identityKey: cleanText(row?.identityKey, 400),
    packageId: normalizePackageId(row?.packageId || defaults.packageId),
    packageVersion: cleanText(row?.packageVersion || defaults.packageVersion, 120),
    baselineHash: cleanText(row?.baselineHash, 120) || hashPayload(row?.baselineSnapshot),
    baselineSnapshot: row?.baselineSnapshot === undefined ? null : row.baselineSnapshot,
    metadata: sanitizeObject(row?.metadata)
  })).filter((row) => row.entityType && row.identityKey);
  return {
    status: cleanText(source.status, 40).toLowerCase() || 'success',
    message: cleanText(source.message, 1200),
    warnings: sanitizeArray(source.warnings).map((row) => cleanText(row, 1200)).filter(Boolean),
    artifacts: sanitizeObject(source.artifacts),
    ownershipRecords
  };
}

function summarizeByType(rows = []) {
  const summary = {
    migrations: { applied: 0, skipped: 0, failed: 0 },
    seeders: { applied: 0, skipped: 0, failed: 0 }
  };
  sanitizeArray(rows).forEach((row) => {
    const type = cleanText(row?.stepType, 40).toLowerCase() === 'seeder' ? 'seeders' : 'migrations';
    const status = cleanText(row?.status, 40).toLowerCase();
    if (status === 'success') summary[type].applied += 1;
    else if (status === 'skipped') summary[type].skipped += 1;
    else if (status === 'failed') summary[type].failed += 1;
  });
  return summary;
}

function sortLifecycleSteps(rows = []) {
  return sanitizeArray(rows).slice().sort((a, b) => {
    const versionCmp = compareSemver(cleanText(a?.version, 120), cleanText(b?.version, 120));
    if (versionCmp !== 0) return versionCmp;
    return cleanText(a?.id, 200).localeCompare(cleanText(b?.id, 200));
  });
}

function filterStepsByBackend(rows = [], backendMode = '') {
  const mode = cleanText(backendMode, 40).toLowerCase() || 'json';
  return sanitizeArray(rows).filter((row) => normalizeModeList(row?.backendModes).includes(mode));
}

function createDependencies(overrides = {}) {
  return {
    fs: overrides.fs || fs,
    path: overrides.path || path,
    executionLedgerService: overrides.executionLedgerService || packageLifecycleExecutionLedgerService,
    ownershipService: overrides.ownershipService || packageDataOwnershipService
  };
}

function createService(overrides = {}) {
  const deps = createDependencies(overrides);

  async function executeStep(step = {}, context = {}, options = {}) {
    const packageDirInfo = resolvePackageDir(context, options);
    const packageId = packageDirInfo.packageId;
    const packageVersion = cleanText(context.packageVersion || context.manifest?.version, 120);
    const backendMode = cleanText(options.backendMode || context.backendMode, 40).toLowerCase() || 'json';
    const actor = buildActor(options.actor || context.actor || null);
    const timeoutMs = Number.parseInt(String(options.scriptTimeoutMs || process.env.PACKAGE_DATA_SCRIPT_TIMEOUT_MS || '15000'), 10) || 15000;
    const stepType = cleanText(step.stepType || step.type, 40).toLowerCase();
    const stepId = cleanText(step.id, 200);
    const direction = cleanText(step.direction, 40).toLowerCase();
    const scriptPathRelative = cleanText(step.scriptPath, 1800);
    const scriptPathAbs = ensureInsidePackage(packageDirInfo.packageDir, scriptPathRelative);
    const manifestChecksum = deps.executionLedgerService.hashChecksum(`${packageId}:${packageVersion}:${cleanText(context.manifestPath, 1800)}`);
    const scriptChecksum = deps.executionLedgerService.hashChecksum(`${scriptPathAbs}:${packageVersion}:${stepId}:${direction}`);
    const ledger = await deps.executionLedgerService.createStepEntry({
      packageId,
      packageVersion,
      stepId,
      stepType,
      direction,
      backendMode,
      scriptPath: scriptPathRelative,
      scriptChecksum,
      manifestChecksum,
      transactionId: cleanText(options.transactionId, 180),
      metadata: {
        mode: cleanText(options.mode, 40),
        manifestPath: cleanText(context.manifestPath, 1800)
      }
    }, { backendMode, actor });

    try {
      delete require.cache[require.resolve(scriptPathAbs)];
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const loaded = require(scriptPathAbs);
      const executable = resolveExecutable(loaded, direction);
      const rawResult = await executeWithTimeout(() => executable({
        packageId,
        packageVersion,
        backendMode,
        stepId,
        stepType,
        direction,
        manifest: context.manifest,
        manifestPath: context.manifestPath,
        packageDir: packageDirInfo.packageDir,
        packageRootDir: packageDirInfo.packageRootDir,
        actor,
        operationContext: sanitizeObject(options.operationContext)
      }), timeoutMs);
      const result = normalizeStepResult(rawResult, { packageId, packageVersion });
      await deps.executionLedgerService.completeStepEntry(ledger.id, {
        status: result.status === 'failed' ? 'failed' : 'success',
        artifacts: result.artifacts,
        ownershipRecords: result.ownershipRecords,
        metadata: {
          warnings: result.warnings
        }
      }, { backendMode, actor });
      if (result.ownershipRecords.length) {
        await deps.ownershipService.registerOwnershipRecords(result.ownershipRecords, {
          backendMode,
          actor
        });
      }
      return {
        ledgerId: ledger.id,
        stepId,
        stepType,
        direction,
        status: result.status === 'failed' ? 'failed' : 'success',
        message: result.message,
        warnings: result.warnings,
        artifacts: result.artifacts,
        ownershipRecords: result.ownershipRecords
      };
    } catch (error) {
      const message = cleanText(error?.message || String(error), 2000);
      await deps.executionLedgerService.completeStepEntry(ledger.id, {
        status: 'failed',
        error: message
      }, { backendMode, actor }).catch(() => null);
      return {
        ledgerId: ledger.id,
        stepId,
        stepType,
        direction,
        status: 'failed',
        message,
        warnings: [],
        artifacts: {},
        ownershipRecords: []
      };
    }
  }

  async function shouldSkipSuccessfulStep(step = {}, context = {}, options = {}) {
    const existing = await deps.executionLedgerService.findLatestSuccessfulEntry({
      packageId: context.packageId,
      stepId: step.id,
      stepType: step.stepType,
      direction: step.direction,
      backendMode: options.backendMode || context.backendMode
    }, {
      backendMode: options.backendMode || context.backendMode
    });
    return Boolean(existing);
  }

  async function runSteps(rows = [], context = {}, options = {}) {
    const appliedSteps = [];
    const skippedSteps = [];
    let failedStep = null;
    const warnings = [];

    for (const step of sanitizeArray(rows)) {
      const skip = options.allowSkipCompleted !== false
        ? await shouldSkipSuccessfulStep(step, context, options)
        : false;
      if (skip) {
        skippedSteps.push({
          stepId: step.id,
          stepType: step.stepType,
          direction: step.direction,
          status: 'skipped',
          reason: 'already_applied'
        });
        // eslint-disable-next-line no-continue
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const result = await executeStep(step, context, options);
      if (result.status === 'failed') {
        failedStep = result;
        warnings.push(result.message);
        break;
      }
      warnings.push(...sanitizeArray(result.warnings));
      appliedSteps.push(result);
    }

    const combined = [...appliedSteps, ...skippedSteps];
    return {
      dataSummary: summarizeByType(combined),
      appliedSteps,
      skippedSteps,
      failedStep,
      warnings
    };
  }

  function extractManifestLifecycleRows(manifest = {}, backendMode = '') {
    const migrations = filterStepsByBackend(sortLifecycleSteps(sanitizeArray(manifest?.migrations)), backendMode)
      .map((row) => ({
        id: cleanText(row.id, 200),
        version: cleanText(row.version, 120),
        stepType: 'migration',
        direction: 'up',
        reverseDirection: 'down',
        scriptPath: cleanText(row.up, 1800),
        reverseScriptPath: cleanText(row.down, 1800),
        safeToRollback: row.safeToRollback !== false
      }))
      .filter((row) => row.id && row.scriptPath);
    const seeders = filterStepsByBackend(sortLifecycleSteps(sanitizeArray(manifest?.seeders)), backendMode)
      .map((row) => ({
        id: cleanText(row.id, 200),
        version: cleanText(row.version, 120),
        stepType: 'seeder',
        direction: 'run',
        reverseDirection: 'revert',
        scriptPath: cleanText(row.run, 1800),
        reverseScriptPath: cleanText(row.revert, 1800),
        mode: cleanText(row.mode, 40).toLowerCase() || 'upsert'
      }))
      .filter((row) => row.id && row.scriptPath);
    return { migrations, seeders };
  }

  async function runPackageDataInstallLifecycle(context = {}, options = {}) {
    const packageId = normalizePackageId(context.packageId || context.manifest?.id || '');
    const packageVersion = cleanText(context.packageVersion || context.manifest?.version, 120);
    const backendMode = cleanText(options.backendMode || context.backendMode, 40).toLowerCase() || 'json';
    const { migrations, seeders } = extractManifestLifecycleRows(context.manifest, backendMode);
    const rows = [
      ...migrations.map((row) => ({ ...row })),
      ...seeders.map((row) => ({ ...row }))
    ];
    const result = await runSteps(rows, {
      ...context,
      packageId,
      packageVersion,
      backendMode
    }, options);
    return {
      ...result,
      rollbackApplied: false
    };
  }

  async function runPackageDataUpgradeLifecycle(context = {}, options = {}) {
    const packageId = normalizePackageId(context.packageId || context.manifest?.id || '');
    const packageVersion = cleanText(context.packageVersion || context.manifest?.version, 120);
    const previousVersion = cleanText(context.previousVersion, 120);
    const backendMode = cleanText(options.backendMode || context.backendMode, 40).toLowerCase() || 'json';
    const { migrations, seeders } = extractManifestLifecycleRows(context.manifest, backendMode);
    const forwardRows = [
      ...migrations.filter((row) => !previousVersion || compareSemver(row.version, previousVersion) > 0),
      ...seeders.filter((row) => !previousVersion || compareSemver(row.version, previousVersion) > 0)
    ];
    const result = await runSteps(forwardRows, {
      ...context,
      packageId,
      packageVersion,
      backendMode
    }, options);
    return {
      ...result,
      rollbackApplied: false
    };
  }

  async function previewPackageDataUninstallImpact(context = {}, options = {}) {
    const packageId = normalizePackageId(context.packageId || context.manifest?.id || '');
    const backendMode = cleanText(options.backendMode || context.backendMode, 40).toLowerCase() || 'json';
    let rows = [];
    if (deps.ownershipService && typeof deps.ownershipService.listOwnershipByPackage === 'function') {
      rows = await deps.ownershipService.listOwnershipByPackage(packageId, {
        backendMode,
        limit: 2000
      });
    }
    const ownershipRows = sanitizeArray(rows);
    const modifiedRecords = [];
    const warnings = [];
    ownershipRows.forEach((row) => {
      const baselineHash = cleanText(row?.baselineHash, 120);
      const metadata = sanitizeObject(row?.metadata);
      const currentHash = cleanText(metadata.currentHash, 120);
      if (!baselineHash || !currentHash) {
        warnings.push(`No current hash inspector for ${row.entityType}:${row.identityKey}; modification check skipped.`);
        return;
      }
      if (baselineHash !== currentHash) {
        modifiedRecords.push({
          entityType: cleanText(row?.entityType, 80),
          identityKey: cleanText(row?.identityKey, 400),
          ownership: {
            packageId: normalizePackageId(row?.packageId),
            packageVersion: cleanText(row?.packageVersion, 120)
          },
          installedHash: baselineHash,
          currentHash,
          installedPayload: row?.baselineSnapshot || null,
          currentPayload: metadata.currentSnapshot || null
        });
      }
    });
    const blockedReasons = modifiedRecords.length
      ? ['Detected modified package-owned data records since install baseline.']
      : [];
    return {
      blocked: blockedReasons.length > 0,
      blockedReasons,
      modifiedRecords,
      dataImpact: {
        ownershipCount: ownershipRows.length,
        modifiedCount: modifiedRecords.length
      },
      warnings
    };
  }

  async function runPackageDataUninstallLifecycle(context = {}, options = {}) {
    const packageId = normalizePackageId(context.packageId || context.manifest?.id || '');
    const packageVersion = cleanText(context.packageVersion || context.manifest?.version, 120);
    const backendMode = cleanText(options.backendMode || context.backendMode, 40).toLowerCase() || 'json';
    const force = options.force === true;
    const cleanupMode = cleanText(options.cleanupMode, 40).toLowerCase();
    const keepDataMode = cleanupMode === 'keep-data' && !force;
    const preview = options.preview && typeof options.preview === 'object'
      ? options.preview
      : await previewPackageDataUninstallImpact(context, options);
    if (keepDataMode) {
      const steps = [
        ...sanitizeArray(context.manifest?.migrations).map((row) => ({
          stepId: cleanText(row?.id, 200),
          stepType: 'migration',
          direction: 'down',
          status: 'skipped',
          reason: 'safe_mode_keep_data'
        })),
        ...sanitizeArray(context.manifest?.seeders).map((row) => ({
          stepId: cleanText(row?.id, 200),
          stepType: 'seeder',
          direction: 'revert',
          status: 'skipped',
          reason: 'safe_mode_keep_data'
        }))
      ];
      return {
        dataSummary: summarizeByType(steps),
        appliedSteps: [],
        skippedSteps: steps,
        failedStep: null,
        rollbackApplied: false,
        dataImpact: preview,
        warnings: ['Keep-data uninstall mode was requested; package business data was retained.']
      };
    }

    const { migrations, seeders } = extractManifestLifecycleRows(context.manifest, backendMode);
    const reverseRows = [
      ...seeders.slice().reverse().map((row) => ({
        ...row,
        direction: row.reverseDirection,
        scriptPath: row.reverseScriptPath
      })),
      ...migrations.slice().reverse().map((row) => ({
        ...row,
        direction: row.reverseDirection,
        scriptPath: row.reverseScriptPath
      }))
    ].filter((row) => row.scriptPath);

    const filteredRows = [];
    const ownershipWarnings = [];
    for (const step of reverseRows) {
      const forwardDirection = step.stepType === 'migration' ? 'up' : 'run';
      // eslint-disable-next-line no-await-in-loop
      const appliedForward = await deps.executionLedgerService.findLatestSuccessfulEntry({
        packageId,
        stepId: step.id,
        stepType: step.stepType,
        direction: forwardDirection,
        backendMode
      }, { backendMode });
      if (!appliedForward) {
        continue;
      }
      const ownershipRecords = sanitizeArray(appliedForward?.ownershipRecords);
      // eslint-disable-next-line no-await-in-loop
      const conflicts = await deps.ownershipService.detectOwnershipConflicts(ownershipRecords, {
        backendMode,
        packageId
      });
      if (conflicts.length) {
        ownershipWarnings.push(`Skipped rollback for ${step.stepType}:${step.id} due to ownership conflict.`);
        continue;
      }
      filteredRows.push(step);
    }

    const result = await runSteps(filteredRows, {
      ...context,
      packageId,
      packageVersion,
      backendMode
    }, {
      ...options,
      allowSkipCompleted: false
    });

    return {
      ...result,
      rollbackApplied: !result.failedStep,
      dataImpact: preview,
      warnings: [...ownershipWarnings, ...sanitizeArray(result.warnings)]
    };
  }

  return {
    hashPayload,
    runPackageDataInstallLifecycle,
    runPackageDataUpgradeLifecycle,
    runPackageDataUninstallLifecycle,
    previewPackageDataUninstallImpact
  };
}

module.exports = {
  ...createService(),
  createService,
  createDependencies
};
