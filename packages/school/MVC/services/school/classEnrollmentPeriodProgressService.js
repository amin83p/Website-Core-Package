const schoolDataService = require('./schoolDataService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const rollingEnrollmentSessionAlignmentService = require('./rollingEnrollmentSessionAlignmentService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

async function attachSessionProgressToEnrollmentPeriodRows(periodRows, classData, user, students = null) {
  const rows = Array.isArray(periodRows) ? periodRows : [];
  if (String(classData?.registrationMode || '').trim().toLowerCase() !== 'rolling' || !rows.length) return rows;
  const orgId = toPublicId(classData?.orgId || user?.activeOrgId || '');
  const [sessions, effectiveStudents, statusMap] = await Promise.all([
    schoolDataService.getClassSessions(classData.id, user),
    Array.isArray(students) ? students : schoolDataService.fetchAllData('students', {}, user),
    sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true })
  ]);
  const studentToPersonMap = new Map(
    (Array.isArray(effectiveStudents) ? effectiveStudents : [])
      .map((student) => [toPublicId(student?.id), toPublicId(student?.personId)])
      .filter(([studentId, personId]) => studentId && personId)
  );
  const applicability = await classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentApplicabilityWithLeaves({
    sessions,
    periodRows: rows,
    studentToPersonMap,
    activeOrgId: orgId,
    orgId,
    reqUser: user,
    allowedStatuses: classEnrollmentSessionApplicabilityService.ROLLING_DISPLAY_PERIOD_STATUSES
  });
  return rows.map((row) => {
    const targetSessionCount = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(row?.targetSessionCount);
    const targetHours = classEnrollmentSessionApplicabilityService.normalizeTargetHours(row?.targetHours);
    const displayTarget = rollingEnrollmentSessionAlignmentService.resolveDisplaySessionTarget({
      sessions,
      startDate: row?.startDate,
      endDate: row?.endDate,
      targetSessionCount,
      statusMap
    });
    const displayHourTarget = rollingEnrollmentSessionAlignmentService.resolveDisplayHourTarget({
      sessions,
      startDate: row?.startDate,
      endDate: row?.endDate,
      targetHours,
      statusMap
    });
    const effectiveTargetSessionCount = targetHours > 0
      ? displayHourTarget.allocatedSessionCount
      : displayTarget.effectiveTargetSessionCount;
    const effectiveTargetHours = targetHours > 0 ? targetHours : null;
    const summary = applicability.summariesByPeriodId.get(toPublicId(row?.id)) || null;
    const consumedSessionCount = summary ? Number(summary.consumedCount || 0) : null;
    const consumedHours = summary ? Number(summary.consumedHours || 0) : null;
    const reservedSessionCount = effectiveTargetSessionCount && summary ? Number(summary.reservedCount || 0) : null;
    const reservedHours = effectiveTargetHours && summary ? Number(summary.reservedHours || 0) : null;
    const periodStatus = String(row?.status || '').trim().toLowerCase();
    const terminalStatus = ['withdrawn', 'cancelled', 'completed', 'archived', 'void'].includes(periodStatus);
    const targetReached = effectiveTargetSessionCount
      && consumedSessionCount !== null
      && consumedSessionCount >= effectiveTargetSessionCount;
    const hourTargetReached = effectiveTargetHours
      && consumedHours !== null
      && consumedHours >= effectiveTargetHours;
    const sessionCompletion = row?.completionDate ? {
      date: row.completionDate,
      sessionId: row.completionSessionId || '',
      reason: row.completionReason || ''
    } : (summary?.completionCandidate ? {
      date: summary.completionCandidate.date,
      sessionId: summary.completionCandidate.sessionId,
      reason: targetHours > 0
        ? classEnrollmentSessionApplicabilityService.TARGET_HOURS_COMPLETION_REASON
        : 'target_session_count_reached'
    } : ((targetReached || hourTargetReached) && summary?.lastConsumedSession ? {
      date: summary.lastConsumedSession.date,
      sessionId: summary.lastConsumedSession.sessionId,
      reason: targetHours > 0
        ? classEnrollmentSessionApplicabilityService.TARGET_HOURS_COMPLETION_REASON
        : (targetSessionCount ? 'target_session_count_reached' : 'date_window_complete')
    } : (terminalStatus && summary?.lastConsumedSession ? {
      date: summary.lastConsumedSession.date,
      sessionId: summary.lastConsumedSession.sessionId,
      reason: 'last_consumed_session'
    } : null)));
    return {
      ...row,
      targetSessionCount,
      targetHours,
      effectiveTargetSessionCount,
      effectiveTargetHours,
      allocatedSessionCount: displayHourTarget.allocatedSessionCount,
      allocatedHours: displayHourTarget.allocatedHours,
      windowSessionCount: displayTarget.windowSessionCount,
      targetSource: targetHours > 0 ? displayHourTarget.targetSource : displayTarget.targetSource,
      sessionCountPolicy: targetSessionCount ? classEnrollmentSessionApplicabilityService.normalizeSessionCountPolicy(row?.sessionCountPolicy) : '',
      consumedSessionCount,
      consumedHours,
      reservedSessionCount,
      reservedHours,
      remainingSessionCount: effectiveTargetSessionCount !== null && consumedSessionCount !== null
        ? Math.max(0, effectiveTargetSessionCount - consumedSessionCount)
        : null,
      remainingHours: effectiveTargetHours !== null && consumedHours !== null
        ? Math.max(0, classEnrollmentSessionApplicabilityService.roundTargetHours(effectiveTargetHours - consumedHours))
        : null,
      sessionCompletion
    };
  });
}

function formatHoursLabel(hours) {
  const value = classEnrollmentSessionApplicabilityService.roundTargetHours(hours);
  if (!value) return '';
  return `${value} Hr${value === 1 ? '' : 's'}`;
}

function formatEnrollmentCapDisplay(row = {}, kind = 'target') {
  const targetHours = classEnrollmentSessionApplicabilityService.normalizeTargetHours(row?.targetHours);
  const explicitSessionCount = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(row?.targetSessionCount);
  const effectiveSessionCount = row?.effectiveTargetSessionCount === null || row?.effectiveTargetSessionCount === undefined
    ? (explicitSessionCount || null)
    : Number(row.effectiveTargetSessionCount || 0);
  const displaySessionCount = targetHours > 0
    ? (row?.allocatedSessionCount ?? effectiveSessionCount)
    : (explicitSessionCount || effectiveSessionCount);
  const consumedSessionCount = row?.consumedSessionCount === null || row?.consumedSessionCount === undefined
    ? null
    : Number(row.consumedSessionCount || 0);
  const remainingSessionCount = displaySessionCount !== null && consumedSessionCount !== null
    ? Math.max(0, Number(row?.remainingSessionCount ?? (displaySessionCount - consumedSessionCount)))
    : null;
  const effectiveHours = targetHours > 0 ? targetHours : null;
  const consumedHours = row?.consumedHours === null || row?.consumedHours === undefined
    ? null
    : Number(row.consumedHours || 0);
  const remainingHours = effectiveHours !== null && consumedHours !== null
    ? Math.max(0, Number(row?.remainingHours ?? classEnrollmentSessionApplicabilityService.roundTargetHours(effectiveHours - consumedHours)))
    : null;

  const withHours = (sessions, hours) => {
    if (sessions === null || sessions === undefined) return '';
    const sessionLabel = `${sessions} Session${Number(sessions) === 1 ? '' : 's'}`;
    if (hours !== null && hours !== undefined && targetHours > 0) {
      return `${sessionLabel} (${formatHoursLabel(hours)})`;
    }
    return sessionLabel;
  };

  if (kind === 'target') {
    if (displaySessionCount === null && effectiveHours === null) return '';
    if (effectiveHours !== null && (displaySessionCount === null || displaySessionCount === undefined)) {
      return formatHoursLabel(effectiveHours);
    }
    return withHours(displaySessionCount, effectiveHours);
  }
  if (kind === 'consumed') {
    if (consumedSessionCount === null) return '';
    if (targetHours > 0 || consumedHours > 0) {
      return `${consumedSessionCount} (${formatHoursLabel(consumedHours)})`;
    }
    return String(consumedSessionCount);
  }
  if (kind === 'remaining') {
    if (remainingSessionCount === null) return '';
    if (targetHours > 0) return `${remainingSessionCount} (${formatHoursLabel(remainingHours)})`;
    return String(remainingSessionCount);
  }
  return '';
}

module.exports = {
  attachSessionProgressToEnrollmentPeriodRows,
  formatEnrollmentCapDisplay
};
