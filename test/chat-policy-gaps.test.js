const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

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

function restoreModules(originals, extraPaths = []) {
  extraPaths.forEach((modulePath) => delete require.cache[modulePath]);
  originals.forEach((entry, resolved) => {
    if (entry) require.cache[resolved] = entry;
    else delete require.cache[resolved];
  });
}

test('conversation management view/delete buttons follow review and delete flags', async () => {
  const templatePath = path.join(ROOT_DIR, 'MVC/views/admin/chatList.ejs');
  const template = fs.readFileSync(templatePath, 'utf8');

  const listOnly = await ejs.render(template, {
    title: 'Conversation Management',
    newUrl: '',
    print: true,
    user: { id: 'AUDITOR-1' },
    data: [{ id: 'CONV-1', participants: 'A, B', startDate: '2026-01-01', updatedAt: '2026-01-02', lastMsg: 'Hi', sizeStr: '1 KB', msgCount: 1 }],
    chatAccess: {
      canReviewConversationHistory: false,
      canDeleteAll: false
    }
  }, { filename: templatePath, async: true });

  const historyAndDelete = await ejs.render(template, {
    title: 'Conversation Management',
    newUrl: '',
    print: true,
    user: { id: 'ADMIN-1' },
    data: [{ id: 'CONV-1', participants: 'A, B', startDate: '2026-01-01', updatedAt: '2026-01-02', lastMsg: 'Hi', sizeStr: '1 KB', msgCount: 1 }],
    chatAccess: {
      canReviewConversationHistory: true,
      canDeleteAll: true
    }
  }, { filename: templatePath, async: true });

  assert.doesNotMatch(listOnly, /onclick="adminViewChat\(/);
  assert.doesNotMatch(listOnly, /onclick="adminDeleteChat\(/);
  assert.match(listOnly, /No actions/);
  assert.match(historyAndDelete, /onclick="adminViewChat\(/);
  assert.match(historyAndDelete, /onclick="adminDeleteChat\(/);
  assert.match(historyAndDelete, /getAdminAttachmentUrl/);
});

test('deriveAccessFlags exposes CREATE-only, READ-only, and READ_ALL flows', () => {
  const policyPath = path.join(ROOT_DIR, 'MVC/services/chatOperationPolicyService.js');
  delete require.cache[policyPath];
  const policy = require(policyPath);

  const createOnly = policy.deriveAccessFlags({
    read: { allowed: false, scopeId: null },
    readAll: { allowed: false, scopeId: null },
    create: { allowed: true, scopeId: 'OWNER' },
    update: { allowed: true, scopeId: 'OWNER', limits: {} },
    del: { allowed: false, scopeId: null },
    deleteAll: { allowed: false, scopeId: null },
    broadcast: { allowed: false, scopeId: null },
    download: { allowed: false, scopeId: null }
  }, {});

  const readOnly = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'OWNER' },
    readAll: { allowed: false, scopeId: null },
    create: { allowed: true, scopeId: 'OWNER' },
    update: { allowed: false, scopeId: null },
    del: { allowed: false, scopeId: null },
    deleteAll: { allowed: false, scopeId: null },
    broadcast: { allowed: false, scopeId: null },
    download: { allowed: false, scopeId: null }
  }, {});

  const fullRead = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'OWNER' },
    readAll: { allowed: true, scopeId: 'OWNER' },
    create: { allowed: true, scopeId: 'OWNER' },
    update: { allowed: true, scopeId: 'OWNER', limits: {} },
    del: { allowed: true, scopeId: 'OWNER' },
    deleteAll: { allowed: false, scopeId: null },
    broadcast: { allowed: false, scopeId: null },
    download: { allowed: true, scopeId: 'OWNER' }
  }, {});

  assert.equal(createOnly.canCreate, true);
  assert.equal(createOnly.canReadInbox, false);
  assert.equal(createOnly.canReadMessageContent, false);

  assert.equal(readOnly.canReadInbox, true);
  assert.equal(readOnly.canReadMessageContent, false);

  assert.equal(fullRead.canReadInbox, true);
  assert.equal(fullRead.canReadMessageContent, true);
});

test('pending attachment registry validates server-issued socket references', () => {
  const servicePath = path.join(ROOT_DIR, 'MVC/services/chatPendingAttachmentService.js');
  delete require.cache[servicePath];
  const service = require(servicePath);
  service.resetPendingAttachmentsForTests();

  service.registerPendingAttachment({
    convId: 'CONV-1',
    senderId: 'USER-1',
    fileName: 'photo.png',
    fileUrl: '/chat/attachments/CONV-1/photo.png',
    sizeBytes: 2048,
    type: 'image'
  });

  const rejected = service.validateAttachmentReference({
    convId: 'CONV-1',
    senderId: 'USER-1',
    fileUrl: '/uploads/GLOBAL/chat/CONV-1/photo.png'
  });
  assert.equal(rejected.allowed, false);

  const allowed = service.consumePendingAttachment({
    convId: 'CONV-1',
    senderId: 'USER-1',
    fileUrl: '/chat/attachments/CONV-1/photo.png'
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.sizeBytes, 2048);

  const reused = service.validateAttachmentReference({
    convId: 'CONV-1',
    senderId: 'USER-1',
    fileUrl: '/chat/attachments/CONV-1/photo.png'
  });
  assert.equal(reused.allowed, false);
});

test('one-sided delete hides messages only for the deleting viewer', async () => {
  const modelPath = path.join(ROOT_DIR, 'MVC/models/chatModel.js');
  const visibilityPath = path.join(ROOT_DIR, 'MVC/services/chatMessageVisibilityService.js');
  delete require.cache[visibilityPath];
  delete require.cache[modelPath];
  const visibility = require(visibilityPath);
  const model = require(modelPath);

  assert.equal(visibility.isTwoSidedDeletionScope('owner'), false);
  assert.equal(visibility.isTwoSidedDeletionScope('organization'), true);

  const visible = visibility.applyVisibilityToMessage({
    id: 'MSG-1',
    content: 'hello',
    senderId: 'USER-2'
  }, 'USER-1');
  assert.equal(visible.content, 'hello');

  const hidden = visibility.applyVisibilityToMessage({
    id: 'MSG-1',
    content: 'hello',
    hiddenForUserIds: ['USER-1']
  }, 'USER-1');
  assert.equal(hidden.content, 'Message deleted');
  assert.equal(hidden.viewerDeleted, true);

  const stillVisible = visibility.applyVisibilityToMessage({
    id: 'MSG-1',
    content: 'hello',
    hiddenForUserIds: ['USER-1']
  }, 'USER-2');
  assert.equal(stillVisible.content, 'hello');
});

test('chat broadcast permission is separate from delete-all permission', async () => {
  const templatePath = path.join(ROOT_DIR, 'MVC/views/partials/chatModal.ejs');
  const template = fs.readFileSync(templatePath, 'utf8');

  const broadcaster = await ejs.render(template, {
    user: { id: 'ADMIN-1' },
    chatAccess: {
      canRead: true,
      canReadAll: true,
      canCreate: true,
      canUpdate: true,
      canDelete: false,
      canDeleteAll: false,
      canBroadcast: true
    }
  }, { filename: templatePath, async: true });

  const regular = await ejs.render(template, {
    user: { id: 'USER-1' },
    chatAccess: {
      canRead: true,
      canReadAll: true,
      canCreate: true,
      canUpdate: true,
      canDelete: false,
      canDeleteAll: false,
      canBroadcast: false
    }
  }, { filename: templatePath, async: true });

  assert.match(broadcaster, /title="Broadcast"/);
  assert.doesNotMatch(regular, /title="Broadcast"/);
});

test('review audit service writes immutable chat review log entries', async () => {
  const originals = new Map();
  const auditPath = path.join(ROOT_DIR, 'MVC/services/chatReviewAuditService.js');
  const created = [];
  try {
    stubModule('../MVC/repositories/logRepository', {
      create: async (payload) => {
        created.push(payload);
        return payload;
      }
    }, originals);

    delete require.cache[auditPath];
    const audit = require(auditPath);
    await audit.auditConversationHistoryReview(
      { id: 'AUDITOR-1', username: 'auditor', activeOrgId: 'ORG-1' },
      '127.0.0.1',
      'CONV-9',
      'SCP_ORG',
      { globalRead: true }
    );

    assert.equal(created.length, 1);
    assert.equal(created[0].sectionId, 'CHATS');
    assert.equal(created[0].operationId, 'READ_ALL');
    assert.equal(created[0].details.category, 'chat_review_audit');
    assert.equal(created[0].details.immutable, true);
    assert.equal(created[0].details.conversationId, 'CONV-9');
  } finally {
    restoreModules(originals, [auditPath]);
  }
});
