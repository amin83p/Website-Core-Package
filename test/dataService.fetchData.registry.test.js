const test = require('node:test');
const assert = require('node:assert/strict');

const dataService = require('../MVC/services/dataService');
const personRepository = require('../MVC/repositories/personRepository');
const organizationRepository = require('../MVC/repositories/organizationRepository');
const newsletterRepository = require('../MVC/repositories/newsletterRepository');

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

test('fetchData throws on unknown entity type', async () => {
  await assert.rejects(
    () => dataService.fetchData('not_real_entity', {}, null),
    /Unknown entity type: not_real_entity/
  );
});

test('fetchData uses registry scope builder for persons', async () => {
  const stack = createRestoreStack();
  const calls = [];
  stack.stub(personRepository, 'list', async (payload) => {
    calls.push(payload);
    return [{ id: '2' }];
  });

  try {
    const user = {
      id: 100,
      allowedPersonIds: [2, 3]
    };

    const result = await dataService.fetchData('persons', { q: 'ali' }, user);

    assert.equal(result.length, 1);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].query, { q: 'ali' });
    assert.deepEqual(calls[0].scope, {
      canViewAll: false,
      personIds: ['2', '3']
    });
  } finally {
    stack.restoreAll();
  }
});

test('fetchData resolves newsletter aliases to newsletter repository', async () => {
  const stack = createRestoreStack();
  const calls = [];
  stack.stub(newsletterRepository, 'list', async (payload) => {
    calls.push(payload);
    return [{ id: 'n-1' }];
  });

  try {
    const user = { id: 99 };

    const r1 = await dataService.fetchData('newsletterSubscribers', { q: 'abc' }, user);
    const r2 = await dataService.fetchData('newsletterSubscriptions', { q: 'xyz' }, user);

    assert.equal(r1.length, 1);
    assert.equal(r2.length, 1);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].query, { q: 'abc' });
    assert.deepEqual(calls[1].query, { q: 'xyz' });
    assert.deepEqual(calls[0].scope, { canViewAll: true, isAuthenticated: true });
    assert.deepEqual(calls[1].scope, { canViewAll: true, isAuthenticated: true });
  } finally {
    stack.restoreAll();
  }
});

test('fetchData uses organization scope with allowed orgs', async () => {
  const stack = createRestoreStack();
  const calls = [];
  stack.stub(organizationRepository, 'list', async (payload) => {
    calls.push(payload);
    return [];
  });

  try {
    const user = {
      id: 50,
      allowedOrgs: [{ orgId: 8 }, { orgId: '11' }]
    };

    await dataService.fetchData('organizations', {}, user);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].scope, {
      canViewAll: false,
      orgIds: ['8', '11']
    });
  } finally {
    stack.restoreAll();
  }
});

test('fetchData normalizes structured query payload before repository call', async () => {
  const stack = createRestoreStack();
  const calls = [];
  stack.stub(personRepository, 'list', async (payload) => {
    calls.push(payload);
    return [];
  });

  try {
    await dataService.fetchData('persons', {
      filters: { active: true, orgId__in: ['10', '11'] },
      search: { text: 'amin', type: 'contains', fields: ['name.first', 'name.last'] },
      sort: { field: 'createdAt', order: 'desc' },
      pagination: { page: 2, pageSize: 25 }
    }, { id: 'u-1', allowedPersonIds: ['1'] });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].query, {
      active: true,
      orgId__in: ['10', '11'],
      q: 'amin',
      type: 'contains',
      searchFields: ['name.first', 'name.last'],
      sort: 'createdAt',
      order: 'desc',
      page: 2,
      limit: 25
    });
  } finally {
    stack.restoreAll();
  }
});
