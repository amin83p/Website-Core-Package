const schoolDataService = require('./schoolDataService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const leaveRequestService = require('./leaveRequestService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function resolveAssignmentDurationFromTargetRows(targetRows = []) {
  const rows = Array.isArray(targetRows) ? targetRows : [];
  const startDates = [];
  const endDates = [];
  rows.forEach((row) => {
    const start = normalizeDateOnly(row?.reportStartDate);
    const end = normalizeDateOnly(row?.reportDueDate || row?.dueDate || row?.sessionDate);
    if (start) startDates.push(start);
    if (end) endDates.push(end);
  });
  startDates.sort();
  endDates.sort();
  return {
    startDate: startDates[0] || '',
    endDate: endDates[endDates.length - 1] || ''
  };
}

function resolveScopedSessions({
  sessions = [],
  startDate = '',
  endDate = '',
  targetSessionIds = []
} = {}) {
  const sessionRows = Array.isArray(sessions) ? sessions : [];
  const sessionIdSet = new Set(
    (Array.isArray(targetSessionIds) ? targetSessionIds : [])
      .map((id) => toPublicId(id))
      .filter(Boolean)
  );
  const hasSessionFilter = sessionIdSet.size > 0;
  const normalizedStart = normalizeDateOnly(startDate);
  const normalizedEnd = normalizeDateOnly(endDate);

  return sessionRows.filter((session) => {
    const sessionId = toPublicId(session?.sessionId || session?.id);
    if (hasSessionFilter && !sessionIdSet.has(sessionId)) return false;
    const sessionDate = normalizeDateOnly(session?.date);
    if (!sessionDate) return false;
    if (normalizedStart && sessionDate < normalizedStart) return false;
    if (normalizedEnd && sessionDate > normalizedEnd) return false;
    return true;
  });
}

function buildSessionMetricKey(session = {}) {
  return String(session?.sessionId || session?.id || session?.date || '').trim();
}

function periodCoversSessionDate(period = {}, sessionDate = '', classData = {}) {
  const date = normalizeDateOnly(sessionDate);
  if (!date) return false;
  const start = normalizeDateOnly(period?.startDate);
  const end = classEnrollmentSessionApplicabilityService.periodEffectiveEndDate(period);
  if (!start) return false;
  const status = String(period?.status || '').trim().toLowerCase();
  const allowed = classEnrollmentReadService.getReportRosterStatusesForClass(classData);
  const statusSet = new Set(
    (Array.isArray(allowed) ? allowed : []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
  );
  if (!statusSet.has(status)) return false;
  return start <= date && end >= date;
}

async function resolveEligiblePersonIdsForDuration({
  classData,
  sessions = [],
  reqUser,
  startDate = '',
  endDate = ''
} = {}) {
  const classId = toPublicId(classData?.id);
  if (!classId) return [];

  const snapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
    classId,
    classItem: classData,
    reqUser,
    activeOrgId: classData?.orgId,
    sessionDates: resolveScopedSessions({ sessions, startDate, endDate }).map((row) => String(row?.date || '').trim()).filter(Boolean),
    startDate,
    endDate,
    canonicalStatuses: classEnrollmentReadService.getReportRosterStatusesForClass(classData)
  });
  const activeStudentIds = snapshot?.studentIds instanceof Set ? [...snapshot.studentIds] : [];
  if (!activeStudentIds.length) return [];

  const allStudents = await schoolDataService.fetchAllData('students', {}, reqUser);
  const personIds = new Set();
  (Array.isArray(allStudents) ? allStudents : []).forEach((student) => {
    const studentId = toPublicId(student?.id);
    const personId = toPublicId(student?.personId);
    if (studentId && personId && activeStudentIds.some((id) => idsEqual(id, studentId))) {
      personIds.add(personId);
    }
  });
  return [...personIds];
}

async function countEligibleSessionsForPerson({
  classData,
  scopedSessions = [],
  personId,
  studentRecord = null,
  periodRows = [],
  reqUser,
  orgId = '',
  forceNotApplicableSessionKeys = new Set(),
  applicability = null
} = {}) {
  const targetPersonId = toPublicId(personId);
  if (!targetPersonId || !scopedSessions.length) return 0;

  const registrationMode = String(classData?.registrationMode || '').trim().toLowerCase();
  if (registrationMode === 'rolling') {
    const stateByKey = applicability?.stateByKey;
    if (!(stateByKey instanceof Map)) return 0;
    return scopedSessions.reduce((count, session) => {
      const state = classEnrollmentSessionApplicabilityService.getApplicabilityState(
        stateByKey,
        targetPersonId,
        session,
        session?.sessionId || session?.id
      );
      return count + (state?.expected ? 1 : 0);
    }, 0);
  }

  const studentId = toPublicId(studentRecord?.id);
  const studentPeriods = (Array.isArray(periodRows) ? periodRows : [])
    .filter((period) => studentId && idsEqual(period?.studentId, studentId));

  const leaveConflicts = await leaveRequestService.findApprovedLeaveConflicts({
    orgId,
    reqUser,
    windows: scopedSessions.map((session) => ({
      sessionIndex: buildSessionMetricKey(session),
      personId: targetPersonId,
      date: session?.date,
      startTime: session?.startTime,
      endTime: session?.endTime
    })).filter((row) => row.sessionIndex && row.date)
  });
  const leaveSessionKeys = new Set(
    (Array.isArray(leaveConflicts) ? leaveConflicts : [])
      .map((row) => String(row?.sessionIndex || '').trim())
      .filter(Boolean)
  );

  return scopedSessions.reduce((count, session) => {
    const sessionKey = buildSessionMetricKey(session);
    if (!sessionKey || leaveSessionKeys.has(sessionKey)) return count;
    if (forceNotApplicableSessionKeys.has(sessionKey) || forceNotApplicableSessionKeys.has(normalizeDateOnly(session?.date))) {
      return count;
    }
    const sessionDate = normalizeDateOnly(session?.date);
    const covered = studentPeriods.some((period) => periodCoversSessionDate(period, sessionDate, classData));
    return count + (covered ? 1 : 0);
  }, 0);
}

async function resolveEligibleStudentsForAssignment({
  classData,
  sessions = [],
  reqUser,
  startDate = '',
  endDate = '',
  targetSessionIds = [],
  targetRows = [],
  personMap = new Map()
} = {}) {
  const duration = resolveAssignmentDurationFromTargetRows(targetRows);
  const effectiveStartDate = normalizeDateOnly(startDate) || duration.startDate;
  const effectiveEndDate = normalizeDateOnly(endDate) || duration.endDate;
  const scopedSessions = resolveScopedSessions({
    sessions,
    startDate: effectiveStartDate,
    endDate: effectiveEndDate,
    targetSessionIds
  });

  const eligiblePersonIds = await resolveEligiblePersonIdsForDuration({
    classData,
    sessions,
    reqUser,
    startDate: effectiveStartDate,
    endDate: effectiveEndDate
  });
  if (!eligiblePersonIds.length) return [];

  const allStudents = await schoolDataService.fetchAllData('students', {}, reqUser);
  const personToStudentMap = new Map();
  (Array.isArray(allStudents) ? allStudents : []).forEach((student) => {
    const personId = toPublicId(student?.personId);
    if (personId) personToStudentMap.set(personId, student);
  });

  const orgId = classData?.orgId || reqUser?.activeOrgId || '';
  const registrationMode = String(classData?.registrationMode || '').trim().toLowerCase();
  const periodRows = await schoolDataService.getClassEnrollmentPeriodsByClassId(classData?.id || '', reqUser);

  const statusMapForApplicability = await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
  const forceNotApplicableSessionKeys = sessionStatusPolicyService.buildForceNotApplicableAttendanceSessionKeys(
    statusMapForApplicability,
    scopedSessions
  );

  let rollingApplicability = null;
  if (registrationMode === 'rolling') {
    const studentToPersonMap = new Map();
    eligiblePersonIds.forEach((personId) => {
      const student = personToStudentMap.get(personId);
      const studentId = toPublicId(student?.id);
      if (studentId) studentToPersonMap.set(studentId, personId);
    });
    rollingApplicability = await classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentApplicabilityWithLeaves({
      sessions: scopedSessions,
      periodRows,
      studentToPersonMap,
      activeOrgId: orgId,
      orgId,
      reqUser,
      allowedStatuses: classEnrollmentSessionApplicabilityService.OPEN_OR_HISTORICAL_STATUSES,
      forceNotApplicableSessionKeys
    });
  }

  const results = [];
  for (const personId of eligiblePersonIds) {
    const studentRecord = personToStudentMap.get(personId) || null;
    // eslint-disable-next-line no-await-in-loop
    const eligibleSessionCount = await countEligibleSessionsForPerson({
      classData,
      scopedSessions,
      personId,
      studentRecord,
      periodRows,
      reqUser,
      orgId,
      forceNotApplicableSessionKeys,
      applicability: rollingApplicability
    });
    results.push({
      personId,
      id: personId,
      name: personMap.get(personId) || studentRecord?.name || personId,
      eligibleSessionCount
    });
  }

  return results.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

module.exports = {
  normalizeDateOnly,
  resolveAssignmentDurationFromTargetRows,
  resolveScopedSessions,
  resolveEligibleStudentsForAssignment
};
