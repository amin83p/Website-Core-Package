const path = require('path');
const crypto = require('crypto');

const dataService = require('./schoolDataService');
const idempotencyGuardService = require('./idempotencyGuardService');
const { requireCoreModule } = require('./schoolCoreContracts');

const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { isAjax } = requireCoreModule('MVC/utils/generalTools');
const fileService = requireCoreModule('MVC/services/fileService');
const coreFilesService = requireCoreModule('MVC/services/coreFilesService');
const upload = requireCoreModule('MVC/middleware/upload');
const fileAssetStorage = requireCoreModule('MVC/services/fileAssetStorageService');

function parseAttachments(rawValue, fallback = []) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return Array.isArray(fallback) ? fallback.slice() : [];
  }
  if (Array.isArray(rawValue)) return rawValue.slice();
  try {
    const parsed = JSON.parse(String(rawValue));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function buildAttachmentsFromRequest(req, fallback = []) {
  const attachments = parseAttachments(req.body?.attachments, fallback);
  const commentsRaw = req.body?.newFileComments;
  const comments = Array.isArray(commentsRaw)
    ? commentsRaw
    : commentsRaw === undefined || commentsRaw === null
      ? []
      : [commentsRaw];

  (Array.isArray(req.files) ? req.files : []).forEach((file, index) => {
    const normalizedPath = String(upload.getStoredFilePath(file) || '').replace(/\\/g, '/');
    const fileUrl = String(upload.getStoredFileUrl(file) || normalizedPath).replace(/\\/g, '/');
    attachments.push({
      id: crypto.randomBytes(8).toString('hex'),
      originalName: file.originalname,
      filename: file.filename,
      path: normalizedPath,
      url: fileUrl,
      size: file.size,
      uploadDate: new Date().toISOString(),
      comment: String(comments[index] || '').trim()
    });
  });

  return attachments;
}

function findAttachmentIndex(attachments, attachmentId) {
  if (/^\d+$/.test(String(attachmentId || ''))) {
    const index = Number(attachmentId);
    if (index >= 0 && index < attachments.length) return index;
  }
  return attachments.findIndex((attachment) => idsEqual(attachment?.id, attachmentId));
}

function createAttachmentHandlers({
  entityType,
  recordLabel,
  routeBase,
  getActiveOrgIdOrThrow,
  assertRecordOrgAccess
}) {
  if (!entityType || !recordLabel || !routeBase) {
    throw new Error('Attachment handler configuration is incomplete.');
  }

  async function downloadAttachment(req, res) {
    try {
      const activeOrgId = getActiveOrgIdOrThrow(req.user);
      const record = await dataService.getDataById(
        entityType,
        req.params.id,
        req.user,
        dataService.buildRouteAccessContext(req)
      );
      if (!record) return res.status(404).send(`${recordLabel} not found.`);
      assertRecordOrgAccess(record, activeOrgId, req.user);

      const attachments = Array.isArray(record.attachments) ? record.attachments : [];
      const index = findAttachmentIndex(attachments, req.params.attId);
      const attachment = index >= 0 ? attachments[index] : null;
      if (!attachment) return res.status(404).send('Attachment not found.');

      const fileRef = attachment.url || attachment.path;
      if (!fileRef) return res.status(404).send('Attachment file is unavailable.');
      const downloadName = attachment.originalName || attachment.filename || path.basename(String(attachment.path || 'attachment'));
      return fileAssetStorage.sendDownload(res, fileRef, downloadName);
    } catch (error) {
      if (isAjax(req)) return res.status(Number(error?.statusCode || error?.status || 500)).json({ status: 'error', message: error.message });
      return res.status(Number(error?.statusCode || error?.status || 500)).send(error.message || 'Unable to download attachment.');
    }
  }

  async function deleteAttachment(req, res) {
    let guardKey = '';
    try {
      const activeOrgId = getActiveOrgIdOrThrow(req.user);
      guardKey = idempotencyGuardService.createGuardKey([
        `${entityType}_attachment_delete`,
        String(activeOrgId || '').trim(),
        String(req.params.id || '').trim(),
        String(req.params.attId || '').trim()
      ]);
      const guardResult = idempotencyGuardService.beginGuard({
        key: guardKey,
        runningTtlMs: 60000,
        replayTtlMs: 10000
      });
      if (guardResult?.status === 'busy') {
        const payload = {
          status: 'warning',
          message: 'Attachment deletion is already in progress. Please wait.',
          idempotency: {
            state: 'busy',
            retryAfterMs: Number(guardResult.retryAfterMs || 0)
          }
        };
        if (isAjax(req)) return res.status(409).json(payload);
        return res.status(409).send(payload.message);
      }
      if (guardResult?.status === 'replay') {
        const payload = guardResult.payload && typeof guardResult.payload === 'object'
          ? { ...guardResult.payload, idempotency: { state: 'replayed' } }
          : { status: 'success', message: 'Attachment deletion already completed.', idempotency: { state: 'replayed' } };
        if (isAjax(req)) return res.json(payload);
        return res.redirect(`${routeBase}/edit/${encodeURIComponent(String(req.params.id || ''))}`);
      }

      const record = await dataService.getDataById(
        entityType,
        req.params.id,
        req.user,
        dataService.buildRouteAccessContext(req)
      );
      if (!record) throw Object.assign(new Error(`${recordLabel} not found.`), { statusCode: 404 });
      assertRecordOrgAccess(record, activeOrgId, req.user);

      const attachments = Array.isArray(record.attachments) ? record.attachments.slice() : [];
      const index = findAttachmentIndex(attachments, req.params.attId);
      if (index < 0) throw Object.assign(new Error('Attachment not found.'), { statusCode: 404 });

      const [attachment] = attachments.splice(index, 1);
      await dataService.updateData(entityType, req.params.id, { ...record, attachments }, req.user);

      const fileUrl = attachment?.url || coreFilesService.fromDiskPathToUploadsUrl(attachment?.path || '');
      let deleted = false;
      if (fileUrl) deleted = await fileService.deleteFile(fileUrl);
      if (!deleted && attachment?.path) {
        await upload.deleteFilePaths(path.resolve(attachment.path));
      }

      const payload = { status: 'success', message: 'Attachment deleted.', attachments };
      idempotencyGuardService.completeGuard(guardKey, payload);
      if (isAjax(req)) return res.json(payload);
      return res.redirect(`${routeBase}/edit/${encodeURIComponent(String(req.params.id || ''))}`);
    } catch (error) {
      if (guardKey) idempotencyGuardService.failGuard(guardKey);
      const statusCode = Number(error?.statusCode || error?.status || 400);
      if (isAjax(req)) return res.status(statusCode).json({ status: 'error', message: error.message });
      return res.status(statusCode).send(error.message || 'Unable to delete attachment.');
    }
  }

  return { downloadAttachment, deleteAttachment };
}

module.exports = {
  buildAttachmentsFromRequest,
  createAttachmentHandlers,
  findAttachmentIndex,
  parseAttachments
};
