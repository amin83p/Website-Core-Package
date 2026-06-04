const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');
const benchpathDataService = require('../../services/benchpath/benchpathDataService');
const { isAjax } = requireCoreModule('MVC/utils/generalTools');
const fileAssetStorage = requireCoreModule('MVC/services/fileAssetStorageService');
const uploadFolderSettingsService = requireCoreModule('MVC/services/uploadFolderSettingsService');

const REPORT_SCOPE = 'GLOBAL';
const SAFE_REPORT_FILE = /^benchpath-migration-(dry-run|apply)-[A-Za-z0-9._-]+\.json$/;

function getReportsDir() {
  return uploadFolderSettingsService.resolveUploadFolder('generated.benchpathReports');
}

function buildReportFilename(prefix) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `benchpath-migration-${prefix}-${stamp}.json`;
}

async function listBenchpathReports() {
  try {
    const files = await fileAssetStorage.listDirectory({ scopeKey: REPORT_SCOPE, relativeDir: getReportsDir() });

    const stats = files
      .filter((item) => item && !item.isDir && SAFE_REPORT_FILE.test(item.name))
      .map((item) => {
      return {
        fileName: item.name,
        fullPath: item.url,
        sizeBytes: Number(item.size || 0),
        modifiedAt: item.modified || ''
      };
    });

    return stats
      .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt))
      .slice(0, 30);
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function showToolsPage(req, res) {
  try {
    const reports = await listBenchpathReports();

    res.render('benchpath/tools/migrationTools', {
      title: 'BenchPath Migration Tools',
      includeModal: true,
      reports,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
}

async function runDryRun(req, res) {
  try {
    const report = await benchpathDataService.runMigrationDryRunReport({ sampleLimit: 100 });
    const fileName = buildReportFilename('dry-run');

    await fileAssetStorage.saveJson({ scopeKey: REPORT_SCOPE, relativeDir: getReportsDir(), fileName, data: report });

    const recentReports = await listBenchpathReports();

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: 'Dry-run report generated successfully.',
        summary: report.summary || {},
        meta: report.meta || {},
        reportFile: fileName,
        recentReports
      });
    }

    res.redirect('/benchpath/tools');
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({
        status: 'error',
        message: error.message
      });
    }

    res.status(400).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
}

async function applyMigration(req, res) {
  try {
    const report = await benchpathDataService.applyNormalizationMigration({
      sampleLimit: 100,
      createBackup: true
    });

    const fileName = buildReportFilename('apply');
    await fileAssetStorage.saveJson({ scopeKey: REPORT_SCOPE, relativeDir: getReportsDir(), fileName, data: report });

    const recentReports = await listBenchpathReports();

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: 'Normalization migration applied successfully.',
        summary: report.summary || {},
        meta: report.meta || {},
        reportFile: fileName,
        recentReports
      });
    }

    res.redirect('/benchpath/tools');
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({
        status: 'error',
        message: error.message
      });
    }

    res.status(400).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
}

async function downloadReport(req, res) {
  try {
    const fileName = String(req.params.fileName || '').trim();
    if (!SAFE_REPORT_FILE.test(fileName)) {
      return res.status(400).render('error', {
        title: 'Invalid Report File',
        error: new Error('Invalid report file name.'),
        message: 'Invalid report file name.',
        user: req.user || null
      });
    }

    return await fileAssetStorage.sendDownload(
      res,
      fileAssetStorage.uploadsUrlForParts(REPORT_SCOPE, getReportsDir(), fileName),
      fileName
    );
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return res.status(404).render('404', { user: req.user || null });
    }

    return res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
}

module.exports = {
  showToolsPage,
  runDryRun,
  applyMigration,
  downloadReport
};
