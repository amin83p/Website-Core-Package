'use strict';

const accessService = require('./security/index');
const scheduledTaskDefinitionService = require('./scheduledTaskDefinitionService');
const scheduledTaskRunService = require('./scheduledTaskRunService');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
const { idsEqual } = require('../utils/idAdapter');

const MANAGER_SECTIONS = Object.freeze([
  SECTIONS.SCHEDULED_TASK_MANAGER,
  SECTIONS.AUTO_SCHEDULED_TASKS,
  SECTIONS.AUTO_SCHEDULED_TASK_RUNS
]);

const EMPTY_MANAGER_ACCESS = Object.freeze({
  canView: false
});

const COMPLETED_STATUSES = Object.freeze(['succeeded', 'failed', 'cancelled']);
const UPCOMING_RUN_STATUSES = Object.freeze(['pending', 'running']);

function cleanText(value, max = 500) {
  const text = String(value || '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function parseWindowHours(value, fallback = 24) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 168);
}

function formatRemainingLabel(remainingMs = 0) {
  const ms = Math.max(0, Number(remainingMs) || 0);
  if (ms <= 0) return 'Due now';
  const totalMinutes = Math.ceil(ms / 60000);
  if (totalMinutes < 60) return `in ${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `in ${hours}h ${minutes}m` : `in ${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `in ${days}d ${remHours}h` : `in ${days}d`;
}

function formatDurationMs(durationMs = 0) {
  const ms = Math.max(0, Number(durationMs) || 0);
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (minutes < 60) return remSeconds ? `${minutes}m ${remSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

function resolveOrgName(orgId, user) {
  const key = cleanText(orgId, 120);
  if (!key) return 'System';
  const allowedOrgs = Array.isArray(user?.allowedOrgs) ? user.allowedOrgs : [];
  const match = allowedOrgs.find((row) => idsEqual(row?.orgId || row?.id, key));
  return cleanText(match?.name || match?.orgName || match?.organizationName || key, 120) || key;
}

function resolveOrganizerDisplay(source = {}) {
  const displayName = cleanText(source.organizedByDisplayName || source.createdByDisplayName, 200);
  const userId = cleanText(source.organizedByUserId || source.createdByUserId, 120);
  return {
    organizedByUserId: userId || 'SYSTEM',
    organizedByDisplayName: displayName || 'System'
  };
}

function buildDefinitionMap(definitions = []) {
  const map = new Map();
  (Array.isArray(definitions) ? definitions : []).forEach((row) => {
    if (row?.id) map.set(String(row.id), row);
  });
  return map;
}

function enrichUpcomingItem(row = {}, definitionMap = new Map(), user, nowMs, windowMs) {
  const definition = definitionMap.get(String(row.definitionId || '')) || {};
  const scheduledFor = cleanText(row.scheduledFor || row.nextRunAt);
  const scheduledMs = new Date(scheduledFor).getTime();
  const remainingMs = Number.isFinite(scheduledMs) ? Math.max(0, scheduledMs - nowMs) : 0;
  const organizer = resolveOrganizerDisplay({
    ...definition,
    ...row
  });
  const orgId = cleanText(row.orgId || definition.orgId, 120);
  const status = cleanText(row.status, 40) || 'scheduled';
  const progressPct = windowMs > 0
    ? Math.max(0, Math.min(100, Math.round(((windowMs - remainingMs) / windowMs) * 100)))
    : 0;

  return {
    id: cleanText(row.id || definition.id, 120),
    definitionId: cleanText(row.definitionId || definition.id, 120),
    taskKey: cleanText(row.taskKey || definition.taskKey, 160),
    label: cleanText(row.label || definition.label || row.taskKey || definition.taskKey, 200),
    orgId,
    orgName: resolveOrgName(orgId, user),
    scheduledFor,
    remainingMs,
    remainingLabel: formatRemainingLabel(remainingMs),
    progressPct,
    status: ['pending', 'running'].includes(status) ? status : 'scheduled',
    ...organizer
  };
}

function enrichCompletedItem(row = {}, definitionMap = new Map(), user) {
  const definition = definitionMap.get(String(row.definitionId || '')) || {};
  const startedMs = new Date(row.startedAt || '').getTime();
  const finishedMs = new Date(row.finishedAt || '').getTime();
  const durationMs = Number.isFinite(startedMs) && Number.isFinite(finishedMs)
    ? Math.max(0, finishedMs - startedMs)
    : 0;
  const organizer = resolveOrganizerDisplay(row);
  const orgId = cleanText(row.orgId || definition.orgId, 120);
  const status = cleanText(row.status, 40);
  const resultSummary = cleanText(row.resultSummary, 2000);
  const errorMessage = cleanText(row.errorMessage, 5000);

  return {
    id: cleanText(row.id, 120),
    definitionId: cleanText(row.definitionId || definition.id, 120),
    taskKey: cleanText(row.taskKey || definition.taskKey, 160),
    label: cleanText(definition.label || row.taskKey, 200),
    orgId,
    orgName: resolveOrgName(orgId, user),
    scheduledFor: cleanText(row.scheduledFor),
    finishedAt: cleanText(row.finishedAt),
    durationMs,
    durationLabel: formatDurationMs(durationMs),
    status,
    resultSummary: resultSummary || errorMessage || 'Completed.',
    errorMessage,
    ...organizer
  };
}

async function canViewManager(user, ipAddress = '') {
  if (!user) return false;
  for (const sectionId of MANAGER_SECTIONS) {
    // eslint-disable-next-line no-await-in-loop
    const evaluation = await accessService.evaluateAccess({
      user,
      sectionId,
      operationId: OPERATIONS.READ_ALL,
      ipAddress
    });
    if (evaluation?.allowed) return true;
  }
  return false;
}

async function buildManagerAccess(user, ipAddress = '') {
  const canView = await canViewManager(user, ipAddress);
  return { canView };
}

async function getManagerWindow(user, options = {}) {
  const windowHours = parseWindowHours(options.windowHours, 24);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const nowMs = now.getTime();
  const windowMs = windowHours * 60 * 60 * 1000;
  const endMs = nowMs + windowMs;
  const startMs = nowMs - windowMs;
  const nowIso = now.toISOString();
  const endIso = new Date(endMs).toISOString();
  const startIso = new Date(startMs).toISOString();

  const listOptions = options.listOptions || {};

  const [upcomingDefinitions, upcomingRuns, completedRuns] = await Promise.all([
    scheduledTaskDefinitionService.listDefinitions({
      enabled__eq: true,
      paused__eq: false,
      nextRunAt__gt: nowIso,
      nextRunAt__lte: endIso,
      page: 1,
      limit: 200,
      sortBy: 'nextRunAt',
      sortDir: 'asc'
    }, listOptions),
    scheduledTaskRunService.listRuns({
      scheduledFor__gt: nowIso,
      scheduledFor__lte: endIso,
      page: 1,
      limit: 200,
      sortBy: 'scheduledFor',
      sortDir: 'asc'
    }, listOptions),
    scheduledTaskRunService.listRuns({
      finishedAt__gte: startIso,
      finishedAt__lte: nowIso,
      page: 1,
      limit: 200,
      sortBy: 'finishedAt',
      sortDir: 'desc'
    }, listOptions)
  ]);

  const definitionIds = new Set();
  [...upcomingDefinitions, ...upcomingRuns, ...completedRuns].forEach((row) => {
    const id = cleanText(row?.definitionId, 120);
    if (id) definitionIds.add(id);
  });
  const definitionRows = definitionIds.size
    ? await scheduledTaskDefinitionService.listDefinitions({
      id__in: [...definitionIds].join(','),
      page: 1,
      limit: Math.max(definitionIds.size, 1)
    }, listOptions)
    : [];
  const definitionMap = buildDefinitionMap(definitionRows);

  const upcomingMap = new Map();
  (Array.isArray(upcomingRuns) ? upcomingRuns : [])
    .filter((row) => UPCOMING_RUN_STATUSES.includes(cleanText(row.status).toLowerCase()))
    .forEach((row) => {
      const key = cleanText(row.definitionId || row.id, 120);
      if (!key) return;
      upcomingMap.set(key, enrichUpcomingItem(row, definitionMap, user, nowMs, windowMs));
    });

  (Array.isArray(upcomingDefinitions) ? upcomingDefinitions : []).forEach((definition) => {
    const key = cleanText(definition.id, 120);
    if (!key || upcomingMap.has(key)) return;
    upcomingMap.set(key, enrichUpcomingItem({
      ...definition,
      scheduledFor: definition.nextRunAt,
      status: 'scheduled'
    }, definitionMap, user, nowMs, windowMs));
  });

  const upcoming = [...upcomingMap.values()].sort((a, b) => {
    const aMs = new Date(a.scheduledFor || 0).getTime();
    const bMs = new Date(b.scheduledFor || 0).getTime();
    return aMs - bMs;
  });

  const completed = (Array.isArray(completedRuns) ? completedRuns : [])
    .filter((row) => COMPLETED_STATUSES.includes(cleanText(row.status).toLowerCase()))
    .map((row) => enrichCompletedItem(row, definitionMap, user));

  return {
    upcoming,
    completed,
    generatedAt: nowIso,
    windowHours,
    counts: {
      upcoming: upcoming.length,
      completed: completed.length
    }
  };
}

module.exports = {
  EMPTY_MANAGER_ACCESS,
  MANAGER_SECTIONS,
  buildManagerAccess,
  canViewManager,
  getManagerWindow,
  formatRemainingLabel,
  formatDurationMs
};
