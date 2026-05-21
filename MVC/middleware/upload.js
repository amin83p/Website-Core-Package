const multer = require('multer');
const path = require('path');
const coreFilesService = require('../services/coreFilesService');

function formatUploadMiddlewareError(error) {
  if (!error) return 'Upload failed.';
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return `One or more files exceed the upload limit of ${coreFilesService.getMaxUploadFileMb()} MB per file.`;
    }
    if (error.code === 'LIMIT_FILE_COUNT') return 'Too many files were selected for upload.';
    if (error.code === 'LIMIT_UNEXPECTED_FILE') return 'Unexpected upload field. Please select files again.';
    return error.message || `Upload failed (${error.code}).`;
  }
  return error.message || String(error) || 'Upload failed.';
}

// Upload factory (compatibility adapter signature preserved)
function upload(fixedCategory = 'misc', isDynamic = false, forceGlobal = false) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const destination = coreFilesService.resolveUploadDestination({
          fixedCategory,
          isDynamic,
          forceGlobal,
          req
        });
        cb(null, destination.fullPath);
      } catch (error) {
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext);
      const cleanBase = base.replace(/[^a-zA-Z0-9_-]/g, '_');
      const unique = Date.now();
      cb(null, `${cleanBase}_${unique}${ext}`);
    }
  });

  const uploader = multer({
    storage,
    limits: { fileSize: coreFilesService.getMaxUploadFileMb() * 1024 * 1024 }
  });

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
            await coreFilesService.mirrorUploadedFilesIfNeeded(req, fixedCategory);
            return next();
          } catch (mirrorError) {
            await coreFilesService.deleteUploadedFiles(req).catch(() => {});
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

async function deleteUploadedFiles(req) {
  return coreFilesService.deleteUploadedFiles(req);
}

function cleanupUploadedFileOnFail(req, res, next) {
  const runCleanup = async () => {
    if (res.statusCode >= 400) {
      await coreFilesService.deleteUploadedFiles(req).catch(() => {});
    }
  };
  res.on('finish', runCleanup);
  res.on('close', runCleanup);
  next();
}

upload.getUploadedFilePaths = (req) => coreFilesService.getUploadedFilePaths(req);
upload.deleteFilePaths = (filePaths) => coreFilesService.deleteFilePaths(filePaths);
upload.deleteUploadedFiles = deleteUploadedFiles;
upload.cleanupUploadedFileOnFail = cleanupUploadedFileOnFail;
upload.getStoredFilePath = (file) => coreFilesService.getStoredFilePath(file);
upload.getStoredFileUrl = (file) => coreFilesService.getStoredFileUrl(file);

module.exports = upload;
