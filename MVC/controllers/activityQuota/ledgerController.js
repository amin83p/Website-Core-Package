const paginate = require('../../utils/paginationHelper');
const activityQuotaLedgerRepository = require('../../repositories/activityQuotaLedgerRepository');
const activityQuotaLedgerService = require('../../services/activityQuotaLedgerService');
const addCreditDataService = require('../../services/activityQuota/addCreditDataService');
const activityQuotaUiService = require('../../services/activityQuota/activityQuotaUiService');
const dataService = require('../../services/dataService');
const { toPublicId, idsEqual } = require('../../utils/idAdapter');
const { SYSTEM_CONTEXT } = require('../../../config/constants');
const { SECTIONS } = require('../../../config/accessConstants');
const {
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields
} = require('../../utils/generalTools');

const LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: [
    'id',
    'orgId',
    'userId',
    'section',
    'operation',
    'entryType',
    'creator.userId',
    'source.eventType',
    'source.eventId',
    'dateTime__gte',
    'dateTime__lte',
    'orgId__eq',
    'userId__eq',
    'section__eq',
    'operation__eq',
    'entryType__eq',
    'creator.userId__eq',
    'source.eventType__eq',
    'source.eventId__eq',
    'orgId__in',
    'userId__in',
    'section__in',
    'operation__in',
    'creator.userId__in',
    'source.eventType__in',
    'source.eventId__in'
  ],
  defaultSearchFields: [
    'id',
    'orgId',
    'userId',
    'section',
    'operation',
    'entryType',
    'creator.displayName',
    'creator.userId',
    'source.eventType',
    'source.eventId'
  ],
  allowMetaKeys: true
});

const ENTRY_TYPES = new Set(['credit', 'consumption', 'adjustment']);

const PICKER_USER_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'username', 'email', 'status'],
  defaultSearchFields: ['id', 'username', 'email', 'name'],
  allowMetaKeys: true
});

const PICKER_SECTION_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'name', 'category', 'active'],
  defaultSearchFields: ['id', 'name', 'description', 'category'],
  allowMetaKeys: true
});

const PICKER_ORGANIZATION_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: [
    'id',
    'orgId',
    'organizationId',
    'name',
    'orgName',
    'organizationName',
    'identity.displayName',
    'active',
    'code'
  ],
  defaultSearchFields: [
    'id',
    'orgId',
    'organizationId',
    'name',
    'orgName',
    'organizationName',
    'identity.displayName',
    'identity.legalName',
    'code',
    'description'
  ],
  allowMetaKeys: true
});

const PICKER_OPERATION_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'name', 'active', 'system'],
  defaultSearchFields: ['id', 'name', 'description'],
  allowMetaKeys: true
});

function cleanString(value, { max = 180, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const token = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !token) return null;
  return token.length > max ? token.slice(0, max) : token;
}

function normalizePositiveInteger(value, { fallback = 5000, min = 100, max = 50000 } = {}) {
  const numeric = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function parseStringList(input, { maxItems = 200 } = {}) {
  const rawItems = Array.isArray(input) ? input : [input];
  const tokens = [];
  rawItems.forEach((value) => {
    const token = String(value == null ? '' : value).trim();
    if (!token) return;
    token.split(',').forEach((part) => {
      const next = cleanString(part, { max: 240, allowEmpty: true });
      if (!next) return;
      tokens.push(next);
    });
  });
  return Array.from(new Set(tokens)).slice(0, maxItems);
}

function parsePublicIdList(input, { maxItems = 200 } = {}) {
  return parseStringList(input, { maxItems })
    .map((value) => toPublicId(value))
    .filter(Boolean);
}

function parseListFromKeys(source = {}, keys = [], parser = parseStringList) {
  const values = [];
  (Array.isArray(keys) ? keys : []).forEach((key) => {
    if (!key) return;
    const raw = source[key];
    if (raw === undefined || raw === null || raw === '') return;
    values.push(raw);
  });
  return parser(values);
}

function splitPagination(query = {}, { defaultLimit = 20, maxLimit = 200 } = {}) {
  const source = query && typeof query === 'object' ? query : {};
  const pageRaw = Number.parseInt(String(source.page || ''), 10);
  const limitRaw = Number.parseInt(String(source.limit || ''), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(maxLimit, limitRaw)
    : defaultLimit;
  return { page, limit };
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
    limit: safeLimit,
    totalItems: safeTotal,
    totalPages,
    startItem,
    endItem
  };
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

function normalizeEntryType(value) {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  return ENTRY_TYPES.has(token) ? token : '';
}

function isSystemOrganizationId(value) {
  const token = String(value == null ? '' : value).trim().toUpperCase();
  return token === 'SYSTEM' || token === 'GLOBAL';
}

function resolveActiveOrganizationFilter(requestingUser = {}) {
  const activeOrgId = toPublicId(
    requestingUser?.activeOrgId
    || requestingUser?.primaryOrgId
    || requestingUser?.orgId
    || ''
  );
  const allowedOrgs = Array.isArray(requestingUser?.allowedOrgs)
    ? requestingUser.allowedOrgs
    : [];
  const activeOrgMeta = allowedOrgs.find((org) => idsEqual(org?.orgId || org?.id, activeOrgId)) || null;
  const activeOrgName = cleanString(
    activeOrgMeta?.name
    || activeOrgMeta?.orgName
    || activeOrgMeta?.organizationName
    || activeOrgMeta?.identity?.displayName
    || requestingUser?.activeOrgName
    || '',
    { max: 220, allowEmpty: true }
  ) || activeOrgId || '';
  return {
    id: activeOrgId,
    name: activeOrgName
  };
}

function normalizeFilters(raw = {}, options = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const forcedOrgId = toPublicId(options?.forcedOrgId || '');
  const lockOrgFilter = options?.lockOrgFilter !== false;
  const fromDate = cleanString(source.fromDate, { max: 20, allowEmpty: true });
  const toDate = cleanString(source.toDate, { max: 20, allowEmpty: true });
  const userIds = parseListFromKeys(source, ['userIds', 'userId'], parsePublicIdList);
  const requestedOrgIds = lockOrgFilter ? [] : parseListFromKeys(source, ['orgIds', 'orgId'], parsePublicIdList);
  const orgIds = forcedOrgId ? [forcedOrgId] : requestedOrgIds;
  const sectionIds = parseListFromKeys(source, ['sections', 'section']);
  const operationIds = parseListFromKeys(source, ['operations', 'operation']);
  const creatorUserIds = parseListFromKeys(source, ['creatorUserIds', 'creatorUserId'], parsePublicIdList);
  const sourceEventTypes = parseListFromKeys(source, ['sourceEventTypes', 'sourceEventType']);
  const sourceEventIds = parseListFromKeys(source, ['sourceEventIds', 'sourceEventId']);
  const filters = {
    fromDate,
    toDate,
    fromIso: parseDateToken(fromDate, { boundary: 'start' }),
    toIso: parseDateToken(toDate, { boundary: 'end' }),
    entryType: normalizeEntryType(source.entryType),
    userIds,
    orgIds,
    sectionIds,
    operationIds,
    creatorUserIds,
    sourceEventTypes,
    sourceEventIds,
    userId: userIds[0] || '',
    orgId: forcedOrgId || orgIds[0] || '',
    section: sectionIds[0] || '',
    operation: operationIds[0] || '',
    creatorUserId: creatorUserIds[0] || '',
    sourceEventType: sourceEventTypes[0] || '',
    sourceEventId: sourceEventIds[0] || '',
    maxRows: normalizePositiveInteger(source.maxRows, { fallback: 5000, min: 100, max: 50000 })
  };

  if (filters.fromIso && filters.toIso && filters.toIso < filters.fromIso) {
    throw new Error('To Date must be on or after From Date.');
  }

  return filters;
}

function buildQueryInput(rawQuery = {}, filters = {}) {
  const queryInput = {
    ...(rawQuery && typeof rawQuery === 'object' ? rawQuery : {})
  };

  delete queryInput.fromDate;
  delete queryInput.toDate;
  delete queryInput.maxRows;
  delete queryInput.userId;
  delete queryInput.orgId;
  delete queryInput.section;
  delete queryInput.operation;
  delete queryInput.entryType;
  delete queryInput.userIds;
  delete queryInput.orgIds;
  delete queryInput.sections;
  delete queryInput.operations;
  delete queryInput.creatorUserIds;
  delete queryInput.sourceEventTypes;
  delete queryInput.sourceEventIds;
  delete queryInput.creatorUserId;
  delete queryInput.sourceEventType;
  delete queryInput.sourceEventId;

  if (filters.fromIso) queryInput.dateTime__gte = filters.fromIso;
  if (filters.toIso) queryInput.dateTime__lte = filters.toIso;
  if (filters.entryType) queryInput.entryType__eq = filters.entryType;
  if (Array.isArray(filters.userIds) && filters.userIds.length > 0) queryInput.userId__in = filters.userIds.join(',');
  if (Array.isArray(filters.orgIds) && filters.orgIds.length > 0) queryInput.orgId__in = filters.orgIds.join(',');
  if (Array.isArray(filters.sectionIds) && filters.sectionIds.length > 0) queryInput.section__in = filters.sectionIds.join(',');
  if (Array.isArray(filters.operationIds) && filters.operationIds.length > 0) queryInput.operation__in = filters.operationIds.join(',');
  if (Array.isArray(filters.creatorUserIds) && filters.creatorUserIds.length > 0) queryInput['creator.userId__in'] = filters.creatorUserIds.join(',');
  if (Array.isArray(filters.sourceEventTypes) && filters.sourceEventTypes.length > 0) queryInput['source.eventType__in'] = filters.sourceEventTypes.join(',');
  if (Array.isArray(filters.sourceEventIds) && filters.sourceEventIds.length > 0) queryInput['source.eventId__in'] = filters.sourceEventIds.join(',');

  return queryInput;
}

function applyVisibilityScope(query = {}, visibility = {}) {
  const scoped = { ...(query || {}) };
  if ((visibility.mode === 'org' || visibility.mode === 'creator') && !isSystemOrganizationId(visibility.activeOrgId)) {
    scoped.orgId__eq = visibility.activeOrgId;
  }
  if (visibility.mode === 'creator') {
    scoped['creator.userId__eq'] = visibility.requesterUserId;
  }
  return scoped;
}

async function fetchEntityMap(entityName, ids, backendMode) {
  const uniqueIds = Array.from(new Set((Array.isArray(ids) ? ids : [])
    .map((value) => toPublicId(value))
    .filter(Boolean)));
  const out = new Map();
  if (!uniqueIds.length) return out;

  const repositoryOptions = backendMode ? { backendMode } : {};
  let rows = [];
  try {
    rows = await dataService.fetchData(entityName, {
      id__in: uniqueIds.join(','),
      limit: Math.max(uniqueIds.length * 3, 300)
    }, SYSTEM_CONTEXT, repositoryOptions);
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

function composeUserDisplay(row = {}, userMap = new Map(), fallbackId = '') {
  const id = toPublicId(row?.id || fallbackId || '');
  const user = userMap.get(id) || {};
  const name = cleanString(user?.name, { max: 200, allowEmpty: true })
    || cleanString(user?.username, { max: 120, allowEmpty: true })
    || cleanString(user?.email, { max: 200, allowEmpty: true })
    || id
    || '-';
  return { id: id || '-', name };
}

function composeSectionDisplay(sectionId, sectionMap = new Map()) {
  const id = cleanString(sectionId, { max: 120, allowEmpty: true }) || '';
  const mapped = sectionMap.get(toPublicId(id)) || {};
  const name = cleanString(mapped?.name, { max: 200, allowEmpty: true }) || id || '-';
  return { id: id || '-', name };
}

function composeOperationDisplay(operationId, operationMap = new Map()) {
  const id = cleanString(operationId, { max: 120, allowEmpty: true }) || '';
  const mapped = operationMap.get(toPublicId(id)) || {};
  const name = cleanString(mapped?.name, { max: 200, allowEmpty: true }) || id || '-';
  return { id: id || '-', name };
}

function composeCreatorDisplay(row = {}, userMap = new Map()) {
  const creator = row?.creator || {};
  const creatorType = String(creator.type || '').trim().toLowerCase();
  if (creatorType === 'system') {
    return { id: 'System', name: 'System' };
  }

  const creatorId = toPublicId(creator.userId || '');
  const mapped = creatorId ? composeUserDisplay({ id: creatorId }, userMap, creatorId) : null;
  const fallbackName = cleanString(creator.displayName, { max: 200, allowEmpty: true })
    || cleanString(creator.username, { max: 120, allowEmpty: true })
    || cleanString(creator.email, { max: 200, allowEmpty: true })
    || (creatorId || '-');

  return {
    id: creatorId || '-',
    name: mapped?.name || fallbackName
  };
}

function resolveRowEntryType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ENTRY_TYPES.has(normalized) ? normalized : 'consumption';
}

function rowVisibleForVisibility(row = {}, visibility = {}) {
  if (visibility.mode === 'all') return true;
  if (!isSystemOrganizationId(visibility.activeOrgId) && !idsEqual(row?.orgId, visibility.activeOrgId)) return false;
  if (visibility.mode === 'org') return true;
  if (visibility.mode !== 'creator') return false;
  const creatorUserId = toPublicId(row?.creator?.userId || '');
  return creatorUserId ? idsEqual(creatorUserId, visibility.requesterUserId) : false;
}

async function enrichRows(rows = [], options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const userIds = [];
  const sectionIds = [];
  const operationIds = [];

  list.forEach((row) => {
    userIds.push(toPublicId(row?.userId || ''));
    sectionIds.push(toPublicId(row?.section || ''));
    operationIds.push(toPublicId(row?.operation || ''));
    userIds.push(toPublicId(row?.creator?.userId || ''));
  });

  const [userMap, sectionMap, operationMap] = await Promise.all([
    fetchEntityMap('users', userIds, options.backendMode),
    fetchEntityMap('sections', sectionIds, options.backendMode),
    fetchEntityMap('operations', operationIds, options.backendMode)
  ]);

  return list.map((row) => {
    const source = row?.source || {};
    const user = composeUserDisplay({ id: row?.userId }, userMap, row?.userId);
    const section = composeSectionDisplay(row?.section, sectionMap);
    const operation = composeOperationDisplay(row?.operation, operationMap);
    const creator = composeCreatorDisplay(row, userMap);
    return {
      ...row,
      entryType: resolveRowEntryType(row?.entryType),
      display: {
        userName: user.name,
        sectionName: section.name,
        operationName: operation.name,
        creatorName: creator.name
      },
      source: {
        module: cleanString(source.module, { max: 80, allowEmpty: true }) || '',
        eventType: cleanString(source.eventType, { max: 80, allowEmpty: true }) || '',
        eventId: cleanString(source.eventId, { max: 180, allowEmpty: true }) || '',
        idempotencyKey: cleanString(source.idempotencyKey, { max: 220, allowEmpty: true }) || ''
      }
    };
  });
}

async function listLedger(req, res) {
  try {
    const activeOrgFilter = resolveActiveOrganizationFilter(req.user || {});
    const restrictToActiveOrg = !isSystemOrganizationId(activeOrgFilter.id);
    const filters = normalizeFilters(req.query || {}, {
      forcedOrgId: restrictToActiveOrg ? activeOrgFilter.id : '',
      lockOrgFilter: true
    });
    const queryInput = buildQueryInput(req.query || {}, filters);
    const query = await buildDataServiceQuery(queryInput, LIST_QUERY_OPTIONS);
    const visibility = await addCreditDataService.resolveReadVisibility(req.user, {
      scopeId: req.accessScope
    });
    const scopedQuery = applyVisibilityScope(query, visibility);
    scopedQuery.limit = filters.maxRows;

    const rows = await activityQuotaLedgerRepository.list({
      query: scopedQuery,
      scope: { canViewAll: true },
      sort: { dateTime: -1, id: -1 }
    });

    const visibleRows = (Array.isArray(rows) ? rows : []).filter((row) => rowVisibleForVisibility(row, visibility));
    const enrichedRows = await enrichRows(visibleRows, {});
    const searchableFields = await inferSearchableFields(enrichedRows, { exclude: ['audit'] });
    const { data, pagination } = paginate(enrichedRows, req.query.page, req.query.limit);
    const stats = {
      totalRows: enrichedRows.length,
      maxRows: filters.maxRows,
      truncated: enrichedRows.length >= filters.maxRows
    };
    const accessUi = await activityQuotaUiService.buildCrudFlags(req, SECTIONS.ACTIVITY_QUOTA_LEDGER);
    const manageBtns = await activityQuotaUiService.buildManageButtons(req, {
      exclude: ['ledger'],
      dashboardHref: res.locals.activityQuotaSectionDashboardHref
    });

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        results: data,
        pagination,
        filters,
        stats,
        activeOrgFilter
      });
    }

    return res.render('activityQuota/ledger/ledgerList', {
      title: 'Activity Quota Ledger',
      tableName: 'Activity_Quota_Ledger',
      data,
      searchableFields,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      btn_export: true,
      pagination,
      filters: req.query || {},
      filterState: filters,
      stats,
      activeOrgFilter,
      newUrl: 'activity-quota/ledger',
      newLabel: null,
      manageBtns,
      accessUi,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message || 'Failed to load activity quota ledger.',
      user: req.user || null
    });
  }
}

async function listUsersPicker(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, PICKER_USER_QUERY_OPTIONS);
    const rows = await addCreditDataService.listPickerUsers(query, req.user, {
      scopeId: req.accessScope
    });
    const { page, limit } = splitPagination(req.query, { defaultLimit: 20, maxLimit: 200 });
    const start = (page - 1) * limit;
    const end = start + limit;
    const list = Array.isArray(rows) ? rows : [];
    return res.json({
      status: 'success',
      results: list.slice(start, end),
      pagination: createPagination(list.length, page, limit)
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function listSectionsPicker(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, PICKER_SECTION_QUERY_OPTIONS);
    const rows = await addCreditDataService.listPickerSections(query, req.user, {
      scopeId: req.accessScope
    });
    const { page, limit } = splitPagination(req.query, { defaultLimit: 20, maxLimit: 200 });
    const start = (page - 1) * limit;
    const end = start + limit;
    const list = Array.isArray(rows) ? rows : [];
    return res.json({
      status: 'success',
      results: list.slice(start, end),
      pagination: createPagination(list.length, page, limit)
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function listOrganizationsPicker(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, PICKER_ORGANIZATION_QUERY_OPTIONS);
    const rows = await dataService.fetchData('organizations', {
      ...query,
      limit: Math.max(Number(query.limit || 0) || 0, 500)
    }, req.user);
    const list = Array.isArray(rows) ? rows : [];
    const normalized = list.map((row) => {
      const id = toPublicId(
        row?.id
        || row?.orgId
        || row?.organizationId
        || row?._id
        || ''
      );
      const name = cleanString(
        row?.identity?.displayName
        || row?.name
        || row?.orgName
        || row?.organizationName
        || row?.identity?.legalName
        || '',
        { max: 200, allowEmpty: true }
      ) || id;
      return {
        id,
        name,
        code: cleanString(row?.code, { max: 120, allowEmpty: true }) || '',
        active: row?.active !== false,
        identity: {
          displayName: name
        }
      };
    }).filter((row) => row.id);
    const { page, limit } = splitPagination(req.query, { defaultLimit: 20, maxLimit: 200 });
    const start = (page - 1) * limit;
    const end = start + limit;
    return res.json({
      status: 'success',
      results: normalized.slice(start, end),
      pagination: createPagination(normalized.length, page, limit)
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function listOperationsPicker(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, PICKER_OPERATION_QUERY_OPTIONS);
    const rows = await dataService.fetchData('operations', {
      ...query,
      limit: Math.max(Number(query.limit || 0) || 0, 1000)
    }, req.user);
    const list = Array.isArray(rows) ? rows : [];
    const normalized = list.map((row) => ({
      id: toPublicId(row?.id || ''),
      name: cleanString(row?.name || '', { max: 200, allowEmpty: true }) || toPublicId(row?.id || ''),
      description: cleanString(row?.description || '', { max: 300, allowEmpty: true }) || '',
      active: row?.active !== false,
      system: row?.system === true
    })).filter((row) => row.id);
    const { page, limit } = splitPagination(req.query, { defaultLimit: 20, maxLimit: 200 });
    const start = (page - 1) * limit;
    const end = start + limit;
    return res.json({
      status: 'success',
      results: normalized.slice(start, end),
      pagination: createPagination(normalized.length, page, limit)
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function listDistinctSourceValues(req, res, fieldKey) {
  try {
    const visibility = await addCreditDataService.resolveReadVisibility(req.user, {
      scopeId: req.accessScope
    });
    const scopedQuery = applyVisibilityScope({}, visibility);
    scopedQuery.limit = normalizePositiveInteger(req.query.maxRows, { fallback: 10000, min: 100, max: 30000 });

    const rows = await activityQuotaLedgerRepository.list({
      query: scopedQuery,
      scope: { canViewAll: true },
      sort: { dateTime: -1, id: -1 }
    });
    const visibleRows = (Array.isArray(rows) ? rows : []).filter((row) => rowVisibleForVisibility(row, visibility));
    const q = cleanString(req.query.q, { max: 120, allowEmpty: true }).toLowerCase();

    const unique = new Map();
    visibleRows.forEach((row) => {
      const source = row?.source || {};
      const raw = fieldKey === 'eventId' ? source.eventId : source.eventType;
      const token = cleanString(raw, { max: 240, allowEmpty: true });
      if (!token) return;
      const key = token.toLowerCase();
      if (q && !key.includes(q)) return;
      if (!unique.has(key)) {
        unique.set(key, {
          id: token,
          name: token
        });
      }
    });

    const list = Array.from(unique.values()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const { page, limit } = splitPagination(req.query, { defaultLimit: 20, maxLimit: 200 });
    const start = (page - 1) * limit;
    const end = start + limit;
    return res.json({
      status: 'success',
      results: list.slice(start, end),
      pagination: createPagination(list.length, page, limit)
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function listSourceEventTypesPicker(req, res) {
  return listDistinctSourceValues(req, res, 'eventType');
}

async function listSourceEventIdsPicker(req, res) {
  return listDistinctSourceValues(req, res, 'eventId');
}

async function bulkDeleteLedger(req, res) {
  try {
    const selectedIds = parseListFromKeys(req.body || {}, ['ids', 'entryIds', 'ledgerIds'], parsePublicIdList);
    if (!Array.isArray(selectedIds) || !selectedIds.length) {
      throw new Error('Select at least one ledger entry to delete.');
    }

    const visibility = await addCreditDataService.resolveReadVisibility(req.user, {
      scopeId: req.accessScope
    });
    const rows = await activityQuotaLedgerRepository.list({
      query: {
        id__in: selectedIds.join(','),
        limit: Math.max(selectedIds.length * 2, 200)
      },
      scope: { canViewAll: true },
      sort: { dateTime: -1, id: -1 }
    });

    const visibleRows = (Array.isArray(rows) ? rows : []).filter((row) => rowVisibleForVisibility(row, visibility));
    const rowMap = new Map();
    visibleRows.forEach((row) => {
      const id = toPublicId(row?.id || '');
      if (!id) return;
      rowMap.set(id, row);
    });

    const missingOrForbiddenIds = selectedIds.filter((id) => !rowMap.has(id));
    if (missingOrForbiddenIds.length > 0) {
      throw new Error('Some selected entries are unavailable or you do not have permission to delete them.');
    }

    const impactedKeys = [];
    let removedCount = 0;
    const failedIds = [];

    for (const id of selectedIds) {
      const row = rowMap.get(id);
      // eslint-disable-next-line no-await-in-loop
      const result = await activityQuotaLedgerRepository.remove(id, {});
      const removed = result === true || Number(result?.deletedCount || 0) > 0;
      if (!removed) {
        failedIds.push(id);
        continue;
      }
      removedCount += 1;
      impactedKeys.push({
        orgId: toPublicId(row?.orgId || ''),
        userId: toPublicId(row?.userId || ''),
        section: cleanString(row?.section, { max: 120, allowEmpty: true }) || '',
        operation: cleanString(row?.operation, { max: 120, allowEmpty: true }) || ''
      });
    }

    if (impactedKeys.length > 0) {
      await activityQuotaLedgerService.rebuildProjectionForKeys(impactedKeys, {});
    }

    const message = failedIds.length > 0
      ? `Deleted ${removedCount} entr${removedCount === 1 ? 'y' : 'ies'}. ${failedIds.length} could not be deleted.`
      : `Deleted ${removedCount} entr${removedCount === 1 ? 'y' : 'ies'} successfully.`;

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message,
        results: {
          removedCount,
          failedCount: failedIds.length,
          removedIds: selectedIds.filter((id) => !failedIds.includes(id)),
          failedIds
        }
      });
    }
    return res.redirect('/activity-quota/ledger');
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message || 'Failed to delete selected ledger entries.',
      user: req.user || null
    });
  }
}

module.exports = {
  listLedger,
  listUsersPicker,
  listSectionsPicker,
  listOrganizationsPicker,
  listOperationsPicker,
  listSourceEventTypesPicker,
  listSourceEventIdsPicker,
  bulkDeleteLedger
};
