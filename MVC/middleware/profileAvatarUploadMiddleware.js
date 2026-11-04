'use strict';

const multer = require('multer');
const profileAvatarService = require('../services/profileAvatarService');

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: profileAvatarService.MAX_INGRESS_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = String(file.originalname || '').toLowerCase().match(/\.[^.]+$/)?.[0] || '';
    const mime = String(file.mimetype || '').trim().toLowerCase();
    if (
      profileAvatarService.ALLOWED_EXTENSIONS.has(ext)
      || profileAvatarService.ALLOWED_MIME_TYPES.has(mime)
    ) {
      return cb(null, true);
    }
    return cb(createHttpError('Unsupported image type. Use JPG, PNG, WebP, or HEIC.'));
  }
});

const uploadProfilePhoto = upload.single('photo');

module.exports = {
  uploadProfilePhoto
};
