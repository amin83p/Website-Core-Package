const crypto = require('crypto');
const { SYSTEM_CONTEXT } = require('../../config/constants');
const activityQuotaLedgerRepository = require('../repositories/activityQuotaLedgerRepository');
const quotaCreditLotRepository = require('../repositories/quotaCreditLotRepository');
const quotaBalanceSnapshotRepository = require('../repositories/quotaBalanceSnapshotRepository');
const dataService = require('./dataService');
const settingService = require('./settingService');
const { toPublicId } = require('../utils/idAdapter');

const METRIC_FIELDS = Object.freeze(['call', 'amount', 'token', 'volume']);
const ENTRY_TYPES = Object.freeze(['credit', 'consumption', 'adjustment']);
const ACTIVE_LOT_STATUSES = new Set(['active']);
const QUOTA_LOCKS = new Map();
const ORG_TZ_CACHE = new Map();
const ORG_TZ_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_ORG_TIMEZONE = 'UTC';
let DEFAULT_TIMEZONE_CACHE = null;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 160, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function buildStableCreditLotId(creditEntryId = '') {
  const token = cleanString(creditEntryId, { max: 220, allowEmpty: true }) || '';
  if (!token) return '';
  const digest = crypto.createHash('sha1').update(token).digest('hex').slice(0, 16).toUpperCase();
  const tail = token.replace(/[^A-Za-z0-9_-]+/g, '').slice(-30).toUpperCase();
  return cleanString(`AQLT-${digest}${tail ? `-${tail}` : ''}`, { max: 64, allowEmpty: true });
}

function cleanMetricValue(value, { allowNegative = false } = {}) {
  if (value === undefined || value === null || value === '') return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error('Invalid metric value.');
  if (!allowNegative && numeric < 0) throw new Error('Metric values cannot be negative for this entry type.');
  return Number(numeric.toFixed(6));
}

function normalizeIsoDateTime(value, { allowEmpty = false } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid datetime value.');
  return date.toISOString();
}

function normalizeEntryType(value, fallback = 'consumption') {
  const token = cleanString(value, { max: 40, allowEmpty: true });
  const normalized = token ? token.toLowerCase() : fallback;
  if (!ENTRY_TYPES.includes(normalized)) {
    throw new Error('Invalid entryType. Must be credit, consumption, or adjustment.');
  }
  return normalized;
}

function normalizeMetrics(input = {}, { allowNegative = false } = {}) {
  const source = isPlainObject(input) ? input : {};
  const out = {};
  METRIC_FIELDS.forEach((field) => {
    out[field] = cleanMetricValue(source[field], { allowNegative });
  });
  return out;
}

function normalizeNeeds(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const out = {};
  METRIC_FIELDS.forEach((field) => {
    const value = cleanMetricValue(source[field], { allowNegative: false });
    out[field] = value < 0 ? 0 : value;
  });
  return out;
}

function hasAnyNeededQuota(needs = {}) {
  return METRIC_FIELDS.some((field) => Number(needs[field] || 0) > 0);
}

function hasAnyPositiveMetric(metrics = {}) {
  return METRIC_FIELDS.some((field) => Number(metrics[field] || 0) > 0);
}

function buildZeroMetrics() {
  return METRIC_FIELDS.reduce((acc, field) => {
    acc[field] = 0;
    return acc;
  }, {});
}

function addMetrics(target = {}, source = {}, multiplier = 1, { clampFloor = null } = {}) {
  const out = { ...(isPlainObject(target) ? target : buildZeroMetrics()) };
  METRIC_FIELDS.forEach((field) => {
    const base = Number(out[field] || 0);
    const delta = Number(source[field] || 0) * Number(multiplier || 0);
    let next = Number((base + delta).toFixed(6));
    if (clampFloor !== null && next < clampFloor) next = clampFloor;
    out[field] = next;
  });
  return out;
}

function subtractMetrics(target = {}, source = {}, { clampFloor = null } = {}) {
  return addMetrics(target, source, -1, { clampFloor });
}

function resolveActiveOrgId(requestUser, payloadOrgId = '') {
  const payloadValue = toPublicId(payloadOrgId);
  if (payloadValue) return payloadValue;
  if (!requestUser || requestUser === SYSTEM_CONTEXT) return '';
  const activeOrgId = toPublicId(requestUser.activeOrgId);
  if (activeOrgId) return activeOrgId;
  return toPublicId(requestUser.primaryOrgId);
}

function buildSystemCreator(orgId = '') {
  return {
    type: 'system',
    displayName: 'System',
    userId: '',
    username: '',
    email: '',
    orgId: toPublicId(orgId) || ''
  };
}

function buildUserCreatorFromRequest(requestUser, orgId = '') {
  const userId = toPublicId(requestUser?.id || '');
  if (!userId) return null;
  const username = cleanString(requestUser?.username, { max: 120, allowEmpty: true }) || '';
  const email = cleanString(requestUser?.email, { max: 200, allowEmpty: true }) || '';
  return {
    type: 'user',
    displayName: username || email || userId,
    userId,
    username,
    email,
    orgId: toPublicId(orgId || requestUser?.activeOrgId || requestUser?.primaryOrgId) || ''
  };
}

function buildCreator(payload = {}, options = {}) {
  const requestUser = options?.requestUser;
  const forceSystem = options?.forceSystem === true || requestUser === SYSTEM_CONTEXT;
  const explicitCreator = isPlainObject(payload.creator) ? payload.creator : {};
  const resolvedOrgId = toPublicId(payload.orgId || '');

  if (forceSystem) return buildSystemCreator(resolvedOrgId);

  const fromRequest = buildUserCreatorFromRequest(requestUser, resolvedOrgId);
  if (fromRequest) return fromRequest;

  const explicitType = cleanString(explicitCreator.type, { max: 30, allowEmpty: true }).toLowerCase();
  if (explicitType === 'system') return buildSystemCreator(resolvedOrgId);

  const explicitUserId = toPublicId(explicitCreator.userId || '');
  if (!explicitUserId) {
    throw new Error('User creator information is required for non-system activity quota entries.');
  }

  return {
    type: 'user',
    displayName: cleanString(explicitCreator.displayName, { max: 160, allowEmpty: true })
      || cleanString(explicitCreator.username, { max: 120, allowEmpty: true })
      || cleanString(explicitCreator.email, { max: 200, allowEmpty: true })
      || explicitUserId,
    userId: explicitUserId,
    username: cleanString(explicitCreator.username, { max: 120, allowEmpty: true }) || '',
    email: cleanString(explicitCreator.email, { max: 200, allowEmpty: true }) || '',
    orgId: toPublicId(explicitCreator.orgId || resolvedOrgId) || ''
  };
}

function buildAudit(creator, payloadAudit = {}) {
  const input = isPlainObject(payloadAudit) ? payloadAudit : {};
  const nowIso = new Date().toISOString();

  if (creator.type === 'system') {
    return {
      createUser: 'System',
      createDateTime: normalizeIsoDateTime(input.createDateTime, { allowEmpty: true }) || nowIso,
      lastUpdateUser: 'System',
      lastUpdateDateTime: normalizeIsoDateTime(input.lastUpdateDateTime, { allowEmpty: true }) || nowIso
    };
  }

  const creatorUserId = toPublicId(creator.userId || '');
  return {
    createUser: creatorUserId,
    createDateTime: normalizeIsoDateTime(input.createDateTime, { allowEmpty: true }) || nowIso,
    lastUpdateUser: creatorUserId,
    lastUpdateDateTime: normalizeIsoDateTime(input.lastUpdateDateTime, { allowEmpty: true }) || nowIso
  };
}

function buildSource(payload = {}, entryType = 'consumption') {
  const source = isPlainObject(payload.source) ? payload.source : {};
  return {
    module: cleanString(source.module, { max: 80, allowEmpty: true }) || 'activity_quota',
    eventType: cleanString(source.eventType, { max: 80, allowEmpty: true }) || `${entryType}_event`,
    eventId: cleanString(source.eventId, { max: 180, allowEmpty: true }) || `AQL-EVT-${Date.now()}`,
    idempotencyKey: cleanString(source.idempotencyKey, { max: 220, allowEmpty: true }) || ''
  };
}

function resolveSourceIdempotencyKey(payload = {}) {
  const source = isPlainObject(payload?.source) ? payload.source : {};
  return cleanString(source.idempotencyKey, { max: 220, allowEmpty: true }) || '';
}

function isDuplicateSourceIdempotencyError(error) {
  if (!error) return false;
  const code = Number(error?.code || 0);
  const message = cleanString(error?.message || error, { max: 1000, allowEmpty: true }).toLowerCase();
  if (code === 11000) return true;
  if (message.includes('duplicate source.idempotencykey')) return true;
  if (message.includes('source.idempotencykey') && message.includes('duplicate key')) return true;
  if (message.includes('idx_activity_quota_ledger_org_source_idempotency')) return true;
  return false;
}

async function findExistingConsumptionByIdempotency(input = {}, options = {}) {
  const orgId = toPublicId(input?.orgId || '');
  const idempotencyKey = resolveSourceIdempotencyKey(input);
  if (!orgId || !idempotencyKey) return null;

  return activityQuotaLedgerRepository.findBySourceIdempotencyKey(orgId, idempotencyKey, {
    userId: toPublicId(input?.userId || ''),
    section: cleanString(input?.section, { max: 120, allowEmpty: true }) || '',
    operation: cleanString(input?.operation, { max: 120, allowEmpty: true }) || '',
    entryType: 'consumption',
    backendMode: options?.backendMode
  });
}

function normalizeTimezoneToken(value, fallback = DEFAULT_ORG_TIMEZONE) {
  const token = cleanString(value, { max: 80, allowEmpty: true }) || fallback;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: token });
    return token;
  } catch (_) {
    return fallback;
  }
}

function cleanDateOnly(value, { allowEmpty = true } = {}) {
  const token = cleanString(value, { max: 20, allowEmpty: true });
  if (!token) return allowEmpty ? '' : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) throw new Error('Date values must use YYYY-MM-DD format.');
  return token;
}

function resolveDefaultTimezone() {
  if (DEFAULT_TIMEZONE_CACHE) return DEFAULT_TIMEZONE_CACHE;
  const settings = settingService.get();
  const candidate = settings?.app?.defaultTimezone || settings?.app?.timezone || DEFAULT_ORG_TIMEZONE;
  DEFAULT_TIMEZONE_CACHE = normalizeTimezoneToken(candidate, DEFAULT_ORG_TIMEZONE);
  return DEFAULT_TIMEZONE_CACHE;
}

function normalizeValidityPayload(value = {}, fallbackTimezone = DEFAULT_ORG_TIMEZONE) {
  const input = isPlainObject(value) ? value : {};
  const modeToken = cleanString(input.mode, { max: 30, allowEmpty: true }).toLowerCase();
  const startDate = cleanDateOnly(input.startDate, { allowEmpty: true }) || '';
  const endDate = cleanDateOnly(input.endDate, { allowEmpty: true }) || '';
  const timezone = normalizeTimezoneToken(input.timezone, fallbackTimezone);
  const hasWindow = modeToken === 'date_range' || Boolean(startDate || endDate);
  if (!hasWindow) {
    return {
      mode: 'none',
      startDate: '',
      endDate: '',
      timezone
    };
  }
  if (!startDate || !endDate) {
    throw new Error('validity.startDate and validity.endDate are required when validity window is enabled.');
  }
  if (endDate < startDate) {
    throw new Error('validity.endDate must be the same day or after validity.startDate.');
  }
  return {
    mode: 'date_range',
    startDate,
    endDate,
    timezone
  };
}

function normalizeAllocationPayload(value = {}) {
  const input = isPlainObject(value) ? value : {};
  const rows = Array.isArray(input.lots) ? input.lots : [];
  const lots = rows.map((row) => {
    const item = isPlainObject(row) ? row : {};
    const lotId = cleanString(item.lotId || item.id, { max: 120, allowEmpty: true }) || '';
    const metrics = normalizeNeeds(item.metrics || item);
    if (!lotId || !hasAnyNeededQuota(metrics)) return null;
    return {
      lotId,
      metrics
    };
  }).filter(Boolean);
  return {
    policy: cleanString(input.policy, { max: 40, allowEmpty: true }) || 'FEFO',
    lots
  };
}

function buildLedgerEntryPayload(payload = {}, options = {}) {
  const source = isPlainObject(payload) ? payload : {};
  const entryType = normalizeEntryType(source.entryType, options?.entryType || 'consumption');
  const allowNegative = entryType === 'adjustment';
  const metrics = normalizeMetrics(source, { allowNegative });
  const orgId = resolveActiveOrgId(options?.requestUser, source.orgId);
  const userId = toPublicId(source.userId || options?.requestUser?.id || '');
  const section = cleanString(source.section, { max: 120, allowEmpty: true }) || 'ACTIVITY_QUOTA';
  const operation = cleanString(source.operation, { max: 120, allowEmpty: true }) || 'CONFIGURE';

  if (!orgId) throw new Error('orgId is required for activity quota ledger entries.');
  if (!userId) throw new Error('userId is required for activity quota ledger entries.');

  const creator = buildCreator({ ...source, orgId }, options);
  const audit = buildAudit(creator, source.audit);
  const fallbackTimeZone = normalizeTimezoneToken(source?.validity?.timezone || '', DEFAULT_ORG_TIMEZONE);
  const validity = normalizeValidityPayload(source.validity || {}, fallbackTimeZone);
  const allocation = normalizeAllocationPayload(source.allocation || {});

  return {
    id: cleanString(source.id, { max: 80, allowEmpty: true }) || '',
    dateTime: normalizeIsoDateTime(source.dateTime, { allowEmpty: true }) || new Date().toISOString(),
    userId,
    orgId,
    section,
    operation,
    ...metrics,
    entryType,
    source: buildSource(source, entryType),
    creator,
    audit,
    validity,
    allocation
  };
}

function buildLedgerQuery(filters = {}) {
  const query = {};
  const orgId = toPublicId(filters.orgId || '');
  const userId = toPublicId(filters.userId || '');
  const section = cleanString(filters.section, { max: 120, allowEmpty: true });
  const operation = cleanString(filters.operation, { max: 120, allowEmpty: true });
  const entryType = cleanString(filters.entryType, { max: 40, allowEmpty: true });

  if (orgId) query.orgId__eq = orgId;
  if (userId) query.userId__eq = userId;
  if (section) query.section__eq = section;
  if (operation) query.operation__eq = operation;
  if (entryType) query.entryType__eq = entryType.toLowerCase();

  return query;
}

function buildQuotaKey(filters = {}) {
  const orgId = toPublicId(filters.orgId || '');
  const userId = toPublicId(filters.userId || '');
  const section = cleanString(filters.section, { max: 120, allowEmpty: true }) || '';
  const operation = cleanString(filters.operation, { max: 120, allowEmpty: true }) || '';
  return `${orgId}::${userId}::${section}::${operation}`;
}

function buildQuotaKeyFilter(filters = {}) {
  return {
    orgId: toPublicId(filters.orgId || ''),
    userId: toPublicId(filters.userId || ''),
    section: cleanString(filters.section, { max: 120, allowEmpty: true }) || '',
    operation: cleanString(filters.operation, { max: 120, allowEmpty: true }) || ''
  };
}

function assertQuotaKeyFilter(filters = {}) {
  if (!toPublicId(filters.orgId || '')) throw new Error('orgId is required for activity quota evaluation.');
  if (!toPublicId(filters.userId || '')) throw new Error('userId is required for activity quota evaluation.');
  if (!cleanString(filters.section, { max: 120, allowEmpty: true })) throw new Error('section is required for activity quota evaluation.');
  if (!cleanString(filters.operation, { max: 120, allowEmpty: true })) throw new Error('operation is required for activity quota evaluation.');
}

async function withQuotaKeyLock(key, task) {
  const lockKey = String(key || '').trim() || '__GLOBAL__';
  const previous = QUOTA_LOCKS.get(lockKey) || Promise.resolve();
  let release = () => {};
  const next = new Promise((resolve) => {
    release = resolve;
  });
  QUOTA_LOCKS.set(lockKey, previous.then(() => next));
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (QUOTA_LOCKS.get(lockKey) === next) QUOTA_LOCKS.delete(lockKey);
  }
}

function getDateKeyInTimeZone(isoDateTime = '', timeZone = DEFAULT_ORG_TIMEZONE) {
  const date = isoDateTime ? new Date(isoDateTime) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: normalizeTimezoneToken(timeZone, DEFAULT_ORG_TIMEZONE),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value || '1970';
    const month = parts.find((part) => part.type === 'month')?.value || '01';
    const day = parts.find((part) => part.type === 'day')?.value || '01';
    return `${year}-${month}-${day}`;
  } catch (_) {
    return date.toISOString().slice(0, 10);
  }
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
    const token = cleanString(candidate, { max: 80, allowEmpty: true });
    if (!token) continue;
    return normalizeTimezoneToken(token, DEFAULT_ORG_TIMEZONE);
  }
  return normalizeTimezoneToken(
    resolveDefaultTimezone(),
    DEFAULT_ORG_TIMEZONE
  );
}

async function resolveOrgTimezone(orgId = '', options = {}) {
  const orgToken = toPublicId(orgId || '');
  const fallback = normalizeTimezoneToken(
    resolveDefaultTimezone(),
    DEFAULT_ORG_TIMEZONE
  );
  if (!orgToken) return fallback;

  const cacheRow = ORG_TZ_CACHE.get(orgToken);
  const nowMs = Date.now();
  if (cacheRow && Number(cacheRow.expiresAt || 0) > nowMs) {
    return cacheRow.value;
  }

  let timezone = fallback;
  try {
    const orgRow = await dataService.getDataById('organizations', orgToken, SYSTEM_CONTEXT, {
      backendMode: options?.backendMode
    });
    timezone = resolveOrganizationTimezoneFromRow(orgRow || {});
  } catch (_) {
    timezone = fallback;
  }
  ORG_TZ_CACHE.set(orgToken, {
    value: timezone,
    expiresAt: nowMs + ORG_TZ_CACHE_TTL_MS
  });
  return timezone;
}

function getLotMetric(lot = {}, field = '') {
  return Number(lot?.remaining?.[field] || 0);
}

function isValidityActive(validity = {}, dateKey = '') {
  const mode = cleanString(validity?.mode, { max: 20, allowEmpty: true }).toLowerCase();
  if (mode !== 'date_range') return true;
  const startDate = cleanDateOnly(validity?.startDate, { allowEmpty: true }) || '';
  const endDate = cleanDateOnly(validity?.endDate, { allowEmpty: true }) || '';
  if (startDate && dateKey < startDate) return false;
  if (endDate && dateKey > endDate) return false;
  return true;
}

function isValidityExpired(validity = {}, dateKey = '') {
  const mode = cleanString(validity?.mode, { max: 20, allowEmpty: true }).toLowerCase();
  if (mode !== 'date_range') return false;
  const endDate = cleanDateOnly(validity?.endDate, { allowEmpty: true }) || '';
  if (!endDate) return false;
  return dateKey > endDate;
}

function isLotEligibleForDate(lot = {}, dateKey = '') {
  if (!ACTIVE_LOT_STATUSES.has(cleanString(lot?.status, { max: 40, allowEmpty: true }).toLowerCase())) return false;
  return isValidityActive(lot?.validity || {}, dateKey);
}

function compareLotExpiry(a = {}, b = {}) {
  const aEnd = cleanDateOnly(a?.validity?.endDate, { allowEmpty: true }) || '9999-12-31';
  const bEnd = cleanDateOnly(b?.validity?.endDate, { allowEmpty: true }) || '9999-12-31';
  if (aEnd !== bEnd) return aEnd.localeCompare(bEnd);
  const aDate = cleanString(a?.creditDateTime || a?.dateTime, { max: 80, allowEmpty: true }) || '';
  const bDate = cleanString(b?.creditDateTime || b?.dateTime, { max: 80, allowEmpty: true }) || '';
  if (aDate !== bDate) return aDate.localeCompare(bDate);
  return cleanString(a?.id, { max: 120, allowEmpty: true }).localeCompare(cleanString(b?.id, { max: 120, allowEmpty: true }));
}

function buildAllocationRecord(existing = null) {
  const row = isPlainObject(existing) ? existing : {};
  return {
    lotId: cleanString(row.lotId || row.id, { max: 120, allowEmpty: true }) || '',
    metrics: normalizeNeeds(row.metrics || row)
  };
}

function buildAllocationMapFromRows(rows = []) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((raw) => {
    const row = buildAllocationRecord(raw);
    if (!row.lotId || !hasAnyNeededQuota(row.metrics)) return;
    if (!map.has(row.lotId)) map.set(row.lotId, buildZeroMetrics());
    const current = map.get(row.lotId);
    map.set(row.lotId, addMetrics(current, row.metrics, 1));
  });
  return map;
}

function materializeAllocationRows(map = new Map()) {
  return Array.from(map.entries())
    .map(([lotId, metrics]) => ({
      lotId,
      metrics: normalizeNeeds(metrics || {})
    }))
    .filter((row) => row.lotId && hasAnyNeededQuota(row.metrics));
}

function allocateNeedsAcrossLots(lots = [], needs = {}, dateKey = '') {
  const required = normalizeNeeds(needs || {});
  const deficits = buildZeroMetrics();
  const allocation = new Map();
  const eligibleLots = (Array.isArray(lots) ? lots : [])
    .filter((lot) => isLotEligibleForDate(lot, dateKey))
    .sort(compareLotExpiry);

  METRIC_FIELDS.forEach((field) => {
    let remainingNeed = Number(required[field] || 0);
    if (remainingNeed <= 0) return;

    for (const lot of eligibleLots) {
      if (remainingNeed <= 0) break;
      const available = Math.max(0, getLotMetric(lot, field));
      if (available <= 0) continue;
      const take = Number(Math.min(available, remainingNeed).toFixed(6));
      if (take <= 0) continue;
      if (!allocation.has(lot.id)) allocation.set(lot.id, buildZeroMetrics());
      allocation.get(lot.id)[field] = Number((allocation.get(lot.id)[field] + take).toFixed(6));
      remainingNeed = Number((remainingNeed - take).toFixed(6));
    }

    if (remainingNeed > 0) deficits[field] = remainingNeed;
  });

  const ok = METRIC_FIELDS.every((field) => Number(deficits[field] || 0) <= 0);
  return {
    ok,
    deficits,
    allocation
  };
}

function allocateMaximumAcrossLots(lots = [], needs = {}, dateKey = '') {
  const required = normalizeNeeds(needs || {});
  const deficits = buildZeroMetrics();
  const allocation = new Map();
  const eligibleLots = (Array.isArray(lots) ? lots : [])
    .filter((lot) => isLotEligibleForDate(lot, dateKey))
    .sort(compareLotExpiry);

  METRIC_FIELDS.forEach((field) => {
    let remainingNeed = Number(required[field] || 0);
    if (remainingNeed <= 0) return;
    for (const lot of eligibleLots) {
      if (remainingNeed <= 0) break;
      const available = Math.max(0, getLotMetric(lot, field));
      if (available <= 0) continue;
      const take = Number(Math.min(available, remainingNeed).toFixed(6));
      if (take <= 0) continue;
      if (!allocation.has(lot.id)) allocation.set(lot.id, buildZeroMetrics());
      allocation.get(lot.id)[field] = Number((allocation.get(lot.id)[field] + take).toFixed(6));
      remainingNeed = Number((remainingNeed - take).toFixed(6));
    }
    deficits[field] = Number(Math.max(0, remainingNeed).toFixed(6));
  });

  return {
    deficits,
    allocation
  };
}

function applyAllocationToLots(lots = [], allocationMap = new Map()) {
  const byId = new Map((Array.isArray(lots) ? lots : []).map((lot) => [lot.id, lot]));
  const updates = [];
  allocationMap.forEach((metrics, lotId) => {
    const lot = byId.get(lotId);
    if (!lot) return;
    const currentRemaining = normalizeNeeds(lot.remaining || {});
    const nextRemaining = subtractMetrics(currentRemaining, metrics, { clampFloor: 0 });
    const hasRemaining = hasAnyNeededQuota(nextRemaining);
    const status = hasRemaining ? 'active' : 'exhausted';
    updates.push({
      ...lot,
      remaining: nextRemaining,
      status
    });
  });
  return updates;
}

function mergeLotUpdates(workingLots = [], updates = []) {
  (Array.isArray(updates) ? updates : []).forEach((updated) => {
    const idx = workingLots.findIndex((candidate) => String(candidate.id || '') === String(updated.id || ''));
    if (idx >= 0) workingLots[idx] = { ...workingLots[idx], ...updated };
  });
}

function consumeWorkingLotsWithDebt(workingLots = [], needs = {}, dateKey = '', debt = buildZeroMetrics()) {
  const normalizedNeeds = normalizeNeeds(needs || {});
  if (!hasAnyNeededQuota(normalizedNeeds)) {
    return {
      debt: normalizeNeeds(debt || {}),
      allocation: new Map(),
      deficits: buildZeroMetrics()
    };
  }
  const allocationResult = allocateMaximumAcrossLots(workingLots, normalizedNeeds, dateKey);
  const updates = applyAllocationToLots(workingLots, allocationResult.allocation).map((lot) => ({
    ...lot,
    lastEvaluatedDate: dateKey
  }));
  mergeLotUpdates(workingLots, updates);
  return {
    debt: addMetrics(debt || buildZeroMetrics(), allocationResult.deficits || {}, 1, { clampFloor: 0 }),
    allocation: allocationResult.allocation,
    deficits: allocationResult.deficits
  };
}

function applyDebtToWorkingLots(workingLots = [], debt = {}, dateKey = '') {
  const normalizedDebt = normalizeNeeds(debt || {});
  if (!hasAnyNeededQuota(normalizedDebt)) return buildZeroMetrics();
  const allocationResult = allocateMaximumAcrossLots(workingLots, normalizedDebt, dateKey);
  const updates = applyAllocationToLots(workingLots, allocationResult.allocation).map((lot) => ({
    ...lot,
    lastEvaluatedDate: dateKey
  }));
  mergeLotUpdates(workingLots, updates);
  return normalizeNeeds(allocationResult.deficits || {});
}

function lotMetricsFromLedgerRow(row = {}) {
  return {
    call: Math.max(0, Number(row.call || 0)),
    amount: Math.max(0, Number(row.amount || 0)),
    token: Math.max(0, Number(row.token || 0)),
    volume: Math.max(0, Number(row.volume || 0))
  };
}

function createLotPayloadFromLedgerCredit(row = {}, { timezone = DEFAULT_ORG_TIMEZONE } = {}) {
  const metrics = lotMetricsFromLedgerRow(row);
  const validity = normalizeValidityPayload(row.validity || {}, timezone);
  const hasRemaining = hasAnyPositiveMetric(metrics);
  const creditEntryId = cleanString(row.id, { max: 120, allowEmpty: true }) || `AQL-CREDIT-${Date.now()}`;
  return {
    id: buildStableCreditLotId(creditEntryId),
    orgId: toPublicId(row.orgId || ''),
    userId: toPublicId(row.userId || ''),
    section: cleanString(row.section, { max: 120, allowEmpty: true }) || '',
    operation: cleanString(row.operation, { max: 120, allowEmpty: true }) || '',
    creditEntryId,
    creditDateTime: normalizeIsoDateTime(row.dateTime, { allowEmpty: true }) || new Date().toISOString(),
    dateTime: normalizeIsoDateTime(row.dateTime, { allowEmpty: true }) || new Date().toISOString(),
    metrics,
    remaining: { ...metrics },
    validity,
    status: hasRemaining ? 'active' : 'exhausted',
    source: {
      module: cleanString(row?.source?.module, { max: 80, allowEmpty: true }) || 'activity_quota',
      eventType: cleanString(row?.source?.eventType, { max: 80, allowEmpty: true }) || 'credit',
      eventId: cleanString(row?.source?.eventId, { max: 180, allowEmpty: true }) || cleanString(row.id, { max: 120, allowEmpty: true }) || '',
      idempotencyKey: cleanString(row?.source?.idempotencyKey, { max: 220, allowEmpty: true }) || ''
    },
    lastEvaluatedDate: '',
    version: 1,
    audit: {
      createUser: cleanString(row?.audit?.createUser, { max: 120, allowEmpty: true }) || 'System',
      createDateTime: normalizeIsoDateTime(row?.audit?.createDateTime, { allowEmpty: true }) || new Date().toISOString(),
      lastUpdateUser: cleanString(row?.audit?.lastUpdateUser, { max: 120, allowEmpty: true })
        || cleanString(row?.audit?.createUser, { max: 120, allowEmpty: true })
        || 'System',
      lastUpdateDateTime: normalizeIsoDateTime(row?.audit?.lastUpdateDateTime, { allowEmpty: true })
        || normalizeIsoDateTime(row?.audit?.createDateTime, { allowEmpty: true })
        || new Date().toISOString()
    }
  };
}

function createSnapshotPayloadFromKey(keyFilter = {}, metrics = {}, meta = {}) {
  return {
    orgId: toPublicId(keyFilter.orgId || ''),
    userId: toPublicId(keyFilter.userId || ''),
    section: cleanString(keyFilter.section, { max: 120, allowEmpty: true }) || '',
    operation: cleanString(keyFilter.operation, { max: 120, allowEmpty: true }) || '',
    metrics: normalizeMetrics(metrics, { allowNegative: true }),
    version: Number.parseInt(String(meta.version || 1), 10) || 1,
    lastEvaluatedDate: cleanDateOnly(meta.lastEvaluatedDate, { allowEmpty: true }) || '',
    lastReconciledAt: normalizeIsoDateTime(meta.lastReconciledAt, { allowEmpty: true }) || '',
    dateTime: normalizeIsoDateTime(meta.dateTime, { allowEmpty: true }) || new Date().toISOString(),
    audit: {
      createUser: cleanString(meta?.audit?.createUser, { max: 120, allowEmpty: true }) || 'System',
      createDateTime: normalizeIsoDateTime(meta?.audit?.createDateTime, { allowEmpty: true }) || new Date().toISOString(),
      lastUpdateUser: cleanString(meta?.audit?.lastUpdateUser, { max: 120, allowEmpty: true }) || 'System',
      lastUpdateDateTime: normalizeIsoDateTime(meta?.audit?.lastUpdateDateTime, { allowEmpty: true }) || new Date().toISOString()
    }
  };
}

async function listLotsForKey(keyFilter = {}, options = {}) {
  return quotaCreditLotRepository.list({
    query: {
      orgId__eq: toPublicId(keyFilter.orgId || ''),
      userId__eq: toPublicId(keyFilter.userId || ''),
      section__eq: cleanString(keyFilter.section, { max: 120, allowEmpty: true }) || '',
      operation__eq: cleanString(keyFilter.operation, { max: 120, allowEmpty: true }) || '',
      page: 1,
      limit: 20000
    },
    scope: { canViewAll: true },
    sort: { dateTime: 1, id: 1 },
    backendMode: options?.backendMode
  });
}

async function ensureSnapshotForKey(keyFilter = {}, options = {}) {
  const existing = await quotaBalanceSnapshotRepository.getByKey(keyFilter, {
    backendMode: options?.backendMode
  });
  if (existing) return existing;

  const payload = createSnapshotPayloadFromKey(keyFilter, buildZeroMetrics(), {
    version: 1,
    dateTime: new Date().toISOString(),
    audit: {
      createUser: 'System',
      createDateTime: new Date().toISOString(),
      lastUpdateUser: 'System',
      lastUpdateDateTime: new Date().toISOString()
    }
  });
  return quotaBalanceSnapshotRepository.upsertByKey(payload, {
    backendMode: options?.backendMode
  });
}

async function adjustSnapshotByDeltaUnlocked(keyFilter = {}, delta = {}, options = {}) {
  const safeDelta = normalizeMetrics(delta, { allowNegative: true });
  let attempts = 0;
  while (attempts < 5) {
    attempts += 1;
    const current = await ensureSnapshotForKey(keyFilter, options);
    const nextMetrics = addMetrics(current.metrics || {}, safeDelta, 1, { clampFloor: 0 });
    const updated = await quotaBalanceSnapshotRepository.updateWithVersion(
      current.id,
      Number.parseInt(String(current.version || 1), 10) || 1,
      {
        metrics: nextMetrics,
        dateTime: new Date().toISOString(),
        audit: {
          lastUpdateUser: 'System',
          lastUpdateDateTime: new Date().toISOString()
        }
      },
      { backendMode: options?.backendMode }
    );
    if (updated) return updated;
  }
  throw new Error('Failed to update quota balance snapshot due to concurrent updates.');
}

async function adjustSnapshotByDelta(keyFilter = {}, delta = {}, options = {}) {
  const lockKey = buildQuotaKey(keyFilter);
  return withQuotaKeyLock(lockKey, async () => adjustSnapshotByDeltaUnlocked(keyFilter, delta, options));
}

async function refreshExpiredLotsForKeyUnlocked(keyFilter = {}, options = {}) {
  const timezone = await resolveOrgTimezone(keyFilter.orgId, options);
  const todayKey = getDateKeyInTimeZone('', timezone);
  const lots = await listLotsForKey(keyFilter, options);
  const activeLots = (Array.isArray(lots) ? lots : []).filter((row) => {
    return cleanString(row?.status, { max: 40, allowEmpty: true }).toLowerCase() === 'active';
  });

  if (!activeLots.length) {
    await ensureSnapshotForKey(keyFilter, options);
    return {
      expiredCount: 0,
      expiredMetrics: buildZeroMetrics(),
      dateKey: todayKey
    };
  }

  const expiredMetrics = buildZeroMetrics();
  let expiredCount = 0;
  for (const lot of activeLots) {
    if (!isValidityExpired(lot.validity || {}, todayKey)) continue;
    const remaining = normalizeNeeds(lot.remaining || {});
    if (hasAnyNeededQuota(remaining)) {
      Object.assign(expiredMetrics, addMetrics(expiredMetrics, remaining, 1));
    }
    const updated = await quotaCreditLotRepository.updateWithVersion(
      lot.id,
      Number.parseInt(String(lot.version || 1), 10) || 1,
      {
        remaining: buildZeroMetrics(),
        status: 'expired',
        lastEvaluatedDate: todayKey,
        dateTime: new Date().toISOString()
      },
      { backendMode: options?.backendMode }
    );
    if (!updated) {
      throw new Error('Failed to expire quota lot because it was concurrently updated.');
    }
    expiredCount += 1;
  }

  if (hasAnyNeededQuota(expiredMetrics)) {
    await adjustSnapshotByDeltaUnlocked(keyFilter, addMetrics(buildZeroMetrics(), expiredMetrics, -1), options);
  } else {
    const snapshot = await ensureSnapshotForKey(keyFilter, options);
    await quotaBalanceSnapshotRepository.updateWithVersion(
      snapshot.id,
      Number.parseInt(String(snapshot.version || 1), 10) || 1,
      {
        lastEvaluatedDate: todayKey,
        dateTime: new Date().toISOString()
      },
      { backendMode: options?.backendMode }
    );
  }

  return {
    expiredCount,
    expiredMetrics,
    dateKey: todayKey
  };
}

async function refreshExpiredLotsForKey(keyFilter = {}, options = {}) {
  const lockKey = buildQuotaKey(keyFilter);
  return withQuotaKeyLock(lockKey, async () => refreshExpiredLotsForKeyUnlocked(keyFilter, options));
}

async function applyLotUpdates(lots = [], options = {}) {
  for (const lot of lots) {
    const currentVersion = Number.parseInt(String(lot.version || 1), 10) || 1;
    const patch = {
      remaining: normalizeNeeds(lot.remaining || {}),
      status: cleanString(lot.status, { max: 40, allowEmpty: true }).toLowerCase() || 'exhausted',
      lastEvaluatedDate: cleanDateOnly(lot.lastEvaluatedDate, { allowEmpty: true }) || '',
      dateTime: normalizeIsoDateTime(lot.dateTime, { allowEmpty: true }) || new Date().toISOString()
    };
    // eslint-disable-next-line no-await-in-loop
    const updated = await quotaCreditLotRepository.updateWithVersion(
      lot.id,
      currentVersion,
      patch,
      { backendMode: options?.backendMode }
    );
    if (!updated) {
      throw new Error('Failed to update quota lot due to concurrent changes.');
    }
  }
}

async function applyConsumptionToProjection({
  keyFilter = {},
  needs = {},
  entryPayload = null,
  options = {}
} = {}) {
  const quotaKey = buildQuotaKey(keyFilter);
  return withQuotaKeyLock(quotaKey, async () => {
    assertQuotaKeyFilter(keyFilter);
    const timezone = await resolveOrgTimezone(keyFilter.orgId, options);
    const todayKey = getDateKeyInTimeZone('', timezone);
    const rebuilt = await rebuildProjectionForKeyInternal(keyFilter, options);
    let snapshot = rebuilt?.snapshot || await ensureSnapshotForKey(keyFilter, options);
    const normalizedNeeds = normalizeNeeds(needs || {});

    const deficitsFromSnapshot = buildZeroMetrics();
    METRIC_FIELDS.forEach((field) => {
      const required = Number(normalizedNeeds[field] || 0);
      const available = Number(snapshot?.metrics?.[field] || 0);
      deficitsFromSnapshot[field] = Number(Math.max(0, required - available).toFixed(6));
    });
    const snapshotHasDeficit = METRIC_FIELDS.some((field) => deficitsFromSnapshot[field] > 0);
    if (snapshotHasDeficit) {
      return {
        allowed: false,
        deficits: deficitsFromSnapshot,
        allocation: new Map(),
        snapshot
      };
    }

    let lots = await listLotsForKey(keyFilter, options);
    const requestedAllocation = normalizeAllocationPayload(entryPayload?.allocation || {});
    let allocation = buildAllocationMapFromRows(requestedAllocation.lots || []);
    if (!allocation.size) {
      const allocationResult = allocateNeedsAcrossLots(lots, normalizedNeeds, todayKey);
      if (!allocationResult.ok) {
        return {
          allowed: false,
          deficits: allocationResult.deficits,
          allocation: allocationResult.allocation,
          snapshot
        };
      }
      allocation = allocationResult.allocation;
    }

    const lotUpdates = applyAllocationToLots(lots, allocation)
      .map((lot) => ({
        ...lot,
        lastEvaluatedDate: todayKey,
        dateTime: new Date().toISOString()
      }));

    await applyLotUpdates(lotUpdates, options);

    let attempts = 0;
    let updatedSnapshot = null;
    while (attempts < 5) {
      attempts += 1;
      const current = await ensureSnapshotForKey(keyFilter, options);
      const nextMetrics = subtractMetrics(current.metrics || {}, normalizedNeeds, { clampFloor: 0 });
      // eslint-disable-next-line no-await-in-loop
      const updated = await quotaBalanceSnapshotRepository.updateWithVersion(
        current.id,
        Number.parseInt(String(current.version || 1), 10) || 1,
        {
          metrics: nextMetrics,
          lastEvaluatedDate: todayKey,
          dateTime: new Date().toISOString(),
          audit: {
            lastUpdateUser: cleanString(entryPayload?.audit?.lastUpdateUser, { max: 120, allowEmpty: true }) || 'System',
            lastUpdateDateTime: new Date().toISOString()
          }
        },
        { backendMode: options?.backendMode }
      );
      if (updated) {
        updatedSnapshot = updated;
        break;
      }
    }
    if (!updatedSnapshot) {
      throw new Error('Failed to update quota snapshot for consumption because of concurrent changes.');
    }

    return {
      allowed: true,
      deficits: buildZeroMetrics(),
      allocation,
      snapshot: updatedSnapshot
    };
  });
}

async function createConsumptionLedgerEntry({
  payload = {},
  allocation = new Map(),
  options = {}
} = {}) {
  const allocationRows = materializeAllocationRows(allocation);
  const normalized = buildLedgerEntryPayload({
    ...(isPlainObject(payload) ? payload : {}),
    entryType: 'consumption',
    allocation: {
      policy: 'FEFO',
      lots: allocationRows
    }
  }, {
    ...options,
    entryType: 'consumption'
  });
  if (!normalized.id) delete normalized.id;
  return activityQuotaLedgerRepository.create(normalized, {
    backendMode: options?.backendMode
  });
}

async function applyCreditToProjection(entry = {}, options = {}) {
  const keyFilter = buildQuotaKeyFilter(entry);
  const quotaKey = buildQuotaKey(keyFilter);
  return withQuotaKeyLock(quotaKey, async () => {
    const timezone = await resolveOrgTimezone(entry.orgId, options);
    const lotPayload = createLotPayloadFromLedgerCredit(entry, { timezone });
    const createdLot = await quotaCreditLotRepository.create(lotPayload, {
      backendMode: options?.backendMode
    });

    const todayKey = getDateKeyInTimeZone('', timezone);
    const contributesNow = isLotEligibleForDate(createdLot, todayKey);
    if (contributesNow && hasAnyPositiveMetric(createdLot.remaining || {})) {
      await adjustSnapshotByDeltaUnlocked(keyFilter, createdLot.remaining || {}, options);
    } else {
      await ensureSnapshotForKey(keyFilter, options);
    }
    return createdLot;
  });
}

async function applyAdjustmentToProjection(entry = {}, options = {}) {
  const keyFilter = buildQuotaKeyFilter(entry);
  const quotaKey = buildQuotaKey(keyFilter);
  return withQuotaKeyLock(quotaKey, async () => {
    const timezone = await resolveOrgTimezone(entry.orgId, options);
    const todayKey = getDateKeyInTimeZone('', timezone);
    const metrics = normalizeMetrics(entry, { allowNegative: true });
    const positive = buildZeroMetrics();
    const negativeNeeds = buildZeroMetrics();
    METRIC_FIELDS.forEach((field) => {
      const value = Number(metrics[field] || 0);
      if (value > 0) positive[field] = value;
      else if (value < 0) negativeNeeds[field] = Number(Math.abs(value).toFixed(6));
    });

    if (hasAnyPositiveMetric(positive)) {
      const lotPayload = createLotPayloadFromLedgerCredit({
        ...entry,
        call: positive.call,
        amount: positive.amount,
        token: positive.token,
        volume: positive.volume,
        source: {
          ...(isPlainObject(entry.source) ? entry.source : {}),
          eventType: cleanString(entry?.source?.eventType, { max: 80, allowEmpty: true }) || 'admin_adjustment'
        }
      }, { timezone });
      // eslint-disable-next-line no-await-in-loop
      const createdLot = await quotaCreditLotRepository.create(lotPayload, {
        backendMode: options?.backendMode
      });
      if (isLotEligibleForDate(createdLot, todayKey)) {
        await adjustSnapshotByDeltaUnlocked(keyFilter, createdLot.remaining || {}, options);
      }
    }

    if (hasAnyNeededQuota(negativeNeeds)) {
      const lots = await listLotsForKey(keyFilter, options);
      const allocationResult = allocateMaximumAcrossLots(lots, negativeNeeds, todayKey);
      const updates = applyAllocationToLots(lots, allocationResult.allocation).map((lot) => ({
        ...lot,
        lastEvaluatedDate: todayKey,
        dateTime: new Date().toISOString()
      }));
      await applyLotUpdates(updates, options);
      await adjustSnapshotByDeltaUnlocked(
        keyFilter,
        addMetrics(buildZeroMetrics(), negativeNeeds, -1),
        options
      );
    }
  });
}

function buildQuotaNeedsDeficits(needs = {}, snapshot = {}) {
  const deficits = buildZeroMetrics();
  METRIC_FIELDS.forEach((field) => {
    const required = Number(needs[field] || 0);
    const available = Number(snapshot?.metrics?.[field] || 0);
    deficits[field] = Number(Math.max(0, required - available).toFixed(6));
  });
  return deficits;
}

function buildQuotaMessage(needs = {}, deficits = {}, snapshot = {}) {
  const failing = METRIC_FIELDS.filter((field) => Number(deficits[field] || 0) > 0);
  if (!failing.length) return 'Quota available.';
  const details = failing
    .map((field) => `${field} (need ${needs[field]}, available ${Number(snapshot?.metrics?.[field] || 0)})`)
    .join(', ');
  return `Insufficient activity quota: ${details}.`;
}

async function rebuildProjectionForKeyInternal(keyFilter = {}, options = {}) {
  assertQuotaKeyFilter(keyFilter);
  const timezone = await resolveOrgTimezone(keyFilter.orgId, options);
  const rows = await activityQuotaLedgerRepository.list({
    query: {
      orgId__eq: keyFilter.orgId,
      userId__eq: keyFilter.userId,
      section__eq: keyFilter.section,
      operation__eq: keyFilter.operation,
      page: 1,
      limit: 50000
    },
    scope: { canViewAll: true },
    sort: { dateTime: 1, id: 1 },
    backendMode: options?.backendMode
  });

  const workingLots = [];
  let debt = buildZeroMetrics();
  const todayKey = getDateKeyInTimeZone('', timezone);
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const entryType = normalizeEntryType(row?.entryType, 'consumption');
    if (entryType === 'credit') {
      workingLots.push(createLotPayloadFromLedgerCredit(row, { timezone }));
      debt = applyDebtToWorkingLots(workingLots, debt, todayKey);
      continue;
    }

    if (entryType === 'consumption') {
      const dateKey = getDateKeyInTimeZone(row?.dateTime || '', timezone);
      const metrics = normalizeNeeds(row || {});
      const result = consumeWorkingLotsWithDebt(workingLots, metrics, dateKey, debt);
      debt = result.debt;
      continue;
    }

    // Adjustment replay: positive => synthetic lot, negative => consume max.
    const metrics = normalizeMetrics(row || {}, { allowNegative: true });
    const positive = buildZeroMetrics();
    const negativeNeeds = buildZeroMetrics();
    METRIC_FIELDS.forEach((field) => {
      const value = Number(metrics[field] || 0);
      if (value > 0) positive[field] = value;
      else if (value < 0) negativeNeeds[field] = Number(Math.abs(value).toFixed(6));
    });

    if (hasAnyPositiveMetric(positive)) {
      workingLots.push(createLotPayloadFromLedgerCredit({
        ...row,
        call: positive.call,
        amount: positive.amount,
        token: positive.token,
        volume: positive.volume
      }, { timezone }));
      debt = applyDebtToWorkingLots(workingLots, debt, todayKey);
    }
    if (hasAnyNeededQuota(negativeNeeds)) {
      const dateKey = getDateKeyInTimeZone(row?.dateTime || '', timezone);
      const result = consumeWorkingLotsWithDebt(workingLots, negativeNeeds, dateKey, debt);
      debt = result.debt;
    }
  }

  workingLots.forEach((lot) => {
    const remaining = normalizeNeeds(lot.remaining || {});
    if (!hasAnyNeededQuota(remaining)) {
      lot.status = 'exhausted';
      lot.remaining = buildZeroMetrics();
      lot.lastEvaluatedDate = todayKey;
      return;
    }
    if (isValidityExpired(lot.validity || {}, todayKey)) {
      lot.status = 'expired';
      lot.remaining = buildZeroMetrics();
      lot.lastEvaluatedDate = todayKey;
      return;
    }
    lot.status = 'active';
    lot.lastEvaluatedDate = todayKey;
  });

  let availableMetrics = buildZeroMetrics();
  workingLots
    .filter((lot) => isLotEligibleForDate(lot, todayKey))
    .forEach((lot) => {
      availableMetrics = addMetrics(availableMetrics, lot.remaining || {}, 1);
    });
  const projectedMetrics = subtractMetrics(availableMetrics, debt || {}, { clampFloor: null });

  await quotaCreditLotRepository.removeByKey(keyFilter, {
    backendMode: options?.backendMode
  });
  if (workingLots.length) {
    await quotaCreditLotRepository.create(workingLots, {
      backendMode: options?.backendMode
    });
  }

  const snapshotPayload = createSnapshotPayloadFromKey(keyFilter, projectedMetrics, {
    lastEvaluatedDate: todayKey,
    lastReconciledAt: new Date().toISOString(),
    dateTime: new Date().toISOString(),
    audit: {
      createUser: 'System',
      createDateTime: new Date().toISOString(),
      lastUpdateUser: 'System',
      lastUpdateDateTime: new Date().toISOString()
    }
  });
  const snapshot = await quotaBalanceSnapshotRepository.upsertByKey(snapshotPayload, {
    backendMode: options?.backendMode
  });

  return {
    key: keyFilter,
    lotCount: workingLots.length,
    available: projectedMetrics,
    debt,
    snapshot
  };
}

const activityQuotaLedgerService = {
  METRIC_FIELDS,

  async listEntries(filters = {}, options = {}) {
    return activityQuotaLedgerRepository.list({
      query: buildLedgerQuery(filters),
      scope: {
        canViewAll: true,
        orgId: toPublicId(filters.orgId || ''),
        userId: toPublicId(filters.userId || '')
      },
      sort: options?.sort || { dateTime: -1, id: -1 },
      pagination: options?.pagination || null,
      backendMode: options?.backendMode
    });
  },

  async getEntryById(id, options = {}) {
    return activityQuotaLedgerRepository.getById(id, {
      backendMode: options?.backendMode
    });
  },

  async recordEntry(payload = {}, options = {}) {
    const normalized = buildLedgerEntryPayload(payload, options);
    if (!normalized.id) delete normalized.id;

    if (normalized.entryType === 'consumption') {
      const keyFilter = buildQuotaKeyFilter(normalized);
      const needs = normalizeNeeds(normalized || {});
      const result = await applyConsumptionToProjection({
        keyFilter,
        needs,
        entryPayload: normalized,
        options
      });
      if (!result.allowed) {
        throw new Error(buildQuotaMessage(needs, result.deficits, result.snapshot || {}));
      }
      const allocationRows = materializeAllocationRows(result.allocation || new Map());
      try {
        const createdConsumption = await activityQuotaLedgerRepository.create({
          ...normalized,
          allocation: {
            policy: 'FEFO',
            lots: allocationRows
          }
        }, {
          backendMode: options?.backendMode
        });
        return createdConsumption;
      } catch (error) {
        try {
          await this.rebuildProjectionForKey(keyFilter, { backendMode: options?.backendMode });
        } catch (_) {
          // Ignore rollback errors; original write error is more actionable to caller.
        }
        throw error;
      }
    }

    if (normalized.entryType === 'credit') {
      const isPackageCredit = cleanString(normalized?.source?.eventType, { max: 80, allowEmpty: true }).toLowerCase() === 'package_credit';
      if (isPackageCredit && cleanString(normalized?.validity?.mode, { max: 20, allowEmpty: true }).toLowerCase() !== 'date_range') {
        throw new Error('Package credits must include a date_range validity window.');
      }
    }

    const created = await activityQuotaLedgerRepository.create(normalized, {
      backendMode: options?.backendMode
    });

    const keyFilter = buildQuotaKeyFilter(created);
    try {
      if (normalized.entryType === 'credit' || normalized.entryType === 'adjustment') {
        await this.rebuildProjectionForKey(keyFilter, { backendMode: options?.backendMode });
      }
    } catch (error) {
      try {
        await this.rebuildProjectionForKey(keyFilter, { backendMode: options?.backendMode });
      } catch (_) {
        // Ignore recovery failure and rethrow original projection error.
      }
      throw error;
    }

    return created;
  },

  async recordSystemEntry(payload = {}, options = {}) {
    return this.recordEntry(payload, {
      ...options,
      forceSystem: true
    });
  },

  async recordCredit(payload = {}, options = {}) {
    return this.recordEntry(
      { ...(isPlainObject(payload) ? payload : {}), entryType: 'credit' },
      options
    );
  },

  async recordConsumption(payload = {}, options = {}) {
    return this.recordEntry(
      { ...(isPlainObject(payload) ? payload : {}), entryType: 'consumption' },
      options
    );
  },

  async recordConsumptionWithoutCheck(payload = {}, options = {}) {
    const source = isPlainObject(payload) ? payload : {};
    const normalizedNeeds = normalizeNeeds(source.needs || source);
    if (!hasAnyNeededQuota(normalizedNeeds)) return null;

    const normalizedPayload = {
      ...source,
      entryType: 'consumption',
      call: normalizedNeeds.call,
      amount: normalizedNeeds.amount,
      token: normalizedNeeds.token,
      volume: normalizedNeeds.volume
    };

    const existingByIdempotency = await findExistingConsumptionByIdempotency(normalizedPayload, options);
    if (existingByIdempotency) return existingByIdempotency;

    const createdConsumption = await createConsumptionLedgerEntry({
      payload: {
        ...normalizedPayload
      },
      allocation: new Map(),
      options
    }).catch(async (error) => {
      if (isDuplicateSourceIdempotencyError(error)) {
        const existing = await findExistingConsumptionByIdempotency(normalizedPayload, options);
        if (existing) return existing;
      }
      throw error;
    });
    const keyFilter = buildQuotaKeyFilter(createdConsumption || normalizedPayload);
    await this.rebuildProjectionForKey(keyFilter, { backendMode: options?.backendMode });
    return createdConsumption;
  },

  async recordAdjustment(payload = {}, options = {}) {
    return this.recordEntry(
      { ...(isPlainObject(payload) ? payload : {}), entryType: 'adjustment' },
      options
    );
  },

  async consumeIfAvailable(input = {}, options = {}) {
    const keyFilter = buildQuotaKeyFilter(input || {});
    assertQuotaKeyFilter(keyFilter);
    const needs = normalizeNeeds(input.needs || {});
    if (!hasAnyNeededQuota(needs)) {
      return {
        allowed: true,
        message: 'No quota needed.',
        needs,
        deficits: buildZeroMetrics(),
        snapshot: await ensureSnapshotForKey(keyFilter, options),
        entry: null
      };
    }

    const existingByIdempotency = await findExistingConsumptionByIdempotency({
      ...(isPlainObject(input) ? input : {}),
      orgId: keyFilter.orgId,
      userId: keyFilter.userId,
      section: keyFilter.section,
      operation: keyFilter.operation
    }, options);
    if (existingByIdempotency) {
      return {
        allowed: true,
        message: 'Quota consumption already recorded for this request.',
        needs: normalizeNeeds(existingByIdempotency),
        deficits: buildZeroMetrics(),
        snapshot: await ensureSnapshotForKey(keyFilter, options),
        entry: existingByIdempotency,
        replayed: true
      };
    }

    const result = await applyConsumptionToProjection({
      keyFilter,
      needs,
      entryPayload: input,
      options
    });
    if (!result.allowed) {
      return {
        allowed: false,
        message: buildQuotaMessage(needs, result.deficits, result.snapshot || {}),
        needs,
        deficits: result.deficits,
        snapshot: result.snapshot
      };
    }

    const entry = await createConsumptionLedgerEntry({
      payload: {
        ...(isPlainObject(input) ? input : {}),
        orgId: keyFilter.orgId,
        userId: keyFilter.userId,
        section: keyFilter.section,
        operation: keyFilter.operation,
        call: needs.call,
        amount: needs.amount,
        token: needs.token,
        volume: needs.volume
      },
      allocation: result.allocation,
      options
    }).catch(async (error) => {
      if (isDuplicateSourceIdempotencyError(error)) {
        const existing = await findExistingConsumptionByIdempotency({
          ...(isPlainObject(input) ? input : {}),
          orgId: keyFilter.orgId,
          userId: keyFilter.userId,
          section: keyFilter.section,
          operation: keyFilter.operation
        }, options);
        if (existing) {
          try {
            await this.rebuildProjectionForKey(keyFilter, { backendMode: options?.backendMode });
          } catch (_) {
            // Ignore recovery failure for duplicate idempotent replay.
          }
          return existing;
        }
      }
      try {
        await this.rebuildProjectionForKey(keyFilter, { backendMode: options?.backendMode });
      } catch (_) {
        // Ignore recovery failure and propagate original write error.
      }
      throw error;
    });

    return {
      allowed: true,
      message: 'Quota consumed.',
      needs,
      deficits: buildZeroMetrics(),
      snapshot: result.snapshot,
      entry
    };
  },

  async calculateQuotaSnapshot(filters = {}, options = {}) {
    const keyFilter = buildQuotaKeyFilter(filters || {});
    assertQuotaKeyFilter(keyFilter);
    const rebuilt = await this.rebuildProjectionForKey(keyFilter, { backendMode: options?.backendMode });
    const snapshot = rebuilt?.snapshot || await ensureSnapshotForKey(keyFilter, options);

    const metrics = normalizeMetrics(snapshot.metrics || {}, { allowNegative: true });
    return {
      filters: {
        orgId: keyFilter.orgId,
        userId: keyFilter.userId,
        section: keyFilter.section,
        operation: keyFilter.operation
      },
      totalEntries: 0,
      totals: {
        credit: buildZeroMetrics(),
        consumption: buildZeroMetrics(),
        adjustment: buildZeroMetrics(),
        available: metrics
      },
      projection: {
        snapshotId: snapshot.id,
        version: snapshot.version,
        lastEvaluatedDate: snapshot.lastEvaluatedDate || '',
        lastReconciledAt: snapshot.lastReconciledAt || ''
      }
    };
  },

  async evaluateQuota(input = {}, options = {}) {
    const keyFilter = buildQuotaKeyFilter(input || {});
    assertQuotaKeyFilter(keyFilter);
    const needs = normalizeNeeds(input.needs || {});
    const snapshotBundle = await this.calculateQuotaSnapshot(keyFilter, options);
    const availableSnapshot = {
      metrics: snapshotBundle?.totals?.available || buildZeroMetrics()
    };
    const deficits = buildQuotaNeedsDeficits(needs, availableSnapshot);
    const allowed = METRIC_FIELDS.every((field) => deficits[field] <= 0);
    return {
      allowed,
      message: buildQuotaMessage(needs, deficits, availableSnapshot),
      needs,
      deficits,
      snapshot: snapshotBundle
    };
  },

  async rebuildProjectionForKey(filters = {}, options = {}) {
    const keyFilter = buildQuotaKeyFilter(filters || {});
    assertQuotaKeyFilter(keyFilter);
    const quotaKey = buildQuotaKey(keyFilter);
    return withQuotaKeyLock(quotaKey, async () => rebuildProjectionForKeyInternal(keyFilter, options));
  },

  async rebuildProjectionForKeys(filtersList = [], options = {}) {
    const rows = Array.isArray(filtersList) ? filtersList : [filtersList];
    const deduped = new Map();
    rows.forEach((row) => {
      const keyFilter = buildQuotaKeyFilter(row || {});
      if (!keyFilter.orgId || !keyFilter.userId || !keyFilter.section || !keyFilter.operation) return;
      deduped.set(buildQuotaKey(keyFilter), keyFilter);
    });
    const results = [];
    for (const keyFilter of deduped.values()) {
      // eslint-disable-next-line no-await-in-loop
      const rebuilt = await this.rebuildProjectionForKey(keyFilter, options);
      results.push(rebuilt);
    }
    return results;
  },

  async clearByOrg(orgId, options = {}) {
    const [ledgerResult, lotsResult, snapshotsResult] = await Promise.all([
      activityQuotaLedgerRepository.clearByOrg(orgId, { backendMode: options?.backendMode }),
      quotaCreditLotRepository.clearByOrg(orgId, { backendMode: options?.backendMode }),
      quotaBalanceSnapshotRepository.clearByOrg(orgId, { backendMode: options?.backendMode })
    ]);
    return {
      ledger: ledgerResult,
      lots: lotsResult,
      snapshots: snapshotsResult
    };
  },

  async clearAllQuotaTransactions(options = {}) {
    const [ledgerResult, groupsDeleteResult, lotsResult, snapshotsResult] = await Promise.all([
      this._clearAllLedger(options),
      this._clearAllCreditGroups(options),
      quotaCreditLotRepository.clearAll({ backendMode: options?.backendMode }),
      quotaBalanceSnapshotRepository.clearAll({ backendMode: options?.backendMode })
    ]);
    return {
      ledger: ledgerResult,
      groups: groupsDeleteResult,
      lots: lotsResult,
      snapshots: snapshotsResult
    };
  },

  async _clearAllLedger(options = {}) {
    const rows = await activityQuotaLedgerRepository.list({
      query: { page: 1, limit: 200000 },
      scope: { canViewAll: true },
      sort: { dateTime: -1, id: -1 },
      backendMode: options?.backendMode
    });
    let removed = 0;
    for (const row of (Array.isArray(rows) ? rows : [])) {
      // eslint-disable-next-line no-await-in-loop
      const result = await activityQuotaLedgerRepository.remove(row.id, {
        backendMode: options?.backendMode
      });
      if (result === true || Number(result?.deletedCount || 0) > 0) removed += 1;
    }
    return {
      removed,
      remaining: 0
    };
  },

  async _clearAllCreditGroups(options = {}) {
    const activityQuotaCreditGroupRepository = require('../repositories/activityQuotaCreditGroupRepository');
    const rows = await activityQuotaCreditGroupRepository.list({
      query: { page: 1, limit: 200000 },
      scope: { canViewAll: true },
      sort: { dateTime: -1, id: -1 },
      backendMode: options?.backendMode
    });
    let removed = 0;
    for (const row of (Array.isArray(rows) ? rows : [])) {
      // eslint-disable-next-line no-await-in-loop
      const result = await activityQuotaCreditGroupRepository.remove(row.id, {
        backendMode: options?.backendMode
      });
      if (result === true || Number(result?.deletedCount || 0) > 0) removed += 1;
    }
    return {
      removed,
      remaining: 0
    };
  },

  createUserCreatorSnapshot(requestUser, orgId = '') {
    return buildUserCreatorFromRequest(requestUser, orgId);
  },

  createSystemCreatorSnapshot(orgId = '') {
    return buildSystemCreator(orgId);
  },

  normalizeNeeds,

  __testables: {
    normalizeValidityPayload,
    isValidityActive,
    isValidityExpired,
    allocateNeedsAcrossLots,
    allocateMaximumAcrossLots,
    addMetrics,
    subtractMetrics,
    getDateKeyInTimeZone
  }
};

module.exports = activityQuotaLedgerService;
