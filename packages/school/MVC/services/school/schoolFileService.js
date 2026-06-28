const { requireCoreModule } = require('./schoolCoreContracts');

const uploadMiddleware = requireCoreModule('MVC/middleware/upload');
const coreFilesService = requireCoreModule('MVC/services/coreFilesService');

function clean(value, max = 600) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeKind(value) {
  const key = clean(value, 80).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return key || 'file';
}

function normalizeUploadedFile(file = {}, context = {}) {
  const storagePath = clean(uploadMiddleware.getStoredFilePath(file));
  const url = clean(uploadMiddleware.getStoredFileUrl(file) || storagePath);
  if (!storagePath && !url) throw new Error('Uploaded file was not stored correctly.');
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
    storagePath: storagePath || url,
    path: storagePath || url,
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
  return {
    ...attachment,
    id: clean(attachment.id, 120) || `legacy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: clean(attachment.name || attachment.originalName || attachment.filename || 'Attached file', 260),
    originalName: clean(attachment.originalName || attachment.name || attachment.filename || 'Attached file', 260),
    url: clean(attachment.url || attachment.uploadUrl || '', 4000) || ref,
    storagePath: clean(attachment.storagePath || attachment.path || '', 4000) || ref
  };
}

async function deleteAttachmentFile(attachment = {}) {
  const refs = [
    attachment?.url,
    attachment?.uploadUrl,
    attachment?.storagePath,
    attachment?.path
  ].map((value) => clean(value, 4000)).filter(Boolean);
  if (!refs.length) return [];
  await coreFilesService.deleteFilePaths([...new Set(refs)]);
  return refs;
}

module.exports = {
  normalizeUploadedFile,
  normalizeExistingAttachment,
  getAttachmentOpenRef,
  deleteAttachmentFile
};
