const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const COUNTED_STATUSES = new Set([
  attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT,
  attendanceMatrixMetricsService.ATTENDANCE_STATUS.LATE,
  attendanceMatrixMetricsService.ATTENDANCE_STATUS.ABSENT,
  attendanceMatrixMetricsService.ATTENDANCE_STATUS.ACF
]);

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
  return normalizeDateOnly(session.date || session.sessionDate || '');
}

function periodEffectiveEnd(period = {}) {
  return classEnrollmentSessionApplicabilityService.periodEffectiveEndDate(period);
}

function sessionInPeriodWindow(period, session, options = {}) {
  const date = getSessionDate(session);
  if (!date) return false;
  const start = normalizeDateOnly(period?.startDate);
  if (!start || date < start) return false;
  const endBound = options.boundaryDate
    ? normalizeDateOnly(options.boundaryDate)
    : periodEffectiveEnd(period);
  if (endBound && date > endBound) return false;
  return true;
}

function isCapEnrollment(period = {}) {
  const sessionCap = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(period.targetSessionCount);
  const hourCap = classEnrollmentSessionApplicabilityService.normalizeTargetHours(period.targetHours);
  return sessionCap > 0 || hourCap > 0;
}

function listSessionsInEnrollmentWindow(period, sessions = [], options = {}) {
  const rows = Array.isArray(sessions) ? sessions : [];
  const capMode = isCapEnrollment(period);
  return rows.filter((session) => {
    if (sessionStatusPolicyService.shouldExcludeFromAttendanceByMap(options.statusMap, {
      status: session?.status,
      notes: session?.notes
    })) return false;
    if (capMode) {
      const date = getSessionDate(session);
      const start = normalizeDateOnly(period?.startDate);
      if (!date || !start || date < start) return false;
      const end = normalizeDateOnly(period?.endDate);
      if (end && date > end) return false;
      if (options.boundaryDate) {
        const boundary = normalizeDateOnly(options.boundaryDate);
        if (boundary && date >= boundary) return false;
      }
      return true;
    }
    return sessionInPeriodWindow(period, session, options);
  });
}

function buildPeriodAttendanceSummary({
  period,
  sessions = [],
  studentPersonId = '',
  classData = {},
  boundaryDate = '',
  statusMap = null,
  generatedBy = ''
} = {}) {
  const personId = toPublicId(studentPersonId || period?.personId);
  const windowSessions = listSessionsInEnrollmentWindow(period, sessions, {
    boundaryDate,
    statusMap
  });
  const summary = {
    cycleClassId: toPublicId(classData?.id || period?.classId || ''),
    boundaryDate: normalizeDateOnly(boundaryDate),
    consumedSessions: 0,
    present: 0,
    absent: 0,
    absentExcused: 0,
    acf: 0,
    acfExcused: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    lateExcusedMinutes: 0,
    earlyLeaveExcusedMinutes: 0,
    notApplicableSessions: 0,
    targetSessionCount: classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(period?.targetSessionCount),
    targetHours: classEnrollmentSessionApplicabilityService.normalizeTargetHours(period?.targetHours),
    consumedHours: 0,
    remainingSessions: 0,
    remainingHours: 0,
    generatedAt: new Date().toISOString(),
    generatedBy: String(generatedBy || '').trim()
  };

  let consumedHours = 0;
  windowSessions.forEach((session) => {
    const roster = Array.isArray(session?.roster) ? session.roster : [];
    const row = roster.find((item) => idsEqual(item?.personId, personId));
    if (!row) return;

    const status = attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(row.attendance, '');
    if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE) {
      summary.notApplicableSessions += 1;
      return;
    }
    if (!COUNTED_STATUSES.has(status)) return;

    summary.consumedSessions += 1;
    if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT) summary.present += 1;
    if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.LATE) summary.present += 1;
    if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.ABSENT) {
      summary.absent += 1;
      if (attendanceMatrixMetricsService.isAbsenceExcused(row)) summary.absentExcused += 1;
    }
    if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.ACF) {
      summary.acf += 1;
      if (attendanceMatrixMetricsService.isAbsenceExcused(row)) summary.acfExcused += 1;
    }

    const timing = attendanceMatrixMetricsService.normalizeAttendanceTimingFields(row);
    summary.lateMinutes += timing.lateMinutes;
    summary.earlyLeaveMinutes += timing.earlyLeaveMinutes;
    if (timing.lateExcused) summary.lateExcusedMinutes += timing.lateMinutes;
    if (timing.earlyLeaveExcused) summary.earlyLeaveExcusedMinutes += timing.earlyLeaveMinutes;

    const sessionHours = classEnrollmentSessionApplicabilityService.resolveSessionDurationHours(session);
    if (sessionHours > 0) consumedHours += sessionHours;
  });

  summary.consumedHours = Number(consumedHours.toFixed(2));
  const remaining = computeRemainingCap({ period, summary });
  summary.remainingSessions = remaining.remainingSessions;
  summary.remainingHours = remaining.remainingHours;
  return summary;
}

function computeRemainingCap({ period = {}, summary = {} } = {}) {
  const targetSessionCount = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(
    summary.targetSessionCount || period?.targetSessionCount
  );
  const targetHours = classEnrollmentSessionApplicabilityService.normalizeTargetHours(
    summary.targetHours || period?.targetHours
  );
  const consumedSessions = Math.max(0, Math.floor(Number(summary.consumedSessions || 0)));
  const consumedHours = Number.isFinite(Number(summary.consumedHours))
    ? Number(Number(summary.consumedHours).toFixed(2))
    : 0;

  if (targetSessionCount > 0) {
    return {
      remainingSessions: Math.max(0, targetSessionCount - consumedSessions),
      remainingHours: 0
    };
  }
  if (targetHours > 0) {
    return {
      remainingSessions: 0,
      remainingHours: Math.max(0, Number((targetHours - consumedHours).toFixed(2)))
    };
  }
  return { remainingSessions: 0, remainingHours: 0 };
}

function filterEnrollmentMarksFromBoundary(marks = [], sessions = [], boundaryDate = '') {
  const boundary = normalizeDateOnly(boundaryDate);
  if (!boundary) return Array.isArray(marks) ? marks : [];
  const sessionDateById = new Map();
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    const id = getSessionId(session);
    if (!id) return;
    sessionDateById.set(id, getSessionDate(session));
  });
  return (Array.isArray(marks) ? marks : []).filter((mark) => {
    const sessionId = toPublicId(mark?.sessionId);
    const date = sessionDateById.get(sessionId) || '';
    return date && date >= boundary;
  });
}

module.exports = {
  buildPeriodAttendanceSummary,
  computeRemainingCap,
  listSessionsInEnrollmentWindow,
  isCapEnrollment,
  filterEnrollmentMarksFromBoundary,
  sessionInPeriodWindow
};
