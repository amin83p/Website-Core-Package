'use strict';

const { requireCoreModule } = require('./schoolCoreModuleResolver');
const startupLogger = requireCoreModule('MVC/utils/startupLogger');
const sessionNotificationJob = require('./sessionNotificationJob');

let _timer = null;
let _isRunning = false;

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

async function runPass(options = {}) {
  if (_isRunning) return null;
  _isRunning = true;
  try {
    return await sessionNotificationJob.runNotificationPass(options);
  } catch (error) {
    startupLogger.warn('SCHOOL', 'SESSION_NOTIFICATION', 'Scheduler pass failed.', {
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
    options?.enabled ?? process.env.SCHOOL_SESSION_NOTIFICATION_JOB_ENABLED,
    true
  );
  if (!enabled) {
    startupLogger.info('SCHOOL', 'SESSION_NOTIFICATION', 'Scheduler disabled.');
    return;
  }

  const everyMinutes = parsePositiveInt(
    options?.intervalMinutes ?? process.env.SCHOOL_SESSION_NOTIFICATION_JOB_MINUTES,
    60
  );
  _timer = setInterval(() => {
    runPass(options).catch(() => null);
  }, everyMinutes * 60 * 1000);
  if (typeof _timer.unref === 'function') _timer.unref();

  startupLogger.success('SCHOOL', 'SESSION_NOTIFICATION', 'Scheduler started.', {
    intervalMinutes: everyMinutes
  });
}

function stop() {
  if (!_timer) return;
  clearInterval(_timer);
  _timer = null;
  startupLogger.info('SCHOOL', 'SESSION_NOTIFICATION', 'Scheduler stopped.');
}

module.exports = {
  start,
  stop,
  runPass
};
