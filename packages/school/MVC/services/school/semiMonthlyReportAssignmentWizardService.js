'use strict';

const schoolDataService = require('./schoolDataService');
const semiMonthlyReportPolicyModel = require('../../models/school/semiMonthlyReportPolicyModel');
const sessionReportAssignmentService = require('./sessionReportAssignmentService');
const reportAssignmentStudentEligibilityService = require('./reportAssignmentStudentEligibilityService');
const reportViewService = require('./reportViewService');
const reportScopePolicy = require('./reportScopePolicy');
const sessionManagementService = require('./sessionManagementService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const schoolIndexService = require('./schoolIndexService');
const classSessionCapacityService = require('./classSessionCapacityService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const CANCELLED_SESSION_STATUSES = new Set(['cancelled', 'canceled', 'deleted', 'void']);
const MAX_SESSION_LOOKBACK_DAYS = 5;

let dependencies = {
  schoolDataService,
  semiMonthlyReportPolicyModel,
  sessionReportAssignmentService,
  reportAssignmentStudentEligibilityService,
  reportViewService,
  sessionManagementService,
  sessionStatusPolicyService,
  schoolIndexService
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

function normalizeClassCapacityTarget(value = '') {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'group' || token === 'one_on_one') return token;
  return 'all';
}

function classMatchesCapacityTarget(classRow = {}, classCapacityTarget = 'all') {
  const target = normalizeClassCapacityTarget(classCapacityTarget);
  if (target === 'all') return true;
  const maxCapacity = classSessionCapacityService.resolveClassMaxCapacity(classRow);
  if (target === 'one_on_one') return maxCapacity === 1;
  if (target === 'group') return maxCapacity > 1;
  return true;
}

function classCapacityLabel(classCapacityTarget = 'all') {
  const target = normalizeClassCapacityTarget(classCapacityTarget);
  if (target === 'group') return 'Group classes (max capacity more than 1)';
  if (target === 'one_on_one') return 'One-on-one classes (max capacity 1)';
  return 'All classes';
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
  programId = '',
  classCapacityTarget = 'all'
} = {}) {
  return (Array.isArray(classes) ? classes : [])
    .filter((classRow) => classMatchesProgram(classRow, programId))
    .filter((classRow) => classMatchesCapacityTarget(classRow, classCapacityTarget))
    .length;
}

function classesForPrograms({
  classes = [],
  programIds = [],
  classCapacityTarget = 'all'
} = {}) {
  const programs = (Array.isArray(programIds) ? programIds : []).map((id) => toPublicId(id)).filter(Boolean);
  return (Array.isArray(classes) ? classes : [])
    .filter((classRow) => programs.some((programId) => classMatchesProgram(classRow, programId)))
    .filter((classRow) => classMatchesCapacityTarget(classRow, classCapacityTarget))
    .sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));
}

const findReportAssignmentForClass = sessionReportAssignmentService.findReportAssignmentForClass;
const mergeTargetRows = sessionReportAssignmentService.mergeTargetRows;
const resolveWizardRowStudentIds = sessionReportAssignmentService.resolveWizardRowStudentIds;

function normalizeSessionForAssignment(session = {}) {
  const sessionId = toPublicId(session?.sessionId || session?.id);
  if (!sessionId) return null;
  return { ...session, sessionId };
}

function buildSemiMonthlyTargetRow(args = {}) {
  return sessionReportAssignmentService.buildSessionTargetRow({
    ...args,
    notes: args.notes || 'Semi-monthly report assignment wizard.'
  });
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

function pickClosestSessionNearPeriodEnd(
  sessions = [],
  startDate = '',
  endDate = '',
  maxLookbackDays = MAX_SESSION_LOOKBACK_DAYS
) {
  const start = normalizeDateOnly(startDate);
  const end = normalizeDateOnly(endDate);
  if (!start || !end) return null;
  const lookback = Math.max(1, Math.floor(Number(maxLookbackDays) || MAX_SESSION_LOOKBACK_DAYS));
  for (let offset = 0; offset < lookback; offset += 1) {
    const cursor = addDaysIso(end, -offset);
    if (!cursor || cursor < start) break;
    const session = pickLatestSessionOnDate(sessions, cursor);
    if (session) {
      return { session, matchedDate: cursor, daysFromEnd: offset };
    }
  }
  return null;
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
      classesMatchedNearEnd: 0,
      classesWithoutNearEndSession: 0,
      message: 'None of the program classes have a scheduled session between the period start and end dates.'
    };
  }
  let classesMatchedNearEnd = 0;
  let classesWithoutNearEndSession = 0;
  classesInRange.forEach((classId) => {
    const pick = pickClosestSessionNearPeriodEnd(sessionsByClassId[classId], start, end);
    if (pick) classesMatchedNearEnd += 1;
    else classesWithoutNearEndSession += 1;
  });
  const skippedNote = classesWithoutSessionsInRange > 0
    ? ` ${classesWithoutSessionsInRange} class(es) have no session in this period and are not included in session matching.`
    : '';
  const nearEndNote = classesWithoutNearEndSession > 0
    ? ` ${classesWithoutNearEndSession} in-range class(es) have no session within ${MAX_SESSION_LOOKBACK_DAYS} days of ${end}; they will appear blocked in the class list.`
    : '';
  return {
    ok: true,
    verifiedEndDate: end,
    adjusted: false,
    classesWithoutSessionsInRange,
    classesInRangeCount: classesInRange.length,
    classesMatchedNearEnd,
    classesWithoutNearEndSession,
    message: `Report period ends ${end}. Each class will use the nearest scheduled session within ${MAX_SESSION_LOOKBACK_DAYS} days of that date.${skippedNote}${nearEndNote}`
  };
}

function taskWindowForFullSession(session = {}) {
  const startTime = sessionStart(session);
  const endTime = sessionEnd(session);
  const endMin = timeToMinutes(endTime);
  const startMin = timeToMinutes(startTime);
  if (!Number.isFinite(endMin) || !Number.isFinite(startMin) || endMin <= startMin) {
    return { ok: false, message: 'The session does not have a valid start and end time.' };
  }
  return {
    ok: true,
    taskStartTime: startTime,
    taskEndTime: endTime
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

async function reopenCompletedSessionIfRequested({
  classId,
  classData,
  sessions = [],
  session = {},
  reopenCompletedSession = true,
  reqUser
} = {}) {
  if (reopenCompletedSession === false) return session;
  const sessionId = toPublicId(session?.sessionId || session?.id);
  if (!sessionId) return session;
  const list = Array.isArray(sessions) ? sessions : [];
  const sessionIndex = list.findIndex((row) => idsEqual(row?.sessionId || row?.id, sessionId));
  const stored = sessionIndex >= 0 ? list[sessionIndex] : session;
  const orgId = toPublicId(classData?.orgId || reqUser?.activeOrgId);
  const statusMap = await dependencies.sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
  if (!dependencies.sessionStatusPolicyService.isSessionCompletionStatusByMap(statusMap, stored)) {
    return stored;
  }
  const nextStatus = dependencies.sessionStatusPolicyService.normalizeStatusCode('scheduled');
  await dependencies.sessionManagementService.assertSessionOperationAllowed({
    classId: toPublicId(classId),
    sessionId,
    session: stored,
    classData,
    allSessions: list,
    reqUser,
    source: 'semi_monthly_wizard',
    orgId,
    operation: dependencies.sessionManagementService.SESSION_OPERATIONS.CHANGE_STATUS,
    proposedChanges: { status: nextStatus },
    statusMap
  });
  stored.status = nextStatus;
  if (sessionIndex >= 0) list[sessionIndex] = stored;
  await dependencies.schoolDataService.saveClassSessions(toPublicId(classId), list, reqUser);
  await dependencies.schoolIndexService.rebuildIndexesForClass(toPublicId(classId));
  return stored;
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

async function loadTemplates(reqUser, reportScope = 'class') {
  const scope = reportScopePolicy.normalizeReportScope(reportScope);
  const policy = await dependencies.semiMonthlyReportPolicyModel.getPolicyForOrg(reqUser?.activeOrgId);
  const ids = Array.isArray(policy?.reportTemplateIds) ? policy.reportTemplateIds : [];
  const templates = [];
  for (const templateId of ids) {
    const template = await dependencies.schoolDataService.getDataById('reportTemplates', templateId, reqUser);
    if (!template?.id) continue;
    const allowedReportScopes = reportScopePolicy.resolveAllowedReportScopes(template);
    if (!allowedReportScopes.includes(scope)) continue;
    templates.push({
      id: toPublicId(template.id),
      title: String(template.title || template.id).trim(),
      allowedReportScopes
    });
  }
  return templates;
}

function templateListIncludes(templates = [], templateId = '') {
  const id = toPublicId(templateId);
  if (!id) return false;
  return (Array.isArray(templates) ? templates : []).some((row) => idsEqual(row?.id, id));
}

function resolveTemplateIdForClass({
  existingAssignment = null,
  templates = [],
  requestedTemplateId = ''
} = {}) {
  const list = Array.isArray(templates) ? templates : [];
  const existingId = toPublicId(existingAssignment?.templateId);
  if (existingId) {
    return existingId;
  }
  const requested = toPublicId(requestedTemplateId);
  if (requested && templateListIncludes(list, requested)) {
    return requested;
  }
  const first = toPublicId(list[0]?.id);
  if (first) return first;
  throw new Error('No report templates in Semi-Monthly settings allow the selected report scope.');
}

function templateTitleFromList(templates = [], templateId = '') {
  const id = toPublicId(templateId);
  if (!id) return '';
  const row = (Array.isArray(templates) ? templates : []).find((item) => idsEqual(item?.id, id));
  return row ? String(row.title || id).trim() : id;
}

async function buildClassTemplateOptions({
  assignment = null,
  policyTemplates = [],
  reqUser
} = {}) {
  const options = [...(Array.isArray(policyTemplates) ? policyTemplates : [])];
  const existingId = toPublicId(assignment?.templateId);
  if (existingId && !templateListIncludes(options, existingId)) {
    const template = await dependencies.schoolDataService.getDataById('reportTemplates', existingId, reqUser);
    if (template?.id) {
      options.unshift({
        id: toPublicId(template.id),
        title: String(template.title || template.id).trim(),
        allowedReportScopes: reportScopePolicy.resolveAllowedReportScopes(template)
      });
    }
  }
  return options;
}

async function countProgramClasses({ programId, classCapacityTarget = 'all', reqUser } = {}) {
  const context = await loadScopeContext(reqUser);
  const capacityTarget = normalizeClassCapacityTarget(classCapacityTarget);
  return {
    programId: toPublicId(programId),
    classCapacityTarget: capacityTarget,
    classCount: countClassesForProgram({
      classes: context.classes,
      programId,
      classCapacityTarget: capacityTarget
    })
  };
}

async function loadProgramClasses({ programIds, classCapacityTarget = 'all', reqUser } = {}) {
  const context = await loadScopeContext(reqUser);
  return classesForPrograms({
    classes: context.classes,
    programIds,
    classCapacityTarget: normalizeClassCapacityTarget(classCapacityTarget)
  });
}

async function resolveDates({
  reportScope,
  programIds = [],
  classCapacityTarget = 'all',
  startDate = '',
  endDate = '',
  reqUser
} = {}) {
  const matched = await loadProgramClasses({ programIds, classCapacityTarget, reqUser });
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
  classCapacityTarget = 'all',
  startDate = '',
  endDate = '',
  verifiedEndDate = '',
  reqUser
} = {}) {
  const scope = reportScopePolicy.normalizeReportScope(reportScope);
  const capacityTarget = normalizeClassCapacityTarget(classCapacityTarget);
  const templates = await loadTemplates(reqUser, scope);
  if (!templates.length) {
    throw new Error('No report templates in Semi-Monthly settings allow the selected report scope. Update template allowed scopes or Semi-Monthly settings.');
  }
  const periodStart = normalizeDateOnly(startDate);
  const periodEnd = normalizeDateOnly(endDate) || normalizeDateOnly(verifiedEndDate);
  const noSessionNearEndMessage = `No scheduled session within ${MAX_SESSION_LOOKBACK_DAYS} days of the period end date.`;
  const context = await loadScopeContext(reqUser);
  const matched = classesForPrograms({
    classes: context.classes,
    programIds,
    classCapacityTarget: capacityTarget
  });
  const classes = [];
  for (const classRow of matched) {
    const classId = toPublicId(classRow.id);
    const assignment = findReportAssignmentForClass(context.assignments, classId, scope);
    const templateOptions = await buildClassTemplateOptions({
      assignment,
      policyTemplates: templates,
      reqUser
    });
    const defaultTemplateId = resolveTemplateIdForClass({
      existingAssignment: assignment,
      templates,
      requestedTemplateId: ''
    });
    const templateTitle = templateTitleFromList(templateOptions, defaultTemplateId)
      || templateTitleFromList(templates, defaultTemplateId);
    const sessions = await dependencies.schoolDataService.getClassSessions(classId, reqUser);
    const pick = pickClosestSessionNearPeriodEnd(sessions, periodStart, periodEnd);
    const session = pick?.session || null;
    const window = session
      ? taskWindowForFullSession(session)
      : { ok: false, message: noSessionNearEndMessage };
    const students = scope === 'class' || !session
      ? []
      : await studentsForClass({
        classData: classRow,
        sessions,
        startDate: periodStart,
        endDate: periodEnd,
        reqUser
      });
    classes.push({
      classId,
      title: String(classRow.title || classId).trim(),
      maxCapacity: classSessionCapacityService.resolveClassMaxCapacity(classRow),
      hasReportAssignment: Boolean(assignment),
      assignmentId: toPublicId(assignment?.id),
      assignmentLabel: assignment ? String(assignment.templateId || assignment.id).trim() : '',
      templateOptions,
      defaultTemplateId,
      templateTitle,
      templateLocked: Boolean(assignment?.id),
      sessionId: toPublicId(session?.sessionId || session?.id),
      sessionDate: session ? sessionDate(session) : '',
      sessionMatchDaysFromEnd: pick ? pick.daysFromEnd : null,
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
    classCapacityTarget: capacityTarget,
    classCapacityLabel: classCapacityLabel(capacityTarget),
    startDate: periodStart,
    endDate: periodEnd,
    verifiedEndDate: periodEnd,
    sessionLookbackDays: MAX_SESSION_LOOKBACK_DAYS,
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
  conflictPermitted = true,
  timesheetReflection = true,
  conductRequiredBeforeFill = true,
  allocatedHours = 0,
  reopenCompletedSession = true,
  targetStudentIds = [],
  reqUser
} = {}) {
  const scope = reportScopePolicy.normalizeReportScope(reportScope);
  const classData = await dependencies.schoolDataService.getDataById('classes', classId, reqUser);
  if (!classData) throw new Error('Class not found.');
  const sessions = await dependencies.schoolDataService.getClassSessions(classId, reqUser);
  const periodEnd = normalizeDateOnly(verifiedEndDate);
  const pick = pickClosestSessionNearPeriodEnd(sessions, normalizeDateOnly(reportStartDate), periodEnd);
  let session = normalizeSessionForAssignment(pick?.session);
  if (!session) {
    throw new Error(`No scheduled session was found within ${MAX_SESSION_LOOKBACK_DAYS} days of the period end date.`);
  }
  const window = taskWindowForFullSession(session);
  if (!window.ok) throw new Error(window.message);

  session = normalizeSessionForAssignment(await reopenCompletedSessionIfRequested({
    classId,
    classData,
    sessions,
    session,
    reopenCompletedSession,
    reqUser
  }));

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
  const templates = await loadTemplates(reqUser, scope);
  const resolvedTemplateId = resolveTemplateIdForClass({
    existingAssignment: existing,
    templates,
    requestedTemplateId: templateId
  });

  const result = await dependencies.sessionReportAssignmentService.upsertSessionTargetRowForAssignment({
    classData,
    session,
    sessionRoster,
    reqUser,
    input: {
      templateId: resolvedTemplateId,
      reportScope: scope,
      reportStartDate,
      reportDueDate,
      taskStartTime: window.taskStartTime,
      taskEndTime: window.taskEndTime,
      conflictPermitted,
      timesheetReflection,
      conductRequiredBeforeFill,
      allocatedHours: timesheetReflection ? allocatedHours : 0,
      targetStudentIds: resolveWizardRowStudentIds(scope, targetStudentIds, sessionRoster),
      notes: incomingRow.notes
    }
  });
  return {
    assignmentId: toPublicId(result?.assignment?.id),
    createdAssignment: Boolean(result?.createdAssignment),
    message: result?.message || 'Report assignment saved.'
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
    reportViewService,
    sessionManagementService,
    sessionStatusPolicyService,
    schoolIndexService
  };
}

module.exports = {
  MAX_SESSION_LOOKBACK_DAYS,
  addDaysIso,
  classMatchesProgram,
  classMatchesCapacityTarget,
  normalizeClassCapacityTarget,
  classCapacityLabel,
  matchAssignmentClasses,
  countClassesForProgram,
  classesForPrograms,
  findReportAssignmentForClass,
  pickLatestSessionOnDate,
  pickClosestSessionNearPeriodEnd,
  classHasSessionInRange,
  resolveVerifiedEndDate,
  resolveTemplateIdForClass,
  templateListIncludes,
  taskWindowForFullSession,
  taskWindowBeforeSessionEnd,
  countProgramClasses,
  resolveDates,
  previewTiles,
  applyClassTemplate,
  summarizeAssignmentAvailability,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
