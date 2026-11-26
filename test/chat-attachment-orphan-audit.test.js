const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function stubModule(modulePath, exportsValue, originals) {
  const resolved = require.resolve(modulePath);
  if (!originals.has(resolved)) originals.set(resolved, require.cache[resolved]);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue
  };
}

function restoreModules(originals) {
  originals.forEach((entry, resolved) => {
    if (entry) require.cache[resolved] = entry;
    else delete require.cache[resolved];
  });
}

test('conversation attachment service extracts referenced basenames from messages', async () => {
  const originals = new Map();
  const repoPath = path.join(ROOT_DIR, 'MVC/repositories/chatRepository.js');
  stubModule(repoPath, {
    getMessages: async () => ({
      messages: [
        { id: 'M1', type: 'image', fileUrl: '/uploads/GLOBAL/chat/CONV-9/a.png' },
        { id: 'M2', type: 'file', fileUrl: '/chat/attachments/CONV-9/report%20v2.pdf' },
        { id: 'M3', type: 'text', fileUrl: null }
      ],
      hasMore: false
    })
  }, originals);

  delete require.cache[path.join(ROOT_DIR, 'MVC/services/chatConversationAttachmentService.js')];
  const service = require(path.join(ROOT_DIR, 'MVC/services/chatConversationAttachmentService.js'));
  const names = await service.collectReferencedAttachmentFileNames('CONV-9');
  restoreModules(originals);
  delete require.cache[path.join(ROOT_DIR, 'MVC/services/chatConversationAttachmentService.js')];

  assert.deepEqual([...names].sort(), ['a.png', 'report v2.pdf']);
});

test('orphan audit classifies unknown conversation folders and unreferenced files', async () => {
  const originals = new Map();

  stubModule(path.join(ROOT_DIR, 'MVC/repositories/chatRepository.js'), {
    list: async () => [{ id: 'CONV-LIVE' }]
  }, originals);

  stubModule(path.join(ROOT_DIR, 'MVC/services/chatConversationAttachmentService.js'), {
    collectReferencedAttachmentFileNames: async (convId) => (
      convId === 'CONV-LIVE' ? new Set(['keep.jpg']) : new Set()
    ),
    listConversationAttachmentFiles: async (convId) => (
      convId === 'CONV-LIVE'
        ? [{ fileName: 'keep.jpg', relativePath: 'chat/CONV-LIVE/keep.jpg', size: 10 },
          { fileName: 'orphan.bin', relativePath: 'chat/CONV-LIVE/orphan.bin', size: 99 }]
        : []
    ),
    deleteConversationAttachments: async () => true,
    deleteAttachmentFiles: async () => ({ deleted: [], skipped: [] })
  }, originals);

  const listSpy = async ({ relativeDir }) => {
    if (relativeDir === 'chat') {
      return [
        { name: 'CONV-LIVE', isDir: true },
        { name: 'CONV-DEAD', isDir: true, size: 0 }
      ];
    }
    if (relativeDir === 'chat/CONV-DEAD') {
      return [{ name: 'leftover.png', isDir: false, size: 50 }];
    }
    return [];
  };

  stubModule(path.join(ROOT_DIR, 'MVC/services/uploadStorageService.js'), {
    listDirectory: listSpy,
    deleteRelativePath: async () => true
  }, originals);

  stubModule(path.join(ROOT_DIR, 'MVC/services/uploadStoragePolicyService.js'), {
    allowLocalUploadFallback: () => false
  }, originals);

  stubModule(path.join(ROOT_DIR, 'MVC/services/uploadFolderSettingsService.js'), {
    getUploadFolderTemplate: () => 'chat/{conversationId}',
    getDefinition: () => ({ defaultTemplate: 'chat/{conversationId}' })
  }, originals);

  const auditServicePath = path.join(ROOT_DIR, 'MVC/services/chatAttachmentOrphanAuditService.js');
  delete require.cache[auditServicePath];
  const auditService = require(auditServicePath);

  const report = await auditService.auditOrphanAttachments();
  restoreModules(originals);
  delete require.cache[auditServicePath];

  assert.equal(report.orphanConversationFolders.length, 1);
  assert.equal(report.orphanConversationFolders[0].conversationId, 'CONV-DEAD');
  assert.equal(report.orphanFiles.length, 1);
  assert.equal(report.orphanFiles[0].fileName, 'orphan.bin');
});