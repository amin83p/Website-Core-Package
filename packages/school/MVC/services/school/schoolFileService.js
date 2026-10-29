const crypto = require('crypto');
const { requireCoreModule } = require('./schoolCoreContracts');

const uploadMiddleware = requireCoreModule('MVC/middleware/upload');
const uploadStorage = requireCoreModule('MVC/services/uploadStorageService');

function clean(value, max = 600) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeKind(value) {
  const key = clean(value, 80).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return key || 'file';
}

function resolveMulterStoredRef(file = {}) {
  const rawRef = uploadStorage.getStoredRefFromFile(file)
    || clean(uploadMiddleware.getStoredFileUrl(file))
    || clean(uploadMiddleware.getStoredFilePath(file));
  if (!rawRef) throw new Error('Uploaded file was not stored correctly.');
  try {
    return uploadStorage.normalizeReference(rawRef);
  } catch (error) {
    if (uploadStorage.isRailwayGatewayBackend()) {
      throw new Error('Uploaded file must be stored as an /uploads/ URL.');
    }
    throw error;
  }
}

function buildAttachmentFromMulterFile(file = {}, context = {}) {
  const url = resolveMulterStoredRef(file);
  const originalName = clean(file.originalname || file.filename || 'attachment', 260);
  return {
    id: clean(context.id, 120) || crypto.randomBytes(8).toString('hex'),
    originalName,
    filename: clean(file.filename || originalName, 260),
    path: url,
    url,
    size: Number(file.size || 0) || 0,
    uploadDate: context.uploadDate || new Date().toISOString(),
    comment: clean(context.comment, 600)
  };
}

function buildBookFileAssetFromMulter(file = {}) {
  if (!file || (!file.path && !file.filename && !file.storedRef)) return null;
  const url = resolveMulterStoredRef(file);
  return {
    fileName: String(file.filename || '').trim(),
    originalName: String(file.originalname || file.filename || '').trim(),
    path: url,
    url,
    uploadedAt: new Date().toISOString()
  };
}

function buildExamMediaRefFromMulter(file = {}, index = 0, idPrefix = 'MEDIA') {
  const url = resolveMulterStoredRef(file);
  const originalName = String(file.originalname || file.filename || '').trim();
  return {
    id: `${idPrefix}_${Date.now()}_${index + 1}`,
    fileId: '',
    label: originalName,
    fileName: String(file.filename || '').trim(),
    originalName,
    mimeType: String(file.mimetype || '').trim(),
    storagePath: url,
    url,
    sizeBytes: Number(file.size || 0) || 0
  };
}

function normalizeUploadedFile(file = {}, context = {}) {
  const url = resolveMulterStoredRef(file);
  const now = new Date().toISOString();
  const originalName = clean(file.originalname || file.filename || 'attachment', 260);
  return {
    id: clean(context.id, 120) || `${normalizeKind(context.kind)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind: normalizeKind(context.kind),
    name: originalName,
    originalName,
    filename: clean(file.filename || originalName, 260),
    mimeType: clean(file.mimetype || 'application/octet-stream', 120),
    size: Number(file.size || 0) || 0,
    url,
    storagePath: url,
    path: url,
    uploadedAt: now,
    uploadedBy: clean(context.uploadedBy, 120),
    classId: clean(context.classId, 120),
    sessionId: clean(context.sessionId, 120),
    studentPersonId: clean(context.studentPersonId || context.personId, 120),
    subjectId: clean(context.subjectId, 120)
  };
}

function getAttachmentOpenRef(attachment = {}) {
  if (!attachment || typeof attachment !== 'object') return '';
  return clean(attachment.url || attachment.uploadUrl || attachment.storagePath || attachment.path || attachment.dataUrl || '', 4000);
}

function normalizeExistingAttachment(attachment = null) {
  if (!attachment || typeof attachment !== 'object') return null;
  const ref = getAttachmentOpenRef(attachment);
  let url = clean(attachment.url || attachment.uploadUrl || '', 4000) || ref;
  if (url && uploadStorage.isUploadReference(url)) {
    try {
      url = uploadStorage.normalizeReference(url);
    } catch (_) { /* keep legacy ref for display */ }
  }
  return {
    ...attachment,
    id: clean(attachment.id, 120) || `legacy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: clean(attachment.name || attachment.originalName || attachment.filename || 'Attached file', 260),
    originalName: clean(attachment.originalName || attachment.name || attachment.filename || 'Attached file', 260),
    url,
    storagePath: url || clean(attachment.storagePath || attachment.path || '', 4000) || ref
  };
}

async function deleteStoredUploadRef(ref = '') {
  const token = clean(ref, 4000);
  if (!token) return false;
  if (!uploadStorage.isUploadReference(token)) return false;
  await uploadStorage.deleteByReference(token);
  return true;
}

async function deleteAttachmentFile(attachment = {}) {
  const refs = [
    attachment?.url,
    attachment?.uploadUrl,
    attachment?.storagePath,
    attachment?.path
  ].map((value) => clean(value, 4000)).filter(Boolean);
  if (!refs.length) return [];
  const unique = [...new Set(refs)];
  for (const ref of unique) {
    await deleteStoredUploadRef(ref).catch(() => {});
  }
  return unique;
}

function normalizeAttachmentDownloadRef(attachment = {}) {
  const raw = clean(attachment?.url || attachment?.path || '', 4000);
  if (!raw) return '';
  if (uploadStorage.isUploadReference(raw)) {
    try {
      return uploadStorage.normalizeReference(raw);
    } catch (_) {
      return raw;
    }
  }
  try {
    return uploadStorage.normalizeReference(raw);
  } catch (_) {
    return raw;
  }
}

module.exports = {
  resolveMulterStoredRef,
  buildAttachmentFromMulterFile,
  buildBookFileAssetFromMulter,
  buildExamMediaRefFromMulter,
  normalizeUploadedFile,
  normalizeExistingAttachment,
  getAttachmentOpenRef,
  normalizeAttachmentDownloadRef,
  deleteStoredUploadRef,
  deleteAttachmentFile
};
