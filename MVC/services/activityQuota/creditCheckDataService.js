const activityQuotaLedgerRepository = require('../../repositories/activityQuotaLedgerRepository');
const quotaBalanceSnapshotRepository = require('../../repositories/quotaBalanceSnapshotRepository');
const quotaCreditLotRepository = require('../../repositories/quotaCreditLotRepository');
const activityQuotaPackageRepository = require('../../repositories/activityQuotaPackageRepository');
const addCreditDataService = require('./addCreditDataService');
const dataService = require('../dataService');
const settingService = require('../settingService');
const { toPublicId, idsEqual } = require('../../utils/idAdapter');
const { getDateKeyInTimezone } = require('../../utils/timezoneUtils');
const { SYSTEM_CONTEXT } = require('../../../config/constants');

const METRIC_FIELDS = Object.freeze(['call', 'amount', 'token', 'volume']);
const CREDIT_CHECK_LEDGER_SCAN_LIMIT = 50000;
const PICKER_USER_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'username', 'email', 'status'],
  defaultSearchFields: ['id', 'username', 'email', 'name'],
  allowMetaKeys: true
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 240, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const token = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !token) return null;
  return token.length > max ? token.slice(0, max) : token;
}

function normalizePositiveInteger(value, { fallback = 20, min = 1, max = 200 } = {}) {
  const numeric = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function resolveDefaultPageSize() {
  const configured = Number.parseInt(String(settingService.getValue('app', 'defaultPageSize') || ''), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 20;
}

function buildDateIso(value, { boundary = 'start' } = {}) {
  const token = cleanString(value, { max: 20, allowEmpty: true });
  if (!token) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    throw new Error('Date filters must use YYYY-MM-DD format.');
  }
  const iso = boundary === 'end'
    ? `${token}T23:59:59.999Z`
    : `${token}T00:00:00.000Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid date filter value.');
  }
  return parsed.toISOString();
}

function humanizeToken(value) {
  const token = cleanString(value, { max: 180, allowEmpty: true });
  if (!token) return '-';
  const words = token.replace(/[-_]+/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return token;
  return words.map((word) => {
    if (/^[A-Z0-9]{2,}$/.test(word)) return word;
    const lower = word.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');
}

function cleanDateOnly(value, { allowEmpty = true } = {}) {
  const token = cleanString(value, { max: 20, allowEmpty: true });
  if (!token) return allowEmpty ? '' : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    throw new Error('Date values must use YYYY-MM-DD format.');
  }
  return token;
}

function normalizeTimezoneToken(value, fallback = 'UTC') {
  const token = cleanString(value, { max: 80, allowEmpty: true }) || fallback;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: token });
    return token;
  } catch (_) {
    return fallback;
  }
}

function getDateKeyInTimeZone(isoDateTime = '', timeZone = 'UTC') {
  return getDateKeyInTimezone(isoDateTime, normalizeTimezoneToken(timeZone, 'UTC'));
}

function normalizeFilters(raw = {}) {
  const source = isPlainObject(raw) ? raw : {};
  const fromDate = cleanString(source.fromDate, { max: 20, allowEmpty: true }) || '';
  const toDate = cleanString(source.toDate, { max: 20, allowEmpty: true }) || '';
  const page = normalizePositiveInteger(source.page, { fallback: 1, min: 1, max: 100000 });
  const limit = normalizePositiveInteger(source.limit, {
    fallback: resolveDefaultPageSize(),
    min: 5,
    max: 200
  });
  const userId = toPublicId(source.userId || '');
  const fromIso = buildDateIso(fromDate, { boundary: 'start' });
  const toIso = buildDateIso(toDate, { boundary: 'end' });
  if (fromIso && toIso && toIso < fromIso) {
    throw new Error('To Date must be on or after From Date.');
  }
  return {
    userId,
    fromDate,
    toDate,
    fromIso,
    toIso,
    page,
    limit
  };
}

function buildKey(sectionId = '', operationId = '') {
  return `${String(sectionId || '').trim()}::${String(operationId || '').trim()}`;
}

function addIdentifierVariant(set, value, { max = 180 } = {}) {
  const raw = cleanString(value, { max, allowEmpty: true }) || '';
  const publicId = toPublicId(raw || '');
  if (raw) set.add(raw);
  if (publicId) set.add(publicId);
}

function buildLabelLookupKeys(section = {}, operation = {}) {
  const sectionIds = new Set();
  const operationIds = new Set();

  addIdentifierVariant(sectionIds, section?.id || section?.sectionId, { max: 120 });
  addIdentifierVariant(sectionIds, section?.name, { max: 180 });
  addIdentifierVariant(operationIds, operation?.id || operation?.operationId, { max: 120 });
  addIdentifierVariant(operationIds, operation?.name, { max: 180 });

  const keys = [];
  sectionIds.forEach((sectionId) => {
    operationIds.forEach((operationId) => {
      keys.push(buildKey(sectionId, operationId));
    });
  });
  return keys;
}

function buildMetricBucket() {
  return METRIC_FIELDS.reduce((acc, field) => {
    acc[field] = 0;
    return acc;
  }, {});
}

function addMetrics(target = {}, source = {}) {
  METRIC_FIELDS.forEach((field) => {
    const base = Number(target[field] || 0);
    const delta = Number(source[field] || 0);
    target[field] = Number((base + delta).toFixed(6));
  });
}

function hasAnyPositiveMetric(metrics = {}) {
  return METRIC_FIELDS.some((field) => Number(metrics[field] || 0) > 0);
}

function buildValidityBucket() {
  return {
    active: 0,
    upcoming: 0,
    expired: 0,
    perpetual: 0,
    unknown: 0
  };
}

function hasLotRemainingMetrics(lot = {}) {
  const remaining = (isPlainObject(lot?.remaining) ? lot.remaining : {});
  return METRIC_FIELDS.some((field) => Number(remaining[field] || 0) > 0);
}

function hasLotOriginalMetrics(lot = {}) {
  const metrics = (isPlainObject(lot?.metrics) ? lot.metrics : {});
  return METRIC_FIELDS.some((field) => Number(metrics[field] || 0) > 0);
}

function classifyLotValidity(lot = {}) {
  const validity = isPlainObject(lot?.validity) ? lot.validity : {};
  const mode = cleanString(validity?.mode, { max: 20, allowEmpty: true }).toLowerCase();
  const startDate = cleanDateOnly(validity?.startDate, { allowEmpty: true }) || '';
  const endDate = cleanDateOnly(validity?.endDate, { allowEmpty: true }) || '';
  const timezone = normalizeTimezoneToken(validity?.timezone, 'UTC');
  const todayKey = getDateKeyInTimeZone('', timezone);
  if (mode !== 'date_range') {
    return {
      status: 'perpetual',
      startDate: '',
      endDate: '',
      timezone,
      todayKey
    };
  }
  if (startDate && todayKey < startDate) {
    return {
      status: 'upcoming',
      startDate,
      endDate,
      timezone,
      todayKey
    };
  }
  if (endDate && todayKey > endDate) {
    return {
      status: 'expired',
      startDate,
      endDate,
      timezone,
      todayKey
    };
  }
  return {
    status: 'active',
    startDate,
    endDate,
    timezone,
    todayKey
  };
}

function normalizePickerQuery(raw = {}) {
  const source = isPlainObject(raw) ? raw : {};
  const page = normalizePositiveInteger(source.page, { fallback: 1, min: 1, max: 100000 });
  const limit = normalizePositiveInteger(source.limit, { fallback: 20, min: 5, max: 200 });
  const filtered = { ...source };
  delete filtered.page;
  delete filtered.limit;
  return { page, limit, filtered };
}

function createPagination(totalItems, page, limit) {
  const safeTotal = Math.max(0, Number(totalItems || 0));
  const safeLimit = Math.max(1, Number(limit || 20));
  const totalPages = Math.max(1, Math.ceil(safeTotal / safeLimit));
  const currentPage = Math.min(Math.max(1, Number(page || 1)), totalPages);
  const startItem = safeTotal === 0 ? 0 : ((currentPage - 1) * safeLimit) + 1;
  const endItem = safeTotal === 0 ? 0 : Math.min(safeTotal, currentPage * safeLimit);
  return {
    currentPage,
    totalPages,
    totalItems: safeTotal,
    limit: safeLimit,
    startItem,
    endItem
  };
}

function buildLatestLabelMapFromPackages(packages = []) {
  const map = new Map();
  (Array.isArray(packages) ? packages : []).forEach((pkg) => {
    const sections = Array.isArray(pkg?.sections) ? pkg.sections : [];
    sections.forEach((section) => {
      const operations = Array.isArray(section?.operations) ? section.operations : [];
      operations.forEach((operation) => {
        const label = cleanString(operation?.label || operation?.publicLabel, { max: 180, allowEmpty: true }) || '';
        if (!label) return;
        buildLabelLookupKeys(section, operation).forEach((key) => {
          if (!key || key === '::' || map.has(key)) return;
          map.set(key, label);
        });
      });
    });
  });
  return map;
}

function canSwitchTargetUser(visibility = {}) {
  if (String(visibility?.mode || '').toLowerCase() === 'all') return true;
  return String(visibility?.scopeName || '').toUpperCase() === 'ADMIN';
}

async function resolveTargetUserId(visibility = {}, requestedUserId = '', requestingUser = {}, accessContext = {}) {
  const baseResolution = resolveRequestedUserIdForMode(visibility, requestedUserId, requestingUser);
  const requesterUserId = baseResolution.requesterUserId;
  if (baseResolution.forcedByMode) {
    if (!requesterUserId) throw new Error('Authenticated user context is required.');
    return {
      targetUserId: requesterUserId,
      forced: true
    };
  }

  const candidate = toPublicId(baseResolution.candidateUserId || '');
  if (!candidate) throw new Error('Target user is required.');

  // Self is always valid for non-creator modes, even if picker visibility filtering
  // cannot return the requester row (e.g. minimal user/org profile shape).
  if (requesterUserId && idsEqual(candidate, requesterUserId)) {
    return {
      targetUserId: requesterUserId,
      forced: false
    };
  }

  const pickerRows = await addCreditDataService.listPickerUsers({
    id__eq: candidate,
    limit: 5
  }, requestingUser, accessContext);
  const match = (Array.isArray(pickerRows) ? pickerRows : []).find((row) => idsEqual(row?.id, candidate));
  if (match) {
    return {
      targetUserId: candidate,
      forced: false
    };
  }

  if (candidate !== requesterUserId && requesterUserId) {
    const requesterRows = await addCreditDataService.listPickerUsers({
      id__eq: requesterUserId,
      limit: 5
    }, requestingUser, accessContext);
    const requesterMatch = (Array.isArray(requesterRows) ? requesterRows : [])
      .find((row) => idsEqual(row?.id, requesterUserId));
    if (requesterMatch) {
      return {
        targetUserId: requesterUserId,
        forced: true
      };
    }
  }

  throw new Error('Selected user is outside your access scope.');
}

function resolveRequestedUserIdForMode(visibility = {}, requestedUserId = '', requestingUser = {}) {
  const requesterUserId = toPublicId(visibility?.requesterUserId || requestingUser?.id || '');
  if (visibility?.mode === 'creator' || !canSwitchTargetUser(visibility)) {
    return {
      requesterUserId,
      candidateUserId: requesterUserId,
      forcedByMode: true
    };
  }
  return {
    requesterUserId,
    candidateUserId: toPublicId(requestedUserId || '') || requesterUserId,
    forcedByMode: false
  };
}

async function resolveTargetUserDisplay(userId = '', options = {}) {
  const target = toPublicId(userId || '');
  if (!target) return { id: '', name: '-' };
  let row = null;
  try {
    row = await dataService.getDataById('users', target, SYSTEM_CONTEXT, {
      backendMode: options?.backendMode
    });
  } catch (_) {
    row = null;
  }
  const name = resolveUserDisplayName(row || {}, target);
  const personId = normalizeLinkedPersonId(row?.personId || '');
  const linkedPerson = await resolveLinkedPersonDisplay(personId, options);
  return {
    id: target,
    name,
    personId,
    linkedPerson,
    personName: linkedPerson?.name || ''
  };
}

function resolveNameObjectDisplay(name = {}) {
  if (!name || typeof name !== 'object' || Array.isArray(name)) return '';
  const preferred = cleanString(name?.preferred, { max: 160, allowEmpty: true }) || '';
  const first = cleanString(name?.first, { max: 120, allowEmpty: true }) || '';
  const middle = cleanString(name?.middle, { max: 120, allowEmpty: true }) || '';
  const last = cleanString(name?.last, { max: 120, allowEmpty: true }) || '';
  const full = [first, middle, last].filter(Boolean).join(' ');
  return preferred || full;
}

function resolveUserDisplayName(user = {}, fallback = '') {
  const objectName = resolveNameObjectDisplay(user?.name);
  const stringName = typeof user?.name === 'string'
    ? cleanString(user.name, { max: 220, allowEmpty: true })
    : '';
  return objectName
    || stringName
    || cleanString(user?.displayName || user?.fullName || user?.username || user?.email || fallback, {
      max: 220,
      allowEmpty: true
    })
    || fallback;
}

function normalizeLinkedPersonId(value = '') {
  const personId = toPublicId(value || '');
  const token = String(personId || '').trim();
  if (!token || /^NO[_-]?PERSON/i.test(token)) return '';
  return token;
}

function resolvePersonDisplayName(person = {}) {
  const preferred = cleanString(person?.name?.preferred, { max: 160, allowEmpty: true }) || '';
  const first = cleanString(person?.name?.first, { max: 120, allowEmpty: true }) || '';
  const middle = cleanString(person?.name?.middle, { max: 120, allowEmpty: true }) || '';
  const last = cleanString(person?.name?.last, { max: 120, allowEmpty: true }) || '';
  const full = [first, middle, last].filter(Boolean).join(' ');
  return preferred
    || full
    || cleanString(person?.identity?.displayName || person?.displayName || person?.fullName || person?.id, {
      max: 220,
      allowEmpty: true
    })
    || '';
}

async function resolveLinkedPersonDisplay(personId = '', options = {}) {
  const targetPersonId = normalizeLinkedPersonId(personId);
  if (!targetPersonId) return null;
  let person = null;
  try {
    person = await dataService.getDataById('persons', targetPersonId, SYSTEM_CONTEXT, {
      backendMode: options?.backendMode,
      enrichment: { includeSchoolRoles: false }
    });
  } catch (_) {
    person = null;
  }
  if (!person) {
    return {
      id: targetPersonId,
      name: '',
      found: false
    };
  }
  return {
    id: targetPersonId,
    name: resolvePersonDisplayName(person),
    found: true
  };
}

async function buildLatestLabelMap(activeOrgId = '', options = {}) {
  const orgId = toPublicId(activeOrgId || '');
  if (!orgId) return new Map();
  const rows = await activityQuotaPackageRepository.list({
    query: {
      orgId__eq: orgId,
      limit: 5000
    },
    scope: {
      canViewAll: true
    },
    sort: {
      'audit.lastUpdateDateTime': -1,
      'audit.createDateTime': -1,
      id: -1
    },
    backendMode: options?.backendMode
  });
  return buildLatestLabelMapFromPackages(rows || []);
}

function resolveOperationLabel(sectionId = '', operationId = '', labelMap = new Map()) {
  const key = buildKey(sectionId, operationId);
  return labelMap.get(key) || humanizeToken(operationId) || '-';
}

function toRemainingRows(rows = [], labelMap = new Map()) {
  const list = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const metrics = buildMetricBucket();
    addMetrics(metrics, row?.metrics || {});
    const sectionId = cleanString(row?.section, { max: 120, allowEmpty: true }) || '';
    const operationId = cleanString(row?.operation, { max: 120, allowEmpty: true }) || '';
    if (!sectionId || !operationId) return;
    list.push({
      id: cleanString(row?.id, { max: 120, allowEmpty: true }) || '',
      sectionId,
      operationId,
      label: resolveOperationLabel(sectionId, operationId, labelMap),
      call: Number(metrics.call || 0),
      amount: Number(metrics.amount || 0),
      token: Number(metrics.token || 0),
      volume: Number(metrics.volume || 0),
      lastEvaluatedDate: cleanString(row?.lastEvaluatedDate, { max: 20, allowEmpty: true }) || '',
      lastReconciledAt: cleanString(row?.lastReconciledAt, { max: 80, allowEmpty: true }) || ''
    });
  });
  return list.sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
}

function createCurrentLotTotalsBucket(sectionId = '', operationId = '', labelMap = new Map()) {
  const section = cleanString(sectionId, { max: 120, allowEmpty: true }) || '';
  const operation = cleanString(operationId, { max: 120, allowEmpty: true }) || '';
  return {
    sectionId: section,
    operationId: operation,
    label: resolveOperationLabel(section, operation, labelMap),
    credit: buildMetricBucket(),
    consumption: buildMetricBucket()
  };
}

function isCurrentWindowLotForBreakdown(lot = {}) {
  const status = cleanString(lot?.status, { max: 40, allowEmpty: true }).toLowerCase();
  if (status === 'void') return false;
  if (!hasLotOriginalMetrics(lot)) return false;
  const classification = classifyLotValidity(lot);
  return classification.status !== 'upcoming';
}

function buildCurrentLotCreditMap(lotRows = [], labelMap = new Map()) {
  const map = new Map();
  (Array.isArray(lotRows) ? lotRows : []).forEach((lot) => {
    if (!isCurrentWindowLotForBreakdown(lot)) return;
    const sectionId = cleanString(lot?.section, { max: 120, allowEmpty: true }) || '';
    const operationId = cleanString(lot?.operation, { max: 120, allowEmpty: true }) || '';
    if (!sectionId || !operationId) return;
    const key = buildKey(sectionId, operationId);
    if (!map.has(key)) map.set(key, createCurrentLotTotalsBucket(sectionId, operationId, labelMap));
    const bucket = map.get(key);
    const metrics = isPlainObject(lot?.metrics) ? lot.metrics : {};

    METRIC_FIELDS.forEach((field) => {
      const value = Number(metrics[field] || 0);
      if (!Number.isFinite(value) || value <= 0) return;
      bucket.credit[field] = Number((Number(bucket.credit[field] || 0) + value).toFixed(6));
    });
  });

  return map;
}

function attachCurrentLotTotalsToRemainingRows(remainingRows = [], lotRows = [], labelMap = new Map()) {
  const currentLotCreditMap = buildCurrentLotCreditMap(lotRows, labelMap);
  return (Array.isArray(remainingRows) ? remainingRows : []).map((row) => {
    const key = buildKey(row?.sectionId, row?.operationId);
    const sourceTotals = currentLotCreditMap.get(key) || createCurrentLotTotalsBucket(row?.sectionId, row?.operationId, labelMap);
    const currentLotTotals = {
      ...sourceTotals,
      credit: { ...sourceTotals.credit },
      consumption: buildMetricBucket()
    };
    METRIC_FIELDS.forEach((field) => {
      const remainingValue = Number(row?.[field] || 0);
      const remaining = Number.isFinite(remainingValue) ? remainingValue : 0;
      const credited = Math.max(0, Number(currentLotTotals.credit[field] || 0));
      const credit = Number(Math.max(credited, remaining).toFixed(6));
      currentLotTotals.credit[field] = credit;
      currentLotTotals.consumption[field] = Number(Math.max(0, credit - remaining).toFixed(6));
    });
    return {
      ...row,
      currentLotTotals
    };
  });
}

function buildRemainingValidityMap(lotRows = []) {
  const map = new Map();

  (Array.isArray(lotRows) ? lotRows : []).forEach((lot) => {
    if (!hasLotRemainingMetrics(lot)) return;
    const sectionId = cleanString(lot?.section, { max: 120, allowEmpty: true }) || '';
    const operationId = cleanString(lot?.operation, { max: 120, allowEmpty: true }) || '';
    if (!sectionId || !operationId) return;
    const key = buildKey(sectionId, operationId);
    if (!map.has(key)) {
      map.set(key, {
        sectionId,
        operationId,
        statusCounts: buildValidityBucket(),
        nearestExpiryDate: '',
        nextActivationDate: '',
        validityTimezone: 'UTC'
      });
    }
    const bucket = map.get(key);
    const classification = classifyLotValidity(lot);
    const status = classification.status || 'unknown';
    if (!Object.prototype.hasOwnProperty.call(bucket.statusCounts, status)) {
      bucket.statusCounts.unknown += 1;
    } else {
      bucket.statusCounts[status] += 1;
    }
    bucket.validityTimezone = classification.timezone || bucket.validityTimezone || 'UTC';

    if (status === 'active' && classification.endDate) {
      if (!bucket.nearestExpiryDate || classification.endDate < bucket.nearestExpiryDate) {
        bucket.nearestExpiryDate = classification.endDate;
      }
    }
    if (status === 'upcoming' && classification.startDate) {
      if (!bucket.nextActivationDate || classification.startDate < bucket.nextActivationDate) {
        bucket.nextActivationDate = classification.startDate;
      }
    }
  });

  return map;
}

function buildGlobalValiditySummary(lotRows = []) {
  const summary = {
    asOfDate: getDateKeyInTimeZone('', 'UTC'),
    asOfTimezone: 'UTC',
    activeLotCount: 0,
    upcomingLotCount: 0,
    expiredLotCount: 0,
    perpetualLotCount: 0,
    keyCount: 0,
    nearestExpiryDate: '',
    nextActivationDate: ''
  };
  const keySet = new Set();

  (Array.isArray(lotRows) ? lotRows : []).forEach((lot) => {
    if (!hasLotOriginalMetrics(lot)) return;
    const lotStatus = cleanString(lot?.status, { max: 20, allowEmpty: true }).toLowerCase();
    if (lotStatus === 'void') return;

    const sectionId = cleanString(lot?.section, { max: 120, allowEmpty: true }) || '';
    const operationId = cleanString(lot?.operation, { max: 120, allowEmpty: true }) || '';
    if (sectionId && operationId) keySet.add(buildKey(sectionId, operationId));

    const classification = classifyLotValidity(lot);
    const status = classification.status || 'unknown';
    if (status === 'active') summary.activeLotCount += 1;
    if (status === 'upcoming') summary.upcomingLotCount += 1;
    if (status === 'expired') summary.expiredLotCount += 1;
    if (status === 'perpetual') summary.perpetualLotCount += 1;

    if (status === 'active' && classification.endDate) {
      if (!summary.nearestExpiryDate || classification.endDate < summary.nearestExpiryDate) {
        summary.nearestExpiryDate = classification.endDate;
      }
    }
    if (status === 'upcoming' && classification.startDate) {
      if (!summary.nextActivationDate || classification.startDate < summary.nextActivationDate) {
        summary.nextActivationDate = classification.startDate;
      }
    }
  });

  summary.keyCount = keySet.size;
  return summary;
}

function buildValidityPresentation(row = {}) {
  const counts = (row?.statusCounts && typeof row.statusCounts === 'object')
    ? row.statusCounts
    : buildValidityBucket();
  const hasActive = Number(counts.active || 0) > 0;
  const hasPerpetual = Number(counts.perpetual || 0) > 0;
  const hasUpcoming = Number(counts.upcoming || 0) > 0;
  const hasExpired = Number(counts.expired || 0) > 0;

  let status = 'none';
  let statusLabel = 'Not Set';
  let badge = 'secondary';
  if (hasActive || hasPerpetual) {
    status = 'active';
    statusLabel = hasPerpetual ? 'Active (No Expiry)' : 'Active';
    badge = 'success';
  } else if (hasUpcoming) {
    status = 'upcoming';
    statusLabel = 'Upcoming';
    badge = 'warning';
  } else if (hasExpired) {
    status = 'expired';
    statusLabel = 'Expired';
    badge = 'danger';
  }

  const validUntil = hasPerpetual
    ? 'No Expiry'
    : (cleanDateOnly(row?.nearestExpiryDate, { allowEmpty: true }) || '');
  const nextValidFrom = cleanDateOnly(row?.nextActivationDate, { allowEmpty: true }) || '';
  const timezone = normalizeTimezoneToken(row?.validityTimezone, 'UTC');
  const parts = [];
  if (Number(counts.active || 0) > 0) parts.push(`Active lots: ${Number(counts.active || 0)}`);
  if (Number(counts.perpetual || 0) > 0) parts.push(`Perpetual: ${Number(counts.perpetual || 0)}`);
  if (Number(counts.upcoming || 0) > 0) parts.push(`Upcoming: ${Number(counts.upcoming || 0)}`);
  if (Number(counts.expired || 0) > 0) parts.push(`Expired: ${Number(counts.expired || 0)}`);

  return {
    status,
    statusLabel,
    badge,
    validUntil,
    nextValidFrom,
    timezone,
    detailText: parts.join(' | ')
  };
}

function applyRemainingValidity(remainingRows = [], lotRows = []) {
  const baseRows = Array.isArray(remainingRows) ? remainingRows : [];
  const validityMap = buildRemainingValidityMap(lotRows || []);
  const summary = buildGlobalValiditySummary(lotRows || []);
  const rows = baseRows.map((row) => {
    const key = buildKey(row?.sectionId, row?.operationId);
    const validityRow = validityMap.get(key) || {};
    const presentation = buildValidityPresentation(validityRow);
    return {
      ...row,
      validityStatus: presentation.status,
      validityStatusLabel: presentation.statusLabel,
      validityBadge: presentation.badge,
      validityUntil: presentation.validUntil || '',
      validityNextFrom: presentation.nextValidFrom || '',
      validityTimezone: presentation.timezone || 'UTC',
      validityDetailText: presentation.detailText || ''
    };
  });
  return {
    rows,
    summary
  };
}

function toHistoryRows(rows = [], labelMap = new Map()) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const sectionId = cleanString(row?.section, { max: 120, allowEmpty: true }) || '';
    const operationId = cleanString(row?.operation, { max: 120, allowEmpty: true }) || '';
    return {
      id: cleanString(row?.id, { max: 120, allowEmpty: true }) || '',
      dateTime: cleanString(row?.dateTime, { max: 80, allowEmpty: true }) || '',
      sectionId,
      operationId,
      label: resolveOperationLabel(sectionId, operationId, labelMap),
      call: Number(row?.call || 0),
      amount: Number(row?.amount || 0),
      token: Number(row?.token || 0),
      volume: Number(row?.volume || 0),
      source: {
        module: cleanString(row?.source?.module, { max: 80, allowEmpty: true }) || '',
        eventType: cleanString(row?.source?.eventType, { max: 80, allowEmpty: true }) || '',
        eventId: cleanString(row?.source?.eventId, { max: 180, allowEmpty: true }) || ''
      }
    };
  });
}

function sumRows(rows = []) {
  const metrics = buildMetricBucket();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    addMetrics(metrics, row || {});
  });
  return metrics;
}

async function listTargetUsersPicker(rawQuery = {}, requestingUser = {}, accessContext = {}, options = {}) {
  const visibility = await addCreditDataService.resolveReadVisibility(requestingUser, accessContext);
  if (!visibility || !canSwitchTargetUser(visibility)) {
    return {
      results: [],
      pagination: createPagination(0, 1, 20)
    };
  }
  const { page, limit, filtered } = normalizePickerQuery(rawQuery);
  const rows = await addCreditDataService.listPickerUsers(filtered, requestingUser, accessContext, options);
  const list = Array.isArray(rows) ? rows : [];
  const start = (page - 1) * limit;
  const sliced = list.slice(start, start + limit);
  return {
    results: sliced,
    pagination: createPagination(list.length, page, limit)
  };
}

const creditCheckDataService = {
  PICKER_USER_QUERY_OPTIONS,

  async getCreditCheck(rawQuery = {}, requestingUser = {}, accessContext = {}, options = {}) {
    const visibility = await addCreditDataService.resolveReadVisibility(requestingUser, accessContext);
    const filters = normalizeFilters(rawQuery);
    const resolved = await resolveTargetUserId(
      visibility,
      filters.userId,
      requestingUser,
      accessContext
    );

    const activeOrgId = toPublicId(visibility?.activeOrgId || '');
    if (!activeOrgId) {
      throw new Error('No active organization context found.');
    }

    const targetUserId = toPublicId(resolved.targetUserId || '');
    const labelMap = await buildLatestLabelMap(activeOrgId, options);

    const historyQuery = {
      orgId__eq: activeOrgId,
      userId__eq: targetUserId,
      entryType__eq: 'consumption',
      ...(filters.fromIso ? { dateTime__gte: filters.fromIso } : {}),
      ...(filters.toIso ? { dateTime__lte: filters.toIso } : {})
    };

    const [targetUser, snapshotRows, lotRows, historyTotalItems, historyRows, allHistoryRows] = await Promise.all([
      resolveTargetUserDisplay(targetUserId, options),
      quotaBalanceSnapshotRepository.list({
        query: {
          orgId__eq: activeOrgId,
          userId__eq: targetUserId,
          limit: 5000
        },
        scope: { canViewAll: true },
        sort: { section: 1, operation: 1 },
        backendMode: options?.backendMode
      }),
      quotaCreditLotRepository.list({
        query: {
          orgId__eq: activeOrgId,
          userId__eq: targetUserId,
          limit: 50000
        },
        scope: { canViewAll: true },
        sort: { dateTime: -1, id: -1 },
        backendMode: options?.backendMode
      }),
      activityQuotaLedgerRepository.count({
        query: historyQuery,
        scope: { canViewAll: true },
        backendMode: options?.backendMode
      }),
      activityQuotaLedgerRepository.list({
        query: {
          ...historyQuery,
          page: filters.page,
          limit: filters.limit
        },
        scope: { canViewAll: true },
        sort: { dateTime: -1, id: -1 },
        backendMode: options?.backendMode
      }),
      activityQuotaLedgerRepository.list({
        query: {
          ...historyQuery,
          page: 1,
          limit: CREDIT_CHECK_LEDGER_SCAN_LIMIT
        },
        scope: { canViewAll: true },
        sort: { dateTime: 1, id: 1 },
        backendMode: options?.backendMode
      })
    ]);

    const remainingRowsRaw = attachCurrentLotTotalsToRemainingRows(
      toRemainingRows(snapshotRows || [], labelMap),
      lotRows || [],
      labelMap
    );
    const validityEnriched = applyRemainingValidity(remainingRowsRaw, lotRows || []);
    const remainingRows = validityEnriched.rows;
    const history = toHistoryRows(historyRows || [], labelMap);
    const consumptionRows = toHistoryRows(allHistoryRows || [], labelMap);
    const historyTotals = sumRows(allHistoryRows || []);
    const remainingTotals = sumRows(remainingRows || []);

    return {
      visibility: {
        mode: visibility.mode,
        scopeName: visibility.scopeName || '',
        activeOrgId,
        canSwitchUser: canSwitchTargetUser(visibility)
      },
      targetUser,
      filters: {
        userId: targetUser.id,
        fromDate: filters.fromDate,
        toDate: filters.toDate,
        page: filters.page,
        limit: filters.limit
      },
      stats: {
        remainingRowCount: remainingRows.length,
        historyRowCount: history.length,
        historyTotalItems: Number(historyTotalItems || 0),
        consumptionTotalScanCount: consumptionRows.length,
        consumptionTotalLimited: Number(historyTotalItems || 0) > CREDIT_CHECK_LEDGER_SCAN_LIMIT
      },
      totals: {
        remaining: remainingTotals,
        consumption: historyTotals
      },
      validity: validityEnriched.summary,
      remainingRows,
      historyRows: history,
      consumptionRows,
      pagination: createPagination(historyTotalItems, filters.page, filters.limit)
    };
  },

  async listTargetUsersPicker(rawQuery = {}, requestingUser = {}, accessContext = {}, options = {}) {
    return listTargetUsersPicker(rawQuery, requestingUser, accessContext, options);
  },

  __testables: {
    buildLatestLabelMapFromPackages,
    toRemainingRows,
    classifyLotValidity,
    applyRemainingValidity,
    resolveOperationLabel,
    resolveRequestedUserIdForMode,
    resolveTargetUserId
  }
};

module.exports = creditCheckDataService;
