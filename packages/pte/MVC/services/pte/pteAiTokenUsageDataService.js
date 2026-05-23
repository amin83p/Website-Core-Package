const pteAiTokenUsageRepository = require('../../repositories/pteAiTokenUsageRepository');
const {
  adminChekersService,
  dataService,
  activityQuotaLedgerService,
  normalizeQueryOptions,
  resolveEntity,
  applyGenericFilter,
  idsEqual,
  toPublicId
} = require('./pteCoreDependencies');

const ORGANIZATION_SCOPE_NAMES = new Set(['ADMIN', 'GLOBAL', 'ORGANIZATION', 'ORG']);
const STATUS_OPTIONS = Object.freeze([
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' }
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function cleanNonNegativeInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return Number(fallback || 0);
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric < 0) {
    return Number(fallback || 0);
  }
  return numeric;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return String(value)
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function normalizeScopeName(scopeName = '') {
  const token = String(scopeName || '').trim().toUpperCase();
  if (!token) return '';
  if (token === 'GLOBAL') return 'GLOBAL';
  if (token === 'ORGANIZATION') return 'ORGANIZATION';
  if (token === 'ORG') return 'ORG';
  if (token === 'ADMIN') return 'ADMIN';
  if (token === 'OWNER') return 'OWNER';
  if (token === 'USER') return 'USER';
  if (token === 'DEPARTMENT') return 'DEPARTMENT';
  if (token === 'DIVISION') return 'DIVISION';
  return '';
}

async function resolveScopeNameById(scopeIdOrName = '') {
  const token = String(scopeIdOrName || '').trim();
  if (!token) return '';
  const byName = normalizeScopeName(token);
  if (byName) return byName;
  const scopeEntity = await resolveEntity('scopes', token);
  return normalizeScopeName(scopeEntity?.name || '');
}

function resolveActiveOrgId(requestingUser) {
  return toPublicId(requestingUser?.activeOrgId || requestingUser?.primaryOrgId) || '';
}

function resolveRequesterUserId(requestingUser) {
  return toPublicId(requestingUser?.id) || '';
}

function resolveObjectId(value, fallback = 'DRAFT:unknown') {
  const token = cleanString(value, { max: 180, allowEmpty: true }) || '';
  if (token) return token;
  return fallback;
}

function normalizeStatus(value, fallback = '') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (token === 'success' || token === 'failed') return token;
  return cleanString(fallback, { max: 40, allowEmpty: true }).toLowerCase() || '';
}

function buildUserDisplayLabel(row = {}) {
  const id = toPublicId(row?.id || row?.userId || '') || '';
  const username = cleanString(row?.username, { max: 140, allowEmpty: true }) || '';
  const email = cleanString(row?.email, { max: 220, allowEmpty: true }) || '';
  const name = cleanString(
    row?.name
      || row?.displayName
      || row?.fullName
      || row?.identity?.displayName
      || '',
    { max: 220, allowEmpty: true }
  ) || '';
  if (name && id) return `${name} (${id})`;
  return name || username || email || id || '-';
}

function collectUserOrgIds(user = {}) {
  const out = new Set();
  const add = (value) => {
    const id = toPublicId(value);
    if (id) out.add(id);
  };
  const orgIds = Array.isArray(user?.orgIds) ? user.orgIds : [];
  orgIds.forEach(add);
  const organizations = Array.isArray(user?.organizations) ? user.organizations : [];
  organizations.forEach((org) => {
    add(org?.orgId);
    add(org?.id);
  });
  add(user?.orgId);
  return Array.from(out);
}

async function resolveVisibility(requestingUser, accessContext = {}) {
  const activeOrgId = resolveActiveOrgId(requestingUser);
  const requesterUserId = resolveRequesterUserId(requestingUser);

  if (adminChekersService.isSuperAdmin(requestingUser)) {
    return {
      mode: 'all',
      activeOrgId,
      requesterUserId,
      scopeName: 'ADMIN'
    };
  }

  if (!activeOrgId) {
    return {
      mode: 'none',
      activeOrgId: '',
      requesterUserId,
      scopeName: ''
    };
  }

  if (adminChekersService.isOrgAdmin(requestingUser)) {
    return {
      mode: 'org',
      activeOrgId,
      requesterUserId,
      scopeName: 'ADMIN'
    };
  }

  const scopeName = await resolveScopeNameById(
    accessContext.scopeId
    || accessContext.accessScope
    || accessContext.scope
    || ''
  );

  if (ORGANIZATION_SCOPE_NAMES.has(scopeName)) {
    return {
      mode: 'org',
      activeOrgId,
      requesterUserId,
      scopeName
    };
  }

  return {
    mode: 'creator',
    activeOrgId,
    requesterUserId,
    scopeName: scopeName || 'OWNER'
  };
}

function assertReadableVisibility(visibility) {
  if (!visibility || visibility.mode === 'none') {
    throw new Error('No active organization context found.');
  }
  if (visibility.mode !== 'all' && !visibility.activeOrgId) {
    throw new Error('No active organization context found.');
  }
  if (visibility.mode === 'creator' && !visibility.requesterUserId) {
    throw new Error('Authenticated user context is required for creator-scoped access.');
  }
}

function buildRepositoryScope(visibility = {}) {
  if (!visibility || visibility.mode === 'all') return { canViewAll: true };
  if (visibility.mode === 'creator') {
    return {
      canViewAll: false,
      orgId: visibility.activeOrgId,
      userId: visibility.requesterUserId
    };
  }
  return {
    canViewAll: false,
    orgId: visibility.activeOrgId
  };
}

function isVisibleUsageRow(row, visibility) {
  if (!row) return false;
  if (visibility.mode === 'all') return true;
  if (!idsEqual(row?.orgId, visibility.activeOrgId)) return false;
  if (visibility.mode === 'org') return true;
  const creatorUserId = toPublicId(row?.creator?.userId || row?.audit?.createUser || row?.userId || '');
  return creatorUserId ? idsEqual(creatorUserId, visibility.requesterUserId) : false;
}

function canTargetUserByVisibility(userRow, visibility) {
  if (!userRow) return false;
  if (visibility.mode === 'all') return true;
  const activeOrgId = toPublicId(visibility.activeOrgId);
  const userOrgIds = collectUserOrgIds(userRow);
  if (!userOrgIds.some((orgId) => idsEqual(orgId, activeOrgId))) return false;
  if (visibility.mode === 'org') return true;
  return idsEqual(toPublicId(userRow?.id || ''), visibility.requesterUserId);
}

function parseListFilters(rawFilters = {}) {
  const source = isPlainObject(rawFilters) ? rawFilters : {};
  return {
    q: cleanString(source.q, { max: 220, allowEmpty: true }) || '',
    type: cleanString(source.type, { max: 40, allowEmpty: true }).toLowerCase(),
    searchFields: cleanString(source.searchFields, { max: 400, allowEmpty: true }) || '',
    startDate: cleanString(source.startDate || source.consumedFrom, { max: 80, allowEmpty: true }) || '',
    endDate: cleanString(source.endDate || source.consumedTo, { max: 80, allowEmpty: true }) || '',
    userIds: normalizeList(source.userIds).map((row) => toPublicId(row)).filter(Boolean),
    section: cleanString(source.section, { max: 120, allowEmpty: true }).toUpperCase() || '',
    operation: cleanString(source.operation, { max: 120, allowEmpty: true }).toUpperCase() || '',
    objectId: cleanString(source.objectId, { max: 180, allowEmpty: true }) || '',
    providerId: cleanString(source.providerId, { max: 120, allowEmpty: true }).toLowerCase() || '',
    modelUsed: cleanString(source.modelUsed, { max: 220, allowEmpty: true }) || '',
    requestLabel: cleanString(source.requestLabel, { max: 220, allowEmpty: true }) || '',
    status: normalizeStatus(source.status, ''),
    page: Math.max(1, cleanNonNegativeInteger(source.page, 1) || 1),
    limit: Math.max(1, Math.min(200, cleanNonNegativeInteger(source.limit, 20) || 20))
  };
}

function buildListQuery(filters = {}) {
  const query = {};
  if (filters.q) query.q = filters.q;
  if (filters.type) query.type = filters.type;
  if (filters.searchFields) query.searchFields = filters.searchFields;
  if (filters.startDate) query.startDate = filters.startDate;
  if (filters.endDate) query.endDate = filters.endDate;
  if (filters.section) query.section__eq = filters.section;
  if (filters.operation) query.operation__eq = filters.operation;
  if (filters.objectId) query.objectId__eq = filters.objectId;
  if (filters.providerId) query.providerId__eq = filters.providerId;
  if (filters.modelUsed) query.modelUsed__eq = filters.modelUsed;
  if (filters.requestLabel) query.requestLabel__eq = filters.requestLabel;
  if (filters.status) query.status__eq = filters.status;
  if (filters.userIds.length === 1) query.userId__eq = filters.userIds[0];
  if (filters.userIds.length > 1) query.userId__in = filters.userIds.join(',');
  return normalizeQueryOptions(query);
}

function buildPaginationMeta(totalRows = 0, page = 1, limit = 20) {
  const totalItems = Math.max(0, Number(totalRows) || 0);
  const safeLimit = Math.max(1, Number(limit) || 20);
  const totalPages = Math.max(1, Math.ceil(totalItems / safeLimit) || 1);
  const currentPage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const startIndex = (currentPage - 1) * safeLimit;
  const endIndex = Math.min(startIndex + safeLimit, totalItems);
  return {
    currentPage,
    totalPages,
    totalItems,
    limit: safeLimit,
    startItem: totalItems > 0 ? startIndex + 1 : 0,
    endItem: endIndex
  };
}

function parseDateTimeBoundary(value, boundary = 'start') {
  const raw = cleanString(value, { max: 120, allowEmpty: true });
  if (!raw) return null;

  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const year = Number.parseInt(dateOnly[1], 10);
    const month = Number.parseInt(dateOnly[2], 10) - 1;
    const day = Number.parseInt(dateOnly[3], 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    return boundary === 'end'
      ? new Date(year, month, day, 23, 59, 59, 999)
      : new Date(year, month, day, 0, 0, 0, 0);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toDateToken(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function countDaysInclusive(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0);
  const diff = endDay.getTime() - startDay.getTime();
  if (!Number.isFinite(diff) || diff < 0) return 0;
  return Math.floor(diff / 86400000) + 1;
}

function normalizeOrganizationDisplayName(row = {}) {
  return cleanString(
    row?.identity?.displayName
    || row?.name
    || row?.displayName
    || row?.orgName
    || row?.title
    || '',
    { max: 260, allowEmpty: true }
  ) || '';
}

function mapOrganizationPickerRow(row = {}) {
  const id = toPublicId(row?.id || row?.orgId || '') || '';
  const name = normalizeOrganizationDisplayName(row) || id || '-';
  return {
    id,
    orgId: id,
    name
  };
}

function extractTargetOrgIdFromQuery(rawQuery = {}) {
  if (!isPlainObject(rawQuery)) return '';
  return toPublicId(rawQuery.orgId || rawQuery.orgId__eq || '') || '';
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback || 0);
}

const pteAiTokenUsageDataService = {
  async resolveReadVisibility(requestingUser, accessContext = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    return visibility;
  },

  getStatusOptions() {
    return STATUS_OPTIONS.slice();
  },

  async listTokenUsages(rawFilters = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await this.resolveReadVisibility(requestingUser, accessContext);
    const filters = parseListFilters(rawFilters);

    if (filters.userIds.length && visibility.mode === 'creator') {
      const hasInvalid = filters.userIds.some((userId) => !idsEqual(userId, visibility.requesterUserId));
      if (hasInvalid) {
        throw new Error('Creator-scoped access can only filter your own user id.');
      }
    }

    const query = buildListQuery(filters);
    const repositoryScope = buildRepositoryScope(visibility);

    const [totalRows, rowsRaw] = await Promise.all([
      pteAiTokenUsageRepository.count({
        query,
        scope: repositoryScope,
        backendMode: options?.backendMode
      }),
      pteAiTokenUsageRepository.list({
        query,
        scope: repositoryScope,
        sort: { consumedAt: -1, id: -1 },
        pagination: { page: filters.page, limit: filters.limit },
        backendMode: options?.backendMode
      })
    ]);

    const visibleRows = (Array.isArray(rowsRaw) ? rowsRaw : []).filter((row) => isVisibleUsageRow(row, visibility));
    const uniqueUserIds = Array.from(new Set(
      visibleRows
        .map((row) => toPublicId(row?.userId || ''))
        .filter(Boolean)
    ));
    const userRows = uniqueUserIds.length
      ? await dataService.fetchData(
        'users',
        { id__in: uniqueUserIds.join(','), limit: Math.max(uniqueUserIds.length * 2, 200) },
        requestingUser,
        options?.backendMode ? { backendMode: options.backendMode } : {}
      )
      : [];
    const userMap = new Map((Array.isArray(userRows) ? userRows : []).map((row) => [toPublicId(row?.id || ''), row]));

    const rows = visibleRows.map((row) => {
      const userRow = userMap.get(toPublicId(row?.userId || '')) || { id: row?.userId || '' };
      return {
        ...row,
        userLabel: buildUserDisplayLabel(userRow),
        consumedAtDisplay: cleanString(row?.consumedAt, { max: 80, allowEmpty: true })
          ? new Date(row.consumedAt).toLocaleString()
          : '-'
      };
    });

    const sections = Array.from(new Set(
      rows.map((row) => cleanString(row?.section, { max: 120, allowEmpty: true }).toUpperCase()).filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));
    const operations = Array.from(new Set(
      rows.map((row) => cleanString(row?.operation, { max: 120, allowEmpty: true }).toUpperCase()).filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));
    const providerIds = Array.from(new Set(
      rows.map((row) => cleanString(row?.providerId, { max: 80, allowEmpty: true }).toLowerCase()).filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));

    return {
      rows,
      pagination: buildPaginationMeta(totalRows, filters.page, filters.limit),
      filters: {
        ...filters,
        userIds: filters.userIds
      },
      optionSets: {
        statuses: STATUS_OPTIONS.slice(),
        sections,
        operations,
        providers: providerIds
      }
    };
  },

  async getTokenUsageById(id, requestingUser, accessContext = {}, options = {}) {
    const visibility = await this.resolveReadVisibility(requestingUser, accessContext);
    const row = await pteAiTokenUsageRepository.getById(id, {
      backendMode: options?.backendMode
    });
    if (!row || !isVisibleUsageRow(row, visibility)) return null;

    let userLabel = cleanString(row?.userId, { max: 120, allowEmpty: true }) || '-';
    const userId = toPublicId(row?.userId || '');
    if (userId) {
      const users = await dataService.fetchData(
        'users',
        { id__in: userId, limit: 2 },
        requestingUser,
        options?.backendMode ? { backendMode: options.backendMode } : {}
      );
      const userRow = Array.isArray(users) ? users[0] : null;
      if (userRow) userLabel = buildUserDisplayLabel(userRow);
    }

    return {
      ...row,
      userLabel,
      consumedAtDisplay: cleanString(row?.consumedAt, { max: 80, allowEmpty: true })
        ? new Date(row.consumedAt).toLocaleString()
        : '-'
    };
  },

  async listPickerUsers(rawQuery = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await this.resolveReadVisibility(requestingUser, accessContext);
    const query = isPlainObject(rawQuery) ? rawQuery : {};
    const targetOrgId = extractTargetOrgIdFromQuery(query);
    if (targetOrgId && visibility.mode !== 'all' && !idsEqual(targetOrgId, visibility.activeOrgId)) {
      throw new Error('Selected organization is outside your access scope.');
    }

    const userQuery = { ...query };
    delete userQuery.orgId;
    delete userQuery.orgId__eq;

    const rowsRaw = await dataService.fetchData(
      'users',
      {
        ...userQuery,
        limit: Math.max(Number(userQuery.limit || 0) || 0, 800)
      },
      requestingUser,
      options?.backendMode ? { backendMode: options.backendMode } : {}
    );

    const mapped = (Array.isArray(rowsRaw) ? rowsRaw : [])
      .filter((row) => canTargetUserByVisibility(row, visibility))
      .filter((row) => {
        if (!targetOrgId) return true;
        const orgIds = collectUserOrgIds(row);
        return orgIds.some((orgId) => idsEqual(orgId, targetOrgId));
      })
      .map((row) => ({
        id: toPublicId(row?.id || '') || '',
        name: buildUserDisplayLabel(row),
        username: cleanString(row?.username, { max: 140, allowEmpty: true }) || '',
        email: cleanString(row?.email, { max: 220, allowEmpty: true }) || '',
        orgId: targetOrgId || collectUserOrgIds(row)[0] || ''
      }));

    return applyGenericFilter(mapped, query, {
      defaultSearchFields: ['id', 'name', 'username', 'email'],
      dateFields: []
    });
  },

  async listBillingPickerOrganizations(rawQuery = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await this.resolveReadVisibility(requestingUser, accessContext);
    const query = isPlainObject(rawQuery) ? rawQuery : {};

    if (adminChekersService.isSuperAdmin(requestingUser)) {
      const rowsRaw = await dataService.fetchData(
        'organizations',
        {
          ...query,
          limit: Math.max(Number(query.limit || 0) || 0, 800)
        },
        requestingUser,
        options?.backendMode ? { backendMode: options.backendMode } : {}
      );
      const mapped = (Array.isArray(rowsRaw) ? rowsRaw : [])
        .map(mapOrganizationPickerRow)
        .filter((row) => row.id);
      return applyGenericFilter(mapped, query, {
        defaultSearchFields: ['id', 'name'],
        dateFields: []
      });
    }

    const activeOrgId = toPublicId(visibility.activeOrgId || resolveActiveOrgId(requestingUser)) || '';
    if (!activeOrgId) return [];

    let selectedOrg = null;
    const allowedOrgs = Array.isArray(requestingUser?.allowedOrgs) ? requestingUser.allowedOrgs : [];
    const fromAllowed = allowedOrgs.find((row) => idsEqual(row?.orgId || row?.id, activeOrgId));
    if (fromAllowed) {
      selectedOrg = mapOrganizationPickerRow({
        id: activeOrgId,
        name: fromAllowed?.name || fromAllowed?.displayName || activeOrgId
      });
    } else {
      const orgRows = await dataService.fetchData(
        'organizations',
        { id__in: activeOrgId, limit: 3 },
        requestingUser,
        options?.backendMode ? { backendMode: options.backendMode } : {}
      );
      selectedOrg = mapOrganizationPickerRow((Array.isArray(orgRows) ? orgRows[0] : null) || { id: activeOrgId, name: activeOrgId });
    }

    return applyGenericFilter([selectedOrg], query, {
      defaultSearchFields: ['id', 'name'],
      dateFields: []
    });
  },

  async resolveBillingOrganization(orgId, requestingUser, accessContext = {}, options = {}) {
    const targetOrgId = toPublicId(orgId || '') || '';
    if (!targetOrgId) return null;
    const rows = await this.listBillingPickerOrganizations(
      { id__in: targetOrgId, limit: 10 },
      requestingUser,
      accessContext,
      options
    );
    const match = (Array.isArray(rows) ? rows : []).find((row) => idsEqual(row?.id, targetOrgId));
    if (!match) return null;
    return {
      id: targetOrgId,
      name: cleanString(match?.name, { max: 260, allowEmpty: true }) || targetOrgId
    };
  },

  async getBillingAnalytics(rawFilters = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await this.resolveReadVisibility(requestingUser, accessContext);
    const source = isPlainObject(rawFilters) ? rawFilters : {};
    const isSuperUser = adminChekersService.isSuperAdmin(requestingUser);
    const requestedOrgId = toPublicId(source.orgId || '') || '';
    const resolvedOrgId = isSuperUser
      ? requestedOrgId
      : (toPublicId(visibility.activeOrgId || resolveActiveOrgId(requestingUser)) || '');

    if (!resolvedOrgId) {
      throw new Error('Please select an organization first.');
    }
    if (!isSuperUser && requestedOrgId && !idsEqual(requestedOrgId, resolvedOrgId)) {
      throw new Error('Selected organization is outside your access scope.');
    }

    const startAt = parseDateTimeBoundary(source.startAt, 'start');
    const endAt = parseDateTimeBoundary(source.endAt, 'end');
    if (!startAt || !endAt) {
      throw new Error('Please choose both start and end date-time values.');
    }
    const boundedStart = startAt <= endAt ? startAt : endAt;
    const boundedEnd = startAt <= endAt ? endAt : startAt;

    const requestedUserIds = normalizeList(source.userIds)
      .map((row) => toPublicId(row))
      .filter(Boolean);
    const uniqueRequestedUserIds = Array.from(new Set(requestedUserIds));

    let selectedUsers = [];
    let effectiveUserIds = uniqueRequestedUserIds;
    if (uniqueRequestedUserIds.length) {
      selectedUsers = await this.listPickerUsers(
        {
          id__in: uniqueRequestedUserIds.join(','),
          orgId: resolvedOrgId,
          limit: Math.max(uniqueRequestedUserIds.length * 4, 200)
        },
        requestingUser,
        accessContext,
        options
      );
      const selectedMap = new Set((Array.isArray(selectedUsers) ? selectedUsers : []).map((row) => toPublicId(row?.id || '')));
      effectiveUserIds = uniqueRequestedUserIds.filter((userId) => selectedMap.has(userId));
      if (effectiveUserIds.length !== uniqueRequestedUserIds.length) {
        throw new Error('Some selected users are not accessible under the selected organization.');
      }
    }

    const repositoryScope = isSuperUser
      ? { canViewAll: false, orgId: resolvedOrgId }
      : buildRepositoryScope(visibility);
    const query = normalizeQueryOptions(
      effectiveUserIds.length === 1
        ? { userId__eq: effectiveUserIds[0] }
        : effectiveUserIds.length > 1
          ? { userId__in: effectiveUserIds.join(',') }
          : {}
    );

    const rowsRaw = await pteAiTokenUsageRepository.list({
      query,
      scope: repositoryScope,
      sort: { consumedAt: 1, id: 1 },
      backendMode: options?.backendMode
    });

    const filteredRows = (Array.isArray(rowsRaw) ? rowsRaw : [])
      .filter((row) => isVisibleUsageRow(row, visibility))
      .filter((row) => idsEqual(row?.orgId, resolvedOrgId))
      .filter((row) => {
        const consumedAt = new Date(row?.consumedAt || row?.createdAt || 0);
        if (Number.isNaN(consumedAt.getTime())) return false;
        return consumedAt >= boundedStart && consumedAt <= boundedEnd;
      })
      .filter((row) => {
        if (!effectiveUserIds.length) return true;
        return effectiveUserIds.some((userId) => idsEqual(row?.userId, userId));
      });

    const dailyMap = new Map();
    const modelMap = new Map();
    const totals = {
      callCount: 0,
      totalTokens: 0,
      promptTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      successCount: 0,
      failedCount: 0
    };

    const startDay = new Date(boundedStart.getFullYear(), boundedStart.getMonth(), boundedStart.getDate(), 0, 0, 0, 0);
    const endDay = new Date(boundedEnd.getFullYear(), boundedEnd.getMonth(), boundedEnd.getDate(), 0, 0, 0, 0);
    const dayCursor = new Date(startDay);
    while (dayCursor <= endDay) {
      const token = toDateToken(dayCursor);
      dailyMap.set(token, {
        day: token,
        callCount: 0,
        totalTokens: 0,
        promptTokens: 0,
        outputTokens: 0,
        cachedTokens: 0
      });
      dayCursor.setDate(dayCursor.getDate() + 1);
    }

    filteredRows.forEach((row) => {
      const promptTokens = toNumber(row?.promptTokenCount, 0);
      const outputTokens = toNumber(row?.candidatesTokenCount, 0);
      const totalTokens = toNumber(row?.totalTokenCount, 0);
      const cachedTokens = toNumber(row?.cachedContentTokenCount, 0);
      const consumedAt = new Date(row?.consumedAt || row?.createdAt || 0);
      const dayToken = toDateToken(consumedAt);
      const modelKey = cleanString(row?.modelUsed, { max: 220, allowEmpty: true }) || '(unspecified model)';
      const status = cleanString(row?.status, { max: 40, allowEmpty: true }).toLowerCase();

      totals.callCount += 1;
      totals.promptTokens += promptTokens;
      totals.outputTokens += outputTokens;
      totals.totalTokens += totalTokens;
      totals.cachedTokens += cachedTokens;
      if (status === 'failed') totals.failedCount += 1;
      else totals.successCount += 1;

      if (!dailyMap.has(dayToken)) {
        dailyMap.set(dayToken, {
          day: dayToken,
          callCount: 0,
          totalTokens: 0,
          promptTokens: 0,
          outputTokens: 0,
          cachedTokens: 0
        });
      }
      const dayBucket = dailyMap.get(dayToken);
      dayBucket.callCount += 1;
      dayBucket.totalTokens += totalTokens;
      dayBucket.promptTokens += promptTokens;
      dayBucket.outputTokens += outputTokens;
      dayBucket.cachedTokens += cachedTokens;

      if (!modelMap.has(modelKey)) {
        modelMap.set(modelKey, {
          modelUsed: modelKey,
          callCount: 0,
          totalTokens: 0,
          promptTokens: 0,
          outputTokens: 0,
          cachedTokens: 0
        });
      }
      const modelBucket = modelMap.get(modelKey);
      modelBucket.callCount += 1;
      modelBucket.totalTokens += totalTokens;
      modelBucket.promptTokens += promptTokens;
      modelBucket.outputTokens += outputTokens;
      modelBucket.cachedTokens += cachedTokens;
    });

    const dailyRows = Array.from(dailyMap.values()).sort((a, b) => String(a.day).localeCompare(String(b.day)));
    const modelRows = Array.from(modelMap.values())
      .sort((a, b) => {
        if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
        return String(a.modelUsed).localeCompare(String(b.modelUsed));
      });

    const dayCount = countDaysInclusive(boundedStart, boundedEnd);
    const activeDays = dailyRows.filter((row) => Number(row?.callCount || 0) > 0).length;
    const analysis = {
      rangeDayCount: dayCount,
      activeDayCount: activeDays,
      avgTokensPerCall: totals.callCount > 0 ? (totals.totalTokens / totals.callCount) : 0,
      avgPromptTokensPerCall: totals.callCount > 0 ? (totals.promptTokens / totals.callCount) : 0,
      avgOutputTokensPerCall: totals.callCount > 0 ? (totals.outputTokens / totals.callCount) : 0,
      avgCallsPerDay: dayCount > 0 ? (totals.callCount / dayCount) : 0,
      avgTokensPerDay: dayCount > 0 ? (totals.totalTokens / dayCount) : 0,
      avgCallsPerActiveDay: activeDays > 0 ? (totals.callCount / activeDays) : 0,
      avgTokensPerActiveDay: activeDays > 0 ? (totals.totalTokens / activeDays) : 0,
      avgModelTokens: modelRows.length > 0
        ? (modelRows.reduce((sum, row) => sum + toNumber(row?.totalTokens, 0), 0) / modelRows.length)
        : 0
    };

    return {
      filters: {
        orgId: resolvedOrgId,
        userIds: effectiveUserIds,
        startAt: toDateTimeLocalInputValue(boundedStart),
        endAt: toDateTimeLocalInputValue(boundedEnd)
      },
      selectedUsers,
      totals,
      dailyRows,
      modelRows,
      analysis,
      rowCount: filteredRows.length
    };
  },

  async recordUsage(payload = {}, requestingUser = null, options = {}) {
    const source = isPlainObject(payload) ? payload : {};
    const activeOrgId = resolveActiveOrgId(requestingUser);
    const requesterUserId = resolveRequesterUserId(requestingUser);
    if (!activeOrgId || !requesterUserId) return null;

    const creator = activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, activeOrgId)
      || activityQuotaLedgerService.createSystemCreatorSnapshot(activeOrgId);
    const actor = creator.type === 'system' ? 'System' : (creator.userId || 'System');
    const nowIso = new Date().toISOString();

    const status = normalizeStatus(source.status, 'success');
    const usageObject = isPlainObject(source.usage) ? source.usage : {};
    const promptTokenCount = Number.isFinite(Number(source.promptTokenCount))
      ? Number(source.promptTokenCount)
      : (Number.isFinite(Number(usageObject.promptTokenCount)) ? Number(usageObject.promptTokenCount) : null);
    const candidatesTokenCount = Number.isFinite(Number(source.candidatesTokenCount))
      ? Number(source.candidatesTokenCount)
      : (Number.isFinite(Number(usageObject.candidatesTokenCount)) ? Number(usageObject.candidatesTokenCount) : null);
    const totalTokenCount = Number.isFinite(Number(source.totalTokenCount))
      ? Number(source.totalTokenCount)
      : (Number.isFinite(Number(usageObject.totalTokenCount)) ? Number(usageObject.totalTokenCount) : null);
    const cachedContentTokenCount = Number.isFinite(Number(source.cachedContentTokenCount))
      ? Number(source.cachedContentTokenCount)
      : (Number.isFinite(Number(usageObject.cachedContentTokenCount)) ? Number(usageObject.cachedContentTokenCount) : null);

    const normalized = {
      id: cleanString(source.id, { max: 120, allowEmpty: true }) || '',
      consumedAt: cleanString(source.consumedAt, { max: 80, allowEmpty: true }) || nowIso,
      orgId: activeOrgId,
      userId: requesterUserId,
      section: cleanString(source.section, { max: 120, allowEmpty: true }).toUpperCase() || 'PTE_AI_ASSISST',
      operation: cleanString(source.operation, { max: 120, allowEmpty: true }).toUpperCase() || 'UPDATE',
      objectId: resolveObjectId(source.objectId, 'DRAFT:unknown'),
      providerId: cleanString(source.providerId, { max: 80, allowEmpty: true }).toLowerCase() || '',
      providerRecordId: toPublicId(source.providerRecordId || '') || null,
      providerRecordName: cleanString(source.providerRecordName, { max: 260, allowEmpty: true }) || null,
      modelUsed: cleanString(source.modelUsed, { max: 220, allowEmpty: true }) || null,
      requestLabel: cleanString(source.requestLabel, { max: 220, allowEmpty: true }) || null,
      messageCount: Number.isFinite(Number(source.messageCount)) ? Number(source.messageCount) : null,
      hasSystemInstruction: Boolean(source.hasSystemInstruction),
      status,
      errorMessage: cleanString(source.errorMessage, { max: 4000, allowEmpty: true }) || null,
      usage: {
        promptTokenCount,
        candidatesTokenCount,
        totalTokenCount,
        cachedContentTokenCount
      },
      promptTokenCount,
      candidatesTokenCount,
      totalTokenCount,
      cachedContentTokenCount,
      requestMeta: isPlainObject(source.requestMeta) ? source.requestMeta : {},
      creator,
      audit: {
        createUser: actor,
        createDateTime: nowIso,
        lastUpdateUser: actor,
        lastUpdateDateTime: nowIso
      }
    };

    if (!normalized.providerId) return null;
    return pteAiTokenUsageRepository.create(normalized, {
      backendMode: options?.backendMode
    });
  }
};

module.exports = pteAiTokenUsageDataService;
