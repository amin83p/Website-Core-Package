'use strict';

const schoolDataService = require('./schoolDataService');
const semiMonthlyReportPolicyModel = require('../../models/school/semiMonthlyReportPolicyModel');
const sessionReportAssignmentService = require('./sessionReportAssignmentService');
const reportAssignmentStudentEligibilityService = require('./reportAssignmentStudentEligibilityService');
const reportViewService = require('./reportViewService');
const reportIntegrityService = require('./reportIntegrityService');
const classReferenceSyncService = require('./classReferenceSyncService');
const reportScopePolicy = require('./reportScopePolicy');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const CANCELLED_SESSION_STATUSES = new Set(['cancelled', 'canceled', 'deleted', 'void']);

let dependencies = {
  schoolDataService,
  semiMonthlyReportPolicyModel,
  sessionReportAssignmentService,
  reportAssignmentStudentEligibilityService,
  reportViewService
};

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function addDaysIso(dateStr, days) {
  const date = normalizeDateOnly(dateStr);
  if (!date) return '';
  const [year, month, day] = date.split('-').map(Number);
  const cursor = new Date(year, month - 1, day);
  cursor.setDate(cursor.getDate() + Number(days || 0));
  const nextMonth = String(cursor.getMonth() + 1).padStart(2, '0');
  const nextDay = String(cursor.getDate()).padStart(2, '0');
  return `${cursor.getFullYear()}-${nextMonth}-${nextDay}`;
}

function timeToMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return NaN;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function minutesToTime(total) {
  const minutes = Math.max(0, Math.floor(Number(total) || 0));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function sessionDate(session = {}) {
  return normalizeDateOnly(session.date || session.sessionDate);
}

function sessionEnd(session = {}) {
  return String(session.endTime || session.end || '').trim();
}

function sessionStart(session = {}) {
  return String(session.startTime || session.start || '').trim();
}

function isScheduledSession(session = {}) {
  const status = String(session.status || '').trim().toLowerCase();
  if (!status) return true;
  return !CANCELLED_SESSION_STATUSES.has(status);
}

function classMatchesProgram(classRow = {}, programId = '') {
  const target = toPublicId(programId);
  if (!target) return false;
  const terms = Array.isArray(classRow.allowedProgramTerms) ? classRow.allowedProgramTerms : [];
  return terms.some((row) => idsEqual(row?.programId, target));
}

function assignmentScope(assignment = {}) {
  try {
    return reportScopePolicy.normalizeReportScope(assignment.reportScope);
  } catch (error) {
    return 'class';
  }
}

function matchAssignmentClasses({
  assignments = [],
  classes = [],
  reportScope = 'class',
  programIds = []
} = {}) {
  const scope = reportScopePolicy.normalizeReportScope(reportScope);
  const programs = (Array.isArray(programIds) ? programIds : []).map((id) => toPublicId(id)).filter(Boolean);
  const classById = new Map(
    (Array.isArray(classes) ? classes : [])
      .map((row) => [toPublicId(row?.id), row])
      .filter(([id]) => Boolean(id))
  );
  const matched = new Map();
  (Array.isArray(assignments) ? assignments : []).forEach((assignment) => {
    if (assignmentScope(assignment) !== scope) return;
    const classId = toPublicId(assignment?.classId);
    const classRow = classById.get(classId);
    if (!classRow || matched.has(classId)) return;
    if (!programs.some((programId) => classMatchesProgram(classRow, programId))) return;
    matched.set(classId, classRow);
  });
  return [...matched.values()].sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));
}

function countClassesForProgram({
  classes = [],
  programId = ''
} = {}) {
  return (Array.isArray(classes) ? classes : [])
    .filter((classRow) => classMatchesProgram(classRow, programId))
    .length;
}

function classesForPrograms({ classes = [], programIds = [] } = {}) {
  const programs = (Array.isArray(programIds) ? programIds : []).map((id) => toPublicId(id)).filter(Boolean);
  return (Array.isArray(classes) ? classes : [])
    .filter((classRow) => programs.some((programId) => classMatchesProgram(classRow, programId)))
    .sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));
}

function findReportAssignmentForClass(assignments = [], classId = '', reportScope = 'class') {
  const scope = reportScopePolicy.normalizeReportScope(reportScope);
  const classToken = toPublicId(classId);
  if (!classToken) return null;
  return (Array.isArray(assignments) ? assignments : []).find((row) => (
    idsEqual(row?.classId, classToken) && assignmentScope(row) === scope
  )) || null;
}

function normalizeSessionForAssignment(session = {}) {
  const sessionId = toPublicId(session?.sessionId || session?.id);
  if (!sessionId) return null;
  return { ...session, sessionId };
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

function buildSemiMonthlyTargetRow({
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
  notes = 'Semi-monthly report assignment wizard.'
} = {}) {
  const sessionId = toPublicId(session?.sessionId);
  const sessionDateValue = normalizeDateOnly(session?.date || session?.sessionDate);
  const studentScoped = reportScope === 'each_student' || reportScope === 'selected_students';
  const rowStudentIds = resolveWizardRowStudentIds(reportScope, targetStudentIds, sessionRoster);
  return {
    rowId: `session:${sessionId}:${normalizeDateOnly(reportStartDate)}`,
    targetType: 'session',
    sessionId,
    sessionDate: sessionDateValue,
    dueDate: '',
    reportStartDate: normalizeDateOnly(reportStartDate),
    reportDueDate: normalizeDateOnly(reportDueDate),
    taskStartTime,
    taskEndTime,
    conflictPermitted: Boolean(conflictPermitted),
    timesheetReflection: Boolean(timesheetReflection),
    allocatedHours: Number(allocatedHours) || 0,
    conductRequiredBeforeFill: conductRequiredBeforeFill !== false,
    teacherId: toPublicId(teacherId),
    status: 'active',
    notes,
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

function sessionsOnDate(sessions = [], date = '') {
  const day = normalizeDateOnly(date);
  return (Array.isArray(sessions) ? sessions : []).filter((session) => (
    isScheduledSession(session) && sessionDate(session) === day
  ));
}

function pickLatestSessionOnDate(sessions = [], date = '') {
  const rows = sessionsOnDate(sessions, date);
  rows.sort((left, right) => {
    const endCmp = sessionEnd(right).localeCompare(sessionEnd(left));
    if (endCmp !== 0) return endCmp;
    return sessionStart(right).localeCompare(sessionStart(left));
  });
  return rows[0] || null;
}

function classHasSessionInRange(sessions = [], startDate = '', endDate = '') {
  const start = normalizeDateOnly(startDate);
  const end = normalizeDateOnly(endDate);
  if (!start || !end) return false;
  return (Array.isArray(sessions) ? sessions : []).some((session) => {
    const day = sessionDate(session);
    return isScheduledSession(session) && day && day >= start && day <= end;
  });
}

function resolveVerifiedEndDate({
  startDate = '',
  endDate = '',
  sessionsByClassId = {}
} = {}) {
  const start = normalizeDateOnly(startDate);
  const end = normalizeDateOnly(endDate);
  if (!start || !end) {
    return { ok: false, message: 'Start date and end date are required.', verifiedEndDate: '' };
  }
  if (start > end) {
    return { ok: false, message: 'Start date must be on or before the end date.', verifiedEndDate: '' };
  }
  if (start.slice(0, 7) !== end.slice(0, 7)) {
    return { ok: false, message: 'Start date and end date must be in the same month.', verifiedEndDate: '' };
  }
  const classIds = Object.keys(sessionsByClassId || {});
  if (!classIds.length) {
    return { ok: false, message: 'No matching classes were found.', verifiedEndDate: '' };
  }
  const classesInRange = classIds.filter((classId) => (
    classHasSessionInRange(sessionsByClassId[classId], start, end)
  ));
  const classesWithoutSessionsInRange = classIds.length - classesInRange.length;
  if (!classesInRange.length) {
    return {
      ok: false,
      verifiedEndDate: '',
      classesWithoutSessionsInRange,
      classesInRangeCount: 0,
      message: 'None of the program classes have a scheduled session between the period start and end dates.'
    };
  }
  let cursor = end;
  while (cursor && cursor >= start) {
    const everyClassHasSession = classesInRange.every((classId) => (
      sessionsOnDate(sessionsByClassId[classId], cursor).length > 0
    ));
    if (everyClassHasSession) {
      const skippedNote = classesWithoutSessionsInRange > 0
        ? ` ${classesWithoutSessionsInRange} class(es) have no session in this period and are not included in this date check.`
        : '';
      return {
        ok: true,
        verifiedEndDate: cursor,
        adjusted: cursor !== end,
        classesWithoutSessionsInRange,
        classesInRangeCount: classesInRange.length,
        message: cursor === end
          ? `Reports will be assigned on ${cursor}.${skippedNote}`
          : `No session is scheduled for every in-range class on ${end}. The assignment date is ${cursor}.${skippedNote}`
      };
    }
    cursor = addDaysIso(cursor, -1);
  }
  const skippedSuffix = classesWithoutSessionsInRange > 0
    ? ` (${classesWithoutSessionsInRange} class(es) have no session in this period.)`
    : '';
  return {
    ok: false,
    verifiedEndDate: '',
    classesWithoutSessionsInRange,
    classesInRangeCount: classesInRange.length,
    message: `No day in this range has a scheduled session for every class that meets during the period.${skippedSuffix}`
  };
}

function taskWindowBeforeSessionEnd(session = {}, hoursBeforeEnd = 0) {
  const hours = Number(hoursBeforeEnd);
  if (!Number.isFinite(hours) || hours <= 0) {
    return { ok: false, message: 'Enter how many hours before the session ends.' };
  }
  const endMin = timeToMinutes(sessionEnd(session));
  const startMin = timeToMinutes(sessionStart(session));
  if (!Number.isFinite(endMin) || !Number.isFinite(startMin) || endMin <= startMin) {
    return { ok: false, message: 'The session does not have a valid start and end time.' };
  }
  const offset = Math.round(hours * 60);
  const taskEnd = endMin;
  const taskStart = taskEnd - offset;
  if (taskStart < startMin) {
    return { ok: false, message: 'The requested time is longer than the session.' };
  }
  return {
    ok: true,
    taskStartTime: minutesToTime(taskStart),
    taskEndTime: minutesToTime(taskEnd)
  };
}

async function loadScopeContext(reqUser) {
  const [assignments, classes] = await Promise.all([
    dependencies.schoolDataService.fetchAllData('reportAssignments', {}, reqUser),
    dependencies.schoolDataService.fetchAllData('classes', {}, reqUser)
  ]);
  const orgId = toPublicId(reqUser?.activeOrgId);
  const scopedAssignments = (Array.isArray(assignments) ? assignments : []).filter((row) => (
    !orgId || !row?.orgId || idsEqual(row.orgId, orgId)
  ));
  const scopedClasses = (Array.isArray(classes) ? classes : []).filter((row) => (
    !orgId || !row?.orgId || idsEqual(row.orgId, orgId)
  ));
  return { assignments: scopedAssignments, classes: scopedClasses };
}

async function loadTemplates(reqUser) {
  const policy = await dependencies.semiMonthlyReportPolicyModel.getPolicyForOrg(reqUser?.activeOrgId);
  const ids = Array.isArray(policy?.reportTemplateIds) ? policy.reportTemplateIds : [];
  const templates = [];
  for (const templateId of ids) {
    const template = await dependencies.schoolDataService.getDataById('reportTemplates', templateId, reqUser);
    if (!template?.id) continue;
    templates.push({
      id: toPublicId(template.id),
      title: String(template.title || template.id).trim()
    });
  }
  return templates;
}

async function countProgramClasses({ programId, reqUser } = {}) {
  const context = await loadScopeContext(reqUser);
  return {
    programId: toPublicId(programId),
    classCount: countClassesForProgram({
      classes: context.classes,
      programId
    })
  };
}

async function loadProgramClasses({ programIds, reqUser } = {}) {
  const context = await loadScopeContext(reqUser);
  return classesForPrograms({
    classes: context.classes,
    programIds
  });
}

async function resolveDates({
  reportScope,
  programIds = [],
  startDate = '',
  endDate = '',
  reqUser
} = {}) {
  const matched = await loadProgramClasses({ programIds, reqUser });
  const sessionsByClassId = {};
  for (const classRow of matched) {
    const classId = toPublicId(classRow.id);
    const sessions = await dependencies.schoolDataService.getClassSessions(classId, reqUser);
    sessionsByClassId[classId] = Array.isArray(sessions) ? sessions : [];
  }
  const resolved = resolveVerifiedEndDate({ startDate, endDate, sessionsByClassId });
  return {
    ...resolved,
    classCount: matched.length
  };
}

async function studentsForClass({
  classData,
  sessions = [],
  startDate,
  endDate,
  reqUser
} = {}) {
  const personMap = await dependencies.reportViewService.buildPersonNameMap(reqUser);
  const students = await dependencies.reportAssignmentStudentEligibilityService.resolveEligibleStudentsForAssignment({
    classData,
    sessions,
    reqUser,
    startDate,
    endDate,
    targetSessionIds: [],
    targetRows: [{
      reportStartDate: startDate,
      reportDueDate: endDate
    }],
    personMap
  });
  return (Array.isArray(students) ? students : []).map((row) => ({
    personId: toPublicId(row.personId || row.id),
    name: String(row.name || row.personId || '').trim(),
    eligibleSessionCount: Number(row.eligibleSessionCount || 0)
  })).filter((row) => row.personId);
}

async function previewTiles({
  reportScope,
  programIds = [],
  startDate = '',
  verifiedEndDate = '',
  hoursBeforeEnd = 0,
  reqUser
} = {}) {
  const scope = reportScopePolicy.normalizeReportScope(reportScope);
  const templates = await loadTemplates(reqUser);
  if (!templates.length) {
    throw new Error('Choose at least one report template in Semi-Monthly Report settings.');
  }
  const context = await loadScopeContext(reqUser);
  const matched = classesForPrograms({ classes: context.classes, programIds });
  const classes = [];
  for (const classRow of matched) {
    const classId = toPublicId(classRow.id);
    const assignment = findReportAssignmentForClass(context.assignments, classId, scope);
    const sessions = await dependencies.schoolDataService.getClassSessions(classId, reqUser);
    const session = pickLatestSessionOnDate(sessions, verifiedEndDate);
    const window = session ? taskWindowBeforeSessionEnd(session, hoursBeforeEnd) : { ok: false, message: 'No session on the verified date.' };
    const students = scope === 'class' || !session
      ? []
      : await studentsForClass({
        classData: classRow,
        sessions,
        startDate,
        endDate: verifiedEndDate,
        reqUser
      });
    classes.push({
      classId,
      title: String(classRow.title || classId).trim(),
      hasReportAssignment: Boolean(assignment),
      assignmentId: toPublicId(assignment?.id),
      assignmentLabel: assignment ? String(assignment.templateId || assignment.id).trim() : '',
      sessionId: toPublicId(session?.sessionId || session?.id),
      sessionDate: session ? sessionDate(session) : '',
      startTime: session ? sessionStart(session) : '',
      endTime: session ? sessionEnd(session) : '',
      taskStartTime: window.taskStartTime || '',
      taskEndTime: window.taskEndTime || '',
      taskWindowOk: window.ok === true,
      taskWindowMessage: window.ok ? '' : window.message,
      href: session
        ? `/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(toPublicId(session.sessionId || session.id))}`
        : '',
      students
    });
  }
  return {
    reportScope: scope,
    startDate: normalizeDateOnly(startDate),
    verifiedEndDate: normalizeDateOnly(verifiedEndDate),
    templates,
    classes
  };
}

async function applyClassTemplate({
  classId,
  templateId,
  reportScope,
  reportStartDate,
  verifiedEndDate,
  hoursBeforeEnd,
  conflictPermitted = false,
  timesheetReflection = false,
  conductRequiredBeforeFill = true,
  allocatedHours = 0,
  targetStudentIds = [],
  reqUser
} = {}) {
  const scope = reportScopePolicy.normalizeReportScope(reportScope);
  const classData = await dependencies.schoolDataService.getDataById('classes', classId, reqUser);
  if (!classData) throw new Error('Class not found.');
  const sessions = await dependencies.schoolDataService.getClassSessions(classId, reqUser);
  const session = normalizeSessionForAssignment(pickLatestSessionOnDate(sessions, verifiedEndDate));
  if (!session) throw new Error('No scheduled session was found on the verified date.');
  const window = taskWindowBeforeSessionEnd(session, hoursBeforeEnd);
  if (!window.ok) throw new Error(window.message);

  const sessionRoster = Array.isArray(session.roster) ? session.roster : [];
  const teacherId = dependencies.sessionReportAssignmentService.resolveTeacherId(session, classData);
  if (!teacherId) throw new Error('The session needs an assigned teacher before assigning a report.');

  const reportDueDate = normalizeDateOnly(session.date || session.sessionDate);
  const incomingRow = buildSemiMonthlyTargetRow({
    session,
    reportStartDate,
    reportDueDate,
    taskStartTime: window.taskStartTime,
    taskEndTime: window.taskEndTime,
    conflictPermitted,
    timesheetReflection,
    allocatedHours: timesheetReflection ? allocatedHours : 0,
    conductRequiredBeforeFill,
    teacherId,
    reportScope: scope,
    targetStudentIds,
    sessionRoster
  });

  const context = await loadScopeContext(reqUser);
  const existing = findReportAssignmentForClass(context.assignments, classId, scope);
  const templates = await loadTemplates(reqUser);
  const resolvedTemplateId = toPublicId(
    existing?.templateId || templateId || templates[0]?.id
  );
  if (!resolvedTemplateId) throw new Error('Choose at least one report template in Semi-Monthly Report settings.');

  if (existing?.id) {
    const mergedRows = mergeTargetRows(existing.targetRows, incomingRow);
    const {
      template,
      effectiveTargetRows,
      persistedTargetStudentIds
    } = await reportIntegrityService.validateAssignmentCrossEntityContext({
      classId: toPublicId(classId),
      templateId: resolvedTemplateId,
      reqUser,
      reportScope: scope,
      hasSessionTargets: true,
      selectedSessionIds: [session.sessionId],
      teacherIds: [teacherId],
      requestedTaskStartTime: window.taskStartTime,
      requestedTaskEndTime: window.taskEndTime,
      conflictPermitted,
      requestedReportStartDate: normalizeDateOnly(reportStartDate),
      requestedReportDueDate: reportDueDate,
      selectedTargetStudentIds: resolveWizardRowStudentIds(scope, targetStudentIds, sessionRoster),
      targetRows: mergedRows,
      excludeAssignmentId: toPublicId(existing.id)
    });

    const firstActiveRow = effectiveTargetRows.find((row) => String(row?.status || '').toLowerCase() === 'active')
      || effectiveTargetRows[0];
    const rowTeacherIds = [...new Set(effectiveTargetRows
      .map((row) => toPublicId(row?.teacherId))
      .filter(Boolean))];
    const now = new Date().toISOString();
    const basePayload = {
      orgId: toPublicId(existing.orgId || classData.orgId || reqUser?.activeOrgId),
      classId: toPublicId(classId),
      reportScope: scope,
      targetStudentIds: persistedTargetStudentIds,
      templateId: template.id,
      templateVersion: Number(template.version || 1),
      teacherIds: rowTeacherIds.length ? rowTeacherIds : [teacherId],
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
      status: existing.status || 'active',
      notes: existing.notes || incomingRow.notes,
      timesheetReflection: firstActiveRow.timesheetReflection,
      allocatedHours: firstActiveRow.timesheetReflection ? Number(firstActiveRow.allocatedHours) : 0,
      conductRequiredBeforeFill: conductRequiredBeforeFill !== false,
      audit: {
        createUser: existing?.audit?.createUser || reqUser?.id || '',
        createDateTime: existing?.audit?.createDateTime || now,
        lastUpdateUser: reqUser?.id || '',
        lastUpdateDateTime: now
      }
    };

    await dependencies.schoolDataService.updateData('reportAssignments', existing.id, basePayload, reqUser);
    await classReferenceSyncService.cleanupReportInstancesForRemovedTargetRows({
      assignmentId: existing.id,
      previousAssignment: existing,
      nextAssignment: { ...existing, ...basePayload, id: existing.id },
      reqUser
    });
    await classReferenceSyncService.notifyClassReferencesChanged({
      classId: toPublicId(classId),
      reason: `semi_monthly_wizard_target_row:${existing.id}`,
      reqUser
    });

    return {
      assignmentId: toPublicId(existing.id),
      createdAssignment: false,
      message: 'Report target row added to the existing report assignment.'
    };
  }

  const result = await dependencies.sessionReportAssignmentService.createAssignmentForSession({
    classData,
    session,
    sessionRoster,
    reqUser,
    input: {
      templateId: resolvedTemplateId,
      reportScope: scope,
      reportStartDate,
      taskStartTime: window.taskStartTime,
      taskEndTime: window.taskEndTime,
      conflictPermitted,
      timesheetReflection,
      conductRequiredBeforeFill,
      allocatedHours,
      targetStudentIds: resolveWizardRowStudentIds(scope, targetStudentIds, sessionRoster),
      notes: incomingRow.notes
    }
  });
  return {
    assignmentId: toPublicId(result?.assignment?.id),
    createdAssignment: true,
    message: result?.message || 'Report assignment created with target row.'
  };
}

async function summarizeAssignmentAvailability({
  classIds = [],
  reportScope = 'class',
  reqUser
} = {}) {
  const scope = reportScopePolicy.normalizeReportScope(reportScope);
  const context = await loadScopeContext(reqUser);
  const withAssignment = [];
  const withoutAssignment = [];
  (Array.isArray(classIds) ? classIds : []).forEach((classId) => {
    const classToken = toPublicId(classId);
    if (!classToken) return;
    const classRow = context.classes.find((row) => idsEqual(row?.id, classToken));
    const assignment = findReportAssignmentForClass(context.assignments, classToken, scope);
    const title = String(classRow?.title || classToken).trim();
    if (assignment) {
      withAssignment.push({ classId: classToken, title, assignmentId: toPublicId(assignment.id) });
    } else {
      withoutAssignment.push({ classId: classToken, title });
    }
  });
  return { withAssignment, withoutAssignment };
}

function __setDependenciesForTest(nextDeps = {}) {
  dependencies = { ...dependencies, ...nextDeps };
}

function __resetDependenciesForTest() {
  dependencies = {
    schoolDataService,
    semiMonthlyReportPolicyModel,
    sessionReportAssignmentService,
    reportAssignmentStudentEligibilityService,
    reportViewService
  };
}

module.exports = {
  addDaysIso,
  classMatchesProgram,
  matchAssignmentClasses,
  countClassesForProgram,
  classesForPrograms,
  findReportAssignmentForClass,
  pickLatestSessionOnDate,
  classHasSessionInRange,
  resolveVerifiedEndDate,
  taskWindowBeforeSessionEnd,
  countProgramClasses,
  resolveDates,
  previewTiles,
  applyClassTemplate,
  summarizeAssignmentAvailability,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
