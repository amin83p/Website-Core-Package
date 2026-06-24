const bcrypt = require('bcrypt');
const pteTeacherRepository = require('../../repositories/pteTeacherRepository');
const pteCourseRepository = require('../../repositories/pteCourseRepository');
const {
  activityQuotaLedgerService,
  dataService,
  adminChekersService,
  SECTIONS,
  OPERATIONS,
  normalizeQueryOptions,
  resolveEntity,
  assertCreateOrgContextOrThrow,
  getActiveOrgIdOrThrow,
  normalizeOrgRoles,
  getPrimaryOrgRole,
  resolveCanonicalOrganizationName,
  settingService,
  SYSTEM_CONTEXT
} = require('./pteCoreContracts');
const { applyGenericFilter } = require('../../utils/queryEngine');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');

const PERSON_ROLE_TOKEN = 'PTE_Teacher';
const PERSON_ORG_ROLE_TOKEN = 'pte_teacher';
const ORGANIZATION_SCOPE_NAMES = new Set(['ADMIN', 'GLOBAL', 'ORGANIZATION', 'ORG']);
const STATUS_VALUES = new Set(['active', 'archived']);

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
  if (STATUS_VALUES.has(token)) return token;
  return fallback;
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

const TEACHER_LIST_PROJECTION = Object.freeze({
  id: 1,
  orgId: 1,
  personId: 1,
  userId: 1,
  teacherId: 1,
  notes: 1,
  courses: 1,
  status: 1,
  personRoleToken: 1,
  creator: 1,
  audit: 1
});

const TEACHER_PICKER_SOURCE_PROJECTION = Object.freeze({
  id: 1,
  orgId: 1,
  personId: 1,
  userId: 1,
  teacherId: 1,
  status: 1,
  creator: 1,
  audit: 1
});

const COURSE_PICKER_SOURCE_PROJECTION = Object.freeze({
  id: 1,
  orgId: 1,
  name: 1,
  status: 1,
  creator: 1,
  audit: 1
});

function normalizeIdList(values) {
  const rows = normalizeList(values);
  const out = [];
  const seen = new Set();
  rows.forEach((value) => {
    const id = toPublicId(isPlainObject(value) ? (value.id || value.teacherId || value.courseId || '') : value);
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

async function isPteSectionAdmin(requestingUser, sectionId, operationId = OPERATIONS.READ_ALL) {
  return adminChekersService.isAdminForRequestAsync(requestingUser, sectionId, operationId, {
    orgId: resolveActiveOrgId(requestingUser),
    section: { id: sectionId, category: 'PTE' }
  });
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

  if (await isPteSectionAdmin(requestingUser, SECTIONS.PTE_TEACHERS)) {
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

function isVisibleTeacherRow(row, visibility) {
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
  return preferred || full || cleanString(person?.id, { max: 120, allowEmpty: true }) || 'Teacher';
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

async function ensureTeacherUserAccount(person, activeOrgId, requestingUser, options = {}) {
  if (!person?.id) throw new Error('Person id is required to create teacher user account.');

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
  if (!email) throw new Error('Selected person has no email; cannot create teacher user account.');

  const duplicateByEmail = await dataService.fetchData('users', {
    q: email,
    type: 'exact_match',
    searchFields: 'email',
    page: 1,
    limit: 5
  }, SYSTEM_CONTEXT, options);
  if (Array.isArray(duplicateByEmail) && duplicateByEmail.some((row) => !idsEqual(row?.personId, person.id))) {
    throw new Error(`Cannot auto-create teacher user because email '${email}' is already used.`);
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

function sanitizeTeacherPayload(payload = {}, options = {}) {
  const input = isPlainObject(payload) ? payload : {};
  const existing = isPlainObject(options.existing) ? options.existing : {};

  return {
    teacherId: cleanString(input.teacherId || existing.teacherId, { max: 120, allowEmpty: true }) || '',
    notes: cleanString(input.notes || existing.notes, { max: 4000, allowEmpty: true }) || '',
    courses: sanitizeCourseRows(input.courses !== undefined ? input.courses : existing.courses || []),
    status: normalizeStatus(input.status || existing.status || 'active')
  };
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

async function hydrateTeacherRows(rows = [], options = {}) {
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
    return {
      ...row,
      display: {
        personName: resolvePersonDisplayName(person || {}),
        personId: toPublicId(row?.personId || ''),
        userName: cleanString(user?.username || user?.email, { max: 180, allowEmpty: true }) || '',
        userId: toPublicId(row?.userId || ''),
        email: cleanString(user?.email, { max: 220, allowEmpty: true }) || resolvePrimaryEmail(person || {})
      }
    };
  });
}

function mapTeacherPickerRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const userId = toPublicId(row?.userId || '');
    const personId = toPublicId(row?.personId || '');
    const fallbackId = toPublicId(row?.id || '');
    const pickerId = userId || personId || fallbackId;
    const displayName = cleanString(row?.display?.personName, { max: 220, allowEmpty: true })
      || cleanString(row?.teacherId, { max: 120, allowEmpty: true })
      || pickerId;
    return {
      id: pickerId,
      type: 'user',
      name: displayName,
      displayName,
      email: cleanString(row?.display?.email, { max: 220, allowEmpty: true }) || '',
      orgId: toPublicId(row?.orgId || ''),
      teacherRecordId: toPublicId(row?.id || ''),
      teacherId: cleanString(row?.teacherId, { max: 120, allowEmpty: true }) || '',
      userId,
      personId
    };
  }).filter((row) => row.id);
}

async function assertUniqueTeacherPerson(orgId, personId, { excludeId = '', backendMode = undefined } = {}) {
  const rows = await pteTeacherRepository.list({
    query: {
      orgId__eq: toPublicId(orgId),
      personId__eq: toPublicId(personId)
    },
    scope: { canViewAll: true },
    backendMode
  });
  const duplicate = (Array.isArray(rows) ? rows : []).find((row) => {
    if (!excludeId) return true;
    return !idsEqual(row?.id, excludeId);
  });
  if (duplicate) throw new Error('A PTE teacher record already exists for this person in the active organization.');
}

const pteTeacherDataService = {
  PERSON_ROLE_TOKEN,

  async assertCreateContext(requestingUser) {
    return assertCreateOrgContextOrThrow(requestingUser, { scopeLabel: 'PTE teachers' });
  },

  async listTeachers(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const normalizedQuery = normalizeQueryOptions(query || {});
    const listQuery = stripPaginationFromQuery(normalizedQuery);
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
      : TEACHER_LIST_PROJECTION;
    const paginationInput = normalizePagination(
      options?.pagination || {},
      normalizedQuery
    );
    const paginated = options?.paginated === true || paginationInput.limit > 0;

    if (paginated) {
      const [totalRows, rows] = await Promise.all([
        pteTeacherRepository.count({
          query: listQuery,
          scope,
          backendMode: options?.backendMode
        }),
        pteTeacherRepository.list({
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

      const visibleRows = (Array.isArray(rows) ? rows : []).filter((row) => isVisibleTeacherRow(row, visibility));
      const hydratedRows = await hydrateTeacherRows(visibleRows, options);
      return {
        rows: hydratedRows,
        totalRows: Math.max(totalRows, hydratedRows.length),
        pagination: buildPaginationMeta(totalRows, paginationInput.page, paginationInput.limit)
      };
    }

    const rows = await pteTeacherRepository.list({
      query: listQuery,
      scope,
      sort,
      projection,
      backendMode: options?.backendMode
    });
    const visibleRows = (Array.isArray(rows) ? rows : []).filter((row) => isVisibleTeacherRow(row, visibility));
    return hydrateTeacherRows(visibleRows, options);
  },

  async getTeacherById(id, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const row = await pteTeacherRepository.getById(id, { backendMode: options?.backendMode });
    if (!row || !isVisibleTeacherRow(row, visibility)) return null;
    const [hydrated] = await hydrateTeacherRows([row], options);
    return hydrated || row;
  },

  async createTeacher(payload = {}, requestingUser, accessContext = {}, options = {}) {
    const activeOrgId = await this.assertCreateContext(requestingUser);
    await this.resolveReadVisibility(requestingUser, accessContext);

    const person = await ensurePersonFromPayload(payload, requestingUser, activeOrgId, options);
    const userAccount = await ensureTeacherUserAccount(person, activeOrgId, requestingUser, options);
    await assertUniqueTeacherPerson(activeOrgId, person?.id, { backendMode: options?.backendMode });

    const creator = buildCreatorSnapshot(requestingUser, activeOrgId);
    const audit = buildAuditSnapshot(creator, null, { isUpdate: false });
    const sanitized = sanitizeTeacherPayload(payload);

    const created = await pteTeacherRepository.create({
      orgId: activeOrgId,
      personId: toPublicId(person?.id || ''),
      userId: toPublicId(userAccount?.user?.id || ''),
      teacherId: sanitized.teacherId,
      notes: sanitized.notes,
      courses: sanitized.courses,
      status: sanitized.status,
      personRoleToken: PERSON_ROLE_TOKEN,
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });

    const [hydrated] = await hydrateTeacherRows([created], options);
    return {
      teacher: hydrated || created,
      autoUserCreated: userAccount.created === true,
      tempPassword: userAccount.tempPassword || null
    };
  },

  async updateTeacher(id, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getTeacherById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('PTE teacher not found or inaccessible.');

    const activeOrgId = getActiveOrgIdOrThrow(requestingUser);
    if (!adminChekersService.isSuperAdmin(requestingUser) && !idsEqual(existing.orgId, activeOrgId)) {
      throw new Error('Active organization does not match this teacher.');
    }

    const person = await ensurePersonFromPayload({
      personMode: 'existing',
      personId: existing.personId
    }, requestingUser, existing.orgId, options);
    const userAccount = await ensureTeacherUserAccount(person, existing.orgId, requestingUser, options);
    await assertUniqueTeacherPerson(existing.orgId, person?.id, { excludeId: existing.id, backendMode: options?.backendMode });

    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : buildCreatorSnapshot(requestingUser, existing.orgId);
    const audit = buildAuditSnapshot(creator, existing.audit || {}, { isUpdate: true });
    const sanitized = sanitizeTeacherPayload(payload, { existing });

    const updated = await pteTeacherRepository.update(existing.id, {
      personId: toPublicId(person?.id || existing.personId),
      userId: toPublicId(userAccount?.user?.id || existing.userId || ''),
      teacherId: sanitized.teacherId,
      notes: sanitized.notes,
      courses: sanitized.courses,
      status: sanitized.status,
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });

    const [hydrated] = await hydrateTeacherRows([updated], options);
    return {
      teacher: hydrated || updated,
      autoUserCreated: userAccount.created === true,
      tempPassword: userAccount.tempPassword || null
    };
  },

  async archiveTeacher(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getTeacherById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('PTE teacher not found or inaccessible.');

    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : buildCreatorSnapshot(requestingUser, existing.orgId);
    const audit = buildAuditSnapshot(creator, existing.audit || {}, { isUpdate: true });

    const archived = await pteTeacherRepository.update(existing.id, {
      status: 'archived',
      audit
    }, {
      backendMode: options?.backendMode
    });

    const [hydrated] = await hydrateTeacherRows([archived], options);
    return hydrated || archived;
  },

  async recoverTeacher(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getTeacherById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('PTE teacher not found or inaccessible.');

    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : buildCreatorSnapshot(requestingUser, existing.orgId);
    const audit = buildAuditSnapshot(creator, existing.audit || {}, { isUpdate: true });

    const recovered = await pteTeacherRepository.update(existing.id, {
      status: 'active',
      audit
    }, {
      backendMode: options?.backendMode
    });

    const [hydrated] = await hydrateTeacherRows([recovered], options);
    return hydrated || recovered;
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
        .filter((row) => isVisibleTeacherRow(row, visibility))
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

    const rows = await pteCourseRepository.list({
      query: {},
      scope,
      sort: { 'audit.createDateTime': -1, id: -1 },
      projection: COURSE_PICKER_SOURCE_PROJECTION,
      backendMode: options?.backendMode
    });

    const mapped = (Array.isArray(rows) ? rows : [])
      .filter((row) => isVisibleTeacherRow(row, visibility))
      .filter((row) => normalizeStatus(row?.status || 'draft', 'draft') !== 'archived')
      .map((row) => ({
        id: toPublicId(row?.id || ''),
        name: cleanString(row?.name, { max: 220, allowEmpty: true }) || toPublicId(row?.id || '')
      }))
      .filter((row) => row.id);

    const filteredRows = applyGenericFilter(mapped, normalizedQuery, {
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

  async listPickerTeachers(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const normalizedQuery = normalizeQueryOptions(stripPaginationFromQuery(query || {}));
    const statusFilter = cleanString(normalizedQuery.status, { max: 30, allowEmpty: true }).toLowerCase();
    delete normalizedQuery.status;
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
      const repositoryQuery = {};
      repositoryQuery.status__eq = statusFilter || 'active';
      const [totalRows, rows] = await Promise.all([
        pteTeacherRepository.count({
          query: repositoryQuery,
          scope,
          backendMode: options?.backendMode
        }),
        pteTeacherRepository.list({
          query: repositoryQuery,
          scope,
          sort: { 'audit.createDateTime': -1, id: -1 },
          pagination: {
            page: paginationInput.page,
            limit: paginationInput.limit
          },
          projection: TEACHER_PICKER_SOURCE_PROJECTION,
          backendMode: options?.backendMode
        })
      ]);

      const visibleRows = (Array.isArray(rows) ? rows : []).filter((row) => isVisibleTeacherRow(row, visibility));
      const hydratedRows = await hydrateTeacherRows(visibleRows, options);
      return {
        rows: mapTeacherPickerRows(hydratedRows),
        pagination: buildPaginationMeta(totalRows, paginationInput.page, paginationInput.limit)
      };
    }

    const rows = await pteTeacherRepository.list({
      query: {},
      scope,
      sort: { 'audit.createDateTime': -1, id: -1 },
      projection: TEACHER_PICKER_SOURCE_PROJECTION,
      backendMode: options?.backendMode
    });

    const visibleRows = (Array.isArray(rows) ? rows : []).filter((row) => isVisibleTeacherRow(row, visibility));
    const filteredRows = (statusFilter
      ? visibleRows.filter((row) => normalizeStatus(row?.status || 'active') === statusFilter)
      : visibleRows.filter((row) => normalizeStatus(row?.status || 'active') !== 'archived'));

    const hydratedRows = await hydrateTeacherRows(filteredRows, options);
    const mapped = mapTeacherPickerRows(hydratedRows);

    const filteredMapped = applyGenericFilter(mapped, normalizedQuery, {
      defaultSearchFields: ['id', 'name', 'displayName', 'email', 'teacherId', 'userId', 'personId'],
      dateFields: []
    });
    if (!paginated) return filteredMapped;

    const totalRows = filteredMapped.length;
    const startIndex = Math.max(0, (paginationInput.page - 1) * paginationInput.limit);
    const endIndex = startIndex + paginationInput.limit;
    return {
      rows: filteredMapped.slice(startIndex, endIndex),
      pagination: buildPaginationMeta(totalRows, paginationInput.page, paginationInput.limit)
    };
  },

  async resolveReadVisibility(requestingUser, accessContext = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    return visibility;
  }
};

module.exports = pteTeacherDataService;

