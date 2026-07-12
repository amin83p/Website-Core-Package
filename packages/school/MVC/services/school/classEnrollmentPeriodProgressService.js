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
    Array.isArray(students) ? students : schoolDataService.fetchData('students', {}, user),
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
    const displayTarget = rollingEnrollmentSessionAlignmentService.resolveDisplaySessionTarget({
      sessions,
      startDate: row?.startDate,
      endDate: row?.endDate,
      targetSessionCount,
      statusMap
    });
    const effectiveTargetSessionCount = displayTarget.effectiveTargetSessionCount;
    const summary = applicability.summariesByPeriodId.get(toPublicId(row?.id)) || null;
    const consumedSessionCount = summary ? Number(summary.consumedCount || 0) : null;
    const reservedSessionCount = effectiveTargetSessionCount && summary ? Number(summary.reservedCount || 0) : null;
    const periodStatus = String(row?.status || '').trim().toLowerCase();
    const terminalStatus = ['withdrawn', 'cancelled', 'completed', 'archived'].includes(periodStatus);
    const targetReached = effectiveTargetSessionCount
      && consumedSessionCount !== null
      && consumedSessionCount >= effectiveTargetSessionCount;
    const sessionCompletion = row?.completionDate ? {
      date: row.completionDate,
      sessionId: row.completionSessionId || '',
      reason: row.completionReason || ''
    } : (summary?.completionCandidate ? {
      date: summary.completionCandidate.date,
      sessionId: summary.completionCandidate.sessionId,
      reason: 'target_session_count_reached'
    } : (targetReached && summary?.lastConsumedSession ? {
      date: summary.lastConsumedSession.date,
      sessionId: summary.lastConsumedSession.sessionId,
      reason: targetSessionCount ? 'target_session_count_reached' : 'date_window_complete'
    } : (terminalStatus && summary?.lastConsumedSession ? {
      date: summary.lastConsumedSession.date,
      sessionId: summary.lastConsumedSession.sessionId,
      reason: 'last_consumed_session'
    } : null)));
    return {
      ...row,
      targetSessionCount,
      effectiveTargetSessionCount,
      windowSessionCount: displayTarget.windowSessionCount,
      targetSource: displayTarget.targetSource,
      sessionCountPolicy: targetSessionCount ? classEnrollmentSessionApplicabilityService.normalizeSessionCountPolicy(row?.sessionCountPolicy) : '',
      consumedSessionCount,
      reservedSessionCount,
      remainingSessionCount: effectiveTargetSessionCount !== null && consumedSessionCount !== null
        ? Math.max(0, effectiveTargetSessionCount - consumedSessionCount)
        : null,
      sessionCompletion
    };
  });
}

module.exports = {
  attachSessionProgressToEnrollmentPeriodRows
};
