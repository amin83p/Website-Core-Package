const chatAttachmentAccessService = require('./chatAttachmentAccessService');
const { idsEqual, toPublicId } = require('../utils/idAdapter');

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const pendingByKey = new Map();

function clean(value) {
  return String(value || '').trim();
}

function buildRegistryKey(convId = '', senderId = '', fileName = '') {
  return [clean(convId), clean(senderId), clean(fileName)].join('::');
}

function purgeExpired(now = Date.now()) {
  pendingByKey.forEach((entry, key) => {
    if (!entry || entry.expiresAt <= now) pendingByKey.delete(key);
  });
}

function registerPendingAttachment({
  convId = '',
  senderId = '',
  fileUrl = '',
  fileName = '',
  sizeBytes = 0,
  type = 'file',
  ttlMs = DEFAULT_TTL_MS
} = {}) {
  purgeExpired();
  const normalizedConvId = clean(convId);
  const normalizedSenderId = toPublicId(senderId);
  const resolvedFileName = chatAttachmentAccessService.getFileNameFromReference(fileName || fileUrl);
  if (!normalizedConvId || !normalizedSenderId || !resolvedFileName) {
    throw new Error('Pending attachment registration requires conversation, sender, and file name.');
  }

  const secureUrl = chatAttachmentAccessService.getSecureAttachmentUrl(normalizedConvId, resolvedFileName);
  const storedUrl = clean(fileUrl) || secureUrl;
  const key = buildRegistryKey(normalizedConvId, normalizedSenderId, resolvedFileName);
  const entry = {
    convId: normalizedConvId,
    senderId: normalizedSenderId,
    fileName: resolvedFileName,
    fileUrl: storedUrl,
    secureUrl,
    sizeBytes: Math.max(0, Number(sizeBytes) || 0),
    type: clean(type).toLowerCase() === 'image' ? 'image' : 'file',
    createdAt: Date.now(),
    expiresAt: Date.now() + Math.max(60 * 1000, Number(ttlMs) || DEFAULT_TTL_MS),
    consumed: false
  };
  pendingByKey.set(key, entry);
  return entry;
}

function resolvePendingEntry({ convId = '', senderId = '', fileUrl = '' } = {}) {
  purgeExpired();
  const normalizedConvId = clean(convId);
  const normalizedSenderId = toPublicId(senderId);
  const fileName = chatAttachmentAccessService.getFileNameFromReference(fileUrl);
  if (!normalizedConvId || !normalizedSenderId || !fileName) return null;
  return pendingByKey.get(buildRegistryKey(normalizedConvId, normalizedSenderId, fileName)) || null;
}

function validateAttachmentReference({ convId = '', senderId = '', fileUrl = '' } = {}) {
  const normalizedConvId = clean(convId);
  const normalizedSenderId = toPublicId(senderId);
  const fileName = chatAttachmentAccessService.getFileNameFromReference(fileUrl);
  if (!normalizedConvId || !normalizedSenderId || !fileName) {
    return { allowed: false, reason: 'Attachment reference is invalid.' };
  }

  const secureUrl = chatAttachmentAccessService.getSecureAttachmentUrl(normalizedConvId, fileName);
  const token = clean(fileUrl);
  if (token !== secureUrl) {
    return { allowed: false, reason: 'Attachment must use a server-issued chat URL.' };
  }

  const pending = resolvePendingEntry({ convId: normalizedConvId, senderId: normalizedSenderId, fileUrl: fileName });
  if (!pending || pending.consumed) {
    return { allowed: false, reason: 'Attachment was not registered by an authorized upload for this conversation.' };
  }
  if (!idsEqual(pending.senderId, normalizedSenderId)) {
    return { allowed: false, reason: 'Attachment sender does not match the upload registration.' };
  }
  if (pending.convId !== normalizedConvId) {
    return { allowed: false, reason: 'Attachment conversation does not match the upload registration.' };
  }

  return {
    allowed: true,
    fileName: pending.fileName,
    fileUrl: pending.secureUrl || secureUrl,
    sizeBytes: pending.sizeBytes,
    type: pending.type,
    pending
  };
}

function consumePendingAttachment({ convId = '', senderId = '', fileUrl = '' } = {}) {
  const validation = validateAttachmentReference({ convId, senderId, fileUrl });
  if (!validation.allowed) return validation;
  const key = buildRegistryKey(convId, senderId, validation.fileName);
  const pending = pendingByKey.get(key);
  if (pending) pending.consumed = true;
  return validation;
}

function resetPendingAttachmentsForTests() {
  pendingByKey.clear();
}

module.exports = {
  registerPendingAttachment,
  validateAttachmentReference,
  consumePendingAttachment,
  resetPendingAttachmentsForTests
};
