const startupLogger = require('../utils/startupLogger');

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2000;
const DEFAULT_RESTART_DELAY_MS = 250;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'y'].includes(token)) return true;
  if (['0', 'false', 'no', 'off', 'n'].includes(token)) return false;
  return fallback;
}

function readPositiveInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function evaluateRestartPermission(env = process.env) {
  const allowed = parseBoolean(env.ALLOW_IN_APP_APPLICATION_RESTART, false);
  if (!allowed) {
    return {
      allowed: false,
      message: 'In-app application restart is disabled. Set ALLOW_IN_APP_APPLICATION_RESTART=true in deployment environment variables, or restart the host process from Railway/Docker/PM2 after Pause/Remove package actions.'
    };
  }
  return { allowed: true, message: '' };
}

function scheduleGracefulRestart(options = {}) {
  const httpServer = options?.httpServer || options?.server || null;
  const shutdownTimeoutMs = readPositiveInt(options.shutdownTimeoutMs, DEFAULT_SHUTDOWN_TIMEOUT_MS);
  const restartDelayMs = readPositiveInt(options.restartDelayMs, DEFAULT_RESTART_DELAY_MS);

  setTimeout(() => {
    startupLogger.warn('APP', 'RESTART_REQUESTED', 'In-app application restart requested from Package Manager.');

    const finishExit = () => {
      setTimeout(() => {
        process.exit(0);
      }, restartDelayMs);
    };

    if (httpServer && typeof httpServer.close === 'function') {
      httpServer.close(() => {
        finishExit();
      });
      setTimeout(() => {
        finishExit();
      }, shutdownTimeoutMs);
      return;
    }

    finishExit();
  }, restartDelayMs);
}

module.exports = {
  evaluateRestartPermission,
  scheduleGracefulRestart
};
