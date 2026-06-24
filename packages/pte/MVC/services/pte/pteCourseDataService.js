const pteCourseRepository = require('../../repositories/pteCourseRepository');
const pteApplicantRepository = require('../../repositories/pteApplicantRepository');
const pteTeacherRepository = require('../../repositories/pteTeacherRepository');
const {
  adminChekersService,
  SECTIONS,
  OPERATIONS,
  activityQuotaLedgerService,
  dataService,
  normalizeQueryOptions,
  resolveEntity,
  applyGenericFilter,
  getActiveOrgIdOrThrow,
  idsEqual,
  toPublicId,
  assertCreateOrgContextOrThrow,
  settingService,
  normalizeOrgRoles
} = require('./pteCoreDependencies');

const ORGANIZATION_SCOPE_NAMES = new Set(['ADMIN', 'GLOBAL', 'ORGANIZATION', 'ORG']);
const STATUS_VALUES = new Set(['draft', 'active', 'closed', 'archived']);
const COURSE_TYPE_VALUES = new Set(['CORE', 'ACADEMIC']);
const PTE_STUDENT_ROLE_TOKENS = new Set(['pte_student']);
const PTE_TEACHER_ROLE_TOKENS = new Set(['pte_teacher', 'pte_instructor', 'pte_trainer']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function cleanDateOnly(value, { allowEmpty = true } = {}) {
  const token = cleanString(value, { max: 40, allowEmpty: true }) || '';
  if (!token) return allowEmpty ? '' : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) throw new Error('Date fields must use YYYY-MM-DD format.');
  return token;
}

function cleanIsoDateTime(value, { allowEmpty = false } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid datetime value.');
  return parsed.toISOString();
}

function cleanNonNegativeInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return Number(fallback || 0);
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric < 0) {
    throw new Error('Numeric value must be a non-negative integer.');
  }
  return numeric;
}

function normalizeStatus(value, fallback = 'draft') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (STATUS_VALUES.has(token)) return token;
  return fallback;
}

function normalizeCourseType(value, fallback = 'CORE') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toUpperCase();
  if (COURSE_TYPE_VALUES.has(token)) return token;
  const fallbackToken = cleanString(fallback, { max: 40, allowEmpty: true }).toUpperCase();
  if (COURSE_TYPE_VALUES.has(fallbackToken)) return fallbackToken;
  return 'CORE';
}

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function normalizeIdArray(value) {
  return normalizeList(value)
    .map((entry) => toPublicId(entry))
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

  if (await isPteSectionAdmin(requestingUser, SECTIONS.PTE_COURSES)) {
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

function isVisibleCourseRow(row, visibility) {
  if (!row) return false;
  if (visibility.mode === 'all') return true;
  if (!idsEqual(row?.orgId, visibility.activeOrgId)) return false;
  if (visibility.mode === 'org') return true;
  const creatorUserId = toPublicId(row?.creator?.userId || row?.audit?.createUser || '');
  return creatorUserId ? idsEqual(creatorUserId, visibility.requesterUserId) : false;
}

function isVisibleApplicantRow(row, visibility) {
  if (!row) return false;
  if (visibility.mode === 'all') return true;
  if (!idsEqual(row?.orgId, visibility.activeOrgId)) return false;
  if (visibility.mode === 'org') return true;
  const creatorUserId = toPublicId(row?.creator?.userId || row?.audit?.createUser || '');
  return creatorUserId ? idsEqual(creatorUserId, visibility.requesterUserId) : false;
}

function collectPersonOrgIds(person = {}) {
  const out = new Set();
  const add = (value) => {
    const id = toPublicId(value);
    if (id) out.add(id);
  };
  add(person?.orgId);
  const organizations = Array.isArray(person?.organizations) ? person.organizations : [];
  organizations.forEach((org) => {
    add(org?.orgId);
    add(org?.id);
  });
  return Array.from(out);
}

function isVisiblePersonRow(row, visibility) {
  if (!row) return false;
  if (visibility.mode === 'all') return true;
  const activeOrgId = toPublicId(visibility.activeOrgId);
  const orgIds = collectPersonOrgIds(row);
  if (!orgIds.some((orgId) => idsEqual(orgId, activeOrgId))) return false;
  if (visibility.mode === 'org') return true;
  const creatorUserId = toPublicId(row?.creator?.userId || row?.audit?.createUser || '');
  return creatorUserId ? idsEqual(creatorUserId, visibility.requesterUserId) : false;
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
  return Array.from(out);
}

function isVisibleUserRow(row, visibility) {
  if (!row) return false;
  if (visibility.mode === 'all') return true;
  const activeOrgId = toPublicId(visibility.activeOrgId);
  const orgIds = collectUserOrgIds(row);
  if (!orgIds.some((orgId) => idsEqual(orgId, activeOrgId))) return false;
  if (visibility.mode === 'org') return true;
  const creatorUserId = toPublicId(row?.creator?.userId || row?.audit?.createUser || '');
  return creatorUserId ? idsEqual(creatorUserId, visibility.requesterUserId) : false;
}

function normalizeRoleToken(value) {
  return String(value || '').trim().toLowerCase();
}

function hasAnyRoleToken(list, allowedTokens) {
  const rows = Array.isArray(list) ? list : [];
  return rows.some((token) => allowedTokens.has(normalizeRoleToken(token)));
}

function getOrgScopedRoleTokens(entity = {}, targetOrgId = '') {
  const orgToken = toPublicId(targetOrgId || '');
  const memberships = Array.isArray(entity?.organizations) ? entity.organizations : [];
  const out = [];

  memberships.forEach((org) => {
    const memberOrgId = toPublicId(org?.orgId || org?.id || '');
    if (orgToken && memberOrgId && !idsEqual(memberOrgId, orgToken)) return;
    const roles = normalizeOrgRoles(org);
    roles.forEach((role) => {
      const token = normalizeRoleToken(role);
      if (token) out.push(token);
    });
  });

  if (!orgToken && !out.length) {
    const fallbackRoles = normalizeOrgRoles(entity);
    fallbackRoles.forEach((role) => {
      const token = normalizeRoleToken(role);
      if (token) out.push(token);
    });
  }

  return Array.from(new Set(out));
}

function resolveUserDisplayName(user = {}) {
  return cleanString(user?.displayName || user?.username || user?.email, { max: 220, allowEmpty: true }) || '';
}

function hasStrictPteStudentApplicantToken(applicantRow = {}) {
  const applicantRole = normalizeRoleToken(applicantRow?.personRoleToken || '');
  return PTE_STUDENT_ROLE_TOKENS.has(applicantRole);
}

function hasPteTeacherRole(userRow = {}, targetOrgId = '') {
  const roles = getOrgScopedRoleTokens(userRow, targetOrgId);
  return hasAnyRoleToken(roles, PTE_TEACHER_ROLE_TOKENS);
}

function toMemberSnapshot(row = {}, { defaultType = 'person', includeMembershipStatus = false, addedBy = 'System' } = {}) {
  const id = toPublicId(row?.id || row?.personId || row?.userId || row?.applicantId || '');
  if (!id) return null;
  const snapshot = {
    type: cleanString(row?.type, { max: 60, allowEmpty: true }).toLowerCase() || defaultType,
    id,
    displayName: cleanString(row?.displayName || row?.name, { max: 220, allowEmpty: true }) || id,
    email: cleanString(row?.email, { max: 220, allowEmpty: true }) || '',
    addedDate: cleanIsoDateTime(row?.addedDate, { allowEmpty: true }) || new Date().toISOString(),
    addedBy: cleanString(row?.addedBy, { max: 120, allowEmpty: true }) || addedBy
  };
  if (includeMembershipStatus) {
    snapshot.membershipStatus = cleanString(row?.membershipStatus, { max: 60, allowEmpty: true }) || 'active';
  }
  return snapshot;
}

function sanitizeSnapshotArray(rows = [], options = {}) {
  const out = [];
  const seen = new Set();
  normalizeList(rows).forEach((raw) => {
    const row = isPlainObject(raw) ? raw : { id: raw };
    const normalized = toMemberSnapshot(row, options);
    if (!normalized) return;
    const key = `${normalized.type}:${normalized.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

function buildAuditFromCreator(creator, existingAudit = {}, options = {}) {
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

function buildPersonDisplayName(person = {}) {
  const preferred = cleanString(person?.name?.preferred, { max: 180, allowEmpty: true }) || '';
  const first = cleanString(person?.name?.first, { max: 120, allowEmpty: true }) || '';
  const last = cleanString(person?.name?.last, { max: 120, allowEmpty: true }) || '';
  const full = `${first} ${last}`.trim();
  return preferred || full || cleanString(person?.id, { max: 120, allowEmpty: true }) || 'Person';
}

function resolvePersonEmail(person = {}) {
  const direct = cleanString(person?.contact?.email, { max: 220, allowEmpty: true }) || '';
  if (direct) return direct;
  const emails = Array.isArray(person?.contact?.emails) ? person.contact.emails : [];
  for (const row of emails) {
    const email = cleanString(row?.email, { max: 220, allowEmpty: true }) || '';
    if (email) return email;
  }
  return '';
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

const COURSE_LIST_PROJECTION = Object.freeze({
  id: 1,
  orgId: 1,
  code: 1,
  name: 1,
  description: 1,
  startDate: 1,
  endDate: 1,
  status: 1,
  courseType: 1,
  level: 1,
  maxStudents: 1,
  teachers: 1,
  students: 1,
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

const STUDENT_PICKER_SOURCE_PROJECTION = Object.freeze({
  id: 1,
  orgId: 1,
  personId: 1,
  userId: 1,
  applicantId: 1,
  personRoleToken: 1,
  status: 1,
  creator: 1,
  audit: 1
});

function toSummary(row = {}) {
  const teachers = Array.isArray(row?.teachers) ? row.teachers : [];
  const students = Array.isArray(row?.students) ? row.students : [];
  const courseType = normalizeCourseType(row?.courseType || row?.level, 'CORE');
  return {
    ...row,
    courseType,
    // Keep legacy `level` aligned for backward compatibility with older views/filters.
    level: courseType,
    summary: {
      teacherCount: teachers.length,
      studentCount: students.length
    }
  };
}

function sanitizeCoursePayload(payload = {}, { existing = null, requestingUser = null } = {}) {
  const source = isPlainObject(payload) ? payload : {};
  const current = isPlainObject(existing) ? existing : {};
  const addedBy = toPublicId(requestingUser?.id) || 'System';

  const name = cleanString(source.name, { max: 220, allowEmpty: true })
    || cleanString(current.name, { max: 220, allowEmpty: true });
  if (!name) throw new Error('Course name is required.');

  const startDate = cleanDateOnly(
    source.startDate !== undefined ? source.startDate : current.startDate,
    { allowEmpty: true }
  ) || '';
  const endDate = cleanDateOnly(
    source.endDate !== undefined ? source.endDate : current.endDate,
    { allowEmpty: true }
  ) || '';
  if (startDate && endDate && endDate < startDate) {
    throw new Error('Course end date cannot be earlier than start date.');
  }

  const code = (cleanString(source.code, { max: 120, allowEmpty: true })
    || cleanString(current.code, { max: 120, allowEmpty: true })
    || '').toUpperCase();
  const courseType = normalizeCourseType(
    source.courseType !== undefined ? source.courseType : source.level,
    normalizeCourseType(
      current.courseType !== undefined ? current.courseType : current.level,
      'CORE'
    )
  );

  return {
    code,
    name,
    description: cleanString(source.description, { max: 4000, allowEmpty: true })
      || cleanString(current.description, { max: 4000, allowEmpty: true })
      || '',
    startDate,
    endDate,
    status: normalizeStatus(source.status, normalizeStatus(current.status, 'draft')),
    courseType,
    // Keep legacy `level` key aligned for backward compatibility.
    level: courseType,
    maxStudents: cleanNonNegativeInteger(
      source.maxStudents !== undefined ? source.maxStudents : current.maxStudents,
      current.maxStudents || 0
    ),
    teachers: sanitizeSnapshotArray(
      source.teachers !== undefined ? source.teachers : current.teachers || [],
      { defaultType: 'person', includeMembershipStatus: false, addedBy }
    ),
    students: sanitizeSnapshotArray(
      source.students !== undefined ? source.students : current.students || [],
      { defaultType: 'applicant', includeMembershipStatus: true, addedBy }
    )
  };
}

function filterByDateWindow(rows = [], fromDate = '', toDate = '') {
  const from = cleanDateOnly(fromDate, { allowEmpty: true }) || '';
  const to = cleanDateOnly(toDate, { allowEmpty: true }) || '';
  if (!from && !to) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const start = cleanDateOnly(row?.startDate, { allowEmpty: true }) || '';
    const end = cleanDateOnly(row?.endDate, { allowEmpty: true }) || '';
    if (from && end && end < from) return false;
    if (to && start && start > to) return false;
    return true;
  });
}

function filterByMemberIds(rows = [], memberIds = [], fieldName = 'teachers') {
  const targetIds = new Set(normalizeIdArray(memberIds));
  if (!targetIds.size) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const members = Array.isArray(row?.[fieldName]) ? row[fieldName] : [];
    return members.some((member) => targetIds.has(toPublicId(member?.id || '')));
  });
}

async function assertUniqueCodePerOrg(orgId, code, { excludeId = '', backendMode = undefined } = {}) {
  const targetCode = cleanString(code, { max: 120, allowEmpty: true }).toUpperCase() || '';
  if (!targetCode) return;
  const rows = await pteCourseRepository.list({
    query: { orgId__eq: orgId },
    scope: { canViewAll: true },
    backendMode
  });
  const dup = (Array.isArray(rows) ? rows : []).find((row) => {
    if (excludeId && idsEqual(row?.id, excludeId)) return false;
    return String(row?.code || '').trim().toUpperCase() === targetCode;
  });
  if (dup) throw new Error(`Course code '${targetCode}' already exists in this organization.`);
}

const pteCourseDataService = {
  async assertCreateContext(requestingUser) {
    return assertCreateOrgContextOrThrow(requestingUser, { scopeLabel: 'PTE courses' });
  },

  getFormOptions() {
    return {
      statuses: [
        { value: 'draft', label: 'Draft' },
        { value: 'active', label: 'Active' },
        { value: 'closed', label: 'Closed' },
        { value: 'archived', label: 'Archived' }
      ],
      courseTypes: [
        { value: 'CORE', label: 'CORE' },
        { value: 'ACADEMIC', label: 'ACADEMIC' }
      ]
    };
  },

  async listCourses(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const normalizedQuery = normalizeQueryOptions(query || {});
    const listQuery = stripPaginationFromQuery(normalizedQuery);

    const teacherIds = normalizeIdArray(
      listQuery.teacherIds !== undefined ? listQuery.teacherIds : listQuery.teacherId
    );
    const studentIds = normalizeIdArray(
      listQuery.studentIds !== undefined ? listQuery.studentIds : listQuery.studentId
    );
    const dateFrom = cleanDateOnly(
      listQuery.dateFrom !== undefined ? listQuery.dateFrom : listQuery.startDateFrom,
      { allowEmpty: true }
    ) || '';
    const dateTo = cleanDateOnly(
      listQuery.dateTo !== undefined ? listQuery.dateTo : listQuery.endDateTo,
      { allowEmpty: true }
    ) || '';

    delete listQuery.teacherIds;
    delete listQuery.teacherId;
    delete listQuery.studentIds;
    delete listQuery.studentId;
    delete listQuery.dateFrom;
    delete listQuery.dateTo;
    delete listQuery.startDateFrom;
    delete listQuery.endDateTo;

    const statusFilter = cleanString(
      listQuery.status__eq || listQuery.status || '',
      { max: 40, allowEmpty: true }
    ).toLowerCase();
    delete listQuery.status;
    if (statusFilter) listQuery.status__eq = normalizeStatus(statusFilter, statusFilter);

    const scope = buildRepositoryScope(visibility);
    const sort = options?.sort || { 'audit.createDateTime': -1, id: -1 };
    const projection = (options?.projection && isPlainObject(options.projection))
      ? options.projection
      : COURSE_LIST_PROJECTION;
    const paginationInput = normalizePagination(
      options?.pagination || {},
      normalizedQuery
    );
    const paginated = options?.paginated === true || paginationInput.limit > 0;
    const needsPostFilter = teacherIds.length > 0 || studentIds.length > 0 || Boolean(dateFrom) || Boolean(dateTo);

    if (paginated && !needsPostFilter) {
      const [totalRows, rows] = await Promise.all([
        pteCourseRepository.count({
          query: listQuery,
          scope,
          backendMode: options?.backendMode
        }),
        pteCourseRepository.list({
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

      const scopedRows = (Array.isArray(rows) ? rows : []).filter((row) => isVisibleCourseRow(row, visibility));
      return {
        rows: scopedRows.map((row) => toSummary(row)),
        totalRows: Math.max(totalRows, scopedRows.length),
        pagination: buildPaginationMeta(totalRows, paginationInput.page, paginationInput.limit)
      };
    }

    const rows = await pteCourseRepository.list({
      query: listQuery,
      scope,
      sort,
      projection,
      backendMode: options?.backendMode
    });

    let scopedRows = (Array.isArray(rows) ? rows : []).filter((row) => isVisibleCourseRow(row, visibility));
    scopedRows = filterByMemberIds(scopedRows, teacherIds, 'teachers');
    scopedRows = filterByMemberIds(scopedRows, studentIds, 'students');
    scopedRows = filterByDateWindow(scopedRows, dateFrom, dateTo);
    const mappedRows = scopedRows.map((row) => toSummary(row));

    if (!paginated) return mappedRows;

    const totalRows = mappedRows.length;
    const startIndex = paginationInput.limit > 0
      ? Math.max(0, (paginationInput.page - 1) * paginationInput.limit)
      : 0;
    const endIndex = paginationInput.limit > 0
      ? startIndex + paginationInput.limit
      : mappedRows.length;
    return {
      rows: mappedRows.slice(startIndex, endIndex),
      totalRows,
      pagination: buildPaginationMeta(totalRows, paginationInput.page, paginationInput.limit)
    };
  },

  async getCourseById(id, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const row = await pteCourseRepository.getById(id, {
      backendMode: options?.backendMode
    });
    if (!row || !isVisibleCourseRow(row, visibility)) return null;
    return toSummary(row);
  },

  async createCourse(payload = {}, requestingUser, accessContext = {}, options = {}) {
    const activeOrgId = await this.assertCreateContext(requestingUser);
    await this.resolveReadVisibility(requestingUser, accessContext);

    const sanitized = sanitizeCoursePayload(payload, { requestingUser });
    await assertUniqueCodePerOrg(activeOrgId, sanitized.code, { backendMode: options?.backendMode });

    const creator = activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, activeOrgId)
      || activityQuotaLedgerService.createSystemCreatorSnapshot(activeOrgId);
    const audit = buildAuditFromCreator(creator, null, { isUpdate: false });

    const created = await pteCourseRepository.create({
      orgId: activeOrgId,
      ...sanitized,
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });
    return toSummary(created);
  },

  async updateCourse(id, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getCourseById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('PTE course not found or inaccessible.');

    const activeOrgId = getActiveOrgIdOrThrow(requestingUser);
    if (!adminChekersService.isSuperAdmin(requestingUser) && !idsEqual(existing.orgId, activeOrgId)) {
      throw new Error('Active organization does not match this course.');
    }

    const sanitized = sanitizeCoursePayload(payload, { existing, requestingUser });
    await assertUniqueCodePerOrg(existing.orgId, sanitized.code, {
      excludeId: existing.id,
      backendMode: options?.backendMode
    });

    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : (activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, existing.orgId)
        || activityQuotaLedgerService.createSystemCreatorSnapshot(existing.orgId));
    const audit = buildAuditFromCreator(creator, existing.audit || {}, { isUpdate: true });

    const updated = await pteCourseRepository.update(existing.id, {
      ...sanitized,
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });
    return toSummary(updated);
  },

  async archiveCourse(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getCourseById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('PTE course not found or inaccessible.');

    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : (activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, existing.orgId)
        || activityQuotaLedgerService.createSystemCreatorSnapshot(existing.orgId));
    const audit = buildAuditFromCreator(creator, existing.audit || {}, { isUpdate: true });

    const updated = await pteCourseRepository.update(existing.id, {
      status: 'archived',
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });
    return toSummary(updated);
  },

  async recoverCourse(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getCourseById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('PTE course not found or inaccessible.');

    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : (activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, existing.orgId)
        || activityQuotaLedgerService.createSystemCreatorSnapshot(existing.orgId));
    const audit = buildAuditFromCreator(creator, existing.audit || {}, { isUpdate: true });
    const nextStatus = normalizeStatus(existing.status, 'draft') === 'archived' ? 'active' : normalizeStatus(existing.status, 'active');

    const updated = await pteCourseRepository.update(existing.id, {
      status: nextStatus,
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });
    return toSummary(updated);
  },

  async listPickerTeachers(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const normalizedQuery = normalizeQueryOptions(stripPaginationFromQuery(query || {}));
    const statusFilter = cleanString(normalizedQuery.status, { max: 40, allowEmpty: true }).toLowerCase();
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

      const teachers = (Array.isArray(rows) ? rows : [])
        .filter((row) => isVisibleCourseRow(row, visibility));

      const personIds = Array.from(new Set(
        teachers.map((row) => toPublicId(row?.personId || '')).filter(Boolean)
      ));
      const userIds = Array.from(new Set(
        teachers.map((row) => toPublicId(row?.userId || '')).filter(Boolean)
      ));
      const [personRows, userRows] = await Promise.all([
        personIds.length
          ? dataService.fetchData(
            'persons',
            { id__in: personIds.join(','), limit: Math.max(personIds.length, 200) },
            requestingUser,
            options?.backendMode ? { backendMode: options.backendMode } : {}
          )
          : [],
        userIds.length
          ? dataService.fetchData(
            'users',
            { id__in: userIds.join(','), limit: Math.max(userIds.length, 200) },
            requestingUser,
            options?.backendMode ? { backendMode: options.backendMode } : {}
          )
          : []
      ]);

      const personMap = new Map((Array.isArray(personRows) ? personRows : []).map((row) => [toPublicId(row?.id || ''), row]));
      const userMap = new Map((Array.isArray(userRows) ? userRows : []).map((row) => [toPublicId(row?.id || ''), row]));
      const mappedRows = teachers
        .map((row) => {
          const person = personMap.get(toPublicId(row?.personId || '')) || {};
          const user = userMap.get(toPublicId(row?.userId || '')) || {};
          const userId = toPublicId(row?.userId || user?.id || '');
          const personId = toPublicId(row?.personId || person?.id || '');
          const pickerId = userId || personId || toPublicId(row?.id || '');
          const personName = buildPersonDisplayName(person);
          const userName = resolveUserDisplayName(user);
          const displayName = personName || userName || cleanString(row?.teacherId, { max: 120, allowEmpty: true }) || pickerId;
          return {
            id: pickerId,
            type: 'user',
            name: displayName,
            displayName,
            email: cleanString(user?.email, { max: 220, allowEmpty: true }) || resolvePersonEmail(person),
            orgId: toPublicId(row?.orgId || ''),
            teacherRecordId: toPublicId(row?.id || ''),
            teacherId: cleanString(row?.teacherId, { max: 120, allowEmpty: true }) || '',
            userId,
            personId
          };
        })
        .filter((row) => row.id);

      return {
        rows: mappedRows,
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

    const teachers = (Array.isArray(rows) ? rows : [])
      .filter((row) => isVisibleCourseRow(row, visibility))
      .filter((row) => {
        const status = cleanString(row?.status, { max: 40, allowEmpty: true }).toLowerCase() || 'active';
        if (statusFilter) return status === statusFilter;
        return status !== 'archived';
      });

    const personIds = Array.from(new Set(
      teachers.map((row) => toPublicId(row?.personId || '')).filter(Boolean)
    ));
    const userIds = Array.from(new Set(
      teachers.map((row) => toPublicId(row?.userId || '')).filter(Boolean)
    ));

    const [personRows, userRows] = await Promise.all([
      personIds.length
        ? dataService.fetchData(
          'persons',
          { id__in: personIds.join(','), limit: Math.max(personIds.length, 500) },
          requestingUser,
          options?.backendMode ? { backendMode: options.backendMode } : {}
        )
        : [],
      userIds.length
        ? dataService.fetchData(
          'users',
          { id__in: userIds.join(','), limit: Math.max(userIds.length, 500) },
          requestingUser,
          options?.backendMode ? { backendMode: options.backendMode } : {}
        )
        : []
    ]);

    const personMap = new Map((Array.isArray(personRows) ? personRows : []).map((row) => [toPublicId(row?.id || ''), row]));
    const userMap = new Map((Array.isArray(userRows) ? userRows : []).map((row) => [toPublicId(row?.id || ''), row]));

    const mapped = teachers
      .map((row) => {
        const person = personMap.get(toPublicId(row?.personId || '')) || {};
        const user = userMap.get(toPublicId(row?.userId || '')) || {};
        const userId = toPublicId(row?.userId || user?.id || '');
        const personId = toPublicId(row?.personId || person?.id || '');
        const pickerId = userId || personId || toPublicId(row?.id || '');
        const personName = buildPersonDisplayName(person);
        const userName = resolveUserDisplayName(user);
        const displayName = personName || userName || cleanString(row?.teacherId, { max: 120, allowEmpty: true }) || pickerId;
        return {
          id: pickerId,
          type: 'user',
          name: displayName,
          displayName,
          email: cleanString(user?.email, { max: 220, allowEmpty: true }) || resolvePersonEmail(person),
          orgId: toPublicId(row?.orgId || ''),
          teacherRecordId: toPublicId(row?.id || ''),
          teacherId: cleanString(row?.teacherId, { max: 120, allowEmpty: true }) || '',
          userId,
          personId
        };
      })
      .filter((row) => row.id);

    const filteredRows = applyGenericFilter(mapped, normalizedQuery, {
      defaultSearchFields: ['id', 'name', 'displayName', 'email', 'teacherId', 'userId', 'personId'],
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

  async listPickerStudents(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const normalizedQuery = normalizeQueryOptions(stripPaginationFromQuery(query || {}));
    const statusFilter = cleanString(normalizedQuery.status, { max: 40, allowEmpty: true }).toLowerCase();
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
      const repositoryQuery = {
        personRoleToken__eq: 'PTE_Student'
      };
      repositoryQuery.status__eq = statusFilter || 'active';
      const [totalRows, rows] = await Promise.all([
        pteApplicantRepository.count({
          query: repositoryQuery,
          scope,
          backendMode: options?.backendMode
        }),
        pteApplicantRepository.list({
          query: repositoryQuery,
          scope,
          sort: { 'audit.createDateTime': -1, id: -1 },
          pagination: {
            page: paginationInput.page,
            limit: paginationInput.limit
          },
          projection: STUDENT_PICKER_SOURCE_PROJECTION,
          backendMode: options?.backendMode
        })
      ]);

      const applicants = (Array.isArray(rows) ? rows : [])
        .filter((row) => isVisibleApplicantRow(row, visibility))
        .filter((row) => hasStrictPteStudentApplicantToken(row));

      const personIds = Array.from(new Set(
        applicants.map((row) => toPublicId(row?.personId || '')).filter(Boolean)
      ));
      const userIds = Array.from(new Set(
        applicants.map((row) => toPublicId(row?.userId || '')).filter(Boolean)
      ));
      const [personRows, userRows] = await Promise.all([
        personIds.length
          ? dataService.fetchData(
            'persons',
            { id__in: personIds.join(','), limit: Math.max(personIds.length, 200) },
            requestingUser,
            options?.backendMode ? { backendMode: options.backendMode } : {}
          )
          : [],
        userIds.length
          ? dataService.fetchData(
            'users',
            { id__in: userIds.join(','), limit: Math.max(userIds.length, 200) },
            requestingUser,
            options?.backendMode ? { backendMode: options.backendMode } : {}
          )
          : []
      ]);

      const personMap = new Map((Array.isArray(personRows) ? personRows : []).map((row) => [toPublicId(row?.id || ''), row]));
      const userMap = new Map((Array.isArray(userRows) ? userRows : []).map((row) => [toPublicId(row?.id || ''), row]));
      const mappedRows = applicants
        .map((row) => {
          const id = toPublicId(row?.id || '');
          const person = personMap.get(toPublicId(row?.personId || '')) || {};
          const user = userMap.get(toPublicId(row?.userId || '')) || {};
          const personName = buildPersonDisplayName(person);
          const label = personName || cleanString(row?.applicantId, { max: 120, allowEmpty: true }) || id;
          return {
            id,
            type: 'applicant',
            name: label,
            displayName: label,
            email: cleanString(user?.email, { max: 220, allowEmpty: true }) || resolvePersonEmail(person),
            applicantId: cleanString(row?.applicantId, { max: 120, allowEmpty: true }) || '',
            orgId: toPublicId(row?.orgId || '')
          };
        })
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
      projection: STUDENT_PICKER_SOURCE_PROJECTION,
      backendMode: options?.backendMode
    });

    const applicants = (Array.isArray(rows) ? rows : [])
      .filter((row) => isVisibleApplicantRow(row, visibility))
      .filter((row) => {
        const status = cleanString(row?.status, { max: 40, allowEmpty: true }).toLowerCase() || 'active';
        if (statusFilter) return status === statusFilter;
        return status !== 'archived';
      })
      .filter((row) => hasStrictPteStudentApplicantToken(row));

    const personIds = Array.from(new Set(
      applicants.map((row) => toPublicId(row?.personId || '')).filter(Boolean)
    ));
    const userIds = Array.from(new Set(
      applicants.map((row) => toPublicId(row?.userId || '')).filter(Boolean)
    ));

    const [personRows, userRows] = await Promise.all([
      personIds.length
        ? dataService.fetchData(
          'persons',
          { id__in: personIds.join(','), limit: Math.max(personIds.length, 500) },
          requestingUser,
          options?.backendMode ? { backendMode: options.backendMode } : {}
        )
        : [],
      userIds.length
        ? dataService.fetchData(
          'users',
          { id__in: userIds.join(','), limit: Math.max(userIds.length, 500) },
          requestingUser,
          options?.backendMode ? { backendMode: options.backendMode } : {}
        )
        : []
    ]);

    const personMap = new Map((Array.isArray(personRows) ? personRows : []).map((row) => [toPublicId(row?.id || ''), row]));
    const userMap = new Map((Array.isArray(userRows) ? userRows : []).map((row) => [toPublicId(row?.id || ''), row]));

    const mapped = applicants
      .map((row) => {
        const id = toPublicId(row?.id || '');
        const person = personMap.get(toPublicId(row?.personId || '')) || {};
        const user = userMap.get(toPublicId(row?.userId || '')) || {};
        const personName = buildPersonDisplayName(person);
        const label = personName || cleanString(row?.applicantId, { max: 120, allowEmpty: true }) || id;
        return {
          id,
          type: 'applicant',
          name: label,
          displayName: label,
          email: cleanString(user?.email, { max: 220, allowEmpty: true }) || resolvePersonEmail(person),
          applicantId: cleanString(row?.applicantId, { max: 120, allowEmpty: true }) || '',
          orgId: toPublicId(row?.orgId || '')
        };
      }).filter((row) => row.id);

    const filteredRows = applyGenericFilter(mapped, normalizedQuery, {
      defaultSearchFields: ['id', 'name', 'displayName', 'email', 'applicantId'],
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

  async resolveReadVisibility(requestingUser, accessContext = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    return visibility;
  }
};

module.exports = pteCourseDataService;
