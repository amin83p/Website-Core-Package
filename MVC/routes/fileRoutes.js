const express = require('express');
const router = express.Router();
const multer = require('multer');
const fileController = require('../controllers/fileController');
const upload = require('../middleware/upload'); // ✅ Your Context-Aware Middleware
const { requireAuth } = require('../middleware/authMiddleware'); // Assuming you have this
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const adminApproval = require('../middleware/adminApproval');

const orgBackupRestoreLimitMb = Number.parseInt(process.env.ORG_FILE_BACKUP_RESTORE_MAX_MB || '500', 10) || 500;
const orgBackupRestoreUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: orgBackupRestoreLimitMb * 1024 * 1024 }
});

function handleOrgBackupRestoreUpload(req, res, next) {
  orgBackupRestoreUpload.single('backupFile')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `Backup file is too large. Maximum upload size is ${orgBackupRestoreLimitMb} MB.`
      : (error.message || 'Backup upload failed.');
    return res.status(400).json({ status: 'error', message });
  });
}

// List all files
router.get('/', requireAuth, 
  requireAccess(SECTIONS.UPLOADED_FILES, OPERATIONS.READ_ALL), 
  trackActionState(SECTIONS.UPLOADED_FILES, OPERATIONS.READ_ALL), 
  fileController.listFiles);

router.get('/folder-library', requireAuth,
  requireAccess(SECTIONS.UPLOADED_FILES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.UPLOADED_FILES, OPERATIONS.READ_ALL, { keepActive: true }),
  fileController.listFolderLibrary);

// Download specific file
router.get('/download/:filename', requireAuth, 
  requireAccess(SECTIONS.UPLOADED_FILES, OPERATIONS.DOWNLOAD_FILE), 
  trackActionState(SECTIONS.UPLOADED_FILES, OPERATIONS.DOWNLOAD_FILE), 
  fileController.downloadFile);

// Delete specific file
router.get('/delete/:filename', requireAuth, 
  requireAccess(SECTIONS.UPLOADED_FILES, OPERATIONS.DELETE), 
  trackActionState(SECTIONS.UPLOADED_FILES, OPERATIONS.DELETE), 
  fileController.deleteFile); // Fallback for non-JS
  
router.post('/delete/:filename', requireAuth, 
  requireAccess(SECTIONS.UPLOADED_FILES, OPERATIONS.DELETE), 
  trackActionState(SECTIONS.UPLOADED_FILES, OPERATIONS.DELETE, { requireToken: false }), 
  fileController.deleteFile
);

router.post('/move', requireAuth,
  requireAccess(SECTIONS.UPLOADED_FILES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.UPLOADED_FILES, OPERATIONS.UPDATE, { requireToken: false }),
  fileController.moveItem
);

router.post('/copy', requireAuth,
  requireAccess(SECTIONS.UPLOADED_FILES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.UPLOADED_FILES, OPERATIONS.CREATE, { requireToken: false }),
  fileController.copyItem
);

router.post('/rename', requireAuth,
  requireAccess(SECTIONS.UPLOADED_FILES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.UPLOADED_FILES, OPERATIONS.UPDATE, { requireToken: false }),
  fileController.renameItem
);

// Settings: Cleanup logic
router.post('/cleanup', requireAuth, 
  requireAccess(SECTIONS.UPLOADED_FILES, OPERATIONS.DELETE), 
  trackActionState(SECTIONS.UPLOADED_FILES, OPERATIONS.DELETE, { requireToken: false }),
  adminApproval,
  fileController.cleanupOldFiles);

router.post('/upload', requireAuth,
    // Permissions: Assuming WRITE access is needed
    requireAccess(SECTIONS.UPLOADED_FILES, OPERATIONS.CREATE),
    // Middleware: 'files' matches <input name="files" multiple>
    // upload('misc').array('files'), 
    trackActionState(SECTIONS.UPLOADED_FILES, OPERATIONS.CREATE, { requireToken: false }),
    upload('misc', true).array('files'),
    upload.cleanupUploadedFileOnFail,
    fileController.uploadFile
);

router.post('/create-folder', requireAuth,
  requireAccess(SECTIONS.UPLOADED_FILES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.UPLOADED_FILES, OPERATIONS.CREATE, { requireToken: false }),
  fileController.createFolder
);

router.post('/org-backup/download', requireAuth,
  requireAccess(SECTIONS.UPLOADED_FILES, OPERATIONS.DOWNLOAD_FILE),
  trackActionState(SECTIONS.UPLOADED_FILES, OPERATIONS.DOWNLOAD_FILE, { requireToken: false, keepActive: true }),
  fileController.downloadOrgBackup
);

router.post('/org-backup/restore', requireAuth,
  requireAccess(SECTIONS.UPLOADED_FILES, OPERATIONS.UPDATE),
  handleOrgBackupRestoreUpload,
  trackActionState(SECTIONS.UPLOADED_FILES, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  fileController.restoreOrgBackup
);
module.exports = router;
