'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const schoolDataService = require('./schoolDataService');
const schoolRecordAccessService = require('./schoolRecordAccessService');
const classSessionCapacityService = require('./classSessionCapacityService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const sessionConflictDetectionService = require('./sessionConflictDetectionService');
const sessionDeliveryTeamService = require('./sessionDeliveryTeamService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');

const ERROR_CODES = Object.freeze({
  ENROLLMENT_CAP: 'SESSION_ENROLLMENT_CAP_CONFLICT',
  METADATA_CONFLICTS: 'SESSION_METADATA_CONFLICTS'
});

class OneOnOneSessionScheduleBlockedError extends Error {
  constructor({ code, message, conflicts = [], blockers = [] }) {
    super(message || 'Session schedule change is not allowed.');
    this.name = 'OneOnOneSessionScheduleBlockedError';
    this.code = code || ERROR_CODES.ENROLLMENT_CAP;
    this.conflicts = Array.isArray(conflicts) ? conflicts : [];
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

function scheduleFieldsPresentInBody(body = {}) {
  return ['date', 'startTime', 'endTime'].some((key) => body[key] !== undefined);
}

function buildCapBlockedMessage(reason = '') {
  const token = String(reason || '').trim();
  if (token === classEnrollmentSessionApplicabilityService.APPLICABILITY_REASON.HOUR_CAP_REACHED) {
    return 'This change would exceed the student\'s enrolled hour cap for this class.';
  }
  if (token === classEnrollmentSessionApplicabilityService.APPLICABILITY_REASON.SESSION_CAP_REACHED) {
    return 'This change would exceed the student\'s enrolled session cap for this class.';
  }
  if (token === 'student_not_enrolled') {
    return 'The session date is outside the student\'s enrollment window for this class.';
  }
  return 'This schedule change is not allowed under the student\'s session or hour enrollment cap.';
}

async function resolveTeacherOneOnOneScheduleEditAccess(req, classData, session) {
  if (!req?.user || !classData || !session) {
    return { allowed: false, reason: 'missing_context' };
  }
  const access = schoolRecordAccessService.resolveAccessFromRequest(req);
  const canManage = schoolRecordAccessService.isSessionAccessible({
    classRow: classData,
    session,
    access,
    context: 'manageSession'
  });
  if (!canManage) {
    return { allowed: false, reason: 'session_not_editable' };
  }
  const viewerPersonId = String(req.user?.personId || '').trim();
  if (!viewerPersonId || !sessionDeliveryTeamService.isPersonSessionEditor(session, viewerPersonId)) {
    return { allowed: false, reason: 'not_session_editor' };
  }
  const students = await schoolDataService.fetchAllData('students', {}, req.user).catch(() => []);
  const studentToPersonMap = new Map(
    (Array.isArray(students) ? students : [])
      .map((row) => [toPublicId(row?.id), toPublicId(row?.personId)])
      .filter(([studentId, personId]) => Boolean(studentId && personId))
  );
  const context = await classSessionCapacityService.resolveSessionOneOnOneContext({
    classData,
    session,
    reqUser: req.user,
    activeOrgId: String(classData?.orgId || req.user?.activeOrgId || '').trim(),
    studentToPersonMap
  });
  if (context?.capacityMode !== 'one_on_one' && context?.isOneOnOne !== true) {
    return { allowed: false, reason: 'not_one_on_one' };
  }
  return { allowed: true, reason: '', oneOnOneContext: context, studentToPersonMap };
}

async function resolveCanEditOneOnOneSessionSchedule(req, classData, session, { canOverride = false, canEditSession = true } = {}) {
  if (canOverride || !canEditSession) return false;
  const access = await resolveTeacherOneOnOneScheduleEditAccess(req, classData, session);
  return access.allowed === true;
}

function applyTeacherOneOnOneScheduleFields(session = {}, body = {}) {
  if (!scheduleFieldsPresentInBody(body)) {
    return { changed: false };
  }
  const priorDate = normalizeDateOnly(session.date);
  const priorStart = normalizeClockTime(session.startTime);
  const priorEnd = normalizeClockTime(session.endTime);

  const date = body.date !== undefined ? normalizeDateOnly(body.date) : priorDate;
  const startTime = body.startTime !== undefined ? normalizeClockTime(body.startTime) : priorStart;
  const endTime = body.endTime !== undefined ? normalizeClockTime(body.endTime) : priorEnd;
  if (!date) throw new Error('Session date is required.');
  if (!startTime || !endTime || startTime >= endTime) {
    throw new Error('Session start time must be before end time.');
  }

  const changed = date !== priorDate || startTime !== priorStart || endTime !== priorEnd;
  if (!changed) return { changed: false };

  session.date = date;
  session.startTime = startTime;
  session.endTime = endTime;
  session.durationHours = calculateSessionDurationHours(startTime, endTime, session.durationHours);
  return { changed: true };
}

async function assertEnrollmentCapAllowsScheduleChange({
  classData,
  sessions = [],
  sessionId,
  workingSession,
  reqUser,
  oneOnOneContext = null,
  studentToPersonMap = null
} = {}) {
  if (classSessionCapacityService.getClassRegistrationModeKey(classData) !== 'rolling') {
    return;
  }
  const classId = toPublicId(classData?.id);
  const normalizedSessionId = toPublicId(sessionId);
  const activeOrgId = String(classData?.orgId || reqUser?.activeOrgId || '').trim();

  let personMap = studentToPersonMap;
  if (!(personMap instanceof Map)) {
    const students = await schoolDataService.fetchAllData('students', {}, reqUser).catch(() => []);
    personMap = new Map(
      (Array.isArray(students) ? students : [])
        .map((row) => [toPublicId(row?.id), toPublicId(row?.personId)])
        .filter(([studentId, personId]) => Boolean(studentId && personId))
    );
  }

  const periodRows = await schoolDataService.getClassEnrollmentPeriodsByClassId(classId, reqUser);
  const capPeriods = (Array.isArray(periodRows) ? periodRows : [])
    .filter((period) => classEnrollmentSessionApplicabilityService.hasEnrollmentCap(period));
  if (!capPeriods.length) return;

  const applicability = await classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentApplicabilityWithLeaves({
    sessions,
    periodRows,
    studentToPersonMap: personMap,
    activeOrgId,
    orgId: activeOrgId,
    reqUser
  });

  const statusMap = await sessionStatusPolicyService.getStatusMap(activeOrgId, { includeInactive: true });
  const allocatedPersonIds = classSessionCapacityService.resolveSessionEnrollmentPersonIds({
    classData,
    session: workingSession,
    studentToPersonMap: personMap,
    statusMap,
    rollingApplicability: applicability
  });

  const context = oneOnOneContext || await classSessionCapacityService.resolveSessionOneOnOneContext({
    classData,
    session: workingSession,
    reqUser,
    activeOrgId,
    studentToPersonMap: personMap,
    rollingApplicability: applicability
  });

  const personIds = allocatedPersonIds instanceof Set ? Array.from(allocatedPersonIds) : [];
  const targetPersonIds = personIds.length
    ? personIds
    : (context?.singleStudentPersonId ? [toPublicId(context.singleStudentPersonId)] : []);

  if (!targetPersonIds.length) {
    throw new OneOnOneSessionScheduleBlockedError({
      code: ERROR_CODES.ENROLLMENT_CAP,
      message: 'No enrolled student is allocated to this session under the current enrollment cap.'
    });
  }

  for (const personId of targetPersonIds) {
    const window = classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentWindowForPerson({
      periodRows: capPeriods,
      studentToPersonMap: personMap,
      personId,
      session: workingSession,
      activeOrgId
    });
    if (!window?.withinEnrollmentWindow) {
      throw new OneOnOneSessionScheduleBlockedError({
        code: ERROR_CODES.ENROLLMENT_CAP,
        message: buildCapBlockedMessage(window?.reason || 'student_not_enrolled')
      });
    }

    const state = classEnrollmentSessionApplicabilityService.getApplicabilityState(
      applicability.stateByKey,
      personId,
      workingSession,
      normalizedSessionId
    );
    if (!state || state.expected !== true) {
      throw new OneOnOneSessionScheduleBlockedError({
        code: ERROR_CODES.ENROLLMENT_CAP,
        message: buildCapBlockedMessage(state?.reason || '')
      });
    }
  }
}

async function detectOneOnOneScheduleConflicts({
  classData,
  mergedSessions = [],
  sessionId,
  workingSession,
  reqUser,
  oneOnOneContext = null,
  studentToPersonMap = null
} = {}) {
  const classId = toPublicId(classData?.id);
  const activeOrgId = String(classData?.orgId || reqUser?.activeOrgId || '').trim();
  const normalizedSessionId = toPublicId(sessionId);
  const fallbackTeacherId = String(workingSession?.delivery?.deliveredBy || '').trim();

  const teacherConflicts = await sessionConflictDetectionService.detectSessionConflicts({
    classId,
    sessions: mergedSessions,
    activeOrgId,
    reqUser,
    fallbackTeacherId,
    includeExternalScheduleConflicts: true,
    externalFocusSessionIds: [normalizedSessionId]
  });

  let personMap = studentToPersonMap;
  if (!(personMap instanceof Map)) {
    const students = await schoolDataService.fetchAllData('students', {}, reqUser).catch(() => []);
    personMap = new Map(
      (Array.isArray(students) ? students : [])
        .map((row) => [toPublicId(row?.id), toPublicId(row?.personId)])
        .filter(([studentId, personId]) => Boolean(studentId && personId))
    );
  }

  const periodRows = classSessionCapacityService.getClassRegistrationModeKey(classData) === 'rolling'
    ? await schoolDataService.getClassEnrollmentPeriodsByClassId(classId, reqUser)
    : [];
  const applicability = periodRows.length
    ? await classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentApplicabilityWithLeaves({
      sessions: mergedSessions,
      periodRows,
      studentToPersonMap: personMap,
      activeOrgId,
      orgId: activeOrgId,
      reqUser
    })
    : null;
  const statusMap = await sessionStatusPolicyService.getStatusMap(activeOrgId, { includeInactive: true });
  const allocatedPersonIds = applicability
    ? classSessionCapacityService.resolveSessionEnrollmentPersonIds({
      classData,
      session: workingSession,
      studentToPersonMap: personMap,
      statusMap,
      rollingApplicability: applicability
    })
    : (oneOnOneContext?.applicablePersonIds || new Set());

  const context = oneOnOneContext || await classSessionCapacityService.resolveSessionOneOnOneContext({
    classData,
    session: workingSession,
    reqUser,
    activeOrgId,
    studentToPersonMap: personMap,
    rollingApplicability: applicability
  });

  const personIds = allocatedPersonIds instanceof Set ? Array.from(allocatedPersonIds) : [];
  const targetPersonIds = personIds.length
    ? personIds
    : (context?.singleStudentPersonId ? [toPublicId(context.singleStudentPersonId)] : []);

  const studentPersonEntries = targetPersonIds.map((personId) => {
    let studentId = '';
    for (const [sid, pid] of personMap.entries()) {
      if (idsEqual(pid, personId)) {
        studentId = sid;
        break;
      }
    }
    return { personId, studentId, name: personId };
  }).filter((row) => row.personId);

  const studentConflicts = studentPersonEntries.length
    ? await sessionConflictDetectionService.detectStudentScheduleConflicts({
      orgId: activeOrgId,
      classId,
      proposedSessions: [workingSession],
      studentPersonEntries,
      reqUser
    })
    : [];

  return sessionConflictDetectionService.dedupeSessionConflictRows([
    ...(Array.isArray(teacherConflicts) ? teacherConflicts : []),
    ...(Array.isArray(studentConflicts) ? studentConflicts : [])
  ]);
}

function mapConflictsForClient(conflicts = [], fallbackSession = {}) {
  return (Array.isArray(conflicts) ? conflicts : []).slice(0, 12).map((row) => ({
    date: row?.date || fallbackSession.date,
    teacherName: row?.teacherName || '',
    conflictClass: row?.conflictClass || 'schedule conflict',
    existTime: row?.existTime || '',
    conflictType: row?.conflictType || ''
  }));
}

async function validateTeacherOneOnOneScheduleChange({
  classData,
  sessions,
  sessionId,
  workingSession,
  reqUser,
  oneOnOneContext,
  studentToPersonMap
} = {}) {
  await assertEnrollmentCapAllowsScheduleChange({
    classData,
    sessions,
    sessionId,
    workingSession,
    reqUser,
    oneOnOneContext,
    studentToPersonMap
  });

  const mergedSessions = sessions;
  const conflicts = await detectOneOnOneScheduleConflicts({
    classData,
    mergedSessions,
    sessionId,
    workingSession,
    reqUser,
    oneOnOneContext,
    studentToPersonMap
  });

  if (conflicts.length) {
    throw new OneOnOneSessionScheduleBlockedError({
      code: ERROR_CODES.METADATA_CONFLICTS,
      message: 'Schedule conflicts were detected for the updated session date, time, or duration.',
      conflicts
    });
  }
}

module.exports = {
  ERROR_CODES,
  OneOnOneSessionScheduleBlockedError,
  scheduleFieldsPresentInBody,
  resolveTeacherOneOnOneScheduleEditAccess,
  resolveCanEditOneOnOneSessionSchedule,
  applyTeacherOneOnOneScheduleFields,
  assertEnrollmentCapAllowsScheduleChange,
  detectOneOnOneScheduleConflicts,
  validateTeacherOneOnOneScheduleChange,
  mapConflictsForClient,
  normalizeDateOnly,
  normalizeClockTime,
  calculateSessionDurationHours
};
