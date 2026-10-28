const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function emptyStudentPunctualitySummary() {
  return {
    attendedSessions: 0,
    onTimeSessions: 0,
    lateSessions: 0,
    leftEarlySessions: 0,
    lateMinutes: 0,
    leftEarlyMinutes: 0,
    lateExcusedSessions: 0,
    lateExcusedMinutes: 0,
    leftEarlyExcusedSessions: 0,
    leftEarlyExcusedMinutes: 0,
    totalIssueSessions: 0,
    punctualityPercent: 'N/A',
    punctualityLabel: 'Not available'
  };
}

function getPunctualityLabel(percent, attendedSessions) {
  if (!Number.isFinite(Number(attendedSessions)) || Number(attendedSessions) <= 0) return 'Not available';
  const p = Number(percent);
  if (!Number.isFinite(p)) return 'Not available';
  if (p >= 95) return 'Excellent punctuality';
  if (p >= 85) return 'Good punctuality';
  if (p >= 70) return 'Needs attention';
  return 'Punctuality concern';
}

function sessionForcesNotApplicableAttendance(session, statusMap) {
  const effectiveStatusMap = statusMap instanceof Map ? statusMap : new Map();
  return sessionStatusPolicyService.shouldForceNotApplicableAttendanceByMap(effectiveStatusMap, {
    status: session?.status,
    notes: session?.notes
  });
}

function matrixRecordToRosterRow(record = {}) {
  const base = record && typeof record === 'object' ? record : {};
  const attendance = base.attendance !== undefined && base.attendance !== null && base.attendance !== ''
    ? base.attendance
    : base.status;
  return { ...base, attendance };
}

function accumulateStudentPunctualityNormalized(out, normalized) {
  const status = String(normalized?.attendance || '').trim().toLowerCase();
  if (status !== 'present' && status !== 'late') return;

  const timing = attendanceMatrixMetricsService.normalizeAttendanceTimingFields(normalized);
  const late = timing.lateMinutes;
  const leftEarly = timing.earlyLeaveMinutes;
  out.attendedSessions += 1;
  out.lateMinutes += late;
  out.leftEarlyMinutes += leftEarly;
  if (late > 0) out.lateSessions += 1;
  if (leftEarly > 0) out.leftEarlySessions += 1;
  if (timing.lateExcused) {
    out.lateExcusedSessions += 1;
    out.lateExcusedMinutes += late;
  }
  if (timing.earlyLeaveExcused) {
    out.leftEarlyExcusedSessions += 1;
    out.leftEarlyExcusedMinutes += leftEarly;
  }
  if (late > 0 || leftEarly > 0) out.totalIssueSessions += 1;
  if (late <= 0 && leftEarly <= 0) out.onTimeSessions += 1;
}

function finalizeStudentPunctualitySummary(out) {
  if (out.attendedSessions > 0) {
    out.punctualityPercent = Number(((out.onTimeSessions / out.attendedSessions) * 100).toFixed(2));
  } else {
    out.punctualityPercent = 'N/A';
  }
  out.punctualityLabel = getPunctualityLabel(out.punctualityPercent, out.attendedSessions);
  return out;
}

function buildStudentPunctualityFromMatrixRow(matrixRow = {}, options = {}) {
  const out = emptyStudentPunctualitySummary();
  const classData = options?.classData && typeof options.classData === 'object' ? options.classData : {};
  const orgPolicyLayer = options?.orgPolicyLayer && typeof options.orgPolicyLayer === 'object' ? options.orgPolicyLayer : {};
  const sessionList = Array.isArray(options?.sessions) ? options.sessions : [];
  const effectiveStatusMap = options?.statusMap instanceof Map ? options.statusMap : new Map();
  const matrixPolicy = attendanceMatrixMetricsService.resolvePolicy(classData, orgPolicyLayer);
  const enabledAttendanceStatuses = attendanceMatrixMetricsService.resolveEnabledAttendanceStatuses(classData);

  (Array.isArray(matrixRow?.records) ? matrixRow.records : []).forEach((record, index) => {
    if (record?.expectedForSession !== true) return;
    const sessionMeta = sessionList[index] || {};
    if (sessionStatusPolicyService.shouldExcludeFromAttendanceByMap(effectiveStatusMap, {
      status: sessionMeta?.status,
      notes: sessionMeta?.notes
    })) return;
    if (sessionForcesNotApplicableAttendance(sessionMeta, effectiveStatusMap)) return;

    const normalized = attendanceMatrixMetricsService.applyAttendanceMatrixRosterRules(
      matrixRecordToRosterRow(record),
      matrixPolicy,
      enabledAttendanceStatuses
    );
    accumulateStudentPunctualityNormalized(out, normalized);
  });

  return finalizeStudentPunctualitySummary(out);
}

function buildStudentPunctualityFromSessions(sessions, studentId, statusMap = null, options = {}) {
  const out = emptyStudentPunctualitySummary();
  const target = toPublicId(studentId);
  if (!target) return out;

  const effectiveStatusMap = statusMap instanceof Map ? statusMap : new Map();
  const classData = options?.classData && typeof options.classData === 'object' ? options.classData : {};
  const orgPolicyLayer = options?.orgPolicyLayer && typeof options.orgPolicyLayer === 'object' ? options.orgPolicyLayer : {};
  const matrixPolicy = attendanceMatrixMetricsService.resolvePolicy(classData, orgPolicyLayer);
  const enabledAttendanceStatuses = attendanceMatrixMetricsService.resolveEnabledAttendanceStatuses(classData);

  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    if (sessionStatusPolicyService.shouldExcludeFromAttendanceByMap(effectiveStatusMap, {
      status: session?.status,
      notes: session?.notes
    })) return;
    if (sessionForcesNotApplicableAttendance(session, effectiveStatusMap)) return;
    const roster = Array.isArray(session?.roster) ? session.roster : [];
    const row = roster.find((item) => idsEqual(item?.personId, target));
    if (!row) return;

    const normalized = attendanceMatrixMetricsService.applyAttendanceMatrixRosterRules(
      row,
      matrixPolicy,
      enabledAttendanceStatuses
    );
    accumulateStudentPunctualityNormalized(out, normalized);
  });

  return finalizeStudentPunctualitySummary(out);
}

function mergeStudentPunctualitySummaries(existing = {}, incoming = {}) {
  const out = emptyStudentPunctualitySummary();
  const keys = Object.keys(out).filter((key) => key !== 'punctualityPercent' && key !== 'punctualityLabel');
  keys.forEach((key) => {
    out[key] = Number(existing?.[key] || 0) + Number(incoming?.[key] || 0);
  });
  return finalizeStudentPunctualitySummary(out);
}

module.exports = {
  emptyStudentPunctualitySummary,
  getPunctualityLabel,
  buildStudentPunctualityFromMatrixRow,
  buildStudentPunctualityFromSessions,
  mergeStudentPunctualitySummaries
};
