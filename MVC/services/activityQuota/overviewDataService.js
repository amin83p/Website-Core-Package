const activityQuotaLedgerRepository = require('../../repositories/activityQuotaLedgerRepository');
const addCreditDataService = require('./addCreditDataService');
const dataService = require('../dataService');
const { normalizeQueryOptions } = require('../../utils/queryOptionsAdapter');
const { toPublicId } = require('../../utils/idAdapter');
const { SYSTEM_CONTEXT } = require('../../../config/constants');

const ENTRY_TYPES = new Set(['credit', 'consumption', 'adjustment']);
const METRIC_FIELDS = Object.freeze(['call', 'amount', 'token', 'volume']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 180, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function normalizePositiveInteger(value, { fallback = 5000, min = 100, max = 50000 } = {}) {
  const numeric = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function parseDateToken(value, { boundary = 'start' } = {}) {
  const token = cleanString(value, { max: 20, allowEmpty: true });
  if (!token) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    throw new Error('Date filters must use YYYY-MM-DD format.');
  }
  const isoBoundary = boundary === 'end'
    ? `${token}T23:59:59.999Z`
    : `${token}T00:00:00.000Z`;
  const parsed = new Date(isoBoundary);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid date filter value.');
  }
  return parsed.toISOString();
}

function humanizeToken(value) {
  const token = cleanString(value, { max: 200, allowEmpty: true });
  if (!token) return '-';
  if (/^\d+$/.test(token)) return token;
  const parts = token.replace(/[-_]+/g, ' ').split(/\s+/).filter(Boolean);
  if (!parts.length) return token;
  return parts.map((part) => {
    if (/^[A-Z0-9]{2,6}$/.test(part)) return part;
    const lower = part.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');
}

function createMetricBucket() {
  return METRIC_FIELDS.reduce((acc, field) => {
    acc[field] = 0;
    return acc;
  }, {});
}

function addMetricValues(target, source, multiplier = 1) {
  METRIC_FIELDS.forEach((field) => {
    const value = Number(source?.[field] || 0);
    if (!Number.isFinite(value)) return;
    target[field] = Number((Number(target[field] || 0) + (value * multiplier)).toFixed(6));
  });
}

function resolveEntryType(value, fallback = 'consumption') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  return ENTRY_TYPES.has(token) ? token : fallback;
}

function normalizeFilters(raw = {}) {
  const source = isPlainObject(raw) ? raw : {};
  const entryTypeToken = cleanString(source.entryType, { max: 40, allowEmpty: true }).toLowerCase();

  const fromDate = cleanString(source.fromDate, { max: 20, allowEmpty: true });
  const toDate = cleanString(source.toDate, { max: 20, allowEmpty: true });

  const filters = {
    fromDate,
    toDate,
    fromIso: parseDateToken(fromDate, { boundary: 'start' }),
    toIso: parseDateToken(toDate, { boundary: 'end' }),
    userId: toPublicId(source.userId || ''),
    section: cleanString(source.section, { max: 120, allowEmpty: true }) || '',
    operation: cleanString(source.operation, { max: 120, allowEmpty: true }) || '',
    entryType: ENTRY_TYPES.has(entryTypeToken) ? entryTypeToken : '',
    maxRows: normalizePositiveInteger(source.maxRows, { fallback: 5000, min: 100, max: 50000 })
  };

  if (filters.fromIso && filters.toIso && filters.toIso < filters.fromIso) {
    throw new Error('To Date must be on or after From Date.');
  }

  return filters;
}

function buildLedgerQuery(filters, visibility) {
  const query = {};

  if (visibility.mode === 'org' || visibility.mode === 'creator') {
    query.orgId__eq = visibility.activeOrgId;
  }
  if (visibility.mode === 'creator') {
    query['creator.userId__eq'] = visibility.requesterUserId;
  }

  if (filters.userId) query.userId__eq = filters.userId;
  if (filters.section) query.section__eq = filters.section;
  if (filters.operation) query.operation__eq = filters.operation;
  if (filters.entryType) query.entryType__eq = filters.entryType;
  if (filters.fromIso) query.dateTime__gte = filters.fromIso;
  if (filters.toIso) query.dateTime__lte = filters.toIso;
  query.limit = filters.maxRows;

  return normalizeQueryOptions(query);
}

async function fetchEntityMap(entityName, ids, requestingUser, options = {}) {
  const uniqueIds = Array.from(new Set((Array.isArray(ids) ? ids : [])
    .map((value) => toPublicId(value))
    .filter(Boolean)));
  const out = new Map();
  if (!uniqueIds.length) return out;

  const repositoryOptions = options?.backendMode ? { backendMode: options.backendMode } : {};
  let rows = [];
  try {
    rows = await dataService.fetchData(entityName, {
      id__in: uniqueIds.join(','),
      limit: Math.max(uniqueIds.length * 2, 500)
    }, requestingUser, repositoryOptions);
  } catch (_) {
    rows = [];
  }

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = toPublicId(row?.id || '');
    if (!id) return;
    out.set(id, row);
  });
  return out;
}

function toUserDisplay(row, userMap) {
  const userId = toPublicId(row?.userId || '');
  const user = userMap.get(userId) || {};
  const preferredName = cleanString(user?.name, { max: 200, allowEmpty: true })
    || cleanString(user?.username, { max: 120, allowEmpty: true })
    || cleanString(user?.email, { max: 200, allowEmpty: true })
    || userId;
  return {
    id: userId,
    name: preferredName
  };
}

function toSectionDisplay(row, sectionMap) {
  const sectionId = cleanString(row?.section, { max: 120, allowEmpty: true }) || '-';
  const section = sectionMap.get(toPublicId(sectionId)) || {};
  const rawName = cleanString(section?.name, { max: 200, allowEmpty: true });
  const name = rawName || humanizeToken(sectionId);
  return {
    id: sectionId,
    name
  };
}

function toOperationDisplay(row, operationMap) {
  const operationId = cleanString(row?.operation, { max: 120, allowEmpty: true }) || '-';
  const operation = operationMap.get(toPublicId(operationId)) || {};
  const rawName = cleanString(operation?.name, { max: 200, allowEmpty: true });
  const name = rawName || humanizeToken(operationId);
  return {
    id: operationId,
    name
  };
}

function summarizeBySection(rows = [], sectionMap = new Map()) {
  const bucketMap = new Map();

  rows.forEach((row) => {
    const sectionId = cleanString(row?.section, { max: 120, allowEmpty: true }) || '-';
    const key = toPublicId(sectionId) || sectionId;
    if (!bucketMap.has(key)) {
      const section = sectionMap.get(toPublicId(sectionId)) || {};
      const sectionName = cleanString(section?.name, { max: 200, allowEmpty: true }) || humanizeToken(sectionId);
      bucketMap.set(key, {
        sectionId,
        sectionName,
        entryCount: 0,
        totals: {
          credit: createMetricBucket(),
          consumption: createMetricBucket(),
          adjustment: createMetricBucket(),
          available: createMetricBucket()
        },
        latestDateTime: ''
      });
    }

    const bucket = bucketMap.get(key);
    bucket.entryCount += 1;
    const entryType = resolveEntryType(row?.entryType, 'consumption');
    if (entryType === 'credit') {
      addMetricValues(bucket.totals.credit, row, 1);
      addMetricValues(bucket.totals.available, row, 1);
    } else if (entryType === 'consumption') {
      addMetricValues(bucket.totals.consumption, row, 1);
      addMetricValues(bucket.totals.available, row, -1);
    } else {
      addMetricValues(bucket.totals.adjustment, row, 1);
      addMetricValues(bucket.totals.available, row, 1);
    }

    const dateTime = cleanString(row?.dateTime, { max: 80, allowEmpty: true }) || '';
    if (!bucket.latestDateTime || dateTime > bucket.latestDateTime) {
      bucket.latestDateTime = dateTime;
    }
  });

  return Array.from(bucketMap.values())
    .sort((a, b) => {
      const countDelta = Number(b.entryCount || 0) - Number(a.entryCount || 0);
      if (countDelta !== 0) return countDelta;
      return String(a.sectionName || '').localeCompare(String(b.sectionName || ''));
    });
}

function buildRecentRows(rows = [], userMap = new Map(), sectionMap = new Map(), operationMap = new Map(), limit = 30) {
  const slice = Array.isArray(rows) ? rows.slice(0, Math.max(1, limit)) : [];
  return slice.map((row) => {
    const user = toUserDisplay(row, userMap);
    const section = toSectionDisplay(row, sectionMap);
    const operation = toOperationDisplay(row, operationMap);
    const creatorDisplay = cleanString(row?.creator?.displayName, { max: 180, allowEmpty: true })
      || (String(row?.creator?.type || '').toLowerCase() === 'system' ? 'System' : '-');
    return {
      id: cleanString(row?.id, { max: 120, allowEmpty: true }) || '',
      dateTime: cleanString(row?.dateTime, { max: 80, allowEmpty: true }) || '',
      user,
      section,
      operation,
      entryType: resolveEntryType(row?.entryType, 'consumption'),
      call: Number(row?.call || 0),
      amount: Number(row?.amount || 0),
      token: Number(row?.token || 0),
      volume: Number(row?.volume || 0),
      creatorDisplay
    };
  });
}

const overviewDataService = {
  async getOverview(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await addCreditDataService.resolveReadVisibility(requestingUser, accessContext);
    const filters = normalizeFilters(query);
    const scopedQuery = buildLedgerQuery(filters, visibility);

    const rows = await activityQuotaLedgerRepository.list({
      query: scopedQuery,
      scope: { canViewAll: true },
      sort: { dateTime: -1, id: -1 },
      backendMode: options?.backendMode
    });

    const ledgerRows = Array.isArray(rows) ? rows : [];

    const userIds = ledgerRows.map((row) => toPublicId(row?.userId || ''));
    const sectionIds = ledgerRows.map((row) => toPublicId(row?.section || ''));
    const operationIds = ledgerRows.map((row) => toPublicId(row?.operation || ''));

    const [userMap, sectionMap, operationMap] = await Promise.all([
      fetchEntityMap('users', userIds, SYSTEM_CONTEXT, options),
      fetchEntityMap('sections', sectionIds, SYSTEM_CONTEXT, options),
      fetchEntityMap('operations', operationIds, SYSTEM_CONTEXT, options)
    ]);

    const totals = {
      credit: createMetricBucket(),
      consumption: createMetricBucket(),
      adjustment: createMetricBucket(),
      available: createMetricBucket()
    };
    const entryCounts = {
      credit: 0,
      consumption: 0,
      adjustment: 0
    };

    let latestDateTime = '';
    let oldestDateTime = '';
    const uniqueUsers = new Set();
    const uniqueSections = new Set();

    ledgerRows.forEach((row) => {
      const entryType = resolveEntryType(row?.entryType, 'consumption');
      entryCounts[entryType] = Number(entryCounts[entryType] || 0) + 1;

      if (entryType === 'credit') {
        addMetricValues(totals.credit, row, 1);
        addMetricValues(totals.available, row, 1);
      } else if (entryType === 'consumption') {
        addMetricValues(totals.consumption, row, 1);
        addMetricValues(totals.available, row, -1);
      } else {
        addMetricValues(totals.adjustment, row, 1);
        addMetricValues(totals.available, row, 1);
      }

      const userId = toPublicId(row?.userId || '');
      const sectionId = toPublicId(row?.section || '');
      if (userId) uniqueUsers.add(userId);
      if (sectionId) uniqueSections.add(sectionId);

      const dateTime = cleanString(row?.dateTime, { max: 80, allowEmpty: true }) || '';
      if (!latestDateTime || dateTime > latestDateTime) latestDateTime = dateTime;
      if (!oldestDateTime || dateTime < oldestDateTime) oldestDateTime = dateTime;
    });

    const sectionRows = summarizeBySection(ledgerRows, sectionMap).slice(0, 10);
    const recentRows = buildRecentRows(ledgerRows, userMap, sectionMap, operationMap, 10);

    return {
      filters: {
        ...filters,
        scopeMode: visibility.mode,
        activeOrgId: visibility.activeOrgId || ''
      },
      stats: {
        totalEntries: ledgerRows.length,
        entryCounts,
        uniqueUserCount: uniqueUsers.size,
        uniqueSectionCount: uniqueSections.size,
        latestDateTime,
        oldestDateTime,
        maxRows: filters.maxRows,
        truncated: ledgerRows.length >= filters.maxRows
      },
      totals,
      sectionRows,
      recentRows
    };
  }
};

module.exports = overviewDataService;
