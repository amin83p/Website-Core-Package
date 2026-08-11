/**
 * Time-based attendance credit for the Attendance Matrix date window.
 * Each session contributes up to (100 / N)% where N = eligible sessions in the window.
 *
 * Per-session length: from session startTime/endTime, else durationHours, else policy scheduledMinutes.
 *
 * Attendance percentage (always time-weighted, regardless of status label):
 * - excused → full session weight
 * - N/A / not_applicable → excluded from the denominator
 * - unmarked → excluded from the denominator
 * - present / late / absent / acf → credit = weight × presenceRatio
 *   presenceRatio = max(0, scheduled - late - early) / scheduled
 *   absent / acf with no late/early minutes → presenceRatio = 0
 *
 * Threshold cutoffs (when enabled) may change stored status on roster save only;
 * they do not zero out or override percentage credit.
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

/** Always available on every class; cannot be disabled. */
const MANDATORY_ATTENDANCE_STATUSES = Object.freeze([
  ATTENDANCE_STATUS.PRESENT,
  ATTENDANCE_STATUS.ABSENT,
  ATTENDANCE_STATUS.NOT_APPLICABLE
]);

/** Optional per-class toggles (mandatory statuses are never in this list). */
const OPTIONAL_ATTENDANCE_STATUSES = Object.freeze([
  ATTENDANCE_STATUS.LATE,
  ATTENDANCE_STATUS.EXCUSED,
  ATTENDANCE_STATUS.ACF
]);

/** Stable display order for all known statuses. */
const ALL_ATTENDANCE_STATUSES_ORDERED = Object.freeze([
  ATTENDANCE_STATUS.PRESENT,
  ATTENDANCE_STATUS.LATE,
  ATTENDANCE_STATUS.EXCUSED,
  ATTENDANCE_STATUS.ABSENT,
  ATTENDANCE_STATUS.ACF,
  ATTENDANCE_STATUS.NOT_APPLICABLE
]);

const ATTENDANCE_STATUS_META = Object.freeze({
  [ATTENDANCE_STATUS.PRESENT]: { code: ATTENDANCE_STATUS.PRESENT, label: 'Present', shortLabel: 'Present' },
  [ATTENDANCE_STATUS.LATE]: { code: ATTENDANCE_STATUS.LATE, label: 'Late', shortLabel: 'Late' },
  [ATTENDANCE_STATUS.EXCUSED]: { code: ATTENDANCE_STATUS.EXCUSED, label: 'Excused', shortLabel: 'Excused' },
  [ATTENDANCE_STATUS.ABSENT]: { code: ATTENDANCE_STATUS.ABSENT, label: 'Absent', shortLabel: 'Absent' },
  [ATTENDANCE_STATUS.ACF]: { code: ATTENDANCE_STATUS.ACF, label: 'Absent Camera Off', shortLabel: 'ACF' },
  [ATTENDANCE_STATUS.NOT_APPLICABLE]: { code: ATTENDANCE_STATUS.NOT_APPLICABLE, label: 'Not Applicable', shortLabel: 'N/A' }
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

function isUnmarkedAttendanceStatus(status) {
  return !normalizeStatus(status);
}

function isAbsentLikeStatus(status) {
  const st = normalizeStatus(status);
  return st === ATTENDANCE_STATUS.ABSENT || st === ATTENDANCE_STATUS.ACF;
}

/** Counted toward attendance % — excludes N/A and unmarked (not yet decided). */
function isEligibleAttendanceStatus(status) {
  return !isNotApplicableStatus(status) && !isUnmarkedAttendanceStatus(status);
}

function normalizeAttendanceStatusForSave(status, fallback = ATTENDANCE_STATUS.ABSENT) {
  const normalized = normalizeStatus(status, fallback);
  return Object.values(ATTENDANCE_STATUS).includes(normalized) ? normalized : fallback;
}

/**
 * Normalize a raw enabled-status list from form/API/storage.
 * Always includes Present and Absent; drops unknowns; stable order.
 * Empty/invalid input → all statuses enabled.
 * @param {unknown} input
 * @returns {string[]}
 */
function normalizeEnabledAttendanceStatuses(input) {
  const known = new Set(ALL_ATTENDANCE_STATUSES_ORDERED);
  let rawList = [];
  if (Array.isArray(input)) {
    rawList = input;
  } else if (typeof input === 'string' && input.trim()) {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) rawList = parsed;
      else rawList = input.split(/[,|]/);
    } catch (_) {
      rawList = input.split(/[,|]/);
    }
  } else if (input && typeof input === 'object') {
    // Checkbox map: { late: true, excused: false, ... }
    rawList = Object.keys(input).filter((key) => {
      const v = input[key];
      return v === true || v === 1 || String(v).trim().toLowerCase() === 'true' || String(v).trim() === '1';
    });
  }

  const selected = new Set();
  for (const item of rawList) {
    const st = normalizeAttendanceStatusForSave(item, '');
    if (st && known.has(st)) selected.add(st);
  }

  if (!selected.size) {
    return [...ALL_ATTENDANCE_STATUSES_ORDERED];
  }

  for (const mandatory of MANDATORY_ATTENDANCE_STATUSES) {
    selected.add(mandatory);
  }

  return ALL_ATTENDANCE_STATUSES_ORDERED.filter((st) => selected.has(st));
}

/**
 * Resolve enabled attendance statuses for a class.
 * Missing/empty field → all statuses (backward compatible).
 * @param {object} [classData]
 * @returns {string[]}
 */
function resolveEnabledAttendanceStatuses(classData = {}) {
  const raw = classData && typeof classData === 'object'
    ? classData.enabledAttendanceStatuses
    : undefined;
  if (raw == null || (Array.isArray(raw) && raw.length === 0)) {
    return [...ALL_ATTENDANCE_STATUSES_ORDERED];
  }
  return normalizeEnabledAttendanceStatuses(raw);
}

/**
 * @param {object} classData
 * @param {string} status
 * @returns {boolean}
 */
function isAttendanceStatusEnabled(classData, status) {
  const st = normalizeAttendanceStatusForSave(status, '');
  if (!st) return false;
  return resolveEnabledAttendanceStatuses(classData).includes(st);
}

/**
 * Validate a status for manual roster save against the class enabled list.
 * System-forced N/A (leave / session-status) may pass when allowSystemNotApplicable is true.
 * Preserving an already-stored disabled status is allowed when previousStatus matches.
 * @param {{ status: unknown, enabledStatuses?: string[], classData?: object, allowSystemNotApplicable?: boolean, previousStatus?: unknown }} opts
 * @returns {string} normalized status
 * @throws {Error} when status is not allowed
 */
function assertAttendanceStatusAllowedForSave(opts = {}) {
  const enabled = Array.isArray(opts.enabledStatuses) && opts.enabledStatuses.length
    ? normalizeEnabledAttendanceStatuses(opts.enabledStatuses)
    : resolveEnabledAttendanceStatuses(opts.classData || {});
  const normalized = normalizeAttendanceStatusForSave(opts.status, '');
  // Empty = unmarked (white / not marked yet); allowed so Manage Session can reset.
  if (!normalized) {
    return '';
  }
  if (enabled.includes(normalized)) {
    return normalized;
  }
  if (
    opts.allowSystemNotApplicable === true
    && normalized === ATTENDANCE_STATUS.NOT_APPLICABLE
  ) {
    return normalized;
  }
  const previous = normalizeAttendanceStatusForSave(opts.previousStatus, '');
  if (previous && previous === normalized) {
    return normalized;
  }
  const meta = ATTENDANCE_STATUS_META[normalized];
  const label = meta?.shortLabel || meta?.label || normalized;
  throw new Error(`Attendance status "${label}" is not enabled for this class.`);
}

/**
 * After matrix roster rules may change status (e.g. present+lateMinutes → late),
 * coerce any newly disabled status to Absent (Present/Absent always allowed).
 * @param {string} status
 * @param {string[]} enabledStatuses
 * @returns {string}
 */
function coerceAttendanceStatusToEnabled(status, enabledStatuses) {
  const enabled = normalizeEnabledAttendanceStatuses(enabledStatuses);
  const normalized = normalizeAttendanceStatusForSave(status, '');
  if (!normalized) return '';
  if (enabled.includes(normalized)) return normalized;
  if (normalized === ATTENDANCE_STATUS.NOT_APPLICABLE) {
    // System N/A may exist even when toggle is off; keep it.
    return normalized;
  }
  return ATTENDANCE_STATUS.ABSENT;
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

function normalizeAttendanceTimingExcuseFlag(value) {
  if (value === true || value === 1) return true;
  const token = String(value ?? '').trim().toLowerCase();
  return token === 'true' || token === '1' || token === 'yes' || token === 'on';
}

function normalizeAttendanceTimingFields(record = {}) {
  const lateMinutes = parseNonNegIntRoster(record?.lateMinutes);
  const earlyLeaveMinutes = parseNonNegIntRoster(record?.earlyLeaveMinutes);
  return {
    lateMinutes,
    earlyLeaveMinutes,
    lateExcused: lateMinutes > 0 && normalizeAttendanceTimingExcuseFlag(record?.lateExcused),
    earlyLeaveExcused: earlyLeaveMinutes > 0 && normalizeAttendanceTimingExcuseFlag(record?.earlyLeaveExcused)
  };
}

function attendanceTimingPenaltyMinutes(record = {}) {
  const timing = normalizeAttendanceTimingFields(record);
  return {
    latePenaltyMinutes: timing.lateExcused ? 0 : timing.lateMinutes,
    earlyLeavePenaltyMinutes: timing.earlyLeaveExcused ? 0 : timing.earlyLeaveMinutes
  };
}

function policyThresholdsAreEnabled(policy) {
  const value = policy?.thresholdsEnabled;
  if (value === false || value === 0) return false;
  return !['false', '0', 'off', 'no'].includes(String(value ?? 'true').trim().toLowerCase());
}

/**
 * Resolve the status users and downstream calculations should see without mutating storage.
 * With thresholds disabled, a recorded late/early duration proves attendance even when a
 * legacy threshold previously persisted the row as Absent.
 */
function resolveEffectiveAttendanceStatus(record, policy, enabledStatuses = null) {
  const rawStatus = record?.status !== undefined ? record.status : record?.attendance;
  const status = normalizeStatus(rawStatus);
  if (policyThresholdsAreEnabled(policy)) return status;

  if (
    !status
    || status === ATTENDANCE_STATUS.NOT_APPLICABLE
    || status === ATTENDANCE_STATUS.ACF
    || status === ATTENDANCE_STATUS.EXCUSED
  ) {
    return status;
  }

  const { lateMinutes: late, earlyLeaveMinutes: early } = normalizeAttendanceTimingFields(record);
  const hasTimingIssue = late > 0 || early > 0;
  if (!hasTimingIssue && status !== ATTENDANCE_STATUS.LATE) return status;

  const enabled = Array.isArray(enabledStatuses)
    ? normalizeEnabledAttendanceStatuses(enabledStatuses)
    : ALL_ATTENDANCE_STATUSES_ORDERED;
  return enabled.includes(ATTENDANCE_STATUS.LATE)
    ? ATTENDANCE_STATUS.LATE
    : ATTENDANCE_STATUS.PRESENT;
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
function applyAttendanceMatrixRosterRules(record, policy, enabledStatuses = null) {
  const pol = policy && typeof policy === 'object' ? policy : resolvePolicy({}, {});
  const base = record && typeof record === 'object' ? { ...record } : {};

  const attendance = normalizeAttendanceStatusForSave(base.attendance, '');

  const timing = normalizeAttendanceTimingFields(base);
  const late = timing.lateMinutes;
  const early = timing.earlyLeaveMinutes;
  const penalty = attendanceTimingPenaltyMinutes(timing);

  if (attendance === ATTENDANCE_STATUS.NOT_APPLICABLE) {
    return { ...base, attendance, lateMinutes: 0, earlyLeaveMinutes: 0, lateExcused: false, earlyLeaveExcused: false };
  }

  if (!policyThresholdsAreEnabled(pol)) {
    return {
      ...base,
      attendance: resolveEffectiveAttendanceStatus(
        { ...base, attendance, lateMinutes: late, earlyLeaveMinutes: early },
        pol,
        enabledStatuses
      ),
      lateMinutes: late,
      earlyLeaveMinutes: early,
      lateExcused: timing.lateExcused,
      earlyLeaveExcused: timing.earlyLeaveExcused
    };
  }

  const lateCut = pol.disqualifyLateMinutes;
  const earlyCut = pol.disqualifyEarlyLeaveMinutes;
  const combRaw = pol.disqualifyCombinedMissedMinutes;

  if (penalty.latePenaltyMinutes >= lateCut || penalty.earlyLeavePenaltyMinutes >= earlyCut) {
    return { ...base, attendance: 'absent', lateMinutes: late, earlyLeaveMinutes: early, lateExcused: timing.lateExcused, earlyLeaveExcused: timing.earlyLeaveExcused };
  }
  const comb = combRaw === null || combRaw === undefined || combRaw === ''
    ? null
    : Number(combRaw);
  if (comb != null && Number.isFinite(comb) && penalty.latePenaltyMinutes + penalty.earlyLeavePenaltyMinutes >= comb) {
    return { ...base, attendance: 'absent', lateMinutes: late, earlyLeaveMinutes: early, lateExcused: timing.lateExcused, earlyLeaveExcused: timing.earlyLeaveExcused };
  }

  // Unmarked (white): keep empty unless minutes forced absent above.
  if (!attendance) {
    return { ...base, attendance: '', lateMinutes: late, earlyLeaveMinutes: early, lateExcused: timing.lateExcused, earlyLeaveExcused: timing.earlyLeaveExcused };
  }

  let next = attendance;
  if ((late > 0 || early > 0) && (next === 'present' || next === 'excused')) {
    next = 'late';
  }

  return { ...base, attendance: next, lateMinutes: late, earlyLeaveMinutes: early, lateExcused: timing.lateExcused, earlyLeaveExcused: timing.earlyLeaveExcused };
}

function resolvePolicy(classData = {}, orgPolicyLayer = {}) {
  const org =
    orgPolicyLayer && typeof orgPolicyLayer === 'object' ? orgPolicyLayer : {};
  const cls =
    classData.attendancePolicy && typeof classData.attendancePolicy === 'object'
      ? classData.attendancePolicy
      : {};
  const ap = { ...org, ...cls };
  const thresholdsEnabled = policyThresholdsAreEnabled(org);
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
    thresholdsEnabled,
    scheduledMinutes: scheduled > 0 ? scheduled : 180,
    disqualifyLateMinutes: disqualifyLate >= 0 ? disqualifyLate : 30,
    disqualifyEarlyLeaveMinutes: disqualifyEarly >= 0 ? disqualifyEarly : 30,
    disqualifyCombinedMissedMinutes: combined
  };
}

/**
 * When orgPolicyLayer is a catalog `{ items: [...] }` (or a bare items array), pick the
 * exact scheduledMinutes item, else the default item, else {}.
 * Flat legacy layers are returned unchanged.
 */
function pickOrgPolicyLayerForMinutes(orgPolicyLayer, scheduledMinutes) {
  if (!orgPolicyLayer || typeof orgPolicyLayer !== 'object') return {};
  const items = Array.isArray(orgPolicyLayer.items)
    ? orgPolicyLayer.items
    : (Array.isArray(orgPolicyLayer) ? orgPolicyLayer : null);
  if (!items) return orgPolicyLayer;
  const thresholdsEnabled = policyThresholdsAreEnabled(orgPolicyLayer);
  if (!items.length) return { thresholdsEnabled };
  const mins = Number(scheduledMinutes);
  if (Number.isFinite(mins) && mins > 0) {
    const exact = items.find((item) => Number(item?.scheduledMinutes) === mins);
    if (exact) return { ...exact, thresholdsEnabled };
  }
  const def = items.find((item) => item && item.isDefault)
    || items.find((item) => Number(item?.scheduledMinutes) === 180)
    || items[0];
  return def && typeof def === 'object'
    ? { ...def, thresholdsEnabled }
    : { thresholdsEnabled };
}

function resolvePolicyForScheduledMinutes(classData, orgPolicyLayer, scheduledMinutes) {
  return resolvePolicy(classData, pickOrgPolicyLayerForMinutes(orgPolicyLayer, scheduledMinutes));
}

function scheduledMinutesForRecord(record, policy) {
  const recSched = Number(record?.scheduledMinutes);
  return Number.isFinite(recSched) && recSched > 0 ? recSched : policy.scheduledMinutes;
}

/**
 * Fraction of scheduled session time the student was present (0..1).
 * @param {{ status?: string, attendance?: string, lateMinutes?: number, earlyLeaveMinutes?: number, scheduledMinutes?: number }} record
 * @param {ReturnType<typeof resolvePolicy>} policy
 */
function computePresenceRatio(record, policy) {
  const sched = scheduledMinutesForRecord(record, policy);
  if (!Number.isFinite(sched) || sched <= 0) return 0;

  const timing = normalizeAttendanceTimingFields(record);
  const late = timing.lateMinutes;
  const early = timing.earlyLeaveMinutes;
  const penalty = attendanceTimingPenaltyMinutes(timing);
  const rawStatus = record?.status !== undefined ? record.status : record?.attendance;
  const st = normalizeStatus(rawStatus);

  if (isAbsentLikeStatus(st) && late <= 0 && early <= 0) {
    return 0;
  }

  const attended = Math.max(0, sched - penalty.latePenaltyMinutes - penalty.earlyLeavePenaltyMinutes);
  return attended / sched;
}

/**
 * @param {{ status: string, lateMinutes?: number, earlyLeaveMinutes?: number, scheduledMinutes?: number }} record
 * @param {number} sessionWeight — max credit for this session (e.g. 100/N)
 * @param {ReturnType<typeof resolvePolicy>} policy
 */
function computeSessionCredit(record, sessionWeight, policy) {
  const st = resolveEffectiveAttendanceStatus(record, policy);

  if (st === ATTENDANCE_STATUS.NOT_APPLICABLE) {
    return { credit: 0, disqualified: false, exempt: true, reason: 'not_applicable' };
  }
  if (st === '') {
    return { credit: 0, disqualified: false, exempt: false, reason: 'no_record' };
  }
  if (st === ATTENDANCE_STATUS.EXCUSED) {
    return { credit: sessionWeight, disqualified: false, reason: 'excused_full' };
  }

  const presenceRatio = computePresenceRatio({ ...record, status: st }, policy);
  const credit = sessionWeight * presenceRatio;
  const reason = presenceRatio >= 1 ? 'full_presence' : (presenceRatio > 0 ? 'proportional' : 'no_presence');
  return { credit, disqualified: false, reason };
}

/**
 * Time-weighted attendance percent for a roster slice (one session or class span).
 * Each eligible student row receives equal weight within the slice.
 * @param {Array<{ status?: string, attendance?: string, lateMinutes?: number, earlyLeaveMinutes?: number, scheduledMinutes?: number }>} records
 * @param {object} classData
 * @param {object|Array} orgPolicyLayer
 * @returns {number|null}
 */
function computeRosterAttendancePercent(records, classData = {}, orgPolicyLayer = {}) {
  const allRecords = Array.isArray(records) ? records : [];
  const enabledStatuses = resolveEnabledAttendanceStatuses(classData);
  const prepared = allRecords.map((rec) => {
    const policy = resolvePolicyForScheduledMinutes(classData, orgPolicyLayer, rec?.scheduledMinutes);
    const effectiveStatus = resolveEffectiveAttendanceStatus(rec, policy, enabledStatuses);
    return { rec, policy, effectiveStatus };
  });
  const eligible = prepared.filter((row) => isEligibleAttendanceStatus(row.effectiveStatus));
  const n = eligible.length;
  if (!n) return null;

  const rowWeight = 100 / n;
  let sumCredit = 0;
  for (const row of eligible) {
    const { credit } = computeSessionCredit(
      { ...row.rec, status: row.effectiveStatus },
      rowWeight,
      row.policy
    );
    sumCredit += credit;
  }
  return Math.round(sumCredit * 100) / 100;
}

/**
 * @param {Array<{ status: string, lateMinutes?: number, earlyLeaveMinutes?: number, scheduledMinutes?: number }>} records — one per session column
 * @param {object} classData — optional attendancePolicy
 * @param {object|Array} orgPolicyLayer — flat org policy OR catalog `{ items }` for per-session exact match
 */
function computeStudentMatrixSummary(records, classData = {}, orgPolicyLayer = {}) {
  const allRecords = Array.isArray(records) ? records : [];
  const enabledStatuses = resolveEnabledAttendanceStatuses(classData);
  const preparedRecords = allRecords.map((rec) => {
    const policy = resolvePolicyForScheduledMinutes(classData, orgPolicyLayer, rec?.scheduledMinutes);
    const effectiveStatus = resolveEffectiveAttendanceStatus(rec, policy, enabledStatuses);
    return { rec, policy, effectiveStatus };
  });
  const eligibleRecords = preparedRecords.filter((row) => isEligibleAttendanceStatus(row.effectiveStatus));
  const n = eligibleRecords.length;
  const notApplicableSessionCount = preparedRecords.filter((row) => isNotApplicableStatus(row.effectiveStatus)).length;
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

  for (const row of eligibleRecords) {
    const { rec, policy, effectiveStatus: st } = row;
    if (st === ATTENDANCE_STATUS.PRESENT || st === ATTENDANCE_STATUS.LATE) totalPresentSessions += 1;
    if (isAbsentLikeStatus(st)) totalAbsentSessions += 1;

    const { credit, disqualified } = computeSessionCredit(
      { ...rec, status: st },
      sessionWeight,
      policy
    );
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
  MANDATORY_ATTENDANCE_STATUSES,
  OPTIONAL_ATTENDANCE_STATUSES,
  ALL_ATTENDANCE_STATUSES_ORDERED,
  ATTENDANCE_STATUS_META,
  normalizeStatus,
  isNotApplicableStatus,
  isUnmarkedAttendanceStatus,
  isAbsentLikeStatus,
  isEligibleAttendanceStatus,
  normalizeAttendanceStatusForSave,
  normalizeEnabledAttendanceStatuses,
  resolveEnabledAttendanceStatuses,
  isAttendanceStatusEnabled,
  assertAttendanceStatusAllowedForSave,
  coerceAttendanceStatusToEnabled,
  policyThresholdsAreEnabled,
  resolveEffectiveAttendanceStatus,
  resolvePolicy,
  pickOrgPolicyLayerForMinutes,
  resolvePolicyForScheduledMinutes,
  parseTimeToMinutes,
  scheduledMinutesFromSession,
  normalizeAttendanceTimingExcuseFlag,
  normalizeAttendanceTimingFields,
  attendanceTimingPenaltyMinutes,
  computePresenceRatio,
  computeSessionCredit,
  computeRosterAttendancePercent,
  computeStudentMatrixSummary,
  applyAttendanceMatrixRosterRules,
  parseNonNegIntRoster
};
