const test = require('node:test');
const assert = require('node:assert/strict');

const entityGatewayService = require('../MVC/services/data/entityGatewayService');
const userRepository = require('../MVC/repositories/userRepository');
const actionStateChangeTrackerService = require('../MVC/services/actionStateChangeTrackerService');
const { buildActionStateDiff } = require('../MVC/utils/actionStateDiff');
const { _test: actionStateMiddlewareTest } = require('../MVC/middleware/actionStateMiddleware');

test('user update succeeds when post-save action-state change tracking throws', async () => {
  const originalList = userRepository.list;
  const originalUpdate = userRepository.update;
  const originalTrackUpdate = actionStateChangeTrackerService.trackUpdate;
  const originalConsoleError = console.error;
  const loggedErrors = [];

  userRepository.list = async () => [{
    id: 'USER_1',
    email: 'before@example.com',
    passwordHash: 'old-hash'
  }];
  userRepository.update = async (id, updates) => ({
    id,
    email: 'before@example.com',
    ...updates
  });
  actionStateChangeTrackerService.trackUpdate = async () => {
    throw new TypeError("Cannot read properties of undefined (reading 'id')");
  };
  console.error = (...args) => loggedErrors.push(args);

  try {
    const result = await entityGatewayService.updateData(
      'users',
      'USER_1',
      { passwordHash: 'new-hash' },
      { id: 'ADMIN_1' }
    );

    assert.equal(result.id, 'USER_1');
    assert.equal(result.passwordHash, 'new-hash');
    assert.equal(loggedErrors.length, 1);
    assert.match(String(loggedErrors[0][0]), /tracking failed after the data operation completed/i);
  } finally {
    userRepository.list = originalList;
    userRepository.update = originalUpdate;
    actionStateChangeTrackerService.trackUpdate = originalTrackUpdate;
    console.error = originalConsoleError;
  }
});

test('password fields are excluded from action-state response payloads', () => {
  const payload = actionStateMiddlewareTest.buildActionStatePayload('POST', {
    actionStateId: 'ACTION_1',
    email: 'user@example.com',
    passwordHash: 'plain-password',
    credentials: {
      current_password: 'old-password',
      newPassword: 'new-password',
      label: 'preserved'
    }
  });

  assert.deepEqual(payload, {
    email: 'user@example.com',
    credentials: {
      label: 'preserved'
    }
  });
});

test('password hash changes are hidden from action-state diffs', () => {
  const diff = buildActionStateDiff(
    { id: 'USER_1', passwordHash: 'old-hash', email: 'before@example.com' },
    { id: 'USER_1', passwordHash: 'new-hash', email: 'after@example.com' }
  );

  assert.equal(diff.summary.hiddenAuditCount, 1);
  assert.deepEqual(diff.changes, [{
    path: 'email',
    type: 'changed',
    from: 'before@example.com',
    to: 'after@example.com'
  }]);
});
