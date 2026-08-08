const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_CHAT_MESSAGE_PAGE_SIZE,
    MAX_CHAT_MESSAGE_PAGE_SIZE,
    paginateChatMessages
} = require('../MVC/services/chatMessagePaginationService');

function buildMessages(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: `MSG-${index + 1}`,
        senderId: 'USER-1',
        content: `Message ${index + 1}`,
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
    }));
}

test('paginateChatMessages returns the newest page by default', () => {
    const messages = buildMessages(120);
    const page = paginateChatMessages(messages, { limit: 50 });

    assert.equal(page.messages.length, 50);
    assert.equal(page.messages[0].id, 'MSG-71');
    assert.equal(page.messages.at(-1).id, 'MSG-120');
    assert.equal(page.hasMore, true);
    assert.equal(page.oldestId, 'MSG-71');
});

test('paginateChatMessages loads older messages before a cursor', () => {
    const messages = buildMessages(120);
    const firstPage = paginateChatMessages(messages, { limit: 50 });
    const olderPage = paginateChatMessages(messages, {
        limit: 50,
        before: firstPage.oldestId
    });

    assert.equal(olderPage.messages.length, 50);
    assert.equal(olderPage.messages[0].id, 'MSG-21');
    assert.equal(olderPage.messages.at(-1).id, 'MSG-70');
    assert.equal(olderPage.hasMore, true);
    assert.equal(olderPage.oldestId, 'MSG-21');
});

test('paginateChatMessages clamps invalid limits to defaults and max', () => {
    const shortThread = buildMessages(10);
    const defaultPage = paginateChatMessages(shortThread, { limit: 'invalid' });
    const cappedPage = paginateChatMessages(buildMessages(200), { limit: 999 });

    assert.equal(defaultPage.messages.length, 10);
    assert.equal(cappedPage.messages.length, MAX_CHAT_MESSAGE_PAGE_SIZE);
});

test('getHistory returns pagination metadata', async () => {
    const originals = new Map();
    const CONTROLLER_PATH = require('path').join(__dirname, '..', 'MVC/controllers/chatController.js');

    function stubModule(modulePath, exportsValue) {
        const resolved = require.resolve(modulePath);
        if (!originals.has(resolved)) originals.set(resolved, require.cache[resolved]);
        require.cache[resolved] = {
            id: resolved,
            filename: resolved,
            loaded: true,
            exports: exportsValue
        };
    }

    try {
        stubModule('../MVC/repositories/chatRepository', {
            getById: async () => ({
                id: 'CONV-1',
                participants: [{ userId: 'USER-1' }, { userId: 'USER-2' }]
            }),
            setLastRead: async () => true,
            getMessages: async (_convId, options) => paginateChatMessages(buildMessages(75), options)
        });
        stubModule('../MVC/services/chatAccessService', {
            canAccessConversation: async ({ operationIds }) => ({
                allowed: true,
                operationId: operationIds[0]
            }),
            conversationHasParticipant: () => true
        });

        delete require.cache[CONTROLLER_PATH];
        const controller = require(CONTROLLER_PATH);

        const req = {
            params: { convId: 'CONV-1' },
            query: { limit: '30' },
            user: { id: 'USER-1' },
            ip: '127.0.0.1'
        };
        const res = {
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

        await controller.getHistory(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.payload.status, 'success');
        assert.equal(res.payload.data.length, 30);
        assert.equal(res.payload.pagination.hasMore, true);
        assert.equal(res.payload.pagination.oldestId, 'MSG-46');
        assert.equal(res.payload.pagination.limit, 30);
    } finally {
        delete require.cache[CONTROLLER_PATH];
        originals.forEach((entry, resolved) => {
            if (entry) require.cache[resolved] = entry;
            else delete require.cache[resolved];
        });
    }
});
