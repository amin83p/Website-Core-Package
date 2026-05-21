// MVC/middleware/upload.js

const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const pathResolver = require('../utils/pathResolver');
const uploadPathUtils = require('../utils/uploadPathUtils');
const pteUploadPathUtils = require('../utils/pteUploadPathUtils');
const { isRailwayProxyMode } = require('../utils/uploadModeUtils');
const { gatewayUploadFile } = require('../services/fileGatewayClientService');
const uploadFolderSettingsService = require('../services/uploadFolderSettingsService');

const PROXY_LOCAL_REQUIRED_CATEGORIES = new Set([
  'imports',
  'public-pages-staging'
]);

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getMaxUploadFileMb() {
  return toPositiveInteger(
    process.env.APP_UPLOAD_MAX_FILE_MB || process.env.FILE_UPLOAD_MAX_MB || process.env.FILE_GATEWAY_MAX_FILE_MB,
    25
  );
}

function formatUploadMiddlewareError(error) {
  if (!error) return 'Upload failed.';
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return `One or more files exceed the upload limit of ${getMaxUploadFileMb()} MB per file.`;
    }
    if (error.code === 'LIMIT_FILE_COUNT') return 'Too many files were selected for upload.';
    if (error.code === 'LIMIT_UNEXPECTED_FILE') return 'Unexpected upload field. Please select files again.';
    return error.message || `Upload failed (${error.code}).`;
  }
  return error.message || String(error) || 'Upload failed.';
}

function isUploadsUrl(value = '') {
  return /^\/uploads\//i.test(String(value || '').trim());
}

function isUploadReference(value = '') {
  return Boolean(uploadPathUtils.extractRelativeUploadPath(value));
}

function shouldKeepLocalProxyPath(category = '') {
  return PROXY_LOCAL_REQUIRED_CATEGORIES.has(String(category || '').trim());
}

function cleanFolderId(value, fallback = '') {
  return uploadFolderSettingsService.sanitizeFolderToken(value, fallback || 'item_unsaved');
}

function resolveConfiguredUploadCategory(fixedCategory = 'misc', isDynamic = false, req = {}) {
  if (fixedCategory === 'imports') return 'imports';
  if (fixedCategory === 'misc') return uploadFolderSettingsService.resolveUploadFolder('core.fileManager');
  if (fixedCategory === 'public-pages') {
    return path.join(uploadFolderSettingsService.resolveUploadFolder('core.fileManager'), 'public-pages');
  }
  if (fixedCategory === 'public-pages-staging') {
    return path.join(uploadFolderSettingsService.resolveUploadFolder('core.fileManager'), 'public-pages-staging');
  }
  if (fixedCategory === 'symbols') return uploadFolderSettingsService.resolveUploadFolder('core.symbols');
  if (fixedCategory === 'news') return uploadFolderSettingsService.resolveUploadFolder('core.news');
  if (fixedCategory === 'contacts') return uploadFolderSettingsService.resolveUploadFolder('core.contacts');
  if (fixedCategory === 'ielts') return uploadFolderSettingsService.resolveUploadFolder('core.ielts');
  if (fixedCategory === 'reports') return uploadFolderSettingsService.resolveUploadFolder('school.reportTemplates');
  if (fixedCategory === 'tasks') {
    return uploadFolderSettingsService.resolveUploadFolder('core.tasks', {
      taskId: req.body?.taskId
    });
  }
  if (fixedCategory === 'chat') {
    return uploadFolderSettingsService.resolveUploadFolder('core.chat', {
      conversationId: req.body?.convId || req.params?.convId
    });
  }
  if (fixedCategory === 'students') {
    return uploadFolderSettingsService.resolveUploadFolder('school.students', {
      personId: req.body?.personId || req.params?.personId || req.params?.id
    });
  }
  if (fixedCategory === 'school-exams') {
    return uploadFolderSettingsService.resolveUploadFolder('school.examMedia', {
      templateId: req.body?.templateId || req.params?.templateId || 'template_unsaved',
      questionId: req.body?.questionId || req.params?.questionId || '_unsaved'
    });
  }
  if (fixedCategory === 'pte-question-bank') {
    return pteUploadPathUtils.buildQuestionBankCategory();
  }
  if (fixedCategory === 'pte-students') {
    return pteUploadPathUtils.buildStudentCategory({
      bucket: req.pteStorageContext?.bucket,
      itemId:
        req.params?.id ||
        req.body?.studentId ||
        req.body?.mediaItemId ||
        req.body?.applicantId ||
        req.body?.personId ||
        'item_unsaved',
      includeItemFolder: isDynamic !== false
    });
  }
  if (fixedCategory === 'pte-attempts') {
    return pteUploadPathUtils.buildAttemptCategory({
      bucket: req.pteStorageContext?.bucket,
      userId: req.pteStorageContext?.userId || req.user?.id || req.body?.userId,
      practiceName: req.pteStorageContext?.practiceName || req.body?.practiceName || req.body?.practiceId,
      testName: req.pteStorageContext?.testName || req.body?.testName || req.body?.examName,
      sessionId:
        req.pteStorageContext?.sessionId ||
        req.params?.sessionId ||
        req.body?.sessionId ||
        req.body?.attemptSessionId ||
        req.body?.practiceId ||
        req.body?.examId,
      itemId:
        req.pteStorageContext?.itemId ||
        req.params?.itemId ||
        req.body?.itemId ||
        req.body?.attemptItemId ||
        req.body?.questionId
    });
  }

  if (isDynamic) {
    if (req.body?.taskId) return path.join(fixedCategory, cleanFolderId(req.body.taskId, 'task_unsaved'));
    if (req.body?.convId) return path.join(fixedCategory, cleanFolderId(req.body.convId, 'conversation_unsaved'));
  }
  return fixedCategory;
}

// Upload factory (keeps your existing signature/behavior)
function upload(fixedCategory = 'misc', isDynamic = false, forceGlobal = false) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        let scopeId = 'GLOBAL';
        let category = fixedCategory;

        // 1) Determine scope (org vs global)
        if (
          !forceGlobal &&
          req.user &&
          req.user.activeOrgId &&
          req.user.activeOrgId !== 'SYSTEM'
        ) {
          scopeId = req.user.activeOrgId;
        }

        // 2) Resolve configured category/subfolder
        category = resolveConfiguredUploadCategory(fixedCategory, isDynamic, req);

        // 3) Resolve safe path + ensure directory exists
        const root = pathResolver.getRootPath(scopeId);
        const fullPath = pathResolver.resolveSafePath(root, category);
        pathResolver.ensureDir(fullPath);

        cb(null, fullPath);
      } catch (err) {
        cb(err);
      }
    },

    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext);
      const cleanBase = base.replace(/[^a-zA-Z0-9_-]/g, '_');
      const unique = Date.now();
      cb(null, `${cleanBase}_${unique}${ext}`);
    },
  });

  const uploader = multer({
    storage,
    limits: { fileSize: getMaxUploadFileMb() * 1024 * 1024 },
  });

  async function mirrorUploadedFilesIfNeeded(req) {
    if (!isRailwayProxyMode()) return;
    if (shouldKeepLocalProxyPath(fixedCategory)) return;
    const requestPath = String(req.originalUrl || req.url || '').toLowerCase();
    if (requestPath.includes('/internal/file-gateway/')) return;
    if (requestPath.includes('/files/upload')) return;

    const uploadRoot = uploadPathUtils.getUploadRootAbsolute();
    const rows = [];
    if (req?.file) rows.push(req.file);
    if (Array.isArray(req?.files)) rows.push(...req.files);
    if (req?.files && typeof req.files === 'object' && !Array.isArray(req.files)) {
      Object.values(req.files).forEach((entry) => {
        if (Array.isArray(entry)) rows.push(...entry);
      });
    }

    for (const file of rows) {
      const absolutePath = String(file?.path || '').trim();
      if (!absolutePath) continue;
      if (!uploadPathUtils.isInsideUploadRoot(absolutePath, uploadRoot)) continue;

      const relative = path.relative(uploadRoot, absolutePath).split(path.sep).join('/');
      const parts = String(relative || '').split('/').filter(Boolean);
      if (parts.length < 2) continue;

      const scopeToken = String(parts.shift() || '').toUpperCase();
      const scopeKey = scopeToken === 'GLOBAL'
        ? 'GLOBAL'
        : scopeToken.replace(/^ORG_/, '');
      const desiredName = parts.pop() || String(file.originalname || file.filename || '').trim();
      const relativeDir = parts.join('/');

      const gatewayResult = await gatewayUploadFile({
        scopeKey,
        relativeDir,
        desiredName,
        localFilePath: absolutePath,
        mimeType: file.mimetype || 'application/octet-stream'
      });

      file.localPath = absolutePath;
      file.uploadUrl = String(gatewayResult?.url || '').trim();
      file.storagePath = file.uploadUrl || file.path;
      file.gatewayRelativePath = String(gatewayResult?.relativePath || '').trim();
      file.gatewayFileName = String(gatewayResult?.fileName || '').trim();
      if (file.gatewayFileName) file.filename = file.gatewayFileName;
      if (file.uploadUrl) file.path = file.uploadUrl;

      await fs.unlink(absolutePath).catch(() => {});
    }
  }

  const originalUploadMethods = {
    single: uploader.single.bind(uploader),
    array: uploader.array.bind(uploader),
    fields: uploader.fields.bind(uploader),
    any: uploader.any.bind(uploader),
    none: uploader.none.bind(uploader)
  };

  function wrapUploadMethod(methodName) {
    return (...args) => {
      const originalMethod = originalUploadMethods[methodName];
      if (typeof originalMethod !== 'function') {
        throw new Error(`Unsupported multer method: ${methodName}`);
      }
      const baseMiddleware = originalMethod(...args);
      return (req, res, next) => {
        baseMiddleware(req, res, async (error) => {
          if (error) {
            const wantsJson = Boolean(req.headers['x-ajax-request'])
              || String(req.originalUrl || req.url || '').toLowerCase().includes('/files/upload');
            if (wantsJson && !res.headersSent) {
              return res.status(400).json({
                status: 'error',
                message: formatUploadMiddlewareError(error)
              });
            }
            return next(error);
          }
          try {
            await mirrorUploadedFilesIfNeeded(req);
            return next();
          } catch (mirrorError) {
            await deleteUploadedFiles(req).catch(() => {});
            return next(mirrorError);
          }
        });
      };
    };
  }

  uploader.single = wrapUploadMethod('single');
  uploader.array = wrapUploadMethod('array');
  uploader.fields = wrapUploadMethod('fields');
  uploader.any = wrapUploadMethod('any');
  uploader.none = wrapUploadMethod('none');

  return uploader;
}

// ---------- Helpers: collect + delete uploaded files ----------

// Returns an array of uploaded file paths for this request
function getUploadedFilePaths(req) {
  const out = [];

  if (req?.file?.path) out.push(req.file.path);
  if (req?.file?.localPath) out.push(req.file.localPath);
  if (req?.file?.uploadUrl) out.push(req.file.uploadUrl);

  const files = req?.files;

  if (Array.isArray(files)) {
    files.forEach(f => {
      if (f?.path) out.push(f.path);
      if (f?.localPath) out.push(f.localPath);
      if (f?.uploadUrl) out.push(f.uploadUrl);
    });
  } else if (files && typeof files === 'object') {
    Object.values(files).forEach(arr => {
      if (Array.isArray(arr)) {
        arr.forEach(f => {
          if (f?.path) out.push(f.path);
          if (f?.localPath) out.push(f.localPath);
          if (f?.uploadUrl) out.push(f.uploadUrl);
        });
      }
    });
  }

  return [...new Set(out)];
}

// Deletes an array (or single string) of file paths, ignores errors
async function deleteFilePaths(filePaths = []) {
  const list = Array.isArray(filePaths) ? filePaths : [filePaths];

  await Promise.all(
    list
      .filter(Boolean)
      .map(async (p) => {
        const target = String(p || '').trim();
        if (!target) return;
        if (isUploadReference(target) && isRailwayProxyMode()) {
          try {
            const { gatewayDeleteByUploadUrl } = require('../services/fileGatewayClientService');
            await gatewayDeleteByUploadUrl(target);
          } catch (_) {
            // Ignore cleanup failures; callers use this as best-effort rollback.
          }
          return;
        }
        const diskPath = isUploadReference(target)
          ? uploadPathUtils.fromUploadsUrlToDiskPath(target)
          : target;
        await fs.unlink(diskPath).catch(() => {});
      })
  );
}

// Deletes whatever was uploaded in the current request
async function deleteUploadedFiles(req) {
  const paths = getUploadedFilePaths(req);
  await deleteFilePaths(paths);
  return paths;
}

// Middleware: if request ends with error status (>= 400), delete uploaded files
function cleanupUploadedFileOnFail(req, res, next) {
  const runCleanup = async () => {
    if (res.statusCode >= 400) {
      await deleteUploadedFiles(req).catch(() => {});
    }
  };

  res.on('finish', runCleanup);
  res.on('close', runCleanup);
  next();
}

upload.getUploadedFilePaths = getUploadedFilePaths;
upload.deleteFilePaths = deleteFilePaths;
upload.deleteUploadedFiles = deleteUploadedFiles;
upload.cleanupUploadedFileOnFail = cleanupUploadedFileOnFail;
upload.getStoredFilePath = (file) => String(file?.uploadUrl || file?.storagePath || file?.path || '').trim();
upload.getStoredFileUrl = (file) => String(file?.uploadUrl || file?.storagePath || '').trim()
  || uploadPathUtils.fromDiskPathToUploadsUrl(file?.path || '');

module.exports = upload;
