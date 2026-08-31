const test = require('node:test');
const assert = require('node:assert/strict');

const smsOutboxService = require('../MVC/services/smsOutboxService');
const smsOutboxDispatchService = require('../MVC/services/smsOutboxDispatchService');
const smsOutboxRepository = require('../MVC/repositories/smsOutboxRepository');
const smsProviderService = require('../MVC/services/sms/smsProviderService');

const originalCreate = smsOutboxRepository.create;
const originalList = smsOutboxRepository.list;
const originalUpdate = smsOutboxRepository.update;
const originalGetById = smsOutboxRepository.getById;
const originalSendMessage = smsProviderService.sendMessage;

const memory = new Map();

function resetMemory() {
  memory.clear();
}

test.beforeEach(() => {
  resetMemory();
  let seq = 1;
  smsOutboxRepository.create = async (payload) => {
    const row = {
      id: `SMS_OUT_${seq += 1}`,
      status: 'queued',
      preparedAt: new Date().toISOString(),
      ...payload
    };
    memory.set(row.id, row);
    return row;
  };
  smsOutboxRepository.list = async ({ query } = {}) => {
    const rows = [...memory.values()];
    return rows.filter((row) => {
      if (query?.orgId__eq && row.orgId !== query.orgId__eq) return false;
      if (query?.dedupeKey__eq && row.dedupeKey !== query.dedupeKey__eq) return false;
      if (query?.status__eq && row.status !== query.status__eq) return false;
      if (query?.sendAt__lte && String(row.sendAt) > String(query.sendAt__lte)) return false;
      return true;
    });
  };
  smsOutboxRepository.update = async (id, patch) => {
    const existing = memory.get(id);
    const next = { ...existing, ...patch };
    memory.set(id, next);
    return next;
  };
  smsOutboxRepository.getById = async (id) => memory.get(id) || null;
});

test.after(() => {
  smsOutboxRepository.create = originalCreate;
  smsOutboxRepository.list = originalList;
  smsOutboxRepository.update = originalUpdate;
  smsOutboxRepository.getById = originalGetById;
  smsProviderService.sendMessage = originalSendMessage;
});

test('enqueueBatch dedupes queued rows by dedupeKey', async () => {
  const payload = {
    orgId: 'ORG_1',
    to: '+15551234567',
    body: 'Digest SMS',
    sendAt: '2026-08-30T18:00:00.000Z',
    dedupeKey: 'ORG_1::digest::teacher::sms::2026-08-30'
  };

  const first = await smsOutboxService.enqueue(payload);
  const second = await smsOutboxService.enqueue(payload);

  assert.ok(first);
  assert.equal(second, null);
  assert.equal(memory.size, 1);
});

test('dispatchDue sends only queued rows at or before now', async () => {
  await smsOutboxService.enqueue({
    orgId: 'ORG_1',
    to: '+15551111111',
    body: 'Due now',
    sendAt: '2026-08-30T17:00:00.000Z',
    dedupeKey: 'due-sms-1'
  });
  await smsOutboxService.enqueue({
    orgId: 'ORG_1',
    to: '+15552222222',
    body: 'Later',
    sendAt: '2026-08-30T20:00:00.000Z',
    dedupeKey: 'future-sms-1'
  });

  let sentTo = null;
  smsProviderService.sendMessage = async (payload) => {
    sentTo = payload.phoneE164;
    return { sid: 'SM_1' };
  };

  const metrics = await smsOutboxDispatchService.dispatchDue({
    now: new Date('2026-08-30T18:00:00.000Z')
  });

  assert.equal(metrics.sent, 1);
  assert.equal(metrics.failed, 0);
  assert.equal(sentTo, '+15551111111');
  const futureRow = [...memory.values()].find((row) => row.to === '+15552222222');
  assert.equal(futureRow.status, 'queued');
});

test('cancelById rejects non-queued rows', async () => {
  const row = await smsOutboxService.enqueue({
    orgId: 'ORG_1',
    to: '+15553333333',
    body: 'Done',
    sendAt: '2026-08-30T18:00:00.000Z',
    dedupeKey: 'sent-sms-1'
  });
  await smsOutboxService.markSent(row.id);

  await assert.rejects(
    () => smsOutboxService.cancelById(row.id),
    /Only queued or sending outbox SMS messages can be cancelled/i
  );
});
