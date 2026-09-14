'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const reportAssignmentSessionUtils = requireCoreModule('MVC/utils/reportAssignmentSessionUtils');
const schoolDataService = require('./schoolDataService');
const schoolDependencyService = require('./schoolDependencyService');
const schoolDeletionGuardService = require('./schoolDeletionGuardService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const sessionAttendanceEditAccessService = require('./sessionAttendanceEditAccessService');
const makeupSessionAllocationService = require('./makeupSessionAllocationService');
const bookCoveringReportService = require('./bookCoveringReportService');

function isSessionAdministrativelyLocked(session = {}) {
  if (session?.locked === true || String(session?.locked) === 'true') return true;
  return schoolDependencyService.isSessionTimesheetApprovedLock(session);
}

function isScheduledEditableSession(session = {}) {
  const status = sessionStatusPolicyService.normalizeStatusCode(session?.status || '');
  return status === 'scheduled' && !isSessionAdministrativelyLocked(session);
}

const SESSION_OPERATIONS = Object.freeze({
  DELETE: 'delete',
  CHANGE_DATE: 'change_date',
  CHANGE_TIME: 'change_time',
  CHANGE_SCHEDULE: 'change_schedule',
  CHANGE_STATUS: 'change_status',
  MARK_COMPLETE: 'mark_complete',
  CHANGE_ROOM: 'change_room',
  CHANGE_TEACHER: 'change_teacher',
  CHANGE_CO_TEACHERS: 'change_co_teachers',
  LOCK_SESSION: 'lock_session',
  UNLOCK_SESSION: 'unlock_session',
  SAVE_NOTES: 'save_notes',
  SAVE_ATTENDANCE: 'save_attendance',
  SAVE_GRADEBOOK: 'save_gradebook',
  SAVE_CONDUCT: 'save_conduct',
  SAVE_CURRICULUM: 'save_curriculum',
  UPLOAD_FILE: 'upload_file',
  CREATE_MAKEUP: 'create_makeup',
  MERGE_SESSIONS: 'merge_sessions',
  UNMERGE_SESSION: 'unmerge_session'
});

const ACTIVITY_BLOCKER_CODES = Object.freeze({
  BOOK_COVERING_REPORT: 'BOOK_COVERING_REPORT',
  REPORT_ASSIGNMENT: 'REPORT_ASSIGNMENT',
  REPORT_INSTANCE: 'REPORT_INSTANCE',
  SESSION_STUDENT_CASE: 'SESSION_STUDENT_CASE',
  SESSION_NOTES: 'SESSION_NOTES',
  GRADEBOOK_ACTIVITY: 'GRADEBOOK_ACTIVITY',
  SESSION_ATTENDANCE_MARKED: 'SESSION_ATTENDANCE_MARKED',
  SESSION_CURRICULUM: 'SESSION_CURRICULUM'
});

const DELETE_ACTIVITY_BLOCKERS = new Set([
  ACTIVITY_BLOCKER_CODES.BOOK_COVERING_REPORT,
  ACTIVITY_BLOCKER_CODES.REPORT_ASSIGNMENT,
  ACTIVITY_BLOCKER_CODES.REPORT_INSTANCE,
  ACTIVITY_BLOCKER_CODES.SESSION_STUDENT_CASE,
  ACTIVITY_BLOCKER_CODES.SESSION_NOTES,
  ACTIVITY_BLOCKER_CODES.GRADEBOOK_ACTIVITY,
  ACTIVITY_BLOCKER_CODES.SESSION_ATTENDANCE_MARKED,
  ACTIVITY_BLOCKER_CODES.SESSION_CURRICULUM
]);

const DATE_MOVE_ACTIVITY_BLOCKERS = new Set([
  ACTIVITY_BLOCKER_CODES.BOOK_COVERING_REPORT,
  ACTIVITY_BLOCKER_CODES.REPORT_ASSIGNMENT,
  ACTIVITY_BLOCKER_CODES.REPORT_INSTANCE,
  ACTIVITY_BLOCKER_CODES.SESSION_STUDENT_CASE,
  ACTIVITY_BLOCKER_CODES.GRADEBOOK_ACTIVITY
]);

const INSTRUCTIONAL_OPERATION_TARGETS = Object.freeze({
  [SESSION_OPERATIONS.SAVE_NOTES]: 'notes',
  [SESSION_OPERATIONS.SAVE_ATTENDANCE]: 'attendance',
  [SESSION_OPERATIONS.SAVE_GRADEBOOK]: 'gradebook',
  [SESSION_OPERATIONS.SAVE_CONDUCT]: 'conduct',
  [SESSION_OPERATIONS.SAVE_CURRICULUM]: 'curriculum',
  [SESSION_OPERATIONS.UPLOAD_FILE]: 'attendance'
});

const ERROR_CODES = Object.freeze({
  DELETE: 'SESSION_DELETE_BLOCKED',
  DATE_MOVE: 'SESSION_DATE_MOVE_BLOCKED',
  TIME_CHANGE: 'SESSION_TIME_CHANGE_BLOCKED',
  GENERIC: 'SESSION_OPERATION_BLOCKED'
});

class SessionOperationBlockedError extends Error {
  constructor({ code, message, operation, blockers = [] }) {
    super(message || 'Session operation is not allowed.');
    this.name = 'SessionOperationBlockedError';
    this.code = code || ERROR_CODES.GENERIC;
    this.operation = operation || '';
    this.blockers = Array.isArray(blockers) ? blockers : [];
    this.statusCode = 409;
  }
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function normalizeClockTime(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  const match = token.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hh = String(Math.max(0, Math.min(23, Number(match[1] || 0)))).padStart(2, '0');
  const mm = String(Math.max(0, Math.min(59, Number(match[2] || 0)))).padStart(2, '0');
  return `${hh}:${mm}`;
}

function buildActivityBlocker(code, label, count = 1) {
  return {
    code: String(code || '').trim(),
    label: String(label || code || 'Blocked').trim(),
    count: Number(count || 0) || 1
  };
}

function sessionContextFromRow(session = {}, classId = '', sessionId = '') {
  const safeClassId = toPublicId(classId || session?.classId);
  const safeSessionId = toPublicId(sessionId || session?.sessionId || session?.id);
  const sessionDate = normalizeDateOnly(session?.date);
  return { classId: safeClassId, sessionId: safeSessionId, sessionDate };
}

function countMarkedAttendanceRows(session = {}) {
  const roster = Array.isArray(session?.roster) ? session.roster : [];
  return roster.filter((row) => String(row?.attendanceStatus || row?.attendance || '').trim()).length;
}

function inspectEmbeddedSessionActivity(session = {}) {
  const blockers = [];
  const notes = String(session?.notes || '').trim();
  if (notes) {
    blockers.push(buildActivityBlocker(ACTIVITY_BLOCKER_CODES.SESSION_NOTES, 'Session notes'));
  }
  const gradebooks = Array.isArray(session?.gradebooks) ? session.gradebooks : [];
  if (gradebooks.length > 0) {
    blockers.push(buildActivityBlocker(
      ACTIVITY_BLOCKER_CODES.GRADEBOOK_ACTIVITY,
      'Session gradebooks',
      gradebooks.length
    ));
  }
  const attendanceMarkedCount = countMarkedAttendanceRows(session);
  if (attendanceMarkedCount > 0) {
    blockers.push(buildActivityBlocker(
      ACTIVITY_BLOCKER_CODES.SESSION_ATTENDANCE_MARKED,
      'Marked attendance',
      attendanceMarkedCount
    ));
  }
  const contentItems = Array.isArray(session?.contentItems) ? session.contentItems : [];
  const skillsCovered = Array.isArray(session?.skillsCovered) ? session.skillsCovered : [];
  const curriculumCount = contentItems.length + skillsCovered.length;
  if (curriculumCount > 0) {
    blockers.push(buildActivityBlocker(
      ACTIVITY_BLOCKER_CODES.SESSION_CURRICULUM,
      'Curriculum',
      curriculumCount
    ));
  }
  return blockers;
}

function inspectExternalSessionActivity({
  session,
  classId,
  sessionId,
  sessionDate,
  prefetched = {}
}) {
  const ctx = sessionContextFromRow(session, classId, sessionId);
  const blockers = [];
  const assignments = Array.isArray(prefetched.assignments) ? prefetched.assignments : [];
  const instances = Array.isArray(prefetched.instances) ? prefetched.instances : [];
  const cases = Array.isArray(prefetched.cases) ? prefetched.cases : [];
  const bookCoveringReport = prefetched.bookCoveringReport;

  if (bookCoveringReport) {
    blockers.push(buildActivityBlocker(ACTIVITY_BLOCKER_CODES.BOOK_COVERING_REPORT, 'Book covering report'));
  }

  const matchedAssignments = assignments.filter((row) => (
    reportAssignmentSessionUtils.reportAssignmentMatchesSession(row, ctx)
  ));
  if (matchedAssignments.length) {
    blockers.push(buildActivityBlocker(
      ACTIVITY_BLOCKER_CODES.REPORT_ASSIGNMENT,
      'Report assignments',
      matchedAssignments.length
    ));
  }

  const matchedInstances = instances.filter((row) => idsEqual(row?.sessionId, ctx.sessionId));
  if (matchedInstances.length) {
    blockers.push(buildActivityBlocker(
      ACTIVITY_BLOCKER_CODES.REPORT_INSTANCE,
      'Report instances',
      matchedInstances.length
    ));
  }

  const matchedCases = cases.filter((row) => idsEqual(row?.sessionId, ctx.sessionId));
  if (matchedCases.length) {
    blockers.push(buildActivityBlocker(
      ACTIVITY_BLOCKER_CODES.SESSION_STUDENT_CASE,
      'Session student cases',
      matchedCases.length
    ));
  }

  return blockers;
}

async function prefetchClassSessionActivityData({
  classId,
  classData,
  reqUser,
  accessContext = {}
}) {
  const safeClassId = toPublicId(classId);
  const orgId = toPublicId(classData?.orgId || reqUser?.activeOrgId);
  const [casesResult, instancesResult, assignmentsResult, bookCoveringRows] = await Promise.all([
    schoolDataService.fetchData('sessionStudentCases', { classId__eq: safeClassId, page: 1, limit: 10000 }, reqUser),
    schoolDataService.fetchData('reportInstances', { classId__eq: safeClassId, page: 1, limit: 10000 }, reqUser),
    schoolDataService.fetchData('reportAssignments', { classId__eq: safeClassId, page: 1, limit: 10000 }, reqUser),
    schoolDataService.fetchAllData('bookCoveringReports', {}, reqUser, accessContext).catch(() => [])
  ]);
  const orgBookCoveringRows = (Array.isArray(bookCoveringRows) ? bookCoveringRows : [])
    .filter((row) => !orgId || idsEqual(row?.orgId, orgId));
  return {
    cases: Array.isArray(casesResult) ? casesResult : [],
    instances: Array.isArray(instancesResult) ? instancesResult : [],
    assignments: Array.isArray(assignmentsResult) ? assignmentsResult : [],
    bookCoveringRows: orgBookCoveringRows
  };
}

async function resolveBookCoveringReportForSession({
  classData,
  session,
  reqUser,
  accessContext = {},
  prefetchedBookCoveringRows = null
}) {
  if (Array.isArray(prefetchedBookCoveringRows)) {
    const sessionId = toPublicId(session?.sessionId || session?.id);
    const classId = toPublicId(classData?.id);
    const linked = prefetchedBookCoveringRows.find((row) => idsEqual(row?.sessionId, sessionId)
      && idsEqual(row?.classId, classId));
    if (linked) return linked;
  }
  return bookCoveringReportService.findReportForSession({
    classData,
    session,
    reqUser,
    accessContext
  });
}

async function inspectSessionActivity({
  classId,
  sessionId,
  session,
  classData,
  reqUser,
  accessContext = {},
  prefetched = null
}) {
  const embedded = inspectEmbeddedSessionActivity(session);
  let externalPrefetched = prefetched;
  if (!externalPrefetched) {
    const classRow = classData || await schoolDataService.getDataById('classes', toPublicId(classId), reqUser, accessContext);
    const batch = await prefetchClassSessionActivityData({
      classId,
      classData: classRow,
      reqUser,
      accessContext
    });
    const bookCoveringReport = await resolveBookCoveringReportForSession({
      classData: classRow,
      session,
      reqUser,
      accessContext,
      prefetchedBookCoveringRows: batch.bookCoveringRows
    });
    externalPrefetched = {
      ...batch,
      bookCoveringReport
    };
  } else if (externalPrefetched.bookCoveringReport === undefined && classData) {
    externalPrefetched = {
      ...externalPrefetched,
      bookCoveringReport: await resolveBookCoveringReportForSession({
        classData,
        session,
        reqUser,
        accessContext,
        prefetchedBookCoveringRows: externalPrefetched.bookCoveringRows
      })
    };
  }
  const external = inspectExternalSessionActivity({
    session,
    classId,
    sessionId,
    prefetched: externalPrefetched
  });
  const blockers = [...embedded, ...external];
  return {
    blockers,
    hasNotes: embedded.some((row) => row.code === ACTIVITY_BLOCKER_CODES.SESSION_NOTES),
    hasGradebooks: embedded.some((row) => row.code === ACTIVITY_BLOCKER_CODES.GRADEBOOK_ACTIVITY),
    hasBookCovering: external.some((row) => row.code === ACTIVITY_BLOCKER_CODES.BOOK_COVERING_REPORT),
    hasReportAssignments: external.some((row) => row.code === ACTIVITY_BLOCKER_CODES.REPORT_ASSIGNMENT),
    hasReportInstances: external.some((row) => row.code === ACTIVITY_BLOCKER_CODES.REPORT_INSTANCE),
    hasStudentCases: external.some((row) => row.code === ACTIVITY_BLOCKER_CODES.SESSION_STUDENT_CASE)
  };
}

function inspectStructuralLocks({
  classId,
  sessionId,
  session = {},
  allSessions = [],
  source = 'session_manager'
}) {
  const blockers = [];
  if (schoolDependencyService.isSessionTimesheetApprovedLock(session)) {
    blockers.push(buildActivityBlocker('TIMESHEET_APPROVED_LOCK', 'Locked by approved timesheet'));
  }
  if (isSessionAdministrativelyLocked(session) && !schoolDependencyService.isSessionTimesheetApprovedLock(session)) {
    blockers.push(buildActivityBlocker('ADMIN_SESSION_LOCK', 'Session is administratively locked'));
  }
  if (source === 'master_schedule' && !isScheduledEditableSession(session)) {
    const status = sessionStatusPolicyService.normalizeStatusCode(session?.status || '');
    if (status !== 'scheduled') {
      blockers.push(buildActivityBlocker('NON_SCHEDULED_STATUS', 'Only scheduled sessions can be edited from Master Schedule'));
    } else if (isSessionAdministrativelyLocked(session)) {
      blockers.push(buildActivityBlocker('ADMIN_SESSION_LOCK', 'Session is locked'));
    }
  }
  const childMakeups = makeupSessionAllocationService.findDirectChildMakeupSessions(
    allSessions,
    toPublicId(classId),
    toPublicId(sessionId)
  );
  if (childMakeups.length) {
    blockers.push(buildActivityBlocker(
      'MAKEUP_CHILD_SESSIONS_EXIST',
      'Linked make-up sessions',
      childMakeups.length
    ));
  }
  return { blockers };
}

function classifyScheduleChanges(currentSession = {}, proposed = {}) {
  const currentDate = normalizeDateOnly(currentSession?.date);
  const proposedDate = proposed.date !== undefined ? normalizeDateOnly(proposed.date) : currentDate;
  const currentStart = normalizeClockTime(currentSession?.startTime);
  const proposedStart = proposed.startTime !== undefined ? normalizeClockTime(proposed.startTime) : currentStart;
  const currentEnd = normalizeClockTime(currentSession?.endTime);
  const proposedEnd = proposed.endTime !== undefined ? normalizeClockTime(proposed.endTime) : currentEnd;
  const currentDuration = Number(currentSession?.durationHours || 0);
  const proposedDuration = proposed.durationHours !== undefined ? Number(proposed.durationHours) : currentDuration;

  const dateChanged = Boolean(proposedDate && currentDate && proposedDate !== currentDate)
    || (proposed.date !== undefined && proposedDate !== currentDate);
  const timeChanged = proposed.startTime !== undefined && proposedStart !== currentStart
    || proposed.endTime !== undefined && proposedEnd !== currentEnd
    || (proposed.durationHours !== undefined && Number.isFinite(proposedDuration) && proposedDuration !== currentDuration);

  const operations = [];
  if (dateChanged) operations.push(SESSION_OPERATIONS.CHANGE_DATE);
  if (timeChanged) operations.push(SESSION_OPERATIONS.CHANGE_TIME);
  return { dateChanged, timeChanged, operations };
}

function mergeBlockers(...groups) {
  const merged = [];
  const seen = new Set();
  groups.flat().forEach((row) => {
    const code = String(row?.code || '').trim();
    if (!code || seen.has(code)) return;
    seen.add(code);
    merged.push(row);
  });
  return merged;
}

function filterActivityBlockers(activityBlockers = [], allowedCodes = new Set()) {
  return (Array.isArray(activityBlockers) ? activityBlockers : [])
    .filter((row) => allowedCodes.has(String(row?.code || '').trim()));
}

function operationUsesStructuralLocks(operation) {
  return [
    SESSION_OPERATIONS.DELETE,
    SESSION_OPERATIONS.CHANGE_DATE,
    SESSION_OPERATIONS.CHANGE_TIME,
    SESSION_OPERATIONS.CHANGE_SCHEDULE,
    SESSION_OPERATIONS.CHANGE_STATUS,
    SESSION_OPERATIONS.CHANGE_ROOM,
    SESSION_OPERATIONS.CHANGE_TEACHER,
    SESSION_OPERATIONS.CHANGE_CO_TEACHERS,
    SESSION_OPERATIONS.MARK_COMPLETE,
    SESSION_OPERATIONS.SAVE_NOTES,
    SESSION_OPERATIONS.SAVE_ATTENDANCE,
    SESSION_OPERATIONS.SAVE_GRADEBOOK,
    SESSION_OPERATIONS.SAVE_CONDUCT,
    SESSION_OPERATIONS.SAVE_CURRICULUM,
    SESSION_OPERATIONS.UPLOAD_FILE,
    SESSION_OPERATIONS.MERGE_SESSIONS,
    SESSION_OPERATIONS.UNMERGE_SESSION
  ].includes(operation);
}

function structuralBlockersForOperation(operation, structuralLocks = {}) {
  const structuralBlockers = Array.isArray(structuralLocks?.blockers) ? structuralLocks.blockers : [];
  if (operation === SESSION_OPERATIONS.DELETE) {
    return structuralBlockers;
  }
  if (operation === SESSION_OPERATIONS.CHANGE_DATE || operation === SESSION_OPERATIONS.CHANGE_TIME) {
    const relevantCodes = new Set([
      'TIMESHEET_APPROVED_LOCK',
      'ADMIN_SESSION_LOCK',
      'NON_SCHEDULED_STATUS'
    ]);
    return structuralBlockers.filter((row) => relevantCodes.has(String(row?.code || '').trim()));
  }
  if (operation === SESSION_OPERATIONS.CHANGE_STATUS) {
    return structuralBlockers.filter((row) => (
      ['TIMESHEET_APPROVED_LOCK', 'ADMIN_SESSION_LOCK'].includes(String(row?.code || '').trim())
    ));
  }
  if ([
    SESSION_OPERATIONS.CHANGE_ROOM,
    SESSION_OPERATIONS.CHANGE_TEACHER,
    SESSION_OPERATIONS.CHANGE_CO_TEACHERS,
    SESSION_OPERATIONS.SAVE_NOTES,
    SESSION_OPERATIONS.SAVE_ATTENDANCE,
    SESSION_OPERATIONS.SAVE_GRADEBOOK,
    SESSION_OPERATIONS.SAVE_CONDUCT,
    SESSION_OPERATIONS.SAVE_CURRICULUM,
    SESSION_OPERATIONS.UPLOAD_FILE,
    SESSION_OPERATIONS.MARK_COMPLETE
  ].includes(operation)) {
    return structuralBlockers.filter((row) => (
      ['TIMESHEET_APPROVED_LOCK', 'ADMIN_SESSION_LOCK'].includes(String(row?.code || '').trim())
    ));
  }
  return structuralBlockers;
}

function evaluateOperationPermissions({
  activity = {},
  structuralLocks = {}
}) {
  const activityBlockers = Array.isArray(activity?.blockers) ? activity.blockers : [];
  const buildResult = (operation, activityCodes = new Set(), includeStructural = true) => {
    const activityDenied = filterActivityBlockers(activityBlockers, activityCodes);
    const structuralDenied = includeStructural
      ? structuralBlockersForOperation(operation, structuralLocks)
      : [];
    const blockers = mergeBlockers(activityDenied, structuralDenied);
    return { allowed: blockers.length === 0, blockers };
  };

  const operations = {
    [SESSION_OPERATIONS.DELETE]: buildResult(SESSION_OPERATIONS.DELETE, DELETE_ACTIVITY_BLOCKERS, true),
    [SESSION_OPERATIONS.CHANGE_DATE]: buildResult(SESSION_OPERATIONS.CHANGE_DATE, DATE_MOVE_ACTIVITY_BLOCKERS, true),
    [SESSION_OPERATIONS.CHANGE_TIME]: buildResult(SESSION_OPERATIONS.CHANGE_TIME, new Set(), true),
    [SESSION_OPERATIONS.CHANGE_SCHEDULE]: { allowed: true, blockers: [] },
    [SESSION_OPERATIONS.CHANGE_STATUS]: buildResult(SESSION_OPERATIONS.CHANGE_STATUS, new Set(), true),
    [SESSION_OPERATIONS.MARK_COMPLETE]: buildResult(SESSION_OPERATIONS.MARK_COMPLETE, new Set(), true),
    [SESSION_OPERATIONS.CHANGE_ROOM]: buildResult(SESSION_OPERATIONS.CHANGE_ROOM, new Set(), true),
    [SESSION_OPERATIONS.CHANGE_TEACHER]: buildResult(SESSION_OPERATIONS.CHANGE_TEACHER, new Set(), true),
    [SESSION_OPERATIONS.CHANGE_CO_TEACHERS]: buildResult(SESSION_OPERATIONS.CHANGE_CO_TEACHERS, new Set(), true),
    [SESSION_OPERATIONS.LOCK_SESSION]: { allowed: true, blockers: [] },
    [SESSION_OPERATIONS.UNLOCK_SESSION]: buildResult(SESSION_OPERATIONS.UNLOCK_SESSION, new Set(), false),
    [SESSION_OPERATIONS.SAVE_NOTES]: buildResult(SESSION_OPERATIONS.SAVE_NOTES, new Set(), true),
    [SESSION_OPERATIONS.SAVE_ATTENDANCE]: buildResult(SESSION_OPERATIONS.SAVE_ATTENDANCE, new Set(), true),
    [SESSION_OPERATIONS.SAVE_GRADEBOOK]: buildResult(SESSION_OPERATIONS.SAVE_GRADEBOOK, new Set(), true),
    [SESSION_OPERATIONS.SAVE_CONDUCT]: buildResult(SESSION_OPERATIONS.SAVE_CONDUCT, new Set(), true),
    [SESSION_OPERATIONS.SAVE_CURRICULUM]: buildResult(SESSION_OPERATIONS.SAVE_CURRICULUM, new Set(), true),
    [SESSION_OPERATIONS.UPLOAD_FILE]: buildResult(SESSION_OPERATIONS.UPLOAD_FILE, new Set(), true),
    [SESSION_OPERATIONS.CREATE_MAKEUP]: { allowed: true, blockers: [] },
    [SESSION_OPERATIONS.MERGE_SESSIONS]: buildResult(SESSION_OPERATIONS.MERGE_SESSIONS, new Set(), true),
    [SESSION_OPERATIONS.UNMERGE_SESSION]: buildResult(SESSION_OPERATIONS.UNMERGE_SESSION, new Set(), true)
  };

  const scheduleDate = operations[SESSION_OPERATIONS.CHANGE_DATE];
  const scheduleTime = operations[SESSION_OPERATIONS.CHANGE_TIME];
  operations[SESSION_OPERATIONS.CHANGE_SCHEDULE] = {
    allowed: scheduleDate.allowed && scheduleTime.allowed,
    blockers: mergeBlockers(scheduleDate.blockers, scheduleTime.blockers)
  };

  return { operations };
}

function resolveErrorCodeForOperation(operation) {
  if (operation === SESSION_OPERATIONS.DELETE) return ERROR_CODES.DELETE;
  if (operation === SESSION_OPERATIONS.CHANGE_DATE) return ERROR_CODES.DATE_MOVE;
  if (operation === SESSION_OPERATIONS.CHANGE_TIME) return ERROR_CODES.TIME_CHANGE;
  return ERROR_CODES.GENERIC;
}

function buildBlockedMessage(operation, blockers = []) {
  const labels = blockers.map((row) => row.label || row.code).filter(Boolean);
  const summary = labels.length ? labels.join(', ') : 'related instructional data';
  if (operation === SESSION_OPERATIONS.DELETE) {
    return `This session cannot be deleted because it has ${summary}. Remove those records first.`;
  }
  if (operation === SESSION_OPERATIONS.CHANGE_DATE) {
    return `This session cannot be moved to another date because it has ${summary}.`;
  }
  if (operation === SESSION_OPERATIONS.CHANGE_TIME) {
    return `This session schedule cannot be changed because it is ${summary}.`;
  }
  return `This session operation is not allowed because of ${summary}.`;
}

function assertOperationPermissionResult(operation, result = {}) {
  if (result.allowed) return;
  const blockers = Array.isArray(result.blockers) ? result.blockers : [];
  throw new SessionOperationBlockedError({
    code: resolveErrorCodeForOperation(operation),
    operation,
    blockers,
    message: buildBlockedMessage(operation, blockers)
  });
}

function resolveTimesheetScopesForOperation(operation, proposedChanges = {}, session = {}) {
  if (operation === SESSION_OPERATIONS.DELETE) {
    return [schoolDependencyService.SESSION_TIMESHEET_LOCK_MUTATION_SCOPE.DELETE];
  }
  if (operation === SESSION_OPERATIONS.CHANGE_STATUS) {
    return [schoolDependencyService.SESSION_TIMESHEET_LOCK_MUTATION_SCOPE.STATUS];
  }
  if (operation === SESSION_OPERATIONS.CHANGE_ROOM) {
    return [schoolDependencyService.SESSION_TIMESHEET_LOCK_MUTATION_SCOPE.ROOM];
  }
  if (operation === SESSION_OPERATIONS.CHANGE_TEACHER) {
    return [schoolDependencyService.SESSION_TIMESHEET_LOCK_MUTATION_SCOPE.TEACHER_ASSIGNMENT];
  }
  if (operation === SESSION_OPERATIONS.CHANGE_CO_TEACHERS) {
    return [schoolDependencyService.SESSION_TIMESHEET_LOCK_MUTATION_SCOPE.CO_TEACHERS_ASSIGNMENT];
  }
  if ([SESSION_OPERATIONS.CHANGE_DATE, SESSION_OPERATIONS.CHANGE_TIME, SESSION_OPERATIONS.CHANGE_SCHEDULE].includes(operation)) {
    const probe = { ...session };
    if (proposedChanges.date !== undefined) probe.date = proposedChanges.date;
    if (proposedChanges.startTime !== undefined) probe.startTime = proposedChanges.startTime;
    if (proposedChanges.endTime !== undefined) probe.endTime = proposedChanges.endTime;
    return schoolDependencyService.collectSessionTimesheetRestrictedMutationScopes({
      previousSession: session,
      nextSession: probe
    });
  }
  return [];
}

async function assertDeletionGuardBlockers({
  classId,
  sessionId,
  orgId,
  reqUser
}) {
  const guardPreview = await schoolDeletionGuardService.previewDelete({
    entityKey: 'session',
    id: toPublicId(sessionId),
    orgId: toPublicId(orgId),
    reqUser,
    context: { classId: toPublicId(classId) }
  });
  const blockers = Array.isArray(guardPreview?.blockers) ? guardPreview.blockers : [];
  if (!blockers.length) return;
  throw new SessionOperationBlockedError({
    code: ERROR_CODES.DELETE,
    operation: SESSION_OPERATIONS.DELETE,
    blockers: blockers.map((row) => ({
      code: row.code,
      label: row.label || row.message || row.code,
      count: row.count || 1
    })),
    message: blockers[0]?.message || blockers[0]?.label || 'Session delete is blocked.'
  });
}

async function assertInstructionalEditAllowed({
  operation,
  session,
  orgId,
  orgTimeZone,
  reqUser,
  canOverride = false,
  statusMap = null
}) {
  const target = INSTRUCTIONAL_OPERATION_TARGETS[operation];
  if (!target) return;
  const effectiveStatusMap = statusMap instanceof Map
    ? statusMap
    : await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
  const isCompleted = sessionStatusPolicyService.isSessionCompletionStatusByMap(effectiveStatusMap, session);
  if (!isCompleted) return;
  await sessionAttendanceEditAccessService.assertSessionSectionEditable({
    orgId,
    session,
    orgTimeZone,
    canOverride,
    target,
    statusMap: effectiveStatusMap
  });
}

async function evaluateSessionManagementPolicy({
  classId,
  sessionId,
  session,
  classData,
  allSessions = [],
  reqUser,
  source = 'session_manager',
  accessContext = {},
  prefetched = null
}) {
  const activity = await inspectSessionActivity({
    classId,
    sessionId,
    session,
    classData,
    reqUser,
    accessContext,
    prefetched
  });
  const structuralLocks = inspectStructuralLocks({
    classId,
    sessionId,
    session,
    allSessions,
    source
  });
  const permissions = evaluateOperationPermissions({ activity, structuralLocks });
  return {
    activity,
    structuralLocks,
    ...permissions,
    sessionManagement: {
      canDelete: permissions.operations[SESSION_OPERATIONS.DELETE].allowed,
      canChangeDate: permissions.operations[SESSION_OPERATIONS.CHANGE_DATE].allowed,
      canChangeTime: permissions.operations[SESSION_OPERATIONS.CHANGE_TIME].allowed,
      canChangeStatus: permissions.operations[SESSION_OPERATIONS.CHANGE_STATUS].allowed,
      canMarkComplete: permissions.operations[SESSION_OPERATIONS.MARK_COMPLETE].allowed
    }
  };
}

async function assertSessionOperationAllowed({
  operation,
  classId,
  sessionId,
  session,
  classData = null,
  allSessions = [],
  reqUser,
  source = 'session_manager',
  proposedChanges = {},
  orgId = '',
  orgTimeZone = '',
  canOverride = false,
  statusMap = null,
  accessContext = {},
  prefetched = null,
  skipDeletionGuard = false
}) {
  const resolvedOperation = String(operation || '').trim();
  if (!resolvedOperation) throw new Error('operation is required.');

  const classRow = classData || await schoolDataService.getDataById('classes', toPublicId(classId), reqUser, accessContext);
  const resolvedOrgId = toPublicId(orgId || classRow?.orgId || reqUser?.activeOrgId);

  if (resolvedOperation === SESSION_OPERATIONS.CHANGE_SCHEDULE) {
    const { operations: subOperations } = classifyScheduleChanges(session, proposedChanges);
    for (const subOperation of subOperations) {
      // eslint-disable-next-line no-await-in-loop
      await assertSessionOperationAllowed({
        operation: subOperation,
        classId,
        sessionId,
        session,
        classData: classRow,
        allSessions,
        reqUser,
        source,
        proposedChanges,
        orgId: resolvedOrgId,
        orgTimeZone,
        canOverride,
        statusMap,
        accessContext,
        prefetched,
        skipDeletionGuard
      });
    }
    return;
  }

  const policy = await evaluateSessionManagementPolicy({
    classId,
    sessionId,
    session,
    classData: classRow,
    allSessions,
    reqUser,
    source,
    accessContext,
    prefetched
  });
  const operationResult = policy.operations[resolvedOperation] || { allowed: true, blockers: [] };
  assertOperationPermissionResult(resolvedOperation, operationResult);

  const timesheetScopes = resolveTimesheetScopesForOperation(resolvedOperation, proposedChanges, session);
  if (timesheetScopes.length) {
    schoolDependencyService.assertSessionTimesheetLockAllowsMutationScopes(session, timesheetScopes, 'This session');
  }

  if (resolvedOperation === SESSION_OPERATIONS.DELETE && !skipDeletionGuard) {
    await assertDeletionGuardBlockers({
      classId,
      sessionId,
      orgId: resolvedOrgId,
      reqUser
    });
  }

  if (INSTRUCTIONAL_OPERATION_TARGETS[resolvedOperation]) {
    await assertInstructionalEditAllowed({
      operation: resolvedOperation,
      session,
      orgId: resolvedOrgId,
      orgTimeZone,
      reqUser,
      canOverride,
      statusMap
    });
  }
}

async function assertSessionCanDeleteOrThrow(input = {}) {
  return assertSessionOperationAllowed({
    ...input,
    operation: SESSION_OPERATIONS.DELETE
  });
}

async function assertSessionScheduleUpdateAllowed(input = {}) {
  return assertSessionOperationAllowed({
    ...input,
    operation: SESSION_OPERATIONS.CHANGE_SCHEDULE
  });
}

async function buildSessionManagementFlagsForClassSessions({
  classId,
  classData,
  sessions = [],
  allSessions = null,
  reqUser,
  source = 'master_schedule',
  accessContext = {}
}) {
  const classRow = classData || await schoolDataService.getDataById('classes', toPublicId(classId), reqUser, accessContext);
  const batch = await prefetchClassSessionActivityData({
    classId,
    classData: classRow,
    reqUser,
    accessContext
  });
  const ledger = Array.isArray(allSessions) ? allSessions : sessions;
  const flagsBySessionId = new Map();

  for (const session of sessions) {
    const sessionId = toPublicId(session?.sessionId || session?.id);
    if (!sessionId) continue;
    const bookCoveringReport = await resolveBookCoveringReportForSession({
      classData: classRow,
      session,
      reqUser,
      accessContext,
      prefetchedBookCoveringRows: batch.bookCoveringRows
    });
    const prefetched = { ...batch, bookCoveringReport };
    const activity = await inspectSessionActivity({
      classId,
      sessionId,
      session,
      classData: classRow,
      reqUser,
      accessContext,
      prefetched
    });
    const structuralLocks = inspectStructuralLocks({
      classId,
      sessionId,
      session,
      allSessions: ledger,
      source
    });
    const permissions = evaluateOperationPermissions({ activity, structuralLocks });
    flagsBySessionId.set(sessionId, {
      canDelete: permissions.operations[SESSION_OPERATIONS.DELETE].allowed,
      canChangeDate: permissions.operations[SESSION_OPERATIONS.CHANGE_DATE].allowed,
      canChangeTime: permissions.operations[SESSION_OPERATIONS.CHANGE_TIME].allowed,
      canChangeStatus: permissions.operations[SESSION_OPERATIONS.CHANGE_STATUS].allowed,
      blockers: permissions.operations[SESSION_OPERATIONS.DELETE].blockers
    });
  }

  return flagsBySessionId;
}

function buildSessionLabel(session = {}, sessionId = '') {
  const date = normalizeDateOnly(session?.date);
  const id = toPublicId(session?.sessionId || session?.id || sessionId);
  if (date && id) return `${date} (${id})`;
  if (date) return date;
  return id || 'Session';
}

function formatDeleteBlockerDetail(blocker = {}, session = {}) {
  const code = String(blocker?.code || '').trim();
  const count = Number(blocker?.count || 1);
  if (code === ACTIVITY_BLOCKER_CODES.SESSION_ATTENDANCE_MARKED) {
    return `${count} marked attendance record${count === 1 ? '' : 's'}`;
  }
  if (code === ACTIVITY_BLOCKER_CODES.SESSION_CURRICULUM) {
    const contentItems = Array.isArray(session?.contentItems) ? session.contentItems.length : 0;
    const skillsCovered = Array.isArray(session?.skillsCovered) ? session.skillsCovered.length : 0;
    const parts = [];
    if (contentItems) parts.push(`${contentItems} content item${contentItems === 1 ? '' : 's'}`);
    if (skillsCovered) parts.push(`${skillsCovered} skills covered entr${skillsCovered === 1 ? 'y' : 'ies'}`);
    return parts.join(', ') || `${count} curriculum record${count === 1 ? '' : 's'}`;
  }
  if (code === ACTIVITY_BLOCKER_CODES.GRADEBOOK_ACTIVITY) {
    return `${count} gradebook activit${count === 1 ? 'y' : 'ies'}`;
  }
  if (code === ACTIVITY_BLOCKER_CODES.SESSION_NOTES) {
    return 'Session notes are saved';
  }
  if (count > 1) return `${count} related record${count === 1 ? '' : 's'}`;
  return String(blocker?.label || blocker?.code || 'Related records');
}

function enrichDeleteBlockers(blockers = [], session = {}) {
  return (Array.isArray(blockers) ? blockers : []).map((row) => ({
    code: String(row?.code || '').trim(),
    label: String(row?.label || row?.code || 'Related records').trim(),
    count: Number(row?.count || 1),
    detail: formatDeleteBlockerDetail(row, session)
  }));
}

function resolveSessionFromTargets(sessions = [], target = {}) {
  const sessionId = toPublicId(target?.sessionId);
  const sessionDate = normalizeDateOnly(target?.sessionDate || target?.date);
  if (!sessionId) return null;
  const rows = Array.isArray(sessions) ? sessions : [];
  if (sessionDate) {
    const dated = rows.find((row) => (
      idsEqual(row?.sessionId || row?.id, sessionId)
      && normalizeDateOnly(row?.date) === sessionDate
    ));
    if (dated) return dated;
  }
  return rows.find((row) => idsEqual(row?.sessionId || row?.id, sessionId)) || null;
}

async function buildSessionDeleteEligibility({
  classId,
  sessionId,
  session,
  classData = null,
  allSessions = [],
  reqUser,
  source = 'master_schedule',
  accessContext = {},
  prefetched = null,
  orgId = ''
}) {
  const safeClassId = toPublicId(classId);
  const safeSessionId = toPublicId(sessionId || session?.sessionId || session?.id);
  const classRow = classData || await schoolDataService.getDataById('classes', safeClassId, reqUser, accessContext);
  const resolvedOrgId = toPublicId(orgId || classRow?.orgId || reqUser?.activeOrgId);

  const policy = await evaluateSessionManagementPolicy({
    classId: safeClassId,
    sessionId: safeSessionId,
    session,
    classData: classRow,
    allSessions,
    reqUser,
    source,
    accessContext,
    prefetched
  });
  let blockers = enrichDeleteBlockers(
    policy.operations?.[SESSION_OPERATIONS.DELETE]?.blockers || [],
    session
  );

  try {
    await assertDeletionGuardBlockers({
      classId: safeClassId,
      sessionId: safeSessionId,
      orgId: resolvedOrgId,
      reqUser
    });
  } catch (error) {
    if (error instanceof SessionOperationBlockedError) {
      blockers = mergeBlockers(blockers, enrichDeleteBlockers(error.blockers, session));
    } else {
      throw error;
    }
  }

  return {
    sessionId: safeSessionId,
    date: normalizeDateOnly(session?.date),
    label: buildSessionLabel(session, safeSessionId),
    canDelete: blockers.length === 0,
    blockers
  };
}

async function buildBulkSessionDeletePlan({
  classId,
  targets = [],
  reqUser,
  source = 'master_schedule',
  accessContext = {}
} = {}) {
  const safeClassId = toPublicId(classId);
  if (!safeClassId) throw new Error('classId is required.');

  const normalizedTargets = (Array.isArray(targets) ? targets : [])
    .map((row) => ({
      sessionId: toPublicId(row?.sessionId),
      sessionDate: normalizeDateOnly(row?.sessionDate || row?.date)
    }))
    .filter((row) => row.sessionId);

  const uniqueTargets = [];
  const seen = new Set();
  normalizedTargets.forEach((row) => {
    const key = `${row.sessionId}::${row.sessionDate || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    uniqueTargets.push(row);
  });

  if (!uniqueTargets.length) {
    return {
      classId: safeClassId,
      deletable: [],
      blocked: [],
      summary: { selected: 0, deletable: 0, blocked: 0 }
    };
  }

  const classData = await schoolDataService.getDataById('classes', safeClassId, reqUser, accessContext);
  if (!classData) throw new Error('Class not found.');

  const sessions = await schoolDataService.getClassSessions(safeClassId, reqUser, accessContext);
  const batch = await prefetchClassSessionActivityData({
    classId: safeClassId,
    classData,
    reqUser,
    accessContext
  });

  const deletable = [];
  const blocked = [];

  for (const target of uniqueTargets) {
    const session = resolveSessionFromTargets(sessions, target);
    if (!session) {
      blocked.push({
        sessionId: target.sessionId,
        date: target.sessionDate || '',
        label: buildSessionLabel({ date: target.sessionDate }, target.sessionId),
        blockers: [{
          code: 'SESSION_NOT_FOUND',
          label: 'Session not found',
          count: 1,
          detail: 'Session could not be found on this class schedule.'
        }]
      });
      continue;
    }

    const bookCoveringReport = await resolveBookCoveringReportForSession({
      classData,
      session,
      reqUser,
      accessContext,
      prefetchedBookCoveringRows: batch.bookCoveringRows
    });
    const prefetched = { ...batch, bookCoveringReport };

    // eslint-disable-next-line no-await-in-loop
    const eligibility = await buildSessionDeleteEligibility({
      classId: safeClassId,
      sessionId: target.sessionId,
      session,
      classData,
      allSessions: sessions,
      reqUser,
      source,
      accessContext,
      prefetched,
      orgId: classData?.orgId
    });

    if (eligibility.canDelete) {
      deletable.push(eligibility);
    } else {
      blocked.push(eligibility);
    }
  }

  return {
    classId: safeClassId,
    deletable,
    blocked,
    summary: {
      selected: uniqueTargets.length,
      deletable: deletable.length,
      blocked: blocked.length
    }
  };
}

async function executeBulkSessionDelete({
  classId,
  targets = [],
  reqUser,
  source = 'master_schedule',
  accessContext = {}
} = {}) {
  const plan = await buildBulkSessionDeletePlan({
    classId,
    targets,
    reqUser,
    source,
    accessContext
  });

  if (!plan.deletable.length) {
    return {
      deletedCount: 0,
      deleted: [],
      blocked: plan.blocked,
      skipped: plan.blocked
    };
  }

  const safeClassId = plan.classId;
  const classData = await schoolDataService.getDataById('classes', safeClassId, reqUser, accessContext);
  if (!classData) throw new Error('Class not found.');

  let sessions = await schoolDataService.getClassSessions(safeClassId, reqUser, accessContext);
  const sessionStatusMeta = await sessionStatusPolicyService.getStatusDefinitions(
    toPublicId(classData?.orgId || reqUser?.activeOrgId),
    { includeInactive: true }
  );

  const deleted = [];
  const runtimeBlocked = [];

  for (const row of plan.deletable) {
    const sessionId = toPublicId(row?.sessionId);
    const session = (Array.isArray(sessions) ? sessions : []).find((item) => (
      idsEqual(item?.sessionId || item?.id, sessionId)
    ));
    if (!session) continue;

    try {
      // eslint-disable-next-line no-await-in-loop
      await assertSessionCanDeleteOrThrow({
        classId: safeClassId,
        sessionId,
        session,
        classData,
        allSessions: sessions,
        reqUser,
        source,
        accessContext,
        orgId: classData?.orgId,
        skipDeletionGuard: false
      });
    } catch (error) {
      runtimeBlocked.push({
        sessionId,
        date: normalizeDateOnly(session?.date),
        label: buildSessionLabel(session, sessionId),
        blockers: enrichDeleteBlockers(
          error instanceof SessionOperationBlockedError ? error.blockers : [{
            code: 'DELETE_BLOCKED',
            label: error.message || 'Delete blocked',
            count: 1
          }],
          session
        )
      });
      continue;
    }

    const survivingSessions = sessions.filter((item) => !idsEqual(item?.sessionId || item?.id, sessionId));
    makeupSessionAllocationService.assertSessionRemovalAllowed({
      sessions: survivingSessions,
      allSessions: sessions,
      classId: safeClassId,
      sessionToRemove: session,
      statusDefinitions: sessionStatusMeta
    });

    if (session?.makeup?.isMakeup === true) {
      const result = makeupSessionAllocationService.removeMakeupSessionFromLedger({
        sessions,
        classId: safeClassId,
        originalSessionId: session?.makeup?.originalSessionId,
        makeupSessionId: sessionId
      });
      sessions = result.sessions;
    } else {
      sessions = survivingSessions;
    }

    deleted.push({
      sessionId,
      date: normalizeDateOnly(session?.date),
      label: buildSessionLabel(session, sessionId)
    });
  }

  if (deleted.length) {
    await schoolDataService.saveClassSessions(safeClassId, sessions, reqUser);
    const indexService = require('./schoolIndexService');
    await indexService.rebuildIndexesForClass(safeClassId);
  }

  const blocked = [...plan.blocked, ...runtimeBlocked];

  return {
    deletedCount: deleted.length,
    deleted,
    blocked,
    skipped: blocked
  };
}

module.exports = {
  SESSION_OPERATIONS,
  ACTIVITY_BLOCKER_CODES,
  ERROR_CODES,
  SessionOperationBlockedError,
  normalizeDateOnly,
  normalizeClockTime,
  inspectEmbeddedSessionActivity,
  inspectExternalSessionActivity,
  prefetchClassSessionActivityData,
  inspectSessionActivity,
  inspectStructuralLocks,
  classifyScheduleChanges,
  evaluateOperationPermissions,
  evaluateSessionManagementPolicy,
  assertSessionOperationAllowed,
  assertSessionCanDeleteOrThrow,
  assertSessionScheduleUpdateAllowed,
  buildSessionManagementFlagsForClassSessions,
  countMarkedAttendanceRows,
  buildSessionLabel,
  formatDeleteBlockerDetail,
  enrichDeleteBlockers,
  buildSessionDeleteEligibility,
  buildBulkSessionDeletePlan,
  executeBulkSessionDelete
};
