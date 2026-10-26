const schoolDataService = require('./schoolDataService');
const reportIntegrityService = require('./reportIntegrityService');
const classReferenceSyncService = require('./classReferenceSyncService');
const reportScopePolicy = require('./reportScopePolicy');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

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
  const teacherId = clean(resolveTeacherId(session, classData));
  const instructors = Array.isArray(classData?.instructors) ? classData.instructors : [];
  const match = instructors.find((row) => clean(row?.personId) && clean(row.personId) === teacherId);
  const instructorName = clean(match?.name);
  if (instructorName) return instructorName;
  return clean(
    session?.delivery?.deliveredByName
    || session?.deliveredByName
    || session?.teacherName
    || session?.instructorName
    || classData?.instructors?.[0]?.name
    || teacherId
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

function assignmentScope(assignment = {}) {
  try {
    return reportScopePolicy.normalizeReportScope(assignment.reportScope);
  } catch (error) {
    return 'class';
  }
}

function findReportAssignmentForClass(assignments = [], classId = '', reportScope = 'class') {
  const scope = reportScopePolicy.normalizeReportScope(reportScope);
  const classToken = toPublicId(classId);
  if (!classToken) return null;
  return (Array.isArray(assignments) ? assignments : []).find((row) => (
    idsEqual(row?.classId, classToken) && assignmentScope(row) === scope
  )) || null;
}

function resolveWizardRowStudentIds(reportScope = 'class', targetStudentIds = [], sessionRoster = []) {
  const scope = reportScopePolicy.normalizeReportScope(reportScope);
  const selected = (Array.isArray(targetStudentIds) ? targetStudentIds : [])
    .map((id) => toPublicId(id))
    .filter(Boolean);
  if (scope === 'selected_students') return selected;
  if (scope === 'each_student') {
    if (selected.length) return selected;
    return (Array.isArray(sessionRoster) ? sessionRoster : [])
      .map((row) => toPublicId(row?.personId))
      .filter(Boolean);
  }
  return [];
}

function buildSessionTargetRow({
  session,
  reportStartDate,
  reportDueDate,
  taskStartTime,
  taskEndTime,
  conflictPermitted,
  timesheetReflection,
  allocatedHours,
  conductRequiredBeforeFill,
  teacherId,
  reportScope,
  targetStudentIds,
  sessionRoster,
  notes = ''
} = {}) {
  const sessionId = toPublicId(session?.sessionId);
  const sessionDateValue = normalizeDate(session?.date || session?.sessionDate);
  const scope = reportScopePolicy.normalizeReportScope(reportScope);
  const studentScoped = scope === 'each_student' || scope === 'selected_students';
  const rowStudentIds = resolveWizardRowStudentIds(scope, targetStudentIds, sessionRoster);
  return {
    rowId: `session:${sessionId}:${normalizeDate(reportStartDate)}`,
    targetType: 'session',
    sessionId,
    sessionDate: sessionDateValue,
    dueDate: '',
    reportStartDate: normalizeDate(reportStartDate),
    reportDueDate: normalizeDate(reportDueDate),
    taskStartTime,
    taskEndTime,
    conflictPermitted: Boolean(conflictPermitted),
    timesheetReflection: Boolean(timesheetReflection),
    allocatedHours: Number(allocatedHours) || 0,
    conductRequiredBeforeFill: conductRequiredBeforeFill !== false,
    teacherId: toPublicId(teacherId),
    status: 'active',
    notes: clean(notes),
    ...(studentScoped && rowStudentIds.length ? { targetStudentIds: rowStudentIds } : {})
  };
}

function mergeTargetRows(existingRows = [], incomingRow = {}) {
  const rows = Array.isArray(existingRows) ? [...existingRows] : [];
  const rowId = String(incomingRow?.rowId || '').trim();
  const index = rows.findIndex((row) => String(row?.rowId || '').trim() === rowId);
  if (index >= 0) rows[index] = { ...rows[index], ...incomingRow };
  else rows.push(incomingRow);
  return rows;
}

async function loadScopedReportAssignments(reqUser) {
  const assignments = await schoolDataService.fetchAllData('reportAssignments', {}, reqUser);
  const orgId = toPublicId(reqUser?.activeOrgId);
  return (Array.isArray(assignments) ? assignments : []).filter((row) => (
    !orgId || !row?.orgId || idsEqual(row.orgId, orgId)
  ));
}

function parseSessionAssignmentInput({
  classData,
  session,
  sessionRoster = [],
  input = {}
}) {
  const classId = clean(classData.id);
  const sessionId = clean(session.sessionId);
  const sessionDate = normalizeDate(session.date);
  const sessionStartTime = normalizeTime(session.startTime);
  const sessionEndTime = normalizeTime(session.endTime);
  const teacherId = resolveTeacherId(session, classData);
  const teacherName = resolveTeacherName(session, classData);

  const reportScope = reportScopePolicy.normalizeReportScope(input.reportScope || 'class');
  const reportStartDate = normalizeDate(input.reportStartDate);
  const reportDueDate = normalizeDate(input.reportDueDate) || sessionDate;
  const taskStartTime = normalizeTime(input.taskStartTime || sessionStartTime);
  const taskEndTime = normalizeTime(input.taskEndTime || sessionEndTime);
  const conflictPermitted = input.conflictPermitted !== undefined
    ? parseBoolean(input.conflictPermitted, true)
    : true;
  const timesheetReflection = parseBoolean(input.timesheetReflection, false);
  const conductRequiredBeforeFill = input.conductRequiredBeforeFill !== undefined
    ? parseBoolean(input.conductRequiredBeforeFill, true)
    : true;
  const allocatedHours = timesheetReflection
    ? parseNumber(input.allocatedHours, resolveAllocatedHours(taskStartTime, taskEndTime))
    : 0;
  const notes = clean(input.notes);
  const templateId = clean(input.templateId);
  const selectedTargetStudentIds = Array.isArray(input.targetStudentIds)
    ? input.targetStudentIds.map(clean).filter(Boolean)
    : clean(input.targetStudentIds).split(',').map(clean).filter(Boolean);

  return {
    classId,
    sessionId,
    sessionDate,
    sessionStartTime,
    sessionEndTime,
    teacherId,
    teacherName,
    reportScope,
    reportStartDate,
    reportDueDate,
    taskStartTime,
    taskEndTime,
    conflictPermitted,
    timesheetReflection,
    conductRequiredBeforeFill,
    allocatedHours,
    notes,
    templateId,
    selectedTargetStudentIds
  };
}

function validateSessionAssignmentParsed(parsed, sessionRoster = []) {
  if (!parsed.sessionDate) throw new Error('Session date is required before assigning a report.');
  if (!parsed.teacherId) throw new Error('The session needs an assigned teacher before assigning a report.');
  if (!parsed.templateId) throw new Error('Template is required.');
  if (!parsed.reportStartDate) throw new Error('Start Date is required.');
  if (parsed.reportStartDate > parsed.reportDueDate) {
    throw new Error('Start Date cannot be after the report due date.');
  }

  assertTaskWindowInsideSession({
    taskStartTime: parsed.taskStartTime,
    taskEndTime: parsed.taskEndTime,
    sessionStartTime: parsed.sessionStartTime,
    sessionEndTime: parsed.sessionEndTime
  });

  if (parsed.reportScope === 'selected_students') {
    const rosterIds = collectRosterStudentIds(sessionRoster);
    if (!parsed.selectedTargetStudentIds.length) {
      throw new Error('Select at least one student for Specific Students scope.');
    }
    const invalidIds = parsed.selectedTargetStudentIds.filter((id) => !rosterIds.has(id));
    if (invalidIds.length) throw new Error('One or more selected students are not in this session roster.');
  }
}

async function updateExistingAssignmentWithMergedRow({
  existing,
  classData,
  classId,
  session,
  sessionRoster,
  parsed,
  incomingRow,
  reqUser
}) {
  const resolvedTemplateId = toPublicId(existing?.templateId || parsed.templateId);
  if (!resolvedTemplateId) throw new Error('Template is required.');

  const mergedRows = mergeTargetRows(existing.targetRows, incomingRow);
  const rowStudentIds = resolveWizardRowStudentIds(
    parsed.reportScope,
    parsed.selectedTargetStudentIds,
    sessionRoster
  );

  const {
    template,
    effectiveTargetRows,
    persistedTargetStudentIds
  } = await reportIntegrityService.validateAssignmentCrossEntityContext({
    classId: toPublicId(classId),
    templateId: resolvedTemplateId,
    reqUser,
    reportScope: parsed.reportScope,
    hasSessionTargets: true,
    selectedSessionIds: [parsed.sessionId],
    teacherIds: [parsed.teacherId],
    requestedTaskStartTime: parsed.taskStartTime,
    requestedTaskEndTime: parsed.taskEndTime,
    conflictPermitted: parsed.conflictPermitted,
    requestedReportStartDate: parsed.reportStartDate,
    requestedReportDueDate: parsed.reportDueDate,
    selectedTargetStudentIds: rowStudentIds,
    targetRows: mergedRows,
    excludeAssignmentId: toPublicId(existing.id)
  });

  const firstActiveRow = effectiveTargetRows.find((row) => String(row?.status || '').toLowerCase() === 'active')
    || effectiveTargetRows[0];
  const rowTeacherIds = [...new Set(effectiveTargetRows
    .map((row) => toPublicId(row?.teacherId))
    .filter(Boolean))];
  const resolvedConductRequired = parsed.conductRequiredBeforeFill !== undefined
    ? parsed.conductRequiredBeforeFill
    : parseBoolean(template?.conductRequiredBeforeFill, true);
  const now = new Date().toISOString();
  const basePayload = {
    orgId: toPublicId(existing.orgId || classData.orgId || reqUser?.activeOrgId),
    classId: toPublicId(classId),
    reportScope: parsed.reportScope,
    targetStudentIds: persistedTargetStudentIds,
    templateId: template.id,
    templateVersion: Number(template.version || 1),
    teacherIds: rowTeacherIds.length ? rowTeacherIds : [parsed.teacherId],
    targetRows: effectiveTargetRows.map((row) => ({
      ...row,
      conductRequiredBeforeFill: resolvedConductRequired
    })),
    targetType: firstActiveRow.targetType,
    sessionId: firstActiveRow.sessionId,
    sessionDate: firstActiveRow.sessionDate,
    dueDate: firstActiveRow.dueDate,
    conflictPermitted: firstActiveRow.conflictPermitted,
    taskStartTime: firstActiveRow.taskStartTime,
    taskEndTime: firstActiveRow.taskEndTime,
    reportStartDate: firstActiveRow.reportStartDate,
    reportDueDate: firstActiveRow.reportDueDate,
    status: existing.status || 'active',
    notes: existing.notes || incomingRow.notes,
    timesheetReflection: firstActiveRow.timesheetReflection,
    allocatedHours: firstActiveRow.timesheetReflection ? Number(firstActiveRow.allocatedHours) : 0,
    conductRequiredBeforeFill: resolvedConductRequired,
    audit: {
      createUser: existing?.audit?.createUser || reqUser?.id || '',
      createDateTime: existing?.audit?.createDateTime || now,
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: now
    }
  };

  await schoolDataService.updateData('reportAssignments', existing.id, basePayload, reqUser);
  await classReferenceSyncService.cleanupReportInstancesForRemovedTargetRows({
    assignmentId: existing.id,
    previousAssignment: existing,
    nextAssignment: { ...existing, ...basePayload, id: existing.id },
    reqUser
  });
  await classReferenceSyncService.notifyClassReferencesChanged({
    classId: toPublicId(classId),
    reason: `session_target_row:${existing.id}`,
    reqUser
  });

  return {
    assignment: { ...existing, ...basePayload, id: existing.id },
    template,
    teacherId: parsed.teacherId,
    teacherName: parsed.teacherName,
    targetRows: basePayload.targetRows,
    createdAssignment: false,
    message: 'Report target row added to the existing report assignment.'
  };
}

async function upsertSessionTargetRowForAssignment({
  classData,
  session,
  sessionRoster = [],
  input = {},
  reqUser
}) {
  if (!classData?.id) throw new Error('Class is required.');
  if (!session?.sessionId) throw new Error('Session is required.');

  const parsed = parseSessionAssignmentInput({ classData, session, sessionRoster, input });
  validateSessionAssignmentParsed(parsed, sessionRoster);

  const incomingRow = buildSessionTargetRow({
    session,
    reportStartDate: parsed.reportStartDate,
    reportDueDate: parsed.reportDueDate,
    taskStartTime: parsed.taskStartTime,
    taskEndTime: parsed.taskEndTime,
    conflictPermitted: parsed.conflictPermitted,
    timesheetReflection: parsed.timesheetReflection,
    allocatedHours: parsed.allocatedHours,
    conductRequiredBeforeFill: parsed.conductRequiredBeforeFill,
    teacherId: parsed.teacherId,
    reportScope: parsed.reportScope,
    targetStudentIds: parsed.selectedTargetStudentIds,
    sessionRoster,
    notes: parsed.notes
  });

  const assignments = await loadScopedReportAssignments(reqUser);
  const existing = findReportAssignmentForClass(assignments, parsed.classId, parsed.reportScope);

  if (existing?.id) {
    return updateExistingAssignmentWithMergedRow({
      existing,
      classData,
      classId: parsed.classId,
      session,
      sessionRoster,
      parsed,
      incomingRow,
      reqUser
    });
  }

  const createResult = await createAssignmentForSession({
    classData,
    session,
    sessionRoster,
    input,
    reqUser,
    parsed,
    incomingRow
  });
  return {
    ...createResult,
    createdAssignment: true
  };
}

async function createAssignmentForSession({
  classData,
  session,
  sessionRoster = [],
  input = {},
  reqUser,
  parsed: parsedOverride,
  incomingRow: incomingRowOverride
}) {
  if (!classData?.id) throw new Error('Class is required.');
  if (!session?.sessionId) throw new Error('Session is required.');

  const parsed = parsedOverride || parseSessionAssignmentInput({ classData, session, sessionRoster, input });
  if (!parsedOverride) validateSessionAssignmentParsed(parsed, sessionRoster);

  const {
    classId,
    sessionId,
    sessionDate,
    teacherId,
    teacherName,
    reportScope,
    reportStartDate,
    reportDueDate,
    taskStartTime,
    taskEndTime,
    conflictPermitted,
    timesheetReflection,
    conductRequiredBeforeFill,
    allocatedHours,
    notes,
    templateId,
    selectedTargetStudentIds
  } = parsed;

  const targetRows = [incomingRowOverride || buildSessionTargetRow({
    session,
    reportStartDate,
    reportDueDate,
    taskStartTime,
    taskEndTime,
    conflictPermitted,
    timesheetReflection,
    allocatedHours,
    conductRequiredBeforeFill,
    teacherId,
    reportScope,
    targetStudentIds: selectedTargetStudentIds,
    sessionRoster,
    notes
  })];

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
    selectedTargetStudentIds: resolveWizardRowStudentIds(reportScope, selectedTargetStudentIds, sessionRoster),
    targetRows
  });

  const resolvedConductRequired = input.conductRequiredBeforeFill !== undefined
    ? parseBoolean(input.conductRequiredBeforeFill, true)
    : parseBoolean(template?.conductRequiredBeforeFill, true);
  const normalizedTargetRows = effectiveTargetRows.map((row) => ({
    ...row,
    conductRequiredBeforeFill: resolvedConductRequired
  }));
  const normalizedFirstActiveRow = normalizedTargetRows.find((row) => String(row?.status || '').toLowerCase() === 'active') || normalizedTargetRows[0];
  const now = new Date().toISOString();
  const payload = {
    orgId: clean(classData.orgId || reqUser?.activeOrgId),
    classId,
    reportScope,
    targetStudentIds: persistedTargetStudentIds,
    templateId: template.id,
    templateVersion: Number(template.version || 1),
    teacherIds: [teacherId],
    targetRows: normalizedTargetRows,
    targetType: normalizedFirstActiveRow.targetType,
    sessionId: normalizedFirstActiveRow.sessionId,
    sessionDate: normalizedFirstActiveRow.sessionDate,
    dueDate: normalizedFirstActiveRow.dueDate,
    conflictPermitted: normalizedFirstActiveRow.conflictPermitted,
    taskStartTime: normalizedFirstActiveRow.taskStartTime,
    taskEndTime: normalizedFirstActiveRow.taskEndTime,
    reportStartDate: normalizedFirstActiveRow.reportStartDate,
    reportDueDate: normalizedFirstActiveRow.reportDueDate,
    status: 'active',
    notes,
    timesheetReflection: normalizedFirstActiveRow.timesheetReflection,
    allocatedHours: normalizedFirstActiveRow.timesheetReflection ? Number(normalizedFirstActiveRow.allocatedHours) : 0,
    conductRequiredBeforeFill: resolvedConductRequired,
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
    targetRows: normalizedTargetRows,
    message: `Report assigned to this session for ${teacherName || teacherId}.`
  };
}

module.exports = {
  addMinutes,
  buildSessionTargetRow,
  createAssignmentForSession,
  findReportAssignmentForClass,
  mergeTargetRows,
  resolveAllocatedHours,
  resolveTeacherId,
  resolveTeacherName,
  resolveWizardRowStudentIds,
  upsertSessionTargetRowForAssignment
};
