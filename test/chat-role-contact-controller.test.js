const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CONTROLLER_PATH = path.join(ROOT_DIR, 'MVC/controllers/chatController.js');
const ACCESS_SERVICE_PATH = path.join(ROOT_DIR, 'MVC/services/chatAccessService.js');

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
  delete require.cache[CONTROLLER_PATH];
  delete require.cache[ACCESS_SERVICE_PATH];
  originals.forEach((entry, resolved) => {
    if (entry) require.cache[resolved] = entry;
    else delete require.cache[resolved];
  });
}

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

test('existing participant history stays readable while UPDATE is denied by contact scope', async () => {
  const originals = new Map();
  let contactAllowed = false;
  try {
    stubModule('../MVC/services/security/index', {
      evaluateAccess: async ({ operationId }) => ({
        allowed: true,
        operationId
      })
    }, originals);
    stubModule('../MVC/services/adminAuthorityService', {
      isAdminForRequestAsync: async () => false
    }, originals);
    stubModule('../MVC/services/chatContactScopeService', {
      getConversationMessagingEligibility: async () => ({
        canMessage: contactAllowed,
        reason: contactAllowed ? '' : 'Role scope changed.'
      })
    }, originals);

    delete require.cache[ACCESS_SERVICE_PATH];
    const chatAccessService = require(ACCESS_SERVICE_PATH);
    const user = { id: 'USER-1' };
    const conversation = {
      id: 'CONV-1',
      participants: [{ userId: 'USER-1' }, { userId: 'USER-2' }]
    };

    const read = await chatAccessService.canAccessConversation({
      user,
      conversation,
      operationIds: ['READ']
    });
    const deniedUpdate = await chatAccessService.canAccessConversation({
      user,
      conversation,
      operationIds: ['UPDATE']
    });
    contactAllowed = true;
    const allowedUpdate = await chatAccessService.canAccessConversation({
      user,
      conversation,
      operationIds: ['UPDATE']
    });

    assert.equal(read.allowed, true);
    assert.equal(deniedUpdate.allowed, false);
    assert.match(deniedUpdate.reason, /role scope/i);
    assert.equal(allowedUpdate.allowed, true);
  } finally {
    restoreModules(originals);
  }
});

test('direct-id chat creation cannot bypass the dedicated contact scope', async () => {
  const originals = new Map();
  let repositoryCreateCalled = false;
  let genericUserFetchCalled = false;
  try {
    stubModule('../MVC/repositories/chatRepository', {
      create: async () => {
        repositoryCreateCalled = true;
        return { id: 'CONV-1' };
      }
    }, originals);
    stubModule('../MVC/services/dataService', {
      fetchData: async (entityType) => {
        if (entityType === 'users') genericUserFetchCalled = true;
        return [];
      }
    }, originals);
    stubModule('../MVC/services/chatAccessService', {}, originals);
    stubModule('../MVC/services/chatContactScopeService', {
      assertCanContact: async () => {
        const error = new Error('Selected user is outside your role-scoped contacts.');
        error.statusCode = 403;
        throw error;
      }
    }, originals);
    stubModule('../MVC/services/chatBroadcastService', {}, originals);
    stubModule('../MVC/services/socketService', {}, originals);
    stubModule('../MVC/services/coreFilesService', {}, originals);
    stubModule('../MVC/middleware/upload', {}, originals);
    stubModule('../MVC/services/fileAssetStorageService', {}, originals);
    stubModule('../MVC/services/uploadFolderSettingsService', {}, originals);

    delete require.cache[CONTROLLER_PATH];
    const controller = require(CONTROLLER_PATH);
    const req = {
      user: { id: 'USER-1', personId: 'PERSON-1', activeOrgId: 'ORG-1' },
      body: { targetUserId: 'USER-2' }
    };
    const res = createResponse();

    await controller.startChat(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.status, 'error');
    assert.match(res.payload.message, /outside/i);
    assert.equal(repositoryCreateCalled, false);
    assert.equal(genericUserFetchCalled, false);
  } finally {
    restoreModules(originals);
  }
});

test('contact search delegates to the role-scoped service and preserves its envelope', async () => {
  const originals = new Map();
  let genericUserFetchCalled = false;
  try {
    stubModule('../MVC/repositories/chatRepository', {}, originals);
    stubModule('../MVC/services/dataService', {
      fetchData: async (entityType) => {
        if (entityType === 'users') genericUserFetchCalled = true;
        return [];
      }
    }, originals);
    stubModule('../MVC/services/chatAccessService', {}, originals);
    stubModule('../MVC/services/chatContactScopeService', {
      searchContacts: async () => [{
        id: 'USER-2',
        name: 'Teacher Two',
        org: 'Organization One',
        roleLabels: ['School Teacher'],
        packages: ['SCHOOL']
      }]
    }, originals);
    stubModule('../MVC/services/chatBroadcastService', {}, originals);
    stubModule('../MVC/services/socketService', {}, originals);
    stubModule('../MVC/services/coreFilesService', {}, originals);
    stubModule('../MVC/middleware/upload', {}, originals);
    stubModule('../MVC/services/fileAssetStorageService', {}, originals);
    stubModule('../MVC/services/uploadFolderSettingsService', {}, originals);

    delete require.cache[CONTROLLER_PATH];
    const controller = require(CONTROLLER_PATH);
    const req = {
      user: { id: 'USER-1', personId: 'PERSON-1', activeOrgId: 'ORG-1' },
      query: { q: 'teacher' }
    };
    const res = createResponse();

    await controller.searchUsers(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.data, res.payload.results);
    assert.deepEqual(res.payload.data[0].roleLabels, ['School Teacher']);
    assert.equal(genericUserFetchCalled, false);
  } finally {
    restoreModules(originals);
  }
});

test('Chat source keeps historical reads while applying role scope to writes and UI state', () => {
  const accessSource = fs.readFileSync(
    path.join(ROOT_DIR, 'MVC/services/chatAccessService.js'),
    'utf8'
  );
  const socketSource = fs.readFileSync(
    path.join(ROOT_DIR, 'MVC/services/socketService.js'),
    'utf8'
  );
  const modalSource = fs.readFileSync(
    path.join(ROOT_DIR, 'MVC/views/partials/chatModal.ejs'),
    'utf8'
  );

  assert.equal(accessSource.includes('getConversationMessagingEligibility'), true);
  assert.equal(accessSource.includes('operationResult.operationId === OPERATIONS.UPDATE'), true);
  assert.equal(socketSource.includes('[OPERATIONS.UPDATE]'), true);
  assert.equal(modalSource.includes('chatReadOnlyNotice'), true);
  assert.equal(modalSource.includes('res.access'), true);
  assert.equal(modalSource.includes('res.pagination'), true);
  assert.equal(modalSource.includes('currentConversationCanMessage'), true);
  assert.equal(modalSource.includes('ensureChatSocket'), true);
  assert.equal(modalSource.includes('loadOlderMessages'), true);
  assert.equal(modalSource.includes('<script src="/socket.io/socket.io.js"></script>'), false);
});

test('broadcast contact search delegates to the admin broadcast service', async () => {
  const originals = new Map();
  try {
    stubModule('../MVC/repositories/chatRepository', {}, originals);
    stubModule('../MVC/services/dataService', {}, originals);
    stubModule('../MVC/services/chatAccessService', {}, originals);
    stubModule('../MVC/services/chatContactScopeService', {}, originals);
    stubModule('../MVC/services/chatBroadcastService', {
      searchBroadcastRecipients: async () => [{
        id: 'USER-8',
        name: 'Admin Target',
        email: 'target@example.com',
        org: 'General',
        roleLabels: [],
        packages: []
      }]
    }, originals);
    stubModule('../MVC/services/socketService', {}, originals);
    stubModule('../MVC/services/coreFilesService', {}, originals);
    stubModule('../MVC/middleware/upload', {}, originals);
    stubModule('../MVC/services/fileAssetStorageService', {}, originals);
    stubModule('../MVC/services/uploadFolderSettingsService', {}, originals);

    delete require.cache[CONTROLLER_PATH];
    const controller = require(CONTROLLER_PATH);
    const req = {
      user: { id: 'ADMIN-1' },
      ip: '127.0.0.1',
      query: { q: 'admin target', limit: '10' }
    };
    const res = createResponse();

    await controller.searchBroadcastUsers(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.status, 'success');
    assert.equal(Array.isArray(res.payload.data), true);
    assert.equal(res.payload.data[0].id, 'USER-8');
  } finally {
    restoreModules(originals);
  }
});

test('broadcast send returns a summary and emits realtime updates', async () => {
  const originals = new Map();
  const emitted = [];
  try {
    stubModule('../MVC/repositories/chatRepository', {}, originals);
    stubModule('../MVC/services/dataService', {}, originals);
    stubModule('../MVC/services/chatAccessService', {}, originals);
    stubModule('../MVC/services/chatContactScopeService', {}, originals);
    stubModule('../MVC/services/chatBroadcastService', {
      broadcastDirectMessage: async () => ({
        attemptedCount: 2,
        sentCount: 2,
        skippedCount: 0,
        failedCount: 0,
        deliveries: [
          {
            recipientId: 'USER-2',
            conversationId: 'CONV-2',
            messages: [{ id: 'MSG-2', senderId: 'ADMIN-1', content: 'Hello', type: 'text' }]
          },
          {
            recipientId: 'USER-3',
            conversationId: 'CONV-3',
            messages: [{ id: 'MSG-3', senderId: 'ADMIN-1', content: 'Hello', type: 'text' }]
          }
        ],
        skipped: [],
        failed: []
      })
    }, originals);
    stubModule('../MVC/services/socketService', {
      emitNewMessageToRecipients: async (payload) => {
        emitted.push(payload);
      }
    }, originals);
    stubModule('../MVC/services/coreFilesService', {}, originals);
    stubModule('../MVC/middleware/upload', {
      getStoredFileUrl: () => '/uploads/chat/BROADCAST_TEST/file.txt',
      getStoredFilePath: () => '/uploads/chat/BROADCAST_TEST/file.txt',
      deleteUploadedFiles: async () => {}
    }, originals);
    stubModule('../MVC/services/fileAssetStorageService', {}, originals);
    stubModule('../MVC/services/uploadFolderSettingsService', {}, originals);

    delete require.cache[CONTROLLER_PATH];
    const controller = require(CONTROLLER_PATH);
    const req = {
      user: { id: 'ADMIN-1' },
      ip: '127.0.0.1',
      body: {
        recipientIds: JSON.stringify(['USER-2', 'USER-3']),
        content: 'Hello'
      },
      files: []
    };
    const res = createResponse();

    await controller.broadcastMessage(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.status, 'success');
    assert.equal(res.payload.data.sentCount, 2);
    assert.equal(emitted.length, 2);
    assert.deepEqual(emitted.map((row) => row.recipientIds[0]), ['USER-2', 'USER-3']);
  } finally {
    restoreModules(originals);
  }
});
