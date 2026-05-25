const bcrypt = require('bcrypt');
const pteApplicantRepository = require('../../repositories/pteApplicantRepository');
const pteAssignmentRepository = require('../../repositories/pteApplicantPackageAssignmentRepository');
const pteCourseRepository = require('../../repositories/pteCourseRepository');
const packageDataService = require('../../../../../MVC/services/activityQuota/packageDataService');
const activityQuotaLedgerService = require('../../../../../MVC/services/activityQuotaLedgerService');
const userAccessProfileService = require('../../../../../MVC/services/users/userAccessProfileService');
const userMembershipRepository = require('../../repositories/userMembershipRepository');
const dataService = require('../../../../../MVC/services/dataService');
const adminChekersService = require('../../../../../MVC/services/adminChekersService');
const { applyGenericFilter } = require('../../utils/queryEngine');
const { normalizeQueryOptions } = require('../../../../../MVC/utils/queryOptionsAdapter');
const { resolveEntity } = require('../../../../../MVC/utils/entityResolver');
const { normalizeMembershipPayload } = require('../../../../../MVC/services/security/entitlementService');
const { assertCreateOrgContextOrThrow, getActiveOrgIdOrThrow, normalizeOrgRoles, getPrimaryOrgRole } = require('../../../../../MVC/utils/orgContextUtils');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');
const { resolveCanonicalOrganizationName } = require('../../../../../MVC/utils/organizationDisplay');
const settingService = require('../../../../../MVC/services/settingService');
const { SYSTEM_CONTEXT } = require('../../../../../config/constants');

const PERSON_ROLE_TOKEN = 'PTE_Student';
const PERSON_ORG_ROLE_TOKEN = 'pte_student';
const PERSON_ROLE_PUBLIC_TOKEN = 'PTE_Student_Public';
const PERSON_ORG_ROLE_PUBLIC_TOKEN = 'pte_student_public';
const ORGANIZATION_SCOPE_NAMES = new Set(['ADMIN', 'GLOBAL', 'ORGANIZATION', 'ORG']);
const PUBLIC_APPLICANT_ROLE_TOKENS = new Set([
  'PTE_Student_Public',
  'pte_student_public',
  'PTE_Public_Student',
  'pte_public_student'
]);
const REGULAR_APPLICANT_ROLE_TOKENS = Object.freeze(['PTE_Student', 'pte_student', '']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 300, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeStatus(value, fallback = 'active') {
  const token = cleanString(value, { max: 30, allowEmpty: true }).toLowerCase();
  if (token === 'archived') return 'archived';
  if (token === 'active') return 'active';
  return fallback;
}

function isActiveAssignmentStatus(value) {
  return cleanString(value, { max: 30, allowEmpty: true }).toLowerCase() === 'active';
}

function normalizeList(values) {
  if (Array.isArray(values)) return values;
  if (values === undefined || values === null || values === '') return [];
  return [values];
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const out = { ...query };
  delete out.page;
  delete out.limit;
  return out;
}

function normalizePagination(input = {}, fallback = {}) {
  const fromInput = isPlainObject(input) ? input : {};
  const fromFallback = isPlainObject(fallback) ? fallback : {};
  const defaultLimit = resolveDefaultPageSize();
  const page = Math.max(
    1,
    Number.parseInt(
      fromInput.page
      ?? fromFallback.page
      ?? 1,
      10
    ) || 1
  );
  const parsedLimit = Number.parseInt(
    fromInput.limit
    ?? fromFallback.limit
    ?? 0,
    10
  );
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : defaultLimit;
  return { page, limit };
}

function buildPaginationMeta(totalRows = 0, page = 1, limit = 0) {
  const safeTotal = Math.max(0, Number(totalRows) || 0);
  const safeLimit = Number(limit) > 0 ? Number(limit) : resolveDefaultPageSize();
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

function resolveDefaultPageSize() {
  const configured = Number.parseInt(String(settingService.getValue('app', 'defaultPageSize') || ''), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 20;
}

const APPLICANT_LIST_PROJECTION = Object.freeze({
  id: 1,
  orgId: 1,
  personId: 1,
  userId: 1,
  personRoleToken: 1,
  applicantId: 1,
  courses: 1,
  countryOfOrigin: 1,
  localId: 1,
  admissionsNotes: 1,
  globalAcademicStatus: 1,
  selectedPackages: 1,
  packageAssignmentIds: 1,
  status: 1,
  creator: 1,
  audit: 1
});
const APPLICANT_HYDRATED_SEARCH_FIELDS = Object.freeze([
  'id',
  'orgId',
  'personId',
  'userId',
  'personRoleToken',
  'applicantId',
  'countryOfOrigin',
  'localId',
  'globalAcademicStatus',
  'status',
  'admissionsNotes',
  'display.personName',
  'display.userName'
]);

const COURSE_PICKER_SOURCE_PROJECTION = Object.freeze({
  id: 1,
  orgId: 1,
  name: 1,
  status: 1,
  creator: 1,
  audit: 1
});

function hasSearchKeyword(query = {}) {
  return Boolean(cleanString(query?.q, { max: 400, allowEmpty: true }));
}

function buildHydratedSearchQuery(query = {}) {
  const out = {};
  const q = cleanString(query?.q, { max: 400, allowEmpty: true });
  const type = cleanString(query?.type, { max: 40, allowEmpty: true });
  const searchFields = query?.searchFields;
  if (q) out.q = q;
  if (type) out.type = type;
  if (Array.isArray(searchFields)) out.searchFields = searchFields;
  else if (typeof searchFields === 'string' && searchFields.trim()) out.searchFields = searchFields.trim();
  return out;
}

function buildListQueryWithoutSearch(query = {}) {
  const out = { ...(query && typeof query === 'object' ? query : {}) };
  delete out.q;
  delete out.type;
  delete out.searchFields;
  return out;
}

function normalizeIdList(values) {
  const rows = normalizeList(values);
  const out = [];
  const seen = new Set();
  rows.forEach((value) => {
    const id = toPublicId(isPlainObject(value) ? (value.id || value.packageId || value.courseId || '') : value);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function buildCreatorSnapshot(requestingUser, orgId = '') {
  return activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, orgId)
    || activityQuotaLedgerService.createSystemCreatorSnapshot(orgId);
}

function buildAuditSnapshot(creator, existingAudit = {}, options = {}) {
  const nowIso = new Date().toISOString();
  const sourceAudit = isPlainObject(existingAudit) ? existingAudit : {};
  const isUpdate = options?.isUpdate === true;
  const creatorUser = String(creator?.type || '').toLowerCase() === 'system'
    ? 'System'
    : (toPublicId(creator?.userId) || 'System');

  return {
    createUser: isUpdate
      ? (cleanString(sourceAudit.createUser, { max: 120, allowEmpty: true }) || creatorUser)
      : creatorUser,
    createDateTime: isUpdate
      ? (cleanString(sourceAudit.createDateTime, { max: 80, allowEmpty: true }) || nowIso)
      : nowIso,
    lastUpdateUser: creatorUser,
    lastUpdateDateTime: nowIso
  };
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
  const row = await resolveEntity('scopes', token);
  return normalizeScopeName(row?.name || '');
}

function resolveActiveOrgId(requestingUser) {
  return toPublicId(requestingUser?.activeOrgId || requestingUser?.primaryOrgId) || '';
}

function resolveRequesterUserId(requestingUser) {
  return toPublicId(requestingUser?.id) || '';
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

function isVisibleApplicantRow(row, visibility) {
  if (!row) return false;
  if (visibility.mode === 'all') return true;
  if (!idsEqual(row?.orgId, visibility.activeOrgId)) return false;
  if (visibility.mode === 'org') return true;
  const creatorUserId = toPublicId(row?.creator?.userId || row?.audit?.createUser || '');
  return creatorUserId ? idsEqual(creatorUserId, visibility.requesterUserId) : false;
}

function isVisiblePersonRow(row, visibility) {
  if (!row) return false;
  if (visibility.mode === 'all') return true;

  const activeOrgId = toPublicId(visibility.activeOrgId);
  const orgCandidates = [];
  const topLevelOrgId = toPublicId(row?.orgId || '');
  if (topLevelOrgId) orgCandidates.push(topLevelOrgId);
  const memberships = Array.isArray(row?.organizations) ? row.organizations : [];
  memberships.forEach((org) => {
    const orgId = toPublicId(org?.orgId || org?.id || '');
    if (orgId) orgCandidates.push(orgId);
  });
  const inActiveOrg = orgCandidates.some((orgId) => idsEqual(orgId, activeOrgId));
  if (!inActiveOrg) return false;

  if (visibility.mode === 'org') return true;
  const creatorUserId = toPublicId(row?.creator?.userId || row?.audit?.createUser || '');
  return creatorUserId ? idsEqual(creatorUserId, visibility.requesterUserId) : false;
}

function sanitizeCourseRows(rawRows = []) {
  return normalizeList(rawRows)
    .map((raw, index) => {
      const row = isPlainObject(raw) ? raw : { id: raw };
      const id = cleanString(row.id || row.courseId, { max: 120, allowEmpty: true }) || '';
      const name = cleanString(row.name || row.title, { max: 180, allowEmpty: true }) || '';
      if (!id && !name) return null;
      return {
        id,
        name: name || id || `Course ${index + 1}`
      };
    })
    .filter(Boolean);
}

function sanitizePackageRows(rawRows = []) {
  return normalizeList(rawRows)
    .map((raw) => {
      const row = isPlainObject(raw) ? raw : { id: raw };
      const id = toPublicId(row.id || row.packageId || '');
      if (!id) return null;
      return {
        id,
        name: cleanString(row.name, { max: 220, allowEmpty: true }) || id
      };
    })
    .filter(Boolean);
}

function sanitizePersonInput(raw = {}) {
  const input = isPlainObject(raw) ? raw : {};
  return {
    firstName: cleanString(input.firstName, { max: 120, allowEmpty: true }) || '',
    middleName: cleanString(input.middleName, { max: 120, allowEmpty: true }) || '',
    lastName: cleanString(input.lastName, { max: 120, allowEmpty: true }) || '',
    preferredName: cleanString(input.preferredName, { max: 120, allowEmpty: true }) || '',
    email: cleanString(input.email, { max: 220, allowEmpty: true }) || '',
    phone: cleanString(input.phone, { max: 80, allowEmpty: true }) || '',
    gender: cleanString(input.gender, { max: 40, allowEmpty: true }) || '',
    dateOfBirth: cleanString(input.dateOfBirth, { max: 40, allowEmpty: true }) || '',
    notes: cleanString(input.notes, { max: 2000, allowEmpty: true }) || ''
  };
}

function generateTempPassword(email = '') {
  const base = String(email || 'user').split('@')[0].replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) || 'user';
  const token = Math.random().toString(36).slice(2, 8);
  return `${base}-${token}`;
}

function resolvePrimaryEmail(person = {}) {
  const direct = cleanString(person?.contact?.email, { max: 220, allowEmpty: true });
  if (direct) return direct;
  const emails = Array.isArray(person?.contact?.emails) ? person.contact.emails : [];
  const primary = emails.find((row) => row?.isPrimary && cleanString(row?.email, { max: 220, allowEmpty: true }));
  if (primary?.email) return cleanString(primary.email, { max: 220, allowEmpty: true }) || '';
  const first = emails.find((row) => cleanString(row?.email, { max: 220, allowEmpty: true }));
  return cleanString(first?.email, { max: 220, allowEmpty: true }) || '';
}

function resolvePersonDisplayName(person = {}) {
  const preferred = cleanString(person?.name?.preferred, { max: 160, allowEmpty: true }) || '';
  const first = cleanString(person?.name?.first, { max: 120, allowEmpty: true }) || '';
  const last = cleanString(person?.name?.last, { max: 120, allowEmpty: true }) || '';
  const full = `${first} ${last}`.trim();
  return preferred || full || cleanString(person?.id, { max: 120, allowEmpty: true }) || 'Applicant';
}

async function ensurePersonHasPteRole(person, orgId, requestingUser, options = {}) {
  if (!person || !person.id) throw new Error('Person record is missing.');
  const orgToken = toPublicId(orgId);
  if (!orgToken) throw new Error('Organization id is required.');

  const latest = await dataService.getDataById('persons', person.id, SYSTEM_CONTEXT, { enrichment: { includeSchoolRoles: false } });
  if (!latest) throw new Error('Person not found while applying PTE role.');

  const organizations = Array.isArray(latest.organizations) ? latest.organizations.map((row) => ({ ...row })) : [];
  const nowIso = new Date().toISOString();
  const idx = organizations.findIndex((row) => idsEqual(row?.orgId, orgToken));
  let orgName = '';
  try {
    const org = await dataService.getDataById('organizations', orgToken, SYSTEM_CONTEXT);
    orgName = cleanString(resolveCanonicalOrganizationName(org || {}), { max: 180, allowEmpty: true }) || '';
  } catch (_) {
    orgName = '';
  }
  let changed = false;

  if (idx >= 0) {
    const org = { ...organizations[idx] };
    const roles = normalizeOrgRoles(org);
    if (!roles.includes(PERSON_ORG_ROLE_TOKEN)) {
      roles.push(PERSON_ORG_ROLE_TOKEN);
      changed = true;
    }
    org.roles = roles;
    org.role = getPrimaryOrgRole(org);
    if (!org.memberStatus) {
      org.memberStatus = 'active';
      changed = true;
    }
    if (!org.joinedAt) {
      org.joinedAt = nowIso;
      changed = true;
    }
    if (orgName && String(org.name || '').trim() !== orgName) {
      org.name = orgName;
      changed = true;
    }
    organizations[idx] = org;
  } else {
    organizations.push({
      orgId: Number.isFinite(Number(orgToken)) ? Number(orgToken) : orgToken,
      name: orgName,
      roles: ['member', PERSON_ORG_ROLE_TOKEN],
      role: 'member',
      memberStatus: 'active',
      joinedAt: nowIso
    });
    changed = true;
  }

  if (!changed) return latest;

  return dataService.updateData('persons', latest.id, {
    ...latest,
    organizations
  }, requestingUser || SYSTEM_CONTEXT, options);
}

async function ensurePersonFromPayload(input = {}, requestingUser, activeOrgId, options = {}) {
  const mode = cleanString(input.personMode, { max: 20, allowEmpty: true }).toLowerCase() === 'new'
    ? 'new'
    : 'existing';
  const personId = toPublicId(input.personId || '');

  if (mode === 'existing') {
    if (!personId) throw new Error('Please select an existing person.');
    const person = await dataService.getDataById('persons', personId, requestingUser, { enrichment: { includeSchoolRoles: false } });
    if (!person) throw new Error(`Person '${personId}' was not found.`);
    const updated = await ensurePersonHasPteRole(person, activeOrgId, requestingUser, options);
    return updated || person;
  }

  const personInput = sanitizePersonInput(input.newPerson || {});
  if (!personInput.firstName || !personInput.lastName || !personInput.email) {
    throw new Error('New person requires first name, last name, and email.');
  }

  const nowIso = new Date().toISOString();
  let orgName = '';
  try {
    const org = await dataService.getDataById('organizations', activeOrgId, SYSTEM_CONTEXT);
    orgName = cleanString(resolveCanonicalOrganizationName(org || {}), { max: 180, allowEmpty: true }) || '';
  } catch (_) {
    orgName = '';
  }

  const personPayload = {
    active: true,
    name: {
      first: personInput.firstName,
      middle: personInput.middleName || null,
      last: personInput.lastName,
      preferred: personInput.preferredName || null
    },
    demographics: {
      gender: personInput.gender || null,
      dateOfBirth: personInput.dateOfBirth || null
    },
    contact: {
      emails: [{ type: 'primary', email: personInput.email, isPrimary: true }],
      phones: personInput.phone ? [{ type: 'mobile', number: personInput.phone }] : [],
      email: personInput.email
    },
    addresses: [],
    address: {},
    tags: [],
    manualTags: [],
    notes: personInput.notes || null,
    organizations: [{
      orgId: Number.isFinite(Number(activeOrgId)) ? Number(activeOrgId) : activeOrgId,
      name: orgName,
      roles: ['member', PERSON_ORG_ROLE_TOKEN],
      role: 'member',
      memberStatus: 'active',
      joinedAt: nowIso
    }],
    audit: {
      createUser: toPublicId(requestingUser?.id) || String(requestingUser?.username || 'SYSTEM'),
      createDateTime: nowIso,
      lastUpdateUser: toPublicId(requestingUser?.id) || String(requestingUser?.username || 'SYSTEM'),
      lastUpdateDateTime: nowIso
    }
  };

  const created = await dataService.addData('persons', personPayload, requestingUser || SYSTEM_CONTEXT, options);
  if (!created?.id) throw new Error('Failed to create person record.');
  return ensurePersonHasPteRole(created, activeOrgId, requestingUser, options);
}

async function ensureApplicantUserAccount(person, activeOrgId, requestingUser, options = {}) {
  if (!person?.id) throw new Error('Person id is required to create applicant user account.');

  const linkedUsers = await dataService.fetchData('users', {
    q: String(person.id),
    type: 'exact_match',
    searchFields: 'personId',
    page: 1,
    limit: 5
  }, SYSTEM_CONTEXT, options);

  const existingLinked = (Array.isArray(linkedUsers) ? linkedUsers : []).find((row) => idsEqual(row?.personId, person.id));
  if (existingLinked) {
    return {
      user: existingLinked,
      created: false,
      tempPassword: null
    };
  }

  const email = resolvePrimaryEmail(person);
  if (!email) throw new Error('Selected person has no email; cannot create applicant user account.');

  const duplicateByEmail = await dataService.fetchData('users', {
    q: email,
    type: 'exact_match',
    searchFields: 'email',
    page: 1,
    limit: 5
  }, SYSTEM_CONTEXT, options);
  if (Array.isArray(duplicateByEmail) && duplicateByEmail.some((row) => !idsEqual(row?.personId, person.id))) {
    throw new Error(`Cannot auto-create applicant user because email '${email}' is already used.`);
  }

  const tempPassword = generateTempPassword(email);
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const nowIso = new Date().toISOString();
  const userPayload = {
    active: true,
    email,
    username: email,
    passwordHash,
    status: 'active',
    registrationSource: 'admin_create',
    accessLevel: 1,
    personId: String(person.id),
    organizations: [{
      orgId: Number.isFinite(Number(activeOrgId)) ? Number(activeOrgId) : activeOrgId,
      name: '',
      roles: ['member'],
      role: 'member',
      memberStatus: 'active',
      joinedAt: nowIso,
      accessProfileIds: []
    }],
    primaryOrgId: Number.isFinite(Number(activeOrgId)) ? Number(activeOrgId) : activeOrgId,
    isEmailVerified: false,
    lastLoginAt: null,
    audit: {
      createUser: toPublicId(requestingUser?.id) || String(requestingUser?.username || 'SYSTEM'),
      createDateTime: nowIso,
      lastUpdateUser: toPublicId(requestingUser?.id) || String(requestingUser?.username || 'SYSTEM'),
      lastUpdateDateTime: nowIso
    }
  };

  const created = await dataService.addData('users', userPayload, requestingUser || SYSTEM_CONTEXT, options);
  return {
    user: created,
    created: true,
    tempPassword
  };
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function addDurationToDate(startDate, years, months, days) {
  const parsed = new Date(`${startDate}T00:00:00.000Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() + Number(years || 0));
  parsed.setUTCMonth(parsed.getUTCMonth() + Number(months || 0));
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return parsed.toISOString().slice(0, 10);
}

function calculatePackagePeriod(packageRecord, assignmentId, orgId) {
  const validity = isPlainObject(packageRecord?.validity) ? packageRecord.validity : {};
  const mode = cleanString(validity.mode, { max: 20, allowEmpty: true }).toLowerCase() === 'date_range'
    ? 'date_range'
    : 'duration';
  const today = new Date().toISOString().slice(0, 10);

  let startDate = today;
  let endDate = today;
  if (mode === 'date_range') {
    startDate = normalizeDateOnly(validity.startDate) || today;
    endDate = normalizeDateOnly(validity.endDate) || startDate;
    if (endDate < startDate) endDate = startDate;
  } else {
    const years = Math.max(0, Number.parseInt(String(validity.years || '0'), 10) || 0);
    const months = Math.max(0, Number.parseInt(String(validity.months || '0'), 10) || 0);
    const days = Math.max(0, Number.parseInt(String(validity.days || '0'), 10) || 0);
    startDate = today;
    const rawEnd = addDurationToDate(startDate, years, months, days);
    const inclusiveEnd = addDurationToDate(rawEnd, 0, 0, -1);
    endDate = inclusiveEnd < startDate ? startDate : inclusiveEnd;
  }

  return {
    id: `PTEPKG_${String(assignmentId || '').trim()}`,
    startDate,
    endDate,
    orgId: toPublicId(orgId) || '',
    sourceType: 'package',
    sourceRef: toPublicId(packageRecord?.id) || '',
    note: `PTE package assignment (${toPublicId(packageRecord?.id) || ''})`
  };
}

async function upsertUserMembershipPeriodForPackage({ userId, orgId, period, requestingUser, options = {} }) {
  const normalizedUserId = toPublicId(userId);
  const normalizedOrgId = toPublicId(orgId);
  if (!normalizedUserId || !normalizedOrgId) return null;

  const rows = await userMembershipRepository.list({
    query: {
      userId__eq: normalizedUserId
    },
    scope: { canViewAll: true },
    backendMode: options?.backendMode
  });
  const target = (Array.isArray(rows) ? rows : []).find((row) => idsEqual(row?.orgId, normalizedOrgId));

  if (!target) {
    const creator = buildCreatorSnapshot(requestingUser, normalizedOrgId);
    const audit = buildAuditSnapshot(creator, null, { isUpdate: false });
    const payload = normalizeMembershipPayload({
      userId: normalizedUserId,
      orgId: normalizedOrgId,
      active: true,
      periods: [period],
      notes: '',
      source: {}
    });
    return userMembershipRepository.create({
      ...payload,
      status: payload.summary?.status || 'no_period',
      audit
    }, {
      backendMode: options?.backendMode
    });
  }

  const nextPeriods = Array.isArray(target.periods) ? target.periods.filter((row) => String(row?.id || '') !== String(period.id || '')) : [];
  nextPeriods.push(period);
  const creator = buildCreatorSnapshot(requestingUser, normalizedOrgId);
  const audit = buildAuditSnapshot(creator, target.audit || {}, { isUpdate: true });

  return userMembershipRepository.update(target.id, {
    periods: nextPeriods,
    active: true,
    audit
  }, {
    backendMode: options?.backendMode
  });
}

async function removeUserMembershipPeriodForPackage({
  userId,
  orgId,
  periodId,
  fallbackPeriodIds = [],
  requestingUser,
  options = {}
}) {
  const normalizedUserId = toPublicId(userId);
  const normalizedOrgId = toPublicId(orgId);
  const targetPeriodIds = new Set();
  const normalizedPeriodId = cleanString(periodId, { max: 180, allowEmpty: true });
  if (normalizedPeriodId) targetPeriodIds.add(normalizedPeriodId);
  normalizeList(fallbackPeriodIds).forEach((value) => {
    const normalized = cleanString(value, { max: 180, allowEmpty: true });
    if (!normalized) return;
    targetPeriodIds.add(normalized);
  });
  if (!normalizedUserId || !normalizedOrgId || !targetPeriodIds.size) return null;

  const rows = await userMembershipRepository.list({
    query: {
      userId__eq: normalizedUserId
    },
    scope: { canViewAll: true },
    backendMode: options?.backendMode
  });
  const target = (Array.isArray(rows) ? rows : []).find((row) => idsEqual(row?.orgId, normalizedOrgId));
  if (!target) return null;

  const currentPeriods = Array.isArray(target.periods) ? target.periods : [];
  const nextPeriods = currentPeriods.filter((row) => !targetPeriodIds.has(String(row?.id || '')));
  if (nextPeriods.length === currentPeriods.length) return target;

  const creator = buildCreatorSnapshot(requestingUser, normalizedOrgId);
  const audit = buildAuditSnapshot(creator, target.audit || {}, { isUpdate: true });

  return userMembershipRepository.update(target.id, {
    periods: nextPeriods,
    audit
  }, {
    backendMode: options?.backendMode
  });
}

function buildPackageLedgerRows(packageRecord = {}) {
  const rows = [];
  const sections = Array.isArray(packageRecord?.sections) ? packageRecord.sections : [];
  sections.forEach((section) => {
    const sectionId = toPublicId(section?.name || section?.id || '');
    if (!sectionId) return;
    const operations = Array.isArray(section?.operations) ? section.operations : [];
    operations.forEach((operation) => {
      const operationId = toPublicId(operation?.name || operation?.id || '');
      if (!operationId) return;
      const call = Number(operation?.call || 0) || 0;
      const amount = Number(operation?.amount || 0) || 0;
      const token = Number(operation?.token || 0) || 0;
      const volume = Number(operation?.volume || 0) || 0;
      if (call <= 0 && amount <= 0 && token <= 0 && volume <= 0) return;
      rows.push({
        section: sectionId,
        operation: operationId,
        call,
        amount,
        token,
        volume
      });
    });
  });
  return rows;
}

async function recordPackageCreditLedgerRows({
  packageRecord,
  assignmentId,
  userId,
  orgId,
  period,
  requestingUser,
  options = {}
}) {
  const rows = buildPackageLedgerRows(packageRecord);
  const createdIds = [];
  const validity = {
    mode: 'date_range',
    startDate: cleanString(period?.startDate, { max: 20, allowEmpty: true }) || '',
    endDate: cleanString(period?.endDate, { max: 20, allowEmpty: true }) || ''
  };
  let index = 0;
  for (const row of rows) {
    const source = {
      module: 'pte_students',
      eventType: 'package_credit',
      eventId: String(assignmentId || ''),
      idempotencyKey: `${assignmentId}:credit:${index}`
    };
    // eslint-disable-next-line no-await-in-loop
    const created = await activityQuotaLedgerService.recordCredit({
      dateTime: new Date().toISOString(),
      userId,
      orgId,
      section: row.section,
      operation: row.operation,
      call: row.call,
      amount: row.amount,
      token: row.token,
      volume: row.volume,
      source,
      validity
    }, {
      requestUser: requestingUser,
      backendMode: options?.backendMode
    });
    if (created?.id) createdIds.push(created.id);
    index += 1;
  }
  return createdIds;
}

async function recordPackageReversalLedgerRows({ packageRecord, assignmentId, userId, orgId, requestingUser, options = {} }) {
  const rows = buildPackageLedgerRows(packageRecord);
  const createdIds = [];
  let index = 0;
  for (const row of rows) {
    const source = {
      module: 'pte_students',
      eventType: 'package_credit_reversal',
      eventId: String(assignmentId || ''),
      idempotencyKey: `${assignmentId}:reversal:${index}`
    };
    // eslint-disable-next-line no-await-in-loop
    const created = await activityQuotaLedgerService.recordAdjustment({
      dateTime: new Date().toISOString(),
      userId,
      orgId,
      section: row.section,
      operation: row.operation,
      call: -Math.abs(row.call || 0),
      amount: -Math.abs(row.amount || 0),
      token: -Math.abs(row.token || 0),
      volume: -Math.abs(row.volume || 0),
      source
    }, {
      requestUser: requestingUser,
      backendMode: options?.backendMode
    });
    if (created?.id) createdIds.push(created.id);
    index += 1;
  }
  return createdIds;
}

async function fetchPersonsByIds(personIds = [], options = {}) {
  const ids = normalizeIdList(personIds);
  if (!ids.length) return [];
  const rows = await dataService.fetchData('persons', {
    id__in: ids.join(','),
    limit: Math.max(ids.length * 3, 100)
  }, SYSTEM_CONTEXT, options);
  return Array.isArray(rows) ? rows : [];
}

async function fetchUsersByIds(userIds = [], options = {}) {
  const ids = normalizeIdList(userIds);
  if (!ids.length) return [];
  const rows = await dataService.fetchData('users', {
    id__in: ids.join(','),
    limit: Math.max(ids.length * 3, 100)
  }, SYSTEM_CONTEXT, options);
  return Array.isArray(rows) ? rows : [];
}

async function hydrateApplicantRows(rows = [], options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];

  const personIds = normalizeIdList(list.map((row) => row?.personId));
  const userIds = normalizeIdList(list.map((row) => row?.userId));
  const [persons, users] = await Promise.all([
    fetchPersonsByIds(personIds, options),
    fetchUsersByIds(userIds, options)
  ]);
  const personMap = new Map(persons.map((row) => [toPublicId(row?.id || ''), row]));
  const userMap = new Map(users.map((row) => [toPublicId(row?.id || ''), row]));

  return list.map((row) => {
    const person = personMap.get(toPublicId(row?.personId || '')) || null;
    const user = userMap.get(toPublicId(row?.userId || '')) || null;
    const packageSummary = Array.isArray(row?.selectedPackages)
      ? row.selectedPackages.map((item) => ({
        id: toPublicId(item?.id || ''),
        name: cleanString(item?.name, { max: 220, allowEmpty: true }) || toPublicId(item?.id || '')
      })).filter((item) => item.id)
      : [];
    return {
      ...row,
      display: {
        personName: resolvePersonDisplayName(person || {}),
        personId: toPublicId(row?.personId || ''),
        userName: cleanString(user?.username || user?.email, { max: 180, allowEmpty: true }) || '',
        userId: toPublicId(row?.userId || ''),
        packages: packageSummary
      }
    };
  });
}

function sanitizeApplicantPayload(payload = {}, options = {}) {
  const input = isPlainObject(payload) ? payload : {};
  const existing = isPlainObject(options.existing) ? options.existing : {};

  return {
    applicantId: cleanString(input.applicantId || existing.applicantId, { max: 120, allowEmpty: true }) || '',
    countryOfOrigin: cleanString(input.countryOfOrigin || existing.countryOfOrigin, { max: 120, allowEmpty: true }) || '',
    localId: cleanString(input.localId || existing.localId, { max: 120, allowEmpty: true }) || '',
    admissionsNotes: cleanString(input.admissionsNotes || existing.admissionsNotes, { max: 4000, allowEmpty: true }) || '',
    globalAcademicStatus: cleanString(input.globalAcademicStatus || existing.globalAcademicStatus || 'Active', { max: 80, allowEmpty: true }) || 'Active',
    courses: sanitizeCourseRows(input.courses !== undefined ? input.courses : existing.courses || []),
    selectedPackages: sanitizePackageRows(input.selectedPackages !== undefined ? input.selectedPackages : existing.selectedPackages || []),
    status: normalizeStatus(input.status || existing.status || 'active')
  };
}

function normalizeRoleToken(value = '') {
  return cleanString(value, { max: 120, allowEmpty: true });
}

function isPublicApplicantRoleToken(value = '') {
  const token = normalizeRoleToken(value).toLowerCase();
  return token ? PUBLIC_APPLICANT_ROLE_TOKENS.has(token) : false;
}

function resolveListRoleFilterMode(mode = '') {
  const token = cleanString(mode, { max: 20, allowEmpty: true }).toLowerCase();
  if (token === 'public') return 'public';
  if (token === 'all') return 'all';
  return 'regular';
}

async function fetchPackageRowsByIds(packageIds = [], requestingUser, accessContext = {}, options = {}) {
  const ids = normalizeIdList(packageIds);
  const rows = [];
  for (const packageId of ids) {
    // eslint-disable-next-line no-await-in-loop
    const row = await packageDataService.getPackageById(packageId, requestingUser, accessContext, options);
    if (!row) {
      throw new Error(`Package '${packageId}' was not found or is outside your visibility scope.`);
    }
    rows.push(row);
  }
  return rows;
}

async function listAssignmentsForApplicant(applicantId, options = {}) {
  const rows = await pteAssignmentRepository.list({
    query: {
      applicantId__eq: toPublicId(applicantId),
      limit: 5000
    },
    scope: { canViewAll: true },
    sort: { appliedAt: -1, id: -1 },
    backendMode: options?.backendMode
  });
  return Array.isArray(rows) ? rows : [];
}

function mapPackagesById(rows = []) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = toPublicId(row?.id || row?.packageId || '');
    if (!id) return;
    map.set(id, row);
  });
  return map;
}

async function applyNewPackageAssignment({
  applicant,
  packageRecord,
  requestingUser,
  options = {}
}) {
  if (!applicant?.userId) {
    throw new Error('Applicant user account is required before assigning packages.');
  }

  const creator = buildCreatorSnapshot(requestingUser, applicant.orgId);
  const audit = buildAuditSnapshot(creator, null, { isUpdate: false });
  const baseAssignment = await pteAssignmentRepository.create({
    orgId: applicant.orgId,
    applicantId: applicant.id,
    personId: applicant.personId,
    userId: applicant.userId,
    packageId: packageRecord.id,
    packageName: packageRecord.name,
    packageSnapshot: {
      id: packageRecord.id,
      name: packageRecord.name,
      sections: Array.isArray(packageRecord.sections) ? packageRecord.sections : [],
      accessProfiles: Array.isArray(packageRecord.accessProfiles) ? packageRecord.accessProfiles : [],
      validity: isPlainObject(packageRecord.validity) ? packageRecord.validity : {}
    },
    packageProfileIds: normalizeIdList((packageRecord.accessProfiles || []).map((item) => item?.id)),
    profileSourceType: 'activity_quota_package',
    profileSourceRefId: '',
    profileSourceLabel: cleanString(packageRecord.name || packageRecord.id, { max: 220, allowEmpty: true }) || '',
    preExistingProfileIds: [],
    addedProfileIds: [],
    membershipPeriodId: '',
    ledgerEntryIds: [],
    reversalLedgerEntryIds: [],
    status: 'active',
    appliedAt: new Date().toISOString(),
    removedAt: '',
    creator,
    audit
  }, {
    backendMode: options?.backendMode
  });

  const profileIds = normalizeIdList((packageRecord.accessProfiles || []).map((item) => item?.id));
  const profileSummary = await userAccessProfileService.applyPackageProfiles({
    targetUserId: applicant.userId,
    orgId: applicant.orgId,
    packageProfileIds: profileIds,
    sourceType: 'activity_quota_package',
    sourceRefId: baseAssignment.id,
    sourceLabel: cleanString(packageRecord.name || packageRecord.id, { max: 220, allowEmpty: true }) || packageRecord.id,
    requestingUser,
    options
  });

  const period = calculatePackagePeriod(packageRecord, baseAssignment.id, applicant.orgId);
  await upsertUserMembershipPeriodForPackage({
    userId: applicant.userId,
    orgId: applicant.orgId,
    period,
    requestingUser,
    options
  });

  const ledgerEntryIds = await recordPackageCreditLedgerRows({
    packageRecord,
    assignmentId: baseAssignment.id,
    userId: applicant.userId,
    orgId: applicant.orgId,
    period,
    requestingUser,
    options
  });

  return pteAssignmentRepository.update(baseAssignment.id, {
    packageProfileIds: profileIds,
    profileSourceType: 'activity_quota_package',
    profileSourceRefId: baseAssignment.id,
    profileSourceLabel: cleanString(packageRecord.name || packageRecord.id, { max: 220, allowEmpty: true }) || '',
    preExistingProfileIds: profileSummary.preExistingProfileIds || [],
    addedProfileIds: profileSummary.addedProfileIds || [],
    membershipPeriodId: period.id,
    ledgerEntryIds
  }, {
    backendMode: options?.backendMode
  });
}

async function removePackageAssignment({
  assignment,
  requestingUser,
  options = {}
}) {
  const packageSnapshot = isPlainObject(assignment?.packageSnapshot) ? assignment.packageSnapshot : {};
  const reversalLedgerEntryIds = await recordPackageReversalLedgerRows({
    packageRecord: packageSnapshot,
    assignmentId: assignment.id,
    userId: assignment.userId,
    orgId: assignment.orgId,
    requestingUser,
    options
  });

  await removeUserMembershipPeriodForPackage({
    userId: assignment.userId,
    orgId: assignment.orgId,
    periodId: assignment.membershipPeriodId,
    fallbackPeriodIds: [`PTEPKG_${toPublicId(assignment.id || '')}`],
    requestingUser,
    options
  });

  await userAccessProfileService.removePackageProfiles({
    targetUserId: assignment.userId,
    orgId: assignment.orgId,
    packageProfileIds: assignment.packageProfileIds || [],
    preExistingProfileIds: assignment.preExistingProfileIds || [],
    sourceType: cleanString(assignment.profileSourceType || '', { max: 80, allowEmpty: true }) || 'activity_quota_package',
    sourceRefId: toPublicId(assignment.profileSourceRefId || assignment.id || ''),
    requestingUser,
    options
  });

  return pteAssignmentRepository.update(assignment.id, {
    status: 'removed',
    removedAt: new Date().toISOString(),
    reversalLedgerEntryIds
  }, {
    backendMode: options?.backendMode
  });
}

async function syncApplicantPackages({
  applicant,
  packageIds = [],
  requestingUser,
  accessContext = {},
  options = {}
}) {
  const selectedIds = normalizeIdList(packageIds);
  const packageRows = await fetchPackageRowsByIds(selectedIds, requestingUser, accessContext, options);
  const selectedMap = mapPackagesById(packageRows);
  const allAssignments = await listAssignmentsForApplicant(applicant.id, options);
  const activeAssignments = allAssignments.filter((row) => isActiveAssignmentStatus(row?.status || 'active'));
  const activeMap = mapPackagesById(activeAssignments.map((row) => ({ id: row.packageId, ...row })));

  const addedAssignments = [];
  for (const [packageId, packageRecord] of selectedMap.entries()) {
    if (activeMap.has(packageId)) continue;
    // eslint-disable-next-line no-await-in-loop
    const created = await applyNewPackageAssignment({
      applicant,
      packageRecord,
      requestingUser,
      options
    });
    addedAssignments.push(created);
  }

  const removedAssignments = [];
  for (const assignment of activeAssignments) {
    const packageId = toPublicId(assignment?.packageId || '');
    if (!packageId || selectedMap.has(packageId)) continue;
    // eslint-disable-next-line no-await-in-loop
    const removed = await removePackageAssignment({ assignment, requestingUser, options });
    removedAssignments.push(removed);
  }

  const refreshed = await listAssignmentsForApplicant(applicant.id, options);
  const activeRefreshed = refreshed.filter((row) => isActiveAssignmentStatus(row?.status || 'active'));

  return {
    selectedPackages: packageRows.map((row) => ({ id: row.id, name: row.name || row.id })),
    activeAssignments: activeRefreshed,
    addedAssignments,
    removedAssignments
  };
}

const pteStudentDataService = {
  PERSON_ROLE_TOKEN,
  PERSON_ROLE_PUBLIC_TOKEN,
  PERSON_ORG_ROLE_TOKEN,
  PERSON_ORG_ROLE_PUBLIC_TOKEN,

  async assertCreateContext(requestingUser) {
    return assertCreateOrgContextOrThrow(requestingUser, { scopeLabel: 'PTE applicants' });
  },

  async listApplicants(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const normalizedQuery = normalizeQueryOptions(query || {});
    const listQuery = stripPaginationFromQuery(normalizedQuery);
    const roleFilterMode = resolveListRoleFilterMode(options?.roleFilterMode);
    if (roleFilterMode === 'public') {
      listQuery.personRoleToken__in = Array.from(PUBLIC_APPLICANT_ROLE_TOKENS).join(',');
    } else if (roleFilterMode === 'regular') {
      listQuery.personRoleToken__in = REGULAR_APPLICANT_ROLE_TOKENS.join(',');
    }
    const statusFilter = cleanString(
      normalizedQuery.status__eq || normalizedQuery.status || '',
      { max: 30, allowEmpty: true }
    ).toLowerCase();
    delete listQuery.status;
    if (statusFilter) listQuery.status__eq = normalizeStatus(statusFilter, statusFilter);

    const scope = buildRepositoryScope(visibility);
    const sort = options?.sort || { 'audit.createDateTime': -1, id: -1 };
    const projection = (options?.projection && isPlainObject(options.projection))
      ? options.projection
      : APPLICANT_LIST_PROJECTION;
    const paginationInput = normalizePagination(
      options?.pagination || {},
      normalizedQuery
    );
    const paginated = options?.paginated === true || paginationInput.limit > 0;

    if (paginated) {
      const [totalRows, rows] = await Promise.all([
        pteApplicantRepository.count({
          query: listQuery,
          scope,
          backendMode: options?.backendMode
        }),
        pteApplicantRepository.list({
          query: listQuery,
          scope,
          sort,
          pagination: {
            page: paginationInput.page,
            limit: paginationInput.limit
          },
          projection,
          backendMode: options?.backendMode
        })
      ]);

      const visibleRows = (Array.isArray(rows) ? rows : []).filter((row) => isVisibleApplicantRow(row, visibility));
      let hydratedRows = await hydrateApplicantRows(visibleRows, options);
      let effectiveTotalRows = Math.max(totalRows, hydratedRows.length);

      if (hasSearchKeyword(normalizedQuery) && hydratedRows.length === 0) {
        const fallbackBaseQuery = buildListQueryWithoutSearch(listQuery);
        const fallbackRows = await pteApplicantRepository.list({
          query: fallbackBaseQuery,
          scope,
          sort,
          projection,
          backendMode: options?.backendMode
        });
        const visibleFallbackRows = (Array.isArray(fallbackRows) ? fallbackRows : [])
          .filter((row) => isVisibleApplicantRow(row, visibility));
        const hydratedFallbackRows = await hydrateApplicantRows(visibleFallbackRows, options);
        const filteredFallbackRows = applyGenericFilter(
          hydratedFallbackRows,
          buildHydratedSearchQuery(normalizedQuery),
          {
            defaultSearchFields: APPLICANT_HYDRATED_SEARCH_FIELDS,
            dateFields: ['audit.createDateTime', 'audit.lastUpdateDateTime']
          }
        );
        effectiveTotalRows = Array.isArray(filteredFallbackRows) ? filteredFallbackRows.length : 0;
        const startIndex = Math.max(0, (paginationInput.page - 1) * paginationInput.limit);
        hydratedRows = Array.isArray(filteredFallbackRows)
          ? filteredFallbackRows.slice(startIndex, startIndex + paginationInput.limit)
          : [];
      }

      return {
        rows: hydratedRows,
        totalRows: effectiveTotalRows,
        pagination: buildPaginationMeta(effectiveTotalRows, paginationInput.page, paginationInput.limit)
      };
    }

    const rows = await pteApplicantRepository.list({
      query: listQuery,
      scope,
      sort,
      projection,
      backendMode: options?.backendMode
    });
    const visibleRows = (Array.isArray(rows) ? rows : []).filter((row) => isVisibleApplicantRow(row, visibility));
    return hydrateApplicantRows(visibleRows, options);
  },

  async getApplicantById(id, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const row = await pteApplicantRepository.getById(id, { backendMode: options?.backendMode });
    if (!row || !isVisibleApplicantRow(row, visibility)) return null;
    const [hydrated] = await hydrateApplicantRows([row], options);
    return hydrated || row;
  },

  async createApplicant(payload = {}, requestingUser, accessContext = {}, options = {}) {
    const activeOrgId = await this.assertCreateContext(requestingUser);
    const person = await ensurePersonFromPayload(payload, requestingUser, activeOrgId, options);
    const userAccount = await ensureApplicantUserAccount(person, activeOrgId, requestingUser, options);
    const creator = buildCreatorSnapshot(requestingUser, activeOrgId);
    const audit = buildAuditSnapshot(creator, null, { isUpdate: false });
    const sanitized = sanitizeApplicantPayload(payload);

    const created = await pteApplicantRepository.create({
      orgId: activeOrgId,
      personId: toPublicId(person?.id || ''),
      userId: toPublicId(userAccount?.user?.id || ''),
      applicantId: sanitized.applicantId,
      courses: sanitized.courses,
      countryOfOrigin: sanitized.countryOfOrigin,
      localId: sanitized.localId,
      admissionsNotes: sanitized.admissionsNotes,
      globalAcademicStatus: sanitized.globalAcademicStatus,
      selectedPackages: [],
      packageAssignmentIds: [],
      status: sanitized.status,
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
      personRoleToken: PERSON_ROLE_TOKEN,
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });

    const packageSync = await syncApplicantPackages({
      applicant: created,
      packageIds: sanitized.selectedPackages.map((item) => item.id),
      requestingUser,
      accessContext,
      options
    });

    const updatedApplicant = await pteApplicantRepository.update(created.id, {
      selectedPackages: packageSync.selectedPackages,
      packageAssignmentIds: packageSync.activeAssignments.map((row) => row.id)
    }, {
      backendMode: options?.backendMode
    });

    const [hydrated] = await hydrateApplicantRows([updatedApplicant], options);
    return {
      applicant: hydrated || updatedApplicant,
      autoUserCreated: userAccount.created === true,
      tempPassword: userAccount.tempPassword || null
    };
  },

  async updateApplicant(id, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getApplicantById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('PTE applicant not found or inaccessible.');

    const activeOrgId = getActiveOrgIdOrThrow(requestingUser);
    if (!adminChekersService.isSuperAdmin(requestingUser) && !idsEqual(existing.orgId, activeOrgId)) {
      throw new Error('Active organization does not match this applicant.');
    }

    const person = await ensurePersonFromPayload({
      personMode: 'existing',
      personId: existing.personId
    }, requestingUser, existing.orgId, options);
    const userAccount = await ensureApplicantUserAccount(person, existing.orgId, requestingUser, options);
    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : buildCreatorSnapshot(requestingUser, existing.orgId);
    const audit = buildAuditSnapshot(creator, existing.audit || {}, { isUpdate: true });
    const sanitized = sanitizeApplicantPayload(payload, { existing });

    const updated = await pteApplicantRepository.update(existing.id, {
      personId: toPublicId(person?.id || existing.personId),
      userId: toPublicId(userAccount?.user?.id || existing.userId || ''),
      applicantId: sanitized.applicantId,
      courses: sanitized.courses,
      countryOfOrigin: sanitized.countryOfOrigin,
      localId: sanitized.localId,
      admissionsNotes: sanitized.admissionsNotes,
      globalAcademicStatus: sanitized.globalAcademicStatus,
      status: sanitized.status,
      attachments: Array.isArray(payload.attachments) ? payload.attachments : (Array.isArray(existing.attachments) ? existing.attachments : []),
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });

    const packageSync = await syncApplicantPackages({
      applicant: updated,
      packageIds: sanitized.selectedPackages.map((item) => item.id),
      requestingUser,
      accessContext,
      options
    });

    const finalApplicant = await pteApplicantRepository.update(updated.id, {
      selectedPackages: packageSync.selectedPackages,
      packageAssignmentIds: packageSync.activeAssignments.map((row) => row.id)
    }, {
      backendMode: options?.backendMode
    });

    const [hydrated] = await hydrateApplicantRows([finalApplicant], options);
    return {
      applicant: hydrated || finalApplicant,
      autoUserCreated: userAccount.created === true,
      tempPassword: userAccount.tempPassword || null
    };
  },

  async archiveApplicant(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getApplicantById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('PTE applicant not found or inaccessible.');

    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : buildCreatorSnapshot(requestingUser, existing.orgId);
    const audit = buildAuditSnapshot(creator, existing.audit || {}, { isUpdate: true });

    const archived = await pteApplicantRepository.update(existing.id, {
      status: 'archived',
      globalAcademicStatus: 'Archived',
      audit
    }, {
      backendMode: options?.backendMode
    });

    if (existing.userId) {
      const linkedUser = await dataService.getDataById('users', existing.userId, SYSTEM_CONTEXT, options);
      if (linkedUser) {
        await dataService.updateData('users', linkedUser.id, {
          ...linkedUser,
          active: false,
          status: 'suspended',
          audit: {
            ...(linkedUser.audit || {}),
            lastUpdateUser: toPublicId(requestingUser?.id) || String(requestingUser?.username || 'SYSTEM'),
            lastUpdateDateTime: new Date().toISOString()
          }
        }, requestingUser || SYSTEM_CONTEXT, options);
      }
    }

    const [hydrated] = await hydrateApplicantRows([archived], options);
    return hydrated || archived;
  },

  async recoverApplicant(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getApplicantById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('PTE applicant not found or inaccessible.');

    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : buildCreatorSnapshot(requestingUser, existing.orgId);
    const audit = buildAuditSnapshot(creator, existing.audit || {}, { isUpdate: true });

    const recovered = await pteApplicantRepository.update(existing.id, {
      status: 'active',
      globalAcademicStatus: cleanString(existing.globalAcademicStatus, { max: 80, allowEmpty: true }) === 'Archived'
        ? 'Active'
        : existing.globalAcademicStatus,
      audit
    }, {
      backendMode: options?.backendMode
    });

    if (existing.userId) {
      const linkedUser = await dataService.getDataById('users', existing.userId, SYSTEM_CONTEXT, options);
      if (linkedUser) {
        await dataService.updateData('users', linkedUser.id, {
          ...linkedUser,
          active: true,
          status: 'active',
          audit: {
            ...(linkedUser.audit || {}),
            lastUpdateUser: toPublicId(requestingUser?.id) || String(requestingUser?.username || 'SYSTEM'),
            lastUpdateDateTime: new Date().toISOString()
          }
        }, requestingUser || SYSTEM_CONTEXT, options);
      }
    }

    const [hydrated] = await hydrateApplicantRows([recovered], options);
    return hydrated || recovered;
  },

  async updateApplicantAttachments(id, attachments = [], requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getApplicantById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('PTE applicant not found or inaccessible.');

    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : buildCreatorSnapshot(requestingUser, existing.orgId);
    const audit = buildAuditSnapshot(creator, existing.audit || {}, { isUpdate: true });

    const updated = await pteApplicantRepository.update(existing.id, {
      attachments: Array.isArray(attachments) ? attachments : [],
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });

    const [hydrated] = await hydrateApplicantRows([updated], options);
    return hydrated || updated;
  },

  async listPickerPersons(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const normalizedQuery = normalizeQueryOptions(query || {});
    const prefilteredQuery = {};
    if (visibility.mode !== 'all' && visibility.activeOrgId) {
      prefilteredQuery['organizations.orgId__eq'] = visibility.activeOrgId;
    }
    if (visibility.mode === 'creator' && visibility.requesterUserId) {
      prefilteredQuery['creator.userId__eq'] = visibility.requesterUserId;
    }
    if (normalizedQuery?.q) prefilteredQuery.q = normalizedQuery.q;
    if (normalizedQuery?.type) prefilteredQuery.type = normalizedQuery.type;
    if (normalizedQuery?.searchFields) prefilteredQuery.searchFields = normalizedQuery.searchFields;
    if (normalizedQuery?.startDate) prefilteredQuery.startDate = normalizedQuery.startDate;
    if (normalizedQuery?.endDate) prefilteredQuery.endDate = normalizedQuery.endDate;
    const rows = await dataService.fetchData('persons', prefilteredQuery, SYSTEM_CONTEXT, options);
    const scopedRows = (Array.isArray(rows) ? rows : []).filter((row) => isVisiblePersonRow(row, visibility));
    const enhancedRows = scopedRows.map((row) => ({
      ...row,
      displayName: resolvePersonDisplayName(row || {}),
      email: resolvePrimaryEmail(row || {})
    }));

    return applyGenericFilter(enhancedRows, normalizedQuery, {
      defaultSearchFields: [
        'id',
        'displayName',
        'name.first',
        'name.last',
        'name.preferred',
        'contact.email',
        'contact.emails.email',
        'email'
      ],
      dateFields: ['audit.createDateTime', 'audit.lastUpdateDateTime']
    });
  },

  async listPickerPackages(query = {}, requestingUser, accessContext = {}, options = {}) {
    return packageDataService.listPickerPackages(query, requestingUser, accessContext, options);
  },

  async listPickerCourses(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const normalizedQuery = normalizeQueryOptions(stripPaginationFromQuery(query || {}));
    const scope = buildRepositoryScope(visibility);
    const paginationInput = normalizePagination(options?.pagination || {}, normalizedQuery);
    const paginated = options?.paginated === true || paginationInput.limit > 0;
    const queryToken = cleanString(normalizedQuery.q, { max: 220, allowEmpty: true }).toLowerCase();
    const hasComplexFilter = Boolean(
      queryToken
      || normalizedQuery.id__in
      || normalizedQuery.searchFields
      || normalizedQuery.type
      || normalizedQuery.term
    );

    if (paginated && !hasComplexFilter) {
      const [totalRows, rows] = await Promise.all([
        pteCourseRepository.count({
          query: {
            status__eq: 'active'
          },
          scope,
          backendMode: options?.backendMode
        }),
        pteCourseRepository.list({
          query: {
            status__eq: 'active'
          },
          scope,
          sort: { 'audit.createDateTime': -1, id: -1 },
          pagination: {
            page: paginationInput.page,
            limit: paginationInput.limit
          },
          projection: COURSE_PICKER_SOURCE_PROJECTION,
          backendMode: options?.backendMode
        })
      ]);

      const mappedRows = (Array.isArray(rows) ? rows : [])
        .filter((row) => isVisibleApplicantRow(row, visibility))
        .map((row) => ({
          id: toPublicId(row?.id || ''),
          name: cleanString(row?.name, { max: 220, allowEmpty: true }) || toPublicId(row?.id || '')
        }))
        .filter((row) => row.id);

      return {
        rows: mappedRows,
        pagination: buildPaginationMeta(totalRows, paginationInput.page, paginationInput.limit)
      };
    }

    const rows = await pteApplicantRepository.list({
      query: {},
      scope,
      sort: { 'audit.createDateTime': -1, id: -1 },
      backendMode: options?.backendMode
    });
    const visibleRows = (Array.isArray(rows) ? rows : []).filter((row) => isVisibleApplicantRow(row, visibility));
    const courseMap = new Map();
    visibleRows.forEach((row) => {
      const courses = Array.isArray(row?.courses) ? row.courses : [];
      courses.forEach((course) => {
        const id = cleanString(course?.id, { max: 120, allowEmpty: true }) || '';
        const name = cleanString(course?.name, { max: 180, allowEmpty: true }) || id;
        const key = id || name;
        if (!key) return;
        courseMap.set(key, {
          id,
          name: name || id
        });
      });
    });
    const allCourses = Array.from(courseMap.values());
    const filteredRows = applyGenericFilter(allCourses, normalizedQuery, {
      defaultSearchFields: ['id', 'name'],
      dateFields: []
    });
    if (!paginated) return filteredRows;

    const totalRows = filteredRows.length;
    const startIndex = Math.max(0, (paginationInput.page - 1) * paginationInput.limit);
    const endIndex = startIndex + paginationInput.limit;
    return {
      rows: filteredRows.slice(startIndex, endIndex),
      pagination: buildPaginationMeta(totalRows, paginationInput.page, paginationInput.limit)
    };
  },

  async listAssignmentsForApplicant(applicantId, options = {}) {
    return listAssignmentsForApplicant(applicantId, options);
  },

  async createPublicApplicantFromJoin(payload = {}, requestingUser, options = {}) {
    const input = isPlainObject(payload) ? payload : {};
    const orgId = toPublicId(input.orgId || '');
    const personId = toPublicId(input.personId || '');
    const userId = toPublicId(input.userId || '');
    if (!orgId || !personId || !userId) {
      throw new Error('Public applicant creation requires orgId, personId, and userId.');
    }

    const existingRows = await pteApplicantRepository.list({
      query: {
        orgId__eq: orgId,
        userId__eq: userId,
        limit: 5
      },
      scope: { canViewAll: true },
      sort: { 'audit.createDateTime': -1, id: -1 },
      backendMode: options?.backendMode
    });
    const existing = Array.isArray(existingRows) ? existingRows[0] : null;
    const applicantId = cleanString(input.applicantId, { max: 120, allowEmpty: true });

    if (existing?.id) {
      const creator = isPlainObject(existing.creator)
        ? existing.creator
        : buildCreatorSnapshot(requestingUser, orgId);
      const audit = buildAuditSnapshot(creator, existing.audit || {}, { isUpdate: true });
      const updated = await pteApplicantRepository.update(existing.id, {
        orgId,
        personId,
        userId,
        applicantId: applicantId || existing.applicantId || '',
        personRoleToken: PERSON_ROLE_PUBLIC_TOKEN,
        status: normalizeStatus(input.status || existing.status || 'active'),
        creator,
        audit
      }, {
        backendMode: options?.backendMode
      });
      const [hydrated] = await hydrateApplicantRows([updated], options);
      return hydrated || updated;
    }

    const creator = buildCreatorSnapshot(requestingUser, orgId);
    const audit = buildAuditSnapshot(creator, null, { isUpdate: false });
    const created = await pteApplicantRepository.create({
      orgId,
      personId,
      userId,
      applicantId: applicantId || '',
      courses: [],
      countryOfOrigin: cleanString(input.countryOfOrigin, { max: 120, allowEmpty: true }) || '',
      localId: cleanString(input.localId, { max: 120, allowEmpty: true }) || '',
      admissionsNotes: cleanString(input.admissionsNotes, { max: 4000, allowEmpty: true }) || '',
      globalAcademicStatus: cleanString(input.globalAcademicStatus, { max: 80, allowEmpty: true }) || 'Active',
      selectedPackages: [],
      packageAssignmentIds: [],
      status: normalizeStatus(input.status || 'active'),
      attachments: [],
      personRoleToken: PERSON_ROLE_PUBLIC_TOKEN,
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });
    const [hydrated] = await hydrateApplicantRows([created], options);
    return hydrated || created;
  },

  async promotePublicApplicant(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getApplicantById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('PTE applicant not found or inaccessible.');
    if (!isPublicApplicantRoleToken(existing.personRoleToken || '')) {
      throw new Error('Only public applicants can be promoted.');
    }

    const person = await dataService.getDataById('persons', existing.personId, SYSTEM_CONTEXT, { enrichment: { includeSchoolRoles: false } });
    if (!person) throw new Error('Linked person record was not found.');

    const orgId = toPublicId(existing.orgId || '');
    const organizations = Array.isArray(person.organizations) ? person.organizations.map((row) => ({ ...row })) : [];
    const targetIdx = organizations.findIndex((row) => idsEqual(row?.orgId, orgId));
    if (targetIdx < 0) throw new Error('Linked person organization membership was not found.');

    const targetOrg = { ...organizations[targetIdx] };
    const roles = normalizeOrgRoles(targetOrg);
    if (!roles.includes('pte_student')) roles.push('pte_student');
    if (PERSON_ORG_ROLE_TOKEN && !roles.includes(PERSON_ORG_ROLE_TOKEN)) roles.push(PERSON_ORG_ROLE_TOKEN);
    if (!roles.includes('member')) roles.unshift('member');
    targetOrg.roles = Array.from(new Set(roles));
    targetOrg.role = getPrimaryOrgRole(targetOrg);
    organizations[targetIdx] = targetOrg;

    await dataService.updateData('persons', person.id, {
      ...person,
      organizations
    }, requestingUser || SYSTEM_CONTEXT, options);

    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : buildCreatorSnapshot(requestingUser, existing.orgId);
    const audit = buildAuditSnapshot(creator, existing.audit || {}, { isUpdate: true });
    const updated = await pteApplicantRepository.update(existing.id, {
      personRoleToken: PERSON_ROLE_TOKEN,
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });
    const [hydrated] = await hydrateApplicantRows([updated], options);
    return hydrated || updated;
  }
};

module.exports = pteStudentDataService;
