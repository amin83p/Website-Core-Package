const schoolRepositories = require('../../repositories/school');
const classEnrollmentPeriodService = require('./classEnrollmentPeriodService');
const enrollmentCycleSummaryService = require('./enrollmentCycleSummaryService');
const rollingEnrollmentSessionAlignmentService = require('./rollingEnrollmentSessionAlignmentService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

let dependencies = {
  repositories: schoolRepositories,
  enrollmentPeriodService: classEnrollmentPeriodService
};

function resolveActor(requestingUser, fallback = 'system') {
  return String(
    requestingUser?.id ||
    requestingUser?.userId ||
    requestingUser?.personId ||
    requestingUser?.username ||
    requestingUser?.email ||
    fallback
  ).trim() || fallback;
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function getSessionId(session = {}) {
  return toPublicId(session.sessionId || session.id || '');
}

function getMarksMap(period = {}) {
  const map = new Map();
  const marks = Array.isArray(period?.enrollmentSessionMarks) ? period.enrollmentSessionMarks : [];
  marks.forEach((mark) => {
    const sessionId = toPublicId(mark?.sessionId);
    if (!sessionId) return;
    map.set(sessionId, mark);
  });
  const legacy = rollingEnrollmentSessionAlignmentService.sanitizePlannedNaSessionIds(period?.plannedNotApplicableSessionIds);
  legacy.forEach((sessionId) => {
    if (!map.has(sessionId)) {
      map.set(sessionId, {
        sessionId,
        status: 'not_applicable',
        note: '',
        markedAt: '',
        markedBy: '',
        locked: true
      });
    }
  });
  return map;
}

function marksArrayFromMap(map) {
  return [...map.values()].slice(0, 500);
}

function syncPlannedNaIds(marks) {
  return marks
    .filter((mark) => String(mark?.status || '').toLowerCase() === 'not_applicable')
    .map((mark) => toPublicId(mark.sessionId))
    .filter(Boolean);
}

async function getPeriodOrThrow(periodId, options = {}) {
  const id = toPublicId(periodId);
  if (!id) throw new Error('periodId is required.');
  const period = await dependencies.repositories.classEnrollmentPeriods.getById(id, options);
  if (!period) throw new Error('Enrollment period not found.');
  return period;
}

async function getClassSessions(classId, options = {}) {
  const classRow = await dependencies.repositories.classes.getById(toPublicId(classId), options);
  return Array.isArray(classRow?.sessions) ? classRow.sessions : [];
}

async function buildSessionWindowPayload(periodId, options = {}) {
  const period = await getPeriodOrThrow(periodId, options);
  const sessions = await getClassSessions(period.classId, options);
  const marksMap = getMarksMap(period);
  const windowSessions = enrollmentCycleSummaryService.listSessionsInEnrollmentWindow(period, sessions);
  const personId = toPublicId(period.personId);

  const rows = windowSessions.map((session) => {
    const sessionId = getSessionId(session);
    const roster = Array.isArray(session?.roster) ? session.roster : [];
    const rosterRow = roster.find((row) => idsEqual(row?.personId, personId)) || null;
    const mark = marksMap.get(sessionId) || null;
    const attendance = rosterRow
      ? attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(rosterRow.attendance, '')
      : '';
    return {
      sessionId,
      date: normalizeDateOnly(session.date || session.sessionDate),
      startTime: String(session.startTime || session.start || '').trim(),
      endTime: String(session.endTime || session.end || '').trim(),
      status: String(session.status || '').trim(),
      attendance,
      lateMinutes: Number(rosterRow?.lateMinutes || 0),
      earlyLeaveMinutes: Number(rosterRow?.earlyLeaveMinutes || 0),
      mark: mark ? { ...mark } : null,
      locked: Boolean(mark?.locked)
    };
  });

  return {
    periodId: period.id,
    classId: period.classId,
    studentId: period.studentId,
    startDate: period.startDate,
    endDate: period.endDate || '',
    enrollmentKind: period.enrollmentKind || 'standard',
    targetSessionCount: period.targetSessionCount || 0,
    targetHours: period.targetHours || 0,
    cycleAttendanceSummary: period.cycleAttendanceSummary || null,
    sessions: rows
  };
}

async function applySessionMarks(periodId, changes = [], requestingUser = null, options = {}) {
  const period = await getPeriodOrThrow(periodId, options);
  const actor = resolveActor(requestingUser);
  const marksMap = getMarksMap(period);
  const sessions = await getClassSessions(period.classId, options);
  const windowIds = new Set(
    enrollmentCycleSummaryService.listSessionsInEnrollmentWindow(period, sessions)
      .map((session) => getSessionId(session))
      .filter(Boolean)
  );

  (Array.isArray(changes) ? changes : []).forEach((change) => {
    if (!change || typeof change !== 'object') return;
    const sessionId = toPublicId(change.sessionId);
    if (!sessionId || !windowIds.has(sessionId)) return;
    const action = String(change.action || '').trim().toLowerCase();
    if (action === 'unmark') {
      marksMap.delete(sessionId);
      return;
    }
    if (action !== 'mark_na') return;
    const note = String(change.note || '').trim();
    if (!note) throw new Error('A note is required when marking a session as N/A.');
    marksMap.set(sessionId, {
      sessionId,
      status: 'not_applicable',
      note,
      markedAt: new Date().toISOString(),
      markedBy: actor,
      locked: true
    });
  });

  const marks = marksArrayFromMap(marksMap);
  const plannedIds = syncPlannedNaIds(marks);

  const windowSessions = enrollmentCycleSummaryService.listSessionsInEnrollmentWindow(period, sessions);
  const countableSessions = windowSessions.map((session) => {
    const sessionId = getSessionId(session);
    return {
      sessionId,
      durationHours: classEnrollmentSessionApplicabilityService.resolveSessionDurationHours(session),
      startTime: String(session.startTime || session.start || '').trim(),
      endTime: String(session.endTime || session.end || '').trim(),
      date: normalizeDateOnly(session.date || session.sessionDate)
    };
  }).filter((row) => row.sessionId);
  const sessionsById = new Map(
    windowSessions
      .map((session) => [getSessionId(session), session])
      .filter(([sessionId]) => Boolean(sessionId))
  );
  const targetSessionCount = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(period.targetSessionCount);
  const targetHours = classEnrollmentSessionApplicabilityService.normalizeTargetHours(period.targetHours);
  if (targetSessionCount > 0 || targetHours > 0) {
    const validation = rollingEnrollmentSessionAlignmentService.validatePlannedNaSelection({
      countableSessions,
      targetSessionCount,
      targetHours,
      plannedNaSessionIds: plannedIds,
      sessionsById
    });
    if (!validation.valid) {
      throw new Error(validation.message || 'Enrollment session marks do not match the target.');
    }
  }

  const updated = await dependencies.repositories.classEnrollmentPeriods.update(period.id, {
    enrollmentSessionMarks: marks,
    plannedNotApplicableSessionIds: plannedIds,
    updatedBy: actor
  }, options);

  const personId = toPublicId(period.personId);
  if (personId && plannedIds.length) {
    await removePersonFromExcludedSessions({
      classId: period.classId,
      personId,
      sessionIds: plannedIds,
      requestingUser,
      options
    });
  }

  const unmarkIds = (Array.isArray(changes) ? changes : [])
    .filter((row) => String(row?.action || '').toLowerCase() === 'unmark')
    .map((row) => toPublicId(row.sessionId))
    .filter(Boolean);
  if (unmarkIds.length && personId) {
    await clearRosterNaForSessions({
      classId: period.classId,
      personId,
      sessionIds: unmarkIds,
      requestingUser,
      options
    });
  }

  return updated;
}

async function removePersonFromExcludedSessions({
  classId,
  personId,
  sessionIds = [],
  requestingUser = null,
  options = {}
} = {}) {
  const normalizedClassId = toPublicId(classId);
  const targetPersonId = toPublicId(personId);
  const ids = rollingEnrollmentSessionAlignmentService.sanitizePlannedNaSessionIds(sessionIds);
  if (!normalizedClassId || !targetPersonId || !ids.length) return { updatedCount: 0 };

  const classRow = await dependencies.repositories.classes.getById(normalizedClassId, options);
  if (!classRow) throw new Error('Class not found.');
  const sessions = Array.isArray(classRow.sessions) ? classRow.sessions : [];
  const { nextSessions, updatedCount } = rollingEnrollmentSessionAlignmentService
    .removePersonFromExcludedSessionRosters(sessions, targetPersonId, ids);
  if (!updatedCount) return { updatedCount: 0 };

  await dependencies.repositories.classes.update(normalizedClassId, {
    sessions: nextSessions,
    updatedBy: resolveActor(requestingUser)
  }, options);
  return { updatedCount };
}

async function clearRosterNaForSessions({
  classId,
  personId,
  sessionIds = [],
  requestingUser = null,
  options = {}
} = {}) {
  const normalizedClassId = toPublicId(classId);
  const targetPersonId = toPublicId(personId);
  const ids = (Array.isArray(sessionIds) ? sessionIds : []).map((id) => toPublicId(id)).filter(Boolean);
  if (!normalizedClassId || !targetPersonId || !ids.length) return { updatedCount: 0 };

  const classRow = await dependencies.repositories.classes.getById(normalizedClassId, options);
  if (!classRow) throw new Error('Class not found.');
  const sessions = Array.isArray(classRow.sessions) ? classRow.sessions : [];
  let updatedCount = 0;
  const nextSessions = sessions.map((session) => {
    const sessionId = getSessionId(session);
    if (!ids.includes(sessionId)) return session;
    const roster = Array.isArray(session.roster) ? session.roster : [];
    const nextRoster = roster.map((row) => {
      if (!idsEqual(row?.personId, targetPersonId)) return row;
      const status = attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(row.attendance, '');
      if (status !== attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE) return row;
      updatedCount += 1;
      return {
        ...row,
        attendance: '',
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        lateExcused: false,
        earlyLeaveExcused: false,
        absenceExcused: false
      };
    });
    return { ...session, roster: nextRoster };
  });

  if (!updatedCount) return { updatedCount: 0 };
  await dependencies.repositories.classes.update(normalizedClassId, {
    sessions: nextSessions,
    updatedBy: resolveActor(requestingUser)
  }, options);
  return { updatedCount };
}

function findLockedEnrollmentNaMark(periodRows = [], classId, sessionId, personId) {
  const normalizedSessionId = toPublicId(sessionId);
  const normalizedPersonId = toPublicId(personId);
  if (!normalizedSessionId || !normalizedPersonId) return null;
  const periods = Array.isArray(periodRows) ? periodRows : [];
  for (const period of periods) {
    if (classId && !idsEqual(period?.classId, classId)) continue;
    if (personId && !idsEqual(period?.personId, normalizedPersonId)) continue;
    const mark = getMarksMap(period).get(normalizedSessionId);
    if (mark?.locked) return { periodId: period.id, mark };
  }
  return null;
}

function __setDependenciesForTest(nextDeps = {}) {
  dependencies = { ...dependencies, ...nextDeps };
}

function __resetDependenciesForTest() {
  dependencies = {
    repositories: schoolRepositories,
    enrollmentPeriodService: classEnrollmentPeriodService
  };
}

module.exports = {
  buildSessionWindowPayload,
  applySessionMarks,
  findLockedEnrollmentNaMark,
  getMarksMap,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
