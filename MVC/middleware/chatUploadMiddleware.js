const multer = require('multer');
const path = require('path');
const fs = require('fs');
const coreFilesService = require('../services/coreFilesService');
const uploadStorageService = require('../services/uploadStorageService');
const chatRepository = require('../repositories/chatRepository');
const chatAccessService = require('../services/chatAccessService');
const chatPolicyService = require('../services/chatPolicyService');
const { OPERATIONS } = require('../../config/accessConstants');

const ALLOWED_EXTENSIONS = new Set(chatPolicyService.DEFAULT_BUILTIN_EXTENSIONS);
const ALLOWED_MIME_TYPES = new Set(chatPolicyService.DEFAULT_BUILTIN_MIME_TYPES);

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function buildStoredFilename(originalName = '') {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  const cleanBase = base.replace(/[^a-zA-Z0-9_-]/g, '_') || 'file';
  return `${cleanBase}_${Date.now()}${ext}`;
}

const memoryUploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: coreFilesService.getMaxUploadFileMb() * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const global = chatPolicyService.getGlobalPolicy();
    if (global.attachmentsEnabled === false) {
      return cb(createHttpError('File attachments are disabled by chat policy.'));
    }
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype;
    if (ALLOWED_EXTENSIONS.has(ext) && ALLOWED_MIME_TYPES.has(mimeType)) {
      return cb(null, true);
    }
    return cb(createHttpError(`File type not allowed: ${ext} (${mimeType})`));
  }
});

async function authorizeAndPersistChatUpload(req, res, next) {
  try {
    if (!Array.isArray(req.files) || req.files.length === 0) {
      throw createHttpError('No files uploaded');
    }
    const convId = String(req.body?.convId || '').trim();
    if (!convId) throw createHttpError('Conversation ID missing');

    const conversation = await chatRepository.getById(convId);
    if (!conversation) throw createHttpError('Conversation not found.', 404);

    const access = await chatAccessService.canAccessConversation({
      user: req.user,
      conversation,
      operationIds: [OPERATIONS.UPDATE],
      ipAddress: req.ip,
      allowGlobalAdmin: false
    });
    if (!access.allowed) {
      throw createHttpError(access.reason || 'You cannot upload attachments to this conversation.', 403);
    }

    const updateAccess = await chatAccessService.canUseChatOperation(req.user, OPERATIONS.UPDATE, req.ip);
    const profileLimits = updateAccess?.limits || {};
    const profileMaxFileSizeKB = Number.isFinite(Number(profileLimits.maxVolumeKB))
      ? Math.floor(Number(profileLimits.maxVolumeKB))
      : (Number.isFinite(Number(profileLimits.maxFileSizeKB))
        ? Math.floor(Number(profileLimits.maxFileSizeKB))
        : null);

    for (const file of req.files) {
      const validation = chatPolicyService.validateAttachmentFile({
        user: req.user,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        profileMaxFileSizeKB: profileMaxFileSizeKB
      });
      if (!validation.allowed) {
        throw createHttpError(validation.reason || 'Attachment is not allowed.', 400);
      }
    }

    const destination = coreFilesService.resolveUploadDestination({
      fixedCategory: 'chat',
      isDynamic: true,
      forceGlobal: true,
      req
    });

    req.files = req.files.map((file) => {
      const storedName = buildStoredFilename(file.originalname);
      const absolutePath = path.join(destination.fullPath, storedName);
      fs.writeFileSync(absolutePath, file.buffer);
      return {
        fieldname: file.fieldname,
        originalname: file.originalname,
        encoding: file.encoding,
        mimetype: file.mimetype,
        size: file.buffer.length,
        destination: destination.fullPath,
        filename: storedName,
        path: absolutePath
      };
    });

    await uploadStorageService.persistMulterUploads({
      category: 'chat',
      req,
      options: { force: true }
    });

    req.chatUploadConversation = conversation;
    req.chatUploadAccess = access;
    return next();
  } catch (error) {
    await coreFilesService.deleteUploadedFiles(req).catch(() => {});
    return next(error);
  }
}

function chatUploadArray(fieldName = 'files', maxCount = 5) {
  return [
    memoryUploader.array(fieldName, maxCount),
    authorizeAndPersistChatUpload
  ];
}

module.exports = {
  chatUploadArray
};
