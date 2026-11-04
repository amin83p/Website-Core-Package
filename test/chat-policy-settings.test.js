const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('system settings model merges chatPolicy defaults', () => {
  const model = require('../MVC/models/systemSettingsModel');
  const chatPolicyService = require('../MVC/services/chatPolicyService');

  assert.ok(model.DEFAULTS.app.chatPolicy);
  assert.equal(model.DEFAULTS.app.chatPolicy.attachmentsEnabled, true);
  assert.equal(model.DEFAULTS.app.chatPolicy.storageWarnPercent, 85);

  const normalized = chatPolicyService.normalizePolicyFromStored({
    ...model.DEFAULTS.app.chatPolicy,
    maxFileSizeKb: 2048
  });
  assert.equal(normalized.maxFileSizeKb, 2048);
  assert.equal(normalized.storageWarnPercent, 85);
});

test('chatPolicyService resolves special user modes and storage caps', async () => {
  const settingsPath = path.join(ROOT_DIR, 'MVC/models/systemSettingsModel.js');
  delete require.cache[settingsPath];
  const chatPolicyPath = path.join(ROOT_DIR, 'MVC/services/chatPolicyService.js');
  delete require.cache[chatPolicyPath];

  const systemSettingsModel = require('../MVC/models/systemSettingsModel');
  const originals = systemSettingsModel.getSettingsSync();
  const stubPolicy = {
    attachmentsEnabled: true,
    maxFileSizeKb: null,
    allowedExtensions: '',
    blockedExtensions: '.exe',
    maxConversationSizeMb: 1,
    maxUserTotalSizeMb: 2,
    storageWarnPercent: 85,
    specialUsers: [
      { userId: 'USER-BANNED', mode: 'banned' },
      { userId: 'USER-DEACT', mode: 'deactivated' },
      { userId: 'USER-EXEMPT', mode: 'custom', exemptFromStorageLimits: true }
    ]
  };

  const previousGet = systemSettingsModel.getSettingsSync;
  systemSettingsModel.getSettingsSync = () => ({
    ...originals,
    app: { ...(originals.app || {}), chatPolicy: stubPolicy }
  });

  try {
    const chatPolicyService = require('../MVC/services/chatPolicyService');

    const banned = chatPolicyService.resolveForUser('USER-BANNED');
    assert.equal(banned.banned, true);
    assert.equal(banned.deactivated, false);

    const deactivated = chatPolicyService.resolveForUser('USER-DEACT');
    assert.equal(deactivated.deactivated, true);
    assert.equal(deactivated.attachmentsEnabled, false);

    const extCheck = chatPolicyService.validateAttachmentFile({
      user: { id: 'USER-1' },
      originalName: 'malware.exe',
      mimeType: 'application/octet-stream',
      sizeBytes: 100,
      profileMaxFileSizeKB: null
    });
    assert.equal(extCheck.allowed, false);

    const exempt = chatPolicyService.resolveForUser('USER-EXEMPT');
    assert.equal(exempt.exemptFromStorageLimits, true);
    const status = await chatPolicyService.buildStorageStatus({ userId: 'USER-EXEMPT', convId: 'CONV-1' });
    assert.equal(status.user, null);
    assert.equal(status.conversation, null);

    const allowed = chatPolicyService.validateAttachmentFile({
      user: { id: 'USER-1' },
      originalName: 'notes.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      profileMaxFileSizeKB: null
    });
    assert.equal(allowed.allowed, true);
  } finally {
    systemSettingsModel.getSettingsSync = previousGet;
    delete require.cache[chatPolicyPath];
  }
});

test('normalizePolicyFromForm parses special users JSON', () => {
  const chatPolicyService = require('../MVC/services/chatPolicyService');
  const policy = chatPolicyService.normalizePolicyFromForm({
    chatAttachmentsEnabled: 'true',
    chatMaxFileSizeKb: '512',
    chatStorageWarnPercent: '90',
    chatPolicySpecialUsersJson: JSON.stringify([
      { userId: 'U-1', mode: 'banned', label: 'Test User' }
    ])
  });
  assert.equal(policy.maxFileSizeKb, 512);
  assert.equal(policy.storageWarnPercent, 90);
  assert.equal(policy.specialUsers.length, 1);
  assert.equal(policy.specialUsers[0].mode, 'banned');
});

test('app settings view renders chat policy controls', () => {
  const view = read('MVC/views/systemSettings/appSettings.ejs');
  assert.match(view, /name="chatAttachmentsEnabled"/);
  assert.match(view, /name="chatMaxFileSizeKb"/);
  assert.match(view, /name="chatPolicySpecialUsersJson"/);
  assert.match(view, /id="chatSpecialUsersTbody"/);
  assert.match(view, /btnAddChatSpecialUser/);
});

test('chat modal exposes storage warnings and chatPolicy payload', () => {
  const modal = read('MVC/views/partials/chatModal.ejs');
  assert.match(modal, /id="chatUserStorageWarning"/);
  assert.match(modal, /id="chatConversationStorageWarning"/);
  assert.match(modal, /renderUserStorageWarning/);
  assert.match(modal, /renderConversationStorageWarning/);
  assert.match(modal, /chatPolicy:/);
  assert.match(modal, /syncAttachmentButtonState/);
});
