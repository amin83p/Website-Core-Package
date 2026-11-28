const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readRoot(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('run export and purge routes are wired with access middleware', () => {
  const routes = readRoot('MVC/routes/scheduledTaskRoutes.js');
  assert.match(routes, /\/runs\/export[\s\S]*OPERATIONS\.EXPORT/);
  assert.match(routes, /\/runs\/purge-terminal[\s\S]*OPERATIONS\.DELETE/);
});

test('run export and purge routes require admin approval', () => {
  const routes = readRoot('MVC/routes/scheduledTaskRoutes.js');
  assert.match(routes, /\/runs\/export[\s\S]*adminApproval[\s\S]*ctrl\.exportRuns/);
  assert.match(routes, /\/runs\/purge-terminal[\s\S]*adminApproval[\s\S]*ctrl\.purgeTerminalRuns/);
  const runListView = readRoot('MVC/views/scheduledTasks/runList.ejs');
  assert.match(runListView, /requestProtectedAction/);
  assert.match(runListView, /optionalBtnsBeforePrint/);
  assert.match(runListView, /btn-filled btn-success[\s\S]*scheduledTaskRunExportBtn/);
  assert.match(runListView, /btn-filled btn-danger[\s\S]*scheduledTaskRunPurgeBtn/);
});

test('deleteTerminalRuns json keeps pending and running only', async () => {
  const repo = require('../MVC/repositories/scheduledTaskRunRepository');
  const model = require('../MVC/models/scheduledTaskRunModel');
  const originalGetAll = model.getAll;
  const originalSaveAll = model.saveAll;

  let saved = null;
  model.getAll = async () => ([
    { id: 'R1', status: 'succeeded', orgId: 'ORG_1' },
    { id: 'R2', status: 'failed', orgId: 'ORG_1' },
    { id: 'R3', status: 'pending', orgId: 'ORG_1' },
    { id: 'R4', status: 'running', orgId: 'ORG_1' },
    { id: 'R5', status: 'cancelled', orgId: 'ORG_2' }
  ]);
  model.saveAll = async (rows) => {
    saved = rows;
  };

  try {
    const result = await repo.deleteTerminalRuns({ backendMode: 'json', scope: { canViewAll: true } });
    assert.equal(result.deletedCount, 3);
    assert.equal(result.keptPending, 1);
    assert.equal(result.keptRunning, 1);
    assert.equal(saved.length, 2);
    assert.deepEqual(saved.map((row) => row.id).sort(), ['R3', 'R4']);
  } finally {
    model.getAll = originalGetAll;
    model.saveAll = originalSaveAll;
  }
});

test('export flatten includes expected CSV columns', async () => {
  const runService = require('../MVC/services/scheduledTaskRunService');
  const repo = require('../MVC/repositories/scheduledTaskRunRepository');
  const originalListAll = repo.listAllForQuery;

  repo.listAllForQuery = async () => ([{
    id: 'STRUN_1',
    taskKey: 'core.emailOutbox.dispatch',
    packageName: 'CORE',
    orgId: 'ORG_1',
    status: 'succeeded',
    scheduledFor: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:01.000Z',
    finishedAt: '2026-01-01T00:00:05.000Z',
    resultSummary: 'Sent 2 emails',
    errorMessage: '',
    organizedByDisplayName: 'Scheduler'
  }]);

  try {
    const { flatRows } = await runService.exportRuns({ sortBy: 'scheduledFor', sortDir: 'desc' });
    const csv = runService.runsToCsv(flatRows);
    assert.match(csv, /"id","taskKey","packageName","orgId","status"/);
    assert.match(csv, /STRUN_1/);
    assert.match(csv, /core\.emailOutbox\.dispatch/);
    assert.match(csv, /Sent 2 emails/);
  } finally {
    repo.listAllForQuery = originalListAll;
  }
});