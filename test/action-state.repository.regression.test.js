const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const actionStateRepository = require('../MVC/repositories/actionStateRepository');

const ACTION_STATE_JSON_PATH = path.join(__dirname, '..', 'data', 'actionStates.json');
const ORIGINAL_ACTION_STATE_JSON = fs.existsSync(ACTION_STATE_JSON_PATH)
  ? fs.readFileSync(ACTION_STATE_JSON_PATH, 'utf8')
  : '[]';

function resetActionStateFixture() {
  fs.writeFileSync(ACTION_STATE_JSON_PATH, ORIGINAL_ACTION_STATE_JSON, 'utf8');
}

function buildRunToken() {
  return `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function setActionStateTimesById(id, isoString) {
  const rows = JSON.parse(fs.readFileSync(ACTION_STATE_JSON_PATH, 'utf8'));
  const nextRows = rows.map((row) => {
    if (String(row?.id || '') !== String(id || '')) return row;
    const next = {
      ...row,
      startedAt: isoString,
      createdAt: isoString,
      updatedAt: isoString,
      lastActiveAt: isoString
    };
    if (Array.isArray(next.history)) {
      next.history = next.history.map((entry) => ({ ...entry, ts: isoString }));
    }
    return next;
  });
  fs.writeFileSync(ACTION_STATE_JSON_PATH, JSON.stringify(nextRows, null, 2), 'utf8');
}

test.afterEach(() => {
  resetActionStateFixture();
});

test('action-state token reuse stays on same state and blocks mismatched user', async () => {
  resetActionStateFixture();

  const run = buildRunToken();
  const userId = `USR_REUSE_${run}`;
  const sectionId = `SEC_REUSE_${run}`;
  const operationId = `OP_REUSE_${run}`;
  const targetKey = `TARGET_REUSE_${run}`;
  const context = { method: 'POST', url: '/test/reuse', requestId: `REQ_REUSE_${run}` };
  const limits = { maxAttempts: 5, maxTimeMinutes: 30, maxVolumeKB: 1024 };

  const first = await actionStateRepository.logAttempt(
    userId,
    sectionId,
    operationId,
    targetKey,
    limits,
    null,
    context,
    { backendMode: 'json' }
  );

  const reused = await actionStateRepository.logAttempt(
    userId,
    sectionId,
    operationId,
    targetKey,
    limits,
    first.id,
    context,
    { backendMode: 'json' }
  );

  let mismatchMessage = '';
  try {
    await actionStateRepository.logAttempt(
      `OTHER_${run}`,
      sectionId,
      operationId,
      targetKey,
      limits,
      first.id,
      context,
      { backendMode: 'json' }
    );
  } catch (error) {
    mismatchMessage = String(error?.message || error || '');
  }

  assert.equal(reused.id, first.id);
  assert.equal(Number(reused.attemptCount || 0), Number(first.attemptCount || 0) + 1);
  assert.match(mismatchMessage, /user mismatch/i);
});

test('action-state date range filter includes local-today rows and excludes yesterday rows', async () => {
  resetActionStateFixture();

  const run = buildRunToken();
  const userId = `USR_DATE_${run}`;
  const sectionId = `SEC_DATE_${run}`;
  const operationId = `OP_DATE_${run}`;
  const context = { method: 'GET', url: '/test/date', requestId: `REQ_DATE_${run}` };
  const limits = { maxAttempts: 5, maxTimeMinutes: 30, maxVolumeKB: 1024 };

  const todayRow = await actionStateRepository.logAttempt(
    userId,
    sectionId,
    operationId,
    `TARGET_DATE_TODAY_${run}`,
    limits,
    null,
    context,
    { backendMode: 'json' }
  );
  const yesterdayRow = await actionStateRepository.logAttempt(
    userId,
    sectionId,
    operationId,
    `TARGET_DATE_YESTERDAY_${run}`,
    limits,
    null,
    context,
    { backendMode: 'json' }
  );

  const todayLocal = new Date();
  todayLocal.setHours(12, 0, 0, 0);
  const yesterdayLocal = new Date(todayLocal);
  yesterdayLocal.setDate(yesterdayLocal.getDate() - 1);

  setActionStateTimesById(todayRow.id, todayLocal.toISOString());
  setActionStateTimesById(yesterdayRow.id, yesterdayLocal.toISOString());

  const today = toLocalDateString(todayLocal);
  const yesterday = toLocalDateString(yesterdayLocal);

  const todayRows = await actionStateRepository.list({
    backendMode: 'json',
    query: { userId, startDate: today, endDate: today }
  });
  const yesterdayRows = await actionStateRepository.list({
    backendMode: 'json',
    query: { userId, startDate: yesterday, endDate: yesterday }
  });

  const todayIds = (Array.isArray(todayRows) ? todayRows : []).map((row) => row.id);
  const yesterdayIds = (Array.isArray(yesterdayRows) ? yesterdayRows : []).map((row) => row.id);

  assert.ok(todayIds.includes(todayRow.id));
  assert.ok(!todayIds.includes(yesterdayRow.id));
  assert.ok(yesterdayIds.includes(yesterdayRow.id));
  assert.ok(!yesterdayIds.includes(todayRow.id));
});

test('action-state cancel cancels active state but does not change completed state', async () => {
  resetActionStateFixture();

  const run = buildRunToken();
  const userId = `USR_CANCEL_${run}`;
  const sectionId = `SEC_CANCEL_${run}`;
  const operationId = `OP_CANCEL_${run}`;
  const context = { method: 'POST', url: '/test/cancel', requestId: `REQ_CANCEL_${run}` };
  const limits = { maxAttempts: 5, maxTimeMinutes: 30, maxVolumeKB: 1024 };

  const activeRow = await actionStateRepository.logAttempt(
    userId,
    sectionId,
    operationId,
    `TARGET_CANCEL_ACTIVE_${run}`,
    limits,
    null,
    context,
    { backendMode: 'json' }
  );
  await actionStateRepository.cancelState(activeRow.id, { backendMode: 'json' });
  const activeAfterCancel = await actionStateRepository.getById(activeRow.id, { backendMode: 'json' });
  assert.equal(activeAfterCancel?.status, 'cancelled');

  const completedRow = await actionStateRepository.logAttempt(
    userId,
    sectionId,
    operationId,
    `TARGET_CANCEL_COMPLETED_${run}`,
    limits,
    null,
    context,
    { backendMode: 'json' }
  );
  await actionStateRepository.completeState(
    completedRow.id,
    { ok: true },
    1.25,
    context,
    { backendMode: 'json' }
  );
  const completedBeforeCancel = await actionStateRepository.getById(completedRow.id, { backendMode: 'json' });
  await actionStateRepository.cancelState(completedRow.id, { backendMode: 'json' });
  const completedAfterCancel = await actionStateRepository.getById(completedRow.id, { backendMode: 'json' });

  assert.equal(completedBeforeCancel?.status, 'completed');
  assert.equal(completedAfterCancel?.status, 'completed');
});
