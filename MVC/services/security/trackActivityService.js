const settingService = require('../settingService');
const dataService = require('../dataService');
const adminAuthorityService = require('../adminAuthorityService');
const { toPublicId } = require('../../utils/idAdapter');

const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_MERGE_LIMIT = 1500;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MIN_PAGE_SIZE = 5;
const MAX_MERGE_LIMIT = 5000;
const MIN_MERGE_LIMIT = 100;
const MAX_RANGE_DAYS = 7;
const MAX_RANGE_MS = MAX_RANGE_DAYS * 24 * 60 * 60 * 1000;
const FALLBACK_MATCH_WINDOW_MS = 10 * 60 * 1000;
const REQUEST_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;
const DEFAULT_ORG_TIMEZONE = 'UTC';

const SYSTEM_SECTION_IDS = new Set(['000000', '0000000']);
const SYSTEM_HTTP_OPERATION_NAME_MAP = Object.freeze({
  OP9001: 'HTTP POST',
  OP9002: 'HTTP GET',
  OP9003: 'HTTP UNKNOWN',
  OP9004: 'HTTP DELETE',
  OP9005: 'HTTP PUT',
  OP9006: 'HTTP PATCH'
});
const SUCCESS_STATUS_SET = new Set(['success', 'completed']);
const FAILURE_STATUS_SET = new Set(['failure', 'failed', 'error', 'denied', 'blocked', 'cancelled', 'terminated']);
const DANGEROUS_CSV_PREFIX = /^[=+\-@\t\r\n\uFF1D\uFF0B\uFF0D\uFF20]/;
const SENSITIVE_KEY_PATTERN = /(password|passphrase|secret|token|authorization|cookie|set-cookie|apikey|api[_-]?key|session|jwt|ip|useragent|email|phone)/i;

function cleanText(value, max = 220) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  return text.length > max ? text.slice(0, max) : text;
}

function parsePositiveInteger(value, fallback = null) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeIdToken(value, max = 120) {
  const token = cleanText(value, max);
  if (!token) return '';
  return toPublicId(token) || token;
}

function parseIdList(rawValue, max = 120, maxItems = 100) {
  const collected = [];
  const pushToken = (token) => {
    const normalized = normalizeIdToken(token, max);
    if (!normalized) return;
    collected.push(normalized);
  };

  const collect = (input) => {
    if (Array.isArray(input)) {
      input.forEach((item) => collect(item));
      return;
    }
    const token = cleanText(input, 5000);
    if (!token) return;
    token
      .split(',')
      .map((row) => row.trim())
      .filter(Boolean)
      .forEach((row) => pushToken(row));
  };

  collect(rawValue);
  return Array.from(new Set(collected)).slice(0, Math.max(1, Number(maxItems) || 1));
}

function buildIdFilterSet(rawList, rawSingle, max = 120) {
  const list = parseIdList(rawList, max, 200);
  if (list.length) return new Set(list);
  const single = normalizeIdToken(rawSingle, max);
  return single ? new Set([single]) : new Set();
}

function pickPrimaryId(rawList, rawSingle, max = 120) {
  const list = parseIdList(rawList, max, 200);
  if (list.length) return list[0];
  return normalizeIdToken(rawSingle, max);
}

function normalizeSource(value) {
  const token = cleanText(value, 40).toLowerCase();
  if (token === 'log' || token === 'logs') return 'log';
  if (token === 'action_state' || token === 'actionstate' || token === 'action_states' || token === 'actionstates') return 'action_state';
  return '';
}

function normalizeZoomLevel(value) {
  const token = cleanText(value, 20).toLowerCase();
  if (token === '5m') return '5m';
  if (token === 'event') return 'event';
  return '30m';
}

function normalizeStatus(value) {
  return cleanText(value, 80).toLowerCase();
}

function normalizeTimezoneToken(value, fallback = DEFAULT_ORG_TIMEZONE) {
  const token = cleanText(value, 80) || fallback;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: token });
    return token;
  } catch (_) {
    return fallback;
  }
}

function resolveDefaultTimezone() {
  const settings = settingService.get();
  const token = settings?.app?.defaultTimezone || settings?.app?.timezone || DEFAULT_ORG_TIMEZONE;
  return normalizeTimezoneToken(token, DEFAULT_ORG_TIMEZONE);
}

function resolveOrganizationTimezoneFromRow(row = {}) {
  const candidates = [
    row?.settings?.timeZone,
    row?.settings?.timezone,
    row?.timeZone,
    row?.timezone,
    row?.identity?.timeZone,
    row?.identity?.timezone
  ];
  for (const candidate of candidates) {
    const token = cleanText(candidate, 80);
    if (!token) continue;
    return normalizeTimezoneToken(token, resolveDefaultTimezone());
  }
  return resolveDefaultTimezone();
}

function resolveAllowedOrgTimezoneFromUser(requestUser = null, orgId = '') {
  const targetOrgId = toPublicId(orgId || '');
  const rows = Array.isArray(requestUser?.allowedOrgs) ? requestUser.allowedOrgs : [];
  for (const row of rows) {
    const rowOrgId = toPublicId(row?.orgId || row?.id || '');
    if (!rowOrgId) continue;
    if (targetOrgId && rowOrgId !== targetOrgId) continue;
    const token = resolveOrganizationTimezoneFromRow(row || {});
    if (token) return token;
  }
  return '';
}

function formatDateTimeInTimezone(ms, timeZone = DEFAULT_ORG_TIMEZONE) {
  const date = new Date(Number(ms || 0));
  if (Number.isNaN(date.getTime())) return '-';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: normalizeTimezoneToken(timeZone, resolveDefaultTimezone()),
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  } catch (_) {
    return date.toISOString();
  }
}

function formatDateInTimezone(ms, timeZone = DEFAULT_ORG_TIMEZONE) {
  const date = new Date(Number(ms || 0));
  if (Number.isNaN(date.getTime())) return '-';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: normalizeTimezoneToken(timeZone, resolveDefaultTimezone()),
      weekday: 'short',
      month: 'short',
      day: '2-digit',
      year: 'numeric'
    }).format(date);
  } catch (_) {
    return date.toISOString().slice(0, 10);
  }
}

function getDateTimePartsInTimezone(ms, timeZone = DEFAULT_ORG_TIMEZONE) {
  const date = new Date(Number(ms || 0));
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: normalizeTimezoneToken(timeZone, resolveDefaultTimezone()),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      hour12: false
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return {
      year: Number(get('year') || 0),
      month: Number(get('month') || 0),
      day: Number(get('day') || 0),
      hour: Number(get('hour') || 0),
      minute: Number(get('minute') || 0),
      second: Number(get('second') || 0)
    };
  } catch (_) {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds()
    };
  }
}

function toUtcMsFromTimezoneLocal(parts = {}, timeZone = DEFAULT_ORG_TIMEZONE) {
  const year = Number(parts.year || 0);
  const month = Number(parts.month || 0);
  const day = Number(parts.day || 0);
  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);
  const second = Number(parts.second || 0);
  if (!year || !month || !day) return Number.NaN;

  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 3; i += 1) {
    const currentParts = getDateTimePartsInTimezone(guess, timeZone);
    if (!currentParts) break;
    const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    const currentUtc = Date.UTC(
      currentParts.year,
      currentParts.month - 1,
      currentParts.day,
      currentParts.hour,
      currentParts.minute,
      currentParts.second
    );
    const diff = desiredUtc - currentUtc;
    if (!diff) break;
    guess += diff;
  }
  return guess;
}

function formatMsToDateTimeLocalInput(ms, timeZone = DEFAULT_ORG_TIMEZONE) {
  const parts = getDateTimePartsInTimezone(ms, timeZone);
  if (!parts) return '';
  return [
    String(parts.year).padStart(4, '0'),
    '-',
    String(parts.month).padStart(2, '0'),
    '-',
    String(parts.day).padStart(2, '0'),
    'T',
    String(parts.hour).padStart(2, '0'),
    ':',
    String(parts.minute).padStart(2, '0')
  ].join('');
}

function toDateKeyInTimezone(ms, timeZone = DEFAULT_ORG_TIMEZONE) {
  const parts = getDateTimePartsInTimezone(ms, timeZone);
  if (!parts) return '';
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function getDayBoundsMs(referenceMs, timeZone = DEFAULT_ORG_TIMEZONE) {
  const parts = getDateTimePartsInTimezone(referenceMs, timeZone);
  if (!parts) {
    return {
      dateKey: '',
      dayStartMs: Number.NaN,
      dayEndMs: Number.NaN
    };
  }
  const dayStartMs = toUtcMsFromTimezoneLocal({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 0,
    minute: 0,
    second: 0
  }, timeZone);

  const nextUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + (24 * 60 * 60 * 1000));
  const nextStartMs = toUtcMsFromTimezoneLocal({
    year: nextUtc.getUTCFullYear(),
    month: nextUtc.getUTCMonth() + 1,
    day: nextUtc.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0
  }, timeZone);

  return {
    dateKey: `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
    dayStartMs,
    dayEndMs: Number(nextStartMs) - 1
  };
}

function parseDateTimeInputToMs(value, timeZone = DEFAULT_ORG_TIMEZONE, { endOfDay = false } = {}) {
  const token = cleanText(value, 80);
  if (!token) return Number.NaN;

  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    const normalized = `${token}T${endOfDay ? '23:59:59' : '00:00:00'}`;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? Number.NaN : parsed.getTime();
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(token)) {
    const normalized = token.length === 16 ? `${token}:00` : token;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? Number.NaN : parsed.getTime();
  }

  const parsed = new Date(token);
  return Number.isNaN(parsed.getTime()) ? Number.NaN : parsed.getTime();
}

function resolveDefaultRangeMs(nowMs = Date.now()) {
  const endAtMs = Number(nowMs || Date.now());
  const startAtMs = endAtMs - (DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000) + 1;
  return { startAtMs, endAtMs };
}

function buildLookupMap(rows = []) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = toPublicId(row?.id);
    if (!id) return;
    map.set(id, row);
  });
  return map;
}

function resolveSectionInfo(sectionId, sectionMap) {
  const id = cleanText(sectionId, 120);
  if (!id) return { id: '', name: 'N/A' };
  if (SYSTEM_SECTION_IDS.has(id)) return { id, name: 'SYSTEM' };
  const row = sectionMap.get(toPublicId(id)) || null;
  return { id, name: cleanText(row?.name, 180) || id };
}

function resolveOperationFallbackName(operationId = '', context = {}) {
  const fromMap = cleanText(SYSTEM_HTTP_OPERATION_NAME_MAP[String(operationId || '').toUpperCase()], 180);
  if (fromMap) return fromMap;
  const method = cleanText(context?.method || context?.httpMethod, 20).toUpperCase();
  if (method) return `HTTP ${method}`;
  return '';
}

function resolveOperationInfo(operationId, operationMap, context = null) {
  const id = cleanText(operationId, 120);
  if (!id) return { id: '', name: 'N/A' };
  const row = operationMap.get(toPublicId(id)) || null;
  const lookupName = cleanText(row?.name, 180);
  if (lookupName) return { id, name: lookupName };
  const fallbackName = resolveOperationFallbackName(id, context || {});
  return { id, name: fallbackName || id };
}

function resolveOrgName(org) {
  return cleanText(org?.identity?.displayName || org?.name, 180);
}

function resolveUserDisplayName(user = null) {
  if (!user || typeof user !== 'object') return '';
  const displayName = cleanText(user.displayName, 180);
  if (displayName) return displayName;
  if (typeof user.name === 'string') return cleanText(user.name, 180);
  if (user.name && typeof user.name === 'object') {
    return cleanText(`${user.name.first || ''} ${user.name.last || ''}`, 180);
  }
  return '';
}

function resolveUserOrgId(user = null) {
  if (!user || typeof user !== 'object') return '';
  const direct = toPublicId(user.activeOrgId || user.primaryOrgId || user.orgId);
  if (direct) return direct;
  const rows = Array.isArray(user.organizations) ? user.organizations : [];
  for (const row of rows) {
    const token = toPublicId(row?.orgId || row?.id || '');
    if (token) return token;
  }
  return '';
}

function isSystemActorToken(value) {
  const token = cleanText(value, 120).toLowerCase();
  return token === 'system' || token === 'sys' || token === 'root_system';
}

function buildActorIdentity(base = {}, userMap = new Map(), orgMap = new Map()) {
  const input = base && typeof base === 'object' ? base : {};
  const userIdRaw = cleanText(input.userId, 120);
  const userId = toPublicId(userIdRaw) || userIdRaw;
  const knownUser = userId ? userMap.get(userId) : null;
  const username = cleanText(input.username, 140) || cleanText(knownUser?.username, 140);
  const displayName = cleanText(input.displayName, 180) || resolveUserDisplayName(knownUser);
  const orgId = toPublicId(input.orgId) || resolveUserOrgId(knownUser);
  const orgName = orgId ? resolveOrgName(orgMap.get(orgId)) : '';
  const isSystem = cleanText(input.actorType, 40).toLowerCase() === 'system' || isSystemActorToken(userId);

  const primary = isSystem
    ? 'System'
    : (displayName || username || (userId ? `User ${userId}` : 'User'));

  const secondaryParts = [];
  if (!isSystem && username && username.toLowerCase() !== primary.toLowerCase()) secondaryParts.push(`@${username}`);
  if (!isSystem && userId) secondaryParts.push(`ID: ${userId}`);
  if (orgName && orgId) secondaryParts.push(`Org: ${orgName} (${orgId})`);
  else if (orgName) secondaryParts.push(`Org: ${orgName}`);
  else if (orgId) secondaryParts.push(`Org: ${orgId}`);

  return {
    actorType: isSystem ? 'system' : 'user',
    userId: isSystem ? 'system' : userId,
    username: username || '',
    displayName: displayName || '',
    orgId: orgId || '',
    orgName: orgName || '',
    primary,
    secondary: secondaryParts.join(' | ')
  };
}

function resolveLogTimestamp(log = {}) {
  return cleanText(
    log.timestamp ||
    log.createdAt ||
    log.updatedAt ||
    log?.audit?.createDateTime ||
    log?.audit?.lastUpdateDateTime,
    80
  );
}

function resolveLogRequestId(log = {}) {
  return cleanText(log.requestId || log?.details?.requestId, 120);
}

function resolveLogActionStateId(log = {}) {
  return cleanText(log.actionStateId || log?.details?.actionStateId, 180);
}

function collectActionContextCandidates(state = {}) {
  const rows = [];
  const push = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    rows.push(value);
  };

  push(state.initialContext);
  push(state.context);
  push(state.progress?.context);
  push(state.result?.context);
  push(state.failure?.context);
  push(state.retryableError?.context);

  if (Array.isArray(state.history)) {
    state.history.forEach((item) => push(item?.context));
  }

  return rows;
}

function resolveActionTimestamp(state = {}) {
  return cleanText(
    state.startedAt ||
    state.createdAt ||
    state.updatedAt ||
    state.lastActiveAt ||
    state?.history?.[0]?.ts,
    80
  );
}

function resolveActionContextValue(state = {}, keys = []) {
  const candidates = collectActionContextCandidates(state);
  for (const key of keys) {
    const direct = cleanText(state?.[key], 180);
    if (direct) return direct;
    for (const candidate of candidates) {
      const token = cleanText(candidate?.[key], 180);
      if (token) return token;
    }
  }
  return '';
}

function resolveActionRequestId(state = {}) {
  const direct = cleanText(state.requestId, 120);
  if (direct) return direct;

  const fromContext = resolveActionContextValue(state, ['requestId']);
  if (fromContext) return cleanText(fromContext, 120);

  return '';
}

function buildActionSummary(action = {}, sectionName = '', operationName = '') {
  const method = cleanText(action.method, 20).toUpperCase();
  const url = cleanText(action.url, 240);
  const targetKey = cleanText(action.targetKey, 140);
  const status = cleanText(action.statusRaw, 80);

  const base = [method, url].filter(Boolean).join(' ').trim()
    || `${operationName || 'N/A'} in ${sectionName || 'N/A'}`;
  const target = targetKey && targetKey !== 'GLOBAL_SCOPE' ? ` target:${targetKey}` : '';
  const statusToken = status ? ` (${status})` : '';
  return `${base}${target}${statusToken}`.trim();
}

function buildLogSummary(log = {}, sectionName = '', operationName = '') {
  const details = (log && typeof log.details === 'object') ? log.details : {};
  const method = cleanText(details.method || details.httpMethod, 20).toUpperCase();
  const url = cleanText(details.url || details.targetUrl || details.path, 240);
  const errorMessage = cleanText(details.errorMessage || details.message, 220);
  const base = [method, url].filter(Boolean).join(' ').trim() || `${operationName || 'N/A'} in ${sectionName || 'N/A'}`;
  return errorMessage ? `${base} | ${errorMessage}` : base;
}

function buildActionStateProjection(state = {}, lookups = {}, timezone = DEFAULT_ORG_TIMEZONE) {
  const sectionInfo = resolveSectionInfo(state.sectionId, lookups.sectionMap);
  const methodFromState = cleanText(resolveActionContextValue(state, ['method']), 20).toUpperCase();
  const operationInfo = resolveOperationInfo(state.operationId, lookups.operationMap, { method: methodFromState });
  const actor = buildActorIdentity({
    userId: state.userId || resolveActionContextValue(state, ['userId']),
    username: resolveActionContextValue(state, ['username']),
    displayName: resolveActionContextValue(state, ['displayName']),
    orgId: resolveActionContextValue(state, ['orgId']),
    actorType: isSystemActorToken(state.userId) ? 'system' : 'user'
  }, lookups.userMap, lookups.orgMap);

  const occurredAt = resolveActionTimestamp(state);
  const occurredAtMs = Number.isNaN(new Date(occurredAt).getTime()) ? 0 : new Date(occurredAt).getTime();
  const requestId = resolveActionRequestId(state);
  const orgId = toPublicId(resolveActionContextValue(state, ['orgId'])) || actor.orgId || '';
  const orgName = resolveActionContextValue(state, ['orgName']) || actor.orgName || (orgId ? resolveOrgName(lookups.orgMap.get(orgId)) : '');

  const projection = {
    source: 'action_state',
    sourceLabel: 'Action State',
    recordId: cleanText(state.id, 140),
    requestId,
    statusRaw: cleanText(state.status, 80),
    statusNormalized: normalizeStatus(state.status),
    userId: actor.userId,
    username: actor.username,
    displayName: actor.displayName,
    orgId,
    orgName,
    actorPrimary: actor.primary,
    actorSecondary: actor.secondary,
    sectionId: sectionInfo.id,
    sectionName: sectionInfo.name,
    operationId: operationInfo.id,
    operationName: operationInfo.name,
    targetKey: cleanText(state.targetKey, 140),
    method: cleanText(resolveActionContextValue(state, ['method']), 20).toUpperCase(),
    url: cleanText(resolveActionContextValue(state, ['url']), 240),
    occurredAt,
    occurredAtMs,
    occurredAtDisplay: formatDateTimeInTimezone(occurredAtMs, timezone),
    details: {
      targetKey: cleanText(state.targetKey, 140),
      attemptCount: Number(state.attemptCount || 0),
      volumeUsageKB: Number(state.volumeUsageKB || 0),
      appliedLimits: state.appliedLimits || {},
      initialContext: state.initialContext || {},
      context: state.context || {},
      history: Array.isArray(state.history) ? state.history : [],
      progress: state.progress || {},
      result: state.result || {},
      failure: state.failure || {},
      retryableError: state.retryableError || {},
      encryptedPayloadSaved: Boolean(state.finalData),
      changeEventsSaved: Array.isArray(state.changeEvents) && state.changeEvents.length > 0
    }
  };

  projection.summary = buildActionSummary(projection, sectionInfo.name, operationInfo.name);
  return projection;
}

function buildLogEvent(log = {}, lookups = {}, timezone = DEFAULT_ORG_TIMEZONE) {
  const details = (log && typeof log.details === 'object' && log.details) ? log.details : {};
  const sectionInfo = resolveSectionInfo(log.sectionId, lookups.sectionMap);
  const operationInfo = resolveOperationInfo(log.operationId, lookups.operationMap, details);
  const actorFromDetails = (log && typeof log.details?.actor === 'object') ? log.details.actor : {};

  const actor = buildActorIdentity({
    userId: log.userId || actorFromDetails.userId,
    username: log.username || actorFromDetails.username,
    displayName: log.displayName || actorFromDetails.displayName,
    orgId: log.orgId || actorFromDetails.orgId,
    actorType: log.actorType || actorFromDetails.actorType
  }, lookups.userMap, lookups.orgMap);

  const occurredAt = resolveLogTimestamp(log);
  const occurredAtMs = Number.isNaN(new Date(occurredAt).getTime()) ? 0 : new Date(occurredAt).getTime();
  const requestId = resolveLogRequestId(log);
  const actionStateId = resolveLogActionStateId(log);

  return {
    id: cleanText(log.id, 160) ? `log:${cleanText(log.id, 160)}` : `log:auto:${occurredAtMs}:${Math.random().toString(36).slice(2, 9)}`,
    source: 'log',
    sourceLabel: 'Log',
    recordId: cleanText(log.id, 140),
    occurredAt,
    occurredAtMs,
    occurredAtDisplay: formatDateTimeInTimezone(occurredAtMs, timezone),
    userId: actor.userId,
    username: actor.username,
    displayName: actor.displayName,
    orgId: actor.orgId,
    orgName: actor.orgName,
    actorType: actor.actorType,
    actorPrimary: actor.primary,
    actorSecondary: actor.secondary,
    sectionId: sectionInfo.id,
    sectionName: sectionInfo.name,
    operationId: operationInfo.id,
    operationName: operationInfo.name,
    statusRaw: cleanText(log.status, 80),
    statusNormalized: normalizeStatus(log.status),
    requestId,
    actionStateId,
    summary: buildLogSummary(log, sectionInfo.name, operationInfo.name),
    contextLine: `${sectionInfo.name} -> ${operationInfo.name}`,
    detailsRef: { source: 'log', id: cleanText(log.id, 140) },
    details,
    actionState: null,
    hasActionState: false
  };
}

function buildEventSearchText(event = {}) {
  const tokens = [
    event.summary,
    event.sourceLabel,
    event.sectionName,
    event.operationName,
    event.statusRaw,
    event.requestId,
    event.actionStateId,
    event.actorPrimary,
    event.actorSecondary,
    event.userId,
    event.username,
    event.displayName,
    event.orgId,
    event.orgName,
    event.contextLine,
    event.actionState?.summary,
    event.actionState?.statusRaw,
    event.actionState?.targetKey
  ];
  return tokens.map((token) => cleanText(token, 500)).join(' ').toLowerCase();
}

function eventMatchesSearch(event = {}, searchToken = '') {
  const q = cleanText(searchToken, 220).toLowerCase();
  if (!q) return true;
  return buildEventSearchText(event).includes(q);
}

function eventMatchesStatus(event = {}, statusFilter = '') {
  const filter = normalizeStatus(statusFilter);
  if (!filter) return true;
  const eventStatus = normalizeStatus(event.statusNormalized || event.statusRaw);
  if (!eventStatus) return false;
  return eventStatus === filter || eventStatus.includes(filter);
}

function eventMatchesSource(event = {}, sourceFilter = '') {
  const source = normalizeSource(sourceFilter);
  if (!source) return true;
  if (source === 'log') return true;
  if (source === 'action_state') return Boolean(event.hasActionState);
  return true;
}

function buildActionIndexes(actions = []) {
  const requestMap = new Map();
  const keyMap = new Map();
  const idMap = new Map();

  (Array.isArray(actions) ? actions : []).forEach((action) => {
    const recordId = cleanText(action.recordId, 180);
    if (recordId) {
      idMap.set(recordId, action);
    }

    const requestId = cleanText(action.requestId, 120);
    if (requestId) {
      if (!requestMap.has(requestId)) requestMap.set(requestId, []);
      requestMap.get(requestId).push(action);
    }

    const key = [
      toPublicId(action.userId) || cleanText(action.userId, 120),
      toPublicId(action.sectionId) || cleanText(action.sectionId, 120),
      toPublicId(action.operationId) || cleanText(action.operationId, 120)
    ].join('::');

    if (!keyMap.has(key)) keyMap.set(key, []);
    keyMap.get(key).push(action);
  });

  return { requestMap, keyMap, idMap };
}

function resolveNearestByTimestamp(rows = [], targetMs = 0, maxDeltaMs = Number.POSITIVE_INFINITY) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let winner = null;
  let winnerDelta = Number.POSITIVE_INFINITY;

  rows.forEach((row) => {
    const delta = Math.abs(Number(row?.occurredAtMs || 0) - Number(targetMs || 0));
    if (delta > maxDeltaMs) return;
    if (delta < winnerDelta) {
      winner = row;
      winnerDelta = delta;
      return;
    }
    if (delta === winnerDelta && winner) {
      const winnerStatus = normalizeStatus(winner.statusRaw);
      const candidateStatus = normalizeStatus(row.statusRaw);
      if (winnerStatus !== 'completed' && candidateStatus === 'completed') {
        winner = row;
        winnerDelta = delta;
      }
    }
  });

  return winner;
}

function correlateLogWithAction(logEvent = {}, actionIndexes = {}) {
  if (!logEvent || typeof logEvent !== 'object') return null;
  const actionStateId = cleanText(logEvent.actionStateId, 180);
  if (actionStateId) {
    const matchedById = actionIndexes.idMap?.get(actionStateId) || null;
    if (matchedById) return matchedById;
  }
  const requestId = cleanText(logEvent.requestId, 120);
  if (requestId) {
    const reqRows = actionIndexes.requestMap?.get(requestId) || [];
    const matchedByRequest = resolveNearestByTimestamp(reqRows, logEvent.occurredAtMs, REQUEST_MATCH_WINDOW_MS);
    if (matchedByRequest) return matchedByRequest;
  }

  const key = [
    toPublicId(logEvent.userId) || cleanText(logEvent.userId, 120),
    toPublicId(logEvent.sectionId) || cleanText(logEvent.sectionId, 120),
    toPublicId(logEvent.operationId) || cleanText(logEvent.operationId, 120)
  ].join('::');
  const fallbackRows = actionIndexes.keyMap?.get(key) || [];
  return resolveNearestByTimestamp(fallbackRows, logEvent.occurredAtMs, FALLBACK_MATCH_WINDOW_MS);
}

function pickActionSummaryForEvent(action = null) {
  if (!action || typeof action !== 'object') return null;
  return {
    recordId: action.recordId,
    requestId: action.requestId,
    occurredAt: action.occurredAt,
    occurredAtMs: action.occurredAtMs,
    occurredAtDisplay: action.occurredAtDisplay,
    statusRaw: action.statusRaw,
    statusNormalized: action.statusNormalized,
    targetKey: action.targetKey,
    summary: action.summary,
    method: action.method,
    url: action.url,
    orgId: action.orgId,
    orgName: action.orgName,
    details: action.details
  };
}

function attachActionEnrichment(logEvents = [], actionEvents = []) {
  const actionIndexes = buildActionIndexes(actionEvents);
  return (Array.isArray(logEvents) ? logEvents : []).map((event) => {
    const matchedAction = correlateLogWithAction(event, actionIndexes);
    if (!matchedAction) return event;
    return {
      ...event,
      hasActionState: true,
      actionState: pickActionSummaryForEvent(matchedAction)
    };
  });
}

function applyEventFilters(events = [], filters = {}) {
  const list = Array.isArray(events) ? events : [];
  const sectionFilterSet = buildIdFilterSet(filters.sectionIds, filters.sectionId, 120);
  const operationFilterSet = buildIdFilterSet(filters.operationIds, filters.operationId, 120);
  const orgFilterSet = buildIdFilterSet(filters.orgIds, filters.orgId, 120);
  const userFilter = toPublicId(filters.userId) || cleanText(filters.userId, 120);
  const statusFilter = cleanText(filters.status, 80);
  const sourceFilter = cleanText(filters.source, 40);
  const startAtMs = Number(filters.startAtMs || Number.NEGATIVE_INFINITY);
  const endAtMs = Number(filters.endAtMs || Number.POSITIVE_INFINITY);

  return list.filter((event) => {
    const eventMs = Number(event?.occurredAtMs || 0);
    if (eventMs < startAtMs || eventMs > endAtMs) return false;
    if (!eventMatchesSource(event, sourceFilter)) return false;
    if (sectionFilterSet.size > 0) {
      const eventSectionId = normalizeIdToken(event.sectionId, 120);
      if (!eventSectionId || !sectionFilterSet.has(eventSectionId)) return false;
    }
    if (operationFilterSet.size > 0) {
      const eventOperationId = normalizeIdToken(event.operationId, 120);
      if (!eventOperationId || !operationFilterSet.has(eventOperationId)) return false;
    }
    if (orgFilterSet.size > 0) {
      const eventOrgId = normalizeIdToken(event.orgId, 120);
      if (!eventOrgId || !orgFilterSet.has(eventOrgId)) return false;
    }
    if (userFilter && (toPublicId(event.userId) || cleanText(event.userId, 120)) !== userFilter) return false;
    if (!eventMatchesStatus(event, statusFilter)) return false;
    if (!eventMatchesSearch(event, filters.q)) return false;
    return true;
  });
}

function buildSummary(events = []) {
  const rows = Array.isArray(events) ? events : [];
  const uniqueUsers = new Set();
  const uniqueRequests = new Set();

  const summary = rows.reduce((acc, event) => {
    acc.totalEvents += 1;
    acc.logCount += 1;
    if (event.hasActionState) acc.actionStateLinkedCount += 1;

    const status = normalizeStatus(event.statusRaw);
    if (SUCCESS_STATUS_SET.has(status)) acc.successCount += 1;
    else if (FAILURE_STATUS_SET.has(status)) acc.failureCount += 1;

    const userId = cleanText(event.userId, 120).toLowerCase();
    if (userId && userId !== 'system') uniqueUsers.add(userId);
    const requestId = cleanText(event.requestId, 120);
    if (requestId) uniqueRequests.add(requestId);

    return acc;
  }, {
    totalEvents: 0,
    logCount: 0,
    actionStateLinkedCount: 0,
    successCount: 0,
    failureCount: 0
  });

  summary.uniqueUserCount = uniqueUsers.size;
  summary.uniqueRequestCount = uniqueRequests.size;
  return summary;
}

function buildPagination(totalItems = 0, page = 1, limit = DEFAULT_PAGE_SIZE) {
  const safeTotal = Math.max(0, Number(totalItems) || 0);
  const safeLimit = clamp(Number(limit) || DEFAULT_PAGE_SIZE, MIN_PAGE_SIZE, MAX_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safeLimit));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const startItem = safeTotal > 0 ? ((currentPage - 1) * safeLimit) + 1 : 0;
  const endItem = safeTotal > 0 ? Math.min(currentPage * safeLimit, safeTotal) : 0;

  return {
    currentPage,
    totalPages,
    totalItems: safeTotal,
    limit: safeLimit,
    startItem,
    endItem
  };
}

function buildIntervalSummary(events = []) {
  const rows = Array.isArray(events) ? events : [];
  const opCounter = new Map();
  const statusCounter = { success: 0, failure: 0, other: 0 };

  rows.forEach((event) => {
    const opKey = `${event.operationId || ''}::${event.operationName || ''}`;
    opCounter.set(opKey, (opCounter.get(opKey) || 0) + 1);

    const status = normalizeStatus(event.statusRaw);
    if (SUCCESS_STATUS_SET.has(status)) statusCounter.success += 1;
    else if (FAILURE_STATUS_SET.has(status)) statusCounter.failure += 1;
    else statusCounter.other += 1;
  });

  const topOperations = Array.from(opCounter.entries())
    .map(([key, count]) => {
      const [operationId, operationName] = key.split('::');
      return { operationId, operationName, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    total: rows.length,
    linkedActionStates: rows.filter((row) => row.hasActionState).length,
    statusSplit: statusCounter,
    topOperations
  };
}

function buildTimelineLanes(rangeStartMs, rangeEndMs, timeZone = DEFAULT_ORG_TIMEZONE) {
  const lanes = [];
  let cursor = Number(rangeStartMs || 0);
  const endMs = Number(rangeEndMs || 0);

  while (cursor <= endMs) {
    const bounds = getDayBoundsMs(cursor, timeZone);
    if (!Number.isFinite(bounds.dayStartMs) || !Number.isFinite(bounds.dayEndMs)) break;

    const laneStart = Math.max(bounds.dayStartMs, rangeStartMs);
    const laneEnd = Math.min(bounds.dayEndMs, rangeEndMs);
    if (laneEnd >= laneStart) {
      lanes.push({
        id: `lane:${bounds.dateKey}`,
        dateKey: bounds.dateKey,
        label: formatDateInTimezone(laneStart, timeZone),
        startAtMs: laneStart,
        endAtMs: laneEnd,
        dayStartMs: bounds.dayStartMs,
        dayEndMs: bounds.dayEndMs,
        startAt: new Date(laneStart).toISOString(),
        endAt: new Date(laneEnd).toISOString(),
        durationMs: Math.max(1, laneEnd - laneStart + 1),
        buckets: []
      });
    }

    cursor = bounds.dayEndMs + 1;
  }

  return lanes;
}

function aggregateBucketsForLane(lane = {}, events = [], bucketSizeMs = 30 * 60 * 1000, timeZone = DEFAULT_ORG_TIMEZONE) {
  const bucketMap = new Map();

  (Array.isArray(events) ? events : []).forEach((event) => {
    const eventMs = Number(event?.occurredAtMs || 0);
    if (eventMs < lane.startAtMs || eventMs > lane.endAtMs) return;

    const idx = Math.floor((eventMs - lane.dayStartMs) / bucketSizeMs);
    if (!Number.isFinite(idx) || idx < 0) return;

    const bucketStartAtMs = lane.dayStartMs + (idx * bucketSizeMs);
    const bucketEndAtMs = Math.min(bucketStartAtMs + bucketSizeMs - 1, lane.dayEndMs);
    if (bucketEndAtMs < lane.startAtMs || bucketStartAtMs > lane.endAtMs) return;

    const clippedStart = Math.max(bucketStartAtMs, lane.startAtMs);
    const clippedEnd = Math.min(bucketEndAtMs, lane.endAtMs);
    const bucketId = `bucket:${lane.dateKey}:${bucketSizeMs}:${idx}`;

    if (!bucketMap.has(bucketId)) {
      bucketMap.set(bucketId, {
        bucketId,
        laneId: lane.id,
        zoomBucketSizeMs: bucketSizeMs,
        startAtMs: clippedStart,
        endAtMs: clippedEnd,
        startAt: new Date(clippedStart).toISOString(),
        endAt: new Date(clippedEnd).toISOString(),
        startAtDisplay: formatDateTimeInTimezone(clippedStart, timeZone),
        endAtDisplay: formatDateTimeInTimezone(clippedEnd, timeZone),
        count: 0,
        linkedActionStates: 0,
        statusSplit: { success: 0, failure: 0, other: 0 },
        sourceSplit: { log: 0, action_state: 0 },
        topOperations: new Map(),
        sampleEventIds: []
      });
    }

    const bucket = bucketMap.get(bucketId);
    bucket.count += 1;
    bucket.sourceSplit.log += 1;
    if (event.hasActionState) {
      bucket.linkedActionStates += 1;
      bucket.sourceSplit.action_state += 1;
    }

    const status = normalizeStatus(event.statusRaw);
    if (SUCCESS_STATUS_SET.has(status)) bucket.statusSplit.success += 1;
    else if (FAILURE_STATUS_SET.has(status)) bucket.statusSplit.failure += 1;
    else bucket.statusSplit.other += 1;

    const opKey = `${event.operationId || ''}::${event.operationName || ''}`;
    bucket.topOperations.set(opKey, (bucket.topOperations.get(opKey) || 0) + 1);

    if (bucket.sampleEventIds.length < 5) bucket.sampleEventIds.push(event.id);
  });

  return Array.from(bucketMap.values())
    .sort((a, b) => a.startAtMs - b.startAtMs)
    .map((bucket) => {
      const topOperations = Array.from(bucket.topOperations.entries())
        .map(([key, count]) => {
          const [operationId, operationName] = key.split('::');
          return { operationId, operationName, count };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

      const midPointMs = bucket.startAtMs + ((bucket.endAtMs - bucket.startAtMs) / 2);
      const offsetPct = ((midPointMs - lane.startAtMs) / lane.durationMs) * 100;

      return {
        bucketId: bucket.bucketId,
        laneId: bucket.laneId,
        zoomBucketSizeMs: bucket.zoomBucketSizeMs,
        startAtMs: bucket.startAtMs,
        endAtMs: bucket.endAtMs,
        startAt: bucket.startAt,
        endAt: bucket.endAt,
        startAtDisplay: bucket.startAtDisplay,
        endAtDisplay: bucket.endAtDisplay,
        count: bucket.count,
        linkedActionStates: bucket.linkedActionStates,
        statusSplit: bucket.statusSplit,
        sourceSplit: bucket.sourceSplit,
        topOperations,
        sampleEventIds: bucket.sampleEventIds,
        offsetPct: Math.min(100, Math.max(0, Number(offsetPct.toFixed(4))))
      };
    });
}

function buildTimelineBuckets(lanes = [], events = [], zoomLevel = '30m', timeZone = DEFAULT_ORG_TIMEZONE) {
  const bucketSizeMs = zoomLevel === '5m'
    ? 5 * 60 * 1000
    : 30 * 60 * 1000;

  return (Array.isArray(lanes) ? lanes : []).map((lane) => ({
    ...lane,
    buckets: aggregateBucketsForLane(lane, events, bucketSizeMs, timeZone)
  }));
}

function toEventRow(event = {}) {
  return {
    eventId: event.id,
    occurredAt: event.occurredAt,
    occurredAtDisplay: event.occurredAtDisplay,
    requestId: event.requestId,
    actionStateId: event.actionStateId,
    statusRaw: event.statusRaw,
    statusNormalized: event.statusNormalized,
    summary: event.summary,
    sectionId: event.sectionId,
    sectionName: event.sectionName,
    operationId: event.operationId,
    operationName: event.operationName,
    userId: event.userId,
    username: event.username,
    displayName: event.displayName,
    actorPrimary: event.actorPrimary,
    actorSecondary: event.actorSecondary,
    orgId: event.orgId,
    orgName: event.orgName,
    source: event.source,
    sourceLabel: event.sourceLabel,
    hasActionState: Boolean(event.hasActionState),
    actionStateStatus: cleanText(event.actionState?.statusRaw, 80),
    recordId: event.recordId,
    contextLine: event.contextLine
  };
}

function buildSafeFiltersForResponse(filters = {}) {
  const sectionIds = parseIdList(filters.sectionIds || filters.sectionId, 120, 200);
  const operationIds = parseIdList(filters.operationIds || filters.operationId, 120, 200);
  const orgIds = parseIdList(filters.orgIds || filters.orgId, 120, 200);

  return {
    startAt: filters.startAt,
    endAt: filters.endAt,
    source: filters.source,
    status: filters.status,
    sectionId: sectionIds[0] || '',
    operationId: operationIds[0] || '',
    orgId: orgIds[0] || '',
    sectionIds,
    operationIds,
    orgIds,
    userId: filters.userId,
    q: filters.q,
    zoomLevel: filters.zoomLevel,
    focusStartAt: filters.focusStartAt,
    focusEndAt: filters.focusEndAt,
    page: filters.page,
    limit: filters.limit,
    maxRows: filters.maxRows,
    rangeTrimmed: Boolean(filters.rangeTrimmed)
  };
}

function hasAdminPower(requestUser = null) {
  const user = requestUser || {};
  if (adminAuthorityService.isAdmin(user)) return true;
  if (cleanText(user.role, 40).toLowerCase() === 'admin') return true;

  const activeOrgId = toPublicId(user.activeOrgId || user.primaryOrgId || '');
  const rows = Array.isArray(user.allowedOrgs) ? user.allowedOrgs : [];
  const target = rows.find((row) => toPublicId(row?.orgId || row?.id || '') === activeOrgId) || null;
  const roles = Array.isArray(target?.roles) ? target.roles : (target?.role ? [target.role] : []);
  return roles
    .map((role) => cleanText(role, 60).toLowerCase())
    .some((role) => ['admin', 'owner', 'superadmin', 'super_admin', 'system_admin'].includes(role));
}

function resolveScopedUserId(requestUser = null, requestedUserId = '') {
  const requested = toPublicId(requestedUserId) || cleanText(requestedUserId, 120);
  const selfUserId = toPublicId(requestUser?.id) || cleanText(requestUser?.id, 120);
  if (hasAdminPower(requestUser)) {
    return requested || '';
  }
  if (!selfUserId) {
    return requested || '';
  }
  if (requested && requested !== selfUserId) {
    throw new Error('Selected user is outside your access scope.');
  }
  return selfUserId;
}

function maskSensitiveValue(key = '', value = null) {
  const keyToken = cleanText(key, 120);
  if (SENSITIVE_KEY_PATTERN.test(keyToken)) return '[MASKED]';

  if (typeof value === 'string' && value.length > 1200) {
    return `${value.slice(0, 1200)} ...`;
  }

  return value;
}

function maskSensitiveObject(value, parentKey = '') {
  if (Array.isArray(value)) return value.map((item) => maskSensitiveObject(item, parentKey));
  if (!value || typeof value !== 'object') return maskSensitiveValue(parentKey, value);

  const output = {};
  Object.entries(value).forEach(([key, inner]) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = '[MASKED]';
      return;
    }
    output[key] = maskSensitiveObject(inner, key);
  });
  return output;
}

function sanitizeCsvCellForSpreadsheet(value) {
  const text = String(value ?? '');
  if (!text) return '';
  const cleaned = text.replace(/\u0000/g, '');
  const leftTrimmed = cleaned.replace(/^\s+/, '');
  if (DANGEROUS_CSV_PREFIX.test(leftTrimmed)) return `\t${cleaned}`;
  return cleaned;
}

function buildDefaultPageFilters(query = {}, fallbackTimeZone = DEFAULT_ORG_TIMEZONE) {
  const nowMs = Date.now();
  const defaultRange = resolveDefaultRangeMs(nowMs);

  const startToken = cleanText(query.startAt || '', 80);
  const endToken = cleanText(query.endAt || '', 80);
  const fallbackStart = formatMsToDateTimeLocalInput(defaultRange.startAtMs, fallbackTimeZone);
  const fallbackEnd = formatMsToDateTimeLocalInput(defaultRange.endAtMs, fallbackTimeZone);
  const sectionIds = parseIdList(query.sectionIds ?? query.sectionId, 120, 200);
  const operationIds = parseIdList(query.operationIds ?? query.operationId, 120, 200);
  const orgIds = parseIdList(query.orgIds ?? query.orgId, 120, 200);

  return {
    startAt: startToken || fallbackStart,
    endAt: endToken || fallbackEnd,
    source: normalizeSource(query.source),
    status: cleanText(query.status, 80),
    sectionId: sectionIds[0] || '',
    operationId: operationIds[0] || '',
    orgId: orgIds[0] || '',
    sectionIds,
    operationIds,
    orgIds,
    userId: cleanText(query.userId, 120),
    q: cleanText(query.q, 220),
    zoomLevel: normalizeZoomLevel(query.zoomLevel),
    focusStartAt: cleanText(query.focusStartAt, 80),
    focusEndAt: cleanText(query.focusEndAt, 80),
    page: parsePositiveInteger(query.page, 1) || 1,
    limit: clamp(parsePositiveInteger(query.limit, DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE, MIN_PAGE_SIZE, MAX_PAGE_SIZE)
  };
}

function resolveActiveOrgId(requestUser = null, rawOrgId = '') {
  const explicitOrg = toPublicId(rawOrgId || '');
  if (explicitOrg) return explicitOrg;
  return toPublicId(requestUser?.activeOrgId || requestUser?.primaryOrgId || '');
}

async function fetchLookups(requestUser = null) {
  const [sections, operations, organizations] = await Promise.all([
    dataService.fetchData('sections', { sort: 'name' }, requestUser),
    dataService.fetchData('operations', { sort: 'name' }, requestUser),
    dataService.fetchData('organizations', { sort: 'name' }, requestUser)
  ]);

  return {
    sections: Array.isArray(sections) ? sections : [],
    operations: Array.isArray(operations) ? operations : [],
    organizations: Array.isArray(organizations) ? organizations : []
  };
}

async function fetchUsersByIds(userIds = [], requestUser = null) {
  const uniqueIds = Array.from(new Set((Array.isArray(userIds) ? userIds : [])
    .map((id) => toPublicId(id) || cleanText(id, 120))
    .filter((id) => id && !isSystemActorToken(id))));
  if (!uniqueIds.length) return [];

  return dataService.fetchData('users', {
    id__in: uniqueIds.join(','),
    limit: Math.max(200, uniqueIds.length * 2)
  }, requestUser);
}

function parseTimelineFilters(rawQuery = {}, timeZone = DEFAULT_ORG_TIMEZONE) {
  const source = normalizeSource(rawQuery.source);
  const zoomLevel = normalizeZoomLevel(rawQuery.zoomLevel);
  const status = cleanText(rawQuery.status, 80);
  const sectionIds = parseIdList(rawQuery.sectionIds ?? rawQuery.sectionId, 120, 200);
  const operationIds = parseIdList(rawQuery.operationIds ?? rawQuery.operationId, 120, 200);
  const orgIds = parseIdList(rawQuery.orgIds ?? rawQuery.orgId, 120, 200);
  const sectionId = sectionIds[0] || '';
  const operationId = operationIds[0] || '';
  const orgId = orgIds[0] || '';
  const userId = cleanText(rawQuery.userId, 120);
  const q = cleanText(rawQuery.q, 220);
  const maxRows = clamp(parsePositiveInteger(rawQuery.maxRows, DEFAULT_MERGE_LIMIT) || DEFAULT_MERGE_LIMIT, MIN_MERGE_LIMIT, MAX_MERGE_LIMIT);
  const page = parsePositiveInteger(rawQuery.page, 1) || 1;
  const limit = clamp(parsePositiveInteger(rawQuery.limit, DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE, MIN_PAGE_SIZE, MAX_PAGE_SIZE);
  const explicitStartAtMs = Number(rawQuery.startAtMs);
  const explicitEndAtMs = Number(rawQuery.endAtMs);
  const hasExplicitStartAtMs = Number.isFinite(explicitStartAtMs);
  const hasExplicitEndAtMs = Number.isFinite(explicitEndAtMs);

  const defaults = resolveDefaultRangeMs(Date.now());
  const parsedStartMs = hasExplicitStartAtMs ? explicitStartAtMs : parseDateTimeInputToMs(rawQuery.startAt, timeZone);
  const parsedEndMs = hasExplicitEndAtMs ? explicitEndAtMs : parseDateTimeInputToMs(rawQuery.endAt, timeZone);

  const legacyStartMs = Number.isNaN(parsedStartMs)
    ? parseDateTimeInputToMs(rawQuery.startDate, timeZone, { endOfDay: false })
    : parsedStartMs;
  const legacyEndMs = Number.isNaN(parsedEndMs)
    ? parseDateTimeInputToMs(rawQuery.endDate, timeZone, { endOfDay: true })
    : parsedEndMs;

  let startAtMs = Number.isNaN(legacyStartMs) ? defaults.startAtMs : legacyStartMs;
  let endAtMs = Number.isNaN(legacyEndMs) ? defaults.endAtMs : legacyEndMs;

  if (startAtMs > endAtMs) {
    const tmp = startAtMs;
    startAtMs = endAtMs;
    endAtMs = tmp;
  }

  let rangeTrimmed = false;
  if ((endAtMs - startAtMs) > MAX_RANGE_MS) {
    endAtMs = (startAtMs + MAX_RANGE_MS) - 1;
    rangeTrimmed = true;
  }

  let focusStartAtMs = parseDateTimeInputToMs(rawQuery.focusStartAt, timeZone);
  let focusEndAtMs = parseDateTimeInputToMs(rawQuery.focusEndAt, timeZone);
  if (Number.isNaN(focusStartAtMs)) focusStartAtMs = startAtMs;
  if (Number.isNaN(focusEndAtMs)) focusEndAtMs = endAtMs;
  if (focusStartAtMs > focusEndAtMs) {
    const tmp = focusStartAtMs;
    focusStartAtMs = focusEndAtMs;
    focusEndAtMs = tmp;
  }
  focusStartAtMs = Math.max(startAtMs, focusStartAtMs);
  focusEndAtMs = Math.min(endAtMs, focusEndAtMs);

  return {
    source,
    zoomLevel,
    status,
    sectionId,
    operationId,
    orgId,
    sectionIds,
    operationIds,
    orgIds,
    userId,
    q,
    maxRows,
    page,
    limit,
    startAtMs,
    endAtMs,
    startAt: new Date(startAtMs).toISOString(),
    endAt: new Date(endAtMs).toISOString(),
    focusStartAtMs,
    focusEndAtMs,
    focusStartAt: new Date(focusStartAtMs).toISOString(),
    focusEndAt: new Date(focusEndAtMs).toISOString(),
    rangeTrimmed
  };
}

async function resolveTimelineTimezone(filters = {}, requestUser = null, lookups = null) {
  const fallback = resolveDefaultTimezone();
  const targetOrgFilterId = pickPrimaryId(filters.orgIds, filters.orgId, 120);
  const targetOrgId = resolveActiveOrgId(requestUser, targetOrgFilterId);

  const fromAllowedOrg = resolveAllowedOrgTimezoneFromUser(requestUser, targetOrgId);
  if (fromAllowedOrg) return fromAllowedOrg;

  const orgRows = lookups && Array.isArray(lookups.organizations)
    ? lookups.organizations
    : [];

  const targetRow = orgRows.find((row) => toPublicId(row?.id || row?.orgId || '') === targetOrgId) || null;
  if (targetRow) return resolveOrganizationTimezoneFromRow(targetRow);

  if (targetOrgId) {
    try {
      const row = await dataService.getDataById('organizations', targetOrgId, requestUser);
      return resolveOrganizationTimezoneFromRow(row || {});
    } catch (_) {
      return fallback;
    }
  }

  return fallback;
}

function buildDateTokensForQuery(startAtMs, endAtMs, timeZone = DEFAULT_ORG_TIMEZONE) {
  const shiftDateKey = (dateKey = '', deltaDays = 0) => {
    const token = cleanText(dateKey, 20);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return '';
    const base = new Date(`${token}T00:00:00.000Z`);
    if (Number.isNaN(base.getTime())) return '';
    base.setUTCDate(base.getUTCDate() + Number(deltaDays || 0));
    const yyyy = String(base.getUTCFullYear()).padStart(4, '0');
    const mm = String(base.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(base.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const exactStartDate = toDateKeyInTimezone(startAtMs, timeZone);
  const exactEndDate = toDateKeyInTimezone(endAtMs, timeZone);
  return {
    exactStartDate,
    exactEndDate,
    startDate: shiftDateKey(exactStartDate, -1) || exactStartDate,
    endDate: shiftDateKey(exactEndDate, 1) || exactEndDate
  };
}

async function loadCanonicalEvents(rawQuery = {}, requestUser = null, options = {}) {
  const lookups = options.lookups || await fetchLookups(requestUser);
  const timezone = options.timezone || await resolveTimelineTimezone(rawQuery, requestUser, lookups);
  const filters = parseTimelineFilters(rawQuery, timezone);
  filters.userId = resolveScopedUserId(requestUser, filters.userId);
  const sectionIds = parseIdList(filters.sectionIds || filters.sectionId, 120, 200);
  const operationIds = parseIdList(filters.operationIds || filters.operationId, 120, 200);
  const orgIds = parseIdList(filters.orgIds || filters.orgId, 120, 200);

  const dateTokens = buildDateTokensForQuery(filters.startAtMs, filters.endAtMs, timezone);
  const sharedQuery = {
    userId: filters.userId || undefined,
    startDate: dateTokens.startDate,
    endDate: dateTokens.endDate,
    page: 1,
    limit: filters.maxRows
  };
  if (sectionIds.length === 1) sharedQuery.sectionId = sectionIds[0];
  else if (sectionIds.length > 1) sharedQuery.sectionId__in = sectionIds.join(',');
  if (operationIds.length === 1) sharedQuery.operationId = operationIds[0];
  else if (operationIds.length > 1) sharedQuery.operationId__in = operationIds.join(',');

  const logQuery = {
    ...sharedQuery,
    q: filters.q || undefined,
    sort: '-timestamp'
  };
  if (orgIds.length === 1) logQuery.orgId__eq = orgIds[0];
  else if (orgIds.length > 1) logQuery.orgId__in = orgIds.join(',');
  if (filters.status) logQuery.status__contains = filters.status;

  const actionQuery = {
    ...sharedQuery,
    q: filters.q || undefined,
    sort: '-startedAt,-createdAt,-updatedAt'
  };
  if (orgIds.length) actionQuery.orgId__in = orgIds.join(',');
  if (filters.status) actionQuery.status__contains = filters.status;

  const [logs, actionStates] = await Promise.all([
    dataService.fetchData('logs', logQuery, requestUser),
    dataService.fetchData('actionStates', actionQuery, requestUser)
  ]);

  const userIds = [];
  (Array.isArray(logs) ? logs : []).forEach((log) => {
    userIds.push(log?.userId);
    if (log && typeof log.details?.actor === 'object') userIds.push(log.details.actor.userId);
  });
  (Array.isArray(actionStates) ? actionStates : []).forEach((state) => {
    userIds.push(state?.userId);
    userIds.push(resolveActionContextValue(state, ['userId']));
  });

  const users = await fetchUsersByIds(userIds, requestUser);
  const lookupMaps = {
    sectionMap: buildLookupMap(lookups.sections),
    operationMap: buildLookupMap(lookups.operations),
    orgMap: buildLookupMap(lookups.organizations),
    userMap: buildLookupMap(users)
  };

  const actionEvents = (Array.isArray(actionStates) ? actionStates : [])
    .map((row) => buildActionStateProjection(row, lookupMaps, timezone));

  const logEvents = (Array.isArray(logs) ? logs : [])
    .map((row) => buildLogEvent(row, lookupMaps, timezone));

  const enrichedEvents = attachActionEnrichment(logEvents, actionEvents);

  const filteredEvents = applyEventFilters(enrichedEvents, filters)
    .sort((a, b) => Number(b.occurredAtMs || 0) - Number(a.occurredAtMs || 0));

  return {
    filters,
    timezone,
    lookups,
    events: filteredEvents
  };
}

function mapRangeMeta(filters = {}, timezone = DEFAULT_ORG_TIMEZONE) {
  return {
    startAt: filters.startAt,
    endAt: filters.endAt,
    startAtMs: filters.startAtMs,
    endAtMs: filters.endAtMs,
    focusStartAt: filters.focusStartAt,
    focusEndAt: filters.focusEndAt,
    focusStartAtMs: filters.focusStartAtMs,
    focusEndAtMs: filters.focusEndAtMs,
    timezone,
    rangeTrimmed: Boolean(filters.rangeTrimmed),
    maxRangeDays: MAX_RANGE_DAYS
  };
}

function toHourLabel(hour) {
  const safe = clamp(Number(hour) || 0, 0, 23);
  const token = String(safe).padStart(2, '0');
  return `${token}:00 - ${token}:59`;
}

function toHourIsoWindow(dayStartMs, hourOffsetMs) {
  const startMs = Number(dayStartMs || 0) + Number(hourOffsetMs || 0);
  const endMs = startMs + (60 * 60 * 1000) - 1;
  return {
    startAtMs: startMs,
    endAtMs: endMs,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString()
  };
}

function normalizeTrackTimelineZoomLevel(value) {
  const token = cleanText(value, 20).toLowerCase();
  if (token === '5m') return '5m';
  if (token === '15s') return '15s';
  return 'hourly';
}

function normalizeHourIndex(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) return -1;
  return parsed;
}

function normalizeFiveMinuteIndex(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 11) return -1;
  return parsed;
}

function formatLocalDateKey(ms) {
  const date = new Date(Number(ms || 0));
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalTimeParts(ms) {
  const date = new Date(Number(ms || 0));
  if (Number.isNaN(date.getTime())) return null;
  return {
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds()
  };
}

function buildDayWindows(rangeStartMs, rangeEndMs, timezone = DEFAULT_ORG_TIMEZONE) {
  const windows = [];
  const startDate = new Date(Number(rangeStartMs || 0));
  const endDate = new Date(Number(rangeEndMs || 0));
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return windows;
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);

  const cursor = new Date(startDate);
  while (cursor <= endDate && windows.length < MAX_RANGE_DAYS) {
    const dayStartMs = cursor.getTime();
    const dayEndMs = dayStartMs + (24 * 60 * 60 * 1000) - 1;
    windows.push({
      dateKey: formatLocalDateKey(dayStartMs),
      dayStartMs,
      dayEndMs
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return windows;
}

function toFiveMinuteLabel(hour, fiveMinuteIndex) {
  const safeHour = clamp(Number(hour) || 0, 0, 23);
  const safeFive = clamp(Number(fiveMinuteIndex) || 0, 0, 11);
  const startMinute = safeFive * 5;
  const endMinute = startMinute + 4;
  return `${String(safeHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')} - ${String(safeHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
}

function toFifteenSecondLabel(hour, fiveMinuteIndex, secondChunkIndex) {
  const safeHour = clamp(Number(hour) || 0, 0, 23);
  const safeFive = clamp(Number(fiveMinuteIndex) || 0, 0, 11);
  const safeChunk = clamp(Number(secondChunkIndex) || 0, 0, 19);
  const minuteBase = safeFive * 5;
  const startTotalSeconds = safeChunk * 15;
  const endTotalSeconds = startTotalSeconds + 14;
  const startMinuteOffset = Math.floor(startTotalSeconds / 60);
  const endMinuteOffset = Math.floor(endTotalSeconds / 60);
  const startSecond = startTotalSeconds % 60;
  const endSecond = endTotalSeconds % 60;
  const startMinute = minuteBase + startMinuteOffset;
  const endMinute = minuteBase + endMinuteOffset;
  return `${String(safeHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}:${String(startSecond).padStart(2, '0')} - ${String(safeHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:${String(endSecond).padStart(2, '0')}`;
}

function buildEmptyMetricSlots(length = 0) {
  return Array.from({ length: Math.max(0, Number(length) || 0) }, () => ({
    requestCount: 0,
    attemptCount: 0
  }));
}

function applyColorWeights(chunks = []) {
  const busiest = (Array.isArray(chunks) ? chunks : [])
    .reduce((max, row) => Math.max(max, Number(row?.requestCount || 0)), 0);

  (Array.isArray(chunks) ? chunks : []).forEach((row) => {
    const ratio = busiest > 0 ? (Number(row.requestCount || 0) / busiest) : 0;
    row.colorWeight = Number(ratio.toFixed(3));
  });

  return busiest;
}

function isAttemptLikeLog(log = {}, sectionName = '', operationName = '') {
  const sectionToken = cleanText(sectionName || log?.sectionId, 140).toLowerCase();
  const operationToken = cleanText(operationName || log?.operationId, 140).toLowerCase();
  const details = (log && typeof log.details === 'object') ? log.details : {};
  const urlToken = cleanText(details.url || details.targetUrl || details.path, 260).toLowerCase();

  if (sectionToken.includes('attempt') || operationToken.includes('attempt')) return true;
  if (urlToken.includes('/attempt')) return true;
  if (urlToken.includes('/practice/start') || urlToken.includes('/practice/attempt')) return true;
  return false;
}

async function fetchTrackActivityHourlyTimeline(rawQuery = {}, requestUser = null) {
  const lookups = await fetchLookups(requestUser);
  const timezone = await resolveTimelineTimezone(rawQuery, requestUser, lookups);
  const filters = parseTimelineFilters(rawQuery, timezone);
  filters.userId = resolveScopedUserId(requestUser, filters.userId);
  const requestedZoomLevel = normalizeTrackTimelineZoomLevel(rawQuery?.zoomLevel);
  const focusDay = cleanText(rawQuery?.focusDay, 20);
  const focusHour = normalizeHourIndex(rawQuery?.focusHour);
  const focusFiveMinute = normalizeFiveMinuteIndex(rawQuery?.focusFiveMinute);

  let dayWindows = buildDayWindows(filters.startAtMs, filters.endAtMs, timezone);
  if (!dayWindows.length) {
    const fallbackDate = new Date(Number(filters.endAtMs || Date.now()));
    if (Number.isNaN(fallbackDate.getTime())) fallbackDate.setTime(Date.now());
    fallbackDate.setHours(0, 0, 0, 0);
    const fallbackStartMs = fallbackDate.getTime();
    dayWindows = [{
      dateKey: formatLocalDateKey(fallbackStartMs),
      dayStartMs: fallbackStartMs,
      dayEndMs: fallbackStartMs + (24 * 60 * 60 * 1000) - 1
    }];
  }

  const dateTokens = buildDateTokensForQuery(filters.startAtMs, filters.endAtMs, timezone);
  const rangeStartDateKey = cleanText(dateTokens.startDate, 20)
    || cleanText(dayWindows[0]?.dateKey, 20)
    || toDateKeyInTimezone(filters.startAtMs, timezone);
  const rangeEndDateKey = cleanText(dateTokens.endDate, 20)
    || cleanText(dayWindows[dayWindows.length - 1]?.dateKey, 20)
    || toDateKeyInTimezone(filters.endAtMs, timezone);
  const sectionIds = parseIdList(filters.sectionIds || filters.sectionId, 120, 200);
  const operationIds = parseIdList(filters.operationIds || filters.operationId, 120, 200);
  const orgIds = parseIdList(filters.orgIds || filters.orgId, 120, 200);
  const dayWindowMap = new Map();
  const dayHourCounters = new Map();
  dayWindows.forEach((window) => {
    const key = cleanText(window?.dateKey, 20);
    if (!key) return;
    dayWindowMap.set(key, window);
    dayHourCounters.set(key, buildEmptyMetricSlots(24));
  });

  const logQuery = {
    page: 1,
    limit: filters.maxRows,
    startDate: rangeStartDateKey,
    endDate: rangeEndDateKey,
    userId: filters.userId || undefined,
    q: filters.q || undefined,
    sort: '-timestamp'
  };
  if (sectionIds.length === 1) logQuery.sectionId = sectionIds[0];
  else if (sectionIds.length > 1) logQuery.sectionId__in = sectionIds.join(',');
  if (operationIds.length === 1) logQuery.operationId = operationIds[0];
  else if (operationIds.length > 1) logQuery.operationId__in = operationIds.join(',');
  if (orgIds.length === 1) logQuery.orgId__eq = orgIds[0];
  else if (orgIds.length > 1) logQuery.orgId__in = orgIds.join(',');
  if (filters.status) logQuery.status__contains = filters.status;

  const logs = await dataService.fetchData('logs', logQuery, requestUser);
  const sectionMap = buildLookupMap(lookups.sections);
  const operationMap = buildLookupMap(lookups.operations);
  const fiveMinuteCounters = new Map();
  const fifteenSecondCounters = new Map();

  const ensureFiveMinuteSlots = (key) => {
    if (!fiveMinuteCounters.has(key)) fiveMinuteCounters.set(key, buildEmptyMetricSlots(12));
    return fiveMinuteCounters.get(key);
  };
  const ensureFifteenSecondSlots = (key) => {
    if (!fifteenSecondCounters.has(key)) fifteenSecondCounters.set(key, buildEmptyMetricSlots(20));
    return fifteenSecondCounters.get(key);
  };

  (Array.isArray(logs) ? logs : []).forEach((log) => {
    const timestampToken = resolveLogTimestamp(log);
    if (!timestampToken) return;
    const occurredAtMs = new Date(timestampToken).getTime();
    if (!Number.isFinite(occurredAtMs)) return;
    if (occurredAtMs < filters.startAtMs || occurredAtMs > filters.endAtMs) return;

    const dayKey = formatLocalDateKey(occurredAtMs);
    const daySlots = dayHourCounters.get(dayKey);
    if (!Array.isArray(daySlots)) return;

    const hourParts = getLocalTimeParts(occurredAtMs);
    const hour = clamp(Number(hourParts?.hour || 0), 0, 23);
    const minute = clamp(Number(hourParts?.minute || 0), 0, 59);
    const second = clamp(Number(hourParts?.second || 0), 0, 59);
    const slot = daySlots[hour];
    if (!slot) return;

    const sectionInfo = resolveSectionInfo(log.sectionId, sectionMap);
    const operationInfo = resolveOperationInfo(log.operationId, operationMap);
    slot.requestCount += 1;
    const fiveMinuteIndex = clamp(Math.floor(minute / 5), 0, 11);
    const fiveMinuteKey = `${dayKey}|${hour}`;
    const fiveSlots = ensureFiveMinuteSlots(fiveMinuteKey);
    fiveSlots[fiveMinuteIndex].requestCount += 1;

    const secondOffset = ((minute % 5) * 60) + second;
    const fifteenSecondIndex = clamp(Math.floor(secondOffset / 15), 0, 19);
    const fifteenSecondKey = `${dayKey}|${hour}|${fiveMinuteIndex}`;
    const fifteenSlots = ensureFifteenSecondSlots(fifteenSecondKey);
    fifteenSlots[fifteenSecondIndex].requestCount += 1;

    if (isAttemptLikeLog(log, sectionInfo?.name, operationInfo?.name)) {
      slot.attemptCount += 1;
      fiveSlots[fiveMinuteIndex].attemptCount += 1;
      fifteenSlots[fifteenSecondIndex].attemptCount += 1;
    }
  });

  const dayTimelines = dayWindows.map((window) => {
    const key = cleanText(window?.dateKey, 20);
    const dayStartMs = Number(window?.dayStartMs || 0);
    const dayEndMs = Number(window?.dayEndMs || (dayStartMs + (24 * 60 * 60 * 1000) - 1));
    const daySlots = dayHourCounters.get(key) || buildEmptyMetricSlots(24);
    const chunks = Array.from({ length: 24 }, (_, hour) => {
      const slot = daySlots[hour] || { requestCount: 0, attemptCount: 0 };
      const hourWindow = toHourIsoWindow(dayStartMs, hour * 60 * 60 * 1000);
      return {
        hour,
        label: toHourLabel(hour),
        requestCount: Number(slot.requestCount || 0),
        attemptCount: Number(slot.attemptCount || 0),
        ...hourWindow,
        colorWeight: 0
      };
    });
    const busiest = applyColorWeights(chunks);
    const totalRequests = chunks.reduce((sum, chunk) => sum + Number(chunk.requestCount || 0), 0);
    const totalAttempts = chunks.reduce((sum, chunk) => sum + Number(chunk.attemptCount || 0), 0);
    return {
      dateKey: key,
      label: formatDateInTimezone(dayStartMs, timezone),
      startAt: new Date(dayStartMs).toISOString(),
      endAt: new Date(dayEndMs).toISOString(),
      startAtDisplay: formatDateTimeInTimezone(dayStartMs, timezone),
      endAtDisplay: formatDateTimeInTimezone(dayEndMs, timezone),
      totalRequests,
      totalAttempts,
      busiestChunkRequests: busiest,
      chunks
    };
  });

  const totalRequests = dayTimelines.reduce((sum, day) => sum + Number(day.totalRequests || 0), 0);
  const totalAttempts = dayTimelines.reduce((sum, day) => sum + Number(day.totalAttempts || 0), 0);
  const globalBusiestHour = dayTimelines.reduce((max, day) => Math.max(max, Number(day.busiestChunkRequests || 0)), 0);

  let zoomLevel = requestedZoomLevel;
  let focusTimeline = null;

  if (requestedZoomLevel === '5m') {
    const focusWindow = dayWindowMap.get(focusDay);
    if (focusWindow && focusHour >= 0) {
      const fiveKey = `${focusDay}|${focusHour}`;
      const fiveSlots = fiveMinuteCounters.get(fiveKey) || buildEmptyMetricSlots(12);
      const hourWindow = toHourIsoWindow(focusWindow.dayStartMs, focusHour * 60 * 60 * 1000);
      const chunks = Array.from({ length: 12 }, (_, index) => {
        const startMs = Number(hourWindow.startAtMs) + (index * 5 * 60 * 1000);
        const endMs = startMs + (5 * 60 * 1000) - 1;
        const slot = fiveSlots[index] || { requestCount: 0, attemptCount: 0 };
        return {
          index,
          label: toFiveMinuteLabel(focusHour, index),
          requestCount: Number(slot.requestCount || 0),
          attemptCount: Number(slot.attemptCount || 0),
          startAtMs: startMs,
          endAtMs: endMs,
          startAt: new Date(startMs).toISOString(),
          endAt: new Date(endMs).toISOString(),
          startAtDisplay: formatDateTimeInTimezone(startMs, timezone),
          endAtDisplay: formatDateTimeInTimezone(endMs, timezone),
          colorWeight: 0
        };
      });
      applyColorWeights(chunks);
      focusTimeline = {
        zoomLevel: '5m',
        dateKey: focusDay,
        hour: focusHour,
        title: `${formatDateInTimezone(focusWindow.dayStartMs, timezone)} • ${toHourLabel(focusHour)}`,
        subtitle: '5-minute chunks',
        chunks
      };
    } else {
      zoomLevel = 'hourly';
    }
  } else if (requestedZoomLevel === '15s') {
    const focusWindow = dayWindowMap.get(focusDay);
    if (focusWindow && focusHour >= 0 && focusFiveMinute >= 0) {
      const fifteenKey = `${focusDay}|${focusHour}|${focusFiveMinute}`;
      const fifteenSlots = fifteenSecondCounters.get(fifteenKey) || buildEmptyMetricSlots(20);
      const hourWindow = toHourIsoWindow(focusWindow.dayStartMs, focusHour * 60 * 60 * 1000);
      const focusFiveStartMs = Number(hourWindow.startAtMs) + (focusFiveMinute * 5 * 60 * 1000);
      const chunks = Array.from({ length: 20 }, (_, index) => {
        const startMs = focusFiveStartMs + (index * 15 * 1000);
        const endMs = startMs + (15 * 1000) - 1;
        const slot = fifteenSlots[index] || { requestCount: 0, attemptCount: 0 };
        return {
          index,
          label: toFifteenSecondLabel(focusHour, focusFiveMinute, index),
          requestCount: Number(slot.requestCount || 0),
          attemptCount: Number(slot.attemptCount || 0),
          startAtMs: startMs,
          endAtMs: endMs,
          startAt: new Date(startMs).toISOString(),
          endAt: new Date(endMs).toISOString(),
          startAtDisplay: formatDateTimeInTimezone(startMs, timezone),
          endAtDisplay: formatDateTimeInTimezone(endMs, timezone),
          colorWeight: 0
        };
      });
      applyColorWeights(chunks);
      focusTimeline = {
        zoomLevel: '15s',
        dateKey: focusDay,
        hour: focusHour,
        fiveMinute: focusFiveMinute,
        title: `${formatDateInTimezone(focusWindow.dayStartMs, timezone)} • ${toFiveMinuteLabel(focusHour, focusFiveMinute)}`,
        subtitle: '15-second chunks',
        chunks
      };
    } else {
      zoomLevel = 'hourly';
    }
  }

  return {
    timezone,
    filters: buildSafeFiltersForResponse(filters),
    range: mapRangeMeta(filters, timezone),
    zoomLevel,
    focus: {
      day: focusDay,
      hour: focusHour,
      fiveMinute: focusFiveMinute
    },
    summary: {
      totalRequests,
      totalAttempts,
      busiestChunkRequests: globalBusiestHour,
      daysCount: dayTimelines.length
    },
    dayTimelines,
    focusTimeline
  };
}

async function fetchTrackActivityTimeline(rawQuery = {}, requestUser = null) {
  const lookups = await fetchLookups(requestUser);
  const timezone = await resolveTimelineTimezone(rawQuery, requestUser, lookups);
  const dataset = await loadCanonicalEvents(rawQuery, requestUser, { lookups, timezone });
  const { filters, events } = dataset;

  const summary = buildSummary(events);

  const lanesRangeStart = filters.zoomLevel === 'event' ? filters.focusStartAtMs : filters.startAtMs;
  const lanesRangeEnd = filters.zoomLevel === 'event' ? filters.focusEndAtMs : filters.endAtMs;
  const lanes = buildTimelineLanes(lanesRangeStart, lanesRangeEnd, timezone);

  const bucketZoom = filters.zoomLevel === '5m' ? '5m' : '30m';
  const lanesWithBuckets = buildTimelineBuckets(lanes, events, bucketZoom, timezone);

  const response = {
    filters: buildSafeFiltersForResponse(filters),
    timezone,
    summary,
    range: mapRangeMeta(filters, timezone),
    zoomLevel: filters.zoomLevel,
    nextZoomLevel: filters.zoomLevel === '30m' ? '5m' : (filters.zoomLevel === '5m' ? 'event' : ''),
    lanes: lanesWithBuckets,
    eventRows: [],
    pagination: null,
    intervalSummary: null
  };

  if (filters.zoomLevel === 'event') {
    const focusEvents = events.filter((event) => event.occurredAtMs >= filters.focusStartAtMs && event.occurredAtMs <= filters.focusEndAtMs);
    const pagination = buildPagination(focusEvents.length, filters.page, filters.limit);
    const startIdx = Math.max(0, (pagination.currentPage - 1) * pagination.limit);
    const pagedRows = focusEvents.slice(startIdx, startIdx + pagination.limit).map(toEventRow);
    response.eventRows = pagedRows;
    response.pagination = pagination;
    response.intervalSummary = buildIntervalSummary(focusEvents);
  }

  return response;
}

function toMaskedEventDetails(event = {}, reveal = false) {
  const base = {
    eventId: event.id,
    occurredAt: event.occurredAt,
    occurredAtDisplay: event.occurredAtDisplay,
    requestId: event.requestId,
    actionStateId: event.actionStateId,
    statusRaw: event.statusRaw,
    summary: event.summary,
    source: event.source,
    sourceLabel: event.sourceLabel,
    sectionId: event.sectionId,
    sectionName: event.sectionName,
    operationId: event.operationId,
    operationName: event.operationName,
    userId: event.userId,
    username: event.username,
    displayName: event.displayName,
    actorPrimary: event.actorPrimary,
    actorSecondary: event.actorSecondary,
    orgId: event.orgId,
    orgName: event.orgName,
    contextLine: event.contextLine,
    recordId: event.recordId,
    hasActionState: Boolean(event.hasActionState)
  };

  base.details = reveal ? (event.details || {}) : maskSensitiveObject(event.details || {});
  if (event.actionState) {
    base.actionState = {
      recordId: event.actionState.recordId,
      requestId: event.actionState.requestId,
      occurredAt: event.actionState.occurredAt,
      occurredAtDisplay: event.actionState.occurredAtDisplay,
      statusRaw: event.actionState.statusRaw,
      summary: event.actionState.summary,
      targetKey: event.actionState.targetKey,
      method: event.actionState.method,
      url: event.actionState.url,
      orgId: event.actionState.orgId,
      orgName: event.actionState.orgName,
      details: reveal ? (event.actionState.details || {}) : maskSensitiveObject(event.actionState.details || {})
    };
  }

  return base;
}

async function fetchTrackActivityDetails(rawQuery = {}, requestUser = null) {
  const lookups = await fetchLookups(requestUser);
  const timezone = await resolveTimelineTimezone(rawQuery, requestUser, lookups);
  const dataset = await loadCanonicalEvents(rawQuery, requestUser, { lookups, timezone });
  const { filters, events } = dataset;

  const kind = cleanText(rawQuery.kind, 20).toLowerCase();
  const canReveal = hasAdminPower(requestUser);
  const reveal = canReveal && String(rawQuery.reveal || '').trim() === '1';

  if (kind === 'event') {
    const eventId = cleanText(rawQuery.eventId, 220);
    const event = events.find((row) => row.id === eventId) || null;
    if (!event) {
      return {
        kind: 'event',
        filters: buildSafeFiltersForResponse(filters),
        timezone,
        found: false,
        canReveal,
        reveal,
        event: null
      };
    }

    return {
      kind: 'event',
      filters: buildSafeFiltersForResponse(filters),
      timezone,
      found: true,
      canReveal,
      reveal,
      event: toMaskedEventDetails(event, reveal)
    };
  }

  const intervalStartMs = parseDateTimeInputToMs(rawQuery.bucketStartAt, timezone);
  const intervalEndMs = parseDateTimeInputToMs(rawQuery.bucketEndAt, timezone);

  let startMs = Number.isNaN(intervalStartMs) ? filters.focusStartAtMs : intervalStartMs;
  let endMs = Number.isNaN(intervalEndMs) ? filters.focusEndAtMs : intervalEndMs;
  if (startMs > endMs) {
    const tmp = startMs;
    startMs = endMs;
    endMs = tmp;
  }

  startMs = Math.max(filters.startAtMs, startMs);
  endMs = Math.min(filters.endAtMs, endMs);

  const intervalRows = events
    .filter((event) => event.occurredAtMs >= startMs && event.occurredAtMs <= endMs)
    .sort((a, b) => Number(b.occurredAtMs || 0) - Number(a.occurredAtMs || 0));

  const sampleRows = intervalRows.slice(0, 30).map((event) => toMaskedEventDetails(event, reveal));

  return {
    kind: 'interval',
    filters: buildSafeFiltersForResponse(filters),
    timezone,
    canReveal,
    reveal,
    interval: {
      startAtMs: startMs,
      endAtMs: endMs,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      startAtDisplay: formatDateTimeInTimezone(startMs, timezone),
      endAtDisplay: formatDateTimeInTimezone(endMs, timezone)
    },
    summary: buildIntervalSummary(intervalRows),
    sampleRows
  };
}

async function fetchTrackActivity(rawQuery = {}, requestUser = null, options = {}) {
  const includeAllRows = options?.includeAllRows === true;
  const lookups = await fetchLookups(requestUser);
  const timezone = await resolveTimelineTimezone(rawQuery, requestUser, lookups);
  const dataset = await loadCanonicalEvents(rawQuery, requestUser, { lookups, timezone });
  const { filters, events } = dataset;

  const summary = buildSummary(events);
  const pagination = buildPagination(events.length, filters.page, filters.limit);
  let rows = events;
  if (!includeAllRows) {
    const startIdx = Math.max(0, (pagination.currentPage - 1) * pagination.limit);
    rows = events.slice(startIdx, startIdx + pagination.limit);
  }

  return {
    filters: buildSafeFiltersForResponse(filters),
    rows,
    summary,
    pagination,
    filterOptions: {
      sections: lookups.sections,
      operations: lookups.operations,
      organizations: lookups.organizations
    },
    timezone
  };
}

async function fetchTrackActivityUsers(rawQuery = {}, requestUser = null) {
  if (!hasAdminPower(requestUser)) {
    return {
      q: cleanText(rawQuery.q, 120),
      rows: []
    };
  }

  const q = cleanText(rawQuery.q, 120);
  const limit = clamp(parsePositiveInteger(rawQuery.limit, 20) || 20, 1, 50);
  const userQuery = {
    sort: 'username',
    page: 1,
    limit
  };
  if (q.length >= 2) {
    userQuery.q = q;
  }

  const users = await dataService.fetchData('users', userQuery, requestUser);

  const rows = (Array.isArray(users) ? users : []).map((user) => {
    const id = cleanText(user?.id, 120);
    const username = cleanText(user?.username, 140);
    const displayName = resolveUserDisplayName(user);
    const labelPrimary = displayName || username || (id ? `User ${id}` : 'User');
    const label = username && username !== labelPrimary
      ? `${labelPrimary} (@${username})`
      : labelPrimary;

    return {
      id,
      label,
      name: labelPrimary || label,
      username,
      email: cleanText(user?.email, 180)
    };
  }).filter((row) => row.id);

  return {
    q,
    rows
  };
}

module.exports = {
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_MERGE_LIMIT,
  DEFAULT_PAGE_SIZE,
  MAX_RANGE_DAYS,
  hasAdminPower,
  sanitizeCsvCellForSpreadsheet,
  buildDefaultPageFilters,
  parseTimelineFilters,
  fetchTrackActivity,
  fetchTrackActivityHourlyTimeline,
  fetchTrackActivityTimeline,
  fetchTrackActivityDetails,
  fetchTrackActivityUsers
};
