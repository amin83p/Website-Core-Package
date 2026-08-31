const test = require('node:test');
const assert = require('node:assert/strict');

const emailOutboxService = require('../MVC/services/emailOutboxService');
const emailOutboxDispatchService = require('../MVC/services/emailOutboxDispatchService');
const emailOutboxRepository = require('../MVC/repositories/emailOutboxRepository');
const resendEmailService = require('../MVC/services/resendEmailService');
const emailProviderProfileService = require('../MVC/services/emailProviderProfileService');

const originalCreate = emailOutboxRepository.create;
const originalList = emailOutboxRepository.list;
const originalUpdate = emailOutboxRepository.update;
const originalGetById = emailOutboxRepository.getById;
const originalRemove = emailOutboxRepository.remove;
const originalSendEmail = resendEmailService.sendEmail;
const originalResolveCredentials = emailProviderProfileService.resolveProviderCredentials;

const memory = new Map();

function resetMemory() {
  memory.clear();
}

test.beforeEach(() => {
  resetMemory();
  let seq = 1;
  emailOutboxRepository.create = async (payload) => {
    const row = {
      id: `OUT_${seq += 1}`,
      status: 'queued',
      preparedAt: new Date().toISOString(),
      ...payload
    };
    memory.set(row.id, row);
    return row;
  };
  emailOutboxRepository.list = async ({ query } = {}) => {
    const rows = [...memory.values()];
    return rows.filter((row) => {
      if (query?.orgId__eq && row.orgId !== query.orgId__eq) return false;
      if (query?.dedupeKey__eq && row.dedupeKey !== query.dedupeKey__eq) return false;
      if (query?.status__eq && row.status !== query.status__eq) return false;
      if (query?.sendAt__lte && String(row.sendAt) > String(query.sendAt__lte)) return false;
      return true;
    });
  };
  emailOutboxRepository.update = async (id, patch) => {
    const existing = memory.get(id);
    const next = { ...existing, ...patch };
    memory.set(id, next);
    return next;
  };
  emailOutboxRepository.getById = async (id) => memory.get(id) || null;
  emailOutboxRepository.remove = async (id) => {
    if (!memory.has(id)) throw new Error('Email outbox entry not found.');
    memory.delete(id);
    return true;
  };
});

test.after(() => {
  emailOutboxRepository.create = originalCreate;
  emailOutboxRepository.list = originalList;
  emailOutboxRepository.update = originalUpdate;
  emailOutboxRepository.getById = originalGetById;
  emailOutboxRepository.remove = originalRemove;
  resendEmailService.sendEmail = originalSendEmail;
  emailProviderProfileService.resolveProviderCredentials = originalResolveCredentials;
});

test('enqueueBatch dedupes queued rows by dedupeKey', async () => {
  const payload = {
    orgId: 'ORG_1',
    to: 'teacher@example.com',
    subject: 'Digest',
    text: 'Hello',
    sendAt: '2026-08-30T18:00:00.000Z',
    dedupeKey: 'ORG_1::digest::teacher::email::2026-08-30'
  };

  const first = await emailOutboxService.enqueue(payload);
  const second = await emailOutboxService.enqueue(payload);

  assert.ok(first);
  assert.equal(second, null);
  assert.equal(memory.size, 1);
});

test('enqueueBatch reactivates cancelled rows instead of inserting duplicates', async () => {
  const dedupeKey = '900000::daily_digest::434558::email::2026-08-30';
  const original = await emailOutboxService.enqueue({
    orgId: '900000',
    to: 'teacher@example.com',
    subject: 'Old subject',
    text: 'Old body',
    sendAt: '2026-08-30T08:00:00.000Z',
    dedupeKey
  });
  await emailOutboxService.cancelById(original.id);

  const requeued = await emailOutboxService.enqueue({
    orgId: '900000',
    to: 'teacher@example.com',
    subject: 'New subject',
    text: 'New body',
    sendAt: '2026-08-30T18:00:00.000Z',
    dedupeKey
  });

  assert.ok(requeued);
  assert.equal(requeued.id, original.id);
  assert.equal(requeued.status, 'queued');
  assert.equal(requeued.subject, 'New subject');
  assert.equal(memory.size, 1);
});

test('enqueueBatch always inserts when prepareRunId is set', async () => {
  const dedupeKey = 'ORG_1::digest::teacher::email::2026-08-30::RUN_1';
  const first = await emailOutboxService.enqueue({
    orgId: 'ORG_1',
    to: 'teacher@example.com',
    subject: 'First',
    text: 'Hello',
    sendAt: '2026-08-30T18:00:00.000Z',
    dedupeKey,
    meta: { prepareRunId: 'RUN_1', purpose: 'uncompleted_session_notification' }
  });
  const second = await emailOutboxService.enqueue({
    orgId: 'ORG_1',
    to: 'teacher@example.com',
    subject: 'Second',
    text: 'Hello again',
    sendAt: '2026-08-30T19:00:00.000Z',
    dedupeKey: `${dedupeKey}_2`,
    meta: { prepareRunId: 'RUN_2', purpose: 'uncompleted_session_notification' }
  });

  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.id, second.id);
  assert.equal(memory.size, 2);
});

test('deleteById only allows terminal rows', async () => {
  const queued = await emailOutboxService.enqueue({
    orgId: 'ORG_1',
    to: 'queued@example.com',
    subject: 'Queued',
    text: 'Queued',
    sendAt: '2026-08-30T18:00:00.000Z',
    dedupeKey: 'delete-queued'
  });
  await assert.rejects(
    () => emailOutboxService.deleteById(queued.id),
    /Only cancelled, failed, or sent outbox emails can be deleted/i
  );

  await emailOutboxService.cancelById(queued.id);
  await emailOutboxService.deleteById(queued.id);
  assert.equal(memory.has(queued.id), false);
});

test('cancelByIds returns partial success summary', async () => {
  const first = await emailOutboxService.enqueue({
    orgId: 'ORG_1',
    to: 'a@example.com',
    subject: 'A',
    text: 'A',
    sendAt: '2026-08-30T18:00:00.000Z',
    dedupeKey: 'bulk-a'
  });
  const second = await emailOutboxService.enqueue({
    orgId: 'ORG_1',
    to: 'b@example.com',
    subject: 'B',
    text: 'B',
    sendAt: '2026-08-30T18:00:00.000Z',
    dedupeKey: 'bulk-b'
  });
  await emailOutboxService.markSent(second.id);

  const result = await emailOutboxService.cancelByIds([first.id, second.id, 'MISSING']);
  assert.equal(result.succeeded.length, 1);
  assert.equal(result.failed.length, 2);
});

test('dispatchDue sends only queued rows at or before now', async () => {
  await emailOutboxService.enqueue({
    orgId: 'ORG_1',
    to: 'due@example.com',
    subject: 'Due',
    text: 'Due now',
    sendAt: '2026-08-30T17:00:00.000Z',
    dedupeKey: 'due-1'
  });
  await emailOutboxService.enqueue({
    orgId: 'ORG_1',
    to: 'future@example.com',
    subject: 'Future',
    text: 'Later',
    sendAt: '2026-08-30T20:00:00.000Z',
    dedupeKey: 'future-1'
  });

  let sentTo = null;
  emailProviderProfileService.resolveProviderCredentials = async () => ({
    apiKey: 're_test',
    fromEmail: 'noreply@example.com',
    verifiedDomains: ['example.com']
  });
  resendEmailService.sendEmail = async (payload) => {
    sentTo = payload.to;
    return { id: 'msg_1' };
  };

  const metrics = await emailOutboxDispatchService.dispatchDue({
    now: new Date('2026-08-30T18:00:00.000Z')
  });

  assert.equal(metrics.sent, 1);
  assert.equal(metrics.failed, 0);
  assert.equal(sentTo, 'due@example.com');
  const futureRow = [...memory.values()].find((row) => row.to === 'future@example.com');
  assert.equal(futureRow.status, 'queued');
});

test('cancelById rejects non-queued rows', async () => {
  const row = await emailOutboxService.enqueue({
    orgId: 'ORG_1',
    to: 'sent@example.com',
    subject: 'Sent',
    text: 'Done',
    sendAt: '2026-08-30T18:00:00.000Z',
    dedupeKey: 'sent-1'
  });
  await emailOutboxService.markSent(row.id);

  await assert.rejects(
    () => emailOutboxService.cancelById(row.id),
    /Only queued or sending outbox emails can be cancelled/i
  );
});
