'use strict';

const scheduledTaskDefinitionRepository = require('../repositories/scheduledTaskDefinitionRepository');
const scheduledTaskRunRepository = require('../repositories/scheduledTaskRunRepository');
const { getScheduledTaskHandler } = require('./scheduledTaskRegistry');
const { computeNextRunAt } = require('./scheduledTaskSchedulingUtils');

function cleanText(value) {
  return String(value || '').trim();
}

function buildRunLogger(runId = '') {
  const logs = [];
  return {
    logs,
    info(message) {
      logs.push({ level: 'info', message: cleanText(message).slice(0, 500), at: new Date().toISOString() });
    },
    error(message) {
      logs.push({ level: 'error', message: cleanText(message).slice(0, 500), at: new Date().toISOString() });
    }
  };
}

async function listDueDefinitions(now = new Date()) {
  const cutoff = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  return scheduledTaskDefinitionRepository.list({
    query: {
      enabled__eq: true,
      paused__eq: false,
      nextRunAt__lte: cutoff,
      page: 1,
      limit: 200,
      sortBy: 'nextRunAt',
      sortDir: 'asc'
    }
  });
}

async function executeDefinition(definition = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const taskKey = cleanText(definition.taskKey);
  const handlerDef = getScheduledTaskHandler(taskKey);
  if (!handlerDef) {
    throw new Error(`No handler registered for task '${taskKey}'.`);
  }

  const logger = buildRunLogger();
  const scheduledFor = cleanText(definition.nextRunAt) || new Date(now).toISOString();
  let run = await scheduledTaskRunRepository.create({
    definitionId: definition.id,
    orgId: definition.orgId || '',
    packageName: definition.packageName || handlerDef.packageName,
    taskKey,
    scheduledFor,
    startedAt: new Date().toISOString(),
    status: 'running',
    logs: []
  });

  try {
    const result = await handlerDef.handler({
      definition,
      orgId: cleanText(definition.orgId),
      input: definition.input || {},
      run,
      logger,
      now,
      prepareMode: cleanText(options.prepareMode || 'additive').toLowerCase() === 'replace' ? 'replace' : 'additive'
    });
    const metrics = result?.metrics && typeof result.metrics === 'object' ? result.metrics : {};
    const resultSummary = cleanText(result?.resultSummary || result?.summary || 'Completed successfully.');
    run = await scheduledTaskRunRepository.update(run.id, {
      status: 'succeeded',
      finishedAt: new Date().toISOString(),
      resultSummary,
      metrics,
      logs: logger.logs
    });
    return { run, result };
  } catch (error) {
    run = await scheduledTaskRunRepository.update(run.id, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      errorMessage: cleanText(error?.message || error).slice(0, 5000),
      logs: logger.logs
    });
    throw error;
  } finally {
    const nextRunAt = computeNextRunAt(definition, now);
    await scheduledTaskDefinitionRepository.update(definition.id, {
      lastRunAt: new Date(now).toISOString(),
      nextRunAt
    });
  }
}

const scheduledTaskOrchestratorService = {
  async runDueTasks(options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const dueDefinitions = await listDueDefinitions(now);
    const results = [];

    for (const definition of dueDefinitions) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const outcome = await executeDefinition(definition, { now });
        results.push({ definitionId: definition.id, taskKey: definition.taskKey, status: 'succeeded', runId: outcome.run?.id });
      } catch (error) {
        results.push({
          definitionId: definition.id,
          taskKey: definition.taskKey,
          status: 'failed',
          error: cleanText(error?.message || error)
        });
      }
    }

    return {
      dueCount: dueDefinitions.length,
      results
    };
  },

  async runDefinitionNow(definitionId, options = {}) {
    const definition = await scheduledTaskDefinitionRepository.getById(definitionId, options);
    if (!definition) throw new Error('Scheduled task definition not found.');
    return executeDefinition(definition, {
      now: options.now || new Date(),
      prepareMode: options.prepareMode
    });
  },

  listDueDefinitions,
  executeDefinition
};

module.exports = scheduledTaskOrchestratorService;
