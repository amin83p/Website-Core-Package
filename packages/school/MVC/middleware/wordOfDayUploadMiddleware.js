'use strict';

const path = require('path');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const { SCHOOL_UPLOAD_FOLDERS } = require('../../config/accessConstants');
const uploadLimitsPolicyService = require('../services/school/uploadLimitsPolicyService');
const wordOfDayService = require('../services/school/wordOfDayService');
const uploadFactory = requireCoreModule('MVC/middleware/upload');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');

const WOD_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.bmp', '.svg']);
const WOD_AUDIO_EXT = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.webm', '.aac', '.flac', '.mpeg', '.mpga']);

function wordOfDayFileFilter(req, file, cb) {
  if (adminAuthorityService.isSuperAdmin(req.user)) {
    return cb(null, true);
  }
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime.startsWith('image/') || WOD_IMAGE_EXT.has(ext)) {
    return cb(null, true);
  }
  if (mime.startsWith('audio/') || WOD_AUDIO_EXT.has(ext)) {
    return cb(null, true);
  }
  return cb(new Error('Word of Day media must be an image or audio file.'));
}

function createUploader(maxFileSizeMb) {
  return uploadFactory(SCHOOL_UPLOAD_FOLDERS.WORD_OF_DAY, true, false, {
    maxFileSizeMb,
    fileFilter: wordOfDayFileFilter
  });
}

async function uploadWordOfDayMedia(req, res, next) {
  try {
    const orgId = wordOfDayService.getActiveOrgId(req.user);
    const kind = String(req.body?.kind || req.query?.kind || 'photo').toLowerCase() === 'audio' ? 'audio' : 'photo';
    const sectionKey = kind === 'audio' ? 'wordOfDayAudio' : 'wordOfDayPhoto';
    let maxMb = 3;
    try {
      maxMb = await uploadLimitsPolicyService.resolveMaxFileSizeMb(orgId, sectionKey);
    } catch (_) {
      maxMb = kind === 'audio' ? 3 : 2;
    }
    const uploader = createUploader(maxMb);
    return uploader.single('file')(req, res, next);
  } catch (error) {
    return next(error);
  }
}

function requireWordOfDayMediaUploadAccess(req, res, next) {
  const access = req._wordOfDayAccess;
  if (!access) {
    return res.status(403).json({ status: 'error', message: 'You do not have permission to upload media.' });
  }
  const can = Boolean(access.canCreateWords || access.canUpdateWords);
  if (!can) {
    return res.status(403).json({ status: 'error', message: 'You do not have permission to upload Word of Day media.' });
  }
  return next();
}

module.exports = {
  uploadWordOfDayMedia,
  requireWordOfDayMediaUploadAccess,
  wordOfDayFileFilter,
  createUploader
};