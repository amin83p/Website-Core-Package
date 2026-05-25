const fs = require('fs');
const path = require('path');

const packageManifestService = require('../../MVC/services/packageManifestService');
const packageRegistryService = require('../../MVC/services/packageRegistryService');
const packageRegistryInstallerService = require('../../MVC/services/packageRegistryInstallerService');
const dataBackendRuntimeService = require('../../MVC/services/dataBackendRuntimeService');
const { disconnectMongo } = require('../../MVC/infrastructure/mongo/mongoConnection');

const ROOT_DIR = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'packages', 'pte', 'package.manifest.json');
const SCRIPT_ID = 'scripts/packages/enable-pte-package.js';

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
    // The app can still run with process.env or the default JSON backend.
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

function loadPteManifest() {
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
    routes: manifest.routes.length,
    views: countObjectDeclaration(manifest.views),
    assets: countObjectDeclaration(manifest.assets),
    operations: manifest.operations.length,
    roles: manifest.roles.length,
    sections: manifest.sections.length,
    symbols: manifest.symbols.length,
    accesses: manifest.accesses.length,
    uploadFolders: manifest.uploadFolders.length,
    menuEntries: manifest.menuEntries.length,
    dashboardEntries: manifest.dashboardEntries.length,
    queryExecutors: manifest.queryExecutors.length
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
  console.log(`[${mode}] PTE package registry activation`);
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/packages/enable-pte-package.js [--apply] [--disable|--remove] [--json]');
    console.log('Default mode is dry-run. Use --apply to persist changes.');
    console.log('Use --disable to disable package registry + owned declarations.');
    console.log('Use --remove to remove package registry row + owned declarations.');
    return;
  }

  const manifest = loadPteManifest();
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

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    printHumanReport(report);
  } finally {
    if (backendMode === 'mongo') {
      await disconnectMongo();
    }
  }
}

main().catch((error) => {
  console.error(`[PTE_PACKAGE_ENABLE][ERROR] ${error?.message || error}`);
  process.exitCode = 1;
});
