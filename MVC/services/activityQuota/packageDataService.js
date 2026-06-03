const activityQuotaPackageRepository = require('../../repositories/activityQuotaPackageRepository');
const adminChekersService = require('../adminChekersService');
const dataService = require('../dataService');
const activityQuotaLedgerService = require('../activityQuotaLedgerService');
const { normalizeQueryOptions } = require('../../utils/queryOptionsAdapter');
const { resolveEntity } = require('../../utils/entityResolver');
const { applyGenericFilter } = require('../../utils/queryEngine');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');
const { assertCreateOrgContextOrThrow } = require('../../utils/orgContextUtils');

const ORGANIZATION_SCOPE_NAMES = new Set(['ADMIN', 'GLOBAL', 'ORGANIZATION', 'ORG']);
const VALID_VISIBILITY_VALUES = new Set(['public', 'internal']);
const VALID_VALIDITY_MODES = new Set(['date_range', 'duration']);
const CURRENCY_CODES = Object.freeze(['CAD', 'USD', 'EUR', 'GBP', 'AUD']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 240, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeCategoryValue(value, { allowEmpty = true } = {}) {
  const token = cleanString(value, { max: 80, allowEmpty: true });
  if (!token) return allowEmpty ? '' : null;
  return token;
}

function normalizeRoleToken(value, { allowEmpty = true } = {}) {
  const token = cleanString(value, { max: 120, allowEmpty: true }).toLowerCase();
  if (!token) return allowEmpty ? '' : null;
  if (!/^[a-z0-9_.:-]+$/.test(token)) {
    throw new Error('Role tokens may contain only letters, numbers, underscore, dot, colon, or dash.');
  }
  return token;
}

function extractSectionCategories(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const unique = new Map();
  list.forEach((row) => {
    const category = normalizeCategoryValue(row?.category, { allowEmpty: true });
    if (!category) return;
    const key = String(category).toLowerCase();
    if (!unique.has(key)) unique.set(key, category);
  });
  return Array.from(unique.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
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

function normalizeInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return Number(fallback || 0);
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) throw new Error('Duration values must be integers.');
  if (numeric < 0) throw new Error('Duration values must be non-negative.');
  return numeric;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function hasAnyQuotaValue(metrics = {}) {
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

function buildOrgLabelLookup(user = {}) {
  const map = new Map();

  const addOrg = (org = {}) => {
    const token = toPublicId(org?.orgId || org?.id || org?.org_code || '');
    if (!token) return;
    const name = String(org?.name || org?.orgName || org?.identity?.displayName || org?.identity?.legalName || '').trim();
    if (name) map.set(token, name);
  };

  const organizations = Array.isArray(user?.organizations) ? user.organizations : [];
  organizations.forEach(addOrg);

  const allowedOrgs = Array.isArray(user?.allowedOrgs) ? user.allowedOrgs : [];
  allowedOrgs.forEach(addOrg);

  addOrg({
    orgId: user?.orgId,
    name: user?.orgName
  });

  return map;
}

function resolveOrganizationNameFromMemberships(memberships = [], orgId = '') {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) return '';
  const match = Array.isArray(memberships)
    ? memberships.find((org) => idsEqual(toPublicId(org?.orgId || org?.id || ''), targetOrgId))
    : null;
  if (!match) return '';
  return String(
    match?.name || match?.orgName || match?.identity?.displayName || match?.identity?.legalName || match?.organizationName || ''
  ).trim();
}

function resolveOrganizationName(orgId = '', orgLabelLookup = new Map(), memberships = []) {
  const normalizedOrgId = toPublicId(orgId);
  if (!normalizedOrgId) return '';
  const lookupName = String(orgLabelLookup.get(normalizedOrgId) || '').trim();
  if (lookupName) return lookupName;
  return resolveOrganizationNameFromMemberships(memberships, normalizedOrgId);
}

function userBelongsToOrg(user = {}, orgId = '') {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) return false;
  return collectUserOrgIds(user).some((item) => idsEqual(item, targetOrgId));
}

function toPickerUser(row = {}, visibility = {}, orgLabelLookup = new Map()) {
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
  const orgName = resolveOrganizationName(activeOrg, orgLabelLookup, row?.organizations || []);

  return {
    id,
    name: displayName,
    username,
    email,
    orgId: activeOrg,
    orgName,
    organizations: orgIds
  };
}

function toPickerRole(token = '') {
  const id = normalizeRoleToken(token, { allowEmpty: true });
  if (!id) return null;
  return {
    id,
    name: id
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

function toPickerOperation(operationRow = {}, sectionRef = {}) {
  const id = toPublicId(operationRow?.id || sectionRef?.id || '');
  return {
    id,
    name: cleanString(operationRow?.name, { max: 200, allowEmpty: true }) || id,
    description: cleanString(operationRow?.description, { max: 300, allowEmpty: true }) || '',
    active: operationRow?.active !== false && sectionRef?.active !== false,
    system: operationRow?.system === true
  };
}

function toPickerAccessProfile(row = {}, orgLabelLookup = new Map()) {
  const id = toPublicId(row?.id || '');
  const orgId = toPublicId(row?.orgId || '');
  return {
    id,
    name: cleanString(row?.name, { max: 200, allowEmpty: true }) || id,
    description: cleanString(row?.description, { max: 300, allowEmpty: true }) || '',
    orgId,
    orgName: resolveOrganizationName(orgId, orgLabelLookup),
    active: row?.active !== false
  };
}

function buildPackageSummary(row = {}) {
  const sections = Array.isArray(row?.sections) ? row.sections : [];
  let operationCount = 0;
  sections.forEach((section) => {
    operationCount += Array.isArray(section?.operations) ? section.operations.length : 0;
  });
  return {
    sectionCount: sections.length,
    operationCount,
    accessProfileCount: Array.isArray(row?.accessProfiles) ? row.accessProfiles.length : 0,
    eligibleRoleCount: Array.isArray(row?.eligibleRoles) ? row.eligibleRoles.length : 0,
    bannedUserCount: Array.isArray(row?.bannedUsers) ? row.bannedUsers.length : 0
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

function isVisiblePackageRow(row, visibility) {
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

function sanitizeVisibility(value, fallback = 'internal') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (!token) return fallback;
  if (!VALID_VISIBILITY_VALUES.has(token)) {
    throw new Error('visibility must be public or internal.');
  }
  return token;
}

function sanitizePrice(priceInput = {}, fallback = {}) {
  const input = isPlainObject(priceInput) ? priceInput : {};
  const base = isPlainObject(fallback) ? fallback : {};
  const amount = normalizeMetricValue(input.amount, base.amount || 0);
  const codeRaw = cleanString(input.currencyCode, { max: 3, allowEmpty: true })
    || cleanString(base.currencyCode, { max: 3, allowEmpty: true })
    || 'CAD';
  const currencyCode = String(codeRaw).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error('price.currencyCode must be a 3-letter currency code.');
  return {
    amount,
    currencyCode
  };
}

function sanitizeValidity(validityInput = {}, fallback = {}) {
  const input = isPlainObject(validityInput) ? validityInput : {};
  const base = isPlainObject(fallback) ? fallback : {};
  const modeToken = cleanString(input.mode, { max: 20, allowEmpty: true }).toLowerCase()
    || cleanString(base.mode, { max: 20, allowEmpty: true }).toLowerCase();

  if (!VALID_VALIDITY_MODES.has(modeToken)) {
    throw new Error('validity.mode must be date_range or duration.');
  }

  if (modeToken === 'date_range') {
    const startDate = cleanDateOnly(input.startDate, { allowEmpty: true })
      || cleanDateOnly(base.startDate, { allowEmpty: true });
    const endDate = cleanDateOnly(input.endDate, { allowEmpty: true })
      || cleanDateOnly(base.endDate, { allowEmpty: true });
    if (!startDate || !endDate) {
      throw new Error('validity.startDate and validity.endDate are required for date_range mode.');
    }
    if (endDate < startDate) {
      throw new Error('validity.endDate must be the same day or after validity.startDate.');
    }
    return {
      mode: modeToken,
      startDate,
      endDate,
      years: 0,
      months: 0,
      days: 0
    };
  }

  const years = normalizeInteger(input.years, base.years || 0);
  const months = normalizeInteger(input.months, base.months || 0);
  const days = normalizeInteger(input.days, base.days || 0);
  if ((years + months + days) <= 0) {
    throw new Error('Duration validity requires at least one positive value in years, months, or days.');
  }
  return {
    mode: modeToken,
    startDate: '',
    endDate: '',
    years,
    months,
    days
  };
}

function sanitizeAccessProfiles(rawRows = [], fallbackRows = []) {
  const out = new Map();
  normalizeList(rawRows).forEach((rawItem) => {
    const item = isPlainObject(rawItem) ? rawItem : { id: rawItem };
    const id = toPublicId(item.id || item.accessProfileId || '');
    if (!id) return;
    out.set(id, {
      id,
      name: cleanString(item.name, { max: 180, allowEmpty: true }) || '',
      orgId: toPublicId(item.orgId || '')
    });
  });

  if (!out.size) {
    normalizeList(fallbackRows).forEach((rawItem) => {
      const item = isPlainObject(rawItem) ? rawItem : { id: rawItem };
      const id = toPublicId(item.id || item.accessProfileId || '');
      if (!id) return;
      out.set(id, {
        id,
        name: cleanString(item.name, { max: 180, allowEmpty: true }) || '',
        orgId: toPublicId(item.orgId || '')
      });
    });
  }

  return Array.from(out.values());
}

function sanitizeBannedUsers(rawRows = [], fallbackRows = []) {
  const out = new Map();
  normalizeList(rawRows).forEach((rawItem) => {
    const item = isPlainObject(rawItem) ? rawItem : { id: rawItem };
    const id = toPublicId(item.id || item.userId || '');
    if (!id) return;
    out.set(id, {
      id,
      name: cleanString(item.name, { max: 180, allowEmpty: true }) || '',
      username: cleanString(item.username, { max: 120, allowEmpty: true }) || '',
      email: cleanString(item.email, { max: 200, allowEmpty: true }) || '',
      orgId: toPublicId(item.orgId || '')
    });
  });

  if (!out.size) {
    normalizeList(fallbackRows).forEach((rawItem) => {
      const item = isPlainObject(rawItem) ? rawItem : { id: rawItem };
      const id = toPublicId(item.id || item.userId || '');
      if (!id) return;
      out.set(id, {
        id,
        name: cleanString(item.name, { max: 180, allowEmpty: true }) || '',
        username: cleanString(item.username, { max: 120, allowEmpty: true }) || '',
        email: cleanString(item.email, { max: 200, allowEmpty: true }) || '',
        orgId: toPublicId(item.orgId || '')
      });
    });
  }

  return Array.from(out.values());
}

function sanitizeEligibleRoles(rawRows = undefined, fallbackRows = []) {
  const hasExplicitInput = rawRows !== undefined;
  const out = new Map();
  const push = (value) => {
    const token = normalizeRoleToken(
      isPlainObject(value)
        ? (value.id || value.role || value.value || value.name || '')
        : value,
      { allowEmpty: true }
    );
    if (!token) return;
    if (!out.has(token)) out.set(token, token);
  };

  normalizeList(rawRows).forEach(push);

  if (!out.size && !hasExplicitInput) {
    normalizeList(fallbackRows).forEach(push);
  }

  return Array.from(out.values());
}

function sanitizeOperationRows(rawRows = []) {
  const out = new Map();
  normalizeList(rawRows).forEach((rawItem) => {
    const item = isPlainObject(rawItem) ? rawItem : { id: rawItem };
    const id = toPublicId(item.id || item.operationId || '');
    if (!id) return;
    const metrics = {
      call: normalizeMetricValue(item.call, 0),
      amount: normalizeMetricValue(item.amount, 0),
      token: normalizeMetricValue(item.token, 0),
      volume: normalizeMetricValue(item.volume, 0)
    };
    if (!hasAnyQuotaValue(metrics)) {
      throw new Error(`Operation '${id}' must include at least one positive quota value.`);
    }
    out.set(id, {
      id,
      name: cleanString(item.name, { max: 180, allowEmpty: true }) || '',
      label: cleanString(item.label, { max: 180, allowEmpty: true }) || '',
      ...metrics
    });
  });
  const rows = Array.from(out.values());
  if (!rows.length) throw new Error('Each section must include at least one operation.');
  return rows;
}

function sanitizeSectionRows(rawRows = [], fallbackRows = []) {
  const rows = normalizeList(rawRows);
  const baseRows = rows.length ? rows : normalizeList(fallbackRows);
  const out = new Map();

  baseRows.forEach((rawItem) => {
    const item = isPlainObject(rawItem) ? rawItem : { id: rawItem };
    const id = toPublicId(item.id || item.sectionId || '');
    if (!id) return;
    out.set(id, {
      id,
      name: cleanString(item.name, { max: 180, allowEmpty: true }) || '',
      operations: sanitizeOperationRows(item.operations || [])
    });
  });

  const sanitized = Array.from(out.values());
  if (!sanitized.length) throw new Error('At least one section is required.');
  return sanitized;
}

function sanitizePackagePayload(payload = {}, options = {}) {
  const source = isPlainObject(payload) ? payload : {};
  const fallback = isPlainObject(options.fallback) ? options.fallback : {};
  const hasEligibleRoles = Object.prototype.hasOwnProperty.call(source, 'eligibleRoles');

  const name = cleanString(source.name, { max: 200, allowEmpty: true })
    || cleanString(fallback.name, { max: 200, allowEmpty: true });
  if (!name) throw new Error('Package name is required.');
  const category = normalizeCategoryValue(source.category, { allowEmpty: true })
    || normalizeCategoryValue(fallback.category, { allowEmpty: true });
  if (!category) throw new Error('Package category is required.');

  return {
    id: toPublicId(source.id || fallback.id || ''),
    name,
    category,
    description: cleanString(source.description, { max: 3000, allowEmpty: true })
      || cleanString(fallback.description, { max: 3000, allowEmpty: true })
      || '',
    active: normalizeBoolean(source.active, fallback.active !== false),
    visibility: sanitizeVisibility(source.visibility, fallback.visibility || 'internal'),
    price: sanitizePrice(source.price, fallback.price || {}),
    validity: sanitizeValidity(source.validity, fallback.validity || {}),
    accessProfiles: sanitizeAccessProfiles(source.accessProfiles, fallback.accessProfiles || []),
    eligibleRoles: sanitizeEligibleRoles(
      hasEligibleRoles ? source.eligibleRoles : undefined,
      fallback.eligibleRoles || []
    ),
    bannedUsers: sanitizeBannedUsers(source.bannedUsers, fallback.bannedUsers || []),
    sections: sanitizeSectionRows(source.sections, fallback.sections || [])
  };
}

function extractRoleTokensForOrg(user = {}, orgId = '') {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) return [];
  const organizations = Array.isArray(user?.organizations) ? user.organizations : [];
  const roleSet = new Set();
  organizations.forEach((org) => {
    const orgRowId = toPublicId(org?.orgId || org?.id || '');
    if (!orgRowId || !idsEqual(orgRowId, targetOrgId)) return;
    const roles = Array.isArray(org?.roles) && org.roles.length ? org.roles : (org?.role ? [org.role] : []);
    roles.forEach((role) => {
      let token = '';
      try {
        token = normalizeRoleToken(role, { allowEmpty: true });
      } catch (_) {
        token = '';
      }
      if (token) roleSet.add(token);
    });
  });
  return Array.from(roleSet.values());
}

function buildLastUpdateUser(requestingUser, existingRow) {
  if (requestingUser === null || requestingUser === undefined) {
    return cleanString(existingRow?.audit?.lastUpdateUser, { max: 120, allowEmpty: true }) || 'System';
  }
  const userId = resolveRequesterUserId(requestingUser);
  return userId || 'System';
}

function buildAuditFromCreator(creator, existingAudit = {}, options = {}) {
  const nowIso = new Date().toISOString();
  const isUpdate = options?.isUpdate === true;

  const previous = isPlainObject(existingAudit) ? existingAudit : {};
  const creatorType = String(creator?.type || '').toLowerCase();
  const creatorUserId = toPublicId(creator?.userId || '');

  const defaultCreateUser = creatorType === 'system'
    ? 'System'
    : (creatorUserId || 'System');
  const createUser = isUpdate
    ? (cleanString(previous.createUser, { max: 120, allowEmpty: true }) || defaultCreateUser)
    : defaultCreateUser;
  const createDateTime = isUpdate
    ? (cleanString(previous.createDateTime, { max: 80, allowEmpty: true }) || nowIso)
    : nowIso;

  return {
    createUser,
    createDateTime,
    lastUpdateUser: isUpdate ? buildLastUpdateUser(options.requestingUser, { audit: previous }) : createUser,
    lastUpdateDateTime: nowIso
  };
}

async function fetchRowsByIds(entityName, ids, requestingUser, repositoryOptions = {}) {
  const uniqueIds = Array.from(new Set((Array.isArray(ids) ? ids : [])
    .map((id) => toPublicId(id))
    .filter(Boolean)));
  if (!uniqueIds.length) return [];

  const query = {
    id__in: uniqueIds.join(','),
    limit: Math.max(uniqueIds.length * 3, 100)
  };
  const rows = await dataService.fetchData(entityName, query, requestingUser, repositoryOptions);
  const normalizedRows = Array.isArray(rows) ? rows : [];
  return normalizedRows.filter((row) => {
    const rowId = toPublicId(row?.id || '');
    return rowId && uniqueIds.some((id) => idsEqual(id, rowId));
  });
}

async function validateAndHydrateSections(sections, requestingUser, options = {}) {
  const repositoryOptions = options?.backendMode ? { backendMode: options.backendMode } : {};
  const sectionIds = sections.map((section) => section.id);
  const sectionRows = await fetchRowsByIds('sections', sectionIds, requestingUser, repositoryOptions);
  const sectionMap = new Map(sectionRows.map((row) => [toPublicId(row?.id || ''), row]));
  const missingSections = sectionIds.filter((id) => !sectionMap.has(id));
  if (missingSections.length) {
    throw new Error(`Some sections were not found: ${missingSections.join(', ')}`);
  }

  const operationIds = [];
  const sectionRefMap = new Map();
  sections.forEach((section) => {
    const sectionRow = sectionMap.get(section.id);
    const refs = normalizeSectionOperationRefs(sectionRow);
    sectionRefMap.set(section.id, new Map(refs.map((ref) => [ref.id, ref])));
    section.operations.forEach((operation) => operationIds.push(operation.id));
  });

  const operationRows = await fetchRowsByIds('operations', operationIds, requestingUser, repositoryOptions);
  const operationMap = new Map(operationRows.map((row) => [toPublicId(row?.id || ''), row]));

  return sections.map((section) => {
    const sectionRow = sectionMap.get(section.id);
    const validOperationRefs = sectionRefMap.get(section.id) || new Map();

    const normalizedOperations = section.operations.map((operation) => {
      if (!validOperationRefs.has(operation.id)) {
        throw new Error(`Operation '${operation.id}' is not assigned to section '${section.id}'.`);
      }
      const operationRow = operationMap.get(operation.id);
      if (!operationRow) {
        throw new Error(`Operation '${operation.id}' was not found.`);
      }
      return {
        id: operation.id,
        name: cleanString(operationRow?.name, { max: 180, allowEmpty: true })
          || operation.name
          || operation.id,
        label: cleanString(operation.label, { max: 180, allowEmpty: true }) || '',
        call: normalizeMetricValue(operation.call, 0),
        amount: normalizeMetricValue(operation.amount, 0),
        token: normalizeMetricValue(operation.token, 0),
        volume: normalizeMetricValue(operation.volume, 0)
      };
    });

    return {
      id: section.id,
      name: cleanString(sectionRow?.name, { max: 180, allowEmpty: true }) || section.name || section.id,
      operations: normalizedOperations
    };
  });
}

async function validateAndHydrateAccessProfiles(accessProfiles, requestingUser, visibility, options = {}) {
  if (!Array.isArray(accessProfiles) || !accessProfiles.length) return [];
  const activeOrgId = toPublicId(visibility?.activeOrgId || '');
  if (!activeOrgId) {
    throw new Error('Select an active organization before assigning access profiles.');
  }

  const repositoryOptions = options?.backendMode ? { backendMode: options.backendMode } : {};
  const profileIds = accessProfiles.map((item) => item.id);
  const rows = await fetchRowsByIds('accesses', profileIds, requestingUser, repositoryOptions);
  const rowMap = new Map(rows.map((row) => [toPublicId(row?.id || ''), row]));

  return accessProfiles.map((profile) => {
    const row = rowMap.get(profile.id);
    if (!row) throw new Error(`Access profile '${profile.id}' was not found.`);
    const rowOrgId = toPublicId(row?.orgId || '');
    if (!rowOrgId || !idsEqual(rowOrgId, activeOrgId)) {
      throw new Error(`Access profile '${profile.id}' is not in the active organization.`);
    }
    return {
      id: profile.id,
      name: cleanString(row?.name, { max: 180, allowEmpty: true }) || profile.name || profile.id,
      orgId: rowOrgId
    };
  });
}

async function validateAndHydrateBannedUsers(bannedUsers, requestingUser, visibility, options = {}) {
  if (!Array.isArray(bannedUsers) || !bannedUsers.length) return [];
  const repositoryOptions = options?.backendMode ? { backendMode: options.backendMode } : {};
  const userIds = bannedUsers.map((item) => item.id);
  const rows = await fetchRowsByIds('users', userIds, requestingUser, repositoryOptions);
  const rowMap = new Map(rows.map((row) => [toPublicId(row?.id || ''), row]));

  return bannedUsers.map((bannedUser) => {
    const row = rowMap.get(bannedUser.id);
    if (!row) throw new Error(`Banned user '${bannedUser.id}' was not found.`);
    if (!canTargetUserByVisibility(row, visibility)) {
      throw new Error(`Banned user '${bannedUser.id}' is outside your scope.`);
    }
    const pickerUser = toPickerUser(row, visibility);
    return {
      id: pickerUser.id,
      name: pickerUser.name,
      username: pickerUser.username || '',
      email: pickerUser.email || '',
      orgId: pickerUser.orgId || ''
    };
  });
}

const packageDataService = {
  async assertCreateContext(requestingUser) {
    return assertCreateOrgContextOrThrow(requestingUser, { scopeLabel: 'activity quota packages' });
  },

  getFormOptions(sectionCategories = []) {
    const categories = Array.isArray(sectionCategories)
      ? Array.from(new Set(sectionCategories
        .map((item) => normalizeCategoryValue(item, { allowEmpty: true }))
        .filter(Boolean)))
      : [];
    return {
      visibility: [
        { value: 'public', label: 'Public' },
        { value: 'internal', label: 'Internal' }
      ],
      validityModes: [
        { value: 'date_range', label: 'Date Range' },
        { value: 'duration', label: 'Duration (Y/M/D)' }
      ],
      currencies: CURRENCY_CODES.map((code) => ({ value: code, label: code })),
      categories: categories.map((category) => ({ value: category, label: category })),
      defaults: {
        visibility: 'internal',
        currencyCode: 'CAD',
        validityMode: 'duration',
        active: true,
        category: categories[0] || ''
      }
    };
  },

  async listSectionCategories(requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const normalizedQuery = normalizeQueryOptions({ limit: 5000 });
    const repositoryOptions = options?.backendMode ? { backendMode: options.backendMode } : {};
    const rows = await dataService.fetchData('sections', normalizedQuery, requestingUser, repositoryOptions);
    return extractSectionCategories(rows);
  },

  async listPackages(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const orgLabelLookup = buildOrgLabelLookup(requestingUser);

    const normalizedQuery = normalizeQueryOptions(query || {});
    const rows = await activityQuotaPackageRepository.list({
      query: normalizedQuery,
      scope: buildRepositoryScope(visibility),
      sort: options?.sort || { 'audit.createDateTime': -1, id: -1 },
      pagination: options?.pagination || null,
      backendMode: options?.backendMode
    });

    return (Array.isArray(rows) ? rows : [])
      .filter((row) => isVisiblePackageRow(row, visibility))
      .map((row) => ({
        ...row,
        orgName: resolveOrganizationName(row?.orgId, orgLabelLookup),
        summary: buildPackageSummary(row)
      }));
  },

  async getPackageById(id, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const row = await activityQuotaPackageRepository.getById(id, {
      backendMode: options?.backendMode
    });
    if (!row || !isVisiblePackageRow(row, visibility)) return null;
    return {
      ...row,
      summary: buildPackageSummary(row)
    };
  },

  async getPackageTemplateById(id, requestingUser, accessContext = {}, options = {}) {
    const pkg = await this.getPackageById(id, requestingUser, accessContext, options);
    if (!pkg) return null;
    return {
      id: pkg.id,
      name: pkg.name,
      category: normalizeCategoryValue(pkg.category, { allowEmpty: true }) || '',
      description: pkg.description || '',
      price: pkg.price || { amount: 0, currencyCode: 'CAD' },
      active: pkg.active !== false,
      visibility: pkg.visibility || 'internal',
      validity: pkg.validity || { mode: 'duration', years: 1, months: 0, days: 0, startDate: '', endDate: '' },
      accessProfiles: Array.isArray(pkg.accessProfiles) ? pkg.accessProfiles : [],
      eligibleRoles: Array.isArray(pkg.eligibleRoles) ? pkg.eligibleRoles : [],
      bannedUsers: Array.isArray(pkg.bannedUsers) ? pkg.bannedUsers : [],
      sections: Array.isArray(pkg.sections) ? pkg.sections : []
    };
  },

  async createPackage(payload = {}, requestingUser, accessContext = {}, options = {}) {
    const activeOrgId = await this.assertCreateContext(requestingUser);
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const sanitized = sanitizePackagePayload(payload, {});
    const [validatedSections, validatedAccessProfiles, validatedBannedUsers] = await Promise.all([
      validateAndHydrateSections(sanitized.sections, requestingUser, options),
      validateAndHydrateAccessProfiles(sanitized.accessProfiles, requestingUser, visibility, options),
      validateAndHydrateBannedUsers(sanitized.bannedUsers, requestingUser, visibility, options)
    ]);

    const creator = activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, activeOrgId)
      || activityQuotaLedgerService.createSystemCreatorSnapshot(activeOrgId);
    const audit = buildAuditFromCreator(creator, null, { isUpdate: false, requestingUser });

    return activityQuotaPackageRepository.create({
      id: sanitized.id || '',
      orgId: activeOrgId,
      name: sanitized.name,
      category: sanitized.category,
      description: sanitized.description,
      price: sanitized.price,
      active: sanitized.active,
      visibility: sanitized.visibility,
      validity: sanitized.validity,
      accessProfiles: validatedAccessProfiles,
      eligibleRoles: sanitized.eligibleRoles,
      bannedUsers: validatedBannedUsers,
      sections: validatedSections,
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });
  },

  async updatePackage(id, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getPackageById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('Package not found or inaccessible.');

    const activeOrgId = await this.assertCreateContext(requestingUser);
    if (!adminChekersService.isSuperAdmin(requestingUser) && !idsEqual(existing.orgId, activeOrgId)) {
      throw new Error('Active organization does not match this package.');
    }

    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const sanitized = sanitizePackagePayload(payload, { fallback: existing });
    const [validatedSections, validatedAccessProfiles, validatedBannedUsers] = await Promise.all([
      validateAndHydrateSections(sanitized.sections, requestingUser, options),
      validateAndHydrateAccessProfiles(sanitized.accessProfiles, requestingUser, visibility, options),
      validateAndHydrateBannedUsers(sanitized.bannedUsers, requestingUser, visibility, options)
    ]);

    const creator = isPlainObject(existing.creator)
      ? { ...existing.creator }
      : (activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, existing.orgId)
        || activityQuotaLedgerService.createSystemCreatorSnapshot(existing.orgId));
    const audit = buildAuditFromCreator(creator, existing.audit || {}, { isUpdate: true, requestingUser });

    return activityQuotaPackageRepository.update(existing.id, {
      orgId: existing.orgId,
      name: sanitized.name,
      category: sanitized.category,
      description: sanitized.description,
      price: sanitized.price,
      active: sanitized.active,
      visibility: sanitized.visibility,
      validity: sanitized.validity,
      accessProfiles: validatedAccessProfiles,
      eligibleRoles: sanitized.eligibleRoles,
      bannedUsers: validatedBannedUsers,
      sections: validatedSections,
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });
  },

  async deletePackage(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getPackageById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('Package not found or inaccessible.');
    const result = await activityQuotaPackageRepository.remove(existing.id, {
      backendMode: options?.backendMode
    });
    return result === true || Number(result?.deletedCount || 0) > 0;
  },

  async listPickerUsers(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const orgLabelLookup = buildOrgLabelLookup(requestingUser);

    const normalizedQuery = normalizeQueryOptions(stripPaginationFromQuery(query));
    const repositoryOptions = options?.backendMode ? { backendMode: options.backendMode } : {};
    const rows = await dataService.fetchData('users', {
      ...normalizedQuery,
      limit: Math.max(Number(normalizedQuery.limit || 0) || 0, 500)
    }, requestingUser, repositoryOptions);

    return (Array.isArray(rows) ? rows : [])
      .filter((row) => canTargetUserByVisibility(row, visibility))
      .map((row) => toPickerUser(row, visibility, orgLabelLookup));
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

  async listPickerAccessProfiles(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const orgLabelLookup = buildOrgLabelLookup(requestingUser);

    const activeOrgId = toPublicId(visibility.activeOrgId || '');
    if (!activeOrgId) return [];

    const normalizedQuery = normalizeQueryOptions(stripPaginationFromQuery(query));
    const repositoryOptions = options?.backendMode ? { backendMode: options.backendMode } : {};
    const rows = await dataService.fetchData('accesses', {
      ...normalizedQuery,
      limit: Math.max(Number(normalizedQuery.limit || 0) || 0, 1000)
    }, requestingUser, repositoryOptions);

    const scopedRows = (Array.isArray(rows) ? rows : [])
      .filter((row) => idsEqual(row?.orgId, activeOrgId));
    const pickerRows = scopedRows.map((row) => toPickerAccessProfile(row, orgLabelLookup));
    return applyGenericFilter(pickerRows, normalizedQuery, {
      defaultSearchFields: ['id', 'name', 'description'],
      dateFields: []
    });
  },

  async listPickerRoles(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const activeOrgId = toPublicId(visibility.activeOrgId || '');
    if (!activeOrgId) return [];

    const normalizedQuery = normalizeQueryOptions(stripPaginationFromQuery(query));
    const repositoryOptions = options?.backendMode ? { backendMode: options.backendMode } : {};
    const rows = await dataService.fetchData('users', {
      ...normalizedQuery,
      limit: Math.max(Number(normalizedQuery.limit || 0) || 0, 1000)
    }, requestingUser, repositoryOptions);

    const roleSet = new Set();
    (Array.isArray(rows) ? rows : [])
      .filter((row) => canTargetUserByVisibility(row, visibility))
      .forEach((row) => {
        extractRoleTokensForOrg(row, activeOrgId).forEach((role) => roleSet.add(role));
      });

    const pickerRows = Array.from(roleSet.values())
      .map((token) => toPickerRole(token))
      .filter(Boolean);

    return applyGenericFilter(pickerRows, normalizedQuery, {
      defaultSearchFields: ['id', 'name'],
      dateFields: []
    });
  },

  async listPickerPackages(query = {}, requestingUser, accessContext = {}, options = {}) {
    const rows = await this.listPackages(query, requestingUser, accessContext, options);
    const orgLabelLookup = buildOrgLabelLookup(requestingUser);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: normalizeCategoryValue(row.category, { allowEmpty: true }) || '',
      eligibleRoles: Array.isArray(row.eligibleRoles) ? row.eligibleRoles : [],
      orgId: row.orgId,
      orgName: resolveOrganizationName(row?.orgId, orgLabelLookup),
      visibility: row.visibility,
      active: row.active !== false
    }));
  },

  async resolveReadVisibility(requestingUser, accessContext = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    return visibility;
  }
};

module.exports = packageDataService;
