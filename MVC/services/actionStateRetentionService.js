const actionStateRepository = require('../repositories/actionStateRepository');
const startupLogger = require('../utils/startupLogger');

let _timer = null;
let _isRunning = false;

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'y'].includes(token)) return true;
  if (['0', 'false', 'no', 'off', 'n'].includes(token)) return false;
  return fallback;
}

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

async function runCleanupPass(options = {}) {
  if (_isRunning) return null;
  _isRunning = true;

  const backfillLimit = parsePositiveInt(
    options?.backfillLimit ?? process.env.ACTION_STATE_RETENTION_BACKFILL_LIMIT,
    500
  );

  try {
    const [backfilled, deleted] = await Promise.all([
      actionStateRepository.backfillMissingRetention({ limit: backfillLimit }),
      actionStateRepository.deleteExpiredByRetention()
    ]);

    startupLogger.info('ACTIONSTATE', 'RETENTION', 'Cleanup pass completed.', {
      backfilled: Number(backfilled || 0),
      deleted: Number(deleted || 0)
    });

    return {
      backfilled: Number(backfilled || 0),
      deleted: Number(deleted || 0)
    };
  } catch (error) {
    startupLogger.warn('ACTIONSTATE', 'RETENTION', 'Cleanup pass failed.', { error: error.message });
    return null;
  } finally {
    _isRunning = false;
  }
}

function start(options = {}) {
  if (_timer) return;

  const enabled = parseBoolean(
    options?.enabled ?? process.env.ACTION_STATE_RETENTION_CLEANUP_ENABLED,
    true
  );
  if (!enabled) {
    startupLogger.info('ACTIONSTATE', 'RETENTION', 'Cleanup scheduler disabled.');
    return;
  }

  const everyMinutes = parsePositiveInt(
    options?.intervalMinutes ?? process.env.ACTION_STATE_RETENTION_CLEANUP_MINUTES,
    30
  );
  const runOnStart = parseBoolean(
    options?.runOnStart ?? process.env.ACTION_STATE_RETENTION_RUN_ON_START,
    true
  );

  _timer = setInterval(() => {
    runCleanupPass(options).catch(() => null);
  }, everyMinutes * 60 * 1000);
  if (typeof _timer.unref === 'function') _timer.unref();

  startupLogger.success('ACTIONSTATE', 'RETENTION', 'Cleanup scheduler started.', {
    intervalMinutes: everyMinutes
  });

  if (runOnStart) {
    runCleanupPass(options).catch(() => null);
  }
}

function stop() {
  if (!_timer) return;
  clearInterval(_timer);
  _timer = null;
  startupLogger.info('ACTIONSTATE', 'RETENTION', 'Cleanup scheduler stopped.');
}

module.exports = {
  start,
  stop,
  runCleanupPass
};

