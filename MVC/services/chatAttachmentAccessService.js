const path = require('path');
const coreFilesService = require('./coreFilesService');
const fileAssetStorage = require('./fileAssetStorageService');
const uploadFolderSettingsService = require('./uploadFolderSettingsService');

const MIME_TYPES_BY_EXTENSION = Object.freeze({
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.rtf': 'application/rtf',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip'
});

function clean(value) {
  return String(value || '').trim();
}

function decodePathSegment(value = '') {
  const token = clean(value);
  if (!token) return '';
  try {
    return decodeURIComponent(token);
  } catch (_) {
    return token;
  }
}

function normalizePathParts(value = '') {
  return clean(value)
    .split(/[?#]/)[0]
    .replace(/\\/g, '/')
    .split('/')
    .map(decodePathSegment)
    .map((part) => clean(part))
    .filter(Boolean);
}

function getFileNameFromReference(fileRef = '') {
  const parts = normalizePathParts(fileRef);
  const candidate = parts.length ? parts[parts.length - 1] : clean(fileRef);
  if (!candidate) return '';
  return coreFilesService.assertValidName(candidate, 'file name');
}

function getSecureAttachmentUrl(conversationId = '', fileRef = '') {
  const convId = clean(conversationId);
  const fileName = getFileNameFromReference(fileRef);
  if (!convId || !fileName) return '';
  return `/chat/attachments/${encodeURIComponent(convId)}/${encodeURIComponent(fileName)}`;
}

function uniqueRows(rows = []) {
  const seen = new Set();
  const out = [];
  rows.forEach((row) => {
    const token = clean(row).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!token || seen.has(token)) return;
    seen.add(token);
    out.push(token);
  });
  return out;
}

function getConversationUploadDirs(conversationId = '') {
  return uniqueRows([
    uploadFolderSettingsService.resolveUploadFolder('core.chat', {
      conversationId
    }),
    uploadFolderSettingsService.resolveDefaultUploadFolder('core.chat', {
      conversationId
    })
  ]);
}

function guessMimeType(fileName = '', fallback = 'application/octet-stream') {
  const ext = path.extname(clean(fileName)).toLowerCase();
  return MIME_TYPES_BY_EXTENSION[ext] || fallback;
}

function buildCandidateUploadRefs(conversationId = '', fileName = '') {
  const safeName = getFileNameFromReference(fileName);
  return uniqueRows(getConversationUploadDirs(conversationId).flatMap((relativeDir) => ([
    `/uploads/GLOBAL/${relativeDir}/${safeName}`,
    `/uploads/${relativeDir}/${safeName}`
  ]))).map((relative) => `/${relative}`);
}

async function loadAttachment(conversationId = '', fileName = '') {
  const safeName = getFileNameFromReference(fileName);
  const candidates = buildCandidateUploadRefs(conversationId, safeName);
  let lastError = null;

  for (const ref of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const loaded = await fileAssetStorage.readBuffer(ref);
      if (loaded?.buffer) {
        return {
          ...loaded,
          ref,
          fileName: safeName,
          mimeType: clean(loaded.mimeType) || guessMimeType(safeName)
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  const error = new Error(lastError?.code === 'ENOENT' ? 'Attachment not found.' : (lastError?.message || 'Attachment not found.'));
  error.statusCode = 404;
  throw error;
}

function deriveProtectedPrefixParts(template = '') {
  const token = clean(template).replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!token) return [];
  const beforeConversation = token.split('{conversationId}')[0] || token;
  return beforeConversation
    .replace(/\/+$/, '')
    .split('/')
    .map((part) => clean(part).toLowerCase())
    .filter(Boolean);
}

function getProtectedChatUploadPrefixes() {
  let current = '';
  let fallback = '';
  try {
    current = uploadFolderSettingsService.getUploadFolderTemplate('core.chat');
  } catch (_) {
    current = '';
  }
  try {
    fallback = uploadFolderSettingsService.getDefinition
      ? uploadFolderSettingsService.getDefinition('core.chat')?.defaultTemplate
      : '';
  } catch (_) {
    fallback = '';
  }

  if (!fallback) fallback = 'chat/{conversationId}';

  return uniqueRows([current, fallback])
    .map(deriveProtectedPrefixParts)
    .filter((parts) => parts.length > 0);
}

function stripUploadScopePrefix(parts = []) {
  if (!parts.length) return [];
  const [first, ...rest] = parts;
  const token = clean(first).toLowerCase();
  if (token === 'global' || token === 'system' || /^org_[a-z0-9_-]+$/i.test(token)) return rest;
  return parts;
}

function hasPrefix(parts = [], prefix = []) {
  if (!parts.length || !prefix.length || parts.length < prefix.length) return false;
  return prefix.every((part, index) => clean(parts[index]).toLowerCase() === part);
}

function isProtectedChatUploadPath(uploadMountedPath = '') {
  const rawParts = normalizePathParts(uploadMountedPath).map((part) => part.toLowerCase());
  const withoutUploads = rawParts[0] === 'uploads' ? rawParts.slice(1) : rawParts;
  const parts = stripUploadScopePrefix(withoutUploads);
  if (!parts.length) return false;
  return getProtectedChatUploadPrefixes().some((prefix) => hasPrefix(parts, prefix));
}

module.exports = {
  getFileNameFromReference,
  getSecureAttachmentUrl,
  getConversationUploadDirs,
  buildCandidateUploadRefs,
  guessMimeType,
  loadAttachment,
  isProtectedChatUploadPath
};
