const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const ROOT_DIR = path.resolve(__dirname, '..');
const SERVICE_PATH = path.join(ROOT_DIR, 'MVC/services/chatBroadcastService.js');

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
  delete require.cache[SERVICE_PATH];
  originals.forEach((entry, resolved) => {
    if (entry) require.cache[resolved] = entry;
    else delete require.cache[resolved];
  });
}

test('broadcast service enforces global chat admin access', async () => {
  const originals = new Map();
  try {
    stubModule('../MVC/repositories/chatRepository', {}, originals);
    stubModule('../MVC/services/dataService', {
      getAccessibleUsers: async () => []
    }, originals);
    stubModule('../MVC/services/chatAccessService', {
      isGlobalChatAdmin: async () => false
    }, originals);

    delete require.cache[SERVICE_PATH];
    const service = require(SERVICE_PATH);
    await assert.rejects(
      () => service.searchBroadcastRecipients({
        requestingUser: { id: 'USER-1' },
        ipAddress: '127.0.0.1',
        query: ''
      }),
      (error) => error && error.statusCode === 403
    );
  } finally {
    restoreModules(originals);
  }
});

test('broadcast service fans out direct messages, dedupes recipients, and never creates group conversations', async () => {
  const originals = new Map();
  const createCalls = [];
  const addMessageCalls = [];
  try {
    stubModule('../MVC/services/chatAccessService', {
      isGlobalChatAdmin: async () => true
    }, originals);
    stubModule('../MVC/services/dataService', {
      getAccessibleUsers: async () => [
        { id: 'ADMIN-1', name: 'Admin Sender', active: true, status: 'active' },
        { id: 'USER-2', name: 'Recipient Two', email: 'u2@example.com', active: true, status: 'active' },
        { id: 'USER-3', name: 'Recipient Three', email: 'u3@example.com', active: true, status: 'active' }
      ]
    }, originals);
    stubModule('../MVC/repositories/chatRepository', {
      create: async ({ userIds }) => {
        createCalls.push(userIds);
        return { id: `CONV-${userIds[1]}` };
      },
      addMessage: async (convId, senderId, content, type, fileUrl) => {
        addMessageCalls.push({ convId, senderId, content, type, fileUrl });
        return {
          id: `MSG-${addMessageCalls.length}`,
          convId,
          senderId,
          content,
          type,
          fileUrl: fileUrl || null
        };
      }
    }, originals);

    delete require.cache[SERVICE_PATH];
    const service = require(SERVICE_PATH);
    const result = await service.broadcastDirectMessage({
      senderUser: { id: 'ADMIN-1' },
      ipAddress: '127.0.0.1',
      recipientIds: ['USER-2', 'USER-2', 'USER-3', 'ADMIN-1', 'USER-MISSING'],
      content: 'Admin broadcast',
      attachments: [
        { type: 'file', fileUrl: '/uploads/chat/BROADCAST/file.txt', content: 'file.txt' }
      ]
    });

    assert.equal(result.attemptedCount, 3);
    assert.equal(result.sentCount, 2);
    assert.equal(result.skippedCount, 1);
    assert.equal(result.failedCount, 0);
    assert.deepEqual(result.deliveries.map((row) => row.recipientId).sort(), ['USER-2', 'USER-3']);
    assert.deepEqual(createCalls, [
      ['ADMIN-1', 'USER-2'],
      ['ADMIN-1', 'USER-3']
    ]);
    assert.equal(createCalls.every((userIds) => userIds.length === 2), true);
    assert.equal(addMessageCalls.length, 4);
    assert.equal(result.deliveries.every((row) => row.messageCount === 2), true);
  } finally {
    restoreModules(originals);
  }
});

test('broadcast recipient search is query-filtered, sorted, and excludes sender/inactive users', async () => {
  const originals = new Map();
  try {
    stubModule('../MVC/repositories/chatRepository', {}, originals);
    stubModule('../MVC/services/chatAccessService', {
      isGlobalChatAdmin: async () => true
    }, originals);
    stubModule('../MVC/services/dataService', {
      getAccessibleUsers: async () => [
        { id: 'USER-3', name: 'zeta person', email: 'zeta@example.com', active: true, status: 'active' },
        { id: 'USER-2', name: 'Alpha Person', email: 'alpha@example.com', active: true, status: 'active' },
        { id: 'USER-1', name: 'Sender', email: 'sender@example.com', active: true, status: 'active' },
        { id: 'USER-4', name: 'Disabled Person', email: 'disabled@example.com', active: false, status: 'inactive' }
      ]
    }, originals);

    delete require.cache[SERVICE_PATH];
    const service = require(SERVICE_PATH);
    const rows = await service.searchBroadcastRecipients({
      requestingUser: { id: 'USER-1' },
      ipAddress: '127.0.0.1',
      query: 'person'
    });

    assert.deepEqual(rows.map((row) => row.id), ['USER-2', 'USER-3']);
  } finally {
    restoreModules(originals);
  }
});

test('chat modal shows broadcast trigger only for chat admins', async () => {
  const templatePath = path.join(ROOT_DIR, 'MVC/views/partials/chatModal.ejs');
  const template = fs.readFileSync(templatePath, 'utf8');

  const adminRendered = await ejs.render(template, {
    user: { id: 'ADMIN-1' },
    chatAccess: {
      canRead: true,
      canReadAll: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canDeleteAll: true
    }
  }, { filename: templatePath, async: true });
  const regularRendered = await ejs.render(template, {
    user: { id: 'USER-1' },
    chatAccess: {
      canRead: true,
      canReadAll: false,
      canCreate: true,
      canUpdate: true,
      canDelete: false,
      canDeleteAll: false
    }
  }, { filename: templatePath, async: true });

  assert.match(adminRendered, /title="Broadcast"/);
  assert.match(adminRendered, /id="chatBroadcastModal"/);
  assert.match(adminRendered, /id="chatModalDragHandle"/);
  assert.match(regularRendered, /id="chatModalDragHandle"/);
  assert.doesNotMatch(regularRendered, /title="Broadcast"/);
});
