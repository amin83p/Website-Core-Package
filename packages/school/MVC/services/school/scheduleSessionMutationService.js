const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { OPERATIONS } = require('../../../config/accessConstants');
const scheduleAccessService = require('./scheduleAccessService');
const schoolDataService = require('./schoolDataService');
const schoolRecordAccessService = require('./schoolRecordAccessService');
const schoolIndexService = require('./schoolIndexService');
const schoolAdminAccessService = require('./schoolAdminAccessService');
const schoolDependencyService = require('./schoolDependencyService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const sessionNavigationService = require('./sessionNavigationService');
const classSessionCapacityService = require('./classSessionCapacityService');
const rollingEnrollmentSessionAlignmentService = require('./rollingEnrollmentSessionAlignmentService');
const activityWorkSessionService = require('./activityWorkSessionService');

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

function calculateSessionDurationHours(startTime = '', endTime = '', fallback = 0) {
  const start = normalizeClockTime(startTime);
  const end = normalizeClockTime(endTime);
  if (!start || !end || start >= end) {
    const fallbackNumber = Number(fallback);
    return Number.isFinite(fallbackNumber) && fallbackNumber > 0 ? Number(fallbackNumber.toFixed(2)) : 0;
  }
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const minutes = ((eh * 60) + em) - ((sh * 60) + sm);
  return minutes > 0 ? Number((minutes / 60).toFixed(2)) : 0;
}

function findSessionInList(sessions, sessionId, sessionDate = '') {
  const list = Array.isArray(sessions) ? sessions : [];
  const normalizedDate = sessionNavigationService.normalizeSessionDate(sessionDate);
  if (normalizedDate) {
    const datedIndex = list.findIndex((row) => sessionNavigationService.sessionMatchesIdentity(row, sessionId, normalizedDate));
    if (datedIndex >= 0) return { index: datedIndex, session: list[datedIndex] };
  }
  const index = list.findIndex((row) => idsEqual(row?.sessionId || row?.id, sessionId));
  return { index, session: index >= 0 ? list[index] : null };
}

function isSessionAdministrativelyLocked(session = {}) {
  if (session?.locked === true || String(session?.locked) === 'true') return true;
  return schoolDependencyService.isSessionTimesheetApprovedLock(session);
}

function isScheduledEditableSession(session = {}) {
  const status = sessionStatusPolicyService.normalizeStatusCode(session?.status || '');
  return status === 'scheduled' && !isSessionAdministrativelyLocked(session);
}

function assertSessionScope(req, classData, session) {
  schoolRecordAccessService.assertSessionAccessible({
    classRow: classData,
    session,
    access: schoolRecordAccessService.resolveAccessFromRequest(req),
    context: 'manageSession'
  });
}

async function assertScheduleMutationAccess(req) {
  const capabilities = await scheduleAccessService.buildScheduleCapabilities(req.user, {
    accessScope: req?.accessScope || '',
    ipAddress: req?.ip || ''
  });
  if (!capabilities.canDragCreateSessions) {
    const error = new Error('You do not have permission to edit sessions from Master Schedule.');
    error.statusCode = 403;
    throw error;
  }
  return capabilities;
}

async function loadClassSessionContext(req, { classId, sessionId, sessionDate }) {
  const accessContext = schoolDataService.buildRouteAccessContext(req);
  const classData = await schoolDataService.getDataById('classes', classId, req.user, accessContext);
  if (!classData) throw new Error('Class not found.');
  const sessions = await schoolDataService.getClassSessions(classId, req.user);
  const { index, session } = findSessionInList(sessions, sessionId, sessionDate);
  if (index < 0 || !session) throw new Error('Session not found.');
  assertSessionScope(req, classData, session);
  return { accessContext, classData, sessions, sessionIndex: index, session };
}

async function resolveCapacityMode(classData, session, reqUser) {
  const students = await schoolDataService.fetchAllData('students', {}, reqUser).catch(() => []);
  const studentToPersonMap = new Map(
    (Array.isArray(students) ? students : [])
      .map((row) => [toPublicId(row?.id), toPublicId(row?.personId)])
      .filter(([studentId, personId]) => Boolean(studentId && personId))
  );
  let enrollmentPeriods = null;
  if (classSessionCapacityService.getClassRegistrationModeKey(classData) === 'rolling') {
    enrollmentPeriods = await schoolDataService.getClassEnrollmentPeriodsByClassId(classData.id, reqUser);
  }
  const context = await classSessionCapacityService.resolveSessionOneOnOneContext({
    classData,
    session,
    reqUser,
    activeOrgId: String(classData?.orgId || reqUser?.activeOrgId || '').trim(),
    studentToPersonMap,
    enrollmentPeriods
  });
  return context?.capacityMode || 'group';
}

async function assertSessionWithinWindows(classData, session, reqUser) {
  const mode = String(classData?.registrationMode || 'term_based').trim().toLowerCase();
  if (mode === 'rolling') {
    rollingEnrollmentSessionAlignmentService.assertRollingSessionsWithinCycleWindowOrThrow({
      registrationMode: classData?.registrationMode || 'term_based',
      cycleStartDate: classData?.cycleStartDate || '',
      cycleEndDate: classData?.cycleEndDate || '',
      sessions: [session]
    });
  }
}

async function persistClassSessions(classId, sessions, reqUser) {
  await schoolDataService.saveClassSessions(classId, sessions, reqUser);
  await schoolIndexService.rebuildIndexesForClass(classId);
}

function applyScheduleFields(session, { date, startTime, endTime }) {
  const nextDate = normalizeDateOnly(date);
  const nextStart = normalizeClockTime(startTime);
  const nextEnd = normalizeClockTime(endTime);
  if (!nextDate) throw new Error('Session date is required.');
  if (!nextStart || !nextEnd || nextStart >= nextEnd) {
    throw new Error('Session start time must be before end time.');
  }
  session.date = nextDate;
  session.startTime = nextStart;
  session.endTime = nextEnd;
  session.durationHours = calculateSessionDurationHours(nextStart, nextEnd, session.durationHours);
  return true;
}

async function detectAndMaybeBlockConflicts({
  classData,
  sessions,
  sessionId,
  session,
  reqUser,
  forceConflicts
}) {
  const { detectSessionConflicts } = require('./sessionConflictDetectionService');
  const conflicts = await detectSessionConflicts({
    classId: classData.id,
    sessions,
    activeOrgId: classData?.orgId || reqUser?.activeOrgId || '',
    reqUser,
    fallbackTeacherId: String(session?.delivery?.deliveredBy || '').trim(),
    includeExternalScheduleConflicts: true,
    externalFocusSessionIds: [sessionId]
  });
  if (!Array.isArray(conflicts) || !conflicts.length || forceConflicts === true) {
    return { conflicts: Array.isArray(conflicts) ? conflicts : [] };
  }
  const warningMessage = 'Schedule conflicts were detected for the updated session date, time, or teacher.';
  const error = new Error(warningMessage);
  error.statusCode = 409;
  error.code = 'SESSION_METADATA_CONFLICTS';
  error.data = {
    requiresConfirmation: true,
    conflicts: conflicts.slice(0, 12).map((row) => ({
      date: row?.date || session.date,
      teacherName: row?.teacherName || '',
      conflictClass: row?.conflictClass || 'schedule conflict',
      existTime: row?.existTime || ''
    }))
  };
  throw error;
}

function isMakeUpRequiredSessionByMap(statusMap, session = {}) {
  return sessionStatusPolicyService.isMakeUpRequiredByMap(statusMap, {
    status: session?.status,
    notes: session?.notes
  });
}

async function updateClassSessionSchedule(input = {}, req = {}) {
  await assertScheduleMutationAccess(req);
  const classId = toPublicId(input.classId);
  const sessionId = toPublicId(input.sessionId);
  const sessionDate = sessionNavigationService.normalizeSessionDate(input.sessionDate || input.date || '');
  if (!classId || !sessionId) throw new Error('classId and sessionId are required.');

  const { classData, sessions, sessionIndex, session } = await loadClassSessionContext(req, {
    classId,
    sessionId,
    sessionDate
  });
  if (!isScheduledEditableSession(session)) {
    throw new Error('Only scheduled, unlocked sessions can be moved or resized from Master Schedule.');
  }

  const nextDate = normalizeDateOnly(input.date !== undefined ? input.date : session.date);
  const nextStart = normalizeClockTime(input.startTime !== undefined ? input.startTime : session.startTime);
  let nextEnd = normalizeClockTime(input.endTime !== undefined ? input.endTime : session.endTime);
  if (!nextEnd && input.durationHours !== undefined) {
    const durationHours = Number(input.durationHours);
    if (Number.isFinite(durationHours) && durationHours > 0 && nextStart) {
      const startParts = nextStart.split(':').map(Number);
      const totalMinutes = (startParts[0] * 60) + startParts[1] + Math.round(durationHours * 60);
      const endH = Math.floor(totalMinutes / 60) % 24;
      const endM = totalMinutes % 60;
      nextEnd = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
    }
  }

  const workingSession = { ...session };
  applyScheduleFields(workingSession, { date: nextDate, startTime: nextStart, endTime: nextEnd });
  await assertSessionWithinWindows(classData, workingSession, req.user);

  const mergedSessions = sessions.map((row, idx) => (idx === sessionIndex ? workingSession : row));
  await detectAndMaybeBlockConflicts({
    classData,
    sessions: mergedSessions,
    sessionId,
    session: workingSession,
    reqUser: req.user,
    forceConflicts: input.forceConflicts === true
      || String(input.forceConflicts || '').trim().toLowerCase() === 'true'
  });

  workingSession.audit = {
    ...(workingSession.audit || {}),
    lastUpdateUser: toPublicId(req.user?.id || req.user?.username || ''),
    lastUpdateDateTime: new Date().toISOString()
  };
  sessions[sessionIndex] = workingSession;
  await persistClassSessions(classId, sessions, req.user);
  return { classId, sessionId, session: workingSession };
}

async function updateClassSessionStatus(input = {}, req = {}) {
  await assertScheduleMutationAccess(req);
  const classId = toPublicId(input.classId);
  const sessionId = toPublicId(input.sessionId);
  const sessionDate = sessionNavigationService.normalizeSessionDate(input.sessionDate || input.date || '');
  const status = sessionStatusPolicyService.normalizeStatusCode(input.status);
  if (!classId || !sessionId || !status) throw new Error('classId, sessionId, and status are required.');

  const { classData, sessions, sessionIndex, session } = await loadClassSessionContext(req, {
    classId,
    sessionId,
    sessionDate
  });
  if (isSessionAdministrativelyLocked(session)) {
    throw new Error('This session is locked and cannot be edited from Master Schedule.');
  }

  const statusMap = await sessionStatusPolicyService.getStatusMap(classData?.orgId || req.user?.activeOrgId || '', {
    includeInactive: true
  });
  if (!statusMap.has(status)) throw new Error('Invalid session status.');

  const targetDefinition = statusMap.get(status);
  if (targetDefinition?.makeUpRequired === true || targetDefinition?.mergedSessionRequired === true) {
    const error = new Error('This session status must be changed in Manage Session.');
    error.statusCode = 400;
    error.code = 'MANAGE_SESSION_REQUIRED';
    throw error;
  }

  const capacityMode = await resolveCapacityMode(classData, session, req.user);
  sessionStatusPolicyService.assertStatusSelectableByAccess(status, statusMap, {
    allowAdminStatuses: await schoolAdminAccessService.canSelectAdminSessionStatuses(req.user),
    capacityMode
  });

  const currentMakeup = isMakeUpRequiredSessionByMap(statusMap, session);
  const nextMakeup = isMakeUpRequiredSessionByMap(statusMap, { ...session, status });
  if (currentMakeup && !nextMakeup) {
    const linked = sessions.filter((row, idx) => idx !== sessionIndex
      && row?.makeup?.isMakeup === true
      && idsEqual(row?.makeup?.originalClassId, classId)
      && idsEqual(row?.makeup?.originalSessionId, sessionId));
    if (linked.length) {
      throw new Error('Remove linked make-up sessions in Manage Session before changing this status.');
    }
  }

  if (targetDefinition?.mergedSessionRequired === true) {
    const error = new Error('This session status must be changed in Manage Session.');
    error.statusCode = 400;
    error.code = 'MANAGE_SESSION_REQUIRED';
    throw error;
  }

  const workingSession = { ...session, status };
  workingSession.audit = {
    ...(workingSession.audit || {}),
    lastUpdateUser: toPublicId(req.user?.id || req.user?.username || ''),
    lastUpdateDateTime: new Date().toISOString()
  };
  sessions[sessionIndex] = workingSession;
  await persistClassSessions(classId, sessions, req.user);
  return { classId, sessionId, session: workingSession };
}

async function updateWorkSessionFromSchedule(input = {}, req = {}) {
  await assertScheduleMutationAccess(req);
  if (!activityWorkSessionService.canManageAllActivityWorkSessions(req.user, OPERATIONS.UPDATE)) {
    const error = new Error('You do not have permission to update work sessions from Master Schedule.');
    error.statusCode = 403;
    throw error;
  }

  const activityId = toPublicId(input.activityId);
  const entryId = toPublicId(input.entryId);
  const personId = toPublicId(input.personId);
  if (!activityId || !entryId || !personId) {
    throw new Error('activityId, entryId, and personId are required.');
  }

  const accessContext = schoolDataService.buildRouteAccessContext(req);
  const hasScheduleFields = input.date !== undefined || input.startTime !== undefined || input.endTime !== undefined;
  if (hasScheduleFields) {
    await activityWorkSessionService.saveWorkSessionMetadata({
      activityId,
      entryId,
      reqUser: req.user,
      input: {
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime
      },
      accessContext
    });
  }

  const completionStatus = String(input.completionStatus || '').trim().toLowerCase();
  const assigneeStatus = String(input.status || input.assigneeStatus || '').trim().toLowerCase();
  if (completionStatus === 'completed') {
    await activityWorkSessionService.completeAssignee({
      activityId,
      entryId,
      personId,
      reqUser: req.user,
      input: { personId },
      accessContext
    });
  } else if (completionStatus === 'pending') {
    await activityWorkSessionService.resetAssigneeCompletion({
      activityId,
      entryId,
      personId,
      reqUser: req.user,
      input: { personId },
      accessContext
    });
  } else if (assigneeStatus) {
    await activityWorkSessionService.saveAssigneeRow({
      activityId,
      entryId,
      personId,
      reqUser: req.user,
      input: { personId, status: assigneeStatus },
      accessContext
    });
  }

  const context = await activityWorkSessionService.getWorkSessionContext(activityId, entryId, req.user, accessContext);
  return {
    activityId,
    entryId,
    personId,
    entry: context?.entry || null
  };
}

module.exports = {
  updateClassSessionSchedule,
  updateClassSessionStatus,
  updateWorkSessionFromSchedule,
  isScheduledEditableSession,
  isSessionAdministrativelyLocked
};
