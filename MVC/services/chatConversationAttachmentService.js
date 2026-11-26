const fs = require('fs');
const fsPromises = require('fs').promises;
const chatRepository = require('../repositories/chatRepository');
const coreFilesService = require('./coreFilesService');
const uploadStorage = require('./uploadStorageService');
const uploadStoragePolicy = require('./uploadStoragePolicyService');
const chatAttachmentAccessService = require('./chatAttachmentAccessService');
const { MAX_CHAT_MESSAGE_PAGE_SIZE } = require('./chatMessagePaginationService');

const ATTACHMENT_MESSAGE_TYPES = new Set(['image', 'file']);

function clean(value) {
  return String(value || '').trim();
}

function getConversationUploadDirs(conversationId) {
  return chatAttachmentAccessService.getConversationUploadDirs(conversationId);
}

function isAttachmentMessage(message) {
  const type = clean(message?.type).toLowerCase();
  return ATTACHMENT_MESSAGE_TYPES.has(type) && !!clean(message?.fileUrl);
}

function basenameFromFileUrl(fileUrl) {
  try {
    return chatAttachmentAccessService.getFileNameFromReference(fileUrl);
  } catch (_) {
    return '';
  }
}

async function listFilesUnderRelativeDir(scopeKey, relativeDir) {
  const files = [];
  try {
    const entries = await uploadStorage.listDirectory({ scopeKey, relativeDir });
    for (const entry of (Array.isArray(entries) ? entries : [])) {
      const name = clean(entry?.name);
      if (!name) continue;
      const childRelative = [relativeDir, name].filter(Boolean).join('/').replace(/\\/g, '/');
      if (entry.isDir) {
        // eslint-disable-next-line no-await-in-loop
        files.push(...await listFilesUnderRelativeDir(scopeKey, childRelative));
      } else {
        files.push({
          fileName: name,
          relativePath: childRelative,
          size: Number(entry?.size || 0)
        });
      }
    }
  } catch (_) {
    /* missing dir */
  }
  return files;
}

async function listConversationAttachmentFiles(convId) {
  const dirs = getConversationUploadDirs(convId);
  const rows = [];
  const seen = new Set();
  for (const relativeDir of dirs) {
    // eslint-disable-next-line no-await-in-loop
    const listed = await listFilesUnderRelativeDir('GLOBAL', relativeDir);
    listed.forEach((row) => {
      const key = `${relativeDir}/${row.fileName}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ ...row, relativeDir });
    });
  }
  if (uploadStoragePolicy.allowLocalUploadFallback()) {
    try {
      const root = coreFilesService.getRootPath('GLOBAL');
      const chatDir = coreFilesService.resolveSafePath(root, `chat/${convId}`);
      if (fs.existsSync(chatDir)) {
        const walk = (dir, prefix = '') => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          entries.forEach((entry) => {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            const full = pathJoinSafe(dir, entry.name);
            if (entry.isDirectory()) walk(full, rel);
            else {
              const key = `legacy:${entry.name}`;
              if (!seen.has(key)) {
                seen.add(key);
                let size = 0;
                try { size = fs.statSync(full).size; } catch (_) { /* ignore */ }
                rows.push({ fileName: entry.name, relativePath: `chat/${convId}/${rel}`, relativeDir: `chat/${convId}`, size, legacy: true });
              }
            }
          });
        };
        walk(chatDir);
      }
    } catch (_) {
      /* legacy missing */
    }
  }
  return rows;
}

function pathJoinSafe(base, name) {
  const path = require('path');
  return path.join(base, name);
}

async function loadAllMessagesRaw(convId) {
  const out = [];
  let before = null;
  let guard = 0;
  while (guard++ < 500) {
    const options = { limit: MAX_CHAT_MESSAGE_PAGE_SIZE, viewerUserId: null };
    if (before) options.before = before;
    // eslint-disable-next-line no-await-in-loop
    const page = await chatRepository.getMessages(convId, options);
    const messages = Array.isArray(page?.messages) ? page.messages : [];
    if (!messages.length) break;
    out.push(...messages);
    if (!page.hasMore || !page.oldestId) break;
    before = page.oldestId;
  }
  return out;
}

async function collectReferencedAttachmentFileNames(convId) {
  const messages = await loadAllMessagesRaw(convId);
  const names = new Set();
  messages.forEach((message) => {
    if (!clean(message?.fileUrl)) return;
    const base = basenameFromFileUrl(message.fileUrl);
    if (base) names.add(base);
  });
  return names;
}

async function deleteConversationAttachments(convId) {
  const id = clean(convId);
  if (!id) return false;
  let filesDeleted = false;
  const dirs = getConversationUploadDirs(id);
  for (const relativePath of dirs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const removed = await uploadStorage.deleteRelativePath({
        scopeKey: 'GLOBAL',
        relativePath
      });
      if (removed) {
        filesDeleted = true;
        console.log(`[Chat] Deleted attachments for: ${id}`);
      }
    } catch (e) {
      console.warn(`[Chat] File cleanup note for ${id}:`, e.message);
    }
  }
  if (!filesDeleted && uploadStoragePolicy.allowLocalUploadFallback()) {
    try {
      const root = coreFilesService.getRootPath('GLOBAL');
      const chatDir = coreFilesService.resolveSafePath(root, `chat/${id}`);
      if (fs.existsSync(chatDir)) {
        await fsPromises.rm(chatDir, { recursive: true, force: true });
        filesDeleted = true;
        console.log(`[Chat] Deleted legacy attachments for: ${id}`);
      }
    } catch (e) {
      console.warn(`[Chat] Legacy file cleanup note for ${id}:`, e.message);
    }
  }
  return filesDeleted;
}

function assertSafeAttachmentFileName(fileName) {
  return coreFilesService.assertValidName(clean(fileName), 'file name');
}

async function deleteAttachmentFiles(convId, fileNames = []) {
  const id = clean(convId);
  if (!id) return { deleted: [], skipped: [] };
  const names = [...new Set((Array.isArray(fileNames) ? fileNames : [])
    .map((value) => {
      try {
        return assertSafeAttachmentFileName(value);
      } catch (_) {
        return '';
      }
    })
    .filter(Boolean))];
  if (!names.length) return { deleted: [], skipped: [] };

  const dirs = getConversationUploadDirs(id);
  const deleted = [];
  const skipped = [];

  for (const fileName of names) {
    let removed = false;
    for (const relativeDir of dirs) {
      const relativePath = `${relativeDir}/${fileName}`.replace(/\\/g, '/');
      const probePath = `/uploads/GLOBAL/${relativePath}`;
      if (!chatAttachmentAccessService.isProtectedChatUploadPath(probePath)) {
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const ok = await uploadStorage.deleteRelativePath({
          scopeKey: 'GLOBAL',
          relativePath
        });
        if (ok) {
          removed = true;
          break;
        }
      } catch (_) {
        /* try next dir */
      }
    }
    if (uploadStoragePolicy.allowLocalUploadFallback() && !removed) {
      try {
        const root = coreFilesService.getRootPath('GLOBAL');
        const filePath = coreFilesService.resolveSafePath(root, `chat/${id}/${fileName}`);
        if (fs.existsSync(filePath)) {
          await fsPromises.rm(filePath, { force: true });
          removed = true;
        }
      } catch (_) {
        /* ignore */
      }
    }
    if (removed) deleted.push(fileName);
    else if (!skipped.includes(fileName)) skipped.push(fileName);
  }

  return { deleted, skipped };
}

async function deleteUnreferencedAttachments(convId, explicitFileNames = null) {
  const referenced = await collectReferencedAttachmentFileNames(convId);
  const onDisk = await listConversationAttachmentFiles(convId);
  const toDelete = explicitFileNames
    ? [...new Set((Array.isArray(explicitFileNames) ? explicitFileNames : []).map(assertSafeAttachmentFileName))]
    : onDisk.filter((row) => !referenced.has(row.fileName)).map((row) => row.fileName);
  return deleteAttachmentFiles(convId, toDelete);
}

module.exports = {
  getConversationUploadDirs,
  collectReferencedAttachmentFileNames,
  listConversationAttachmentFiles,
  deleteConversationAttachments,
  deleteAttachmentFiles,
  deleteUnreferencedAttachments,
  basenameFromFileUrl,
  isAttachmentMessage,
  loadAllMessagesRaw
};