#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PACKAGE_DIR = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(PACKAGE_DIR, 'package.manifest.json');
const SCRIPT_ID = 'packages/ielts/scripts/maintenance/enable-ielts-package.js';

function normalizeFilePath(value = '') {
  return String(value || '').replace(/\\/g, '/').trim();
}

function resolveCoreRoot() {
  const candidates = [];
  const push = (value = '') => {
    const resolved = path.resolve(value);
    if (!candidates.includes(resolved)) candidates.push(resolved);
  };

  if (process.env.PACKAGE_CORE_ROOT) push(process.env.PACKAGE_CORE_ROOT);
  push(path.resolve(__dirname, '../../../..'));
  push(path.resolve(__dirname, '../../../../..'));
  push(process.cwd());

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'MVC/services/packageManifestService.js'))) {
      return candidate;
    }
  }
  return process.cwd();
}

const ROOT_DIR = resolveCoreRoot();

function requireCore(relativePath = '') {
  return require(path.join(ROOT_DIR, normalizeFilePath(relativePath)));
}

const packageManifestService = requireCore('MVC/services/packageManifestService');
const packageRegistryService = requireCore('MVC/services/packageRegistryService');
const packageRegistryInstallerService = requireCore('MVC/services/packageRegistryInstallerService');
const dataBackendRuntimeService = requireCore('MVC/services/dataBackendRuntimeService');
const { disconnectMongo } = requireCore('MVC/infrastructure/mongo/mongoConnection');

function loadLocalEnvFile() {
  try {
    const envPath = path.join(ROOT_DIR, '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) return;
      const key = trimmed.slice(0, eqIdx).trim();
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) return;
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith('\'') && value.endsWith('\''))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    });
  } catch (_) {
    // Continue with process.env defaults when .env cannot be read.
  }
}

async function withMutedStartupLogs(enabled, callback) {
  if (!enabled) return callback();
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return await callback();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

async function initializeRegistryBackend(options = {}) {
  if (process.env.PACKAGE_REGISTRY_DATA_PATH && !process.env.DATA_BACKEND) {
    process.env.DATA_BACKEND = 'json';
  }
  loadLocalEnvFile();
  const backend = await withMutedStartupLogs(Boolean(options.json), () => (
    dataBackendRuntimeService.initializeDataBackend(process.env)
  ));
  return backend?.mode || 'json';
}

function parseArgs(argv = []) {
  const args = new Set(argv);
  return {
    apply: args.has('--apply'),
    disable: args.has('--disable'),
    remove: args.has('--remove'),
    json: args.has('--json'),
    help: args.has('--help') || args.has('-h')
  };
}

function loadIeltsManifest() {
  const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  return packageManifestService.validatePackageManifest(raw, { knownIds: [] });
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

function buildRegistryPayload(manifest = {}, action = 'enable') {
  return {
    packageId: manifest.id,
    version: manifest.version,
    enabled: action === 'enable',
    installStatus: action === 'remove' ? 'removed' : action === 'disable' ? 'disabled' : 'enabled',
    metadata: {
      packageName: manifest.name,
      mountPath: manifest.mountPath,
      manifestPath: path.relative(ROOT_DIR, MANIFEST_PATH).replace(/\\/g, '/'),
      activatedBy: SCRIPT_ID,
      activationMode: 'manual',
      declarationCounts: countDeclarations(manifest)
    }
  };
}

function printHumanReport(report = {}) {
  const mode = report.apply ? 'APPLY' : 'DRY RUN';
  console.log(`[${mode}] IELTS package registry activation`);
  console.log(`Package: ${report.payload.packageId}@${report.payload.version}`);
  console.log(`Action: ${report.action}`);
  if (report.packageAction) console.log(`Package action: ${report.packageAction}`);
  console.log(`Enabled: ${report.payload.enabled}`);
  console.log(`Install status: ${report.payload.installStatus}`);
  console.log(`Manifest: ${report.payload.metadata.manifestPath}`);
  console.log('Declaration counts:', report.payload.metadata.declarationCounts);
  if (!report.apply) {
    console.log('No registry data was written. Re-run with --apply to save this activation.');
  }
}

async function runEnableIeltsPackage(argv = [], runtimeOptions = {}) {
  const options = parseArgs(Array.isArray(argv) ? argv : []);
  const emit = runtimeOptions.emit !== false;

  if (options.help) {
    if (emit) {
      console.log('Usage: node packages/ielts/scripts/maintenance/enable-ielts-package.js [--apply] [--disable|--remove] [--json]');
      console.log('Default mode is dry-run. Use --apply to upsert or mutate package state.');
      console.log('Use --disable to disable package registry + package-owned declarations.');
      console.log('Use --remove to remove package registry row + package-owned declarations.');
    }
    return { help: true };
  }

  const manifest = loadIeltsManifest();
  const payloadMode = options.remove ? 'remove' : options.disable ? 'disable' : 'enable';
  const payload = buildRegistryPayload(manifest, payloadMode);
  let backendMode = 'json';

  try {
    backendMode = await initializeRegistryBackend({ json: options.json });
    const existing = await packageRegistryService.getPackageRegistryById(payload.packageId, { backendMode });
    const context = {
      backendMode,
      packageId: manifest.id,
      manifest
    };
    const report = {
      apply: options.apply,
      backendMode,
      action: options.remove || options.disable ? payloadMode : (existing ? 'update' : 'create'),
      packageAction: payloadMode,
      existing: existing ? {
        packageId: existing.packageId,
        version: existing.version,
        enabled: existing.enabled,
        installStatus: existing.installStatus
      } : null,
      payload,
      declarationSummary: null
    };

    if (options.apply) {
      if (options.remove) {
        report.declarationSummary = await packageRegistryInstallerService.removePackageRegistryDeclarations(context, {
          action: 'remove',
          backendMode
        });
        report.result = await packageRegistryService.removePackageRegistry(payload.packageId, { backendMode });
      } else if (options.disable) {
        report.declarationSummary = await packageRegistryInstallerService.removePackageRegistryDeclarations(context, {
          action: 'disable',
          backendMode
        });
        report.result = await packageRegistryService.setPackageEnabled(payload.packageId, false, {
          backendMode,
          actor: { id: 'SYSTEM', username: SCRIPT_ID }
        });
      } else {
        report.result = await packageRegistryService.upsertPackageRegistry(payload, {
          backendMode,
          actor: { id: 'SYSTEM', username: SCRIPT_ID }
        });
      }
    }

    if (emit) {
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printHumanReport(report);
      }
    }
    return report;
  } finally {
    if (backendMode === 'mongo') {
      await disconnectMongo();
    }
  }
}

async function main() {
  await runEnableIeltsPackage(process.argv.slice(2), { emit: true });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[IELTS_PACKAGE_ENABLE][ERROR] ${error?.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  loadIeltsManifest,
  countDeclarations,
  buildRegistryPayload,
  initializeRegistryBackend,
  runEnableIeltsPackage,
  resolveCoreRoot
};
