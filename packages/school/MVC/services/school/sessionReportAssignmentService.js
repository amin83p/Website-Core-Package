const schoolDataService = require('./schoolDataService');
const reportIntegrityService = require('./reportIntegrityService');

function clean(value) {
  return String(value || '').trim();
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return Boolean(fallback);
}

function parseNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTime(value) {
  const token = clean(value);
  if (!/^\d{2}:\d{2}$/.test(token)) return '';
  const [h, m] = token.split(':').map(Number);
  if (!Number.isInteger(h) || h < 0 || h > 23) return '';
  if (!Number.isInteger(m) || m < 0 || m > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizeDate(value) {
  const token = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function addMinutes(time, minutes) {
  const normalized = normalizeTime(time);
  if (!normalized) return '';
  const [h, m] = normalized.split(':').map(Number);
  const total = Math.max(0, Math.min((24 * 60) - 1, (h * 60) + m + Number(minutes || 0)));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function resolveTeacherId(session = {}, classData = {}) {
  return clean(
    session?.delivery?.deliveredBy
    || session?.deliveredBy
    || session?.teacherId
    || session?.instructorId
    || classData?.instructors?.[0]?.personId
  );
}

function resolveTeacherName(session = {}, classData = {}) {
  return clean(
    session?.delivery?.deliveredByName
    || session?.deliveredByName
    || session?.teacherName
    || session?.instructorName
    || classData?.instructors?.[0]?.name
    || resolveTeacherId(session, classData)
  );
}

function resolveAllocatedHours(startTime, endTime) {
  const start = normalizeTime(startTime);
  const end = normalizeTime(endTime);
  if (!start || !end || start >= end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Number((((eh * 60) + em - ((sh * 60) + sm)) / 60).toFixed(2));
}

function assertTaskWindowInsideSession({ taskStartTime, taskEndTime, sessionStartTime, sessionEndTime }) {
  if (!taskStartTime || !taskEndTime) throw new Error('Task Start and Task End are required.');
  if (taskStartTime >= taskEndTime) throw new Error('Task End must be later than Task Start.');
  if (sessionStartTime && taskStartTime < sessionStartTime) {
    throw new Error(`Task Start cannot be before the session start time (${sessionStartTime}).`);
  }
  if (sessionEndTime && taskEndTime > sessionEndTime) {
    throw new Error(`Task End cannot be after the session end time (${sessionEndTime}).`);
  }
}

function collectRosterStudentIds(sessionRoster = []) {
  return new Set((Array.isArray(sessionRoster) ? sessionRoster : [])
    .map((row) => clean(row?.personId))
    .filter(Boolean));
}

async function createAssignmentForSession({
  classData,
  session,
  sessionRoster = [],
  input = {},
  reqUser
}) {
  if (!classData?.id) throw new Error('Class is required.');
  if (!session?.sessionId) throw new Error('Session is required.');

  const classId = clean(classData.id);
  const sessionId = clean(session.sessionId);
  const sessionDate = normalizeDate(session.date);
  const sessionStartTime = normalizeTime(session.startTime);
  const sessionEndTime = normalizeTime(session.endTime);
  const teacherId = resolveTeacherId(session, classData);
  const teacherName = resolveTeacherName(session, classData);

  if (!sessionDate) throw new Error('Session date is required before assigning a report.');
  if (!teacherId) throw new Error('The session needs an assigned teacher before assigning a report.');

  const templateId = clean(input.templateId);
  const reportScope = clean(input.reportScope || 'class').toLowerCase() || 'class';
  const reportStartDate = normalizeDate(input.reportStartDate);
  const reportDueDate = sessionDate;
  const taskStartTime = normalizeTime(input.taskStartTime || sessionStartTime);
  const taskEndTime = normalizeTime(input.taskEndTime || sessionEndTime);
  const conflictPermitted = parseBoolean(input.conflictPermitted, false);
  const timesheetReflection = parseBoolean(input.timesheetReflection, false);
  const allocatedHours = timesheetReflection
    ? parseNumber(input.allocatedHours, resolveAllocatedHours(taskStartTime, taskEndTime))
    : 0;
  const notes = clean(input.notes);
  const selectedTargetStudentIds = Array.isArray(input.targetStudentIds)
    ? input.targetStudentIds.map(clean).filter(Boolean)
    : clean(input.targetStudentIds).split(',').map(clean).filter(Boolean);

  if (!templateId) throw new Error('Template is required.');
  if (!reportStartDate) throw new Error('Start Date is required.');
  if (reportStartDate > reportDueDate) throw new Error('Start Date cannot be after the session date.');

  assertTaskWindowInsideSession({
    taskStartTime,
    taskEndTime,
    sessionStartTime,
    sessionEndTime
  });

  if (reportScope === 'selected_students') {
    const rosterIds = collectRosterStudentIds(sessionRoster);
    if (!selectedTargetStudentIds.length) throw new Error('Select at least one student for Specific Students scope.');
    const invalidIds = selectedTargetStudentIds.filter((id) => !rosterIds.has(id));
    if (invalidIds.length) throw new Error('One or more selected students are not in this session roster.');
  }

  const targetRows = [{
    rowId: `session:${sessionId}`,
    targetType: 'session',
    sessionId,
    sessionDate,
    dueDate: '',
    reportStartDate,
    reportDueDate,
    taskStartTime,
    taskEndTime,
    conflictPermitted,
    timesheetReflection,
    allocatedHours,
    teacherId,
    status: 'active',
    notes
  }];

  const {
    template,
    effectiveTargetRows,
    persistedTargetStudentIds
  } = await reportIntegrityService.validateAssignmentCrossEntityContext({
    classId,
    templateId,
    reqUser,
    reportScope,
    hasSessionTargets: true,
    selectedSessionIds: [sessionId],
    teacherIds: [teacherId],
    requestedTaskStartTime: taskStartTime,
    requestedTaskEndTime: taskEndTime,
    conflictPermitted,
    requestedReportStartDate: reportStartDate,
    requestedReportDueDate: reportDueDate,
    selectedTargetStudentIds,
    targetRows
  });

  const firstActiveRow = effectiveTargetRows.find((row) => String(row?.status || '').toLowerCase() === 'active') || effectiveTargetRows[0];
  const now = new Date().toISOString();
  const payload = {
    orgId: clean(classData.orgId || reqUser?.activeOrgId),
    classId,
    reportScope,
    targetStudentIds: persistedTargetStudentIds,
    templateId: template.id,
    templateVersion: Number(template.version || 1),
    teacherIds: [teacherId],
    targetRows: effectiveTargetRows,
    targetType: firstActiveRow.targetType,
    sessionId: firstActiveRow.sessionId,
    sessionDate: firstActiveRow.sessionDate,
    dueDate: firstActiveRow.dueDate,
    conflictPermitted: firstActiveRow.conflictPermitted,
    taskStartTime: firstActiveRow.taskStartTime,
    taskEndTime: firstActiveRow.taskEndTime,
    reportStartDate: firstActiveRow.reportStartDate,
    reportDueDate: firstActiveRow.reportDueDate,
    status: 'active',
    notes,
    timesheetReflection: firstActiveRow.timesheetReflection,
    allocatedHours: firstActiveRow.timesheetReflection ? Number(firstActiveRow.allocatedHours) : 0,
    audit: {
      createUser: reqUser?.id || '',
      createDateTime: now,
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: now
    }
  };

  const assignment = await schoolDataService.addData('reportAssignments', payload, reqUser);

  return {
    assignment,
    template,
    teacherId,
    teacherName,
    targetRows: effectiveTargetRows,
    message: `Report assigned to this session for ${teacherName || teacherId}.`
  };
}

module.exports = {
  addMinutes,
  createAssignmentForSession,
  resolveAllocatedHours,
  resolveTeacherId
};
