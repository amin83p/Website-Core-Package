const fs = require('fs').promises;
const path = require('path');

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

  async function fileExists(filePath = '') {
    try {
      await deps.fs.access(filePath);
      return true;
    } catch (_) {
      return false;
    }
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
    const actor = buildActor(options.actor || null);
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const resolved = await resolveInstallManifest(input, options);
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
      activationMode: resolved.activationMode
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
      action: 'install',
      packageId: manifest.id,
      packageName: manifest.name,
      version: manifest.version,
      installMethod: resolved.installMethod,
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
