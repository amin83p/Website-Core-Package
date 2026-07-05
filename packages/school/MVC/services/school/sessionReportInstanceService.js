const schoolDataService = require('./schoolDataService');
const reportViewService = require('./reportViewService');
const { requireCoreModule } = require('./schoolCoreContracts');
const reportAssignmentSessionUtils = requireCoreModule('MVC/utils/reportAssignmentSessionUtils');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function parseDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function instanceRowMatchesSession(row = {}, { sessionId = '', sessionDate = '' } = {}) {
  const cleanSessionId = String(sessionId || '').trim();
  const cleanSessionDate = parseDateOnly(sessionDate);
  if (cleanSessionId && idsEqual(row?.sessionId, cleanSessionId)) return true;
  const rowDate = parseDateOnly(row?.sessionDate);
  return Boolean(cleanSessionDate && rowDate && rowDate === cleanSessionDate);
}

function formatInstanceStatusBadgeClass(status = '', isPending = false) {
  if (isPending) return 'bg-info-subtle text-info-emphasis border';
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'submitted') return 'bg-success';
  if (normalized === 'locked') return 'bg-dark';
  return 'bg-warning text-dark';
}

function buildInstanceHref(row = {}) {
  const assignmentId = toPublicId(row?.assignmentId);
  const assignmentRowId = String(row?.assignmentRowId || '').trim();
  const teacherId = toPublicId(row?.teacherId);
  const studentId = toPublicId(row?.studentId);

  if (row?.isPendingAssignment) {
    const params = new URLSearchParams();
    if (assignmentRowId) params.set('rowId', assignmentRowId);
    if (teacherId) params.set('teacherId', teacherId);
    if (studentId) params.set('studentId', studentId);
    params.set('editor', 'v2');
    return `/school/reports/instances/start/${encodeURIComponent(assignmentId)}?${params.toString()}`;
  }

  const instanceId = toPublicId(row?.id);
  return `/school/reports/instances/edit-v2/${encodeURIComponent(instanceId)}`;
}

const SUBMITTED_REPORT_STATUSES = new Set(['submitted', 'locked']);

function isReportRowSubmitted(row = {}) {
  if (row?.isPendingAssignment) return false;
  return SUBMITTED_REPORT_STATUSES.has(String(row?.status || '').trim().toLowerCase());
}

function isSessionCompletionStatusByMeta(meta = {}) {
  if (!meta || typeof meta !== 'object') return false;
  return meta.isFinal === true
    && meta.makeUpRequired !== true
    && meta.excludeFromAttendance !== true;
}

function mapPendingReportDto(row = {}) {
  return {
    templateTitle: String(row.templateTitle || 'Report').trim(),
    studentName: String(row.studentName || 'Whole class').trim(),
    teacherName: String(row.teacherName || '-').trim(),
    status: String(row.status || 'draft').trim().toLowerCase(),
    statusLabel: String(row.statusLabel || row.status || 'draft').trim(),
    href: String(row.href || '').trim(),
    isPending: Boolean(row.isPending)
  };
}

function mapRowToDto(row = {}, assignmentMap = new Map()) {
  const isPending = Boolean(row?.isPendingAssignment);
  const status = isPending ? 'pending' : String(row?.status || 'draft').trim().toLowerCase();
  const assignment = assignmentMap.get(toPublicId(row?.assignmentId)) || null;
  const scope = assignment
    ? reportAssignmentSessionUtils.inferAssignmentReportScope(assignment)
    : 'class';
  const studentId = toPublicId(row?.studentId);
  const teacherId = toPublicId(row?.teacherId);

  return {
    id: String(row?.id || ''),
    isPending,
    templateTitle: String(row?.templateTitle || row?.templateId || 'Report').trim(),
    studentName: String(row?.studentName || (studentId ? studentId : 'Whole class')).trim(),
    studentId: studentId || '',
    teacherName: String(row?.teacherName || teacherId || '-').trim(),
    teacherId: teacherId || '',
    status,
    statusLabel: status,
    scopeLabel: reportAssignmentSessionUtils.scopeDisplayLabel(scope),
    href: buildInstanceHref(row),
    actionLabel: isPending ? 'Start' : 'Open V2',
    assignmentId: toPublicId(row?.assignmentId) || '',
    assignmentRowId: String(row?.assignmentRowId || '').trim(),
    statusBadgeClass: formatInstanceStatusBadgeClass(status, isPending)
  };
}

function canViewerSeeSessionReportRow(row = {}, viewerContext = {}) {
  const {
    isReportAdminViewer = false,
    currentUserPersonId = '',
    ownedStudentIds = new Set(),
    ownedStudentPersonIds = new Set(),
    rosterPersonIds = new Set(),
    assignmentMap = new Map()
  } = viewerContext;

  if (isReportAdminViewer) return true;

  const teacherId = toPublicId(row?.teacherId);
  if (teacherId && idsEqual(teacherId, currentUserPersonId)) return true;

  const rowStudentId = toPublicId(row?.studentId);
  if (rowStudentId && idsEqual(rowStudentId, currentUserPersonId)) return true;

  const assignment = assignmentMap.get(toPublicId(row?.assignmentId)) || null;
  if (!assignment) return false;
  const scope = reportAssignmentSessionUtils.inferAssignmentReportScope(assignment);

  if (scope === 'each_student') {
    return ownedStudentPersonIds.has(currentUserPersonId) && rosterPersonIds.has(currentUserPersonId);
  }

  if (scope === 'selected_students') {
    const targets = Array.isArray(assignment?.targetStudentIds) ? assignment.targetStudentIds : [];
    return [...ownedStudentIds].some((studentId) => targets.some((targetId) => idsEqual(targetId, studentId)));
  }

  return false;
}

async function buildSessionReportViewerContext({
  classId,
  sessionRoster = [],
  reqUser,
  isReportAdminViewer = false
} = {}) {
  const cleanClassId = String(classId || '').trim();
  const currentUserPersonId = String(reqUser?.personId || '').trim();
  const students = await schoolDataService.fetchData('students', {}, reqUser);
  const ownedStudentIds = new Set(
    (Array.isArray(students) ? students : [])
      .filter((row) => idsEqual(row?.personId, currentUserPersonId))
      .map((row) => String(row?.id || '').trim())
      .filter(Boolean)
  );
  const ownedStudentPersonIds = new Set(
    (Array.isArray(students) ? students : [])
      .filter((row) => ownedStudentIds.has(String(row?.id || '').trim()))
      .map((row) => String(row?.personId || '').trim())
      .filter(Boolean)
  );
  const rosterPersonIds = new Set(
    (Array.isArray(sessionRoster) ? sessionRoster : [])
      .map((row) => toPublicId(row?.personId))
      .filter(Boolean)
  );
  const reportAssignments = cleanClassId
    ? await schoolDataService.fetchData('reportAssignments', { classId__eq: cleanClassId }, reqUser)
    : [];
  const assignmentMap = new Map(
    (Array.isArray(reportAssignments) ? reportAssignments : [])
      .map((row) => [toPublicId(row?.id), row])
      .filter(([id]) => Boolean(id))
  );

  return {
    isReportAdminViewer: Boolean(isReportAdminViewer),
    currentUserPersonId,
    ownedStudentIds,
    ownedStudentPersonIds,
    rosterPersonIds,
    assignmentMap
  };
}

async function buildSessionReportInstanceRows({
  classId,
  sessionId,
  sessionDate = '',
  reqUser,
  viewerContext = null,
  sessionRoster = []
} = {}) {
  const cleanClassId = String(classId || '').trim();
  const cleanSessionId = String(sessionId || '').trim();
  if (!cleanClassId || !cleanSessionId) return [];

  const resolvedViewerContext = viewerContext || await buildSessionReportViewerContext({
    classId: cleanClassId,
    sessionRoster,
    reqUser,
    isReportAdminViewer: false
  });

  const allRows = await reportViewService.buildInstanceListRows({ reqUser });
  const sessionContext = { sessionId: cleanSessionId, sessionDate };

  const visibleRows = (Array.isArray(allRows) ? allRows : [])
    .filter((row) => idsEqual(row?.classId, cleanClassId))
    .filter((row) => instanceRowMatchesSession(row, sessionContext))
    .filter((row) => canViewerSeeSessionReportRow(row, resolvedViewerContext));

  return visibleRows
    .map((row) => mapRowToDto(row, resolvedViewerContext.assignmentMap))
    .sort((a, b) => {
      const titleCompare = String(a.templateTitle || '').localeCompare(String(b.templateTitle || ''));
      if (titleCompare) return titleCompare;
      const studentCompare = String(a.studentName || '').localeCompare(String(b.studentName || ''));
      if (studentCompare) return studentCompare;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
}

async function listUnsubmittedSessionReports({
  classId,
  sessionId,
  sessionDate = '',
  reqUser,
  sessionRoster = []
} = {}) {
  const viewerContext = await buildSessionReportViewerContext({
    classId,
    sessionRoster,
    reqUser,
    isReportAdminViewer: true
  });
  const rows = await buildSessionReportInstanceRows({
    classId,
    sessionId,
    sessionDate,
    reqUser,
    viewerContext,
    sessionRoster
  });
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => !isReportRowSubmitted(row))
    .map(mapPendingReportDto);
}

module.exports = {
  parseDateOnly,
  instanceRowMatchesSession,
  formatInstanceStatusBadgeClass,
  canViewerSeeSessionReportRow,
  buildSessionReportViewerContext,
  buildSessionReportInstanceRows,
  mapRowToDto,
  isReportRowSubmitted,
  isSessionCompletionStatusByMeta,
  listUnsubmittedSessionReports,
  mapPendingReportDto
};
