// MVC/routes/systemSettingsRoutes.js
const express = require('express');
const multer = require('multer');
const router = express.Router();
const ctrl = require('../controllers/systemSettingsController');
const upload = require('../middleware/upload');

const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const adminApproval = require('../middleware/adminApproval');
const accessService = require('../services/security/index');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

const restoreLimitMb = Number.parseInt(process.env.MONGO_BACKUP_RESTORE_MAX_MB || '100', 10) || 100;
const packageZipLimitMb = Number.parseInt(process.env.PACKAGE_ZIP_INSTALL_MAX_UPLOAD_MB || '50', 10) || 50;
const backupRestoreUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: restoreLimitMb * 1024 * 1024 }
});
const packageZipUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: packageZipLimitMb * 1024 * 1024,
    files: 2
  }
});

function handleBackupRestoreUpload(req, res, next) {
  backupRestoreUpload.single('backupFile')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `Backup file is too large. Maximum upload size is ${restoreLimitMb} MB.`
      : (error.message || 'Backup upload failed.');
    if (req.headers['x-ajax-request'] || req.xhr || req.headers.accept?.includes('json')) {
      return res.status(400).json({ status: 'error', message });
    }
    return res.status(400).render('error', {
      title: 'Backup Upload Failed',
      message,
      user: req.user
    });
  });
}

function handlePackageZipUpload(req, res, next) {
  packageZipUpload.fields([
    { name: 'packageZip', maxCount: 1 },
    { name: 'packageSig', maxCount: 1 }
  ])(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `Package ZIP/signature file is too large. Maximum upload size is ${packageZipLimitMb} MB.`
      : (error.message || 'Package ZIP upload failed.');
    if (req.headers['x-ajax-request'] || req.xhr || req.headers.accept?.includes('json')) {
      return res.status(400).json({ status: 'error', message });
    }
    return res.status(400).render('error', {
      title: 'Package Upload Failed',
      message,
      user: req.user
    });
  });
}

function denyDownloadAccess(req, res, reason) {
  if (req.headers['x-ajax-request'] || req.xhr || req.headers.accept?.includes('json')) {
    return res.status(403).json({ status: 'error', message: `Access Denied: ${reason}` });
  }
  return res.status(403).render('error', {
    title: 'Access Denied',
    message: reason,
    user: req.user
  });
}

async function requireSystemSettingsDownloadAccess(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ status: 'error', message: 'Authentication required before access check.' });
    }
    const operations = [OPERATIONS.DOWNLOAD_FILE, OPERATIONS.UPDATE].filter(Boolean);
    let lastReason = 'Insufficient permissions.';
    for (const operationId of operations) {
      req.logSectionId = SECTIONS.SYSTEM_SETTINGS;
      req.logOperationId = operationId;
      // eslint-disable-next-line no-await-in-loop
      const evaluation = await accessService.evaluateAccess({
        user: req.user,
        sectionId: SECTIONS.SYSTEM_SETTINGS,
        operationId,
        ipAddress: req.ip
      });
      if (evaluation.allowed) {
        req.accessLimits = evaluation.limits || {};
        req.accessScope = evaluation.scopeId;
        req.logOperationId = operationId;
        return next();
      }
      lastReason = evaluation.reason || lastReason;
    }
    return denyDownloadAccess(req, res, lastReason);
  } catch (error) {
    console.error('Access Middleware Error:', error);
    return res.status(500).send('Internal Security Error');
  }
}

// 1. Dashboard
router.get('/', requireAuth, ctrl.dashboard);

// 2. Newsletter Settings
router.get('/newsletter', 
            requireAuth, 
            requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE), 
            trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE), 
            ctrl.showNewsletterSettings);
router.post('/newsletter', 
            requireAuth, 
            requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE), 
            trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE), 
            ctrl.updateNewsletterSettings);

// 3. Organization Settings
router.get('/organization', 
            requireAuth, 
            requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE), 
            trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE), 
            ctrl.showOrganizationSettings);
router.post('/organization', 
            requireAuth, 
            requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE), 
            trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE), 
            ctrl.updateOrganizationSettings);

// router.get('/organization', requireAuth, ctrl.showOrganizationSettings);
// router.post('/organization', requireAuth, trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE), ctrl.updateOrganizationSettings);

// 4. Access & Security Settings
router.get('/access', 
            requireAuth, 
            requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE), 
            trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE), 
            ctrl.showAccessSettings);
router.post('/access',  
            requireAuth, 
            requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE), 
            trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE), 
            ctrl.updateAccessSettings);

// 5. Application Defaults
router.get('/app',  
          requireAuth, 
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE), 
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE), 
          ctrl.showAppSettings);
router.post('/app',
          requireAuth, 
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE), 
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE), 
          ctrl.updateAppSettings);

router.get('/public-pages/media/library',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { keepActive: true }),
          ctrl.listPublicPageMediaLibrary);
router.post('/public-pages/media/upload',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { requireToken: true, allowOperationTokenFallback: true }),
          upload('public-pages-staging', false).array('files', 10),
          upload.cleanupUploadedFileOnFail,
          ctrl.uploadPublicPageMedia);

router.get('/public-pages',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          ctrl.showPublicPageContentSettings);
router.post('/public-pages',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          ctrl.updatePublicPageContentSettings);

router.get('/default-file-paths',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_UPLOAD_FOLDERS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_UPLOAD_FOLDERS, OPERATIONS.UPDATE),
          ctrl.showDefaultFilePathSettings);
router.post('/default-file-paths',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_UPLOAD_FOLDERS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_UPLOAD_FOLDERS, OPERATIONS.UPDATE),
          ctrl.updateDefaultFilePathSettings);

router.get('/upload-folders',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_UPLOAD_FOLDERS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_UPLOAD_FOLDERS, OPERATIONS.UPDATE),
          ctrl.redirectUploadFolderSettingsGet);
router.post('/upload-folders',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_UPLOAD_FOLDERS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_UPLOAD_FOLDERS, OPERATIONS.UPDATE),
          ctrl.redirectUploadFolderSettingsPost);

// 6. Data Backend Mode (restart-based)
router.get('/data-backend',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          ctrl.showDataBackendSettings);
router.post('/data-backend',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          ctrl.updateDataBackendSettings);
router.post('/data-backend/retry',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
          ctrl.retryDataBackendConnection);
router.post('/data-backend/restore-backup',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          handleBackupRestoreUpload,
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
          ctrl.restoreMongoBackup);

// 7. Package Manager (System Settings)
router.get('/packages',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_PACKAGE_MANAGER, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_PACKAGE_MANAGER, OPERATIONS.UPDATE, { keepActive: true }),
          ctrl.showPackageManagerPage);
router.post('/packages/install',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_PACKAGE_MANAGER, OPERATIONS.UPDATE),
          trackActionState(
            SECTIONS.SYSTEM_PACKAGE_MANAGER,
            OPERATIONS.UPDATE,
            { requireToken: true, allowOperationTokenFallback: true, allowInactiveTokenFallback: true, keepActive: true }
          ),
          adminApproval,
          ctrl.installPackageFromManager);
router.post('/packages/install-zip',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_PACKAGE_MANAGER, OPERATIONS.UPDATE),
          handlePackageZipUpload,
          trackActionState(
            SECTIONS.SYSTEM_PACKAGE_MANAGER,
            OPERATIONS.UPDATE,
            { requireToken: true, allowOperationTokenFallback: true, allowInactiveTokenFallback: true, keepActive: true }
          ),
          adminApproval,
          ctrl.installPackageZipFromManager);
router.post('/packages/:packageId/enable',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_PACKAGE_MANAGER, OPERATIONS.UPDATE),
          trackActionState(
            SECTIONS.SYSTEM_PACKAGE_MANAGER,
            OPERATIONS.UPDATE,
            { requireToken: true, allowOperationTokenFallback: true, allowInactiveTokenFallback: true, keepActive: true }
          ),
          adminApproval,
          ctrl.enablePackageFromManager);
router.post('/packages/:packageId/pause',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_PACKAGE_MANAGER, OPERATIONS.UPDATE),
          trackActionState(
            SECTIONS.SYSTEM_PACKAGE_MANAGER,
            OPERATIONS.UPDATE,
            { requireToken: true, allowOperationTokenFallback: true, allowInactiveTokenFallback: true, keepActive: true }
          ),
          adminApproval,
          ctrl.pausePackageFromManager);
router.post('/packages/:packageId/remove',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_PACKAGE_MANAGER, OPERATIONS.UPDATE),
          trackActionState(
            SECTIONS.SYSTEM_PACKAGE_MANAGER,
            OPERATIONS.UPDATE,
            { requireToken: true, allowOperationTokenFallback: true, allowInactiveTokenFallback: true, keepActive: true }
          ),
          adminApproval,
          ctrl.removePackageFromManager);
router.post('/packages/:packageId/uninstall-preview',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_PACKAGE_MANAGER, OPERATIONS.UPDATE),
          trackActionState(
            SECTIONS.SYSTEM_PACKAGE_MANAGER,
            OPERATIONS.UPDATE,
            { requireToken: true, allowOperationTokenFallback: true, allowInactiveTokenFallback: true, keepActive: true }
          ),
          adminApproval,
          ctrl.uninstallPreviewPackageFromManager);
router.post('/packages/:packageId/sync',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_PACKAGE_MANAGER, OPERATIONS.UPDATE),
          trackActionState(
            SECTIONS.SYSTEM_PACKAGE_MANAGER,
            OPERATIONS.UPDATE,
            { requireToken: true, allowOperationTokenFallback: true, allowInactiveTokenFallback: true, keepActive: true }
          ),
          adminApproval,
          ctrl.syncPackageFromManager);
router.get('/packages/:packageId/transactions',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_PACKAGE_MANAGER, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_PACKAGE_MANAGER, OPERATIONS.UPDATE, { keepActive: true }),
          ctrl.listPackageTransactionsFromManager);
router.get('/packages/transactions/:transactionId',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_PACKAGE_MANAGER, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_PACKAGE_MANAGER, OPERATIONS.UPDATE, { keepActive: true }),
          ctrl.getPackageTransactionDetailFromManager);

// 8. Core Bootstrap Baseline (First-run)
router.get('/bootstrap/core',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { keepActive: true }),
          ctrl.showCoreBootstrapPage);
router.post('/bootstrap/core/preflight',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(
            SECTIONS.SYSTEM_SETTINGS,
            OPERATIONS.UPDATE,
            { requireToken: true, allowOperationTokenFallback: true, allowInactiveTokenFallback: true, keepActive: true }
          ),
          ctrl.preflightCoreBootstrapBaseline);
router.post('/bootstrap/core/apply',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(
            SECTIONS.SYSTEM_SETTINGS,
            OPERATIONS.UPDATE,
            { requireToken: true, allowOperationTokenFallback: true, allowInactiveTokenFallback: true, keepActive: true }
          ),
          adminApproval,
          ctrl.applyCoreBootstrapBaseline);

// 9. Data Migration (JSON <-> Mongo)
router.get('/data-migration',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          ctrl.showDataMigrationPage);
router.get('/data-migration/copy-collection',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { keepActive: true }),
          ctrl.showDataMigrationCopyCollectionPage);
router.post('/data-migration/copy-collection/overwrite',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(
            SECTIONS.SYSTEM_SETTINGS,
            OPERATIONS.UPDATE,
            { requireToken: true, allowOperationTokenFallback: true, allowInactiveTokenFallback: true }
          ),
          adminApproval,
          ctrl.overwriteDataMigrationCollection);
router.get('/data-migration/items',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
          ctrl.listDataMigrationItems);
router.post('/data-migration/counts',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
          ctrl.countDataMigrationItems);
router.post('/data-migration/backup/mongo',
          requireAuth,
          requireSystemSettingsDownloadAccess,
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { requireToken: true, keepActive: true }),
          ctrl.downloadMongoBackup);
router.post('/data-migration/dry-run',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
          ctrl.dryRunDataMigrationItem);
router.post('/data-migration/transfer',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
          ctrl.transferDataMigrationItem);
router.post('/data-migration/dry-run-clear-target',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
          ctrl.dryRunClearDataMigrationTargetItem);
router.post('/data-migration/clear-target',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
          ctrl.clearDataMigrationTargetItem);
router.post('/data-migration/replace-transfer',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
          ctrl.replaceDataMigrationItem);
router.post('/data-migration/transfer-all',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
          ctrl.transferAllDataMigrationItems);
router.post('/data-migration/dry-run-reverse',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
          ctrl.dryRunDataMigrationItemReverse);
router.post('/data-migration/transfer-reverse',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
          ctrl.transferDataMigrationItemReverse);
router.post('/data-migration/transfer-all-reverse',
          requireAuth,
          requireAccess(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE),
          trackActionState(SECTIONS.SYSTEM_SETTINGS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
          ctrl.transferAllDataMigrationItemsReverse);

module.exports = router;
