const activityQuotaConsumptionDefinitionRepository = require('../../repositories/activityQuotaConsumptionDefinitionRepository');
const adminChekersService = require('../adminChekersService');
const dataService = require('../dataService');
const activityQuotaLedgerService = require('../activityQuotaLedgerService');
const { normalizeQueryOptions } = require('../../utils/queryOptionsAdapter');
const { resolveEntity } = require('../../utils/entityResolver');
const { applyGenericFilter } = require('../../utils/queryEngine');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');
const { assertCreateOrgContextOrThrow } = require('../../utils/orgContextUtils');
const consumptionDefinitionPolicyService = require('./consumptionDefinitionPolicyService');

const ORGANIZATION_SCOPE_NAMES = new Set(['ADMIN', 'GLOBAL', 'ORGANIZATION', 'ORG']);
const VALID_CONSUME_TIMINGS = new Set(['on_attempt', 'on_success', 'hybrid']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 240, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function cleanDateOnly(value, { allowEmpty = false } = {}) {
  const token = cleanString(value, { max: 20, allowEmpty: true });
  if (!token) return allowEmpty ? '' : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) throw new Error('Date values must use YYYY-MM-DD format.');
  return token;
}

function normalizeMetricValue(value, fallback = 0) {
  if (value === undefined || value === null || value === '') {
    const fallbackNum = Number(fallback || 0);
    return Number.isFinite(fallbackNum) ? Number(fallbackNum.toFixed(6)) : 0;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error('Metric values must be numeric.');
  if (numeric < 0) throw new Error('Metric values must be non-negative.');
  return Number(numeric.toFixed(6));
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const out = { ...query };
  delete out.page;
  delete out.limit;
  return out;
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

function collectUserOrgIds(user = {}) {
  const out = new Set();
  const add = (value) => {
    const id = toPublicId(value);
    if (id) out.add(id);
  };

  add(user?.orgId);
  add(user?.activeOrgId);
  add(user?.primaryOrgId);
  add(user?.creator?.orgId);

  const organizations = Array.isArray(user?.organizations) ? user.organizations : [];
  organizations.forEach((org) => {
    add(org?.orgId);
    add(org?.id);
  });

  const allowedOrgs = Array.isArray(user?.allowedOrgs) ? user.allowedOrgs : [];
  allowedOrgs.forEach((org) => {
    add(org?.orgId);
    add(org?.id);
  });

  return Array.from(out);
}

function userBelongsToOrg(user = {}, orgId = '') {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) return false;
  return collectUserOrgIds(user).some((item) => idsEqual(item, targetOrgId));
}

function resolveActiveOrgId(requestingUser) {
  return toPublicId(requestingUser?.activeOrgId || requestingUser?.primaryOrgId) || '';
}

function resolveRequesterUserId(requestingUser) {
  return toPublicId(requestingUser?.id) || '';
}

async function resolveScopeNameById(scopeIdOrName = '') {
  const token = String(scopeIdOrName || '').trim();
  if (!token) return '';
  const byName = normalizeScopeName(token);
  if (byName) return byName;
  const scopeEntity = await resolveEntity('scopes', token);
  return normalizeScopeName(scopeEntity?.name || '');
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

function isVisibleRow(row, visibility) {
  if (!row) return false;
  if (visibility.mode === 'all') return true;
  if (!idsEqual(row?.orgId, visibility.activeOrgId)) return false;
  if (visibility.mode === 'org') return true;

  const creatorUserId = toPublicId(row?.creator?.userId || row?.audit?.createUser || '');
  return creatorUserId ? idsEqual(creatorUserId, visibility.requesterUserId) : false;
}

function canTargetUserByVisibility(userRow, visibility) {
  if (!visibility || !userRow) return false;
  if (visibility.mode === 'all') return true;
  if (visibility.mode === 'creator') return idsEqual(userRow?.id, visibility.requesterUserId);
  if (visibility.mode === 'org') return userBelongsToOrg(userRow, visibility.activeOrgId);
  return false;
}

function toPickerUser(row = {}, visibility = {}) {
  const id = toPublicId(row?.id || '');
  const username = cleanString(row?.username, { max: 120, allowEmpty: true }) || '';
  const email = cleanString(row?.email, { max: 200, allowEmpty: true }) || '';
  const displayName = cleanString(row?.name, { max: 200, allowEmpty: true })
    || username
    || email
    || id;
  const orgIds = collectUserOrgIds(row);
  const activeOrg = visibility?.activeOrgId && orgIds.find((item) => idsEqual(item, visibility.activeOrgId))
    ? visibility.activeOrgId
    : (orgIds[0] || '');

  return {
    id,
    name: displayName,
    username,
    email,
    orgId: activeOrg,
    organizations: orgIds
  };
}

function toPickerSection(row = {}) {
  const id = cleanString(row?.name || row?.sectionId, { max: 120, allowEmpty: true })
    || toPublicId(row?.id || '');
  return {
    id,
    name: cleanString(row?.name, { max: 200, allowEmpty: true }) || id,
    sectionRefId: toPublicId(row?.id || ''),
    description: cleanString(row?.description, { max: 300, allowEmpty: true }) || '',
    category: cleanString(row?.category, { max: 80, allowEmpty: true }) || '',
    active: row?.active !== false
  };
}

function toPickerOperation(operationRow = {}, sectionRef = {}) {
  const id = cleanString(operationRow?.name || operationRow?.operationId, { max: 120, allowEmpty: true })
    || toPublicId(operationRow?.id || sectionRef?.id || '');
  return {
    id,
    name: cleanString(operationRow?.name, { max: 200, allowEmpty: true }) || id,
    operationRefId: toPublicId(operationRow?.id || sectionRef?.id || ''),
    description: cleanString(operationRow?.description, { max: 300, allowEmpty: true }) || '',
    active: operationRow?.active !== false && sectionRef?.active !== false,
    system: operationRow?.system === true
  };
}

function normalizeSectionKeyFromRow(row = {}) {
  return cleanString(row?.name || row?.sectionId, { max: 120, allowEmpty: true })
    || toPublicId(row?.id || '');
}

function normalizeOperationKeyFromRow(row = {}) {
  return cleanString(row?.name || row?.operationId, { max: 120, allowEmpty: true })
    || toPublicId(row?.id || '');
}

function matchesToken(left, right) {
  const a = cleanString(left, { max: 120, allowEmpty: true });
  const b = cleanString(right, { max: 120, allowEmpty: true });
  if (!a || !b) return false;
  return a.toUpperCase() === b.toUpperCase();
}

function normalizeSectionOperationRefs(section = {}) {
  const refs = Array.isArray(section?.operations) ? section.operations : [];
  return refs.map((ref) => {
    const id = toPublicId(ref?.id || ref);
    if (!id) return null;
    return {
      id,
      active: ref?.active !== false
    };
  }).filter(Boolean);
}

function buildDefinitionSummary(row = {}) {
  const targetUsers = Array.isArray(row?.targetUserIds) ? row.targetUserIds : [];
  return {
    targetUserCount: targetUsers.length,
    hasEventMatch: Boolean(cleanString(row?.sourceEventType, { max: 120, allowEmpty: true })),
    formulaMetrics: ['call', 'amount', 'token', 'volume'].reduce((acc, metric) => {
      const def = isPlainObject(row?.formula?.[metric]) ? row.formula[metric] : {};
      acc[metric] = {
        base: normalizeMetricValue(def.base, 0),
        multiplier: normalizeMetricValue(def.multiplier, 0),
        contextKey: cleanString(def.contextKey, { max: 120, allowEmpty: true }) || ''
      };
      return acc;
    }, {})
  };
}

function sanitizeTargetUserIds(input, fallback = []) {
  const rows = normalizeList(input);
  const source = rows.length ? rows : normalizeList(fallback);
  const set = new Set();
  source.forEach((value) => {
    const id = toPublicId(isPlainObject(value) ? (value.id || value.userId) : value);
    if (id) set.add(id);
  });
  return Array.from(set.values());
}

function sanitizeFormula(input = {}, fallback = {}) {
  const source = isPlainObject(input) ? input : {};
  const baseSource = isPlainObject(fallback) ? fallback : {};
  const out = {};
  ['call', 'amount', 'token', 'volume'].forEach((metric) => {
    const row = isPlainObject(source[metric]) ? source[metric] : {};
    const fallbackRow = isPlainObject(baseSource[metric]) ? baseSource[metric] : {};
    out[metric] = {
      base: normalizeMetricValue(row.base, fallbackRow.base || 0),
      multiplier: normalizeMetricValue(row.multiplier, fallbackRow.multiplier || 0),
      contextKey: cleanString(row.contextKey, { max: 120, allowEmpty: true })
        || cleanString(fallbackRow.contextKey, { max: 120, allowEmpty: true })
        || ''
    };
  });
  return out;
}

function hasPotentialPositiveMetric(formula = {}) {
  return ['call', 'amount', 'token', 'volume'].some((metric) => {
    const row = isPlainObject(formula?.[metric]) ? formula[metric] : {};
    return Number(row.base || 0) > 0 || Number(row.multiplier || 0) > 0;
  });
}

function sanitizePayload(payload = {}, { fallback = null } = {}) {
  const source = isPlainObject(payload) ? payload : {};
  const base = isPlainObject(fallback) ? fallback : {};

  const sectionId = cleanString(source.sectionId || base.sectionId, { max: 120, allowEmpty: true }) || '';
  const operationId = cleanString(source.operationId || base.operationId, { max: 120, allowEmpty: true }) || '';
  const isFallback = normalizeBoolean(source.isFallback, normalizeBoolean(base.isFallback, false));
  const targetUserIds = isFallback
    ? []
    : sanitizeTargetUserIds(source.targetUserIds, base.targetUserIds);
  const sourceEventType = cleanString(source.sourceEventType, { max: 120, allowEmpty: true })
    || cleanString(base.sourceEventType, { max: 120, allowEmpty: true })
    || '';
  if (isFallback && !sourceEventType) {
    throw new Error('Fallback definitions require sourceEventType (event-specific).');
  }

  const consumeTimingRaw = cleanString(source.consumeTiming || base.consumeTiming, { max: 40, allowEmpty: true }).toLowerCase();
  const consumeTiming = VALID_CONSUME_TIMINGS.has(consumeTimingRaw) ? consumeTimingRaw : 'on_attempt';

  const formula = sanitizeFormula(source.formula, base.formula);
  if (!hasPotentialPositiveMetric(formula)) {
    throw new Error('At least one metric formula must have a positive base or multiplier.');
  }

  const validityInput = isPlainObject(source.validity) ? source.validity : {};
  const validityFallback = isPlainObject(base.validity) ? base.validity : {};
  const validityTimezone = cleanString(validityInput.timezone || validityFallback.timezone, { max: 80, allowEmpty: true }) || 'UTC';
  let validity = null;
  if (isFallback) {
    validity = {
      mode: 'always',
      startDate: '',
      endDate: '',
      timezone: validityTimezone
    };
  } else {
    const startDate = cleanDateOnly(validityInput.startDate || validityFallback.startDate, { allowEmpty: false });
    const endDate = cleanDateOnly(validityInput.endDate || validityFallback.endDate, { allowEmpty: false });
    if (endDate < startDate) {
      throw new Error('validity.endDate must be the same day or after validity.startDate.');
    }
    validity = {
      mode: 'date_range',
      startDate,
      endDate,
      timezone: validityTimezone
    };
  }

  return {
    id: toPublicId(source.id || base.id || ''),
    orgId: toPublicId(source.orgId || base.orgId || ''),
    name: cleanString(source.name || base.name, { max: 220, allowEmpty: false }) || '',
    description: cleanString(source.description, { max: 3000, allowEmpty: true })
      || cleanString(base.description, { max: 3000, allowEmpty: true })
      || '',
    active: isFallback ? true : normalizeBoolean(source.active, normalizeBoolean(base.active, true)),
    sectionId,
    operationId,
    sourceEventType,
    targetUserIds,
    isFallback,
    validity,
    consumeTiming,
    formula
  };
}

async function fetchRowsByIds(entityName, ids, requestingUser, options = {}) {
  const uniqueIds = Array.from(new Set(normalizeList(ids).map((value) => toPublicId(value)).filter(Boolean)));
  if (!uniqueIds.length) return [];
  const rows = await dataService.fetchData(entityName, {
    id__in: uniqueIds.join(','),
    limit: uniqueIds.length
  }, requestingUser, options?.backendMode ? { backendMode: options.backendMode } : {});
  return Array.isArray(rows) ? rows : [];
}

async function validateAndHydrateSectionOperation(sectionId, operationId, requestingUser, options = {}) {
  const sectionToken = cleanString(sectionId, { max: 120, allowEmpty: true }) || '';
  const operationToken = cleanString(operationId, { max: 120, allowEmpty: true }) || '';
  if (!sectionToken) throw new Error('sectionId is required.');
  if (!operationToken) throw new Error('operationId is required.');

  const repositoryOptions = options?.backendMode ? { backendMode: options.backendMode } : {};
  const sectionRowsById = await fetchRowsByIds('sections', [toPublicId(sectionToken)], requestingUser, repositoryOptions);
  let section = sectionRowsById.find((row) => idsEqual(row?.id, toPublicId(sectionToken)));
  if (!section) {
    const sectionSearchRows = await dataService.fetchData('sections', {
      name__eq: sectionToken,
      limit: 20
    }, requestingUser, repositoryOptions);
    section = (Array.isArray(sectionSearchRows) ? sectionSearchRows : [])
      .find((row) => matchesToken(normalizeSectionKeyFromRow(row), sectionToken))
      || null;
  }
  if (!section) throw new Error(`Section '${sectionToken}' was not found.`);

  const operationRefs = normalizeSectionOperationRefs(section);
  const allowedIds = new Set(operationRefs.map((row) => row.id).filter(Boolean));
  if (!allowedIds.size) {
    throw new Error(`Section '${normalizeSectionKeyFromRow(section) || sectionToken}' has no linked operations.`);
  }

  const operations = await fetchRowsByIds('operations', Array.from(allowedIds), requestingUser, repositoryOptions);
  const operation = (Array.isArray(operations) ? operations : []).find((row) => (
    matchesToken(row?.id, operationToken)
    || matchesToken(normalizeOperationKeyFromRow(row), operationToken)
  ));
  if (!operation) {
    throw new Error(
      `Operation '${operationToken}' is not linked to section '${normalizeSectionKeyFromRow(section) || sectionToken}'.`
    );
  }

  return {
    sectionId: normalizeSectionKeyFromRow(section),
    operationId: normalizeOperationKeyFromRow(operation)
  };
}

async function validateAndHydrateTargetUsers(targetUserIds, requestingUser, visibility, options = {}) {
  const ids = Array.isArray(targetUserIds) ? targetUserIds : [];
  if (!ids.length) return [];
  const repositoryOptions = options?.backendMode ? { backendMode: options.backendMode } : {};
  const rows = await fetchRowsByIds('users', ids, requestingUser, repositoryOptions);
  const rowMap = new Map(rows.map((row) => [toPublicId(row?.id || ''), row]));
  return ids.map((id) => {
    const row = rowMap.get(id);
    if (!row) throw new Error(`Target user '${id}' was not found.`);
    if (!canTargetUserByVisibility(row, visibility)) {
      throw new Error(`Target user '${id}' is outside your scope.`);
    }
    return id;
  });
}

async function assertFallbackCoverageForKey(definition, definitionIdToExclude = '', options = {}) {
  const sectionId = cleanString(definition?.sectionId, { max: 120, allowEmpty: true }) || '';
  const operationId = cleanString(definition?.operationId, { max: 120, allowEmpty: true }) || '';
  if (!sectionId || !operationId) return;
  const key = `${sectionId}::${operationId}`;
  if (!consumptionDefinitionPolicyService.MIDDLEWARE_ENABLED_KEYS.includes(key)) return;

  const rows = await activityQuotaConsumptionDefinitionRepository.list({
    query: {
      orgId__eq: toPublicId(definition?.orgId || ''),
      sectionId__eq: sectionId,
      operationId__eq: operationId,
      active__eq: true
    },
    scope: { canViewAll: true },
    backendMode: options?.backendMode
  });
  const list = (Array.isArray(rows) ? rows : []).filter((row) => !idsEqual(row?.id, definitionIdToExclude));
  list.push(definition);

  const hasFallback = list.some((row) => {
    const active = normalizeBoolean(row?.active, true);
    const fallback = normalizeBoolean(row?.isFallback, false);
    return active && fallback;
  });
  if (!hasFallback) {
    throw new Error('Each enabled section/operation key must have an active fallback definition.');
  }
}

async function assertSingleActiveFallbackPerEvent(definition, definitionIdToExclude = '', options = {}) {
  const active = normalizeBoolean(definition?.active, true);
  const fallback = normalizeBoolean(definition?.isFallback, false);
  if (!active || !fallback) return;

  const orgId = toPublicId(definition?.orgId || '');
  const sectionId = cleanString(definition?.sectionId, { max: 120, allowEmpty: true }) || '';
  const operationId = cleanString(definition?.operationId, { max: 120, allowEmpty: true }) || '';
  const sourceEventType = cleanString(definition?.sourceEventType, { max: 120, allowEmpty: true }) || '';
  if (!orgId || !sectionId || !operationId || !sourceEventType) return;

  const rows = await activityQuotaConsumptionDefinitionRepository.list({
    query: {
      orgId__eq: orgId,
      sectionId__eq: sectionId,
      operationId__eq: operationId,
      sourceEventType__eq: sourceEventType,
      isFallback__eq: true,
      active__eq: true
    },
    scope: { canViewAll: true },
    backendMode: options?.backendMode
  });
  const conflicts = (Array.isArray(rows) ? rows : []).filter((row) => (
    !idsEqual(row?.id, definitionIdToExclude)
    && !idsEqual(row?.id, definition?.id || '')
  ));
  if (conflicts.length > 0) {
    throw new Error(`Only one active fallback definition is allowed for event '${sourceEventType}'.`);
  }
}

function buildAuditFromCreator(creator = {}, currentAudit = {}, { isUpdate = false } = {}) {
  const nowIso = new Date().toISOString();
  const current = isPlainObject(currentAudit) ? currentAudit : {};
  const creatorUserId = toPublicId(creator?.userId || '');
  const creatorType = cleanString(creator?.type, { max: 20, allowEmpty: true }).toLowerCase() || 'system';
  const fallbackUser = creatorType === 'system' ? 'System' : (creatorUserId || 'System');

  if (!isUpdate) {
    return {
      createUser: fallbackUser,
      createDateTime: nowIso,
      lastUpdateUser: fallbackUser,
      lastUpdateDateTime: nowIso
    };
  }
  return {
    createUser: cleanString(current.createUser, { max: 120, allowEmpty: true }) || fallbackUser,
    createDateTime: cleanString(current.createDateTime, { max: 40, allowEmpty: true }) || nowIso,
    lastUpdateUser: fallbackUser,
    lastUpdateDateTime: nowIso
  };
}

function normalizeEventPickerRows() {
  const defaults = [
    'practice_attempt_started',
    'practice_attempt_reopened',
    'practice_attempts_list_viewed',
    'practice_attempt_detail_viewed',
    {
      id: 'practice_item_scored',
      name: 'Practice item AI scoring and feedback'
    }
  ];
  return defaults.map((row) => {
    const id = typeof row === 'string'
      ? row
      : cleanString(row?.id, { max: 120, allowEmpty: true });
    return {
      id,
      name: typeof row === 'string'
        ? id.replace(/_/g, ' ')
        : (cleanString(row?.name, { max: 200, allowEmpty: true }) || id.replace(/_/g, ' '))
    };
  }).filter((row) => row.id);
}

const consumptionDefinitionDataService = {
  async assertCreateContext(requestingUser) {
    return assertCreateOrgContextOrThrow(requestingUser, { scopeLabel: 'activity quota rules' });
  },

  getFormOptions() {
    return {
      consumeTimings: [
        { value: 'on_attempt', label: 'On Attempt' },
        { value: 'on_success', label: 'On Success' },
        { value: 'hybrid', label: 'Hybrid (Attempt + Success)' }
      ],
      defaults: {
        active: true,
        isFallback: false,
        consumeTiming: 'on_attempt',
        validityMode: 'date_range',
        timezone: 'UTC',
        formula: {
          call: { base: 1, multiplier: 0, contextKey: '' },
          amount: { base: 0, multiplier: 0, contextKey: '' },
          token: { base: 0, multiplier: 0, contextKey: '' },
          volume: { base: 0, multiplier: 1, contextKey: 'questionCount' }
        }
      }
    };
  },

  async listDefinitions(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const normalizedQuery = normalizeQueryOptions(query || {});
    const rows = await activityQuotaConsumptionDefinitionRepository.list({
      query: normalizedQuery,
      scope: buildRepositoryScope(visibility),
      sort: options?.sort || { 'audit.lastUpdateDateTime': -1, id: -1 },
      pagination: options?.pagination || null,
      backendMode: options?.backendMode
    });

    return (Array.isArray(rows) ? rows : [])
      .filter((row) => isVisibleRow(row, visibility))
      .map((row) => ({
        ...row,
        summary: buildDefinitionSummary(row)
      }));
  },

  async getDefinitionById(id, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const row = await activityQuotaConsumptionDefinitionRepository.getById(id, {
      backendMode: options?.backendMode
    });
    if (!row || !isVisibleRow(row, visibility)) return null;
    return {
      ...row,
      summary: buildDefinitionSummary(row)
    };
  },

  async createDefinition(payload = {}, requestingUser, accessContext = {}, options = {}) {
    const activeOrgId = await this.assertCreateContext(requestingUser);
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const sanitized = sanitizePayload(payload, {});
    const matched = await validateAndHydrateSectionOperation(
      sanitized.sectionId,
      sanitized.operationId,
      requestingUser,
      options
    );
    const targetUserIds = await validateAndHydrateTargetUsers(
      sanitized.targetUserIds,
      requestingUser,
      visibility,
      options
    );

    const creator = activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, activeOrgId)
      || activityQuotaLedgerService.createSystemCreatorSnapshot(activeOrgId);
    const audit = buildAuditFromCreator(creator, null, { isUpdate: false });
    const createShape = {
      id: sanitized.id || '',
      orgId: activeOrgId,
      name: sanitized.name,
      description: sanitized.description,
      active: sanitized.active,
      sectionId: matched.sectionId,
      operationId: matched.operationId,
      sourceEventType: sanitized.sourceEventType,
      targetUserIds,
      isFallback: sanitized.isFallback,
      validity: sanitized.validity,
      consumeTiming: sanitized.consumeTiming,
      formula: sanitized.formula,
      creator,
      audit
    };

    await assertSingleActiveFallbackPerEvent(createShape, '', options);

    const row = await activityQuotaConsumptionDefinitionRepository.create(createShape, {
      backendMode: options?.backendMode
    });

    await assertFallbackCoverageForKey(row, '', options);
    return row;
  },

  async updateDefinition(id, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getDefinitionById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('Consumption definition not found or inaccessible.');

    const activeOrgId = await this.assertCreateContext(requestingUser);
    if (!adminChekersService.isSuperAdmin(requestingUser) && !idsEqual(existing.orgId, activeOrgId)) {
      throw new Error('Active organization does not match this consumption definition.');
    }

    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const sanitized = sanitizePayload(payload, { fallback: existing });
    const matched = await validateAndHydrateSectionOperation(
      sanitized.sectionId,
      sanitized.operationId,
      requestingUser,
      options
    );
    const targetUserIds = await validateAndHydrateTargetUsers(
      sanitized.targetUserIds,
      requestingUser,
      visibility,
      options
    );

    const creator = isPlainObject(existing.creator)
      ? { ...existing.creator }
      : (activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, existing.orgId)
        || activityQuotaLedgerService.createSystemCreatorSnapshot(existing.orgId));
    const audit = buildAuditFromCreator(creator, existing.audit || {}, { isUpdate: true });

    const nextShape = {
      orgId: existing.orgId,
      name: sanitized.name,
      description: sanitized.description,
      active: sanitized.active,
      sectionId: matched.sectionId,
      operationId: matched.operationId,
      sourceEventType: sanitized.sourceEventType,
      targetUserIds,
      isFallback: sanitized.isFallback,
      validity: sanitized.validity,
      consumeTiming: sanitized.consumeTiming,
      formula: sanitized.formula,
      creator,
      audit
    };

    await assertSingleActiveFallbackPerEvent({
      ...existing,
      ...nextShape,
      id: existing.id
    }, existing.id, options);

    const updated = await activityQuotaConsumptionDefinitionRepository.update(existing.id, nextShape, {
      backendMode: options?.backendMode
    });

    await assertFallbackCoverageForKey(updated, existing.id, options);
    return updated;
  },

  async deleteDefinition(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getDefinitionById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('Consumption definition not found or inaccessible.');
    const key = `${cleanString(existing.sectionId, { max: 120, allowEmpty: true }) || ''}::${cleanString(existing.operationId, { max: 120, allowEmpty: true }) || ''}`;
    const isEnabledKey = consumptionDefinitionPolicyService.MIDDLEWARE_ENABLED_KEYS.includes(key);
    if (isEnabledKey && normalizeBoolean(existing.active, true) && normalizeBoolean(existing.isFallback, false)) {
      const siblingRows = await activityQuotaConsumptionDefinitionRepository.list({
        query: {
          orgId__eq: toPublicId(existing.orgId || ''),
          sectionId__eq: cleanString(existing.sectionId, { max: 120, allowEmpty: true }) || '',
          operationId__eq: cleanString(existing.operationId, { max: 120, allowEmpty: true }) || '',
          isFallback__eq: true,
          active__eq: true
        },
        scope: { canViewAll: true },
        backendMode: options?.backendMode
      });
      const fallbackCountExcludingCurrent = (Array.isArray(siblingRows) ? siblingRows : [])
        .filter((row) => !idsEqual(row?.id, existing.id))
        .length;
      if (fallbackCountExcludingCurrent <= 0) {
        throw new Error('Cannot delete the only active fallback definition for this enabled section/operation key.');
      }
    }
    const result = await activityQuotaConsumptionDefinitionRepository.remove(existing.id, {
      backendMode: options?.backendMode
    });
    return result === true || Number(result?.deletedCount || 0) > 0;
  },

  async listPickerUsers(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const normalizedQuery = normalizeQueryOptions(stripPaginationFromQuery(query));
    const repositoryOptions = options?.backendMode ? { backendMode: options.backendMode } : {};
    const rows = await dataService.fetchData('users', {
      ...normalizedQuery,
      limit: Math.max(Number(normalizedQuery.limit || 0) || 0, 500)
    }, requestingUser, repositoryOptions);

    return (Array.isArray(rows) ? rows : [])
      .filter((row) => canTargetUserByVisibility(row, visibility))
      .map((row) => toPickerUser(row, visibility));
  },

  async listPickerSections(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const normalizedQuery = normalizeQueryOptions(stripPaginationFromQuery(query));
    const repositoryOptions = options?.backendMode ? { backendMode: options.backendMode } : {};
    const rows = await dataService.fetchData('sections', {
      ...normalizedQuery,
      limit: Math.max(Number(normalizedQuery.limit || 0) || 0, 1000)
    }, requestingUser, repositoryOptions);
    return (Array.isArray(rows) ? rows : []).map((row) => toPickerSection(row));
  },

  async listPickerOperationsForSection(sectionId, query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const sectionToken = cleanString(sectionId, { max: 120, allowEmpty: true }) || '';
    if (!sectionToken) return [];

    const repositoryOptions = options?.backendMode ? { backendMode: options.backendMode } : {};
    const sectionsById = await fetchRowsByIds('sections', [toPublicId(sectionToken)], requestingUser, repositoryOptions);
    let section = sectionsById.find((row) => idsEqual(row?.id, toPublicId(sectionToken)));
    if (!section) {
      const sectionSearchRows = await dataService.fetchData('sections', {
        name__eq: sectionToken,
        limit: 20
      }, requestingUser, repositoryOptions);
      section = (Array.isArray(sectionSearchRows) ? sectionSearchRows : [])
        .find((row) => matchesToken(normalizeSectionKeyFromRow(row), sectionToken))
        || null;
    }
    if (!section) return [];

    const sectionRefs = normalizeSectionOperationRefs(section);
    if (!sectionRefs.length) return [];

    const operationRows = await fetchRowsByIds(
      'operations',
      sectionRefs.map((ref) => ref.id),
      requestingUser,
      repositoryOptions
    );
    const operationMap = new Map(operationRows.map((row) => [toPublicId(row?.id || ''), row]));
    const scopedRows = sectionRefs
      .map((ref) => toPickerOperation(operationMap.get(ref.id) || { id: ref.id }, ref))
      .filter(Boolean);

    const searchQuery = normalizeQueryOptions(stripPaginationFromQuery(query));
    return applyGenericFilter(scopedRows, searchQuery, {
      defaultSearchFields: ['id', 'name', 'description'],
      dateFields: []
    });
  },

  async listPickerEventTypes(query = {}, requestingUser, accessContext = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const normalizedQuery = normalizeQueryOptions(stripPaginationFromQuery(query));
    const rows = normalizeEventPickerRows();
    return applyGenericFilter(rows, normalizedQuery, {
      defaultSearchFields: ['id', 'name'],
      dateFields: []
    });
  }
};

module.exports = consumptionDefinitionDataService;
