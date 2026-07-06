const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const OPEN_OR_HISTORICAL_STATUSES = new Set(['active', 'planned', 'completed']);
const OPEN_STATUSES = new Set(['active', 'planned']);
const COUNTED_ATTENDANCE_STATUSES = new Set([
  attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT,
  attendanceMatrixMetricsService.ATTENDANCE_STATUS.LATE,
  attendanceMatrixMetricsService.ATTENDANCE_STATUS.EXCUSED,
  attendanceMatrixMetricsService.ATTENDANCE_STATUS.ABSENT
]);
const SESSION_COUNT_POLICY = 'all_non_na';

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeDateOnly(value) {
  const token = cleanText(value);
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function normalizeTargetSessionCount(value) {
  const parsed = Number.parseInt(cleanText(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeSessionCountPolicy(value) {
  const token = cleanText(value).toLowerCase();
  return token || SESSION_COUNT_POLICY;
}

function sanitizeSessionCapFields(input = {}) {
  const targetSessionCount = normalizeTargetSessionCount(input.targetSessionCount);
  return {
    targetSessionCount,
    sessionCountPolicy: targetSessionCount ? normalizeSessionCountPolicy(input.sessionCountPolicy) : '',
    completionDate: normalizeDateOnly(input.completionDate),
    completionSessionId: toPublicId(input.completionSessionId || ''),
    completionReason: cleanText(input.completionReason).slice(0, 120)
  };
}

function getSessionId(session = {}, fallback = '') {
  return toPublicId(session.sessionId || session.id || fallback);
}

function getSessionDate(session = {}) {
  return normalizeDateOnly(session.date || session.sessionDate || session.startDate);
}

function getSessionSortKey(session = {}, index = 0) {
  return [
    getSessionDate(session) || '9999-12-31',
    cleanText(session.startTime || session.start || ''),
    String(index).padStart(6, '0')
  ].join('|');
}

function buildApplicabilityKey(personId, session = {}, fallback = '') {
  return `${toPublicId(personId)}::${getSessionId(session, fallback)}`;
}

function getRosterRecord(session = {}, personId = '') {
  const target = toPublicId(personId);
  return (Array.isArray(session.roster) ? session.roster : []).find((row) => idsEqual(row?.personId, target)) || null;
}

function isSessionFinalizedForCounting(session = {}) {
  const status = cleanText(session.status).toLowerCase();
  return session.locked === true
    || String(session.locked || '').toLowerCase() === 'true'
    || session.completed === true
    || ['completed', 'complete', 'closed', 'done', 'finalized'].includes(status);
}

function periodStatusAllowed(period = {}, allowedStatuses = OPEN_OR_HISTORICAL_STATUSES) {
  const status = cleanText(period.status).toLowerCase();
  const statusSet = allowedStatuses instanceof Set
    ? allowedStatuses
    : new Set(Array.isArray(allowedStatuses) ? allowedStatuses : []);
  return statusSet.has(status);
}

function periodEffectiveEndDate(period = {}) {
  const endDate = normalizeDateOnly(period.endDate) || '9999-12-31';
  const completionDate = normalizeDateOnly(period.completionDate);
  if (!completionDate) return endDate;
  return completionDate < endDate ? completionDate : endDate;
}

function periodCoversSession(period = {}, session = {}, options = {}) {
  const date = getSessionDate(session);
  const start = normalizeDateOnly(period.startDate);
  const end = options.honorCompletion === false
    ? (normalizeDateOnly(period.endDate) || '9999-12-31')
    : periodEffectiveEndDate(period);
  return Boolean(date && start && start <= date && end >= date);
}

function normalizeSessionRows(sessions = []) {
  return (Array.isArray(sessions) ? sessions : [])
    .map((session, index) => ({
      session,
      index,
      sessionId: getSessionId(session, `idx_${index}`),
      date: getSessionDate(session),
      sortKey: getSessionSortKey(session, index)
    }))
    .filter((row) => row.sessionId && row.date)
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function normalizeStudentToPersonMap(input) {
  if (input instanceof Map) return input;
  const map = new Map();
  (Array.isArray(input) ? input : []).forEach((row) => {
    const studentId = toPublicId(row?.id || row?.studentId);
    const personId = toPublicId(row?.personId);
    if (studentId && personId) map.set(studentId, personId);
  });
  return map;
}

function resolveStudentPersonId(period = {}, studentToPersonMap) {
  const directPersonId = toPublicId(period.personId);
  if (directPersonId) return directPersonId;
  const studentId = toPublicId(period.studentId);
  return toPublicId(studentToPersonMap.get(studentId) || '');
}

function mergeState(existing, next) {
  if (!existing) return next;
  if (next.expected && !existing.expected) return next;
  if (next.expected === existing.expected && next.reason === 'expected') return next;
  return existing;
}

function resolveRollingEnrollmentApplicability({
  sessions = [],
  periodRows = [],
  studentToPersonMap = new Map(),
  activeOrgId = '',
  allowedStatuses = OPEN_OR_HISTORICAL_STATUSES,
  approvedLeaveKeys = new Set()
} = {}) {
  const sessionRows = normalizeSessionRows(sessions);
  const personMap = normalizeStudentToPersonMap(studentToPersonMap);
  const stateByKey = new Map();
  const personIds = new Set();
  const summariesByPeriodId = new Map();
  const statusSet = allowedStatuses instanceof Set ? allowedStatuses : new Set(allowedStatuses || []);

  (Array.isArray(periodRows) ? periodRows : [])
    .filter((period) => {
      if (activeOrgId && !idsEqual(period?.orgId, activeOrgId)) return false;
      return periodStatusAllowed(period, statusSet);
    })
    .sort((a, b) => {
      const aStart = normalizeDateOnly(a?.startDate);
      const bStart = normalizeDateOnly(b?.startDate);
      if (aStart !== bStart) return aStart.localeCompare(bStart);
      return String(a?.sequenceNo || '').localeCompare(String(b?.sequenceNo || ''));
    })
    .forEach((period) => {
      const personId = resolveStudentPersonId(period, personMap);
      if (!personId) return;
      personIds.add(personId);
      const periodId = toPublicId(period.id);
      const targetSessionCount = normalizeTargetSessionCount(period.targetSessionCount);
      let usedSlots = 0;
      let consumedCount = 0;
      let reservedCount = 0;
      let completionCandidate = null;

      sessionRows.forEach(({ session, sessionId, date }) => {
        if (!periodCoversSession(period, session, { honorCompletion: true })) return;
        const key = buildApplicabilityKey(personId, session, sessionId);
        const rosterRecord = getRosterRecord(session, personId);
        const attendance = rosterRecord
          ? attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(rosterRecord.attendance)
          : '';
        const hasApprovedLeave = approvedLeaveKeys.has(key);
        const notApplicable = hasApprovedLeave || attendance === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE;

        if (notApplicable) {
          const next = {
            expected: false,
            reason: hasApprovedLeave ? 'approved_leave' : 'manual_not_applicable',
            periodId,
            targetSessionCount,
            consumedCount,
            reservedCount
          };
          stateByKey.set(key, mergeState(stateByKey.get(key), next));
          return;
        }

        if (targetSessionCount && usedSlots >= targetSessionCount) {
          const next = {
            expected: false,
            reason: 'session_cap_reached',
            periodId,
            targetSessionCount,
            consumedCount,
            reservedCount
          };
          stateByKey.set(key, mergeState(stateByKey.get(key), next));
          return;
        }

        const hasCountedAttendance = rosterRecord && COUNTED_ATTENDANCE_STATUSES.has(attendance);
        const finalizedMissing = !rosterRecord && isSessionFinalizedForCounting(session);
        const counted = hasCountedAttendance || finalizedMissing;
        if (counted) {
          consumedCount += 1;
          completionCandidate = { sessionId, date };
        } else if (targetSessionCount) {
          reservedCount += 1;
        }
        usedSlots += 1;

        const next = {
          expected: true,
          reason: targetSessionCount ? 'session_count' : 'date_window',
          periodId,
          targetSessionCount,
          consumedCount,
          reservedCount
        };
        stateByKey.set(key, mergeState(stateByKey.get(key), next));
      });

      summariesByPeriodId.set(periodId, {
        periodId,
        personId,
        targetSessionCount,
        consumedCount,
        reservedCount,
        remainingCount: targetSessionCount ? Math.max(0, targetSessionCount - consumedCount) : null,
        completionCandidate: targetSessionCount && consumedCount >= targetSessionCount ? completionCandidate : null
      });
    });

  return { stateByKey, personIds, summariesByPeriodId };
}

async function buildApprovedLeaveKeySet({ sessions = [], personIds = [], orgId = '', reqUser } = {}) {
  const people = Array.from(personIds instanceof Set ? personIds : new Set(personIds || []))
    .map((id) => toPublicId(id))
    .filter(Boolean);
  const sessionRows = normalizeSessionRows(sessions);
  if (!people.length || !sessionRows.length) return new Set();
  const windows = [];
  people.forEach((personId) => {
    sessionRows.forEach(({ session, sessionId }) => {
      windows.push({
        sessionIndex: buildApplicabilityKey(personId, session, sessionId),
        personId,
        date: getSessionDate(session),
        startTime: session.startTime,
        endTime: session.endTime
      });
    });
  });
  const leaveRequestService = require('./leaveRequestService');
  const rows = await leaveRequestService.findApprovedLeaveConflicts({ orgId, reqUser, windows });
  return new Set((Array.isArray(rows) ? rows : [])
    .map((row) => cleanText(row?.sessionIndex))
    .filter(Boolean));
}

async function resolveRollingEnrollmentApplicabilityWithLeaves({
  sessions = [],
  periodRows = [],
  studentToPersonMap = new Map(),
  activeOrgId = '',
  orgId = '',
  reqUser,
  allowedStatuses = OPEN_OR_HISTORICAL_STATUSES
} = {}) {
  const personMap = normalizeStudentToPersonMap(studentToPersonMap);
  const candidatePersonIds = new Set();
  (Array.isArray(periodRows) ? periodRows : []).forEach((period) => {
    const personId = resolveStudentPersonId(period, personMap);
    if (personId) candidatePersonIds.add(personId);
  });
  const approvedLeaveKeys = await buildApprovedLeaveKeySet({
    sessions,
    personIds: candidatePersonIds,
    orgId: orgId || activeOrgId,
    reqUser
  });
  return resolveRollingEnrollmentApplicability({
    sessions,
    periodRows,
    studentToPersonMap: personMap,
    activeOrgId,
    allowedStatuses,
    approvedLeaveKeys
  });
}

function getApplicabilityState(stateByKey, personId, session = {}, fallback = '') {
  if (!(stateByKey instanceof Map)) return null;
  return stateByKey.get(buildApplicabilityKey(personId, session, fallback)) || null;
}

async function recomputeSessionCappedEnrollmentCompletionsForClass({
  classData,
  sessions = [],
  periodRows = null,
  students = null,
  reqUser,
  activeOrgId = ''
} = {}) {
  if (!classData || cleanText(classData.registrationMode).toLowerCase() !== 'rolling') return [];
  const schoolDataService = require('./schoolDataService');
  const orgId = activeOrgId || toPublicId(classData.orgId || reqUser?.activeOrgId);
  const [effectivePeriods, effectiveStudents] = await Promise.all([
    Array.isArray(periodRows)
      ? periodRows
      : schoolDataService.getClassEnrollmentPeriodsByClassId(classData.id, reqUser),
    Array.isArray(students)
      ? students
      : schoolDataService.fetchData('students', {}, reqUser)
  ]);
  const studentToPersonMap = normalizeStudentToPersonMap(effectiveStudents);
  const applicability = await resolveRollingEnrollmentApplicabilityWithLeaves({
    sessions,
    periodRows: effectivePeriods,
    studentToPersonMap,
    activeOrgId: orgId,
    orgId,
    reqUser,
    allowedStatuses: OPEN_STATUSES
  });
  const updates = [];
  for (const [periodId, summary] of applicability.summariesByPeriodId.entries()) {
    if (!summary.targetSessionCount || !summary.completionCandidate) continue;
    const period = (Array.isArray(effectivePeriods) ? effectivePeriods : []).find((row) => idsEqual(row?.id, periodId));
    if (!period || !OPEN_STATUSES.has(cleanText(period.status).toLowerCase())) continue;
    const patch = {
      status: 'completed',
      completionDate: summary.completionCandidate.date,
      completionSessionId: summary.completionCandidate.sessionId,
      completionReason: 'target_session_count_reached',
      updatedBy: toPublicId(reqUser?.id || reqUser?.username || '')
    };
    const updated = await schoolDataService.updateData('classEnrollmentPeriods', periodId, patch, reqUser);
    updates.push({ periodId, patch, updated });
  }
  return updates;
}

module.exports = {
  COUNTED_ATTENDANCE_STATUSES,
  OPEN_OR_HISTORICAL_STATUSES,
  OPEN_STATUSES,
  SESSION_COUNT_POLICY,
  normalizeDateOnly,
  normalizeTargetSessionCount,
  normalizeSessionCountPolicy,
  sanitizeSessionCapFields,
  getSessionId,
  buildApplicabilityKey,
  periodEffectiveEndDate,
  periodCoversSession,
  resolveRollingEnrollmentApplicability,
  resolveRollingEnrollmentApplicabilityWithLeaves,
  getApplicabilityState,
  recomputeSessionCappedEnrollmentCompletionsForClass
};
