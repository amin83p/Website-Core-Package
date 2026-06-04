const path = require('path');
const uploadPathUtils = require('../MVC/utils/uploadPathUtils');
const uploadFolderSettingsService = require('../MVC/services/uploadFolderSettingsService');
const {
  runBenchpathMigrationDryRunReport,
  writeBenchpathMigrationDryRunReport
} = require('../MVC/services/benchpath/data/migrationDryRunService');

function buildTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main() {
  const report = await runBenchpathMigrationDryRunReport({ sampleLimit: 100 });
  const outputPath = path.join(
    uploadPathUtils.getUploadRootAbsolute(),
    'GLOBAL',
    uploadFolderSettingsService.resolveUploadFolder('generated.benchpathReports'),
    `benchpath-migration-dry-run-${buildTimestamp()}.json`
  );
  const written = await writeBenchpathMigrationDryRunReport(report, outputPath);

  const summary = report.summary || {};
  console.log('BenchPath migration dry-run report generated.');
  console.log(`Output: ${written}`);
  console.log(`Records scanned: ${summary.recordsScanned || 0}`);
  console.log(`Records changed: ${summary.recordsChanged || 0}`);
  console.log(`Fields coerced: ${summary.fieldsCoerced || 0}`);
  console.log(`Invalid relations found: ${summary.invalidRelationsFound || 0}`);
  console.log(`Records skipped: ${summary.recordsSkipped || 0}`);
  console.log(`Indexes rebuilt: ${summary.indexesRebuilt || 0}`);
}

main().catch((error) => {
  console.error('Failed to generate BenchPath migration dry-run report.');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
