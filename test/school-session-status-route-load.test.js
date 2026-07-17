const test = require('node:test');
const assert = require('node:assert/strict');

test('session status controller keeps session status repository available during module loading', () => {
  const controller = require('../packages/school/MVC/controllers/school/sessionStatusController');
  const schoolRepositories = require('../packages/school/MVC/repositories/school');

  assert.equal(typeof controller.listSessionStatuses, 'function');
  assert.equal(typeof schoolRepositories.sessionStatuses?.list, 'function');
});
