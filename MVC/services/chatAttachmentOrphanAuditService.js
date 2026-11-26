const fs = require('fs');
const chatRepository = require('../repositories/chatRepository');
const uploadFolderSettingsService = require('./uploadFolderSettingsService');
const uploadStorage = require('./uploadStorageService');
const uploadStoragePolicy = require('./uploadStoragePolicyService');
const coreFilesService = require('./coreFilesService');
const chatConversationAttachmentService = require('./chatConversationAttachmentService');

function clean(value) {
  return String(value || '').trim();
}

function unique(values = []) {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))];
}

function conversationParentDirsFromTemplates() {
  const templates = unique([
    uploadFolderSettingsService.getUploadFolderTemplate('core.chat'),
    uploadFolderSettingsService.getDefinition
      ? uploadFolderSettingsService.getDefinition('core.chat')?.defaultTemplate
      : '',
    'chat/{conversationId}'
  ]);
  return unique(templates.map((template) => {
    const token = clean(template).replace(/\\/g, '/').replace(/\/+$/, '');
    const parent = token.split('{conversationId}')[0] || '';
    return parent.replace(/\/+$/, '');
  }).filter(Boolean));
}

async function listChildConversationFolders() {
  const parents = conversationParentDirsFromTemplates();
  const folders = new Map();

  for (const parent of parents) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const entries = await uploadStorage.listDirectory({ scopeKey: 'GLOBAL', relativeDir: parent });
      (Array.isArray(entries) ? entries : []).forEach((entry) => {
        const name = clean(entry?.name);
        if (!name || !entry?.isDir) return;
        const relativePath = `${parent}/${name}`.replace(/\\/g, '/');
        folders.set(name, {
          conversationId: name,
          relativePath,
          kind: 'folder',
          parentDir: parent
        });
      });
    } catch (_) {
      /* missing parent */
    }
  }

  if (uploadStoragePolicy.allowLocalUploadFallback()) {
    try {
      const root = coreFilesService.getRootPath('GLOBAL');
      const legacyChatRoot = coreFilesService.resolveSafePath(root, 'chat');
      if (fs.existsSync(legacyChatRoot)) {
        const entries = fs.readdirSync(legacyChatRoot, { withFileTypes: true });
        entries.forEach((entry) => {
          if (!entry.isDirectory()) return;
          const name = clean(entry.name);
          if (!name) return;
          folders.set(name, {
            conversationId: name,
            relativePath: `chat/${name}`,
            kind: 'folder',
            parentDir: 'chat',
            legacy: true
          });
        });
      }
    } catch (_) {
      /* ignore */
    }
  }

  return [...folders.values()];
}

async function sumDirectoryBytes(scopeKey, relativeDir) {
  let total = 0;
  try {
    const entries = await uploadStorage.listDirectory({ scopeKey, relativeDir });
    for (const entry of (Array.isArray(entries) ? entries : [])) {
      const name = clean(entry?.name);
      if (!name) continue;
      const child = [relativeDir, name].filter(Boolean).join('/').replace(/\\/g, '/');
      if (entry.isDir) {
        // eslint-disable-next-line no-await-in-loop
        total += await sumDirectoryBytes(scopeKey, child);
      } else {
        total += Number(entry?.size || 0);
      }
    }
  } catch (_) {
    /* empty */
  }
  return total;
}

async function auditOrphanAttachments() {
  const conversations = await chatRepository.list({
    query: {},
    scope: { canViewAll: true }
  });
  const knownIds = new Set((Array.isArray(conversations) ? conversations : []).map((row) => clean(row?.id)).filter(Boolean));

  const diskFolders = await listChildConversationFolders();
  const orphanConversationFolders = [];

  for (const folder of diskFolders) {
    const convId = folder.conversationId;
    if (knownIds.has(convId)) continue;
    // eslint-disable-next-line no-await-in-loop
    const bytes = await sumDirectoryBytes('GLOBAL', folder.relativePath);
    orphanConversationFolders.push({
      kind: 'folder',
      conversationId: convId,
      path: folder.relativePath,
      sizeBytes: bytes,
      reason: 'No matching conversation record'
    });
  }

  const orphanFiles = [];
  for (const convId of knownIds) {
    // eslint-disable-next-line no-await-in-loop
    const referenced = await chatConversationAttachmentService.collectReferencedAttachmentFileNames(convId);
    // eslint-disable-next-line no-await-in-loop
    const onDisk = await chatConversationAttachmentService.listConversationAttachmentFiles(convId);
    onDisk.forEach((file) => {
      if (referenced.has(file.fileName)) return;
      orphanFiles.push({
        kind: 'file',
        conversationId: convId,
        fileName: file.fileName,
        path: file.relativePath,
        sizeBytes: Number(file.size || 0),
        reason: 'Not referenced by any message fileUrl'
      });
    });
  }

  const totalFolderBytes = orphanConversationFolders.reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0);
  const totalFileBytes = orphanFiles.reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0);

  return {
    generatedAt: new Date().toISOString(),
    orphanConversationFolders,
    orphanFiles,
    totals: {
      orphanFolderCount: orphanConversationFolders.length,
      orphanFileCount: orphanFiles.length,
      orphanFolderBytes: totalFolderBytes,
      orphanFileBytes: totalFileBytes,
      orphanTotalBytes: totalFolderBytes + totalFileBytes
    }
  };
}

async function cleanupOrphanAttachments(report, options = {}) {
  if (options?.confirm !== true) {
    const error = new Error('Cleanup requires confirm: true.');
    error.statusCode = 400;
    throw error;
  }
  if (options?.dryRun === true) {
    return { dryRun: true, deletedFolders: [], deletedFiles: [], skipped: [] };
  }

  const folderIds = new Set((Array.isArray(options?.orphanFolderIds) ? options.orphanFolderIds : [])
    .map((id) => clean(id)).filter(Boolean));
  const fileRows = (Array.isArray(options?.orphanFiles) ? options.orphanFiles : [])
    .map((row) => ({
      conversationId: clean(row?.convId || row?.conversationId),
      fileName: clean(row?.fileName)
    }))
    .filter((row) => row.conversationId && row.fileName);

  const deletedFolders = [];
  const deletedFiles = [];
  const skipped = [];

  for (const folderId of folderIds) {
    // eslint-disable-next-line no-await-in-loop
    const removed = await chatConversationAttachmentService.deleteConversationAttachments(folderId);
    if (removed) deletedFolders.push(folderId);
    else skipped.push({ kind: 'folder', conversationId: folderId });
  }

  const byConv = new Map();
  fileRows.forEach((row) => {
    if (!byConv.has(row.conversationId)) byConv.set(row.conversationId, []);
    byConv.get(row.conversationId).push(row.fileName);
  });

  for (const [convId, names] of byConv.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const result = await chatConversationAttachmentService.deleteAttachmentFiles(convId, names);
    result.deleted.forEach((fileName) => deletedFiles.push({ conversationId: convId, fileName }));
    result.skipped.forEach((fileName) => skipped.push({ kind: 'file', conversationId: convId, fileName }));
  }

  return {
    dryRun: false,
    deletedFolders,
    deletedFiles,
    skipped,
    totals: {
      deletedFolderCount: deletedFolders.length,
      deletedFileCount: deletedFiles.length
    }
  };
}

module.exports = {
  auditOrphanAttachments,
  cleanupOrphanAttachments,
  listChildConversationFolders,
  conversationParentDirsFromTemplates
};