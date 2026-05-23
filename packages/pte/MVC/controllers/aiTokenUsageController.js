const paginate = require('../../../../MVC/utils/paginationHelper');
const {
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields
} = require('../../../../MVC/utils/generalTools');
const adminChekersService = require('../../../../MVC/services/adminChekersService');
const pteAiTokenUsageDataService = require('../services/pte/pteAiTokenUsageDataService');
const { toPublicId } = require('../../../../MVC/utils/idAdapter');

const TOKEN_USAGE_PICKER_USER_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'username', 'email', 'status', 'orgId'],
  defaultSearchFields: ['id', 'name', 'username', 'email'],
  allowMetaKeys: true
});
const TOKEN_USAGE_PICKER_ORG_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'orgId', 'name', 'status'],
  defaultSearchFields: ['id', 'name'],
  allowMetaKeys: true
});

function cleanText(value, max = 4000) {
  const out = String(value ?? '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeMultiValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((row) => cleanText(row, 120))
      .filter(Boolean);
  }
  if (value === undefined || value === null || value === '') return [];
  return String(value)
    .split(',')
    .map((row) => cleanText(row, 120))
    .filter(Boolean);
}

function splitPagination(query = {}) {
  const source = query && typeof query === 'object' ? query : {};
  const page = Number.parseInt(source.page, 10) || 1;
  const limit = Number.parseInt(source.limit, 10) || undefined;
  const filtered = { ...source };
  delete filtered.page;
  delete filtered.limit;
  return { page, limit, filtered };
}

function buildTokenUsageFilters(query = {}) {
  const source = (query && typeof query === 'object') ? query : {};
  return {
    q: cleanText(source.q, 220),
    type: cleanText(source.type, 40).toLowerCase(),
    searchFields: cleanText(source.searchFields, 400),
    startDate: cleanText(source.startDate || source.consumedFrom, 80),
    endDate: cleanText(source.endDate || source.consumedTo, 80),
    userIds: normalizeMultiValue(source.userIds),
    section: cleanText(source.section, 120).toUpperCase(),
    operation: cleanText(source.operation, 120).toUpperCase(),
    objectId: cleanText(source.objectId, 180),
    providerId: cleanText(source.providerId, 120).toLowerCase(),
    modelUsed: cleanText(source.modelUsed, 220),
    requestLabel: cleanText(source.requestLabel, 220),
    status: cleanText(source.status, 40).toLowerCase()
  };
}

function toDateTimeLocalInputValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function buildDefaultBillingRange() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return {
    startAt: toDateTimeLocalInputValue(start),
    endAt: toDateTimeLocalInputValue(now)
  };
}

function resolveActiveOrgSnapshot(user = null) {
  const activeOrgId = toPublicId(user?.activeOrgId || user?.primaryOrgId) || '';
  const allowedOrgs = Array.isArray(user?.allowedOrgs) ? user.allowedOrgs : [];
  const matched = allowedOrgs.find((row) => String(row?.orgId || row?.id || '') === activeOrgId);
  return {
    id: activeOrgId,
    name: cleanText(matched?.name || matched?.displayName || activeOrgId, 260) || activeOrgId
  };
}

function buildTokenBillingFilters(query = {}, { isSuperUser = false, activeOrgId = '' } = {}) {
  const source = (query && typeof query === 'object') ? query : {};
  const defaults = buildDefaultBillingRange();
  return {
    apply: cleanText(source.apply, 20) === '1' ? '1' : '0',
    orgId: isSuperUser ? cleanText(source.orgId, 120) : cleanText(activeOrgId, 120),
    userIds: normalizeMultiValue(source.userIds),
    startAt: cleanText(source.startAt, 80) || defaults.startAt,
    endAt: cleanText(source.endAt, 80) || defaults.endAt
  };
}

async function listTokenUsage(req, res) {
  try {
    const filters = buildTokenUsageFilters(req.query || {});
    const page = Number.parseInt(req.query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || undefined;

    const selectedUserRows = filters.userIds.length
      ? await pteAiTokenUsageDataService.listPickerUsers(
        { id__in: filters.userIds.join(',') },
        req.user,
        { scopeId: req.accessScope }
      )
      : [];

    const result = await pteAiTokenUsageDataService.listTokenUsages(
      {
        ...filters,
        page,
        limit
      },
      req.user,
      { scopeId: req.accessScope },
      { pagination: { page, limit } }
    );

    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const searchableFields = await inferSearchableFields(rows, {
      exclude: ['audit', 'creator', 'usage', 'requestMeta']
    });
    const pagination = result?.pagination || paginate(rows, req.query.page, req.query.limit).pagination;

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        results: rows,
        pagination
      });
    }

    return res.render('pte/aiAssist/tokenUsageList', {
      title: 'PTE AI Token Usage',
      tableName: 'PTE_AI_Token_Usage',
      data: rows,
      searchableFields,
      newUrl: 'pte/ai-assisst/token-usage',
      newLabel: null,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      btn_export: true,
      pagination,
      filters: result?.filters || filters,
      selectedUsers: Array.isArray(selectedUserRows) ? selectedUserRows : [],
      filterOptions: result?.optionSets || {},
      statusOptions: pteAiTokenUsageDataService.getStatusOptions(),
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showTokenUsageDetail(req, res) {
  try {
    const id = cleanText(req.params?.id, 180);
    if (!id) {
      return res.status(400).render('error', { title: 'Error', message: 'Usage id is required.', user: req.user || null });
    }

    const record = await pteAiTokenUsageDataService.getTokenUsageById(
      id,
      req.user,
      { scopeId: req.accessScope }
    );

    if (!record) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Token usage record not found.', user: req.user || null });
    }

    return res.render('pte/aiAssist/tokenUsageDetail', {
      title: 'PTE AI Token Usage Detail',
      record,
      user: req.user || null
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function pickerUsageUsers(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, TOKEN_USAGE_PICKER_USER_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const rows = await pteAiTokenUsageDataService.listPickerUsers(
      filtered,
      req.user,
      { scopeId: req.accessScope }
    );
    const { data, pagination } = paginate(rows, page, limit);
    return res.json({
      status: 'success',
      results: data,
      pagination
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function pickerUsageBillingOrganizations(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, TOKEN_USAGE_PICKER_ORG_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const rows = await pteAiTokenUsageDataService.listBillingPickerOrganizations(
      filtered,
      req.user,
      { scopeId: req.accessScope }
    );
    const { data, pagination } = paginate(rows, page, limit);
    return res.json({
      status: 'success',
      results: data,
      pagination
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function showTokenUsageBilling(req, res) {
  try {
    const isSuperUser = adminChekersService.isSuperAdmin(req.user);
    const activeOrg = resolveActiveOrgSnapshot(req.user);
    const filters = buildTokenBillingFilters(req.query || {}, {
      isSuperUser,
      activeOrgId: activeOrg.id
    });

    let selectedOrg = null;
    if (filters.orgId) {
      selectedOrg = await pteAiTokenUsageDataService.resolveBillingOrganization(
        filters.orgId,
        req.user,
        { scopeId: req.accessScope }
      );
    }
    if (!selectedOrg && !isSuperUser && activeOrg.id) {
      selectedOrg = { id: activeOrg.id, name: activeOrg.name || activeOrg.id };
      filters.orgId = activeOrg.id;
    }

    let selectedUsers = [];
    if (filters.userIds.length && filters.orgId) {
      selectedUsers = await pteAiTokenUsageDataService.listPickerUsers(
        {
          id__in: filters.userIds.join(','),
          orgId: filters.orgId,
          limit: Math.max(filters.userIds.length * 4, 200)
        },
        req.user,
        { scopeId: req.accessScope }
      );
    }

    let billing = null;
    let billingError = '';
    if (filters.apply === '1') {
      try {
        billing = await pteAiTokenUsageDataService.getBillingAnalytics(
          filters,
          req.user,
          { scopeId: req.accessScope }
        );
        selectedUsers = Array.isArray(billing?.selectedUsers) ? billing.selectedUsers : selectedUsers;
        if (billing?.filters) {
          filters.orgId = cleanText(billing.filters.orgId, 120) || filters.orgId;
          filters.startAt = cleanText(billing.filters.startAt, 80) || filters.startAt;
          filters.endAt = cleanText(billing.filters.endAt, 80) || filters.endAt;
          filters.userIds = normalizeMultiValue(billing.filters.userIds);
        }
      } catch (error) {
        billingError = cleanText(error?.message, 500) || 'Unable to build token usage billing report.';
      }
    }

    return res.render('pte/aiAssist/tokenUsageBilling', {
      title: 'PTE AI Token Usage Billing',
      tableName: 'PTE_AI_Token_Usage_Billing',
      filters,
      selectedOrg,
      selectedUsers,
      isSuperUser,
      activeOrg,
      billing,
      billingError,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

module.exports = {
  listTokenUsage,
  showTokenUsageDetail,
  pickerUsageUsers,
  pickerUsageBillingOrganizations,
  showTokenUsageBilling
};
