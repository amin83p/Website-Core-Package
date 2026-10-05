'use strict';

const schoolDataService = require('./schoolDataService');
const semiMonthlyReportPolicyModel = require('../../models/school/semiMonthlyReportPolicyModel');
const sessionReportAssignmentService = require('./sessionReportAssignmentService');
const reportAssignmentStudentEligibilityService = require('./reportAssignmentStudentEligibilityService');
const reportViewService = require('./reportViewService');
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
  assignments = [],
  classes = [],
  reportScope = 'class',
  programId = ''
} = {}) {
  return matchAssignmentClasses({
    assignments,
    classes,
    reportScope,
    programIds: [programId]
  }).length;
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
  let cursor = end;
  while (cursor && cursor >= start) {
    const everyClassHasSession = classIds.every((classId) => sessionsOnDate(sessionsByClassId[classId], cursor).length > 0);
    if (everyClassHasSession) {
      return {
        ok: true,
        verifiedEndDate: cursor,
        adjusted: cursor !== end,
        message: cursor === end
          ? `Reports will be assigned on ${cursor}.`
          : `No session is scheduled for every class on ${end}. The assignment date is ${cursor}.`
      };
    }
    cursor = addDaysIso(cursor, -1);
  }
  return {
    ok: false,
    verifiedEndDate: '',
    message: 'No day in this range has a scheduled session for every selected class.'
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

async function countProgramClasses({ reportScope, programId, reqUser } = {}) {
  const context = await loadScopeContext(reqUser);
  return {
    programId: toPublicId(programId),
    classCount: countClassesForProgram({
      assignments: context.assignments,
      classes: context.classes,
      reportScope,
      programId
    })
  };
}

async function loadMatchedClasses({ reportScope, programIds, reqUser } = {}) {
  const context = await loadScopeContext(reqUser);
  return matchAssignmentClasses({
    assignments: context.assignments,
    classes: context.classes,
    reportScope,
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
  const matched = await loadMatchedClasses({ reportScope, programIds, reqUser });
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
  const matched = await loadMatchedClasses({ reportScope: scope, programIds, reqUser });
  const classes = [];
  for (const classRow of matched) {
    const classId = toPublicId(classRow.id);
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
  const classData = await dependencies.schoolDataService.getDataById('classes', classId, reqUser);
  if (!classData) throw new Error('Class not found.');
  const sessions = await dependencies.schoolDataService.getClassSessions(classId, reqUser);
  const session = pickLatestSessionOnDate(sessions, verifiedEndDate);
  if (!session) throw new Error('No scheduled session was found on the verified date.');
  const window = taskWindowBeforeSessionEnd(session, hoursBeforeEnd);
  if (!window.ok) throw new Error(window.message);
  const result = await dependencies.sessionReportAssignmentService.createAssignmentForSession({
    classData,
    session,
    sessionRoster: Array.isArray(session.roster) ? session.roster : [],
    reqUser,
    input: {
      templateId,
      reportScope,
      reportStartDate,
      taskStartTime: window.taskStartTime,
      taskEndTime: window.taskEndTime,
      conflictPermitted,
      timesheetReflection,
      conductRequiredBeforeFill,
      allocatedHours,
      targetStudentIds,
      notes: 'Semi-monthly report assignment wizard.'
    }
  });
  return {
    assignmentId: toPublicId(result?.assignment?.id),
    message: result?.message || 'Report assigned.'
  };
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
  pickLatestSessionOnDate,
  resolveVerifiedEndDate,
  taskWindowBeforeSessionEnd,
  countProgramClasses,
  resolveDates,
  previewTiles,
  applyClassTemplate,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
