'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createService, DEFAULT_RULES_VIEW_MODE, SETTING_KEY } = require('../MVC/services/school/notificationCenterRulesViewPreferencesService');

test('notification center rules view mode defaults to tile', async () => {
  const service = createService({
    userSettingsService: {
      async getSetting() {
        return undefined;
      },
      async setSetting() {
        throw new Error('should not save');
      }
    }
  });
  assert.equal(DEFAULT_RULES_VIEW_MODE, 'tile');
  assert.equal(await service.getRulesViewMode('USER_1'), 'tile');
});

test('notification center rules view mode sanitizes invalid stored values', async () => {
  const service = createService({
    userSettingsService: {
      async getSetting() {
        return 'grid';
      },
      async setSetting() {}
    }
  });
  assert.equal(await service.getRulesViewMode('USER_1'), 'tile');
});

test('saveRulesViewMode writes school.notificationCenter.rulesViewMode', async () => {
  const calls = [];
  const service = createService({
    userSettingsService: {
      async getSetting() {
        return 'tile';
      },
      async setSetting(userId, key, value, actor) {
        calls.push({ userId, key, value, actor });
      }
    }
  });
  const saved = await service.saveRulesViewMode('USER_1', 'list', { id: 'USER_1' });
  assert.equal(saved, 'list');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, SETTING_KEY);
  assert.equal(calls[0].value, 'list');
  assert.equal(calls[0].userId, 'USER_1');
});

test('normalizeRulesViewMode coerces unknown save payload to tile', async () => {
  const calls = [];
  const service = createService({
    userSettingsService: {
      async getSetting() {
        return 'list';
      },
      async setSetting(userId, key, value) {
        calls.push({ userId, key, value });
      }
    }
  });
  const saved = await service.saveRulesViewMode('USER_2', 'bogus', 'USER_2');
  assert.equal(saved, 'tile');
  assert.equal(calls[0].value, 'tile');
});
