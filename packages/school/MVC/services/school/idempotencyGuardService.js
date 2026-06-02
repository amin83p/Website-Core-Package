const DEFAULT_RUNNING_TTL_MS = 120000;
const DEFAULT_REPLAY_TTL_MS = 30000;

const guardState = new Map();

function nowMs() {
  return Date.now();
}

function stableSerialize(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${key}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return String(value);
}

function normalizeKey(input) {
  return String(input || '').trim().toLowerCase();
}

function createGuardKey(parts = []) {
  const normalizedParts = Array.isArray(parts) ? parts : [parts];
  return normalizeKey(normalizedParts.map((part) => stableSerialize(part)).join('|'));
}

function pruneExpiredEntries() {
  const now = nowMs();
  for (const [key, entry] of guardState.entries()) {
    if (!entry || entry.expiresAt <= now) guardState.delete(key);
  }
}

function beginGuard({
  key,
  runningTtlMs = DEFAULT_RUNNING_TTL_MS,
  replayTtlMs = DEFAULT_REPLAY_TTL_MS
} = {}) {
  pruneExpiredEntries();
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) throw new Error('Idempotency key is required.');

  const now = nowMs();
  const existing = guardState.get(normalizedKey);
  if (existing) {
    if (existing.state === 'running' && existing.expiresAt > now) {
      return {
        status: 'busy',
        key: normalizedKey,
        retryAfterMs: Math.max(0, existing.expiresAt - now)
      };
    }
    if (existing.state === 'done' && existing.expiresAt > now) {
      return {
        status: 'replay',
        key: normalizedKey,
        payload: existing.payload
      };
    }
  }

  guardState.set(normalizedKey, {
    state: 'running',
    startedAt: now,
    expiresAt: now + Math.max(1000, Number(runningTtlMs) || DEFAULT_RUNNING_TTL_MS),
    replayTtlMs: Math.max(0, Number(replayTtlMs) || DEFAULT_REPLAY_TTL_MS),
    payload: null
  });

  return { status: 'acquired', key: normalizedKey };
}

function completeGuard(key, payload = null) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) return;
  const existing = guardState.get(normalizedKey);
  if (!existing) return;
  const now = nowMs();
  const replayWindow = Math.max(0, Number(existing.replayTtlMs) || DEFAULT_REPLAY_TTL_MS);

  if (!replayWindow) {
    guardState.delete(normalizedKey);
    return;
  }

  existing.state = 'done';
  existing.payload = payload;
  existing.completedAt = now;
  existing.expiresAt = now + replayWindow;
  guardState.set(normalizedKey, existing);
}

function failGuard(key) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) return;
  guardState.delete(normalizedKey);
}

module.exports = {
  createGuardKey,
  beginGuard,
  completeGuard,
  failGuard
};
