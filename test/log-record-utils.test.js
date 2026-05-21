const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalizeLogInput,
  normalizePersistedLogRecord
} = require('../MVC/utils/logRecordUtils');

test('canonicalizeLogInput builds actor snapshot, request id, and redacts sensitive keys', () => {
  const row = canonicalizeLogInput({
    sectionId: '000000',
    operationId: 'OP9001',
    status: 'success',
    requestId: 'REQ-123',
    actionStateId: 'ASI-100',
    user: {
      id: 'U-1',
      username: 'amin',
      name: 'Amin Root',
      activeOrgId: 'ORG-1'
    },
    details: {
      ip: '::1',
      password: 'plain-secret',
      headers: {
        authorization: 'Bearer token'
      }
    }
  });

  assert.equal(row.userId, 'U-1');
  assert.equal(row.username, 'amin');
  assert.equal(row.displayName, 'Amin Root');
  assert.equal(row.orgId, 'ORG-1');
  assert.equal(row.actorType, 'user');
  assert.equal(row.status, 'SUCCESS');
  assert.equal(row.details?.requestId, 'REQ-123');
  assert.equal(row.actionStateId, 'ASI-100');
  assert.equal(row.details?.actionStateId, 'ASI-100');
  assert.equal(row.details?.password, '[REDACTED]');
  assert.equal(row.details?.headers?.authorization, '[REDACTED]');
  assert.equal(row.details?.actor?.userId, 'U-1');
  assert.equal(row.details?.actor?.username, 'amin');
});

test('normalizePersistedLogRecord upgrades legacy user object shape', () => {
  const row = normalizePersistedLogRecord({
    id: 'legacy-1',
    sectionId: '000000',
    operationId: 'OP9002',
    user: {
      id: 'U-200',
      username: 'sara',
      name: 'Sara Doe',
      activeOrgId: 'ORG-2'
    },
    status: 'SUCCESS',
    details: {
      actionStateId: 'ASI-200',
      token: 'secret-token'
    }
  });

  assert.equal(row.userId, 'U-200');
  assert.equal(row.username, 'sara');
  assert.equal(row.displayName, 'Sara Doe');
  assert.equal(row.orgId, 'ORG-2');
  assert.equal(row.actorType, 'user');
  assert.equal(row.actionStateId, 'ASI-200');
  assert.equal(row.details?.actionStateId, 'ASI-200');
  assert.equal(row.details?.token, '[REDACTED]');
  assert.equal(row.details?.actor?.displayName, 'Sara Doe');
});
