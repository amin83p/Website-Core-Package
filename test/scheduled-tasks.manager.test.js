const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readRoot(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('scheduled task definition model preserves createdBy fields', () => {
  const model = require('../MVC/models/scheduledTaskDefinitionModel');
  const normalized = model.normalizeScheduledTaskDefinition({
    taskKey: 'core.emailOutbox.dispatch',
    label: 'Dispatch emails',
    createdByUserId: 'USR-1',
    createdByDisplayName: 'Alex Admin'
  }, null, { strict: false });

  assert.equal(normalized.createdByUserId, 'USR-1');
  assert.equal(normalized.createdByDisplayName, 'Alex Admin');
});

test('scheduled task run model preserves organizedBy fields', () => {
  const model = require('../MVC/models/scheduledTaskRunModel');
  const normalized = model.normalizeScheduledTaskRun({
    taskKey: 'core.emailOutbox.dispatch',
    organizedByUserId: 'USR-2',
    organizedByDisplayName: 'Sam Scheduler'
  });

  assert.equal(normalized.organizedByUserId, 'USR-2');
  assert.equal(normalized.organizedByDisplayName, 'Sam Scheduler');
});

test('scheduled task actor utils resolves user and organizer fields', () => {
  const actorUtils = require('../MVC/utils/scheduledTaskActorUtils');
  const actor = actorUtils.resolveActorFromUser({
    id: 'USR-9',
    name: { first: 'Pat', last: 'Lee' }
  });
  assert.equal(actor.userId, 'USR-9');
  assert.equal(actor.displayName, 'Pat Lee');

  const organizer = actorUtils.resolveOrganizerFields({
    createdByUserId: 'USR-1',
    createdByDisplayName: 'Alex'
  });
  assert.equal(organizer.organizedByUserId, 'USR-1');
  assert.equal(organizer.organizedByDisplayName, 'Alex');
});

test('manager service formats remaining and duration labels', () => {
  const managerService = require('../MVC/services/scheduledTaskManagerService');
  assert.equal(managerService.formatRemainingLabel(30 * 60 * 1000), 'in 30m');
  assert.equal(managerService.formatDurationMs(65000), '1m 5s');
});

test('manager service builds upcoming and completed windows', async () => {
  const managerService = require('../MVC/services/scheduledTaskManagerService');
  const definitionService = require('../MVC/services/scheduledTaskDefinitionService');
  const runService = require('../MVC/services/scheduledTaskRunService');

  const now = new Date('2026-08-31T18:00:00.000Z');
  const originalListDefinitions = definitionService.listDefinitions;
  const originalListRuns = runService.listRuns;

  definitionService.listDefinitions = async (query = {}) => {
    if (query.id__in) {
      return [{
        id: 'STDEF-1',
        label: 'Dispatch emails',
        taskKey: 'core.emailOutbox.dispatch',
        createdByUserId: 'USR-1',
        createdByDisplayName: 'Alex'
      }];
    }
    return [{
      id: 'STDEF-1',
      label: 'Dispatch emails',
      taskKey: 'core.emailOutbox.dispatch',
      nextRunAt: '2026-08-31T20:00:00.000Z',
      createdByUserId: 'USR-1',
      createdByDisplayName: 'Alex'
    }];
  };

  let runQueryCount = 0;
  runService.listRuns = async (query = {}) => {
    runQueryCount += 1;
    if (query.finishedAt__gte) {
      return [{
        id: 'STRUN-1',
        definitionId: 'STDEF-1',
        taskKey: 'core.emailOutbox.dispatch',
        status: 'succeeded',
        scheduledFor: '2026-08-31T17:30:00.000Z',
        startedAt: '2026-08-31T17:30:00.000Z',
        finishedAt: '2026-08-31T17:31:00.000Z',
        resultSummary: 'Sent 3 emails.',
        organizedByUserId: 'USR-1',
        organizedByDisplayName: 'Alex'
      }];
    }
    return [{
      id: 'STRUN-2',
      definitionId: 'STDEF-2',
      taskKey: 'core.smsOutbox.dispatch',
      status: 'pending',
      scheduledFor: '2026-08-31T19:00:00.000Z',
      organizedByUserId: 'SYSTEM',
      organizedByDisplayName: 'System'
    }];
  };

  try {
    const payload = await managerService.getManagerWindow(
      { id: 'USR-1', allowedOrgs: [{ orgId: 'ORG-1', name: 'Acme' }] },
      { now, windowHours: 24 }
    );

    assert.equal(runQueryCount, 2);
    assert.equal(payload.upcoming.length, 2);
    assert.equal(payload.completed.length, 1);
    assert.ok(payload.upcoming.some((row) => row.remainingLabel === 'in 2h'));
    assert.ok(payload.upcoming.some((row) => row.remainingLabel === 'in 1h'));
    assert.equal(payload.completed[0].resultSummary, 'Sent 3 emails.');
    assert.equal(payload.completed[0].organizedByDisplayName, 'Alex');
  } finally {
    definitionService.listDefinitions = originalListDefinitions;
    runService.listRuns = originalListRuns;
  }
});

test('orchestrator copies organizer fields from manual run actor onto runs', async () => {
  const orchestratorService = require('../MVC/services/scheduledTaskOrchestratorService');
  const definitionRepository = require('../MVC/repositories/scheduledTaskDefinitionRepository');
  const runRepository = require('../MVC/repositories/scheduledTaskRunRepository');
  const registry = require('../MVC/services/scheduledTaskRegistry');

  const originalGetById = definitionRepository.getById;
  const originalCreate = runRepository.create;
  const originalUpdate = runRepository.update;
  const originalDefinitionUpdate = definitionRepository.update;
  const originalGetHandler = registry.getScheduledTaskHandler;

  const taskKey = `test.manager.task.${Date.now()}`;
  registry.registerCoreScheduledTaskHandler({
    taskKey,
    label: 'Test manager task',
    handler: async () => ({ resultSummary: 'ok' })
  });

  definitionRepository.getById = async () => ({
    id: 'STDEF-9',
    taskKey,
    packageName: 'CORE',
    orgId: '',
    nextRunAt: '2026-08-31T18:00:00.000Z',
    createdByUserId: 'USR-55',
    createdByDisplayName: 'Organizer Pat'
  });
  definitionRepository.update = async (id, patch) => ({ id, ...patch });

  let createdRun = null;
  runRepository.create = async (payload) => {
    createdRun = payload;
    return { id: 'STRUN-9', ...payload };
  };
  runRepository.update = async (id, patch) => ({ id, ...createdRun, ...patch });

  try {
    await orchestratorService.runDefinitionNow('STDEF-9', {
      now: new Date('2026-08-31T18:00:00.000Z'),
      reqUser: { id: 'USR-99', name: { first: 'Manual', last: 'Runner' } }
    });
    assert.equal(createdRun.organizedByUserId, 'USR-99');
    assert.equal(createdRun.organizedByDisplayName, 'Manual Runner');
  } finally {
    definitionRepository.getById = originalGetById;
    definitionRepository.update = originalDefinitionUpdate;
    runRepository.create = originalCreate;
    runRepository.update = originalUpdate;
    if (originalGetHandler) registry.getScheduledTaskHandler = originalGetHandler;
  }
});

test('scheduled task manager routes and UI are registered', () => {
  const routes = readRoot('MVC/routes/scheduledTaskRoutes.js');
  const controller = readRoot('MVC/controllers/scheduledTaskController.js');
  const managerView = readRoot('MVC/views/scheduledTasks/manager.ejs');
  const header = readRoot('MVC/views/partials/header.ejs');
  const panelScript = readRoot('public/scripts/scheduledTaskManagerPanel.js');
  const loaderScript = readRoot('public/scripts/scheduledTaskManagerLoader.js');
  const seedScript = readRoot('scripts/seed-auto-scheduled-tasks-section.js');
  const accessConstants = readRoot('config/accessConstants.js');

  assert.match(routes, /\/api\/manager-window/);
  assert.match(routes, /\/manager/);
  assert.match(routes, /SCHEDULED_TASK_MANAGER/);
  assert.match(controller, /showManagerPage/);
  assert.match(controller, /getManagerWindow/);
  assert.match(managerView, /scheduledTaskManagerPanel/);
  assert.match(header, /scheduledTaskManagerHeaderTrigger/);
  assert.match(panelScript, /ScheduledTaskManagerPanel/);
  assert.match(loaderScript, /ScheduledTaskManagerLoader/);
  assert.match(seedScript, /SCHEDULED_TASK_MANAGER/);
  assert.match(accessConstants, /SCHEDULED_TASK_MANAGER/);
});
