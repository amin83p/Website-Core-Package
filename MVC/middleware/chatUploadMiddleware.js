const multer = require('multer');
const path = require('path');
const fs = require('fs');
const coreFilesService = require('../services/coreFilesService');
const chatRepository = require('../repositories/chatRepository');
const chatAccessService = require('../services/chatAccessService');
const { OPERATIONS } = require('../../config/accessConstants');

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.rtf',
  '.zip', '.rar', '.7z', '.tar', '.gz'
]);

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/rtf',
  'application/zip',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip'
]);

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

    req.chatUploadConversation = conversation;
    req.chatUploadAccess = access;
    return next();
  } catch (error) {
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
