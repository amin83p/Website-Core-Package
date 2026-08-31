'use strict';

const scheduledTaskDefinitionRepository = require('../repositories/scheduledTaskDefinitionRepository');
const scheduledTaskOrchestratorService = require('./scheduledTaskOrchestratorService');
const { computeNextRunAt } = require('./scheduledTaskSchedulingUtils');
const { resolveDefaultTimezone, zonedWallClockToIso } = require('../utils/timezoneUtils');

function cleanText(value) {
  return String(value || '').trim();
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function hasScheduleFieldsChanged(existing = {}, payload = {}) {
  const existingInterval = parsePositiveInt(existing?.input?.intervalMinutes, 0);
  const payloadInterval = parsePositiveInt(payload?.input?.intervalMinutes, 0);
  return cleanText(existing.runAtTime) !== cleanText(payload.runAtTime)
    || cleanText(existing.scheduleType) !== cleanText(payload.scheduleType)
    || (cleanText(payload.scheduleType) === 'interval' && existingInterval !== payloadInterval);
}

async function upsertDefinition({
  orgId = '',
  packageName = '',
  taskKey = '',
  label = '',
  description = '',
  scheduleType = 'daily',
  runAtTime = '',
  timezone = '',
  enabled = true,
  paused = false,
  source = '',
  sourceRef = '',
  input = {},
  intervalMinutes = null
} = {}, options = {}) {
  const orgKey = cleanText(orgId);
  const key = cleanText(taskKey);
  const src = cleanText(source);
  const srcRef = cleanText(sourceRef);
  const existingRows = await scheduledTaskDefinitionRepository.list({
    ...options,
    query: {
      orgId__eq: orgKey,
      taskKey__eq: key,
      source__eq: src,
      sourceRef__eq: srcRef,
      page: 1,
      limit: 1
    }
  });
  const tz = cleanText(timezone) || resolveDefaultTimezone();
  const payload = {
    orgId: orgKey,
    packageName: cleanText(packageName).toUpperCase(),
    taskKey: key,
    label: cleanText(label) || key,
    description: cleanText(description),
    scheduleType: scheduleType === 'interval' ? 'interval' : 'daily',
    runAtTime: cleanText(runAtTime).slice(0, 5),
    timezone: tz,
    enabled: enabled === true,
    paused: paused === true,
    source: src,
    sourceRef: srcRef,
    input: {
      ...(input && typeof input === 'object' ? input : {}),
      ...(scheduleType === 'interval' ? { intervalMinutes: parsePositiveInt(intervalMinutes, 5) } : {})
    }
  };
  payload.nextRunAt = computeNextRunAt(payload, new Date());

  if (Array.isArray(existingRows) && existingRows.length) {
    const existing = existingRows[0];
    const scheduleChanged = hasScheduleFieldsChanged(existing, payload);
    if (!scheduleChanged) {
      payload.nextRunAt = existing.nextRunAt;
    }
    return scheduledTaskDefinitionRepository.update(existing.id, payload, options);
  }
  return scheduledTaskDefinitionRepository.create(payload, options);
}

async function ensureSystemDispatchDefinition(options = {}) {
  const intervalMinutes = parsePositiveInt(process.env.SCHEDULED_TASK_DISPATCH_INTERVAL_MINUTES, 5);
  return upsertDefinition({
    orgId: '',
    packageName: 'CORE',
    taskKey: 'core.emailOutbox.dispatch',
    label: 'Dispatch queued emails',
    description: 'Sends email outbox entries whose send time has arrived.',
    scheduleType: 'interval',
    runAtTime: '00:00',
    timezone: resolveDefaultTimezone(),
    enabled: true,
    paused: false,
    source: 'core.system',
    sourceRef: 'emailOutbox.dispatch',
    intervalMinutes
  }, options);
}

async function ensureSystemSmsDispatchDefinition(options = {}) {
  const intervalMinutes = parsePositiveInt(process.env.SCHEDULED_TASK_DISPATCH_INTERVAL_MINUTES, 5);
  return upsertDefinition({
    orgId: '',
    packageName: 'CORE',
    taskKey: 'core.smsOutbox.dispatch',
    label: 'Dispatch queued SMS messages',
    description: 'Sends SMS outbox entries whose send time has arrived.',
    scheduleType: 'interval',
    runAtTime: '00:00',
    timezone: resolveDefaultTimezone(),
    enabled: true,
    paused: false,
    source: 'core.system',
    sourceRef: 'smsOutbox.dispatch',
    intervalMinutes
  }, options);
}

const scheduledTaskDefinitionService = {
  async listDefinitions(query = {}, options = {}) {
    return scheduledTaskDefinitionRepository.list({ ...options, query });
  },

  async countDefinitions(query = {}, options = {}) {
    return scheduledTaskDefinitionRepository.count({ ...options, query });
  },

  async getDefinitionById(id, options = {}) {
    return scheduledTaskDefinitionRepository.getById(id, options);
  },

  async createDefinition(payload = {}, options = {}) {
    const next = { ...payload, nextRunAt: computeNextRunAt(payload, new Date()) };
    return scheduledTaskDefinitionRepository.create(next, options);
  },

  async updateDefinition(id, payload = {}, options = {}) {
    const existing = await scheduledTaskDefinitionRepository.getById(id, options);
    if (!existing) throw new Error('Scheduled task definition not found.');
    const merged = { ...existing, ...payload };
    if (payload.runAtTime || payload.scheduleType || payload.timezone || payload.input) {
      merged.nextRunAt = computeNextRunAt(merged, new Date());
    }
    return scheduledTaskDefinitionRepository.update(id, merged, options);
  },

  async deleteDefinition(id, options = {}) {
    return scheduledTaskDefinitionRepository.remove(id, options);
  },

  async setPaused(id, paused = true, options = {}) {
    return scheduledTaskDefinitionRepository.update(id, { paused: paused === true }, options);
  },

  async setNextRunAt(id, nextRunAtInput = '', options = {}) {
    const existing = await scheduledTaskDefinitionRepository.getById(id, options);
    if (!existing) throw new Error('Scheduled task definition not found.');

    const raw = cleanText(nextRunAtInput);
    if (!raw) throw new Error('Next run date and time are required.');

    let nextRunAt = '';
    const tz = cleanText(options.timezone) || resolveDefaultTimezone();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
      const [dateKey, timePart] = raw.split('T');
      const timeHm = cleanText(timePart).slice(0, 5);
      nextRunAt = zonedWallClockToIso(dateKey, timeHm, tz);
    } else {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) throw new Error('Invalid next run date and time.');
      nextRunAt = parsed.toISOString();
    }

    if (!nextRunAt) throw new Error('Invalid next run date and time.');
    const updated = await scheduledTaskDefinitionRepository.update(id, { nextRunAt, timezone: tz }, options);
    const dueMs = new Date(updated?.nextRunAt || nextRunAt).getTime();
    const nowMs = Date.now();
    // datetime-local has minute precision; allow the current minute to run immediately.
    const isDue = Number.isFinite(dueMs) && dueMs <= nowMs + 60000;
    const isRunnable = existing.enabled !== false && existing.paused !== true;
    if (isDue && isRunnable) {
      setImmediate(() => scheduledTaskOrchestratorService.runDefinitionNow(id, options).catch(() => null));
    }
    return updated;
  },

  upsertDefinition,
  ensureSystemDispatchDefinition,
  ensureSystemSmsDispatchDefinition
};

module.exports = scheduledTaskDefinitionService;
