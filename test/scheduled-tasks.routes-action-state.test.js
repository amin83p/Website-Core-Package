const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const routesPath = path.join(__dirname, '../MVC/routes/scheduledTaskRoutes.js');
const source = fs.readFileSync(routesPath, 'utf8');

test('scheduled task mutation routes allow operation token fallback from list page tokens', () => {
  assert.match(source, /scheduledTaskMutationActionState = Object\.freeze\(\{[\s\S]*allowOperationTokenFallback:\s*true[\s\S]*\}\)/);
  assert.match(source, /run-now[\s\S]*scheduledTaskMutationActionState/);
  assert.match(source, /next-run[\s\S]*scheduledTaskMutationActionState/);
  assert.match(source, /outbox\/:id\/cancel[\s\S]*scheduledTaskMutationActionState/);
  assert.match(source, /outbox\/bulk-cancel[\s\S]*scheduledTaskMutationActionState/);
  assert.match(source, /outbox\/bulk-delete[\s\S]*scheduledTaskMutationActionState/);
  assert.match(source, /definitions\/:id\/delete[\s\S]*allowOperationTokenFallback:\s*true/);
});

test('upsertDefinition preserves manual nextRunAt when schedule fields are unchanged', async () => {
  const scheduledTaskDefinitionService = require('../MVC/services/scheduledTaskDefinitionService');
  const scheduledTaskDefinitionRepository = require('../MVC/repositories/scheduledTaskDefinitionRepository');
  const originalList = scheduledTaskDefinitionRepository.list;
  const originalUpdate = scheduledTaskDefinitionRepository.update;

  let updatedPayload = null;
  scheduledTaskDefinitionRepository.list = async () => ([{
    id: 'STD_1',
    orgId: '900000',
    taskKey: 'school.uncompletedSessionEmail.prepare',
    source: 'school.sessionAccessPolicy',
    sourceRef: '900000:email:prepare',
    scheduleType: 'daily',
    runAtTime: '23:25',
    timezone: 'UTC',
    nextRunAt: '2026-08-30T01:35:00.000Z',
    input: { sendWhen: 'daily_all' }
  }]);
  scheduledTaskDefinitionRepository.update = async (id, payload) => {
    updatedPayload = payload;
    return { id, ...payload };
  };

  try {
    await scheduledTaskDefinitionService.upsertDefinition({
      orgId: '900000',
      packageName: 'SCHOOL',
      taskKey: 'school.uncompletedSessionEmail.prepare',
      label: 'Prepare uncompleted session emails',
      scheduleType: 'daily',
      runAtTime: '23:25',
      timezone: 'UTC',
      enabled: true,
      paused: false,
      source: 'school.sessionAccessPolicy',
      sourceRef: '900000:email:prepare',
      input: { sendWhen: 'daily_all', prepareAtTime: '23:25', sendAtTime: '12:11' }
    });
    assert.equal(updatedPayload.nextRunAt, '2026-08-30T01:35:00.000Z');
  } finally {
    scheduledTaskDefinitionRepository.list = originalList;
    scheduledTaskDefinitionRepository.update = originalUpdate;
  }
});

test('upsertDefinition preserves nextRunAt when only timezone changes', async () => {
  const scheduledTaskDefinitionService = require('../MVC/services/scheduledTaskDefinitionService');
  const scheduledTaskDefinitionRepository = require('../MVC/repositories/scheduledTaskDefinitionRepository');
  const originalList = scheduledTaskDefinitionRepository.list;
  const originalUpdate = scheduledTaskDefinitionRepository.update;

  let updatedPayload = null;
  scheduledTaskDefinitionRepository.list = async () => ([{
    id: 'STD_1',
    orgId: '900000',
    taskKey: 'school.uncompletedSessionEmail.prepare',
    source: 'school.sessionAccessPolicy',
    sourceRef: '900000:email:prepare',
    scheduleType: 'daily',
    runAtTime: '23:25',
    timezone: 'UTC',
    nextRunAt: '2026-08-30T07:54:00.000Z',
    input: { sendWhen: 'daily_all' }
  }]);
  scheduledTaskDefinitionRepository.update = async (id, payload) => {
    updatedPayload = payload;
    return { id, ...payload };
  };

  try {
    await scheduledTaskDefinitionService.upsertDefinition({
      orgId: '900000',
      packageName: 'SCHOOL',
      taskKey: 'school.uncompletedSessionEmail.prepare',
      label: 'Prepare uncompleted session emails',
      scheduleType: 'daily',
      runAtTime: '23:25',
      timezone: 'America/Edmonton',
      enabled: true,
      paused: false,
      source: 'school.sessionAccessPolicy',
      sourceRef: '900000:email:prepare',
      input: { sendWhen: 'daily_all', prepareAtTime: '23:25', sendAtTime: '12:11' }
    });
    assert.equal(updatedPayload.nextRunAt, '2026-08-30T07:54:00.000Z');
    assert.equal(updatedPayload.timezone, 'America/Edmonton');
  } finally {
    scheduledTaskDefinitionRepository.list = originalList;
    scheduledTaskDefinitionRepository.update = originalUpdate;
  }
});

test('upsertDefinition recomputes nextRunAt when runAtTime changes', async () => {
  const scheduledTaskDefinitionService = require('../MVC/services/scheduledTaskDefinitionService');
  const scheduledTaskDefinitionRepository = require('../MVC/repositories/scheduledTaskDefinitionRepository');
  const originalList = scheduledTaskDefinitionRepository.list;
  const originalUpdate = scheduledTaskDefinitionRepository.update;

  let updatedPayload = null;
  scheduledTaskDefinitionRepository.list = async () => ([{
    id: 'STD_1',
    orgId: '900000',
    taskKey: 'school.uncompletedSessionEmail.prepare',
    source: 'school.sessionAccessPolicy',
    sourceRef: '900000:email:prepare',
    scheduleType: 'daily',
    runAtTime: '23:25',
    timezone: 'UTC',
    nextRunAt: '2026-08-30T01:35:00.000Z',
    input: {}
  }]);
  scheduledTaskDefinitionRepository.update = async (id, payload) => {
    updatedPayload = payload;
    return { id, ...payload };
  };

  try {
    await scheduledTaskDefinitionService.upsertDefinition({
      orgId: '900000',
      packageName: 'SCHOOL',
      taskKey: 'school.uncompletedSessionEmail.prepare',
      scheduleType: 'daily',
      runAtTime: '02:00',
      timezone: 'UTC',
      enabled: true,
      source: 'school.sessionAccessPolicy',
      sourceRef: '900000:email:prepare',
      input: {}
    });
    assert.notEqual(updatedPayload.nextRunAt, '2026-08-30T01:35:00.000Z');
    assert.ok(updatedPayload.nextRunAt);
  } finally {
    scheduledTaskDefinitionRepository.list = originalList;
    scheduledTaskDefinitionRepository.update = originalUpdate;
  }
});

test('setNextRunAt updates only nextRunAt without recomputing schedule fields', async () => {
  const scheduledTaskDefinitionService = require('../MVC/services/scheduledTaskDefinitionService');
  const scheduledTaskDefinitionRepository = require('../MVC/repositories/scheduledTaskDefinitionRepository');
  const originalGetById = scheduledTaskDefinitionRepository.getById;
  const originalUpdate = scheduledTaskDefinitionRepository.update;

  let updatedPayload = null;
  scheduledTaskDefinitionRepository.getById = async () => ({
    id: 'STD_1',
    orgId: 'ORG_1',
    taskKey: 'school.uncompletedSessionEmail.prepare',
    scheduleType: 'daily',
    runAtTime: '02:00',
    timezone: 'America/New_York',
    nextRunAt: '2026-08-30T06:00:00.000Z'
  });
  scheduledTaskDefinitionRepository.update = async (id, payload) => {
    updatedPayload = payload;
    return { id, ...payload };
  };

  try {
    const row = await scheduledTaskDefinitionService.setNextRunAt('STD_1', '2026-08-31T08:30', {
      timezone: 'America/New_York'
    });
    assert.ok(row.nextRunAt);
    assert.equal(updatedPayload.runAtTime, undefined);
    assert.equal(updatedPayload.timezone, 'America/New_York');
    assert.match(row.nextRunAt, /2026-08-31T12:30:00\.000Z/);
  } finally {
    scheduledTaskDefinitionRepository.getById = originalGetById;
    scheduledTaskDefinitionRepository.update = originalUpdate;
  }
});

test('setNextRunAt prefers settings timezone over stale definition timezone', async () => {
  const scheduledTaskDefinitionService = require('../MVC/services/scheduledTaskDefinitionService');
  const scheduledTaskDefinitionRepository = require('../MVC/repositories/scheduledTaskDefinitionRepository');
  const originalGetById = scheduledTaskDefinitionRepository.getById;
  const originalUpdate = scheduledTaskDefinitionRepository.update;

  let updatedPayload = null;
  scheduledTaskDefinitionRepository.getById = async () => ({
    id: 'STD_1',
    orgId: '900000',
    taskKey: 'school.uncompletedSessionEmail.prepare',
    scheduleType: 'daily',
    runAtTime: '23:25',
    timezone: 'UTC',
    nextRunAt: '2026-08-30T06:00:00.000Z'
  });
  scheduledTaskDefinitionRepository.update = async (id, payload) => {
    updatedPayload = payload;
    return { id, ...payload };
  };

  try {
    const row = await scheduledTaskDefinitionService.setNextRunAt('STD_1', '2026-08-31T08:30', {
      timezone: 'America/New_York'
    });
    assert.equal(updatedPayload.timezone, 'America/New_York');
    assert.match(row.nextRunAt, /2026-08-31T12:30:00\.000Z/);
  } finally {
    scheduledTaskDefinitionRepository.getById = originalGetById;
    scheduledTaskDefinitionRepository.update = originalUpdate;
  }
});
