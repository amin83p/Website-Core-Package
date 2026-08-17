const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
function getSessionStatusPolicyService() {
  return require('./sessionStatusPolicyService');
}
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const OPEN_OR_HISTORICAL_STATUSES = new Set(['active', 'planned', 'completed']);
const ROLLING_DISPLAY_PERIOD_STATUSES = new Set([
  'active',
  'planned',
  'completed',
  'withdrawn',
  'cancelled',
  'archived'
]);
const OPEN_STATUSES = new Set(['active', 'planned', 'to_be_confirmed']);
const COUNTED_ATTENDANCE_STATUSES = new Set([
  attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT,
  attendanceMatrixMetricsService.ATTENDANCE_STATUS.LATE,
  attendanceMatrixMetricsService.ATTENDANCE_STATUS.ABSENT,
  attendanceMatrixMetricsService.ATTENDANCE_STATUS.ACF
]);
const SESSION_COUNT_POLICY = 'all_non_na';
const TARGET_SESSION_COMPLETION_REASON = 'target_session_count_reached';
const TARGET_HOURS_COMPLETION_REASON = 'target_hours_reached';
const HOUR_STEP = 0.25;

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

function roundTargetHours(value) {
  const parsed = Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  const stepped = Math.round(parsed / HOUR_STEP) * HOUR_STEP;
  return Number(stepped.toFixed(2));
}

function normalizeTargetHours(value) {
  return roundTargetHours(value);
}

function normalizeSessionCountPolicy(value) {
  const token = cleanText(value).toLowerCase();
  return token || SESSION_COUNT_POLICY;
}

function computeDurationHoursFromTimes(startTime, endTime) {
  const start = cleanText(startTime);
  const end = cleanText(endTime);
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if (![sh, sm, eh, em].every((n) => Number.isFinite(n))) return 0;
  const hours = (eh + em / 60) - (sh + sm / 60);
  return hours > 0 ? Number(hours.toFixed(2)) : 0;
}

function resolveSessionDurationHours(session = {}) {
  const stored = Number(session?.durationHours);
  if (Number.isFinite(stored) && stored > 0) return Number(stored.toFixed(2));
  return computeDurationHoursFromTimes(session.startTime || session.start, session.endTime || session.end);
}

function sanitizeSessionCapFields(input = {}) {
  const targetSessionCount = normalizeTargetSessionCount(input.targetSessionCount);
  const targetHours = normalizeTargetHours(input.targetHours);
  if (targetSessionCount > 0 && targetHours > 0) {
    throw new Error('Set either a session target or an hour target, not both.');
  }
  return {
    targetSessionCount,
    targetHours,
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

function periodStatusAllowed(period = {}, allowedStatuses = OPEN_OR_HISTORICAL_STATUSES) {
  const status = cleanText(period.status).toLowerCase();
  const statusSet = allowedStatuses instanceof Set
    ? allowedStatuses
    : new Set(Array.isArray(allowedStatuses) ? allowedStatuses : []);
  return statusSet.has(status);
}

function hasTargetSessionCount(period = {}) {
  return normalizeTargetSessionCount(period.targetSessionCount) > 0;
}

function hasTargetHours(period = {}) {
  return normalizeTargetHours(period.targetHours) > 0;
}

function hasEnrollmentCap(period = {}) {
  return hasTargetSessionCount(period) || hasTargetHours(period);
}

function isAutomaticallyCompletedTargetPeriod(period = {}) {
  const reason = cleanText(period.completionReason);
  return hasEnrollmentCap(period)
    && cleanText(period.status).toLowerCase() === 'completed'
    && (reason === TARGET_SESSION_COMPLETION_REASON || reason === TARGET_HOURS_COMPLETION_REASON);
}

function periodEffectiveEndDate(period = {}) {
  const targetSessionEnrollment = hasEnrollmentCap(period);
  const endDate = normalizeDateOnly(period.endDate) || '9999-12-31';
  const completionDate = normalizeDateOnly(period.completionDate);
  const status = cleanText(period.status).toLowerCase();

  // A target-session enrollment runs from its start date until the target is
  // reached. A manually entered end date remains informational until the
  // target is removed.
  if (targetSessionEnrollment) {
    if (completionDate) return completionDate;
    if (OPEN_STATUSES.has(status)) return '9999-12-31';
  }

  if (!completionDate) return endDate;
  return completionDate < endDate ? completionDate : endDate;
}

function periodCoversSession(period = {}, session = {}, options = {}) {
  const date = getSessionDate(session);
  const start = normalizeDateOnly(period.startDate);
  const ignoreAutomaticTargetCompletion = options.ignoreAutomaticTargetCompletion === true
    && isAutomaticallyCompletedTargetPeriod(period);
  const end = ignoreAutomaticTargetCompletion
    ? '9999-12-31'
    : (options.honorCompletion === false
      ? (hasEnrollmentCap(period) ? '9999-12-31' : (normalizeDateOnly(period.endDate) || '9999-12-31'))
      : periodEffectiveEndDate(period));
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

/**
 * Resolves whether a person is inside at least one rolling-enrollment window
 * for a particular session. This is intentionally independent of attendance,
 * leave, and session-cap state: it protects the enrollment date boundary.
 */
function resolveRollingEnrollmentWindowForPerson({
  periodRows = [],
  studentToPersonMap = new Map(),
  personId = '',
  session = {},
  activeOrgId = '',
  allowedStatuses = OPEN_OR_HISTORICAL_STATUSES
} = {}) {
  const targetPersonId = toPublicId(personId);
  const sessionDate = getSessionDate(session);
  const personMap = normalizeStudentToPersonMap(studentToPersonMap);
  const statusSet = allowedStatuses instanceof Set
    ? allowedStatuses
    : new Set(Array.isArray(allowedStatuses) ? allowedStatuses : []);

  if (!targetPersonId || !sessionDate) {
    return {
      withinEnrollmentWindow: false,
      reason: sessionDate ? 'student_not_enrolled' : 'session_date_missing',
      periodId: ''
    };
  }

  const matchingPeriod = (Array.isArray(periodRows) ? periodRows : [])
    .filter((period) => {
      if (activeOrgId && !idsEqual(period?.orgId, activeOrgId)) return false;
      if (!periodStatusAllowed(period, statusSet)) return false;
      return idsEqual(resolveStudentPersonId(period, personMap), targetPersonId);
    })
    .find((period) => periodCoversSession(period, session, { honorCompletion: true }));

  if (!matchingPeriod) {
    return {
      withinEnrollmentWindow: false,
      reason: 'student_not_enrolled',
      periodId: ''
    };
  }

  return {
    withinEnrollmentWindow: true,
    reason: '',
    periodId: toPublicId(matchingPeriod.id)
  };
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
  approvedLeaveKeys = new Set(),
  forceNotApplicableSessionKeys = new Set(),
  ignoreAutomaticTargetCompletion = false
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
      const targetHours = normalizeTargetHours(period.targetHours);
      const hourCap = targetHours > 0;
      const sessionCap = targetSessionCount > 0;
      let consumedCount = 0;
      let consumedHours = 0;
      let reservedCount = 0;
      let reservedHours = 0;
      let completionCandidate = null;

      sessionRows.forEach(({ session, sessionId, date }) => {
        if (!periodCoversSession(period, session, {
          honorCompletion: true,
          ignoreAutomaticTargetCompletion
        })) return;
        const key = buildApplicabilityKey(personId, session, sessionId);
        const sessionHours = resolveSessionDurationHours(session);
        const rosterRecord = getRosterRecord(session, personId);
        const attendance = rosterRecord
          ? attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(rosterRecord.attendance, '')
          : '';
        const hasApprovedLeave = approvedLeaveKeys.has(key);
        const forceNotApplicable = forceNotApplicableSessionKeys.has(sessionId) || forceNotApplicableSessionKeys.has(date);
        const notApplicable = forceNotApplicable || hasApprovedLeave || attendance === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE;

        if (notApplicable) {
          const next = {
            expected: false,
            reason: forceNotApplicable ? 'makeup_required' : (hasApprovedLeave ? 'approved_leave' : 'manual_not_applicable'),
            periodId,
            targetSessionCount,
            targetHours,
            consumedCount,
            consumedHours,
            reservedCount,
            reservedHours
          };
          stateByKey.set(key, mergeState(stateByKey.get(key), next));
          return;
        }

        if (hourCap && consumedHours >= targetHours) {
          const next = {
            expected: false,
            reason: 'hour_cap_reached',
            periodId,
            targetSessionCount,
            targetHours,
            consumedCount,
            consumedHours,
            reservedCount,
            reservedHours
          };
          stateByKey.set(key, mergeState(stateByKey.get(key), next));
          return;
        }

        if (sessionCap && consumedCount >= targetSessionCount) {
          const next = {
            expected: false,
            reason: 'session_cap_reached',
            periodId,
            targetSessionCount,
            targetHours,
            consumedCount,
            consumedHours,
            reservedCount,
            reservedHours
          };
          stateByKey.set(key, mergeState(stateByKey.get(key), next));
          return;
        }

        const counted = rosterRecord && COUNTED_ATTENDANCE_STATUSES.has(attendance);
        if (counted) {
          consumedCount += 1;
          consumedHours = roundTargetHours(consumedHours + sessionHours);
          completionCandidate = { sessionId, date };
        } else if (hourCap || sessionCap) {
          reservedCount += 1;
          reservedHours = roundTargetHours(reservedHours + sessionHours);
        }
        const next = {
          expected: true,
          reason: hourCap ? 'hour_count' : (sessionCap ? 'session_count' : 'date_window'),
          periodId,
          targetSessionCount,
          targetHours,
          consumedCount,
          consumedHours,
          reservedCount,
          reservedHours
        };
        stateByKey.set(key, mergeState(stateByKey.get(key), next));
      });

      const hourTargetReached = hourCap && consumedHours >= targetHours;
      const sessionTargetReached = sessionCap && consumedCount >= targetSessionCount;
      summariesByPeriodId.set(periodId, {
        periodId,
        personId,
        targetSessionCount,
        targetHours,
        consumedCount,
        consumedHours,
        reservedCount,
        reservedHours,
        remainingCount: sessionCap ? Math.max(0, targetSessionCount - consumedCount) : null,
        remainingHours: hourCap ? Math.max(0, roundTargetHours(targetHours - consumedHours)) : null,
        lastConsumedSession: consumedCount > 0 ? completionCandidate : null,
        completionCandidate: (sessionTargetReached || hourTargetReached) ? completionCandidate : null
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
  allowedStatuses = OPEN_OR_HISTORICAL_STATUSES,
  forceNotApplicableSessionKeys = new Set(),
  ignoreAutomaticTargetCompletion = false
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
    approvedLeaveKeys,
    forceNotApplicableSessionKeys,
    ignoreAutomaticTargetCompletion
  });
}

function getApplicabilityState(stateByKey, personId, session = {}, fallback = '') {
  if (!(stateByKey instanceof Map)) return null;
  return stateByKey.get(buildApplicabilityKey(personId, session, fallback)) || null;
}

function buildSessionCappedEnrollmentCompletionPatch(period = {}, summary = {}, updatedBy = '') {
  const targetSessionCount = normalizeTargetSessionCount(period.targetSessionCount);
  const targetHours = normalizeTargetHours(period.targetHours);
  if (!targetSessionCount && !targetHours) return null;

  const status = cleanText(period.status).toLowerCase();
  const isOpen = OPEN_STATUSES.has(status);
  const isAutoCompleted = isAutomaticallyCompletedTargetPeriod(period);
  if (!isOpen && !isAutoCompleted) return null;

  const completion = summary?.completionCandidate || null;
  const completionReason = targetHours > 0
    ? TARGET_HOURS_COMPLETION_REASON
    : TARGET_SESSION_COMPLETION_REASON;
  if (!completion && isAutoCompleted) {
    return {
      status: 'active',
      completionDate: '',
      completionSessionId: '',
      completionReason: '',
      updatedBy
    };
  }
  if (!completion) return null;

  const currentDate = normalizeDateOnly(period.completionDate);
  const currentSessionId = toPublicId(period.completionSessionId);
  const nextSessionId = toPublicId(completion.sessionId);
  if (isAutoCompleted
    && currentDate === completion.date
    && currentSessionId === nextSessionId) {
    return null;
  }
  return {
    status: 'completed',
    completionDate: completion.date,
    completionSessionId: nextSessionId,
    completionReason,
    updatedBy
  };
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
      : schoolDataService.fetchAllData('students', {}, reqUser)
  ]);
  const studentToPersonMap = normalizeStudentToPersonMap(effectiveStudents);
  const sessionStatusPolicyService = getSessionStatusPolicyService();
  const statusMap = await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
  const reconcilablePeriods = (Array.isArray(effectivePeriods) ? effectivePeriods : [])
    .filter((period) => OPEN_STATUSES.has(cleanText(period.status).toLowerCase())
      || isAutomaticallyCompletedTargetPeriod(period)
      || hasEnrollmentCap(period));
  const applicability = await resolveRollingEnrollmentApplicabilityWithLeaves({
    sessions,
    periodRows: reconcilablePeriods,
    studentToPersonMap,
    activeOrgId: orgId,
    orgId,
    reqUser,
    allowedStatuses: new Set([...OPEN_STATUSES, 'completed']),
    forceNotApplicableSessionKeys: sessionStatusPolicyService.buildForceNotApplicableAttendanceSessionKeys(statusMap, sessions),
    ignoreAutomaticTargetCompletion: true
  });
  const updates = [];
  for (const [periodId, summary] of applicability.summariesByPeriodId.entries()) {
    const period = reconcilablePeriods.find((row) => idsEqual(row?.id, periodId));
    const patch = buildSessionCappedEnrollmentCompletionPatch(
      period,
      summary,
      toPublicId(reqUser?.id || reqUser?.username || '')
    );
    if (!patch) continue;
    const updated = await schoolDataService.updateData('classEnrollmentPeriods', periodId, patch, reqUser);
    updates.push({ periodId, patch, updated });
  }
  return updates;
}

module.exports = {
  COUNTED_ATTENDANCE_STATUSES,
  OPEN_OR_HISTORICAL_STATUSES,
  ROLLING_DISPLAY_PERIOD_STATUSES,
  OPEN_STATUSES,
  SESSION_COUNT_POLICY,
  TARGET_SESSION_COMPLETION_REASON,
  TARGET_HOURS_COMPLETION_REASON,
  HOUR_STEP,
  normalizeDateOnly,
  normalizeTargetSessionCount,
  normalizeTargetHours,
  roundTargetHours,
  normalizeSessionCountPolicy,
  sanitizeSessionCapFields,
  resolveSessionDurationHours,
  computeDurationHoursFromTimes,
  hasTargetSessionCount,
  hasTargetHours,
  hasEnrollmentCap,
  getSessionId,
  buildApplicabilityKey,
  periodEffectiveEndDate,
  periodCoversSession,
  isAutomaticallyCompletedTargetPeriod,
  resolveRollingEnrollmentWindowForPerson,
  resolveRollingEnrollmentApplicability,
  resolveRollingEnrollmentApplicabilityWithLeaves,
  getApplicabilityState,
  buildSessionCappedEnrollmentCompletionPatch,
  recomputeSessionCappedEnrollmentCompletionsForClass
};
