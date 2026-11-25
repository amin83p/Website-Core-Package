const schoolDataService = require('./schoolDataService');
const reportIntegrityService = require('./reportIntegrityService');
const classReferenceSyncService = require('./classReferenceSyncService');
const reportScopePolicy = require('./reportScopePolicy');
const reportRosterService = require('./reportRosterService');
const reportAssignmentModel = require('../../models/school/reportAssignmentModel');
const schoolRepositories = require('../../repositories/school');
const { requireCoreModule } = require('./schoolCoreContracts');
const reportAssignmentSessionUtils = requireCoreModule('MVC/utils/reportAssignmentSessionUtils');
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

function assignmentHasTargetRow(assignment = {}, rowId = '') {
  const targetRowId = clean(rowId);
  if (!targetRowId) return false;
  const rows = reportAssignmentModel.getEffectiveTargetRows(assignment);
  if (rows.some((row) => clean(row?.rowId) === targetRowId)) return true;
  const legacyRowId = clean(assignment?.assignmentRowId || assignment?.rowId);
  return legacyRowId === targetRowId;
}

function findReportAssignmentForTargetRow(assignments = [], classId = '', reportScope = 'class', rowId = '') {
  const scope = reportScopePolicy.normalizeReportScope(reportScope);
  const classToken = toPublicId(classId);
  const targetRowId = clean(rowId);
  if (!classToken || !targetRowId) return null;
  return (Array.isArray(assignments) ? assignments : []).find((row) => (
    idsEqual(row?.classId, classToken)
    && assignmentScope(row) === scope
    && assignmentHasTargetRow(row, targetRowId)
  )) || null;
}

function classHasReportAssignmentForScope(assignments = [], classId = '', reportScope = 'class') {
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
    return [];
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
  notes = '',
  templateId = '',
  templateVersion = null
} = {}) {
  const sessionId = toPublicId(session?.sessionId);
  const sessionDateValue = normalizeDate(session?.date || session?.sessionDate);
  const scope = reportScopePolicy.normalizeReportScope(reportScope);
  const studentScoped = scope === 'each_student' || scope === 'selected_students';
  const rowStudentIds = resolveWizardRowStudentIds(scope, targetStudentIds, sessionRoster);
  const payload = {
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
  const stampedTemplateId = toPublicId(templateId);
  if (stampedTemplateId) {
    payload.templateId = stampedTemplateId;
    if (templateVersion != null && templateVersion !== '') {
      payload.templateVersion = Math.max(1, Number(templateVersion) || 1);
    }
  }
  return payload;
}

async function resolveTemplateStampFields(templateId, reqUser) {
  const id = toPublicId(templateId);
  if (!id) throw new Error('Template is required.');
  const template = typeof schoolRepositories.reportTemplates?.getById === 'function'
    ? await schoolRepositories.reportTemplates.getById(id, reqUser)
    : null;
  if (!template) throw new Error('Template not found.');
  return {
    templateId: id,
    templateVersion: Math.max(1, Number(template.version || 1) || 1)
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
  const resolvedTemplateId = toPublicId(parsed.templateId || existing?.templateId);
  if (!resolvedTemplateId) throw new Error('Template is required.');
  const templateStamp = await resolveTemplateStampFields(resolvedTemplateId, reqUser);

  const incomingRowId = clean(incomingRow?.rowId);
  const priorRow = reportAssignmentModel.findEffectiveTargetRow(existing, incomingRowId) || {};
  const mergedRow = {
    ...priorRow,
    ...incomingRow,
    rowId: incomingRowId || clean(priorRow?.rowId),
    status: clean(priorRow?.status) || 'active'
  };
  if (!clean(mergedRow?.templateId)) {
    mergedRow.templateId = templateStamp.templateId;
    mergedRow.templateVersion = templateStamp.templateVersion;
  }
  const mergedTargetRows = mergeTargetRows(
    reportAssignmentModel.getEffectiveTargetRows(existing),
    mergedRow
  );
  const rowStudentIds = resolveWizardRowStudentIds(
    parsed.reportScope,
    parsed.selectedTargetStudentIds,
    sessionRoster
  );
  const validateTemplateId = reportAssignmentModel.resolveTargetRowTemplateFields(
    existing,
    mergedRow
  ).templateId || resolvedTemplateId;

  const {
    template,
    effectiveTargetRows,
    persistedTargetStudentIds
  } = await reportIntegrityService.validateAssignmentCrossEntityContext({
    classId: toPublicId(classId),
    templateId: validateTemplateId,
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
    targetRows: mergedTargetRows,
    excludeAssignmentId: toPublicId(existing.id),
    validateOnlyRowIds: incomingRowId ? [incomingRowId] : null
  });

  const activeRow = effectiveTargetRows.find((row) => clean(row?.rowId) === incomingRowId)
    || effectiveTargetRows[0]
    || mergedRow;
  const firstActiveRow = effectiveTargetRows.find((row) => String(row?.status || '').toLowerCase() === 'active')
    || effectiveTargetRows[0]
    || activeRow;
  const resolvedConductRequired = parsed.conductRequiredBeforeFill !== undefined
    ? parsed.conductRequiredBeforeFill
    : parseBoolean(template?.conductRequiredBeforeFill, true);
  const now = new Date().toISOString();
  const basePayload = {
    orgId: toPublicId(existing.orgId || classData.orgId || reqUser?.activeOrgId),
    classId: toPublicId(classId),
    reportScope: parsed.reportScope,
    targetStudentIds: persistedTargetStudentIds,
    templateId: toPublicId(existing.templateId || template.id),
    templateVersion: Number(existing.templateVersion || template.version || 1),
    teacherIds: [...new Set(effectiveTargetRows.map((row) => toPublicId(row?.teacherId)).filter(Boolean))],
    targetRows: effectiveTargetRows.map((row) => ({
      ...row,
      conductRequiredBeforeFill: row?.conductRequiredBeforeFill !== undefined
        ? Boolean(row.conductRequiredBeforeFill)
        : resolvedConductRequired
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
    message: 'Report assignment updated for this session and report period.'
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
  const templateStamp = await resolveTemplateStampFields(parsed.templateId, reqUser);

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
    notes: parsed.notes,
    templateId: templateStamp.templateId,
    templateVersion: templateStamp.templateVersion
  });

  const assignments = await loadScopedReportAssignments(reqUser);
  const incomingRowId = clean(incomingRow?.rowId);
  let existing = findReportAssignmentForTargetRow(
    assignments,
    parsed.classId,
    parsed.reportScope,
    incomingRowId
  );
  if (!existing?.id) {
    existing = findReportAssignmentForClass(assignments, parsed.classId, parsed.reportScope);
  }

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
  const templateStamp = await resolveTemplateStampFields(parsed.templateId, reqUser);

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
    notes,
    templateId: templateStamp.templateId,
    templateVersion: templateStamp.templateVersion
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

function isActiveTargetRow(row = {}) {
  const status = String(row?.status || 'active').trim().toLowerCase();
  return status !== 'inactive' && status !== 'deleted' && status !== 'void';
}

function findActiveTargetRowsForSession(assignment = null, sessionId = '') {
  const targetSessionId = toPublicId(sessionId);
  if (!assignment || !targetSessionId) return [];
  const rows = Array.isArray(assignment.targetRows) ? assignment.targetRows : [];
  return rows.filter((row) => isActiveTargetRow(row) && idsEqual(row?.sessionId, targetSessionId));
}

function summarizeSessionTargetRowsForPreview(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    reportStartDate: normalizeDate(row?.reportStartDate),
    reportDueDate: normalizeDate(row?.reportDueDate || row?.dueDate || row?.sessionDate),
    taskStartTime: clean(row?.taskStartTime),
    taskEndTime: clean(row?.taskEndTime),
    targetStudentCount: Array.isArray(row?.targetStudentIds) ? row.targetStudentIds.length : 0
  }));
}

async function resolveEffectiveRowStudentIds(assignment, targetRow, {
  classData = null,
  session = null,
  sessions = [],
  sessionRoster = [],
  reqUser
} = {}) {
  const configured = reportRosterService.resolveConfiguredTargetStudentIds(assignment, targetRow);
  if (configured.length) return configured;
  const scope = reportAssignmentSessionUtils.inferAssignmentReportScope(assignment);
  if (scope !== 'each_student') return [];
  return reportRosterService.resolveEachStudentTargetPersonIds({
    assignment,
    targetRow,
    classData,
    sessions,
    session,
    sessionRoster,
    reqUser
  });
}

async function removeStudentFromSessionReportAssignment({
  assignmentId,
  assignmentRowId = '',
  studentId,
  classData,
  session,
  sessions = [],
  sessionRoster = [],
  reqUser
} = {}) {
  const cleanAssignmentId = toPublicId(assignmentId);
  const cleanStudentId = toPublicId(studentId);
  if (!cleanAssignmentId || !cleanStudentId) {
    throw new Error('Assignment and student are required.');
  }

  const assignment = await schoolDataService.getDataById('reportAssignments', cleanAssignmentId, reqUser);
  if (!assignment) throw new Error('Report assignment not found.');

  const scope = reportAssignmentSessionUtils.inferAssignmentReportScope(assignment);
  if (scope !== 'each_student' && scope !== 'selected_students') {
    throw new Error('This report type cannot remove individual students from the session list.');
  }

  const rowIdToken = clean(assignmentRowId);
  const sessionContext = {
    classId: toPublicId(classData?.id || assignment.classId),
    sessionId: toPublicId(session?.sessionId || session?.id),
    sessionDate: clean(session?.date)
  };
  const effectiveRows = reportAssignmentModel.getEffectiveTargetRows(assignment);
  const rowsToUpdate = rowIdToken
    ? effectiveRows.filter((row) => clean(row?.rowId) === rowIdToken)
    : effectiveRows.filter((row) => reportAssignmentSessionUtils.reportAssignmentMatchesSession({
      ...assignment,
      sessionId: row?.sessionId,
      sessionDate: row?.sessionDate || row?.reportDueDate || row?.dueDate
    }, sessionContext));

  if (!rowsToUpdate.length) {
    throw new Error('Report assignment target row not found for this session.');
  }

  const updateRowIds = new Set(rowsToUpdate.map((row) => clean(row?.rowId)));

  const instanceRows = await schoolDataService.fetchData(
    'reportInstances',
    { page: 1, limit: 10000, assignmentId__eq: cleanAssignmentId },
    reqUser
  );
  const instanceIdsToDelete = (Array.isArray(instanceRows) ? instanceRows : [])
    .filter((row) => idsEqual(row?.studentId, cleanStudentId))
    .filter((row) => {
      const instanceRowId = clean(row?.assignmentRowId);
      if (!updateRowIds.size) return true;
      return [...updateRowIds].some((rowId) => !rowId || rowId === instanceRowId);
    })
    .map((row) => toPublicId(row?.id))
    .filter(Boolean);
  if (instanceIdsToDelete.length) {
    const cleanup = await classReferenceSyncService.deleteReportInstancesByIds({
      instanceIds: instanceIdsToDelete,
      reqUser,
      orgId: assignment.orgId,
      classId: assignment.classId,
      reason: `session_report_student_removed:${cleanAssignmentId}`
    });
    if (cleanup.errors.length) throw new Error(cleanup.errors.join('; '));
  }

  const previousAssignment = JSON.parse(JSON.stringify(assignment));
  let studentRemoved = false;
  const nextTargetRows = [];

  for (const row of effectiveRows) {
    const rowId = clean(row?.rowId);
    if (!updateRowIds.has(rowId)) {
      nextTargetRows.push(row);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const currentIds = await resolveEffectiveRowStudentIds(assignment, row, {
      classData,
      session,
      sessions,
      sessionRoster,
      reqUser
    });
    if (!currentIds.some((id) => idsEqual(id, cleanStudentId))) {
      throw new Error('Student is not assigned to this report for this session.');
    }
    studentRemoved = true;
    const nextIds = currentIds.filter((id) => !idsEqual(id, cleanStudentId));
    nextTargetRows.push({
      ...row,
      targetStudentIds: nextIds
    });
  }

  if (!studentRemoved) throw new Error('Student is not assigned to this report for this session.');

  const now = new Date().toISOString();
  const nextAssignment = {
    ...assignment,
    targetRows: nextTargetRows,
    audit: {
      ...(assignment.audit || {}),
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: now
    }
  };

  await schoolDataService.updateData('reportAssignments', cleanAssignmentId, nextAssignment, reqUser);
  await classReferenceSyncService.cleanupReportInstancesForRemovedTargetStudents({
    assignmentId: cleanAssignmentId,
    previousAssignment,
    nextAssignment,
    reqUser
  });
  await classReferenceSyncService.notifyClassReferencesChanged({
    classId: toPublicId(classData?.id || assignment.classId),
    reason: `session_report_student_removed:${cleanAssignmentId}`,
    reqUser
  });

  return { assignment: nextAssignment };
}

async function removeReportInstanceFromAssignmentContext({
  instanceId,
  assignmentId = '',
  assignmentRowId = '',
  studentId = '',
  reqUser,
  sessionUnassignContext = null
} = {}) {
  const normalizedInstanceId = String(instanceId || '').trim();
  if (!normalizedInstanceId || normalizedInstanceId.startsWith('pending-')) {
    throw new Error('Report instance is required.');
  }

  const instance = await reportIntegrityService.assertInstanceDeletable(normalizedInstanceId, reqUser);
  const expectedAssignmentId = toPublicId(assignmentId);
  if (expectedAssignmentId && !idsEqual(instance.assignmentId, expectedAssignmentId)) {
    throw new Error('This report instance does not belong to this assignment.');
  }

  if (sessionUnassignContext) {
    const expectedClassId = toPublicId(sessionUnassignContext.expectedClassId);
    const expectedSessionId = toPublicId(sessionUnassignContext.expectedSessionId);
    if (expectedClassId && !idsEqual(instance.classId, expectedClassId)) {
      throw new Error('This report instance does not belong to this session.');
    }
    if (expectedSessionId && !idsEqual(instance.sessionId, expectedSessionId)) {
      throw new Error('This report instance does not belong to this session.');
    }
  }

  const resolvedAssignmentId = toPublicId(instance.assignmentId);
  const resolvedAssignmentRowId = String(assignmentRowId || instance.assignmentRowId || '').trim();
  const resolvedStudentId = toPublicId(studentId || instance.studentId);

  await schoolDataService.deleteData('reportInstances', normalizedInstanceId, reqUser);
  await classReferenceSyncService.notifyAfterReportDelete({ record: instance, reqUser: reqUser });

  if (sessionUnassignContext && sessionUnassignContext.classData && sessionUnassignContext.session) {
    await removeStudentFromSessionReportAssignment({
      assignmentId: resolvedAssignmentId,
      assignmentRowId: resolvedAssignmentRowId,
      studentId: resolvedStudentId,
      classData: sessionUnassignContext.classData,
      session: sessionUnassignContext.session,
      sessions: sessionUnassignContext.sessions || [],
      sessionRoster: sessionUnassignContext.sessionRoster || [],
      reqUser
    });
  }

  return {
    instanceId: normalizedInstanceId,
    assignmentId: resolvedAssignmentId,
    assignmentRowId: resolvedAssignmentRowId,
    studentId: resolvedStudentId
  };
}

module.exports = {
  addMinutes,
  buildSessionTargetRow,
  createAssignmentForSession,
  findReportAssignmentForClass,
  findReportAssignmentForTargetRow,
  classHasReportAssignmentForScope,
  assignmentHasTargetRow,
  findActiveTargetRowsForSession,
  summarizeSessionTargetRowsForPreview,
  mergeTargetRows,
  resolveAllocatedHours,
  resolveTeacherId,
  resolveTeacherName,
  resolveWizardRowStudentIds,
  removeStudentFromSessionReportAssignment,
  removeReportInstanceFromAssignmentContext,
  upsertSessionTargetRowForAssignment
};
