const userRepository = require('../../repositories/userRepository');
const personRepository = require('../../repositories/personRepository');
const organizationRepository = require('../../repositories/organizationRepository');
const contractRepository = require('../../repositories/contractRepository');
const sectionRepository = require('../../repositories/sectionRepository');
const operationRepository = require('../../repositories/operationRepository');
const roleRepository = require('../../repositories/roleRepository');
const scopeRepository = require('../../repositories/scopeRepository');
const accessRepository = require('../../repositories/accessRepository');
const accessPolicyRepository = require('../../repositories/accessPolicyRepository');
const tableSettingsRepository = require('../../repositories/tableSettingsRepository');
const logRepository = require('../../repositories/logRepository');
const actionStateRepository = require('../../repositories/actionStateRepository');
const orgPolicyRepository = require('../../repositories/orgPolicyRepository');
const symbolRepository = require('../../repositories/symbolRepository');
const sessionRepository = require('../../repositories/sessionRepository');
const newsRepository = require('../../repositories/newsRepository');
const contactRepository = require('../../repositories/contactRepository');
const newsletterRepository = require('../../repositories/newsletterRepository');
const subscriptionGroupRepository = require('../../repositories/subscriptionGroupRepository');
const userMembershipRepository = require('../../repositories/userMembershipRepository');
const emailManagementTemplateRepository = require('../../repositories/emailManagementTemplateRepository');
const deleteIntegrityService = require('../deleteIntegrityService');
const { toPublicId, toStorageId } = require('../../utils/idAdapter');
const { normalizeQueryOptions } = require('../../utils/queryOptionsAdapter');
const { recordTransactionOperation } = require('../transactionContextService');
const settingService = require('../settingService');
const actionStateChangeTrackerService = require('../actionStateChangeTrackerService');
const {
  buildPersonScope,
  buildOrganizationScope,
  buildSectionScope,
  buildAccessScope,
  buildAccessPolicyScope,
  buildTableSettingsScope,
  buildOrgPolicyScope,
  buildSymbolScope,
  buildSessionScope,
  buildContactScope,
  buildNewsletterScope,
  buildSubscriptionGroupScope,
  buildNewsScope,
  buildUserMembershipScope,
  buildEmailManagementTemplateScope
} = require('../security/dataScopeBuilder');

const COUNT_CACHE_TTL_MS = 30000;
const countCache = new Map();

function toPositiveInteger(value, fallback = null) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveDefaultPageSize() {
  const configured = toPositiveInteger(settingService.getValue('app', 'defaultPageSize'), null);
  return configured || 20;
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function normalizePaginationQuery(query = {}) {
  const source = query && typeof query === 'object' ? query : {};
  const page = Math.max(1, toPositiveInteger(source.page, 1) || 1);
  const limit = toPositiveInteger(source.limit, resolveDefaultPageSize()) || resolveDefaultPageSize();
  return { page, limit };
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

function buildCountCacheKey(entityType, normalizedQuery = {}, scope = {}) {
  return JSON.stringify({
    entityType: String(entityType || ''),
    query: normalizedQuery && typeof normalizedQuery === 'object' ? normalizedQuery : {},
    scope: scope && typeof scope === 'object' ? scope : {}
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

function resolveTrackedEntityId(entityType, inputId, resultRow = null) {
  const normalizedType = String(entityType || '').trim();
  if (normalizedType === 'tableSettings') {
    const tableId = toPublicId(resultRow?.tableId || resultRow?.tableKey || '');
    const userId = toPublicId(resultRow?.userId || resultRow?.ownerId || '');
    if (userId && tableId) return `${userId}:${tableId}`;
    return '';
  }

  const fromResult = toPublicId(resultRow?.id || '');
  if (fromResult) return fromResult;
  return toPublicId(inputId);
}

const FETCH_ENTITY_REGISTRY = Object.freeze({
  users: {
    repository: userRepository,
    buildScope: () => ({ canViewAll: true })
  },
  persons: {
    repository: personRepository,
    buildScope: buildPersonScope
  },
  organizations: {
    repository: organizationRepository,
    buildScope: buildOrganizationScope
  },
  contracts: {
    repository: contractRepository,
    buildScope: () => ({ canViewAll: true })
  },
  sections: {
    repository: sectionRepository,
    buildScope: buildSectionScope
  },
  operations: {
    repository: operationRepository,
    buildScope: () => ({ canViewAll: true })
  },
  roles: {
    repository: roleRepository,
    buildScope: () => ({ canViewAll: true })
  },
  scopes: {
    repository: scopeRepository,
    buildScope: () => ({ canViewAll: true })
  },
  accesses: {
    repository: accessRepository,
    buildScope: buildAccessScope
  },
  accessPolicies: {
    repository: accessPolicyRepository,
    buildScope: buildAccessPolicyScope
  },
  logs: {
    repository: logRepository,
    buildScope: () => ({ canViewAll: true })
  },
  tableSettings: {
    repository: tableSettingsRepository,
    buildScope: buildTableSettingsScope
  },
  actionStates: {
    repository: actionStateRepository,
    buildScope: () => ({ canViewAll: true })
  },
  orgPolicies: {
    repository: orgPolicyRepository,
    buildScope: buildOrgPolicyScope
  },
  symbols: {
    repository: symbolRepository,
    buildScope: buildSymbolScope
  },
  sessions: {
    repository: sessionRepository,
    buildScope: buildSessionScope
  },
  news: {
    repository: newsRepository,
    buildScope: buildNewsScope
  },
  contactMessages: {
    repository: contactRepository,
    buildScope: buildContactScope
  },
  newsletter: {
    repository: newsletterRepository,
    buildScope: buildNewsletterScope
  },
  newsletterSubscribers: {
    alias: 'newsletter'
  },
  newsletterSubscriptions: {
    alias: 'newsletter'
  },
  subscriptionGroups: {
    repository: subscriptionGroupRepository,
    buildScope: buildSubscriptionGroupScope
  },
  emailManagementTemplates: {
    repository: emailManagementTemplateRepository,
    buildScope: buildEmailManagementTemplateScope
  },
  userMemberships: {
    repository: userMembershipRepository,
    buildScope: buildUserMembershipScope
  }
});

function resolveFetchEntityConfig(entityType) {
  const baseConfig = FETCH_ENTITY_REGISTRY[String(entityType || '')];
  if (!baseConfig) return null;
  if (baseConfig.alias) return FETCH_ENTITY_REGISTRY[baseConfig.alias] || null;
  return baseConfig;
}

function resolveRepositoryOptions(entityType, repositoryOptions = {}) {
  const safeOptions = { ...(repositoryOptions || {}) };
  if (String(entityType || '') !== 'persons') return safeOptions;

  const incomingEnrichment = (safeOptions.enrichment && typeof safeOptions.enrichment === 'object')
    ? safeOptions.enrichment
    : {};

  safeOptions.enrichment = {
    ...incomingEnrichment,
    includeSchoolRoles: incomingEnrichment.includeSchoolRoles === true
  };
  return safeOptions;
}

const entityGatewayService = {
  async getSectionCategories() {
    if (sectionRepository && typeof sectionRepository.getCategories === 'function') {
      return await sectionRepository.getCategories();
    }
    return Array.isArray(sectionRepository?.VALID_CATEGORIES) ? [...sectionRepository.VALID_CATEGORIES] : [];
  },

  async fetchData(entityType, query, requestingUser, repositoryOptions = {}) {
    const config = resolveFetchEntityConfig(entityType);
    if (!config) throw new Error(`Unknown entity type: ${entityType}`);

    const scope = typeof config.buildScope === 'function'
      ? config.buildScope(requestingUser)
      : { canViewAll: true };

    const normalizedOptions = resolveRepositoryOptions(entityType, repositoryOptions);
    return await config.repository.list({
      ...normalizedOptions,
      query: normalizeQueryOptions(query),
      scope
    });
  },

  async countData(entityType, query, requestingUser, repositoryOptions = {}) {
    const config = resolveFetchEntityConfig(entityType);
    if (!config) throw new Error(`Unknown entity type: ${entityType}`);

    const scope = typeof config.buildScope === 'function'
      ? config.buildScope(requestingUser)
      : { canViewAll: true };
    const normalizedQuery = normalizeQueryOptions(stripPaginationFromQuery(query || {}));
    const normalizedOptions = resolveRepositoryOptions(entityType, repositoryOptions);

    const countCacheKey = buildCountCacheKey(entityType, normalizedQuery, scope);
    const cachedValue = getCachedCountValue(countCacheKey);
    if (cachedValue !== null) return cachedValue;

    let totalRows = 0;
    if (typeof config.repository.count === 'function') {
      totalRows = Number(await config.repository.count({
        ...normalizedOptions,
        query: normalizedQuery,
        scope
      }) || 0);
    } else {
      const rows = await config.repository.list({
        ...normalizedOptions,
        query: normalizedQuery,
        scope
      });
      totalRows = Array.isArray(rows) ? rows.length : 0;
    }

    setCachedCountValue(countCacheKey, totalRows);
    return totalRows;
  },

  async fetchDataPaged(entityType, query, requestingUser, repositoryOptions = {}) {
    const config = resolveFetchEntityConfig(entityType);
    if (!config) throw new Error(`Unknown entity type: ${entityType}`);

    const scope = typeof config.buildScope === 'function'
      ? config.buildScope(requestingUser)
      : { canViewAll: true };
    const normalizedOptions = resolveRepositoryOptions(entityType, repositoryOptions);
    const normalizedQuery = normalizeQueryOptions(query || {});
    const paginationInput = normalizePaginationQuery(normalizedQuery);
    const pageQuery = {
      ...stripPaginationFromQuery(normalizedQuery),
      page: paginationInput.page,
      limit: paginationInput.limit
    };

    const [totalRows, rows] = await Promise.all([
      this.countData(entityType, normalizedQuery, requestingUser, repositoryOptions),
      config.repository.list({
        ...normalizedOptions,
        query: pageQuery,
        scope
      })
    ]);

    return {
      rows: Array.isArray(rows) ? rows : [],
      totalRows,
      pagination: buildPaginationMeta(totalRows, paginationInput.page, paginationInput.limit)
    };
  },

  async addData(entityType, data, requestingUser, options = {}) {
    const auditUser = requestingUser ? requestingUser.id : 'system';
    const trackCreate = async (promise) => {
      const result = await promise;
      recordTransactionOperation(options, {
        type: 'create',
        entityType: String(entityType || ''),
        size: Array.isArray(result) ? result.length : 1,
        id: Array.isArray(result) ? '' : toPublicId(result?.id)
      });
      clearCountCache();

      const normalizedType = String(entityType || '').trim();
      const rows = Array.isArray(result) ? result : [result];
      for (const row of rows) {
        const trackedEntityId = resolveTrackedEntityId(normalizedType, row?.id, row);
        if (!trackedEntityId) continue;
        // eslint-disable-next-line no-await-in-loop
        await actionStateChangeTrackerService.trackCreate({
          source: 'core',
          entityType: normalizedType,
          entityId: trackedEntityId
        });
      }

      return result;
    };

    switch (entityType) {
      case 'users': return await trackCreate(userRepository.create(data, options));
      case 'persons': return await trackCreate(personRepository.create(data, options));
      case 'organizations': return await trackCreate(organizationRepository.create(data, options));
      case 'contracts': return await trackCreate(contractRepository.create(data, options));
      case 'sections': return await trackCreate(sectionRepository.create(data, options));
      case 'operations': return await trackCreate(operationRepository.create(data, options));
      case 'roles': return await trackCreate(roleRepository.create(data, options));
      case 'scopes': return await trackCreate(scopeRepository.create(data, options));
      case 'accesses': return await trackCreate(accessRepository.create(data, options));
      case 'accessPolicies': return await trackCreate(accessPolicyRepository.create(data, options));
      case 'tableSettings': return await trackCreate(tableSettingsRepository.create({ ...data, auditUser }, options));
      case 'logs':
        return await trackCreate(logRepository.create({
          sectionId: data.sectionId,
          operationId: data.operationId,
          user: requestingUser,
          status: data.status,
          details: data.details,
          actionStateId: data.actionStateId || data?.details?.actionStateId || ''
        }, options));
      case 'orgPolicies': return await trackCreate(orgPolicyRepository.create(data, options));
      case 'symbols': return await trackCreate(symbolRepository.create(data, options));
      case 'sessions': return await trackCreate(sessionRepository.create(data, options));
      case 'news': return await trackCreate(newsRepository.create(data, options));
      case 'contactMessages': return await trackCreate(contactRepository.create(data, options));
      case 'newsletter':
      case 'newsletterSubscribers':
      case 'newsletterSubscriptions':
        return await trackCreate(newsletterRepository.create(data, options));
      case 'subscriptionGroups':
        return await trackCreate(subscriptionGroupRepository.create(data, options));
      case 'emailManagementTemplates':
        return await trackCreate(emailManagementTemplateRepository.create(data, options));
      case 'userMemberships':
        return await trackCreate(userMembershipRepository.create(data, options));
      default: throw new Error(`Unknown entity type for add: ${entityType}`);
    }
  },

  async updateData(entityType, id, data, requestingUser, options = {}) {
    const auditUser = requestingUser ? requestingUser.id : 'system';
    const trackUpdate = async (promise) => {
      let beforeSnapshot = null;
      const hasStandardId = id !== null && id !== undefined && typeof id !== 'object';
      if (hasStandardId) {
        try {
          beforeSnapshot = await this.getDataById(entityType, id, requestingUser, options);
        } catch (_) {
          beforeSnapshot = null;
        }
      }

      const result = await promise;
      recordTransactionOperation(options, {
        type: 'update',
        entityType: String(entityType || ''),
        id: toPublicId(id)
      });
      clearCountCache();

      const normalizedType = String(entityType || '').trim();
      const trackedEntityId = resolveTrackedEntityId(normalizedType, id, result);
      if (trackedEntityId && beforeSnapshot && typeof beforeSnapshot === 'object') {
        await actionStateChangeTrackerService.trackUpdate({
          source: 'core',
          entityType: normalizedType,
          entityId: trackedEntityId,
          before: beforeSnapshot,
          after: result || {}
        });
      }

      return result;
    };

    switch (entityType) {
      case 'users': return await trackUpdate(userRepository.update(id, data, options));
      case 'persons': return await trackUpdate(personRepository.update(id, data, options));
      case 'organizations': return await trackUpdate(organizationRepository.update(id, data, options));
      case 'contracts': return await trackUpdate(contractRepository.update(id, data, options));
      case 'sections': return await trackUpdate(sectionRepository.update(id, data, options));
      case 'operations': return await trackUpdate(operationRepository.update(id, data, options));
      case 'roles': return await trackUpdate(roleRepository.update(id, data, options));
      case 'scopes': return await trackUpdate(scopeRepository.update(id, data, options));
      case 'accesses': return await trackUpdate(accessRepository.update(id, data, options));
      case 'accessPolicies': return await trackUpdate(accessPolicyRepository.update(id, data, options));
      case 'tableSettings': return await trackUpdate(tableSettingsRepository.update(null, { ...data, auditUser }, options));
      case 'orgPolicies': return await trackUpdate(orgPolicyRepository.update(id, data, options));
      case 'symbols': return await trackUpdate(symbolRepository.update(id, data, options));
      case 'sessions': return await trackUpdate(sessionRepository.update(id, data, options));
      case 'news': return await trackUpdate(newsRepository.update(id, data, options));
      case 'contactMessages': return await trackUpdate(contactRepository.update(id, { ...data, auditUser }, options));
      case 'newsletter':
      case 'newsletterSubscribers':
      case 'newsletterSubscriptions':
        return await trackUpdate(newsletterRepository.update(id, { ...data, auditUser }, options));
      case 'subscriptionGroups':
        return await trackUpdate(subscriptionGroupRepository.update(id, data, options));
      case 'emailManagementTemplates':
        return await trackUpdate(emailManagementTemplateRepository.update(id, data, options));
      case 'userMemberships':
        return await trackUpdate(userMembershipRepository.update(id, data, options));
      default: throw new Error(`Unknown entity type for update: ${entityType}`);
    }
  },

  async getDataById(entityType, id, requestingUser, repositoryOptions = {}) {
    const normalizedType = String(entityType || '');

    if (normalizedType === 'logs') return null;
    if (normalizedType === 'tableSettings') {
      if (typeof id === 'object' && id.userId && id.tableId) {
        return await tableSettingsRepository.getById(id);
      }
      throw new Error('Invalid ID format for tableSettings.');
    }

    const config = resolveFetchEntityConfig(normalizedType);
    if (!config) throw new Error(`Unknown entity type for ID: ${entityType}`);

    const normalizedId = toPublicId(id);
    if (!normalizedId) return null;

    const scope = typeof config.buildScope === 'function'
      ? config.buildScope(requestingUser)
      : { canViewAll: true };

    const normalizedOptions = resolveRepositoryOptions(normalizedType, repositoryOptions);
    const rows = await config.repository.list({
      ...normalizedOptions,
      query: normalizeQueryOptions({
        id__eq: normalizedId,
        page: 1,
        limit: 1
      }),
      scope
    });

    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  },

  async deleteData(entityType, id, requestingUser, options = {}) {
    const trackDelete = async (promise) => {
      const result = await promise;
      recordTransactionOperation(options, {
        type: 'delete',
        entityType: String(entityType || ''),
        id: typeof id === 'object' ? '' : toPublicId(id)
      });
      clearCountCache();
      return result;
    };

    switch (entityType) {
      case 'users':
        await deleteIntegrityService.assertUserCanBeDeleted(id);
        return await trackDelete(userRepository.remove(id, options));
      case 'persons':
        await deleteIntegrityService.assertPersonCanBeDeleted(id);
        return await trackDelete(personRepository.remove(id, options));
      case 'organizations':
        await deleteIntegrityService.assertOrganizationCanBeDeleted(id);
        return await trackDelete(organizationRepository.remove(id, options));
      case 'contracts': return await trackDelete(contractRepository.remove(id, options));
      case 'sections': return await trackDelete(sectionRepository.remove(id, options));
      case 'operations': return await trackDelete(operationRepository.remove(id, options));
      case 'roles': return await trackDelete(roleRepository.remove(id, options));
      case 'scopes': return await trackDelete(scopeRepository.remove(id, options));
      case 'accesses': return await trackDelete(accessRepository.remove(id, options));
      case 'accessPolicies': return await trackDelete(accessPolicyRepository.remove(id, options));
      case 'logs': return await trackDelete(logRepository.remove(id, options));
      case 'tableSettings':
        if (typeof id === 'object' && id.userId && id.tableId) return await trackDelete(tableSettingsRepository.remove(id, options));
        throw new Error('Invalid ID format.');
      case 'actionStates': return await trackDelete(actionStateRepository.remove(id, options));
      case 'orgPolicies': return await trackDelete(orgPolicyRepository.remove(id, options));
      case 'symbols': return await trackDelete(symbolRepository.remove(id, options));
      case 'sessions': return await trackDelete(sessionRepository.remove(id, options));
      case 'news': return await trackDelete(newsRepository.remove(id, options));
      case 'contactMessages': return await trackDelete(contactRepository.remove(id, options));
      case 'newsletter':
      case 'newsletterSubscribers':
      case 'newsletterSubscriptions':
        return await trackDelete(newsletterRepository.remove(id, options));
      case 'subscriptionGroups':
        return await trackDelete(subscriptionGroupRepository.remove(id, toStorageId(requestingUser?.activeOrgId), options));
      case 'emailManagementTemplates':
        return await trackDelete(emailManagementTemplateRepository.remove(id, options));
      case 'userMemberships':
        return await trackDelete(userMembershipRepository.remove(id, options));
      default: throw new Error(`Unknown entity type for delete: ${entityType}`);
    }
  },

  async deleteAllData(entityType) {
    switch (entityType) {
      case 'logs': return await logRepository.deleteAllLog();
      case 'actionStates': return await actionStateRepository.deleteAllActionStates();
      default: return null;
    }
  }
};

module.exports = entityGatewayService;
