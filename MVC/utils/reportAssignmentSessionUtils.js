const { idsEqual } = require('./idAdapter');

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

  const targetType = inferAssignmentTargetType(assignment);
  if (targetType === 'session') {
    return idsEqual(assignment?.sessionId, sessionId);
  }
  const targetDate = normalizeDateOnly(resolveAssignmentTargetDate(assignment));
  const sDate = normalizeDateOnly(sessionDate);
  return Boolean(targetDate && sDate && targetDate === sDate);
}

function formatReportAssignmentTimeWindow(assignment) {
  const a = String(assignment?.taskStartTime || '').trim();
  const b = String(assignment?.taskEndTime || '').trim();
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
  reportAssignmentMatchesSession,
  resolveAssignmentTargetDate,
  formatReportAssignmentTimeWindow,
  scopeDisplayLabel
};
