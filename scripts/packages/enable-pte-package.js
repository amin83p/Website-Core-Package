const fs = require('fs');
const path = require('path');

const packageManifestService = require('../../MVC/services/packageManifestService');
const packageRegistryService = require('../../MVC/services/packageRegistryService');

const ROOT_DIR = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'packages', 'pte', 'package.manifest.json');
const SCRIPT_ID = 'scripts/packages/enable-pte-package.js';

function parseArgs(argv = []) {
  const args = new Set(argv);
  return {
    apply: args.has('--apply'),
    json: args.has('--json'),
    help: args.has('--help') || args.has('-h')
  };
}

function loadPteManifest() {
  const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  return packageManifestService.validatePackageManifest(raw, { knownIds: [] });
}

function countDeclarations(manifest = {}) {
  return {
    routes: manifest.routes.length,
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

function buildRegistryPayload(manifest = {}) {
  return {
    packageId: manifest.id,
    version: manifest.version,
    enabled: true,
    installStatus: 'enabled',
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
    console.log('Usage: node scripts/packages/enable-pte-package.js [--apply] [--json]');
    console.log('Default mode is dry-run. Use --apply to upsert the PTE package registry row.');
    return;
  }

  const manifest = loadPteManifest();
  const payload = buildRegistryPayload(manifest);
  const existing = await packageRegistryService.getPackageRegistryById(payload.packageId);
  const report = {
    apply: options.apply,
    action: existing ? 'update' : 'create',
    existing: existing ? {
      packageId: existing.packageId,
      version: existing.version,
      enabled: existing.enabled,
      installStatus: existing.installStatus
    } : null,
    payload
  };

  if (options.apply) {
    report.result = await packageRegistryService.upsertPackageRegistry(payload, {
      actor: { id: 'SYSTEM', username: SCRIPT_ID }
    });
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printHumanReport(report);
}

main().catch((error) => {
  console.error(`[PTE_PACKAGE_ENABLE][ERROR] ${error?.message || error}`);
  process.exitCode = 1;
});
