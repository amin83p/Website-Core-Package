/**
 * Report assignments with timesheetReflection + allocatedHours appear on instructor timesheets
 * for the period that contains the assignment target date.
 */
const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const reportAssignmentSessionUtils = requireCoreModule('MVC/utils/reportAssignmentSessionUtils');

function normalizeId(value) {
  return String(value || '').trim();
}

function inferAssignmentTargetType(assignment) {
  const explicit = String(assignment?.targetType || '').trim().toLowerCase();
  if (explicit === 'date') return 'date';
  if (explicit === 'session') return 'session';
  return String(assignment?.sessionId || '').trim() ? 'session' : 'date';
}

function resolveAssignmentTargetDate(assignment) {
  const targetType = inferAssignmentTargetType(assignment);
  if (targetType === 'session') return String(assignment?.sessionDate || assignment?.dueDate || '').trim();
  return String(assignment?.dueDate || assignment?.sessionDate || '').trim();
}

function padTime(value) {
  const raw = String(value || '').trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const min = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function sessionIdForReportAssignment(assignmentId, assignmentRowId = '') {
  const id = normalizeId(assignmentId);
  const rowId = normalizeId(assignmentRowId);
  return id ? `rptref-${id}${rowId ? `-${rowId}` : ''}` : '';
}

/**
 * @returns {Array<object>} rows shaped like timesheet "liveSessions" entries
 */
async function buildReportReflectionLiveSessions({
  teacherPersonId,
  periodStartDate,
  periodEndDate,
  activeOrgId,
  reqUser
}) {
  const personId = normalizeId(teacherPersonId);
  if (!personId || !normalizeId(periodStartDate) || !normalizeId(periodEndDate)) return [];

  const [assignments, templates, classes] = await Promise.all([
    schoolDataService.fetchData('reportAssignments', {}, reqUser),
    schoolDataService.fetchData('reportTemplates', {}, reqUser),
    schoolDataService.fetchData('classes', {}, reqUser)
  ]);

  const templateMap = new Map(
    (Array.isArray(templates) ? templates : [])
      .map((row) => [normalizeId(row?.id), String(row?.title || '').trim()])
      .filter(([id]) => Boolean(id))
  );
  const classMap = new Map(
    (Array.isArray(classes) ? classes : [])
      .map((row) => [normalizeId(row?.id), row])
      .filter(([id]) => Boolean(id))
  );

  const classSessionsById = new Map();
  const out = [];

  const expandedAssignments = [];
  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    const targetRows = reportAssignmentSessionUtils.getEffectiveTargetRows(assignment);
    (targetRows.length ? targetRows : [{}]).forEach((targetRow) => {
      expandedAssignments.push(reportAssignmentSessionUtils.applyTargetRow(assignment, targetRow));
    });
  }

  for (const assignment of expandedAssignments) {
    if (String(assignment?.status || '').trim().toLowerCase() !== 'active') continue;
    if (assignment?.timesheetReflection !== true) continue;
    if (activeOrgId && !idsEqual(assignment?.orgId, activeOrgId)) continue;

    const teacherIds = Array.isArray(assignment?.teacherIds)
      ? assignment.teacherIds.map((id) => normalizeId(id)).filter(Boolean)
      : [];
    if (!teacherIds.includes(personId)) continue;

    const allocated = Number(assignment?.allocatedHours);
    if (!Number.isFinite(allocated) || allocated <= 0) continue;

    const classId = normalizeId(assignment?.classId);
    if (!classId) continue;

    let classSessions = classSessionsById.get(classId);
    if (!classSessions) {
      // eslint-disable-next-line no-await-in-loop
      const loaded = await schoolDataService.getClassSessions(classId, reqUser);
      classSessions = Array.isArray(loaded) ? loaded : [];
      classSessionsById.set(classId, classSessions);
    }

    let date = resolveAssignmentTargetDate(assignment);
    if (!date) {
      const sourceSessionId = normalizeId(assignment?.sessionId);
      if (sourceSessionId) {
        const matchedSession = classSessions.find((row) => normalizeId(row?.sessionId) === sourceSessionId) || null;
        date = normalizeId(matchedSession?.date);
      }
    }
    if (!date || date < periodStartDate || date > periodEndDate) continue;

    const classRow = classMap.get(classId) || null;
    const classTitle = String(classRow?.title || classRow?.name || classId).trim() || classId;
    const templateTitle = templateMap.get(normalizeId(assignment?.templateId)) || assignment.templateId || 'Report';
    const startTime = padTime(assignment?.taskStartTime);
    const endTime = padTime(assignment?.taskEndTime);
    const sid = sessionIdForReportAssignment(assignment.id, assignment.assignmentRowId);
    if (!sid) continue;

    out.push({
      sessionId: sid,
      classId,
      className: `${classTitle} | Report: ${templateTitle}`,
      deliveryDepartmentId: classRow?.deliveryDepartmentId || '',
      deliveryDepartmentName: classRow?.deliveryDepartmentName || '',
      date,
      startTime,
      endTime,
      durationHours: Number(allocated.toFixed(2)),
      timesheetHours: Number(allocated.toFixed(2)),
      status: 'completed',
      isFinalStatus: true,
      isReportReflection: true,
      notes: '',
      room: ''
    });
  }

  return out;
}

module.exports = {
  buildReportReflectionLiveSessions,
  sessionIdForReportAssignment
};
