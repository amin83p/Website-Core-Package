/**
 * Time-based attendance credit for the Attendance Matrix date window.
 * Each session contributes up to (100 / N)% where N = sessions in the window.
 *
 * Per-session length: from session startTime/endTime, else durationHours, else policy scheduledMinutes.
 *
 * Rules (Option A + optional combined cap):
 * - absent / acf (Absent Camera Off) → 0 credit
 * - excused → full session weight
 * - N/A / not_applicable -> excluded from the denominator
 * - present / late → proportional credit = weight × attendedMinutes / scheduledMinutes
 *   attendedMinutes = max(0, scheduled - late - early)
 * - Hard zero if late >= disqualifyLateMinutes OR early >= disqualifyEarlyMinutes
 * - Optional: late + early >= disqualifyCombinedMissedMinutes → 0
 */

const ATTENDANCE_STATUS = Object.freeze({
  PRESENT: 'present',
  LATE: 'late',
  EXCUSED: 'excused',
  ABSENT: 'absent',
  ACF: 'acf',
  NOT_APPLICABLE: 'not_applicable'
});

const ATTENDANCE_STATUS_ALIASES = Object.freeze({
  present: ATTENDANCE_STATUS.PRESENT,
  late: ATTENDANCE_STATUS.LATE,
  excused: ATTENDANCE_STATUS.EXCUSED,
  absent: ATTENDANCE_STATUS.ABSENT,
  acf: ATTENDANCE_STATUS.ACF,
  absent_camera_off: ATTENDANCE_STATUS.ACF,
  na: ATTENDANCE_STATUS.NOT_APPLICABLE,
  'n/a': ATTENDANCE_STATUS.NOT_APPLICABLE,
  n_a: ATTENDANCE_STATUS.NOT_APPLICABLE,
  not_applicable: ATTENDANCE_STATUS.NOT_APPLICABLE,
  notapplicable: ATTENDANCE_STATUS.NOT_APPLICABLE
});

function normalizeStatus(status, fallback = '') {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw) return fallback;
  const compact = raw.replace(/\s+/g, '_');
  return ATTENDANCE_STATUS_ALIASES[compact] || fallback || compact;
}

function isNotApplicableStatus(status) {
  return normalizeStatus(status) === ATTENDANCE_STATUS.NOT_APPLICABLE;
}

function isAbsentLikeStatus(status) {
  const st = normalizeStatus(status);
  return st === ATTENDANCE_STATUS.ABSENT || st === ATTENDANCE_STATUS.ACF;
}

function isEligibleAttendanceStatus(status) {
  return !isNotApplicableStatus(status);
}

function normalizeAttendanceStatusForSave(status, fallback = ATTENDANCE_STATUS.ABSENT) {
  const normalized = normalizeStatus(status, fallback);
  return Object.values(ATTENDANCE_STATUS).includes(normalized) ? normalized : fallback;
}

const MINUTES_PER_DAY = 24 * 60;

/**
 * Parse "HH:mm" or "H:mm" (optional seconds) to minutes from midnight.
 * @returns {number|null}
 */
function parseTimeToMinutes(t) {
  const s = String(t || '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || min < 0 || min > 59 || h < 0 || h > 23) {
    return null;
  }
  return h * 60 + min;
}

/**
 * Session length in minutes from embedded class session row.
 * @param {object} session — e.g. { startTime, endTime, durationHours }
 * @param {number} fallbackMinutes — policy default when times are missing/invalid
 */
function scheduledMinutesFromSession(session, fallbackMinutes) {
  const fb =
    Number.isFinite(Number(fallbackMinutes)) && Number(fallbackMinutes) > 0
      ? Number(fallbackMinutes)
      : 180;
  const start = parseTimeToMinutes(session?.startTime);
  const end = parseTimeToMinutes(session?.endTime);
  if (start != null && end != null) {
    let diff = end - start;
    if (diff < 0) diff += MINUTES_PER_DAY;
    if (diff > 0 && diff <= MINUTES_PER_DAY) return diff;
  }
  const dh = Number(session?.durationHours);
  if (Number.isFinite(dh) && dh > 0) {
    const m = Math.round(dh * 60);
    if (m > 0) return m;
  }
  return fb;
}

/**
 * Merge: org-wide defaults (from settings JSON) then class.attendancePolicy (class wins per field).
 * @param {object} classData — may include attendancePolicy
 * @param {object} [orgPolicyLayer] — saved org thresholds; omit or {} for none
 */
function parseNonNegIntRoster(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * Enforce Manage Session / roster rules aligned with the attendance matrix policy:
 * 1) Late minutes ≥ disqualifyLate, early ≥ disqualifyEarly, or combined missed ≥ combined threshold → absent.
 * 2) Otherwise, any late/early minutes with status present or excused → late.
 *
 * @param {object} record — roster row: attendance, lateMinutes, earlyLeaveMinutes, etc.
 * @param {ReturnType<typeof resolvePolicy>} policy
 * @returns {object} record with normalized minutes and possibly updated attendance
 */
function applyAttendanceMatrixRosterRules(record, policy) {
  const pol = policy && typeof policy === 'object' ? policy : resolvePolicy({}, {});
  const base = record && typeof record === 'object' ? { ...record } : {};

  const attendance = normalizeAttendanceStatusForSave(base.attendance, ATTENDANCE_STATUS.ABSENT);

  const late = parseNonNegIntRoster(base.lateMinutes);
  const early = parseNonNegIntRoster(base.earlyLeaveMinutes);

  if (attendance === ATTENDANCE_STATUS.NOT_APPLICABLE) {
    return { ...base, attendance, lateMinutes: 0, earlyLeaveMinutes: 0 };
  }

  const lateCut = pol.disqualifyLateMinutes;
  const earlyCut = pol.disqualifyEarlyLeaveMinutes;
  const combRaw = pol.disqualifyCombinedMissedMinutes;

  if (late >= lateCut || early >= earlyCut) {
    return { ...base, attendance: 'absent', lateMinutes: late, earlyLeaveMinutes: early };
  }
  const comb = combRaw === null || combRaw === undefined || combRaw === ''
    ? null
    : Number(combRaw);
  if (comb != null && Number.isFinite(comb) && late + early >= comb) {
    return { ...base, attendance: 'absent', lateMinutes: late, earlyLeaveMinutes: early };
  }

  let next = attendance;
  if ((late > 0 || early > 0) && (next === 'present' || next === 'excused')) {
    next = 'late';
  }

  return { ...base, attendance: next, lateMinutes: late, earlyLeaveMinutes: early };
}

function resolvePolicy(classData = {}, orgPolicyLayer = {}) {
  const org =
    orgPolicyLayer && typeof orgPolicyLayer === 'object' ? orgPolicyLayer : {};
  const cls =
    classData.attendancePolicy && typeof classData.attendancePolicy === 'object'
      ? classData.attendancePolicy
      : {};
  const ap = { ...org, ...cls };
  const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const scheduled = num(ap.scheduledMinutes, 180);
  const disqualifyLate = num(ap.disqualifyLateMinutes, 30);
  const disqualifyEarly = num(ap.disqualifyEarlyLeaveMinutes, 30);
  let combined = ap.disqualifyCombinedMissedMinutes;
  if (combined === '' || combined === undefined || combined === null) {
    combined = null;
  } else {
    combined = Number(combined);
    if (!Number.isFinite(combined)) combined = null;
  }
  return {
    scheduledMinutes: scheduled > 0 ? scheduled : 180,
    disqualifyLateMinutes: disqualifyLate >= 0 ? disqualifyLate : 30,
    disqualifyEarlyLeaveMinutes: disqualifyEarly >= 0 ? disqualifyEarly : 30,
    disqualifyCombinedMissedMinutes: combined
  };
}

/**
 * @param {{ status: string, lateMinutes?: number, earlyLeaveMinutes?: number, scheduledMinutes?: number }} record
 * @param {number} sessionWeight — max credit for this session (e.g. 100/N)
 * @param {ReturnType<typeof resolvePolicy>} policy
 */
function computeSessionCredit(record, sessionWeight, policy) {
  const recSched = Number(record?.scheduledMinutes);
  const sched =
    Number.isFinite(recSched) && recSched > 0 ? recSched : policy.scheduledMinutes;
  const late = Math.max(0, Number(record?.lateMinutes) || 0);
  const early = Math.max(0, Number(record?.earlyLeaveMinutes) || 0);
  const st = normalizeStatus(record?.status);

  if (st === ATTENDANCE_STATUS.NOT_APPLICABLE) {
    return { credit: 0, disqualified: false, exempt: true, reason: 'not_applicable' };
  }
  if (st === '') {
    return { credit: 0, disqualified: false, exempt: false, reason: 'no_record' };
  }
  if (st === ATTENDANCE_STATUS.ABSENT) {
    return { credit: 0, disqualified: false, reason: 'absent' };
  }
  if (st === ATTENDANCE_STATUS.ACF) {
    return { credit: 0, disqualified: false, reason: 'acf' };
  }
  if (st === ATTENDANCE_STATUS.EXCUSED) {
    return { credit: sessionWeight, disqualified: false, reason: 'excused_full' };
  }
  if (st !== ATTENDANCE_STATUS.PRESENT && st !== ATTENDANCE_STATUS.LATE) {
    return { credit: 0, disqualified: false, reason: 'unknown_status' };
  }

  if (late >= policy.disqualifyLateMinutes) {
    return { credit: 0, disqualified: true, reason: 'late_cutoff' };
  }
  if (early >= policy.disqualifyEarlyLeaveMinutes) {
    return { credit: 0, disqualified: true, reason: 'early_leave_cutoff' };
  }
  const comb = policy.disqualifyCombinedMissedMinutes;
  if (comb != null && late + early >= comb) {
    return { credit: 0, disqualified: true, reason: 'combined_cutoff' };
  }

  const attended = Math.max(0, sched - late - early);
  const credit = sessionWeight * (attended / sched);
  return { credit, disqualified: false, reason: 'proportional' };
}

/**
 * @param {Array<{ status: string, lateMinutes?: number, earlyLeaveMinutes?: number, scheduledMinutes?: number }>} records — one per session column
 * @param {object} classData — optional attendancePolicy
 */
function computeStudentMatrixSummary(records, classData = {}, orgPolicyLayer = {}) {
  const policy = resolvePolicy(classData, orgPolicyLayer);
  const allRecords = Array.isArray(records) ? records : [];
  const eligibleRecords = allRecords.filter((rec) => isEligibleAttendanceStatus(rec?.status));
  const n = eligibleRecords.length;
  const notApplicableSessionCount = allRecords.length - n;
  if (!n) {
    return {
      totalPresentSessions: 0,
      totalAbsentSessions: 0,
      totalEligibleSessions: 0,
      totalNotApplicableSessions: notApplicableSessionCount,
      disqualifiedSessionCount: 0,
      performancePercent: null,
      performancePercentRaw: null
    };
  }

  const sessionWeight = 100 / n;
  let sumCredit = 0;
  let disqualifiedSessionCount = 0;
  let totalPresentSessions = 0;
  let totalAbsentSessions = 0;

  for (const rec of eligibleRecords) {
    const st = normalizeStatus(rec?.status);
    if (st === ATTENDANCE_STATUS.PRESENT || st === ATTENDANCE_STATUS.LATE) totalPresentSessions += 1;
    if (isAbsentLikeStatus(st)) totalAbsentSessions += 1;

    const { credit, disqualified } = computeSessionCredit(rec, sessionWeight, policy);
    sumCredit += credit;
    if (disqualified) disqualifiedSessionCount += 1;
  }

  const performancePercentRaw = sumCredit;
  const performancePercent = Math.round(performancePercentRaw * 100) / 100;

  return {
    totalPresentSessions,
    totalAbsentSessions,
    totalEligibleSessions: n,
    totalNotApplicableSessions: notApplicableSessionCount,
    disqualifiedSessionCount,
    performancePercent,
    performancePercentRaw
  };
}

module.exports = {
  ATTENDANCE_STATUS,
  normalizeStatus,
  isNotApplicableStatus,
  isAbsentLikeStatus,
  isEligibleAttendanceStatus,
  normalizeAttendanceStatusForSave,
  resolvePolicy,
  parseTimeToMinutes,
  scheduledMinutesFromSession,
  computeSessionCredit,
  computeStudentMatrixSummary,
  applyAttendanceMatrixRosterRules,
  parseNonNegIntRoster
};
