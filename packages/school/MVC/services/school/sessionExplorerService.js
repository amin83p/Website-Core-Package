const schoolDataService = require('./schoolDataService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const { requireCoreModule } = require('./schoolCoreContracts');

const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const dataService = requireCoreModule('MVC/services/dataService');

const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });

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
    status
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
  const filters = normalizeFilters(query);
  const activeOrgId = String(req?.user?.activeOrgId || '').trim();
  const statusMeta = await sessionStatusPolicyService.getClientStatusMeta(activeOrgId || '', { includeInactive: true });

  let classes = await schoolDataService.fetchData('classes', {}, req.user);
  if (filters.classId) {
    classes = classes.filter((row) => idsEqual(row?.id, filters.classId));
  }

  const persons = await dataService.fetchData('persons', {}, req.user, PERSON_QUERY_OPTIONS);
  let rows = [];

  for (const classRow of classes) {
    // eslint-disable-next-line no-await-in-loop
    const serviceSessions = await schoolDataService.getClassSessions(classRow.id, req.user);
    const sessions = Array.isArray(serviceSessions) && serviceSessions.length
      ? serviceSessions
      : getEmbeddedClassSessions(classRow);

    (Array.isArray(sessions) ? sessions : []).forEach((session) => {
      if (session?.notes === 'Holiday/Off') return;
      if (filters.startDate && session.date < filters.startDate) return;
      if (filters.endDate && session.date > filters.endDate) return;
      if (filters.startTime && session.startTime < filters.startTime) return;
      if (filters.endTime && session.startTime > filters.endTime) return;

      const sessionTeacherId = session?.delivery?.deliveredBy;
      if (filters.teacherIds.length && !filters.teacherIds.some((teacherFilterId) => idsEqual(sessionTeacherId, teacherFilterId))) return;

      const teacher = (Array.isArray(persons) ? persons : []).find((person) => idsEqual(person?.id, sessionTeacherId));
      const teacherName = teacher
        ? `${teacher.name?.first || ''} ${teacher.name?.last || ''}`.trim()
        : (session?.delivery?.deliveredByName || 'Unassigned');
      const normalizedStatus = sessionStatusPolicyService.normalizeSessionStatus(session?.status, session?.notes);
      const sessionId = resolveSessionId(session);

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
        teacherName,
        notes: session?.notes || '',
        hasComments: (Array.isArray(session?.roster) ? session.roster : []).some((row) => row?.comments && row.comments.length > 0)
      });
    });
  }

  if (filters.status) {
    rows = rows.filter((row) => normalizeStatusCode(row?.status) === filters.status);
  }
  rows = rows.filter((row) => rowMatchesSearch(row, filters.q));

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
    filters
  };
}

module.exports = {
  listSessions,
  normalizeFilters
};
