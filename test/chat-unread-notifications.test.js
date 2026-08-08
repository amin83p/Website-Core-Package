const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const {
  normalizeMessage,
  normalizeConversation,
  applyMessageToConversation,
  markConversationRead,
  buildUnreadSummary
} = require('../MVC/services/chatUnreadStateService');

const ROOT_DIR = path.resolve(__dirname, '..');
const SOCKET_SERVICE_PATH = path.join(ROOT_DIR, 'MVC/services/socketService.js');
const CHAT_REPOSITORY_PATH = path.join(ROOT_DIR, 'MVC/repositories/chatRepository.js');

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
  delete require.cache[SOCKET_SERVICE_PATH];
  delete require.cache[CHAT_REPOSITORY_PATH];
  originals.forEach((entry, resolved) => {
    if (entry) require.cache[resolved] = entry;
    else delete require.cache[resolved];
  });
}

function createFakeSocket(userId, id = `SOCKET-${userId}`) {
  const handlers = new Map();
  const emitted = [];
  const joinedRooms = [];
  const broadcasts = [];

  return {
    id,
    userId,
    user: { id: userId },
    handshake: { address: '127.0.0.1', headers: {} },
    handlers,
    emitted,
    joinedRooms,
    broadcasts,
    on(event, handler) {
      handlers.set(event, handler);
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
    join(room) {
      joinedRooms.push(room);
    },
    to(room) {
      return {
        emit: (event, payload) => broadcasts.push({ room, event, payload })
      };
    }
  };
}

test('unread state accumulates for recipients, remains zero for the sender, and clears per conversation', () => {
  const initial = {
    id: 'CONV-1',
    participants: [
      { userId: 'USER-1' },
      { userId: 'USER-2' }
    ]
  };
  const first = applyMessageToConversation(initial, 'USER-1', {
    id: 'MSG-1',
    senderId: 'USER-1',
    content: 'First',
    type: 'text',
    timestamp: '2026-07-29T10:00:00.000Z',
    status: 'sent'
  });
  const second = applyMessageToConversation(first, 'USER-1', {
    id: 'MSG-2',
    senderId: 'USER-1',
    content: 'Second',
    type: 'text',
    timestamp: '2026-07-29T10:00:01.000Z',
    status: 'sent'
  });

  assert.equal(second.participants[0].unreadCount, 0);
  assert.equal(second.participants[1].unreadCount, 2);
  assert.equal(second.totalMessages, 2);
  assert.equal(second.lastMessage.content, 'Second');
  assert.equal(second.lastMessage.timestamp, '2026-07-29T10:00:01.000Z');

  const otherConversation = applyMessageToConversation({
    id: 'CONV-2',
    participants: [{ userId: 'USER-2' }, { userId: 'USER-3' }]
  }, 'USER-3', {
    id: 'MSG-3',
    senderId: 'USER-3',
    content: 'Other',
    timestamp: '2026-07-29T10:00:02.000Z'
  });
  const readFirst = markConversationRead(second, 'USER-2', '2026-07-29T10:01:00.000Z');
  const summary = buildUnreadSummary([readFirst, otherConversation], 'USER-2');

  assert.equal(readFirst.participants[1].unreadCount, 0);
  assert.deepEqual(summary, {
    totalUnread: 1,
    byConversation: {
      'CONV-1': 0,
      'CONV-2': 1
    }
  });
});

test('legacy messages accept sentAt and missing counters normalize to zero', () => {
  const message = normalizeMessage({
    id: 'LEGACY-MSG',
    sentAt: '2026-07-28T12:00:00.000Z'
  });
  const conversation = normalizeConversation({
    id: 'LEGACY-CONV',
    participants: [{ userId: 42 }],
    lastMessage: { content: 'Legacy', sentAt: '2026-07-28T12:00:00.000Z' }
  });

  assert.equal(message.timestamp, '2026-07-28T12:00:00.000Z');
  assert.equal(conversation.participants[0].userId, '42');
  assert.equal(conversation.participants[0].unreadCount, 0);
  assert.equal(conversation.lastMessage.timestamp, '2026-07-28T12:00:00.000Z');
});

test('Mongo chat writes use canonical timestamps and atomic unread update pipelines', async () => {
  const originals = new Map();
  const updates = [];
  const fakeCollection = {
    async updateOne(filter, update, options) {
      updates.push({ filter, update, options });
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };

  try {
    stubModule('../MVC/infrastructure/mongo/mongoConnection', {
      getMongoCollection: () => fakeCollection
    }, originals);
    delete require.cache[CHAT_REPOSITORY_PATH];
    const repository = require(CHAT_REPOSITORY_PATH);

    const message = await repository.addMessage(
      'CONV-1',
      'USER-1',
      'Atomic',
      'text',
      null,
      { backendMode: 'mongo' }
    );
    await repository.setLastRead('CONV-1', 'USER-2', { backendMode: 'mongo' });

    assert.ok(message.timestamp);
    assert.equal(Object.hasOwn(message, 'sentAt'), false);
    assert.equal(Array.isArray(updates[0].update), true);
    assert.match(JSON.stringify(updates[0].update), /\$concatArrays/);
    assert.match(JSON.stringify(updates[0].update), /unreadCount/);
    assert.match(JSON.stringify(updates[0].update), /lastMessage/);
    assert.match(JSON.stringify(updates[0].update), /totalMessages/);
    assert.equal(Array.isArray(updates[1].update), true);
    assert.match(JSON.stringify(updates[1].update), /unreadCount/);
  } finally {
    restoreModules(originals);
  }
});

test('socket delivery uses recipient user rooms without requiring a conversation-room join', async () => {
  const originals = new Map();
  const ioEvents = [];
  const ioHandlers = new Map();
  const conversation = {
    id: 'CONV-1',
    participants: [{ userId: 'USER-1' }, { userId: 'USER-2' }]
  };
  let recipientUnread = 2;

  try {
    const fakeIo = {
      use() {},
      on(event, handler) {
        ioHandlers.set(event, handler);
      },
      to(room) {
        return {
          emit(event, payload) {
            ioEvents.push({ room, event, payload });
          }
        };
      }
    };

    stubModule('socket.io', () => fakeIo, originals);
    stubModule('../MVC/repositories/chatRepository', {
      getById: async () => conversation,
      addMessage: async () => ({
        id: 'MSG-1',
        senderId: 'USER-1',
        content: 'Hello',
        type: 'text',
        timestamp: '2026-07-29T10:00:00.000Z',
        status: 'sent'
      }),
      getUnreadSummaryForUser: async (userId) => ({
        totalUnread: userId === 'USER-2' ? recipientUnread : 0,
        byConversation: { 'CONV-1': userId === 'USER-2' ? recipientUnread : 0 }
      }),
      setLastRead: async () => {
        recipientUnread = 0;
        return true;
      },
      updateMessageStatus: async () => ({ id: 'MSG-1', status: 'read' })
    }, originals);
    stubModule('../MVC/services/authService', {}, originals);
    stubModule('../MVC/services/chatAccessService', {
      canAccessConversation: async () => ({ allowed: true }),
      conversationHasParticipant: (row, userId) => (
        row.participants.some((participant) => String(participant.userId) === String(userId))
      )
    }, originals);

    delete require.cache[SOCKET_SERVICE_PATH];
    const socketService = require(SOCKET_SERVICE_PATH);
    socketService.init({});

    const senderSocket = createFakeSocket('USER-1');
    ioHandlers.get('connection')(senderSocket);
    assert.deepEqual(senderSocket.joinedRooms, ['chat:user:USER-1']);

    await senderSocket.handlers.get('send_message')({
      convId: 'CONV-1',
      content: 'Hello',
      type: 'text',
      tempId: 'TEMP-1'
    });

    const recipientEvent = ioEvents.find((event) => (
      event.room === 'chat:user:USER-2' && event.event === 'new_message'
    ));
    assert.ok(recipientEvent);
    assert.equal(recipientEvent.payload.unreadCount, 2);
    assert.equal(recipientEvent.payload.totalUnread, 2);
    assert.equal(senderSocket.joinedRooms.includes('CONV-1'), false);

    const recipientSocket = createFakeSocket('USER-2');
    ioHandlers.get('connection')(recipientSocket);
    await recipientSocket.handlers.get('mark_conversation_read')({
      convId: 'CONV-1',
      messageId: 'MSG-1'
    });

    const readStateEvent = ioEvents.find((event) => (
      event.room === 'chat:user:USER-2'
      && event.event === 'unread_state'
      && event.payload.unreadCount === 0
    ));
    assert.ok(readStateEvent);
    assert.equal(readStateEvent.payload.totalUnread, 0);
  } finally {
    restoreModules(originals);
  }
});

test('rendered chat client script is valid and includes badge, sound, and read-state contracts', async () => {
  const templatePath = path.join(ROOT_DIR, 'MVC/views/partials/chatModal.ejs');
  const template = fs.readFileSync(templatePath, 'utf8');
  const rendered = await ejs.render(template, {
    user: { id: 'USER-1' },
    chatAccess: {
      canRead: true,
      canReadAll: false,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canDeleteAll: false
    }
  }, { filename: templatePath, async: true });
  const scripts = [...rendered.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((source) => source.trim());
  const clientSource = scripts.at(-1);

  assert.ok(clientSource);
  assert.doesNotThrow(() => new Function(clientSource));
  assert.match(clientSource, /mark_conversation_read/);
  assert.match(clientSource, /unread_state/);
  assert.match(clientSource, /chat\.soundMuted\./);
  assert.match(clientSource, /function isTabVisible\(\)/);
  assert.match(clientSource, /document\.visibilityState === 'visible'/);
  assert.match(clientSource, /chatInitialUnreadSoundPlayed/);
  assert.match(clientSource, /if \(!chatInitialUnreadSoundPlayed && loadedTotalUnread > 0/);
  assert.doesNotMatch(clientSource, /updateUnreadCount\(0,\s*true\)/);
  assert.match(rendered, /id="chatSoundToggle"/);
  assert.match(rendered, /id="chatSendButton"[^>]*data-no-wait="true"/);
  assert.match(clientSource, /getElementById\('chatGlobalBadge'\)/);
  assert.match(clientSource, /ensureChatSocket/);
  assert.match(clientSource, /loadOlderMessages/);
  assert.match(clientSource, /CHAT_MESSAGE_PAGE_SIZE/);
  assert.doesNotMatch(rendered, /src="\/socket\.io\/socket\.io\.js"/);
});

test('mongo chat create reuses an existing direct conversation between the same users', async () => {
  const originals = new Map();
  const inserted = [];
  const existingConversation = {
    _id: 'mongo-conv-1',
    id: 'CONV-EXISTING',
    type: 'direct',
    participants: [
      { userId: 'USER-1', unreadCount: 2 },
      { userId: 'USER-2', unreadCount: 0 }
    ],
    totalMessages: 4,
    updatedAt: '2026-07-29T10:00:00.000Z'
  };
  const fakeCollection = {
    find() {
      return {
        toArray: async () => [existingConversation]
      };
    },
    async insertOne(doc) {
      inserted.push(doc);
      return { insertedId: 'mongo-conv-new' };
    }
  };

  try {
    stubModule('../MVC/infrastructure/mongo/mongoConnection', {
      getMongoCollection: () => fakeCollection
    }, originals);
    delete require.cache[CHAT_REPOSITORY_PATH];
    const repository = require(CHAT_REPOSITORY_PATH);

    const created = await repository.create(
      { userIds: ['USER-2', 'USER-1'] },
      { backendMode: 'mongo' }
    );

    assert.equal(created.id, 'CONV-EXISTING');
    assert.equal(inserted.length, 0);
  } finally {
    restoreModules(originals);
  }
});
