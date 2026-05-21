const test = require('node:test');
const assert = require('node:assert/strict');

const personRepository = require('../MVC/repositories/personRepository');
const organizationRepository = require('../MVC/repositories/organizationRepository');
const accessRepository = require('../MVC/repositories/accessRepository');
const symbolRepository = require('../MVC/repositories/symbolRepository');
const sessionRepository = require('../MVC/repositories/sessionRepository');
const logRepository = require('../MVC/repositories/logRepository');

const personModel = require('../MVC/models/personModel');
const organizationModel = require('../MVC/models/organizationModel');
const accessModel = require('../MVC/models/accessModel');
const symbolModel = require('../MVC/models/symbolModel');
const sessionModel = require('../MVC/models/sessionModel');
const logModel = require('../MVC/models/logModel');

function withStub(target, methodName, replacement, fn) {
  const original = target[methodName];
  target[methodName] = replacement;
  const done = () => {
    target[methodName] = original;
  };

  return Promise.resolve()
    .then(fn)
    .finally(done);
}

test('personRepository.list enforces scope and id equality query', async () => {
  const sample = [
    { id: '1', name: { first: 'Ali', last: 'A' } },
    { id: '2', name: { first: 'Sara', last: 'B' } }
  ];

  await withStub(personModel, 'getAllPersons', async () => sample, async () => {
    const rows = await personRepository.list({
      scope: { canViewAll: false, personIds: ['2'] },
      query: { id: '2' }
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, '2');
  });
});

test('organizationRepository.list enforces allowed org ids', async () => {
  const sample = [
    { id: '10', name: 'Org A' },
    { id: '11', name: 'Org B' }
  ];

  await withStub(organizationModel, 'getAllOrganizations', async () => sample, async () => {
    const rows = await organizationRepository.list({
      scope: { canViewAll: false, orgIds: ['11'] }
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, '11');
  });
});

test('accessRepository.list keeps global and active-org profiles only', async () => {
  const sample = [
    { id: '1', name: 'Global Access', orgId: null },
    { id: '2', name: 'Org Access', orgId: '7' },
    { id: '3', name: 'Other Org Access', orgId: '8' }
  ];

  await withStub(accessModel, 'getAllAccesses', async () => sample, async () => {
    const rows = await accessRepository.list({
      scope: { canViewAll: false, includeGlobal: true, orgId: '7' }
    });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((item) => item.id).sort(), ['1', '2']);
  });
});

test('symbolRepository.list keeps global and active-org symbols', async () => {
  const sample = [
    { id: '1', name: 'Global', orgId: null },
    { id: '2', name: 'Org', orgId: '9' },
    { id: '3', name: 'Other', orgId: '10' }
  ];

  await withStub(symbolModel, 'getAllSymbols', async () => sample, async () => {
    const rows = await symbolRepository.list({
      scope: { canViewAll: false, includeGlobal: true, orgId: '9' }
    });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((item) => item.id).sort(), ['1', '2']);
  });
});

test('sessionRepository.list enforces owner-only scope', async () => {
  const sample = [
    { id: 's1', userId: '100' },
    { id: 's2', userId: '200' }
  ];

  await withStub(sessionModel, 'getAllSessions', async () => sample, async () => {
    const rows = await sessionRepository.list({
      scope: { canViewAll: false, userId: '200' }
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 's2');
  });
});

test('logRepository.list supports in operator and date filter', async () => {
  const sample = [
    { id: 'l1', userId: '1', timestamp: '2026-01-10T10:00:00.000Z', status: 'SUCCESS' },
    { id: 'l2', userId: '2', timestamp: '2026-02-10T10:00:00.000Z', status: 'FAILED' },
    { id: 'l3', userId: '3', timestamp: '2026-03-10T10:00:00.000Z', status: 'SUCCESS' }
  ];

  await withStub(logModel, 'getAllLogs', async () => sample, async () => {
    const rows = await logRepository.list({
      query: {
        userId__in: '1,3',
        startDate: '2026-01-01',
        endDate: '2026-03-31'
      }
    });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((item) => item.id).sort(), ['l1', 'l3']);
  });
});

test('logRepository.list normalizes legacy user payload and supports actor query', async () => {
  const sample = [
    {
      id: 'legacy-1',
      timestamp: '2026-03-10T10:00:00.000Z',
      sectionId: '000000',
      operationId: 'OP9002',
      user: { id: 'U-100', username: 'amin', name: 'Amin Root', activeOrgId: 'ORG-A' },
      status: 'SUCCESS',
      details: { ip: '127.0.0.1' }
    },
    {
      id: 'legacy-2',
      timestamp: '2026-03-10T10:05:00.000Z',
      sectionId: '000000',
      operationId: 'OP9002',
      userId: 'U-200',
      username: 'sara',
      status: 'SUCCESS',
      details: { ip: '127.0.0.2' }
    }
  ];

  await withStub(logModel, 'getAllLogs', async () => sample, async () => {
    const rows = await logRepository.list({
      query: {
        'details.actor.username__eq': 'amin'
      }
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'legacy-1');
    assert.equal(rows[0].userId, 'U-100');
    assert.equal(rows[0].username, 'amin');
    assert.equal(rows[0].displayName, 'Amin Root');
    assert.equal(rows[0].details?.actor?.userId, 'U-100');
    assert.equal(rows[0].details?.actor?.username, 'amin');
  });
});
