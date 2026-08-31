const test = require('node:test');
const assert = require('node:assert/strict');

const scheduledTaskOrchestratorService = require('../MVC/services/scheduledTaskOrchestratorService');
const scheduledTaskDefinitionRepository = require('../MVC/repositories/scheduledTaskDefinitionRepository');
const scheduledTaskRunRepository = require('../MVC/repositories/scheduledTaskRunRepository');
const {
  registerCoreScheduledTaskHandler,
  clearScheduledTaskHandlersForTests
} = require('../MVC/services/scheduledTaskRegistry');

const originalList = scheduledTaskDefinitionRepository.list;
const originalGetById = scheduledTaskDefinitionRepository.getById;
const originalUpdateDefinition = scheduledTaskDefinitionRepository.update;
const originalCreateRun = scheduledTaskRunRepository.create;
const originalUpdateRun = scheduledTaskRunRepository.update;

test.beforeEach(() => {
  clearScheduledTaskHandlersForTests();
});

test.after(() => {
  clearScheduledTaskHandlersForTests();
  scheduledTaskDefinitionRepository.list = originalList;
  scheduledTaskDefinitionRepository.getById = originalGetById;
  scheduledTaskDefinitionRepository.update = originalUpdateDefinition;
  scheduledTaskRunRepository.create = originalCreateRun;
  scheduledTaskRunRepository.update = originalUpdateRun;
});

test('executeDefinition runs registered handler and records succeeded run', async () => {
  registerCoreScheduledTaskHandler({
    taskKey: 'core.test.run',
    handler: async () => ({
      resultSummary: 'Prepared 2 email(s).',
      metrics: { prepared: 2 }
    })
  });

  const now = new Date('2026-08-30T18:00:00.000Z');
  let runPayload = null;
  scheduledTaskRunRepository.create = async (payload) => {
    runPayload = payload;
    return { id: 'RUN_1', ...payload };
  };
  scheduledTaskRunRepository.update = async (id, patch) => ({ id, ...runPayload, ...patch });
  scheduledTaskDefinitionRepository.update = async () => ({ id: 'DEF_1' });

  const { run, result } = await scheduledTaskOrchestratorService.executeDefinition({
    id: 'DEF_1',
    taskKey: 'core.test.run',
    orgId: '',
    packageName: 'CORE',
    nextRunAt: now.toISOString()
  }, { now });

  assert.equal(run.status, 'succeeded');
  assert.equal(run.resultSummary, 'Prepared 2 email(s).');
  assert.deepEqual(result.metrics, { prepared: 2 });
});

test('executeDefinition throws when handler is missing', async () => {
  scheduledTaskRunRepository.create = async (payload) => ({ id: 'RUN_2', ...payload });
  scheduledTaskRunRepository.update = async (id, patch) => ({ id, status: patch.status });
  scheduledTaskDefinitionRepository.update = async () => ({ id: 'DEF_2' });

  await assert.rejects(
    () => scheduledTaskOrchestratorService.executeDefinition({
      id: 'DEF_2',
      taskKey: 'core.missing.handler',
      nextRunAt: new Date().toISOString()
    }),
    /No handler registered/i
  );
});

test('runDueTasks skips paused definitions via due query filter', async () => {
  const dueNow = new Date('2026-08-30T18:00:00.000Z');
  scheduledTaskDefinitionRepository.list = async ({ query } = {}) => {
    assert.equal(query.enabled__eq, true);
    assert.equal(query.paused__eq, false);
    assert.equal(query.nextRunAt__lte, dueNow.toISOString());
    return [];
  };

  const outcome = await scheduledTaskOrchestratorService.runDueTasks({ now: dueNow });
  assert.equal(outcome.dueCount, 0);
  assert.deepEqual(outcome.results, []);
});

test('runDueTasks executes definitions due by nextRunAt__lte', async () => {
  const { applyGenericFilter } = require('../MVC/utils/queryEngine');
  const dueNow = new Date('2026-08-30T18:00:00.000Z');
  const definitions = [{
    id: 'DEF_DUE',
    taskKey: 'core.test.due',
    orgId: '',
    packageName: 'CORE',
    enabled: true,
    paused: false,
    nextRunAt: '2026-08-30T17:30:00.000Z'
  }];

  registerCoreScheduledTaskHandler({
    taskKey: 'core.test.due',
    handler: async () => ({ resultSummary: 'Due task executed.' })
  });

  scheduledTaskDefinitionRepository.list = async ({ query } = {}) => applyGenericFilter(definitions, query, {
    defaultSearchFields: ['id', 'orgId', 'packageName', 'taskKey', 'label', 'source', 'sourceRef'],
    dateFields: ['nextRunAt', 'lastRunAt', 'createdAt', 'updatedAt']
  });
  scheduledTaskRunRepository.create = async (payload) => ({ id: 'RUN_DUE', ...payload });
  scheduledTaskRunRepository.update = async (id, patch) => ({ id, status: patch.status, resultSummary: patch.resultSummary });
  scheduledTaskDefinitionRepository.update = async () => ({ id: 'DEF_DUE' });

  const outcome = await scheduledTaskOrchestratorService.runDueTasks({ now: dueNow });
  assert.equal(outcome.dueCount, 1);
  assert.equal(outcome.results[0].status, 'succeeded');
  assert.equal(outcome.results[0].taskKey, 'core.test.due');
});
