const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return require('node:fs').readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('initialsFromDisplayName follows full-name rules', () => {
  const chatAvatarColorService = require('../MVC/services/chatAvatarColorService');

  assert.equal(chatAvatarColorService.initialsFromDisplayName(''), '?');
  assert.equal(chatAvatarColorService.initialsFromDisplayName('Ada'), 'AD');
  assert.equal(chatAvatarColorService.initialsFromDisplayName('Ada Lovelace'), 'AL');
  assert.equal(chatAvatarColorService.initialsFromDisplayName('  Jean   Paul  '), 'JP');
});

test('pickDefaultColor is stable per user id', () => {
  const chatAvatarColorService = require('../MVC/services/chatAvatarColorService');
  const first = chatAvatarColorService.pickDefaultColor('USER-ABC-123');
  const second = chatAvatarColorService.pickDefaultColor('USER-ABC-123');
  assert.deepEqual(first, second);
  assert.match(first.background, /^#[0-9a-fA-F]{6}$/);
  assert.match(first.foreground, /^#[0-9a-fA-F]{6}$/);
});

test('ensureAvatarColor persists once via userSettingsService', async () => {
  const chatAvatarColorPath = path.join(ROOT_DIR, 'MVC/services/chatAvatarColorService.js');
  delete require.cache[chatAvatarColorPath];

  const stored = new Map();
  const userSettingsService = {
    async getSetting(userId, key, defaultValue) {
      const bucket = stored.get(userId) || {};
      return bucket[key] === undefined ? defaultValue : bucket[key];
    },
    async setSetting(userId, key, value) {
      const bucket = stored.get(userId) || {};
      bucket[key] = value;
      stored.set(userId, bucket);
      return bucket;
    }
  };

  const { createService } = require('../MVC/services/userSettingsService');
  const realService = createService({ repository: { async getUserSettings() { return null; }, async updateSetting() { return {}; } } });
  void realService;

  const chatAvatarColorService = require('../MVC/services/chatAvatarColorService');
  const originalGet = require('../MVC/services/userSettingsService').getSetting;
  const originalSet = require('../MVC/services/userSettingsService').setSetting;
  require('../MVC/services/userSettingsService').getSetting = userSettingsService.getSetting;
  require('../MVC/services/userSettingsService').setSetting = userSettingsService.setSetting;

  try {
    const a = await chatAvatarColorService.ensureAvatarColor('USER-1');
    const b = await chatAvatarColorService.ensureAvatarColor('USER-1');
    assert.deepEqual(a, b);
    assert.equal(stored.size, 1);
    assert.ok(stored.get('USER-1')['chat.avatarColor']);
  } finally {
    require('../MVC/services/userSettingsService').getSetting = originalGet;
    require('../MVC/services/userSettingsService').setSetting = originalSet;
    delete require.cache[chatAvatarColorPath];
  }
});

test('attachAvatarPresentation adds initials and color fields', () => {
  const chatAvatarColorService = require('../MVC/services/chatAvatarColorService');
  const row = chatAvatarColorService.attachAvatarPresentation(
    { id: 'U1', name: 'Sam Taylor', email: 'sam@example.com', avatar: null },
    {
      userId: 'U1',
      avatarColor: { background: '#6366f1', foreground: '#ffffff' }
    }
  );
  assert.equal(row.initials, 'ST');
  assert.deepEqual(row.avatarColor, { background: '#6366f1', foreground: '#ffffff' });
});

test('chat modal uses simplified contact rows and avatar presentation helpers', () => {
  const modal = read('MVC/views/partials/chatModal.ejs');
  assert.match(modal, /initialsFromDisplayName/);
  assert.match(modal, /buildInitialsAvatarHtml/);
  assert.match(modal, /applyChatHeaderAvatar/);
  assert.match(modal, /safeText\(u\.email\)/);
  assert.doesNotMatch(modal, /detailText = `\$\{u\.org/);
});
