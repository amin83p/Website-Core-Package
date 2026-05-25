const activityQuotaConsumptionDefinitionRepository = require('../../repositories/activityQuotaConsumptionDefinitionRepository');
const activityQuotaLedgerService = require('../activityQuotaLedgerService');
const packageQuotaDefinitionService = require('../packageQuotaDefinitionService');
const { toPublicId, idsEqual } = require('../../utils/idAdapter');

const METRIC_FIELDS = Object.freeze(['call', 'amount', 'token', 'volume']);
const CONSUME_TIMINGS = Object.freeze(['on_attempt', 'on_success', 'hybrid']);
const RESOLUTION_ERROR_MESSAGE = 'This section/operation does not have an active Activity Quota definition.';
const DEFAULT_TIMEZONE = 'UTC';

const MIDDLEWARE_ENABLED_KEYS = Object.freeze(packageQuotaDefinitionService.buildEnabledQuotaKeys());

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 200, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const token = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !token) return null;
  return token.length > max ? token.slice(0, max) : token;
}

function normalizeTimezoneToken(value, fallback = DEFAULT_TIMEZONE) {
  const token = cleanString(value, { max: 80, allowEmpty: true }) || fallback;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: token });
    return token;
  } catch (_) {
    return fallback;
  }
}

function toIso(value) {
  const parsed = new Date(value || new Date().toISOString());
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function getDateTokenInTimezone(isoDateTime, timezone) {
  const tz = normalizeTimezoneToken(timezone, DEFAULT_TIMEZONE);
  const date = new Date(toIso(isoDateTime));
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const map = new Map(parts.map((part) => [part.type, part.value]));
    const y = map.get('year');
    const m = map.get('month');
    const d = map.get('day');
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch (_) {
    // fallback below
  }
  return toIso(isoDateTime).slice(0, 10);
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function normalizeNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return Number(fallback || 0);
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) return Number(fallback || 0);
  return Number(numeric.toFixed(6));
}

function buildKey(sectionId = '', operationId = '') {
  const section = cleanString(sectionId, { max: 120, allowEmpty: true }) || '';
  const operation = cleanString(operationId, { max: 120, allowEmpty: true }) || '';
  return `${section}::${operation}`;
}

function normalizeDateToken(value) {
  const token = cleanString(value, { max: 20, allowEmpty: true }) || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return '';
  return token;
}

function normalizeDefinition(row = {}) {
  const input = isPlainObject(row) ? row : {};
  const validityRaw = isPlainObject(input.validity) ? input.validity : {};
  const normalized = {
    ...input,
    id: cleanString(input.id, { max: 120, allowEmpty: true }) || '',
    orgId: toPublicId(input.orgId || ''),
    name: cleanString(input.name, { max: 220, allowEmpty: true }) || '',
    active: normalizeBoolean(input.active, true),
    sectionId: cleanString(input.sectionId, { max: 120, allowEmpty: true }) || '',
    operationId: cleanString(input.operationId, { max: 120, allowEmpty: true }) || '',
    sourceEventType: cleanString(input.sourceEventType, { max: 120, allowEmpty: true }) || '',
    targetUserIds: Array.isArray(input.targetUserIds)
      ? input.targetUserIds.map((item) => toPublicId(item || '')).filter(Boolean)
      : [],
    isFallback: normalizeBoolean(input.isFallback, false),
    consumeTiming: (() => {
      const token = cleanString(input.consumeTiming, { max: 40, allowEmpty: true }).toLowerCase();
      return CONSUME_TIMINGS.includes(token) ? token : 'on_attempt';
    })(),
    validity: {
      mode: cleanString(validityRaw.mode, { max: 30, allowEmpty: true }).toLowerCase(),
      startDate: normalizeDateToken(validityRaw.startDate),
      endDate: normalizeDateToken(validityRaw.endDate),
      timezone: normalizeTimezoneToken(validityRaw.timezone, DEFAULT_TIMEZONE)
    },
    formula: {}
  };

  METRIC_FIELDS.forEach((metric) => {
    const metricRow = isPlainObject(input?.formula?.[metric]) ? input.formula[metric] : {};
    normalized.formula[metric] = {
      base: Math.max(0, normalizeNumber(metricRow.base, 0)),
      multiplier: Math.max(0, normalizeNumber(metricRow.multiplier, 0)),
      contextKey: cleanString(metricRow.contextKey, { max: 120, allowEmpty: true }) || ''
    };
  });

  return normalized;
}

function definitionMatchesEvent(definition = {}, sourceEventType = '') {
  const eventToken = cleanString(sourceEventType, { max: 120, allowEmpty: true }) || '';
  const defEvent = cleanString(definition.sourceEventType, { max: 120, allowEmpty: true }) || '';
  if (!defEvent) return true;
  return defEvent === eventToken;
}

function definitionMatchesExactEvent(definition = {}, sourceEventType = '') {
  const eventToken = cleanString(sourceEventType, { max: 120, allowEmpty: true }) || '';
  const defEvent = cleanString(definition.sourceEventType, { max: 120, allowEmpty: true }) || '';
  if (!defEvent || !eventToken) return false;
  return defEvent === eventToken;
}

function definitionIsEventAgnostic(definition = {}) {
  const defEvent = cleanString(definition.sourceEventType, { max: 120, allowEmpty: true }) || '';
  return !defEvent;
}

function definitionIsValidityActive(definition = {}, referenceIso = null) {
  if (!normalizeBoolean(definition.active, true)) return false;
  const validity = isPlainObject(definition.validity) ? definition.validity : {};
  const mode = String(validity.mode || '').toLowerCase();
  if (mode === 'always') return true;
  if (mode !== 'date_range') return false;
  const startDate = normalizeDateToken(validity.startDate);
  const endDate = normalizeDateToken(validity.endDate);
  if (!startDate || !endDate) return false;
  const dateToken = getDateTokenInTimezone(referenceIso || new Date().toISOString(), validity.timezone);
  return dateToken >= startDate && dateToken <= endDate;
}

function definitionMatchesAudience(definition = {}, userId = '') {
  const uid = toPublicId(userId || '');
  const targets = Array.isArray(definition.targetUserIds) ? definition.targetUserIds : [];
  if (!targets.length) return false;
  if (!uid) return false;
  return targets.some((item) => idsEqual(item, uid));
}

function definitionIsGeneric(definition = {}) {
  const targets = Array.isArray(definition.targetUserIds) ? definition.targetUserIds : [];
  return !targets.length && !normalizeBoolean(definition.isFallback, false);
}

function definitionIsFallback(definition = {}) {
  return normalizeBoolean(definition.isFallback, false);
}

function resolveStartDateRank(definition = {}) {
  const validity = isPlainObject(definition.validity) ? definition.validity : {};
  const startDate = normalizeDateToken(validity.startDate) || '0000-00-00';
  return Number(startDate.replace(/-/g, '')) || 0;
}

function resolveUpdatedAtRank(definition = {}) {
  const token = cleanString(definition?.audit?.lastUpdateDateTime, { max: 40, allowEmpty: true }) || '';
  const parsed = new Date(token);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function pickMostRecent(definitions = []) {
  const rows = Array.isArray(definitions) ? definitions.slice() : [];
  rows.sort((a, b) => {
    const dateDiff = resolveStartDateRank(b) - resolveStartDateRank(a);
    if (dateDiff !== 0) return dateDiff;
    return resolveUpdatedAtRank(b) - resolveUpdatedAtRank(a);
  });
  return rows[0] || null;
}

function splitDefinitionsByEvent(rows = [], sourceEventType = '') {
  const list = Array.isArray(rows) ? rows : [];
  return {
    exact: list.filter((row) => definitionMatchesExactEvent(row, sourceEventType)),
    agnostic: list.filter((row) => definitionIsEventAgnostic(row))
  };
}

function resolveContextValue(context = {}, contextKey = '') {
  const key = cleanString(contextKey, { max: 120, allowEmpty: true }) || '';
  if (!key) return 0;
  const source = isPlainObject(context) ? context : {};
  const parts = key.split('.').map((item) => item.trim()).filter(Boolean);
  if (!parts.length) return 0;
  let cursor = source;
  for (const part of parts) {
    if (!isPlainObject(cursor) && !Array.isArray(cursor)) return 0;
    cursor = cursor[part];
    if (cursor === undefined || cursor === null) return 0;
  }
  const numeric = Number(cursor);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) return 0;
  return numeric;
}

function computeNeedsFromDefinition(definition = {}, context = {}) {
  const formula = isPlainObject(definition.formula) ? definition.formula : {};
  const out = {};
  METRIC_FIELDS.forEach((metric) => {
    const row = isPlainObject(formula[metric]) ? formula[metric] : {};
    const base = Math.max(0, normalizeNumber(row.base, 0));
    const multiplier = Math.max(0, normalizeNumber(row.multiplier, 0));
    const contextValue = resolveContextValue(context, row.contextKey);
    const computed = Number((base + (multiplier * contextValue)).toFixed(6));
    out[metric] = computed > 0 ? computed : 0;
  });
  return activityQuotaLedgerService.normalizeNeeds(out);
}

function hasAnyNeed(needs = {}) {
  return METRIC_FIELDS.some((metric) => Number(needs[metric] || 0) > 0);
}

function buildResolutionContext(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const orgId = toPublicId(source.orgId || '');
  const userId = toPublicId(source.userId || '');
  const sectionId = cleanString(source.sectionId, { max: 120, allowEmpty: false });
  const operationId = cleanString(source.operationId, { max: 120, allowEmpty: false });
  if (!orgId || !sectionId || !operationId) {
    throw new Error('orgId, sectionId, and operationId are required to resolve quota policy.');
  }
  return {
    orgId,
    userId,
    sectionId,
    operationId,
    sourceEventType: cleanString(source.sourceEventType, { max: 120, allowEmpty: true }) || '',
    atIso: toIso(source.atIso || new Date().toISOString())
  };
}

async function listActiveDefinitionsForKey(context = {}, options = {}) {
  const query = {
    orgId__eq: context.orgId,
    sectionId__eq: context.sectionId,
    operationId__eq: context.operationId,
    active__eq: true
  };
  const rows = await activityQuotaConsumptionDefinitionRepository.list({
    query,
    scope: {
      canViewAll: true
    },
    backendMode: options?.backendMode
  });
  return (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeDefinition(row))
    .filter((row) => row.orgId && idsEqual(row.orgId, context.orgId))
    .filter((row) => row.sectionId === context.sectionId)
    .filter((row) => row.operationId === context.operationId)
    .filter((row) => definitionIsValidityActive(row, context.atIso));
}

function pickDefinitionByPrecedence(candidates = [], context = {}) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const eventMatchRows = rows.filter((row) => definitionMatchesEvent(row, context.sourceEventType));
  const bucketTargeted = eventMatchRows.filter((row) => definitionMatchesAudience(row, context.userId));
  const bucketGeneric = eventMatchRows.filter((row) => definitionIsGeneric(row));
  const bucketFallback = eventMatchRows.filter((row) => definitionIsFallback(row));

  const targetedByEvent = splitDefinitionsByEvent(bucketTargeted, context.sourceEventType);
  const genericByEvent = splitDefinitionsByEvent(bucketGeneric, context.sourceEventType);
  const fallbackByEvent = splitDefinitionsByEvent(bucketFallback, context.sourceEventType);

  const bucketOrder = [
    targetedByEvent.exact,
    targetedByEvent.agnostic,
    genericByEvent.exact,
    genericByEvent.agnostic,
    fallbackByEvent.exact,
    fallbackByEvent.agnostic
  ];

  for (const bucket of bucketOrder) {
    const picked = pickMostRecent(bucket);
    if (picked) return picked;
  }
  return null;
}

async function resolvePolicyDefinition(input = {}, options = {}) {
  const context = buildResolutionContext(input);
  const candidates = await listActiveDefinitionsForKey(context, options);
  const activeFallbackExists = candidates.some((row) => definitionIsFallback(row));
  const chosen = pickDefinitionByPrecedence(candidates, context);

  if (!chosen || !activeFallbackExists) {
    const error = new Error(RESOLUTION_ERROR_MESSAGE);
    error.code = activeFallbackExists ? 'QUOTA_POLICY_NOT_FOUND' : 'QUOTA_POLICY_FALLBACK_MISSING';
    throw error;
  }

  return {
    definition: chosen,
    context,
    candidatesCount: candidates.length
  };
}

function formatSource(source = {}, defaults = {}) {
  const input = isPlainObject(source) ? source : {};
  return {
    module: cleanString(input.module, { max: 80, allowEmpty: true }) || (defaults.module || 'activity_quota_policy'),
    eventType: cleanString(input.eventType, { max: 80, allowEmpty: true }) || (defaults.eventType || 'quota_consumed'),
    eventId: cleanString(input.eventId, { max: 180, allowEmpty: true }) || `${(defaults.eventIdPrefix || 'AQP')}-${Date.now()}`,
    idempotencyKey: cleanString(input.idempotencyKey, { max: 220, allowEmpty: true }) || ''
  };
}

function normalizeConsumeTiming(value, fallback = 'on_attempt') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (CONSUME_TIMINGS.includes(token)) return token;
  return fallback;
}

function definitionSupportsTiming(definitionTiming = '', requestedTiming = '') {
  const defTiming = normalizeConsumeTiming(definitionTiming, 'on_attempt');
  const reqTiming = normalizeConsumeTiming(requestedTiming, 'on_attempt');
  if (defTiming === 'hybrid') {
    return reqTiming === 'on_attempt' || reqTiming === 'on_success' || reqTiming === 'hybrid';
  }
  return defTiming === reqTiming;
}

async function consumeUsingResolvedDefinition(payload = {}, options = {}) {
  const policy = isPlainObject(payload.policy) ? payload.policy : {};
  const definition = normalizeDefinition(policy.definition || {});
  const context = isPlainObject(payload.context) ? payload.context : {};
  const source = formatSource(payload.source, {
    module: 'activity_quota_policy_runtime',
    eventType: context?.sourceEventType || 'quota_policy_consumed',
    eventIdPrefix: 'AQP-CONSUME'
  });
  const requestUser = options?.requestUser || payload.requestUser || null;
  const backendMode = options?.backendMode || payload.backendMode;
  const timing = normalizeConsumeTiming(payload.consumeTiming, 'on_attempt');
  const bypassAvailabilityCheck = payload.bypassAvailabilityCheck === true;

  if (!definition.id || !definition.orgId || !definition.sectionId || !definition.operationId) {
    throw new Error('Resolved quota policy definition is invalid.');
  }

  if (!definitionSupportsTiming(definition.consumeTiming, timing)) {
    return {
      skipped: true,
      reason: 'timing_mismatch',
      consumeTiming: definition.consumeTiming,
      requestedTiming: timing,
      policy
    };
  }

  const needs = computeNeedsFromDefinition(definition, context);
  if (!hasAnyNeed(needs)) {
    return {
      skipped: true,
      reason: 'no_effective_metrics',
      needs,
      policy
    };
  }

  if (bypassAvailabilityCheck) {
    const consumed = await activityQuotaLedgerService.recordConsumptionWithoutCheck({
      dateTime: toIso(payload.dateTime || new Date().toISOString()),
      orgId: definition.orgId,
      userId: toPublicId(context.userId || ''),
      section: definition.sectionId,
      operation: definition.operationId,
      needs,
      source: {
        ...source,
        eventType: `${source.eventType}_bypass`
      }
    }, {
      requestUser,
      backendMode
    });
    return {
      allowed: true,
      bypassAvailabilityCheck: true,
      consumed,
      needs,
      policy
    };
  }

  const attempt = await activityQuotaLedgerService.consumeIfAvailable({
    dateTime: toIso(payload.dateTime || new Date().toISOString()),
    orgId: definition.orgId,
    userId: toPublicId(context.userId || ''),
    section: definition.sectionId,
    operation: definition.operationId,
    needs,
    source
  }, {
    requestUser,
    backendMode
  });

  if (!attempt?.allowed) {
    const message = cleanString(attempt?.message, { max: 400, allowEmpty: true }) || 'Insufficient activity quota.';
    throw new Error(message);
  }

  return {
    allowed: true,
    bypassAvailabilityCheck: false,
    consumed: attempt.entry,
    needs,
    policy
  };
}

function normalizeEnabledKeyRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((row) => {
    const item = isPlainObject(row) ? row : {};
    const sectionId = cleanString(item.sectionId, { max: 120, allowEmpty: true }) || '';
    const operationId = cleanString(item.operationId, { max: 120, allowEmpty: true }) || '';
    return buildKey(sectionId, operationId);
  }).filter(Boolean);
}

async function assertFallbackCoverageForEnabledKeys(enabledKeys = MIDDLEWARE_ENABLED_KEYS, options = {}) {
  const keys = Array.from(new Set(
    normalizeEnabledKeyRows(enabledKeys).length
      ? normalizeEnabledKeyRows(enabledKeys)
      : (Array.isArray(enabledKeys) ? enabledKeys : [])
  ));
  if (!keys.length) return { ok: true, missing: [] };

  const rows = await activityQuotaConsumptionDefinitionRepository.list({
    query: { active__eq: true, isFallback__eq: true },
    scope: { canViewAll: true },
    backendMode: options?.backendMode
  });

  const nowIso = toIso(options?.atIso || new Date().toISOString());
  const coverage = new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => normalizeDefinition(row))
      .filter((row) => definitionIsValidityActive(row, nowIso))
      .map((row) => buildKey(row.sectionId, row.operationId))
      .filter(Boolean)
  );

  const missing = keys.filter((key) => !coverage.has(key));
  if (missing.length) {
    const error = new Error(RESOLUTION_ERROR_MESSAGE);
    error.code = 'QUOTA_POLICY_FALLBACK_MISSING';
    error.details = { missingKeys: missing };
    throw error;
  }
  return { ok: true, missing: [] };
}

module.exports = {
  MIDDLEWARE_ENABLED_KEYS,
  RESOLUTION_ERROR_MESSAGE,
  resolvePolicyDefinition,
  computeNeedsFromDefinition,
  consumeUsingResolvedDefinition,
  assertFallbackCoverageForEnabledKeys,
  __testables: {
    getDateTokenInTimezone,
    definitionIsValidityActive,
    pickMostRecent,
    pickDefinitionByPrecedence,
    resolveContextValue,
    buildKey,
    normalizeDefinition,
    listActiveDefinitionsForKey
  }
};
