// MVC/services/ielts/scoringRunControlService.js

const { setMaxListeners } = require('events');

const ACTIVE_RUNS = new Map();
const RUN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const RUN_SIGNAL_MAX_LISTENERS = 200;

function toToken(value) {
  return String(value || '').trim();
}

function toUserId(value) {
  return String(value || '').trim();
}

function nowMs() {
  return Date.now();
}

function configureRunSignal(signal) {
  if (!signal || typeof setMaxListeners !== 'function') return;
  try {
    // Step 4 can fan out into many concurrent AI calls sharing one cancel signal.
    // Raise listener ceiling for this specific signal to avoid false leak warnings.
    setMaxListeners(RUN_SIGNAL_MAX_LISTENERS, signal);
  } catch (_) {}
}

function cleanupExpiredRuns() {
  const now = nowMs();
  for (const [token, entry] of ACTIVE_RUNS.entries()) {
    if (!entry || !Number.isFinite(entry.startedAt)) {
      ACTIVE_RUNS.delete(token);
      continue;
    }
    if (now - entry.startedAt > RUN_TTL_MS) {
      ACTIVE_RUNS.delete(token);
    }
  }
}

function createAbortError(message = 'Operation cancelled by user.') {
  const err = new Error(String(message || 'Operation cancelled by user.'));
  err.name = 'AbortError';
  err.code = 'RUN_CANCELLED';
  return err;
}

function isAbortError(error) {
  const code = String(error?.code || '').toUpperCase();
  const name = String(error?.name || '').toLowerCase();
  const msg = String(error?.message || '').toLowerCase();
  return (
    code === 'RUN_CANCELLED' ||
    code === 'ABORT_ERR' ||
    name === 'aborterror' ||
    msg.includes('aborted') ||
    msg.includes('cancelled')
  );
}

function registerRun({ token, userId, stepKey } = {}) {
  cleanupExpiredRuns();
  const runToken = toToken(token);
  if (!runToken) return null;

  const entry = {
    token: runToken,
    userId: toUserId(userId),
    stepKey: String(stepKey || '').trim() || null,
    startedAt: nowMs(),
    abortRequestedAt: null,
    controller: new AbortController()
  };
  configureRunSignal(entry.controller.signal);

  ACTIVE_RUNS.set(runToken, entry);
  return {
    token: runToken,
    stepKey: entry.stepKey,
    signal: entry.controller.signal
  };
}

function finishRun(token) {
  const runToken = toToken(token);
  if (!runToken) return false;
  return ACTIVE_RUNS.delete(runToken);
}

function abortRun({ token, userId } = {}) {
  cleanupExpiredRuns();
  const runToken = toToken(token);
  if (!runToken) {
    return { found: false, aborted: false, reason: 'missing_token' };
  }

  const entry = ACTIVE_RUNS.get(runToken);
  if (!entry) {
    return { found: false, aborted: false, reason: 'not_found' };
  }

  const requestUserId = toUserId(userId);
  if (entry.userId && requestUserId && entry.userId !== requestUserId) {
    return { found: true, aborted: false, reason: 'forbidden' };
  }

  entry.abortRequestedAt = nowMs();
  if (!entry.controller.signal.aborted) {
    entry.controller.abort(createAbortError('Operation cancelled by user.'));
  }

  return {
    found: true,
    aborted: true,
    stepKey: entry.stepKey || null,
    startedAt: new Date(entry.startedAt).toISOString(),
    abortRequestedAt: new Date(entry.abortRequestedAt).toISOString()
  };
}

module.exports = {
  registerRun,
  finishRun,
  abortRun,
  createAbortError,
  isAbortError
};
