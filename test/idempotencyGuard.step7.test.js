const test = require('node:test');
const assert = require('node:assert/strict');

const idempotencyGuardService = require('../MVC/services/school/idempotencyGuardService');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('idempotency guard key generation is stable for equivalent payload shapes', () => {
  const keyA = idempotencyGuardService.createGuardKey([
    'student_save',
    '900000',
    'STU_1',
    { b: 2, a: 1, nested: { y: '2', x: '1' } }
  ]);
  const keyB = idempotencyGuardService.createGuardKey([
    'student_save',
    '900000',
    'STU_1',
    { nested: { x: '1', y: '2' }, a: 1, b: 2 }
  ]);

  assert.equal(keyA, keyB);
});

test('idempotency guard returns busy while running and replay after complete', () => {
  const key = idempotencyGuardService.createGuardKey(['term_approve', 'ORG_A', 'REG_1']);

  const acquired = idempotencyGuardService.beginGuard({
    key,
    runningTtlMs: 5000,
    replayTtlMs: 5000
  });
  assert.equal(acquired.status, 'acquired');

  const busy = idempotencyGuardService.beginGuard({
    key,
    runningTtlMs: 5000,
    replayTtlMs: 5000
  });
  assert.equal(busy.status, 'busy');
  assert.ok(Number(busy.retryAfterMs) > 0);

  const payload = { status: 'success', message: 'Approved.' };
  idempotencyGuardService.completeGuard(key, payload);

  const replay = idempotencyGuardService.beginGuard({
    key,
    runningTtlMs: 5000,
    replayTtlMs: 5000
  });
  assert.equal(replay.status, 'replay');
  assert.deepEqual(replay.payload, payload);
});

test('idempotency guard fail releases lock so next call can acquire', () => {
  const key = idempotencyGuardService.createGuardKey(['class_edit', 'ORG_B', 'CLS_5']);

  const acquired = idempotencyGuardService.beginGuard({
    key,
    runningTtlMs: 5000,
    replayTtlMs: 1000
  });
  assert.equal(acquired.status, 'acquired');

  idempotencyGuardService.failGuard(key);

  const reacquired = idempotencyGuardService.beginGuard({
    key,
    runningTtlMs: 5000,
    replayTtlMs: 1000
  });
  assert.equal(reacquired.status, 'acquired');
});

test('idempotency guard replay expires and key becomes acquirable again', async () => {
  const key = idempotencyGuardService.createGuardKey(['transactions_post', 'ORG_C', 'JRN_11']);

  const acquired = idempotencyGuardService.beginGuard({
    key,
    runningTtlMs: 1000,
    replayTtlMs: 30
  });
  assert.equal(acquired.status, 'acquired');

  idempotencyGuardService.completeGuard(key, { status: 'success', message: 'Posted.' });
  const replay = idempotencyGuardService.beginGuard({
    key,
    runningTtlMs: 1000,
    replayTtlMs: 30
  });
  assert.equal(replay.status, 'replay');

  await sleep(50);

  const reacquired = idempotencyGuardService.beginGuard({
    key,
    runningTtlMs: 1000,
    replayTtlMs: 30
  });
  assert.equal(reacquired.status, 'acquired');
});

