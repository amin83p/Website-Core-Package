const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getModuleKey,
  applyModuleOrder,
  applyHiddenModules,
  isSectionNavDashboardKey,
  buildDashboardOrderTableId,
  validateDashboardKey,
  validateModuleOrder,
  validateHiddenModuleKeys,
  validateNavigationPreferences,
  extractModuleOrderFromSettings,
  extractNavigationPreferences,
  MAX_MODULE_ORDER_LENGTH
} = require('../MVC/utils/dashboardModuleOrder');

const {
  createService,
  hasSavedPreferences,
  buildNextSettings,
  readDashboardEntry
} = require('../MVC/services/sectionNavigationPreferencesService');

test('getModuleKey prefers id, then href, then title', () => {
  assert.equal(getModuleKey({ id: 'abc', href: '/x', title: 'T' }), 'abc');
  assert.equal(getModuleKey({ href: '/x', title: 'T' }), '/x');
  assert.equal(getModuleKey({ title: 'T' }), 'T');
});

test('applyModuleOrder sorts by saved order and appends new modules', () => {
  const modules = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C' }
  ];
  const ordered = applyModuleOrder(modules, ['c', 'a', 'missing']);
  assert.deepEqual(ordered.map((m) => m.id), ['c', 'a', 'b']);
});

test('applyHiddenModules removes hidden modules unless includeHidden is true', () => {
  const modules = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' }
  ];
  assert.deepEqual(applyHiddenModules(modules, ['b']).map((m) => m.id), ['a']);
  assert.deepEqual(applyHiddenModules(modules, ['b'], { includeHidden: true }).map((m) => m.id), ['a', 'b']);
});

test('validateHiddenModuleKeys enforces string array with max length', () => {
  assert.equal(validateHiddenModuleKeys(null).ok, true);
  assert.equal(validateHiddenModuleKeys(['']).ok, false);
  assert.equal(validateHiddenModuleKeys(['a']).ok, true);
  assert.equal(
    validateHiddenModuleKeys(Array.from({ length: MAX_MODULE_ORDER_LENGTH + 1 }, (_, i) => `id-${i}`)).ok,
    false
  );
});

test('validateNavigationPreferences accepts moduleOrder and hiddenModuleKeys', () => {
  const ok = validateNavigationPreferences({
    moduleOrder: ['a', 'b'],
    hiddenModuleKeys: ['c']
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.moduleOrder, ['a', 'b']);
  assert.deepEqual(ok.hiddenModuleKeys, ['c']);

  const hiddenOnly = validateNavigationPreferences({ hiddenModuleKeys: ['x'] });
  assert.equal(hiddenOnly.ok, true);
  assert.equal(hiddenOnly.moduleOrder, null);
  assert.deepEqual(hiddenOnly.hiddenModuleKeys, ['x']);
});

test('extractNavigationPreferences reads moduleOrder and hiddenModuleKeys', () => {
  assert.deepEqual(
    extractNavigationPreferences({ moduleOrder: ['a'], hiddenModuleKeys: ['b'] }),
    { moduleOrder: ['a'], hiddenModuleKeys: ['b'] }
  );
  assert.deepEqual(extractNavigationPreferences({}), { moduleOrder: null, hiddenModuleKeys: [] });
});

test('buildNextSettings stores and clears dashboard navigation preferences', () => {
  const withPrefs = buildNextSettings({}, 'section-1', {
    moduleOrder: ['a'],
    hiddenModuleKeys: ['b']
  });
  assert.deepEqual(readDashboardEntry(withPrefs, 'section-1'), {
    moduleOrder: ['a'],
    hiddenModuleKeys: ['b']
  });

  const cleared = buildNextSettings(withPrefs, 'section-1', {});
  assert.deepEqual(readDashboardEntry(cleared, 'section-1'), {});
  assert.equal(hasSavedPreferences(readDashboardEntry(cleared, 'section-1')), false);
});

test('section navigation preferences service migrates legacy tableSettings into userSettings', async () => {
  const userId = 'USER_1';
  const dashboardKey = 'section-122740';
  let storedSettings = {};
  const legacyTableId = buildDashboardOrderTableId(dashboardKey);
  let legacyRecord = {
    userId,
    tableId: legacyTableId,
    settings: { moduleOrder: ['a', 'b'] }
  };

  const service = createService({
    userSettingsService: {
      async getSettings() {
        return storedSettings;
      },
      async setSettings(_userId, settings) {
        storedSettings = JSON.parse(JSON.stringify(settings));
        return { settings: storedSettings };
      }
    },
    dataService: {
      async getDataById(entity, query) {
        if (entity !== 'tableSettings') return null;
        if (query.userId === userId && query.tableId === legacyTableId) return legacyRecord;
        return null;
      },
      async deleteData(entity, query) {
        if (entity === 'tableSettings' && query.tableId === legacyTableId) {
          legacyRecord = null;
          return true;
        }
        return false;
      }
    }
  });

  const prefs = await service.getPreferences(userId, dashboardKey);
  assert.deepEqual(prefs.moduleOrder, ['a', 'b']);
  assert.deepEqual(prefs.hiddenModuleKeys, []);
  assert.deepEqual(storedSettings.sectionNavigation[dashboardKey], { moduleOrder: ['a', 'b'] });
  assert.equal(legacyRecord, null);
});

test('section navigation preferences service saves hidden module keys', async () => {
  const userId = 'USER_2';
  const dashboardKey = 'section-ABC';
  let storedSettings = {
    sectionNavigation: {
      [dashboardKey]: { moduleOrder: ['a', 'b'] }
    }
  };

  const service = createService({
    userSettingsService: {
      async getSettings() {
        return storedSettings;
      },
      async setSettings(_userId, settings) {
        storedSettings = JSON.parse(JSON.stringify(settings));
        return { settings: storedSettings };
      }
    },
    dataService: {
      async getDataById() { return null; },
      async deleteData() { return false; }
    }
  });

  const saved = await service.savePreferences(userId, dashboardKey, {
    hiddenModuleKeys: ['b']
  });
  assert.deepEqual(saved.moduleOrder, ['a', 'b']);
  assert.deepEqual(saved.hiddenModuleKeys, ['b']);
  assert.deepEqual(
    storedSettings.sectionNavigation[dashboardKey],
    { moduleOrder: ['a', 'b'], hiddenModuleKeys: ['b'] }
  );
});

test('dashboardController exports navigation preference handlers', () => {
  const dashboardController = require('../MVC/controllers/dashboardController');
  assert.equal(typeof dashboardController.applyModuleOrder, 'function');
  assert.equal(typeof dashboardController.applyHiddenModules, 'function');
  assert.equal(typeof dashboardController.getModuleOrder, 'function');
  assert.equal(typeof dashboardController.saveModuleOrder, 'function');
  assert.equal(typeof dashboardController.resetModuleOrder, 'function');
});
