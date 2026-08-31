const test = require('node:test');
const assert = require('node:assert/strict');

const {
  registerCoreScheduledTaskHandler,
  registerPackageScheduledTaskHandler,
  getScheduledTaskHandler,
  listRegisteredScheduledTaskHandlers,
  clearScheduledTaskHandlersForTests
} = require('../MVC/services/scheduledTaskRegistry');

test.beforeEach(() => {
  clearScheduledTaskHandlersForTests();
});

test.after(() => {
  clearScheduledTaskHandlersForTests();
});

test('registerCoreScheduledTaskHandler stores core handlers', async () => {
  registerCoreScheduledTaskHandler({
    taskKey: 'core.test.task',
    label: 'Test task',
    handler: async () => ({ resultSummary: 'ok' })
  });

  const handler = getScheduledTaskHandler('core.test.task');
  assert.ok(handler);
  assert.equal(handler.scope, 'system');
  assert.equal(handler.packageName, 'CORE');
  const result = await handler.handler({});
  assert.equal(result.resultSummary, 'ok');
});

test('registerPackageScheduledTaskHandler stores package handlers', () => {
  registerPackageScheduledTaskHandler('SCHOOL', {
    taskKey: 'school.test.task',
    label: 'School task',
    scope: 'org',
    handler: async () => ({ resultSummary: 'school' })
  });

  const handler = getScheduledTaskHandler('school.test.task');
  assert.ok(handler);
  assert.equal(handler.scope, 'org');
  assert.equal(handler.packageName, 'SCHOOL');
});

test('duplicate registration throws', () => {
  registerCoreScheduledTaskHandler({
    taskKey: 'core.duplicate',
    handler: async () => ({})
  });
  assert.throws(() => {
    registerCoreScheduledTaskHandler({
      taskKey: 'core.duplicate',
      handler: async () => ({})
    });
  }, /already registered/i);
});

test('package cannot register reserved core task keys', () => {
  assert.throws(() => {
    registerPackageScheduledTaskHandler('SCHOOL', {
      taskKey: 'core.reserved',
      handler: async () => ({})
    });
  }, /cannot register reserved core task key/i);
});

test('getScheduledTaskHandler returns null for unknown keys', () => {
  assert.equal(getScheduledTaskHandler('missing.task'), null);
});

test('listRegisteredScheduledTaskHandlers omits handler functions', () => {
  registerCoreScheduledTaskHandler({
    taskKey: 'core.listed',
    label: 'Listed',
    handler: async () => ({})
  });
  const rows = listRegisteredScheduledTaskHandlers();
  assert.equal(rows.some((row) => row.taskKey === 'core.listed'), true);
  assert.equal(rows.every((row) => typeof row.handler === 'undefined'), true);
});
