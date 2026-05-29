const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const controller = require('../../controllers/internal/fileGatewayController');
const fileGatewayAuth = require('../../middleware/fileGatewayAuthMiddleware');

const router = express.Router();

const gatewayRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number.parseInt(process.env.FILE_GATEWAY_RATE_LIMIT_PER_MIN || '240', 10) || 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Gateway rate limit exceeded.' }
});

const uploadLimitMb = Number.parseInt(process.env.FILE_GATEWAY_MAX_FILE_MB || '25', 10) || 25;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadLimitMb * 1024 * 1024 }
});
const ORG_FILE_BACKUP_RESTORE_MAX_MB = Number.parseInt(process.env.ORG_FILE_BACKUP_RESTORE_MAX_MB || '500', 10) || 500;
const backupRestoreUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ORG_FILE_BACKUP_RESTORE_MAX_MB * 1024 * 1024 }
});

function handleBackupRestoreUpload(req, res, next) {
  backupRestoreUpload.single('backupFile')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `Backup file is too large. Maximum upload size is ${ORG_FILE_BACKUP_RESTORE_MAX_MB} MB. Set ORG_FILE_BACKUP_RESTORE_MAX_MB and restart the gateway service if a larger restore is required.`
      : (error.message || 'Backup upload failed.');
    return res.status(400).json({ status: 'error', message });
  });
}

function handleGatewayUpload(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `Gateway upload file is too large. Maximum upload size is ${uploadLimitMb} MB. Increase FILE_GATEWAY_MAX_FILE_MB and restart the service.`
      : (error.message || 'Gateway upload failed.');
    return res.status(400).json({ status: 'error', message });
  });
}

router.post('/upload', gatewayRateLimiter, fileGatewayAuth('/internal/file-gateway/upload'), handleGatewayUpload, controller.upload);
router.post('/mkdir', gatewayRateLimiter, fileGatewayAuth('/internal/file-gateway/mkdir'), controller.mkdir);
router.post('/delete', gatewayRateLimiter, fileGatewayAuth('/internal/file-gateway/delete'), controller.delete);
router.post('/move', gatewayRateLimiter, fileGatewayAuth('/internal/file-gateway/move'), controller.move);
router.post('/copy', gatewayRateLimiter, fileGatewayAuth('/internal/file-gateway/copy'), controller.copy);
router.post('/rename', gatewayRateLimiter, fileGatewayAuth('/internal/file-gateway/rename'), controller.rename);
router.post('/list', gatewayRateLimiter, fileGatewayAuth('/internal/file-gateway/list'), controller.list);
router.post('/packages/runtime/list', gatewayRateLimiter, fileGatewayAuth('/internal/file-gateway/packages/runtime/list'), controller.listRuntimePackages);
router.post('/packages/runtime/download', gatewayRateLimiter, fileGatewayAuth('/internal/file-gateway/packages/runtime/download'), controller.downloadRuntimePackage);
router.post('/resolve', gatewayRateLimiter, fileGatewayAuth('/internal/file-gateway/resolve'), controller.resolve);
router.get('/resolve', gatewayRateLimiter, fileGatewayAuth('/internal/file-gateway/resolve'), controller.resolve);
router.post('/org-backup/download', gatewayRateLimiter, fileGatewayAuth('/internal/file-gateway/org-backup/download'), controller.downloadOrgBackup);
router.post('/org-backup/restore', gatewayRateLimiter, fileGatewayAuth('/internal/file-gateway/org-backup/restore'), handleBackupRestoreUpload, controller.restoreOrgBackup);

module.exports = router;
