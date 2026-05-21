const activityQuotaLedgerRepository = require('../../repositories/activityQuotaLedgerRepository');
const activityQuotaCreditGroupRepository = require('../../repositories/activityQuotaCreditGroupRepository');
const activityQuotaLedgerService = require('../activityQuotaLedgerService');
const adminChekersService = require('../adminChekersService');
const dataService = require('../dataService');
const { normalizeQueryOptions } = require('../../utils/queryOptionsAdapter');
const { resolveEntity } = require('../../utils/entityResolver');
const { applyGenericFilter } = require('../../utils/queryEngine');
const { idsEqual, toPublicId, toIdArray } = require('../../utils/idAdapter');
const { assertCreateOrgContextOrThrow } = require('../../utils/orgContextUtils');

const DEFAULT_SECTION = 'ACTIVITY_QUOTA';
const DEFAULT_OPERATION = 'CONFIGURE';
const DEFAULT_SOURCE = Object.freeze({
  module: 'activity_quota_add_credit',
  eventType: 'manual_credit'
});
const ORGANIZATION_SCOPE_NAMES = new Set(['ADMIN', 'GLOBAL', 'ORGANIZATION', 'ORG']);
const SOURCE_MODE_VALUES = Object.freeze({
  AUTO: 'auto',
  CUSTOM: 'custom'
});
const SOURCE_MODULE_OPTIONS = Object.freeze([
  { value: 'activity_quota_add_credit', label: 'Activity Quota Add Credit' },
  { value: 'activity_quota_rules', label: 'Activity Quota Rules' },
  { value: 'activity_quota_package', label: 'Activity Quota Package Allocation' },
  { value: 'activity_quota_adjustment', label: 'Activity Quota Manual Adjustment' }
]);
const SOURCE_EVENT_TYPE_OPTIONS = Object.freeze([
  { value: 'manual_credit', label: 'Manual Credit' },
  { value: 'package_credit', label: 'Package Credit Allocation' },
  { value: 'promo_credit', label: 'Promotional Credit' },
  { value: 'admin_adjustment', label: 'Administrative Adjustment' }
]);
const SOURCE_EVENT_ID_MODE_OPTIONS = Object.freeze([
  { value: SOURCE_MODE_VALUES.AUTO, label: 'Auto Generate' },
  { value: SOURCE_MODE_VALUES.CUSTOM, label: 'Custom Event ID' }
]);
const SOURCE_IDEMPOTENCY_MODE_OPTIONS = Object.freeze([
  { value: SOURCE_MODE_VALUES.AUTO, label: 'Auto (No Explicit Key)' },
  { value: SOURCE_MODE_VALUES.CUSTOM, label: 'Custom Idempotency Key' }
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 180, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeIsoDateTime(value, fallbackIso) {
  const token = cleanString(value, { max: 80, allowEmpty: true });
  if (!token) return String(fallbackIso || new Date().toISOString());
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid datetime value.');
  return parsed.toISOString();
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

function hasAnyCreditValue(metrics = {}) {
  return ['call', 'amount', 'token', 'volume'].some((field) => Number(metrics[field] || 0) > 0);
}

function resolveActiveOrgId(requestingUser) {
  return toPublicId(requestingUser?.activeOrgId || requestingUser?.primaryOrgId) || '';
}

function resolveRequesterUserId(requestingUser) {
  return toPublicId(requestingUser?.id) || '';
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

function normalizeSourceMode(value, fallback = SOURCE_MODE_VALUES.AUTO) {
  const token = String(value || '').trim().toLowerCase();
  if (token === SOURCE_MODE_VALUES.CUSTOM) return SOURCE_MODE_VALUES.CUSTOM;
  return fallback;
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const out = { ...query };
  delete out.page;
  delete out.limit;
  return out;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
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

function normalizeSectionOperationRefs(section = {}) {
  const refs = Array.isArray(section?.operations) ? section.operations : [];
  return refs.map((ref) => {
    const id = toPublicId(ref?.id || ref);
    if (!id) return null;
    return {
      id,
      sessionAttempts: Number(ref?.sessionAttempts || 0),
      sessionTime: Number(ref?.sessionTime || 0),
      active: ref?.active !== false
    };
  }).filter(Boolean);
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
  const id = toPublicId(row?.id || '');
  return {
    id,
    name: cleanString(row?.name, { max: 200, allowEmpty: true }) || id,
    description: cleanString(row?.description, { max: 300, allowEmpty: true }) || '',
    category: cleanString(row?.category, { max: 80, allowEmpty: true }) || '',
    active: row?.active !== false
  };
}

function toPickerOperation(operationRow = {}, sectionRef = {}) {
  const id = toPublicId(operationRow?.id || sectionRef?.id || '');
  return {
    id,
    name: cleanString(operationRow?.name, { max: 200, allowEmpty: true }) || id,
    description: cleanString(operationRow?.description, { max: 300, allowEmpty: true }) || '',
    active: operationRow?.active !== false && sectionRef?.active !== false,
    system: operationRow?.system === true,
    defaults: {
      sessionAttempts: Number(sectionRef?.sessionAttempts || 0),
      sessionTime: Number(sectionRef?.sessionTime || 0)
    }
  };
}

function composeLabel(name, id) {
  const cleanId = toPublicId(id);
  const cleanName = cleanString(name, { max: 180, allowEmpty: true }) || '';
  if (cleanName && cleanId) return `${cleanName} (${cleanId})`;
  return cleanName || cleanId || '-';
}

function buildGroupSummary(group = {}) {
  const users = Array.isArray(group?.users) ? group.users : [];
  const sections = Array.isArray(group?.sections) ? group.sections : [];
  let operationCount = 0;
  sections.forEach((section) => {
    operationCount += Array.isArray(section?.operations) ? section.operations.length : 0;
  });
  const ledgerEntryIds = Array.isArray(group?.ledgerEntryIds) ? group.ledgerEntryIds : [];
  return {
    userCount: users.length,
    sectionCount: sections.length,
    operationCount,
    ledgerEntryCount: ledgerEntryIds.length
  };
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

function buildGroupScope(visibility) {
  if (!visibility || visibility.mode === 'all') return { canViewAll: true };
  const out = {
    canViewAll: false,
    orgId: visibility.activeOrgId
  };
  if (visibility.mode === 'creator') {
    out.userId = visibility.requesterUserId;
  }
  return out;
}

function isCreditEntry(row) {
  return String(row?.entryType || '').trim().toLowerCase() === 'credit';
}

function isVisibleCreditRow(row, visibility) {
  if (!row || !isCreditEntry(row)) return false;
  if (visibility.mode === 'all') return true;
  if (!idsEqual(row?.orgId, visibility.activeOrgId)) return false;
  if (visibility.mode === 'org') return true;

  const creatorUserId = toPublicId(row?.creator?.userId || row?.audit?.createUser) || '';
  return creatorUserId ? idsEqual(creatorUserId, visibility.requesterUserId) : false;
}

function isVisibleGroupRecord(row, visibility) {
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

  if (visibility.mode === 'creator') {
    return idsEqual(userRow?.id, visibility.requesterUserId);
  }

  if (visibility.mode === 'org') {
    return userBelongsToOrg(userRow, visibility.activeOrgId);
  }

  return false;
}

function buildScopedListQuery(query = {}, visibility) {
  const normalized = normalizeQueryOptions(query || {});
  const out = {
    ...normalized,
    entryType__eq: 'credit'
  };
  delete out.entryType;

  if (visibility.mode === 'org' || visibility.mode === 'creator') {
    out.orgId__eq = visibility.activeOrgId;
  }
  if (visibility.mode === 'creator') {
    out['creator.userId__eq'] = visibility.requesterUserId;
  }
  return out;
}

function sanitizeSourcePayload(input = {}, fallback = {}) {
  const sourceInput = input && typeof input === 'object' ? input : {};
  const sourceFallback = fallback && typeof fallback === 'object' ? fallback : {};
  return {
    module: cleanString(sourceInput.module, { max: 80, allowEmpty: true })
      || cleanString(sourceFallback.module, { max: 80, allowEmpty: true })
      || DEFAULT_SOURCE.module,
    eventType: cleanString(sourceInput.eventType, { max: 80, allowEmpty: true })
      || cleanString(sourceFallback.eventType, { max: 80, allowEmpty: true })
      || DEFAULT_SOURCE.eventType,
    eventId: cleanString(sourceInput.eventId, { max: 180, allowEmpty: true })
      || cleanString(sourceFallback.eventId, { max: 180, allowEmpty: true })
      || `AQL-ADD-${Date.now()}`,
    idempotencyKey: cleanString(sourceInput.idempotencyKey, { max: 220, allowEmpty: true })
      || cleanString(sourceFallback.idempotencyKey, { max: 220, allowEmpty: true })
      || ''
  };
}

function normalizeValidityPayload(input = {}, fallback = {}) {
  const source = isPlainObject(input) ? input : {};
  const base = isPlainObject(fallback) ? fallback : {};
  const modeToken = cleanString(source.mode || base.mode, { max: 30, allowEmpty: true }).toLowerCase();
  const startDate = cleanString(source.startDate ?? base.startDate, { max: 20, allowEmpty: true }) || '';
  const endDate = cleanString(source.endDate ?? base.endDate, { max: 20, allowEmpty: true }) || '';
  const timezone = cleanString(source.timezone ?? base.timezone, { max: 80, allowEmpty: true }) || '';
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('validity dates must be in YYYY-MM-DD format.');
  }
  if (endDate < startDate) {
    throw new Error('validity.endDate must be on or after validity.startDate.');
  }
  return {
    mode: 'date_range',
    startDate,
    endDate,
    timezone
  };
}

function buildQuotaKeyFilterFromEntry(entry = {}) {
  return {
    orgId: toPublicId(entry?.orgId || ''),
    userId: toPublicId(entry?.userId || ''),
    section: cleanString(entry?.section, { max: 120, allowEmpty: true }) || '',
    operation: cleanString(entry?.operation, { max: 120, allowEmpty: true }) || ''
  };
}

function collectQuotaKeyFiltersFromGroup(group = {}) {
  const out = [];
  const orgId = toPublicId(group?.orgId || '');
  const users = Array.isArray(group?.users) ? group.users : [];
  const sections = Array.isArray(group?.sections) ? group.sections : [];
  users.forEach((user) => {
    const userId = toPublicId(user?.id || user?.userId || '');
    if (!userId) return;
    sections.forEach((section) => {
      const sectionId = cleanString(section?.name || section?.id || section?.sectionId, { max: 120, allowEmpty: true }) || '';
      const operations = Array.isArray(section?.operations) ? section.operations : [];
      operations.forEach((operation) => {
        const operationId = cleanString(operation?.name || operation?.id || operation?.operationId, { max: 120, allowEmpty: true }) || '';
        if (!orgId || !userId || !sectionId || !operationId) return;
        out.push({
          orgId,
          userId,
          section: sectionId,
          operation: operationId
        });
      });
    });
  });
  return out;
}

function sanitizeCreditPayload(payload = {}, options = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const fallback = options?.fallback && typeof options.fallback === 'object'
    ? options.fallback
    : {};

  const userId = toPublicId(source.userId || fallback.userId || '');
  if (!userId) throw new Error('Target userId is required.');

  const section = cleanString(source.section, { max: 120, allowEmpty: true })
    || cleanString(fallback.section, { max: 120, allowEmpty: true })
    || DEFAULT_SECTION;
  const operation = cleanString(source.operation, { max: 120, allowEmpty: true })
    || cleanString(fallback.operation, { max: 120, allowEmpty: true })
    || DEFAULT_OPERATION;

  const metrics = {
    call: normalizeMetricValue(source.call, fallback.call || 0),
    amount: normalizeMetricValue(source.amount, fallback.amount || 0),
    token: normalizeMetricValue(source.token, fallback.token || 0),
    volume: normalizeMetricValue(source.volume, fallback.volume || 0)
  };
  if (!hasAnyCreditValue(metrics)) {
    throw new Error('At least one credit metric (call, amount, token, volume) must be greater than zero.');
  }

  const dateTime = normalizeIsoDateTime(source.dateTime, fallback.dateTime || new Date().toISOString());
  const sourcePayload = sanitizeSourcePayload(source.source || source, fallback.source || {});
  const validity = normalizeValidityPayload(source.validity || {}, fallback.validity || {});

  return {
    userId,
    section,
    operation,
    dateTime,
    ...metrics,
    source: sourcePayload,
    validity
  };
}

function sanitizeSourcePlanPayload(rawSource = {}) {
  const source = isPlainObject(rawSource) ? rawSource : {};
  const modeFromRoot = normalizeSourceMode(source.sourceMode, SOURCE_MODE_VALUES.AUTO);
  return {
    module: cleanString(source.module, { max: 80, allowEmpty: true }) || DEFAULT_SOURCE.module,
    eventType: cleanString(source.eventType, { max: 80, allowEmpty: true }) || DEFAULT_SOURCE.eventType,
    eventId: cleanString(source.eventId, { max: 180, allowEmpty: true }) || '',
    idempotencyKey: cleanString(source.idempotencyKey, { max: 220, allowEmpty: true }) || '',
    eventIdMode: normalizeSourceMode(source.eventIdMode, modeFromRoot),
    idempotencyMode: normalizeSourceMode(source.idempotencyMode, modeFromRoot)
  };
}

function sanitizeUserTargets(rawUsers = []) {
  const unique = new Map();
  normalizeList(rawUsers).forEach((rawItem) => {
    const item = isPlainObject(rawItem) ? rawItem : { id: rawItem };
    const id = toPublicId(item.id || item.userId || '');
    if (!id) return;
    unique.set(id, {
      id,
      name: cleanString(item.name, { max: 180, allowEmpty: true }) || '',
      username: cleanString(item.username, { max: 120, allowEmpty: true }) || '',
      email: cleanString(item.email, { max: 200, allowEmpty: true }) || ''
    });
  });
  const out = Array.from(unique.values());
  if (!out.length) throw new Error('Select at least one target user.');
  return out;
}

function sanitizeOperationTargets(rawOperations = []) {
  const unique = new Map();
  normalizeList(rawOperations).forEach((rawOperation) => {
    const op = isPlainObject(rawOperation) ? rawOperation : { id: rawOperation };
    const id = toPublicId(op.id || op.operationId || '');
    if (!id) return;
    const metrics = {
      call: normalizeMetricValue(op.call, 0),
      amount: normalizeMetricValue(op.amount, 0),
      token: normalizeMetricValue(op.token, 0),
      volume: normalizeMetricValue(op.volume, 0)
    };
    if (!hasAnyCreditValue(metrics)) {
      throw new Error(`Operation '${id}' must include at least one positive metric value.`);
    }
    unique.set(id, {
      id,
      name: cleanString(op.name, { max: 120, allowEmpty: true }) || '',
      ...metrics
    });
  });
  const out = Array.from(unique.values());
  if (!out.length) throw new Error('Each section must include at least one operation.');
  return out;
}

function sanitizeSectionTargets(rawSections = []) {
  const unique = new Map();
  normalizeList(rawSections).forEach((rawSection) => {
    const section = isPlainObject(rawSection) ? rawSection : { id: rawSection };
    const id = toPublicId(section.id || section.sectionId || '');
    if (!id) return;
    const operations = sanitizeOperationTargets(section.operations || []);
    unique.set(id, {
      id,
      name: cleanString(section.name, { max: 120, allowEmpty: true }) || '',
      operations
    });
  });
  const out = Array.from(unique.values());
  if (!out.length) throw new Error('Select at least one section.');
  return out;
}

function normalizeGroupPlanPayload(payload = {}) {
  const source = isPlainObject(payload) ? payload : {};
  const users = sanitizeUserTargets(source.users || []);
  const sections = sanitizeSectionTargets(source.sections || []);
  const sourcePlan = sanitizeSourcePlanPayload(source.source || source);
  const dateTime = normalizeIsoDateTime(source.dateTime, new Date().toISOString());
  const operationCount = sections.reduce((sum, section) => {
    return sum + (Array.isArray(section.operations) ? section.operations.length : 0);
  }, 0);
  const totalRows = users.length * operationCount;
  if (totalRows <= 0) throw new Error('No credit rows were generated from the selected plan.');
  return {
    dateTime,
    users,
    sections,
    source: sourcePlan,
    operationCount,
    totalRows
  };
}

function shouldCreateGroupRecord(plan = {}) {
  if (!plan || typeof plan !== 'object') return false;
  return Number(plan.users?.length || 0) > 1
    || Number(plan.sections?.length || 0) > 1
    || Number(plan.operationCount || 0) > 1;
}

function buildLastUpdateUser(requestingUser, existingRow) {
  if (requestingUser === null || requestingUser === undefined) {
    return cleanString(existingRow?.audit?.lastUpdateUser, { max: 120, allowEmpty: true }) || 'System';
  }
  const userId = resolveRequesterUserId(requestingUser);
  return userId || 'System';
}

function buildAuditFromCreator(creator, existingAudit = null) {
  const nowIso = new Date().toISOString();
  const createUser = creator?.type === 'system'
    ? 'System'
    : (toPublicId(creator?.userId || '') || 'System');

  if (existingAudit && typeof existingAudit === 'object') {
    return {
      createUser: cleanString(existingAudit.createUser, { max: 120, allowEmpty: true }) || createUser,
      createDateTime: normalizeIsoDateTime(existingAudit.createDateTime, nowIso),
      lastUpdateUser: createUser,
      lastUpdateDateTime: nowIso
    };
  }

  return {
    createUser,
    createDateTime: nowIso,
    lastUpdateUser: createUser,
    lastUpdateDateTime: nowIso
  };
}

async function fetchRowsByIds(entityType, ids, requestingUser, options = {}) {
  const normalizedIds = toIdArray(ids || []);
  if (!normalizedIds.length) return [];

  const repositoryOptions = options?.backendMode ? { backendMode: options.backendMode } : {};
  const rows = await dataService.fetchData(entityType, {
    id__in: normalizedIds.join(','),
    page: 1,
    limit: Math.max(500, normalizedIds.length * 4)
  }, requestingUser, repositoryOptions);

  const byId = new Map((Array.isArray(rows) ? rows : [])
    .map((row) => [toPublicId(row?.id || ''), row]));

  for (const id of normalizedIds) {
    if (byId.has(id)) continue;
    // eslint-disable-next-line no-await-in-loop
    const row = await dataService.getDataById(entityType, id, requestingUser, repositoryOptions);
    if (row) byId.set(id, row);
  }

  return Array.from(byId.values());
}

async function validatePlanAgainstSystem(plan, requestingUser, visibility, options = {}) {
  const repositoryOptions = options?.backendMode ? { backendMode: options.backendMode } : {};
  const userRows = await fetchRowsByIds(
    'users',
    plan.users.map((user) => user.id),
    requestingUser,
    repositoryOptions
  );
  const userMap = new Map(userRows.map((row) => [toPublicId(row?.id || ''), row]));

  plan.users.forEach((targetUser) => {
    const row = userMap.get(targetUser.id);
    if (!row) {
      throw new Error(`Target user '${targetUser.id}' is not found or inaccessible.`);
    }
    if (!canTargetUserByVisibility(row, visibility)) {
      throw new Error(`You do not have permission to allocate credit for user '${targetUser.id}'.`);
    }
  });

  const sectionRows = await fetchRowsByIds(
    'sections',
    plan.sections.map((section) => section.id),
    requestingUser,
    repositoryOptions
  );
  const sectionMap = new Map(sectionRows.map((row) => [toPublicId(row?.id || ''), row]));
  const sectionRefMap = new Map();
  const requiredOperationIds = new Set();

  plan.sections.forEach((sectionPlan) => {
    const sectionRow = sectionMap.get(sectionPlan.id);
    if (!sectionRow) {
      throw new Error(`Section '${sectionPlan.id}' is not found or inaccessible.`);
    }
    const refs = normalizeSectionOperationRefs(sectionRow);
    const refMap = new Map(refs.map((ref) => [ref.id, ref]));
    sectionPlan.operations.forEach((operationPlan) => {
      if (!refMap.has(operationPlan.id)) {
        throw new Error(`Operation '${operationPlan.id}' is not registered under section '${sectionPlan.id}'.`);
      }
      requiredOperationIds.add(operationPlan.id);
    });
    sectionRefMap.set(sectionPlan.id, refMap);
  });

  const operationRows = await fetchRowsByIds(
    'operations',
    Array.from(requiredOperationIds),
    requestingUser,
    repositoryOptions
  );
  const operationMap = new Map(operationRows.map((row) => [toPublicId(row?.id || ''), row]));

  requiredOperationIds.forEach((operationId) => {
    if (!operationMap.has(operationId)) {
      throw new Error(`Operation '${operationId}' is not found or inaccessible.`);
    }
  });

  const normalizedUsers = plan.users.map((targetUser) => {
    const row = userMap.get(targetUser.id) || {};
    const displayName = cleanString(row?.name, { max: 180, allowEmpty: true })
      || cleanString(row?.username, { max: 120, allowEmpty: true })
      || cleanString(row?.email, { max: 200, allowEmpty: true })
      || targetUser.id;
    return {
      id: targetUser.id,
      name: targetUser.name || displayName,
      username: targetUser.username || cleanString(row?.username, { max: 120, allowEmpty: true }) || '',
      email: targetUser.email || cleanString(row?.email, { max: 200, allowEmpty: true }) || ''
    };
  });

  const normalizedSections = plan.sections.map((sectionPlan) => {
    const sectionRow = sectionMap.get(sectionPlan.id);
    return {
      id: sectionPlan.id,
      name: sectionPlan.name || cleanString(sectionRow?.name, { max: 120, allowEmpty: true }) || sectionPlan.id,
      operations: sectionPlan.operations.map((operationPlan) => {
        const operationRow = operationMap.get(operationPlan.id);
        return {
          ...operationPlan,
          name: operationPlan.name
            || cleanString(operationRow?.name, { max: 120, allowEmpty: true })
            || operationPlan.id
        };
      })
    };
  });

  return {
    users: normalizedUsers,
    sections: normalizedSections
  };
}

function buildRowSourceFromPlan(sourcePlan, rowIndex, totalRows) {
  const fallbackEventIdBase = `AQL-ADD-${Date.now()}`;
  const eventIdBase = cleanString(sourcePlan.eventId, { max: 180, allowEmpty: true }) || fallbackEventIdBase;
  const eventId = sourcePlan.eventIdMode === SOURCE_MODE_VALUES.CUSTOM
    ? eventIdBase
    : `${eventIdBase}-${String(rowIndex + 1).padStart(4, '0')}`;

  let idempotencyKey = '';
  if (sourcePlan.idempotencyMode === SOURCE_MODE_VALUES.CUSTOM) {
    const baseKey = cleanString(sourcePlan.idempotencyKey, { max: 220, allowEmpty: true }) || '';
    if (baseKey) {
      idempotencyKey = totalRows > 1 ? `${baseKey}:${rowIndex + 1}` : baseKey;
    }
  }

  return sanitizeSourcePayload({
    module: sourcePlan.module,
    eventType: sourcePlan.eventType,
    eventId,
    idempotencyKey
  }, DEFAULT_SOURCE);
}

function cloneOptionRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((item) => ({
    value: cleanString(item?.value, { max: 120, allowEmpty: true }) || '',
    label: cleanString(item?.label, { max: 180, allowEmpty: true }) || ''
  }));
}

async function buildEntryGroupMap(rows, visibility, options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return new Map();

  const entryIdSet = new Set(list.map((row) => toPublicId(row?.id || '')).filter(Boolean));
  if (!entryIdSet.size) return new Map();

  const groups = await activityQuotaCreditGroupRepository.list({
    query: {},
    scope: buildGroupScope(visibility),
    sort: { dateTime: -1, id: -1 },
    backendMode: options?.backendMode
  });

  const map = new Map();
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    const ledgerEntryIds = Array.isArray(group?.ledgerEntryIds) ? group.ledgerEntryIds : [];
    ledgerEntryIds.forEach((entryIdRaw) => {
      const entryId = toPublicId(entryIdRaw);
      if (!entryId || !entryIdSet.has(entryId) || map.has(entryId)) return;
      map.set(entryId, {
        id: toPublicId(group?.id || ''),
        summary: buildGroupSummary(group)
      });
    });
  });

  return map;
}

async function enrichCreditRows(rows, requestingUser, visibility, options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;

  const userIds = toIdArray(list.map((row) => row?.userId));
  const sectionIds = toIdArray(list.map((row) => row?.section));
  const operationIds = toIdArray(list.map((row) => row?.operation));

  const [userRows, sectionRows, operationRows, groupMap] = await Promise.all([
    fetchRowsByIds('users', userIds, requestingUser, options),
    fetchRowsByIds('sections', sectionIds, requestingUser, options),
    fetchRowsByIds('operations', operationIds, requestingUser, options),
    buildEntryGroupMap(list, visibility, options)
  ]);

  const userMap = new Map((Array.isArray(userRows) ? userRows : []).map((row) => [toPublicId(row?.id || ''), row]));
  const sectionMap = new Map((Array.isArray(sectionRows) ? sectionRows : []).map((row) => [toPublicId(row?.id || ''), row]));
  const operationMap = new Map((Array.isArray(operationRows) ? operationRows : []).map((row) => [toPublicId(row?.id || ''), row]));

  return list.map((row) => {
    const userId = toPublicId(row?.userId || '');
    const sectionId = toPublicId(row?.section || '');
    const operationId = toPublicId(row?.operation || '');

    const userEntity = userMap.get(userId) || null;
    const sectionEntity = sectionMap.get(sectionId) || null;
    const operationEntity = operationMap.get(operationId) || null;

    const userName = cleanString(userEntity?.name, { max: 180, allowEmpty: true })
      || cleanString(userEntity?.username, { max: 120, allowEmpty: true })
      || cleanString(userEntity?.email, { max: 200, allowEmpty: true })
      || '';
    const sectionName = cleanString(sectionEntity?.name, { max: 180, allowEmpty: true }) || '';
    const operationName = cleanString(operationEntity?.name, { max: 180, allowEmpty: true }) || '';

    const enriched = {
      ...row,
      display: {
        userName,
        userLabel: composeLabel(userName, userId),
        sectionName,
        sectionLabel: composeLabel(sectionName, sectionId),
        operationName,
        operationLabel: composeLabel(operationName, operationId)
      }
    };

    const groupInfo = groupMap.get(toPublicId(row?.id || ''));
    if (groupInfo) enriched.group = groupInfo;
    return enriched;
  });
}

const addCreditDataService = {
  async assertCreateContext(requestingUser) {
    return assertCreateOrgContextOrThrow(requestingUser, { scopeLabel: 'activity quota credits' });
  },

  getFormOptions() {
    return {
      source: {
        modules: cloneOptionRows(SOURCE_MODULE_OPTIONS),
        eventTypes: cloneOptionRows(SOURCE_EVENT_TYPE_OPTIONS),
        eventIdModes: cloneOptionRows(SOURCE_EVENT_ID_MODE_OPTIONS),
        idempotencyModes: cloneOptionRows(SOURCE_IDEMPOTENCY_MODE_OPTIONS)
      },
      defaults: {
        module: DEFAULT_SOURCE.module,
        eventType: DEFAULT_SOURCE.eventType,
        eventIdMode: SOURCE_MODE_VALUES.AUTO,
        idempotencyMode: SOURCE_MODE_VALUES.AUTO
      }
    };
  },

  async listCredits(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const scopedQuery = buildScopedListQuery(query, visibility);
    const rows = await activityQuotaLedgerRepository.list({
      query: scopedQuery,
      scope: { canViewAll: true },
      sort: options?.sort || { dateTime: -1, id: -1 },
      pagination: options?.pagination || null,
      backendMode: options?.backendMode
    });

    const visibleRows = (Array.isArray(rows) ? rows : []).filter((row) => isVisibleCreditRow(row, visibility));
    return enrichCreditRows(visibleRows, requestingUser, visibility, options);
  },

  async getCreditById(id, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const row = await activityQuotaLedgerRepository.getById(id, {
      backendMode: options?.backendMode
    });
    if (!row || !isVisibleCreditRow(row, visibility)) return null;

    const [enriched] = await enrichCreditRows([row], requestingUser, visibility, options);
    return enriched || row;
  },

  async listCreditGroups(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const normalized = normalizeQueryOptions(query || {});
    const rows = await activityQuotaCreditGroupRepository.list({
      query: normalized,
      scope: buildGroupScope(visibility),
      sort: options?.sort || { dateTime: -1, id: -1 },
      pagination: options?.pagination || null,
      backendMode: options?.backendMode
    });

    return (Array.isArray(rows) ? rows : [])
      .filter((row) => isVisibleGroupRecord(row, visibility))
      .map((row) => ({
        ...row,
        summary: buildGroupSummary(row)
      }));
  },

  async getCreditGroupById(id, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const row = await activityQuotaCreditGroupRepository.getById(id, {
      backendMode: options?.backendMode
    });
    if (!row || !isVisibleGroupRecord(row, visibility)) return null;
    return {
      ...row,
      summary: buildGroupSummary(row)
    };
  },

  async getCreditGroupByLedgerEntryId(entryId, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const targetEntryId = toPublicId(entryId);
    if (!targetEntryId) return null;

    const rows = await activityQuotaCreditGroupRepository.list({
      query: {},
      scope: buildGroupScope(visibility),
      sort: { dateTime: -1, id: -1 },
      backendMode: options?.backendMode
    });

    const matched = (Array.isArray(rows) ? rows : []).find((row) => {
      if (!isVisibleGroupRecord(row, visibility)) return false;
      const ledgerEntryIds = Array.isArray(row?.ledgerEntryIds) ? row.ledgerEntryIds : [];
      return ledgerEntryIds.some((candidateId) => idsEqual(candidateId, targetEntryId));
    });
    if (!matched) return null;
    return {
      ...matched,
      summary: buildGroupSummary(matched)
    };
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

    const normalizedSectionId = toPublicId(sectionId || '');
    if (!normalizedSectionId) return [];

    const repositoryOptions = options?.backendMode ? { backendMode: options.backendMode } : {};
    const sections = await fetchRowsByIds('sections', [normalizedSectionId], requestingUser, repositoryOptions);
    const section = sections.find((row) => idsEqual(row?.id, normalizedSectionId));
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
    const scopedOperationRows = sectionRefs
      .map((ref) => toPickerOperation(operationMap.get(ref.id) || { id: ref.id }, ref))
      .filter(Boolean);

    const searchQuery = normalizeQueryOptions(stripPaginationFromQuery(query));
    return applyGenericFilter(scopedOperationRows, searchQuery, {
      defaultSearchFields: ['id', 'name', 'description'],
      dateFields: []
    });
  },

  async createCredit(payload = {}, requestingUser, options = {}) {
    const activeOrgId = await this.assertCreateContext(requestingUser);
    const sanitized = sanitizeCreditPayload(payload, {
      fallback: {
        section: DEFAULT_SECTION,
        operation: DEFAULT_OPERATION
      }
    });

    return activityQuotaLedgerService.recordCredit({
      ...sanitized,
      orgId: activeOrgId,
      source: sanitizeSourcePayload(sanitized.source, DEFAULT_SOURCE)
    }, {
      requestUser: requestingUser,
      backendMode: options?.backendMode
    });
  },

  async createCreditsFromPlan(payload = {}, requestingUser, accessContext = {}, options = {}) {
    const activeOrgId = await this.assertCreateContext(requestingUser);
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const plan = normalizeGroupPlanPayload(payload);
    const validated = await validatePlanAgainstSystem(plan, requestingUser, visibility, options);
    const shouldCreateGroup = shouldCreateGroupRecord(plan);

    let groupRecord = null;
    if (shouldCreateGroup) {
      const creator = activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, activeOrgId)
        || activityQuotaLedgerService.createSystemCreatorSnapshot(activeOrgId);
      const audit = buildAuditFromCreator(creator);
      groupRecord = await activityQuotaCreditGroupRepository.create({
        orgId: activeOrgId,
        dateTime: plan.dateTime,
        users: validated.users,
        sections: validated.sections,
        source: {
          module: plan.source.module,
          eventType: plan.source.eventType,
          eventIdMode: plan.source.eventIdMode,
          eventId: plan.source.eventId,
          idempotencyMode: plan.source.idempotencyMode,
          idempotencyKey: plan.source.idempotencyKey
        },
        ledgerEntryIds: [],
        creator,
        audit,
        status: 'active'
      }, {
        backendMode: options?.backendMode
      });
    }

    const createdRows = [];
    let rowIndex = 0;

    for (const userTarget of validated.users) {
      for (const sectionPlan of validated.sections) {
        for (const operationPlan of sectionPlan.operations) {
          const source = buildRowSourceFromPlan(plan.source, rowIndex, plan.totalRows);
          rowIndex += 1;
          // eslint-disable-next-line no-await-in-loop
          const created = await activityQuotaLedgerService.recordCredit({
            dateTime: plan.dateTime,
            userId: userTarget.id,
            orgId: activeOrgId,
            section: sectionPlan.name || sectionPlan.id,
            operation: operationPlan.name || operationPlan.id,
            call: operationPlan.call,
            amount: operationPlan.amount,
            token: operationPlan.token,
            volume: operationPlan.volume,
            source
          }, {
            requestUser: requestingUser,
            backendMode: options?.backendMode
          });
          createdRows.push(created);
        }
      }
    }

    if (groupRecord) {
      const creator = activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, activeOrgId)
        || activityQuotaLedgerService.createSystemCreatorSnapshot(activeOrgId);
      const nextAudit = buildAuditFromCreator(creator, groupRecord.audit || {});
      groupRecord = await activityQuotaCreditGroupRepository.update(groupRecord.id, {
        users: validated.users,
        sections: validated.sections,
        source: {
          module: plan.source.module,
          eventType: plan.source.eventType,
          eventIdMode: plan.source.eventIdMode,
          eventId: plan.source.eventId,
          idempotencyMode: plan.source.idempotencyMode,
          idempotencyKey: plan.source.idempotencyKey
        },
        ledgerEntryIds: createdRows.map((row) => row?.id).filter(Boolean),
        audit: nextAudit
      }, {
        backendMode: options?.backendMode
      });
    }

    return {
      createdCount: createdRows.length,
      createdIds: createdRows.map((row) => row?.id).filter(Boolean),
      rows: createdRows,
      group: groupRecord
        ? {
          id: toPublicId(groupRecord?.id || ''),
          summary: buildGroupSummary(groupRecord)
        }
        : null
    };
  },

  async updateCreditGroupFromPlan(groupId, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const existingGroup = await this.getCreditGroupById(groupId, requestingUser, accessContext, options);
    if (!existingGroup) throw new Error('Credit group not found or inaccessible.');
    const impactedOldKeys = collectQuotaKeyFiltersFromGroup(existingGroup);

    const activeOrgId = await this.assertCreateContext(requestingUser);
    if (!idsEqual(existingGroup.orgId, activeOrgId) && !adminChekersService.isSuperAdmin(requestingUser)) {
      throw new Error('Active organization does not match this credit group.');
    }

    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const plan = normalizeGroupPlanPayload(payload);
    const validated = await validatePlanAgainstSystem(plan, requestingUser, visibility, options);

    const existingLedgerEntryIds = Array.isArray(existingGroup.ledgerEntryIds) ? existingGroup.ledgerEntryIds : [];
    for (const ledgerEntryId of existingLedgerEntryIds) {
      // eslint-disable-next-line no-await-in-loop
      await activityQuotaLedgerRepository.remove(ledgerEntryId, { backendMode: options?.backendMode });
    }

    const createdRows = [];
    let rowIndex = 0;
    for (const userTarget of validated.users) {
      for (const sectionPlan of validated.sections) {
        for (const operationPlan of sectionPlan.operations) {
          const source = buildRowSourceFromPlan(plan.source, rowIndex, plan.totalRows);
          rowIndex += 1;
          // eslint-disable-next-line no-await-in-loop
          const created = await activityQuotaLedgerService.recordCredit({
            dateTime: plan.dateTime,
            userId: userTarget.id,
            orgId: existingGroup.orgId,
            section: sectionPlan.name || sectionPlan.id,
            operation: operationPlan.name || operationPlan.id,
            call: operationPlan.call,
            amount: operationPlan.amount,
            token: operationPlan.token,
            volume: operationPlan.volume,
            source
          }, {
            requestUser: requestingUser,
            backendMode: options?.backendMode
          });
          createdRows.push(created);
        }
      }
    }

    const creator = activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, existingGroup.orgId)
      || activityQuotaLedgerService.createSystemCreatorSnapshot(existingGroup.orgId);
    const nextAudit = buildAuditFromCreator(creator, existingGroup.audit || {});

    const updatedGroup = await activityQuotaCreditGroupRepository.update(existingGroup.id, {
      dateTime: plan.dateTime,
      users: validated.users,
      sections: validated.sections,
      source: {
        module: plan.source.module,
        eventType: plan.source.eventType,
        eventIdMode: plan.source.eventIdMode,
        eventId: plan.source.eventId,
        idempotencyMode: plan.source.idempotencyMode,
        idempotencyKey: plan.source.idempotencyKey
      },
      ledgerEntryIds: createdRows.map((row) => row?.id).filter(Boolean),
      audit: nextAudit
    }, {
      backendMode: options?.backendMode
    });

    const impactedNewKeys = collectQuotaKeyFiltersFromGroup({
      orgId: existingGroup.orgId,
      users: validated.users,
      sections: validated.sections
    });
    await activityQuotaLedgerService.rebuildProjectionForKeys(
      [...impactedOldKeys, ...impactedNewKeys],
      { backendMode: options?.backendMode }
    );

    return {
      updatedCount: createdRows.length,
      group: {
        id: toPublicId(updatedGroup?.id || ''),
        summary: buildGroupSummary(updatedGroup)
      },
      rows: createdRows
    };
  },

  async deleteCreditGroup(groupId, requestingUser, accessContext = {}, options = {}) {
    const group = await this.getCreditGroupById(groupId, requestingUser, accessContext, options);
    if (!group) throw new Error('Credit group not found or inaccessible.');
    const impactedKeys = collectQuotaKeyFiltersFromGroup(group);

    const ledgerEntryIds = Array.isArray(group.ledgerEntryIds) ? group.ledgerEntryIds : [];
    for (const ledgerEntryId of ledgerEntryIds) {
      // eslint-disable-next-line no-await-in-loop
      await activityQuotaLedgerRepository.remove(ledgerEntryId, { backendMode: options?.backendMode });
    }

    const result = await activityQuotaCreditGroupRepository.remove(group.id, {
      backendMode: options?.backendMode
    });
    await activityQuotaLedgerService.rebuildProjectionForKeys(impactedKeys, {
      backendMode: options?.backendMode
    });
    return result === true || Number(result?.deletedCount || 0) > 0;
  },

  async updateCredit(id, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getCreditById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('Credit entry not found or inaccessible.');

    const group = await this.getCreditGroupByLedgerEntryId(existing.id, requestingUser, accessContext, options);
    if (group) {
      throw new Error('This credit entry belongs to a group. Edit it from the grouped credits page.');
    }

    const sanitized = sanitizeCreditPayload(payload, {
      fallback: {
        userId: existing.userId,
        section: existing.section || DEFAULT_SECTION,
        operation: existing.operation || DEFAULT_OPERATION,
        dateTime: existing.dateTime || new Date().toISOString(),
        call: existing.call || 0,
        amount: existing.amount || 0,
        token: existing.token || 0,
        volume: existing.volume || 0,
        source: existing.source || {},
        validity: existing.validity || {}
      }
    });

    const createDateTime = normalizeIsoDateTime(
      existing?.audit?.createDateTime,
      existing?.dateTime || new Date().toISOString()
    );
    const createUser = cleanString(existing?.audit?.createUser, { max: 120, allowEmpty: true })
      || (String(existing?.creator?.type || '').toLowerCase() === 'system'
        ? 'System'
        : (toPublicId(existing?.creator?.userId) || 'System'));

    const nextCreator = (existing?.creator && typeof existing.creator === 'object')
      ? { ...existing.creator }
      : activityQuotaLedgerService.createSystemCreatorSnapshot(toPublicId(existing?.orgId || '') || '');

    const patch = {
      dateTime: sanitized.dateTime,
      userId: sanitized.userId,
      orgId: toPublicId(existing.orgId || ''),
      section: sanitized.section,
      operation: sanitized.operation,
      call: sanitized.call,
      amount: sanitized.amount,
      token: sanitized.token,
      volume: sanitized.volume,
      entryType: 'credit',
      source: sanitizeSourcePayload(sanitized.source, existing.source || DEFAULT_SOURCE),
      validity: normalizeValidityPayload(sanitized.validity, existing.validity || {}),
      creator: nextCreator,
      audit: {
        createUser,
        createDateTime,
        lastUpdateUser: buildLastUpdateUser(requestingUser, existing),
        lastUpdateDateTime: new Date().toISOString()
      }
    };

    const updated = await activityQuotaLedgerRepository.update(existing.id, patch, {
      backendMode: options?.backendMode
    });
    const oldKey = buildQuotaKeyFilterFromEntry(existing);
    const newKey = buildQuotaKeyFilterFromEntry(updated);
    await activityQuotaLedgerService.rebuildProjectionForKeys([oldKey, newKey], {
      backendMode: options?.backendMode
    });
    return updated;
  },

  async deleteCredit(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getCreditById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('Credit entry not found or inaccessible.');
    const keyFilter = buildQuotaKeyFilterFromEntry(existing);

    const group = await this.getCreditGroupByLedgerEntryId(existing.id, requestingUser, accessContext, options);
    const result = await activityQuotaLedgerRepository.remove(existing.id, {
      backendMode: options?.backendMode
    });

    if (group) {
      const nextLedgerEntryIds = (Array.isArray(group.ledgerEntryIds) ? group.ledgerEntryIds : [])
        .filter((ledgerId) => !idsEqual(ledgerId, existing.id));
      if (!nextLedgerEntryIds.length) {
        await activityQuotaCreditGroupRepository.remove(group.id, { backendMode: options?.backendMode });
      } else {
        const creator = activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, group.orgId)
          || activityQuotaLedgerService.createSystemCreatorSnapshot(group.orgId);
        const nextAudit = buildAuditFromCreator(creator, group.audit || {});
        await activityQuotaCreditGroupRepository.update(group.id, {
          ledgerEntryIds: nextLedgerEntryIds,
          audit: nextAudit
        }, {
          backendMode: options?.backendMode
        });
      }
    }

    await activityQuotaLedgerService.rebuildProjectionForKey(keyFilter, {
      backendMode: options?.backendMode
    });

    return result === true || Number(result?.deletedCount || 0) > 0;
  },

  async resolveReadVisibility(requestingUser, accessContext = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    return visibility;
  }
};

module.exports = addCreditDataService;
