const { normalizeQueryOptions } = require('../../../utils/queryOptionsAdapter');
const { toPublicId } = require('../../../utils/idAdapter');
const { recordTransactionOperation } = require('../../transactionContextService');
const {
  buildBenchPathListScope,
  getScopedActiveOrgId,
  isScopedSuperAdmin
} = require('../benchpathDataScopeBuilder');
const {
  resolveEntityConfig,
  resolveReferenceEntityType
} = require('./entityRegistry');
const {
  normalizeBenchpathPayload,
  validateBenchpathPayloadShape,
  deriveSourceSnapshotFields
} = require('./payloadContractService');
const {
  validateBenchpathCrossEntityIntegrity
} = require('./integrityValidationService');
const settingService = require('../../settingService');

const COUNT_CACHE_TTL_MS = 30000;
const countCache = new Map();

function buildScopeCacheSignature(scope = {}) {
  return {
    canViewAll: scope?.canViewAll === true,
    denyAll: scope?.denyAll === true,
    activeOrgId: toPublicId(scope?.activeOrgId || ''),
    allowSystemFallback: scope?.allowSystemFallback === true
  };
}

function buildCountCacheKey(entityType, normalizedQuery = {}, scope = {}) {
  return JSON.stringify({
    entityType: String(entityType || ''),
    query: normalizedQuery && typeof normalizedQuery === 'object' ? normalizedQuery : {},
    scope: buildScopeCacheSignature(scope)
  });
}

function getCachedCountValue(cacheKey = '') {
  const key = String(cacheKey || '').trim();
  if (!key) return null;
  const row = countCache.get(key);
  if (!row) return null;
  const now = Date.now();
  if (!Number.isFinite(row?.expiresAt) || row.expiresAt <= now) {
    countCache.delete(key);
    return null;
  }
  return Number(row?.value || 0);
}

function setCachedCountValue(cacheKey = '', value = 0) {
  const key = String(cacheKey || '').trim();
  if (!key) return;
  countCache.set(key, {
    value: Number(value || 0),
    expiresAt: Date.now() + COUNT_CACHE_TTL_MS
  });
}

function clearCountCache() {
  countCache.clear();
}

function toPositiveInteger(value, fallback = null) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveDefaultPageSize() {
  const configured = toPositiveInteger(settingService.getValue('app', 'defaultPageSize'), null);
  return configured || 20;
}

function normalizePaginationQuery(query = {}) {
  const source = query && typeof query === 'object' ? query : {};
  const page = Math.max(1, toPositiveInteger(source.page, 1) || 1);
  const limit = toPositiveInteger(source.limit, resolveDefaultPageSize()) || resolveDefaultPageSize();
  return { page, limit };
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function buildPaginationMeta(totalRows = 0, page = 1, limit = 0) {
  const safeTotal = Math.max(0, Number(totalRows) || 0);
  const safeLimit = Math.max(1, Number(limit) || resolveDefaultPageSize());
  const totalPages = Math.max(1, Math.ceil(safeTotal / safeLimit));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const startIndex = (currentPage - 1) * safeLimit;
  const endIndex = Math.min(startIndex + safeLimit, safeTotal);
  return {
    currentPage,
    totalPages,
    totalItems: safeTotal,
    limit: safeLimit,
    startItem: safeTotal > 0 ? startIndex + 1 : 0,
    endItem: endIndex
  };
}

function buildEntityScope(requestingUser) {
  return buildBenchPathListScope(requestingUser, { allowSystemFallback: true });
}

function resolveWriteOrgId(payload = {}, requestingUser, existingRecord = null) {
  if (existingRecord?.orgId) return toPublicId(existingRecord.orgId);

  const incomingOrgId = toPublicId(payload?.orgId);
  if (incomingOrgId && isScopedSuperAdmin(requestingUser)) return incomingOrgId;

  return getScopedActiveOrgId(requestingUser) || incomingOrgId || 'SYSTEM';
}

async function hydrateSourceFragmentSnapshots(entityType, payload, existingRecord = null) {
  if (String(entityType) !== 'sourceFragments') return payload;

  const sourceRepository = resolveEntityConfig('sources')?.repository;
  if (!sourceRepository || typeof sourceRepository.getById !== 'function') return payload;

  const sourceId = toPublicId(payload?.sourceId) || toPublicId(existingRecord?.sourceId);
  if (!sourceId) return payload;

  const source = await sourceRepository.getById(sourceId);
  if (!source) {
    throw new Error(`sourceId does not exist in sources: ${sourceId}`);
  }

  return {
    ...payload,
    sourceId,
    ...deriveSourceSnapshotFields(source)
  };
}

function enforceShapeGate(entityType, payload, phase) {
  const errors = validateBenchpathPayloadShape(entityType, payload, phase);
  if (errors.length) {
    throw new Error(errors.join('<br>'));
  }
}

async function enforceIntegrityGate(entityType, payload) {
  const errors = await validateBenchpathCrossEntityIntegrity(entityType, payload);
  if (errors.length) {
    throw new Error(errors.join('<br>'));
  }
}

function normalizeForRead(entityType, record) {
  const normalized = normalizeBenchpathPayload(entityType, record || {});
  enforceShapeGate(entityType, normalized, 'read');
  return normalized;
}

function isRecordVisibleForScope(record = {}, scope = {}) {
  if (scope?.canViewAll === true) return true;

  const recordOrgId = toPublicId(record?.orgId) || null;
  if (scope?.allowSystemFallback === true && recordOrgId === 'SYSTEM') return true;

  if (scope?.denyAll === true) return false;

  const activeOrgId = toPublicId(scope?.activeOrgId) || null;
  if (!activeOrgId) return false;

  return recordOrgId === activeOrgId;
}

const entityGatewayService = {
  async fetchData(entityType, query, requestingUser) {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown BenchPath entity type: ${entityType}`);

    const rows = await config.repository.list({
      query: normalizeQueryOptions(query),
      scope: buildEntityScope(requestingUser)
    });

    return Array.isArray(rows) ? rows.map((row) => normalizeForRead(entityType, row)) : [];
  },

  async countData(entityType, query, requestingUser) {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown BenchPath entity type: ${entityType}`);

    const normalizedQuery = normalizeQueryOptions(stripPaginationFromQuery(query || {}));
    const scope = buildEntityScope(requestingUser);
    const countCacheKey = buildCountCacheKey(entityType, normalizedQuery, scope);
    const cachedValue = getCachedCountValue(countCacheKey);
    if (cachedValue !== null) return cachedValue;

    let totalRows = 0;
    if (typeof config.repository.count === 'function') {
      totalRows = Number(await config.repository.count({
        query: normalizedQuery,
        scope
      }) || 0);
    } else {
      const rows = await config.repository.list({
        query: normalizedQuery,
        scope
      });
      totalRows = Array.isArray(rows) ? rows.length : 0;
    }

    setCachedCountValue(countCacheKey, totalRows);
    return totalRows;
  },

  async fetchDataPaged(entityType, query, requestingUser) {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown BenchPath entity type: ${entityType}`);

    const normalizedQuery = normalizeQueryOptions(query || {});
    const paginationInput = normalizePaginationQuery(normalizedQuery);
    const pageQuery = {
      ...stripPaginationFromQuery(normalizedQuery),
      page: paginationInput.page,
      limit: paginationInput.limit
    };

    const [totalRows, rows] = await Promise.all([
      this.countData(entityType, normalizedQuery, requestingUser),
      config.repository.list({
        query: pageQuery,
        scope: buildEntityScope(requestingUser)
      })
    ]);

    const normalizedRows = Array.isArray(rows)
      ? rows.map((row) => normalizeForRead(entityType, row))
      : [];

    return {
      rows: normalizedRows,
      totalRows,
      pagination: buildPaginationMeta(totalRows, paginationInput.page, paginationInput.limit)
    };
  },

  async addData(entityType, data, requestingUser, options = {}) {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown BenchPath entity type for add: ${entityType}`);

    const normalizedInput = normalizeBenchpathPayload(entityType, data || {});
    let payload = {
      ...normalizedInput,
      orgId: resolveWriteOrgId(normalizedInput, requestingUser, null)
    };
    payload = await hydrateSourceFragmentSnapshots(entityType, payload, null);
    enforceShapeGate(entityType, payload, 'write');
    await enforceIntegrityGate(entityType, payload);

    const result = await config.repository.create(payload, requestingUser?.id || 'system');
    clearCountCache();
    recordTransactionOperation(options, {
      type: 'create',
      entityType: String(entityType || ''),
      size: Array.isArray(result) ? result.length : 1
    });
    return normalizeForRead(entityType, result);
  },

  async updateData(entityType, id, data, requestingUser, options = {}) {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown BenchPath entity type for update: ${entityType}`);

    const existing = await this.getDataById(entityType, id, requestingUser);
    if (!existing) throw new Error('Record not found or outside organization scope.');

    const normalizedInput = normalizeBenchpathPayload(entityType, data || {});
    let payload = {
      ...normalizedInput,
      orgId: resolveWriteOrgId(normalizedInput, requestingUser, existing)
    };
    payload = await hydrateSourceFragmentSnapshots(entityType, payload, existing);
    const candidate = {
      ...existing,
      ...payload,
      id: existing.id
    };
    enforceShapeGate(entityType, candidate, 'write');
    await enforceIntegrityGate(entityType, candidate);

    const result = await config.repository.update(id, payload, requestingUser?.id || 'system');
    clearCountCache();
    recordTransactionOperation(options, {
      type: 'update',
      entityType: String(entityType || ''),
      id: toPublicId(id)
    });
    return normalizeForRead(entityType, result);
  },

  async getDataById(entityType, id, requestingUser) {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown BenchPath entity type for ID: ${entityType}`);

    const normalizedId = toPublicId(id);
    if (!normalizedId) return null;

    const scope = buildEntityScope(requestingUser);

    if (typeof config.repository.getById === 'function') {
      const row = await config.repository.getById(normalizedId);
      if (!row) return null;
      if (!isRecordVisibleForScope(row, scope)) return null;
      return normalizeForRead(entityType, row);
    }

    const rows = await config.repository.list({
      query: normalizeQueryOptions({
        id__eq: normalizedId,
        page: 1,
        limit: 1
      }),
      scope
    });
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return normalizeForRead(entityType, rows[0]);
  },

  async deleteData(entityType, id, requestingUser, options = {}) {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown BenchPath entity type for delete: ${entityType}`);

    const existing = await this.getDataById(entityType, id, requestingUser);
    if (!existing) throw new Error('Record not found or outside organization scope.');

    const result = await config.repository.remove(id, options);
    clearCountCache();
    recordTransactionOperation(options, {
      type: 'delete',
      entityType: String(entityType || ''),
      id: toPublicId(id)
    });
    return result;
  },

  resolveReferenceEntityType
};

module.exports = entityGatewayService;
