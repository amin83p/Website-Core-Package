const { idsEqual } = require('./idAdapter');

function getEffectiveTargetRows(assignment) {
  const rows = Array.isArray(assignment?.targetRows) ? assignment.targetRows : [];
  if (rows.length) return rows;
  return [{
    rowId: assignment?.assignmentRowId || assignment?.rowId || '',
    targetType: inferAssignmentTargetType(assignment),
    sessionId: assignment?.sessionId || '',
    sessionDate: assignment?.sessionDate || assignment?.dueDate || '',
    dueDate: assignment?.dueDate || '',
    reportStartDate: assignment?.reportStartDate || '',
    reportDueDate: assignment?.reportDueDate || '',
    taskStartTime: assignment?.taskStartTime || '',
    taskEndTime: assignment?.taskEndTime || '',
    conflictPermitted: assignment?.targetType === 'session' || assignment?.conflictPermitted === true,
    timesheetReflection: assignment?.timesheetReflection === true,
    allocatedHours: Number(assignment?.allocatedHours || 0),
    teacherId: assignment?.teacherId || (Array.isArray(assignment?.teacherIds) ? assignment.teacherIds[0] : ''),
    status: assignment?.status || 'active'
  }];
}

function applyTargetRow(assignment, row) {
  if (!row) return assignment;
  return {
    ...assignment,
    assignmentRowId: row.rowId || '',
    rowId: row.rowId || '',
    targetType: row.targetType,
    sessionId: row.sessionId,
    sessionDate: row.sessionDate,
    dueDate: row.dueDate,
    reportStartDate: row.reportStartDate,
    reportDueDate: row.reportDueDate,
    taskStartTime: row.taskStartTime,
    taskEndTime: row.taskEndTime,
    conflictPermitted: row.conflictPermitted,
    timesheetReflection: row.timesheetReflection,
    allocatedHours: row.allocatedHours,
    teacherId: row.teacherId || '',
    teacherIds: row.teacherId ? [row.teacherId] : (Array.isArray(assignment?.teacherIds) ? assignment.teacherIds : [])
  };
}

function inferAssignmentTargetType(assignment) {
  const explicit = String(assignment?.targetType || '').trim().toLowerCase();
  if (explicit === 'date') return 'date';
  if (explicit === 'session') return 'session';
  return String(assignment?.sessionId || '').trim() ? 'session' : 'date';
}

function inferAssignmentReportScope(assignment) {
  const explicit = String(assignment?.reportScope || '').trim().toLowerCase();
  if (['class', 'each_student', 'selected_students'].includes(explicit)) return explicit;
  return 'class';
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function resolveAssignmentTargetDate(assignment) {
  const targetType = inferAssignmentTargetType(assignment);
  if (targetType === 'session') return String(assignment?.sessionDate || assignment?.dueDate || '').trim();
  return String(assignment?.dueDate || assignment?.sessionDate || '').trim();
}

function reportAssignmentMatchesSession(assignment, { classId, sessionId, sessionDate }) {
  const status = String(assignment?.status || '').trim().toLowerCase();
  if (status !== 'active') return false;
  if (!idsEqual(assignment?.classId, classId)) return false;

  return getEffectiveTargetRows(assignment).some((row) => {
    if (String(row?.status || 'active').trim().toLowerCase() !== 'active') return false;
    const targetType = inferAssignmentTargetType(row);
    if (targetType === 'session') return idsEqual(row?.sessionId, sessionId);
    const targetDate = normalizeDateOnly(resolveAssignmentTargetDate(row));
    const sDate = normalizeDateOnly(sessionDate);
    return Boolean(targetDate && sDate && targetDate === sDate);
  });
}

function formatReportAssignmentTimeWindow(assignment) {
  const row = getEffectiveTargetRows(assignment)[0] || {};
  const a = String(row?.taskStartTime || assignment?.taskStartTime || '').trim();
  const b = String(row?.taskEndTime || assignment?.taskEndTime || '').trim();
  if (a && b) return `${a} - ${b}`;
  return '-';
}

function scopeDisplayLabel(scope) {
  if (scope === 'each_student') return 'Each student';
  if (scope === 'selected_students') return 'Selected students';
  return 'Class';
}

module.exports = {
  inferAssignmentTargetType,
  inferAssignmentReportScope,
  getEffectiveTargetRows,
  applyTargetRow,
  reportAssignmentMatchesSession,
  resolveAssignmentTargetDate,
  formatReportAssignmentTimeWindow,
  scopeDisplayLabel
};
