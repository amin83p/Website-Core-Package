'use strict';

const startupLogger = require('../utils/startupLogger');
const scheduledTaskOrchestratorService = require('./scheduledTaskOrchestratorService');
const { bootstrapCoreScheduledTaskDefinitions } = require('./coreScheduledTaskRegistration');

let _timer = null;
let _isRunning = false;
let _bootstrapped = false;

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'off'].includes(token)) return false;
  return fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

async function ensureBootstrapped(options = {}) {
  if (_bootstrapped) return;
  await bootstrapCoreScheduledTaskDefinitions(options);
  _bootstrapped = true;
}

async function runPass(options = {}) {
  if (_isRunning) return null;
  _isRunning = true;
  try {
    await ensureBootstrapped(options);
    return await scheduledTaskOrchestratorService.runDueTasks(options);
  } catch (error) {
    startupLogger.warn('SCHEDULED_TASKS', 'TICK', 'Scheduler pass failed.', {
      error: error?.message || String(error)
    });
    return null;
  } finally {
    _isRunning = false;
  }
}

function start(options = {}) {
  if (_timer) return;
  const enabled = parseBoolean(
    options?.enabled ?? process.env.SCHEDULED_TASK_SCHEDULER_ENABLED,
    true
  );
  if (!enabled) {
    startupLogger.info('SCHEDULED_TASKS', 'TICK', 'Scheduler disabled.');
    return;
  }

  const everyMinutes = parsePositiveInt(
    options?.intervalMinutes ?? process.env.SCHEDULED_TASK_TICK_MINUTES,
    5
  );

  ensureBootstrapped(options).catch(() => null);

  _timer = setInterval(() => {
    runPass(options).catch(() => null);
  }, everyMinutes * 60 * 1000);
  if (typeof _timer.unref === 'function') _timer.unref();

  runPass(options).catch(() => null);

  startupLogger.success('SCHEDULED_TASKS', 'TICK', 'Scheduler started.', {
    intervalMinutes: everyMinutes
  });
}

function stop() {
  if (!_timer) return;
  clearInterval(_timer);
  _timer = null;
  startupLogger.info('SCHEDULED_TASKS', 'TICK', 'Scheduler stopped.');
}

module.exports = {
  start,
  stop,
  runPass,
  ensureBootstrapped
};
