const schoolDataService = require('./schoolDataService');
const sessionStudentCaseService = require('./sessionStudentCaseService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const schoolRecordAccessService = require('./schoolRecordAccessService');
const teacherIdentityService = require('./teacherIdentityService');
const sessionDeliveryTeamService = require('./sessionDeliveryTeamService');
const { requireCoreModule } = require('./schoolCoreContracts');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function normalizeId(value) {
  return String(value || '').trim();
}

function getUserPersonId(reqUser = {}) {
  return normalizeId(
    reqUser.personId
    || reqUser.person?.id
    || reqUser.person?._id
    || reqUser.profile?.personId
    || reqUser.account?.personId
  );
}

function rowBelongsToActiveOrg(row = {}, activeOrgId = '') {
  const orgId = normalizeId(activeOrgId);
  if (!orgId) return true;
  const rowOrgIds = [
    row.orgId,
    row.organizationId,
    row.organizationID,
    row.orgID,
    row.schoolOrgId,
    row.activeOrgId
  ].map(normalizeId).filter(Boolean);
  if (!rowOrgIds.length) return true;
  return rowOrgIds.some((rowOrgId) => idsEqual(rowOrgId, orgId));
}

function isActiveSchoolIdentityRow(row = {}) {
  const status = String(row.status || row.state || '').trim().toLowerCase();
  return !['archived', 'deleted', 'inactive', 'disabled', 'removed'].includes(status);
}

function isSessionAdminViewer(reqUser) {
  return adminChekersService.isAdminForRequest(reqUser, SECTIONS.SCHOOL_SESSIONS, OPERATIONS.READ_ALL, {
    orgId: reqUser?.activeOrgId,
    section: { id: SECTIONS.SCHOOL_SESSIONS, category: 'SCHOOL' }
  });
}

async function hasLinkedTeacherRole(reqUser = {}) {
  const personId = getUserPersonId(reqUser);
  const activeOrgId = normalizeId(reqUser?.activeOrgId);
  if (!personId) return false;

  const teachers = await schoolDataService.fetchData('teachers', {}, reqUser);
  return (Array.isArray(teachers) ? teachers : []).some((row) => (
    idsEqual(row?.personId, personId)
    && rowBelongsToActiveOrg(row, activeOrgId)
    && isActiveSchoolIdentityRow(row)
  ));
}

async function buildSessionExplorerViewer(req) {
  const reqUser = req?.user || {};
  const isAdminViewer = isSessionAdminViewer(reqUser);

  if (isAdminViewer) {
    return {
      isAdminViewer: true,
      canFilterByTeacher: true,
      lockedTeacherPersonId: '',
      lockedTeacherName: ''
    };
  }

  const personId = getUserPersonId(reqUser);
  const isTeacher = personId ? await hasLinkedTeacherRole(reqUser) : false;
  let lockedTeacherName = '';

  if (isTeacher && personId) {
    const personById = await schoolPersonAccessService.buildPersonByIdMap({ reqUser });
    const person = personById.get(personId);
    lockedTeacherName = person
      ? schoolPersonAccessService.formatPersonName(person, '')
      : String(reqUser?.displayName || reqUser?.name || reqUser?.username || personId).trim();
  }

  return {
    isAdminViewer: false,
    canFilterByTeacher: false,
    lockedTeacherPersonId: isTeacher ? personId : '',
    lockedTeacherName
  };
}

function applyViewerTeacherFilters(filters, viewer = {}) {
  if (viewer.isAdminViewer) return filters;

  if (viewer.lockedTeacherPersonId) {
    const lockedIds = [viewer.lockedTeacherPersonId];
    return {
      ...filters,
      teacherIds: lockedIds,
      teacherId: lockedIds.join(',')
    };
  }

  return {
    ...filters,
    teacherIds: [],
    teacherId: ''
  };
}

function normalizeStatusCode(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function parseIdList(value) {
  const source = Array.isArray(value) ? value : [value];
  return source
    .flatMap((item) => String(item || '').split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDateOrNull(value, label) {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid ${label}. Use YYYY-MM-DD.`);
  }
  return normalized;
}

function normalizeTimeOrNull(value, label) {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!/^\d{2}:\d{2}$/.test(normalized)) {
    throw new Error(`Invalid ${label}. Use HH:mm.`);
  }
  return normalized;
}

function normalizeFilters(query = {}) {
  const q = String(query.q || '').trim().toLowerCase();
  const startDate = normalizeDateOrNull(query.startDate, 'startDate');
  const endDate = normalizeDateOrNull(query.endDate, 'endDate');
  const startTime = normalizeTimeOrNull(query.startTime, 'startTime');
  const endTime = normalizeTimeOrNull(query.endTime, 'endTime');
  const teacherIds = parseIdList(query.teacherId);
  const teacherId = teacherIds.join(',');
  const classId = query.classId ? String(query.classId).trim() : '';
  const status = normalizeStatusCode(query.status);
  const hasCases = ['1', 'true', 'yes', 'on'].includes(String(query.hasCases || '').trim().toLowerCase());

  if (startDate && endDate && startDate > endDate) {
    throw new Error('startDate cannot be after endDate.');
  }
  if (startTime && endTime && startTime > endTime) {
    throw new Error('startTime cannot be after endTime.');
  }

  return {
    q,
    startDate,
    endDate,
    startTime,
    endTime,
    teacherId,
    teacherIds,
    classId,
    status,
    hasCases
  };
}

function rowMatchesSearch(row, q) {
  if (!q) return true;
  return [
    row.sessionId,
    row.classId,
    row.className,
    row.teacherName,
    row.date,
    row.status,
    row.notes
  ]
    .map((token) => String(token || '').toLowerCase())
    .some((token) => token.includes(q));
}

function getEmbeddedClassSessions(classRow) {
  const candidates = [
    classRow?.sessions,
    classRow?.schedule?.sessions,
    classRow?.generatedSessions,
    classRow?.sessionRows
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) {
      return candidate;
    }
  }
  return [];
}

function resolveSessionId(session) {
  return session?.sessionId || session?.id || session?._id || '';
}

async function listSessions(req, query = {}) {
  const viewer = await buildSessionExplorerViewer(req);
  const accessContext = schoolDataService.buildRouteAccessContext(req);
  const access = schoolRecordAccessService.resolveAccessFromRequest(req);
  const filters = applyViewerTeacherFilters(normalizeFilters(query), viewer);
  const activeOrgId = String(req?.user?.activeOrgId || '').trim();
  const statusMeta = await sessionStatusPolicyService.getClientStatusMeta(activeOrgId || '', { includeInactive: true });

  let classes = await schoolDataService.fetchData('classes', {}, req.user, accessContext);
  if (filters.classId) {
    classes = classes.filter((row) => idsEqual(row?.id, filters.classId));
  }

  const personById = await schoolPersonAccessService.buildPersonByIdMap({ reqUser: req.user });
  const allTeachers = await schoolDataService.fetchData('teachers', {}, req.user, accessContext).catch(() => []);
  const teacherPersonMap = teacherIdentityService.buildTeacherPersonMap(allTeachers);
  let rows = [];

  for (const classRow of classes) {
    // eslint-disable-next-line no-await-in-loop
    const serviceSessions = await schoolDataService.getClassSessions(classRow.id, req.user, accessContext);
    const sessions = Array.isArray(serviceSessions) && serviceSessions.length
      ? serviceSessions
      : getEmbeddedClassSessions(classRow);

    (Array.isArray(sessions) ? sessions : []).forEach((session) => {
      if (session?.notes === 'Holiday/Off') return;
      if (!schoolRecordAccessService.isSessionAccessible({
        classRow,
        session,
        access,
        context: 'list',
        teacherPersonMap
      })) return;

      if (filters.startDate && session.date < filters.startDate) return;
      if (filters.endDate && session.date > filters.endDate) return;
      if (filters.startTime && session.startTime < filters.startTime) return;
      if (filters.endTime && session.startTime > filters.endTime) return;

      const sessionTeacherId = session?.delivery?.deliveredBy;
      const resolvedTeacherPersonId = teacherIdentityService.resolveTeacherPersonId(sessionTeacherId, teacherPersonMap);
      const coTeachers = sessionDeliveryTeamService.getSessionCoTeachers(session);
      if (viewer.lockedTeacherPersonId
        && !teacherIdentityService.sessionDeliveredByMatchesPerson(session, viewer.lockedTeacherPersonId, teacherPersonMap)) {
        return;
      }
      if (filters.teacherIds.length && !filters.teacherIds.some((teacherFilterId) => (
        teacherIdentityService.sessionDeliveredByMatchesPerson(session, teacherFilterId, teacherPersonMap)
      ))) return;

      const teacher = personById.get(String(resolvedTeacherPersonId || sessionTeacherId || '').trim());
      const teacherName = teacher
        ? schoolPersonAccessService.formatPersonName(teacher, '')
        : (session?.delivery?.deliveredByName || 'Unassigned');
      const normalizedStatus = sessionStatusPolicyService.normalizeSessionStatus(session?.status, session?.notes);
      const statusDefinition = (Array.isArray(statusMeta) ? statusMeta : [])
        .find((row) => normalizeStatusCode(row?.code) === normalizedStatus) || null;
      const sessionId = resolveSessionId(session);
      const matchedAsCoTeacher = Boolean(
        filters.teacherIds.length
        && !filters.teacherIds.some((teacherFilterId) => (
          sessionDeliveryTeamService.isPersonSessionMainTeacher(session, teacherFilterId, teacherPersonMap)
        ))
        && filters.teacherIds.some((teacherFilterId) => (
          sessionDeliveryTeamService.isPersonOnSessionDelivery(session, teacherFilterId, teacherPersonMap)
        ))
      );

      rows.push({
        id: sessionId,
        sessionId,
        classId: classRow?.id,
        className: classRow?.title,
        title: `${classRow?.title || ''} | ${session?.date || ''} ${session?.startTime || ''}-${session?.endTime || ''}`.trim(),
        date: session?.date,
        startTime: session?.startTime || '00:00',
        endTime: session?.endTime || '00:00',
        status: normalizedStatus,
        locked: session?.locked === true || String(session?.locked) === 'true',
        teacherId: resolvedTeacherPersonId || sessionTeacherId || '',
        teacherName,
        coTeachers,
        coTeacherCount: coTeachers.length,
        matchedAsCoTeacher,
        room: session?.room || '',
        notes: session?.notes || '',
        makeUpRequired: statusDefinition?.makeUpRequired === true,
        makeup: session?.makeup && typeof session.makeup === 'object' ? session.makeup : null,
        makeupHistory: Array.isArray(session?.makeupHistory) ? session.makeupHistory : [],
        hasComments: (Array.isArray(session?.roster) ? session.roster : []).some((row) => row?.comments && row.comments.length > 0)
      });
    });
  }

  if (filters.status) {
    rows = rows.filter((row) => normalizeStatusCode(row?.status) === filters.status);
  }
  rows = rows.filter((row) => rowMatchesSearch(row, filters.q));

  const caseSummaries = await sessionStudentCaseService.listSessionCaseSummaries({
    sessionRefs: rows.map((row) => ({ classId: row.classId, sessionId: row.sessionId })),
    reqUser: req.user
  });
  rows = rows.map((row) => ({
    ...row,
    caseSummary: caseSummaries.get(sessionStudentCaseService.getSessionCaseSummaryKey(row.classId, row.sessionId)) || null
  }));
  if (filters.hasCases) {
    rows = rows.filter((row) => row.caseSummary && row.caseSummary.hasCases);
  }

  rows.sort((a, b) => {
    const first = new Date(`${a.date}T${a.startTime}`);
    const second = new Date(`${b.date}T${b.startTime}`);
    return first - second;
  });

  return {
    data: rows,
    rows,
    total: rows.length,
    pagination: {
      currentPage: 1,
      totalPages: 1,
      totalItems: rows.length,
      limit: rows.length
    },
    statusMeta,
    filters,
    viewer
  };
}

module.exports = {
  listSessions,
  normalizeFilters,
  buildSessionExplorerViewer,
  applyViewerTeacherFilters,
  isSessionAdminViewer,
  hasLinkedTeacherRole
};
