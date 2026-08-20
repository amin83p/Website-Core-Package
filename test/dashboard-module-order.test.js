const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getModuleKey,
  applyModuleOrder,
  isSectionNavDashboardKey,
  buildDashboardOrderTableId,
  validateDashboardKey,
  validateModuleOrder,
  extractModuleOrderFromSettings,
  MAX_MODULE_ORDER_LENGTH
} = require('../MVC/utils/dashboardModuleOrder');

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

test('applyModuleOrder ignores stale saved ids', () => {
  const modules = [{ id: 'only' }];
  const ordered = applyModuleOrder(modules, ['gone', 'only', 'also-gone']);
  assert.deepEqual(ordered.map((m) => m.id), ['only']);
});

test('applyModuleOrder returns original list when saved order is empty', () => {
  const modules = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(applyModuleOrder(modules, []), modules);
  assert.deepEqual(applyModuleOrder(modules, null), modules);
});

test('isSectionNavDashboardKey accepts section keys only', () => {
  assert.equal(isSectionNavDashboardKey('section-122740'), true);
  assert.equal(isSectionNavDashboardKey('section-SCHOOL'), true);
  assert.equal(isSectionNavDashboardKey('newsCenter'), false);
  assert.equal(isSectionNavDashboardKey('dashboard'), false);
});

test('buildDashboardOrderTableId prefixes dashboard key', () => {
  assert.equal(buildDashboardOrderTableId('section-122740'), 'dashboard-order:section-122740');
});

test('validateDashboardKey rejects non section-nav keys', () => {
  const invalid = validateDashboardKey('newsCenter');
  assert.equal(invalid.ok, false);
  const valid = validateDashboardKey('section-122740');
  assert.equal(valid.ok, true);
  assert.equal(valid.key, 'section-122740');
});

test('validateModuleOrder enforces non-empty string array with max length', () => {
  assert.equal(validateModuleOrder(null).ok, false);
  assert.equal(validateModuleOrder([]).ok, false);
  assert.equal(validateModuleOrder(['']).ok, false);
  assert.equal(validateModuleOrder([123]).ok, false);

  const ok = validateModuleOrder(['a', 'b']);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.moduleOrder, ['a', 'b']);

  const tooLong = validateModuleOrder(Array.from({ length: MAX_MODULE_ORDER_LENGTH + 1 }, (_, i) => `id-${i}`));
  assert.equal(tooLong.ok, false);
});

test('extractModuleOrderFromSettings reads moduleOrder array', () => {
  assert.deepEqual(extractModuleOrderFromSettings({ moduleOrder: ['a', 'b'] }), ['a', 'b']);
  assert.equal(extractModuleOrderFromSettings({ moduleOrder: [] }), null);
  assert.equal(extractModuleOrderFromSettings({}), null);
});

test('dashboardController exports applyModuleOrder helper', () => {
  const dashboardController = require('../MVC/controllers/dashboardController');
  assert.equal(typeof dashboardController.applyModuleOrder, 'function');
  assert.equal(typeof dashboardController.getModuleOrder, 'function');
  assert.equal(typeof dashboardController.saveModuleOrder, 'function');
  assert.equal(typeof dashboardController.resetModuleOrder, 'function');
});
