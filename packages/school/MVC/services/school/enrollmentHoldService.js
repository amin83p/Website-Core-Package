const schoolRepositories = require('../../repositories/school');
const enrollmentCycleSummaryService = require('./enrollmentCycleSummaryService');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const classEnrollmentPeriodModel = require('../../models/school/classEnrollmentPeriodModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

let dependencies = {
  repositories: schoolRepositories
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

function getSessionDate(session = {}) {
  return normalizeDateOnly(session.date || session.sessionDate || session.startDate);
}

function dateRangesOverlap(aStart, aEnd, bStart, bEnd) {
  const startA = normalizeDateOnly(aStart);
  const endA = normalizeDateOnly(aEnd);
  const startB = normalizeDateOnly(bStart);
  const endB = normalizeDateOnly(bEnd);
  if (!startA || !endA || !startB || !endB) return false;
  return startA <= endB && startB <= endA;
}

function resolveHoldDateBounds(period = {}, startDate = '', endDate = '') {
  const enrollmentStart = normalizeDateOnly(period?.startDate);
  const enrollmentEnd = normalizeDateOnly(period?.endDate) || '9999-12-31';
  const holdStart = normalizeDateOnly(startDate);
  const holdEnd = normalizeDateOnly(endDate);
  if (!enrollmentStart) throw new Error('Enrollment start date is required.');
  if (!holdStart || !holdEnd) throw new Error('Hold start date and end date are required.');
  if (holdEnd < holdStart) throw new Error('Hold end date cannot be before hold start date.');
  if (holdStart < enrollmentStart) {
    throw new Error('Hold start date must be within the enrollment period.');
  }
  if (holdEnd > enrollmentEnd) {
    throw new Error('Hold end date must be within the enrollment period.');
  }
  return { holdStart, holdEnd, enrollmentStart, enrollmentEnd };
}

function listSessionsForHold(period = {}, sessions = [], startDate = '', endDate = '') {
  const { holdStart, holdEnd } = resolveHoldDateBounds(period, startDate, endDate);
  const windowSessions = enrollmentCycleSummaryService.listSessionsInEnrollmentWindow(period, sessions);
  return windowSessions.filter((session) => {
    const date = getSessionDate(session);
    return date && date >= holdStart && date <= holdEnd;
  });
}

function getRosterRow(session = {}, personId = '') {
  const target = toPublicId(personId);
  return (Array.isArray(session?.roster) ? session.roster : []).find((row) => idsEqual(row?.personId, target)) || null;
}

function describeSessionAttendance(rosterRow) {
  const attendance = rosterRow
    ? attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(rosterRow.attendance, '')
    : '';
  const hasNonNaAttendance = Boolean(attendance)
    && attendance !== attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE;
  return {
    attendance,
    hasNonNaAttendance,
    notes: String(rosterRow?.notes || '').trim()
  };
}

function buildSessionPreviewRows(sessions = [], personId = '') {
  return sessions.map((session) => {
    const sessionId = getSessionId(session);
    const rosterRow = getRosterRow(session, personId);
    const attendanceInfo = describeSessionAttendance(rosterRow);
    return {
      sessionId,
      date: getSessionDate(session),
      startTime: String(session.startTime || session.start || '').trim(),
      endTime: String(session.endTime || session.end || '').trim(),
      attendance: attendanceInfo.attendance || '',
      notes: attendanceInfo.notes,
      hasNonNaAttendance: attendanceInfo.hasNonNaAttendance,
      projectedAttendance: 'not_applicable'
    };
  });
}

function assertNoOverlappingAppliedHolds(period = {}, startDate = '', endDate = '', excludeHoldId = '') {
  const excludeId = toPublicId(excludeHoldId);
  const holds = classEnrollmentPeriodModel.sanitizeEnrollmentHoldPeriods(period?.enrollmentHoldPeriods);
  const overlap = holds.find((row) => row.status === 'applied'
    && (!excludeId || !idsEqual(row.id, excludeId))
    && dateRangesOverlap(row.startDate, row.endDate, startDate, endDate));
  if (overlap) {
    throw new Error(`This hold overlaps an existing on-hold period (${overlap.startDate} to ${overlap.endDate}).`);
  }
}

function findAppliedHold(period = {}, holdId = '') {
  const targetId = toPublicId(holdId);
  if (!targetId) return null;
  const holds = classEnrollmentPeriodModel.sanitizeEnrollmentHoldPeriods(period?.enrollmentHoldPeriods);
  return holds.find((row) => row.status === 'applied' && idsEqual(row.id, targetId)) || null;
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

function resolvePersonId(period = {}) {
  const direct = toPublicId(period?.personId);
  if (direct) return direct;
  return '';
}

function buildPreviewResult(period, sessions, startDate, endDate) {
  const personId = resolvePersonId(period);
  if (!personId) throw new Error('Enrollment period is missing a student person reference.');
  const holdSessions = listSessionsForHold(period, sessions, startDate, endDate);
  const rows = buildSessionPreviewRows(holdSessions, personId);
  const blockers = rows
    .filter((row) => row.hasNonNaAttendance)
    .map((row) => ({
      sessionId: row.sessionId,
      date: row.date,
      attendance: row.attendance,
      message: `Session on ${row.date} already has attendance recorded (${row.attendance}).`
    }));
  return {
    periodId: period.id,
    classId: period.classId,
    studentId: period.studentId,
    personId,
    startDate: normalizeDateOnly(startDate),
    endDate: normalizeDateOnly(endDate),
    enrollmentStartDate: normalizeDateOnly(period.startDate),
    enrollmentEndDate: normalizeDateOnly(period.endDate) || '',
    existingHolds: classEnrollmentPeriodModel.sanitizeEnrollmentHoldPeriods(period.enrollmentHoldPeriods),
    sessions: rows,
    blockers,
    canApply: blockers.length === 0 && rows.length > 0
  };
}

async function previewHoldPeriod(periodId, input = {}, options = {}) {
  const period = await getPeriodOrThrow(periodId, options);
  const reason = String(input?.reason || '').trim();
  if (!reason) throw new Error('A reason is required for the on-hold period.');
  const excludeHoldId = String(input?.excludeHoldId || '').trim();
  resolveHoldDateBounds(period, input?.startDate, input?.endDate);
  assertNoOverlappingAppliedHolds(period, input?.startDate, input?.endDate, excludeHoldId);
  const sessions = await getClassSessions(period.classId, options);
  const preview = buildPreviewResult(period, sessions, input.startDate, input.endDate);
  return { ...preview, reason, excludeHoldId };
}

function applyRosterHoldForSessions({
  sessions = [],
  personId = '',
  sessionIds = [],
  reason = ''
}) {
  const targetPersonId = toPublicId(personId);
  const idSet = new Set((Array.isArray(sessionIds) ? sessionIds : []).map((id) => toPublicId(id)).filter(Boolean));
  if (!targetPersonId || !idSet.size) return { nextSessions: sessions, updatedCount: 0 };

  let updatedCount = 0;
  const nextSessions = sessions.map((session) => {
    const sessionId = getSessionId(session);
    if (!idSet.has(sessionId)) return session;
    const roster = Array.isArray(session.roster) ? session.roster.map((row) => ({ ...row })) : [];
    const index = roster.findIndex((row) => idsEqual(row?.personId, targetPersonId));
    if (index < 0) {
      roster.push({
        personId: targetPersonId,
        attendance: attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE,
        notes: reason,
        comments: [],
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        lateExcused: false,
        earlyLeaveExcused: false,
        absenceExcused: false
      });
      updatedCount += 1;
      return { ...session, roster };
    }
    const row = roster[index];
    const attendance = attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(row.attendance, '');
    if (attendance && attendance !== attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE) {
      throw new Error(`Session on ${getSessionDate(session)} already has attendance recorded (${attendance}).`);
    }
    roster[index] = {
      ...row,
      attendance: attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE,
      notes: reason,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      lateExcused: false,
      earlyLeaveExcused: false,
      absenceExcused: false
    };
    updatedCount += 1;
    return { ...session, roster };
  });
  return { nextSessions, updatedCount };
}

function revertRosterHoldForSessions({
  sessions = [],
  personId = '',
  sessionIds = [],
  expectedReason = ''
}) {
  const targetPersonId = toPublicId(personId);
  const reason = String(expectedReason || '').trim();
  const idSet = new Set((Array.isArray(sessionIds) ? sessionIds : []).map((id) => toPublicId(id)).filter(Boolean));
  if (!targetPersonId || !idSet.size) return { nextSessions: sessions, revertedCount: 0 };

  let revertedCount = 0;
  const nextSessions = sessions.map((session) => {
    const sessionId = getSessionId(session);
    if (!idSet.has(sessionId)) return session;
    const roster = Array.isArray(session.roster) ? session.roster.map((row) => ({ ...row })) : [];
    const index = roster.findIndex((row) => idsEqual(row?.personId, targetPersonId));
    if (index < 0) return session;
    const row = roster[index];
    const attendance = attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(row.attendance, '');
    const notes = String(row?.notes || '').trim();
    if (attendance !== attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE) return session;
    if (reason && notes !== reason) return session;
    roster.splice(index, 1);
    revertedCount += 1;
    return { ...session, roster };
  });
  return { nextSessions, revertedCount };
}

function generateHoldId(existing = []) {
  const seen = new Set((Array.isArray(existing) ? existing : []).map((row) => String(row?.id || '').trim()).filter(Boolean));
  for (let i = 0; i < 50; i++) {
    const candidate = `HOLD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!seen.has(candidate)) return candidate;
  }
  return `HOLD-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

async function applyHoldPeriod(periodId, input = {}, requestingUser = null, options = {}) {
  const reason = String(input?.reason || '').trim();
  if (!reason) throw new Error('A reason is required for the on-hold period.');
  const period = await getPeriodOrThrow(periodId, options);
  const preview = await previewHoldPeriod(periodId, input, options);
  if (!preview.canApply) {
    const message = preview.blockers.length
      ? preview.blockers[0].message
      : 'No sessions are available for this on-hold period.';
    throw new Error(message);
  }

  const personId = resolvePersonId(period);
  const classId = toPublicId(period.classId);
  const classRow = await dependencies.repositories.classes.getById(classId, options);
  if (!classRow) throw new Error('Class not found.');
  const sessions = Array.isArray(classRow.sessions) ? classRow.sessions : [];
  const sessionIds = preview.sessions.map((row) => row.sessionId).filter(Boolean);
  const { nextSessions, updatedCount } = applyRosterHoldForSessions({
    sessions,
    personId,
    sessionIds,
    reason
  });
  if (!updatedCount) throw new Error('No session rosters were updated for this on-hold period.');

  await dependencies.repositories.classes.update(classId, {
    sessions: nextSessions,
    updatedBy: resolveActor(requestingUser)
  }, options);

  const existingHolds = classEnrollmentPeriodModel.sanitizeEnrollmentHoldPeriods(period.enrollmentHoldPeriods);
  const holdRecord = {
    id: generateHoldId(existingHolds),
    startDate: preview.startDate,
    endDate: preview.endDate,
    reason,
    sessionIds,
    createdAt: new Date().toISOString(),
    createdBy: resolveActor(requestingUser),
    status: 'applied'
  };
  const updated = await dependencies.repositories.classEnrollmentPeriods.update(period.id, {
    enrollmentHoldPeriods: [...existingHolds, holdRecord],
    updatedBy: resolveActor(requestingUser)
  }, options);

  return {
    hold: holdRecord,
    period: updated,
    updatedSessionCount: updatedCount,
    preview
  };
}

async function revokeHoldPeriod(periodId, holdId, requestingUser = null, options = {}) {
  const period = await getPeriodOrThrow(periodId, options);
  const hold = findAppliedHold(period, holdId);
  if (!hold) throw new Error('On-hold period not found.');

  const personId = resolvePersonId(period);
  const classId = toPublicId(period.classId);
  const classRow = await dependencies.repositories.classes.getById(classId, options);
  if (!classRow) throw new Error('Class not found.');
  const sessions = Array.isArray(classRow.sessions) ? classRow.sessions : [];
  const { nextSessions, revertedCount } = revertRosterHoldForSessions({
    sessions,
    personId,
    sessionIds: hold.sessionIds,
    expectedReason: hold.reason
  });

  await dependencies.repositories.classes.update(classId, {
    sessions: nextSessions,
    updatedBy: resolveActor(requestingUser)
  }, options);

  const existingHolds = classEnrollmentPeriodModel.sanitizeEnrollmentHoldPeriods(period.enrollmentHoldPeriods);
  const nextHolds = existingHolds.map((row) => {
    if (!idsEqual(row.id, hold.id)) return row;
    return {
      ...row,
      status: 'revoked',
      revokedAt: new Date().toISOString(),
      revokedBy: resolveActor(requestingUser)
    };
  });
  const updated = await dependencies.repositories.classEnrollmentPeriods.update(period.id, {
    enrollmentHoldPeriods: nextHolds,
    updatedBy: resolveActor(requestingUser)
  }, options);

  return {
    hold: nextHolds.find((row) => idsEqual(row.id, hold.id)) || null,
    period: updated,
    revertedSessionCount: revertedCount
  };
}

async function updateHoldPeriod(periodId, holdId, input = {}, requestingUser = null, options = {}) {
  const reason = String(input?.reason || '').trim();
  if (!reason) throw new Error('A reason is required for the on-hold period.');
  const period = await getPeriodOrThrow(periodId, options);
  const hold = findAppliedHold(period, holdId);
  if (!hold) throw new Error('On-hold period not found.');

  const preview = await previewHoldPeriod(periodId, {
    startDate: input?.startDate,
    endDate: input?.endDate,
    reason,
    excludeHoldId: hold.id
  }, options);
  if (!preview.canApply) {
    const message = preview.blockers.length
      ? preview.blockers[0].message
      : 'No sessions are available for this on-hold period.';
    throw new Error(message);
  }

  const personId = resolvePersonId(period);
  const classId = toPublicId(period.classId);
  const classRow = await dependencies.repositories.classes.getById(classId, options);
  if (!classRow) throw new Error('Class not found.');
  const sessions = Array.isArray(classRow.sessions) ? classRow.sessions : [];
  const { nextSessions: revertedSessions, revertedCount } = revertRosterHoldForSessions({
    sessions,
    personId,
    sessionIds: hold.sessionIds,
    expectedReason: hold.reason
  });
  const sessionIds = preview.sessions.map((row) => row.sessionId).filter(Boolean);
  const { nextSessions, updatedCount } = applyRosterHoldForSessions({
    sessions: revertedSessions,
    personId,
    sessionIds,
    reason
  });
  if (!updatedCount) throw new Error('No session rosters were updated for this on-hold period.');

  await dependencies.repositories.classes.update(classId, {
    sessions: nextSessions,
    updatedBy: resolveActor(requestingUser)
  }, options);

  const existingHolds = classEnrollmentPeriodModel.sanitizeEnrollmentHoldPeriods(period.enrollmentHoldPeriods);
  const nextHolds = existingHolds.map((row) => {
    if (!idsEqual(row.id, hold.id)) return row;
    return {
      ...row,
      startDate: preview.startDate,
      endDate: preview.endDate,
      reason,
      sessionIds,
      updatedAt: new Date().toISOString(),
      updatedBy: resolveActor(requestingUser),
      status: 'applied'
    };
  });
  const updated = await dependencies.repositories.classEnrollmentPeriods.update(period.id, {
    enrollmentHoldPeriods: nextHolds,
    updatedBy: resolveActor(requestingUser)
  }, options);

  return {
    hold: nextHolds.find((row) => idsEqual(row.id, hold.id)) || null,
    period: updated,
    updatedSessionCount: updatedCount,
    revertedSessionCount: revertedCount,
    preview
  };
}

function __setDependenciesForTest(nextDeps = {}) {
  dependencies = {
    ...dependencies,
    ...nextDeps
  };
}

function __resetDependenciesForTest() {
  dependencies = {
    repositories: schoolRepositories
  };
}

module.exports = {
  resolveHoldDateBounds,
  listSessionsForHold,
  previewHoldPeriod,
  applyHoldPeriod,
  revokeHoldPeriod,
  updateHoldPeriod,
  revertRosterHoldForSessions,
  dateRangesOverlap,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
