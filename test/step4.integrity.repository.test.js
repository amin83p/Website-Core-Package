const test = require('node:test');
const assert = require('node:assert/strict');

const dataService = require('../MVC/services/dataService');
const contractRepository = require('../MVC/repositories/contractRepository');
const logRepository = require('../MVC/repositories/logRepository');
const userRepository = require('../MVC/repositories/userRepository');

function createRestoreStack() {
  const restorers = [];
  return {
    stub(target, methodName, replacement) {
      const original = target[methodName];
      target[methodName] = replacement;
      restorers.push(() => {
        target[methodName] = original;
      });
    },
    restoreAll() {
      while (restorers.length) {
        const restore = restorers.pop();
        restore();
      }
    }
  };
}

test('OrgHasActiveContract delegates to contract repository integrity method', async () => {
  const stack = createRestoreStack();
  const calls = [];

  stack.stub(contractRepository, 'hasActiveContractForOrg', async (orgId) => {
    calls.push(orgId);
    return true;
  });

  try {
    const ok = await dataService.OrgHasActiveContract('42', { id: 'SYSTEM' });
    assert.equal(ok, true);
    assert.deepEqual(calls, ['42']);
  } finally {
    stack.restoreAll();
  }
});

test('deleteData users blocks deletion using logRepository.countByUserId', async () => {
  const stack = createRestoreStack();
  let removed = false;

  stack.stub(logRepository, 'countByUserId', async () => 3);
  stack.stub(userRepository, 'remove', async () => {
    removed = true;
  });

  try {
    await assert.rejects(
      () => dataService.deleteData('users', 'u-1', { id: 'admin' }),
      /Cannot delete User/i
    );
    assert.equal(removed, false);
  } finally {
    stack.restoreAll();
  }
});

test('deleteData persons checks userRepository.existsByPersonId first', async () => {
  const stack = createRestoreStack();
  let existsCalled = 0;
  let findCalled = 0;

  stack.stub(userRepository, 'existsByPersonId', async () => {
    existsCalled += 1;
    return true;
  });
  stack.stub(userRepository, 'findByPersonId', async () => {
    findCalled += 1;
    return [{ username: 'amin' }];
  });

  try {
    await assert.rejects(
      () => dataService.deleteData('persons', 'p-1', { id: 'admin' }),
      /Cannot delete Person/i
    );
    assert.equal(existsCalled, 1);
    assert.equal(findCalled, 1);
  } finally {
    stack.restoreAll();
  }
});
