const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('system settings define chat transport defaults', () => {
  const model = require('../MVC/models/systemSettingsModel');

  assert.equal(model.DEFAULTS.app.chatBackgroundPollIntervalSeconds, 60);
  assert.equal(model.DEFAULTS.app.chatRealtimeWhenModalClosed, false);
});

test('app settings renders chat transport controls', () => {
  const view = read('MVC/views/systemSettings/appSettings.ejs');

  assert.match(view, /id="app-chat-tab"/);
  assert.match(view, /id="app-chat-pane"/);
  assert.match(view, /name="chatBackgroundPollIntervalSeconds"/);
  assert.match(view, /name="chatRealtimeWhenModalClosed"/);
  assert.match(view, /name="chatAttachmentsEnabled"/);
  assert.match(view, /name="chatPolicySpecialUsersJson"/);
  assert.match(view, /min="15"/);
  assert.match(view, /max="600"/);
});

test('layout exposes chat transport in app UI settings fallback', () => {
  const layout = read('MVC/views/layouts/layout.ejs');

  assert.match(layout, /chatBackgroundPollIntervalMs:\s*60000/);
  assert.match(layout, /chatRealtimeWhenModalClosed:\s*false/);
});

test('app.js resolves chat transport for browser scripts', () => {
  const appSource = read('app.js');

  assert.match(appSource, /chatBackgroundPollIntervalMs/);
  assert.match(appSource, /chatRealtimeWhenModalClosed/);
});

test('chat modal implements transport policy and attachment ack flow', () => {
  const modal = read('MVC/views/partials/chatModal.ejs');

  assert.match(modal, /applyChatTransportPolicy/);
  assert.match(modal, /startChatBackgroundPoll/);
  assert.match(modal, /stopChatBackgroundPoll/);
  assert.match(modal, /chatTransportConfig/);
  assert.match(modal, /tempId/);
  assert.match(modal, /applyMessageSentAck/);
  assert.match(modal, /temp_img_/);
  assert.match(modal, /hidden\.bs\.modal/);
  assert.match(modal, /id="chatConversationStorageWarning"/);
  assert.match(modal, /renderUserStorageWarning/);
  assert.match(modal, /avatarColor/);
  assert.match(modal, /initialsFromDisplayName/);
});
