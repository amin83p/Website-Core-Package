'use strict';

const schoolRepositories = require('../../repositories/school');
const enrollmentCycleSummaryService = require('./enrollmentCycleSummaryService');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const rollingEnrollmentSessionAlignmentService = require('./rollingEnrollmentSessionAlignmentService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
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

function compareDates(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

function resolveReportDate(period = {}, requestedDate = '', orgToday = '') {
  const today = normalizeDateOnly(orgToday) || normalizeDateOnly(new Date().toISOString().slice(0, 10));
  const start = normalizeDateOnly(period?.startDate);
  const end = normalizeDateOnly(period?.endDate);
  let reportDate = normalizeDateOnly(requestedDate) || today;
  if (start && reportDate < start) reportDate = start;
  const maxDate = end && end < today ? end : today;
  if (maxDate && reportDate > maxDate) reportDate = maxDate;
  return reportDate;
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

function buildReasonText(parts = []) {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join(' | ');
}

function buildExtendedAttendanceMetrics({
  period = {},
  sessions = [],
  studentPersonId = '',
  classData = {},
  reportDate = '',
  statusMap = null,
  generatedBy = ''
} = {}) {
  const personId = toPublicId(studentPersonId || period?.personId);
  const boundaryDate = normalizeDateOnly(reportDate);
  const windowSessions = enrollmentCycleSummaryService.listSessionsInEnrollmentWindow(period, sessions, {
    boundaryDate,
    statusMap
  });
  const marksMap = getMarksMap(period);

  const baseSummary = enrollmentCycleSummaryService.buildPeriodAttendanceSummary({
    period,
    sessions,
    studentPersonId: personId,
    classData,
    boundaryDate,
    statusMap,
    generatedBy
  });

  const extended = {
    ...baseSummary,
    totalSessionsToDate: 0,
    presentOnly: 0,
    lateSessions: 0,
    earlyLeaveSessions: 0,
    lateExcusedSessions: 0,
    earlyLeaveExcusedSessions: 0,
    unmarkedSessions: 0
  };

  const naReasonKeys = new Set();
  const naReasons = [];

  const pushNaReason = (entry) => {
    const date = normalizeDateOnly(entry?.date);
    const reason = String(entry?.reason || '').trim();
    const source = String(entry?.source || '').trim();
    const sessionId = toPublicId(entry?.sessionId);
    if (!date || !reason) return;
    const key = `${date}|${sessionId}|${source}|${reason}`;
    if (naReasonKeys.has(key)) return;
    naReasonKeys.add(key);
    naReasons.push({ date, sessionId, reason, source });
  };

  windowSessions.forEach((session) => {
    const sessionId = getSessionId(session);
    const date = getSessionDate(session);
    const roster = Array.isArray(session?.roster) ? session.roster : [];
    const row = roster.find((item) => idsEqual(item?.personId, personId));
    if (!row) return;

    extended.totalSessionsToDate += 1;

    const status = attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(row.attendance, '');
    const timing = attendanceMatrixMetricsService.normalizeAttendanceTimingFields(row);
    const mark = marksMap.get(sessionId) || null;

    if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE) {
      pushNaReason({
        date,
        sessionId,
        source: 'Attendance roster',
        reason: buildReasonText([row?.notes, row?.excuseRef, mark?.note])
      });
      return;
    }

    if (mark && String(mark?.status || '').trim().toLowerCase() === 'not_applicable') {
      pushNaReason({
        date,
        sessionId,
        source: 'Enrollment mark',
        reason: buildReasonText([mark?.note])
      });
    }

    if (!status) {
      extended.unmarkedSessions += 1;
      return;
    }
    if (!COUNTED_STATUSES.has(status)) return;

    if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT) {
      extended.presentOnly += 1;
    }
    if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.LATE) {
      extended.lateSessions += 1;
    }
    if (timing.earlyLeaveMinutes > 0) {
      extended.earlyLeaveSessions += 1;
    }
    if (timing.lateExcused) {
      extended.lateExcusedSessions += 1;
    }
    if (timing.earlyLeaveExcused) {
      extended.earlyLeaveExcusedSessions += 1;
    }
  });

  naReasons.sort((a, b) => compareDates(a.date, b.date) || compareDates(a.sessionId, b.sessionId));

  return {
    summary: extended,
    naReasons
  };
}

function buildShortcutMetadata(period = {}) {
  const endDate = normalizeDateOnly(period?.endDate);
  const targetSessionCount = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(period?.targetSessionCount);
  const targetHours = classEnrollmentSessionApplicabilityService.normalizeTargetHours(period?.targetHours);
  return {
    hasEndDate: Boolean(endDate),
    endDate,
    targetSessionCount,
    targetHours
  };
}

async function resolvePeriodPersonId(period = {}, options = {}) {
  const directPersonId = toPublicId(period?.personId);
  if (directPersonId) return directPersonId;
  const studentId = toPublicId(period?.studentId);
  if (!studentId) return '';
  const student = await schoolRepositories.students.getById(studentId, options);
  return toPublicId(student?.personId || '');
}

async function buildAttendanceReport({
  periodId,
  reportDate = '',
  orgToday = '',
  generatedBy = '',
  options = {}
} = {}) {
  const id = toPublicId(periodId);
  if (!id) throw new Error('periodId is required.');

  const period = await schoolRepositories.classEnrollmentPeriods.getById(id, options);
  if (!period) throw new Error('Enrollment period not found.');

  const classRow = await schoolRepositories.classes.getById(toPublicId(period.classId), options);
  if (!classRow) throw new Error('Class not found.');

  const sessions = Array.isArray(classRow?.sessions) ? classRow.sessions : [];
  const orgId = toPublicId(classRow?.orgId || period?.orgId || '');
  const statusMap = await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
  const resolvedReportDate = resolveReportDate(period, reportDate, orgToday);
  const resolvedPersonId = await resolvePeriodPersonId(period, options);
  const { summary, naReasons } = buildExtendedAttendanceMetrics({
    period,
    sessions,
    studentPersonId: resolvedPersonId,
    classData: classRow,
    reportDate: resolvedReportDate,
    statusMap,
    generatedBy
  });

  return {
    periodId: period.id,
    classId: period.classId,
    studentId: period.studentId,
    personId: resolvedPersonId,
    reportDate: resolvedReportDate,
    period: {
      startDate: normalizeDateOnly(period.startDate),
      endDate: normalizeDateOnly(period.endDate),
      targetSessionCount: classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(period.targetSessionCount),
      targetHours: classEnrollmentSessionApplicabilityService.normalizeTargetHours(period.targetHours),
      status: String(period.status || '').trim()
    },
    shortcuts: buildShortcutMetadata(period),
    summary,
    naReasons
  };
}

module.exports = {
  buildAttendanceReport,
  buildExtendedAttendanceMetrics,
  resolveReportDate,
  resolvePeriodPersonId,
  buildShortcutMetadata
};
