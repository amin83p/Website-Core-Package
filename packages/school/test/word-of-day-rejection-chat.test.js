'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  SYSTEM_CHAT_USER_ID,
  buildOpenWordHref,
  buildRejectionChatHtml,
  notifyAuthorWordRejected
} = require('../MVC/services/school/wordOfDayRejectionChatService');

test('buildOpenWordHref encodes entry id for list modal', () => {
  assert.equal(buildOpenWordHref('WOD-99'), '/school/word-of-day?openEntry=WOD-99');
  assert.equal(buildOpenWordHref(''), '/school/word-of-day');
});

test('buildRejectionChatHtml includes word, open link, and reviewer note', () => {
  const html = buildRejectionChatHtml({
    word: 'Ephemeral',
    entryId: 'WOD-1',
    note: 'Please add a clearer example.'
  });
  assert.match(html, /System Message/);
  assert.match(html, /Ephemeral/);
  assert.match(html, /not approved/i);
  assert.match(html, /openEntry=WOD-1/);
  assert.match(html, /Please add a clearer example/);
  assert.doesNotMatch(html, /rejectedBy/i);
});

test('buildRejectionChatHtml omits note block when empty', () => {
  const html = buildRejectionChatHtml({ word: 'Run', entryId: 'WOD-2', note: '' });
  assert.match(html, /Run/);
  assert.doesNotMatch(html, /border-left: 3px solid #dc3545/);
});

test('notifyAuthorWordRejected uses author+system conversation and system sender', async () => {
  const chatRepository = require('../../../MVC/repositories/chatRepository');
  const socketService = require('../../../MVC/services/socketService');

  let createdUsers = null;
  let addArgs = null;
  let emitted = false;
  const originalCreate = chatRepository.create;
  const originalAddMessage = chatRepository.addMessage;
  const originalGetIo = socketService.getIo;

  chatRepository.create = async ({ userIds }) => {
    createdUsers = userIds;
    return { id: 'CHAT-WOD' };
  };
  chatRepository.addMessage = async (convId, senderId, text, type) => {
    addArgs = { convId, senderId, type, text };
    return { id: 'MSG-WOD', senderId, type, content: text };
  };
  socketService.getIo = () => ({
    to: (room) => {
      assert.equal(room, 'CHAT-WOD');
      return { emit: (event) => { if (event === 'new_message') emitted = true; } };
    }
  });

  try {
    await notifyAuthorWordRejected(
      { id: 'WOD-10', word: 'Serendipity', authorUserId: 'USR-AUTHOR', workflow: {} },
      { note: 'Try again next week.' }
    );
    assert.deepEqual(createdUsers, ['USR-AUTHOR', SYSTEM_CHAT_USER_ID]);
    assert.equal(addArgs.convId, 'CHAT-WOD');
    assert.equal(addArgs.senderId, SYSTEM_CHAT_USER_ID);
    assert.equal(addArgs.type, 'system');
    assert.match(addArgs.text, /Open word/);
    assert.match(addArgs.text, /Try again next week/);
    assert.equal(emitted, true);
  } finally {
    chatRepository.create = originalCreate;
    chatRepository.addMessage = originalAddMessage;
    socketService.getIo = originalGetIo;
  }
});

test('notifyAuthorWordRejected skips when author is missing', async () => {
  const chatRepository = require('../../../MVC/repositories/chatRepository');
  const originalCreate = chatRepository.create;
  let called = false;
  chatRepository.create = async () => {
    called = true;
    return { id: 'X' };
  };
  try {
    await notifyAuthorWordRejected({ id: 'WOD-11', word: 'X', authorUserId: '' });
    assert.equal(called, false);
  } finally {
    chatRepository.create = originalCreate;
  }
});