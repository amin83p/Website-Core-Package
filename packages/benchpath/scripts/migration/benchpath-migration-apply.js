const path = require('path');
const { requireCoreModule } = require('../../MVC/services/benchpath/benchpathCoreModuleResolver');
const uploadPathUtils = requireCoreModule('MVC/utils/uploadPathUtils');
const uploadFolderSettingsService = requireCoreModule('MVC/services/uploadFolderSettingsService');
const {
  applyBenchpathNormalizationMigration,
  writeBenchpathMigrationDryRunReport
} = require('../../MVC/services/benchpath/data/migrationDryRunService');

function buildTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main() {
  const report = await applyBenchpathNormalizationMigration({
    sampleLimit: 100,
    createBackup: true
  });

  const reportPath = path.join(
    uploadPathUtils.getUploadRootAbsolute(),
    'GLOBAL',
    uploadFolderSettingsService.resolveUploadFolder('generated.benchpathReports'),
    `benchpath-migration-apply-${buildTimestamp()}.json`
  );
  const written = await writeBenchpathMigrationDryRunReport(report, reportPath);

  const summary = report.summary || {};
  const meta = report.meta || {};

  console.log('BenchPath normalization migration applied.');
  console.log(`Report: ${written}`);
  console.log(`Reference dir: ${meta.referenceDir || '-'}`);
  console.log(`Backup dir: ${meta.backupDir || 'none'}`);
  console.log(`Backups created: ${meta.backupsCreated || 0}`);
  console.log(`Files written: ${meta.filesWritten || 0}`);
  console.log(`Records scanned: ${summary.recordsScanned || 0}`);
  console.log(`Records changed: ${summary.recordsChanged || 0}`);
  console.log(`Fields coerced: ${summary.fieldsCoerced || 0}`);
  console.log(`Invalid relations found: ${summary.invalidRelationsFound || 0}`);
  console.log(`Records skipped: ${summary.recordsSkipped || 0}`);
  console.log(`Indexes rebuilt: ${summary.indexesRebuilt || 0}`);
}

main().catch((error) => {
  console.error('Failed to apply BenchPath normalization migration.');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
