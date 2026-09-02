'use strict';

const EMPTY_ENROLLMENT_SESSION_MODES = Object.freeze({
  SHOW_WITH_HOURS: 'show_with_hours',
  SHOW_WITHOUT_HOURS: 'show_without_hours',
  HIDE: 'hide'
});

const EMPTY_ENROLLMENT_SESSION_MODE_SET = Object.freeze(new Set(Object.values(EMPTY_ENROLLMENT_SESSION_MODES)));

const DEFAULT_EMPTY_ENROLLMENT_SESSIONS = EMPTY_ENROLLMENT_SESSION_MODES.HIDE;

const PAYABLE_HOLIDAY_TYPES = Object.freeze(['National Holiday', 'Observance Paid']);

const DEFAULT_STATUTORY_HOLIDAY_PAY = Object.freeze({
  enabled: true,
  minWorkdays: 30,
  weekdayOccurrencesRequired: 5,
  weekdayOccurrencesLookback: 9,
  earningsLookbackWeeks: 4,
  beforeAfterSearchDays: 14,
  disqualifyOnLeaveDuringHolidayWeek: true,
  disqualifyOnLeaveBeforeAfter: true,
  payableHolidayTypes: [...PAYABLE_HOLIDAY_TYPES]
});

const DEFAULT_POLICY = Object.freeze({
  emptyEnrollmentSessions: DEFAULT_EMPTY_ENROLLMENT_SESSIONS,
  statutoryHolidayPay: DEFAULT_STATUTORY_HOLIDAY_PAY
});

function cleanToken(value = '') {
  return String(value ?? '').trim().toLowerCase();
}

function cleanBoolean(value, fallback = false) {
  if (value === true || value === 'true' || value === 1 || value === '1' || value === 'on') return true;
  if (value === false || value === 'false' || value === 0 || value === '0' || value === 'off') return false;
  return fallback;
}

function cleanPositiveInteger(value, fallback, { min = 1, max = 365 } = {}) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizePayableHolidayTypes(value, { strict = false } = {}) {
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : []);
  const normalized = Array.from(new Set(
    source
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
  if (!normalized.length) {
    if (strict) {
      const error = new Error('Select at least one paid holiday type for statutory holiday pay.');
      error.statusCode = 400;
      throw error;
    }
    return [...DEFAULT_STATUTORY_HOLIDAY_PAY.payableHolidayTypes];
  }
  return normalized;
}

function normalizeStatutoryHolidayPay(input = {}, { strict = false } = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const defaults = DEFAULT_STATUTORY_HOLIDAY_PAY;
  return {
    enabled: cleanBoolean(source.enabled, defaults.enabled),
    minWorkdays: cleanPositiveInteger(source.minWorkdays, defaults.minWorkdays, { min: 1, max: 365 }),
    weekdayOccurrencesRequired: cleanPositiveInteger(
      source.weekdayOccurrencesRequired,
      defaults.weekdayOccurrencesRequired,
      { min: 1, max: 9 }
    ),
    weekdayOccurrencesLookback: cleanPositiveInteger(
      source.weekdayOccurrencesLookback,
      defaults.weekdayOccurrencesLookback,
      { min: 1, max: 52 }
    ),
    earningsLookbackWeeks: cleanPositiveInteger(
      source.earningsLookbackWeeks,
      defaults.earningsLookbackWeeks,
      { min: 1, max: 12 }
    ),
    beforeAfterSearchDays: cleanPositiveInteger(
      source.beforeAfterSearchDays,
      defaults.beforeAfterSearchDays,
      { min: 1, max: 60 }
    ),
    disqualifyOnLeaveDuringHolidayWeek: cleanBoolean(
      source.disqualifyOnLeaveDuringHolidayWeek,
      defaults.disqualifyOnLeaveDuringHolidayWeek
    ),
    disqualifyOnLeaveBeforeAfter: cleanBoolean(
      source.disqualifyOnLeaveBeforeAfter,
      defaults.disqualifyOnLeaveBeforeAfter
    ),
    payableHolidayTypes: normalizePayableHolidayTypes(source.payableHolidayTypes, { strict })
  };
}

function normalizeEmptyEnrollmentSessions(value, { strict = false } = {}) {
  const token = cleanToken(value);
  if (EMPTY_ENROLLMENT_SESSION_MODE_SET.has(token)) return token;
  if (strict) {
    const error = new Error(
      'Select how sessions with no student enrollment should appear on the timesheet.'
    );
    error.statusCode = 400;
    throw error;
  }
  return DEFAULT_EMPTY_ENROLLMENT_SESSIONS;
}

function normalizePolicyFromStored(input = {}) {
  return {
    emptyEnrollmentSessions: normalizeEmptyEnrollmentSessions(input.emptyEnrollmentSessions),
    statutoryHolidayPay: normalizeStatutoryHolidayPay(input.statutoryHolidayPay)
  };
}

function normalizePolicyFromForm(input = {}) {
  const payableHolidayTypes = [];
  if (Array.isArray(input.payableHolidayTypes)) {
    payableHolidayTypes.push(...input.payableHolidayTypes);
  } else if (typeof input.payableHolidayTypes === 'string') {
    payableHolidayTypes.push(...input.payableHolidayTypes.split(','));
  }
  PAYABLE_HOLIDAY_TYPES.forEach((type) => {
    const key = `payableHolidayType_${type.replace(/\s+/g, '_')}`;
    if (cleanBoolean(input[key], false)) payableHolidayTypes.push(type);
  });
  const hasExplicitHolidayTypeInput = PAYABLE_HOLIDAY_TYPES.some((type) => {
    const key = `payableHolidayType_${type.replace(/\s+/g, '_')}`;
    return Object.prototype.hasOwnProperty.call(input, key);
  }) || Object.prototype.hasOwnProperty.call(input, 'payableHolidayTypes');

  return {
    emptyEnrollmentSessions: normalizeEmptyEnrollmentSessions(input.emptyEnrollmentSessions, { strict: true }),
    statutoryHolidayPay: normalizeStatutoryHolidayPay({
      enabled: input.statutoryHolidayPayEnabled ?? input['statutoryHolidayPay.enabled'],
      minWorkdays: input.statutoryHolidayMinWorkdays ?? input['statutoryHolidayPay.minWorkdays'],
      weekdayOccurrencesRequired: input.statutoryHolidayWeekdayOccurrencesRequired
        ?? input['statutoryHolidayPay.weekdayOccurrencesRequired'],
      weekdayOccurrencesLookback: input.statutoryHolidayWeekdayOccurrencesLookback
        ?? input['statutoryHolidayPay.weekdayOccurrencesLookback'],
      earningsLookbackWeeks: input.statutoryHolidayEarningsLookbackWeeks
        ?? input['statutoryHolidayPay.earningsLookbackWeeks'],
      beforeAfterSearchDays: input.statutoryHolidayBeforeAfterSearchDays
        ?? input['statutoryHolidayPay.beforeAfterSearchDays'],
      disqualifyOnLeaveDuringHolidayWeek: input.statutoryHolidayDisqualifyOnLeaveDuringHolidayWeek
        ?? input['statutoryHolidayPay.disqualifyOnLeaveDuringHolidayWeek'],
      disqualifyOnLeaveBeforeAfter: input.statutoryHolidayDisqualifyOnLeaveBeforeAfter
        ?? input['statutoryHolidayPay.disqualifyOnLeaveBeforeAfter'],
      payableHolidayTypes: hasExplicitHolidayTypeInput ? payableHolidayTypes : DEFAULT_STATUTORY_HOLIDAY_PAY.payableHolidayTypes
    }, { strict: hasExplicitHolidayTypeInput })
  };
}

function resolvePolicy(input = {}) {
  return normalizePolicyFromStored(input);
}

function validatePolicyInput(input = {}) {
  return normalizePolicyFromForm(input);
}

function isClassTimesheetRow(row = {}) {
  if (!row || typeof row !== 'object') return false;
  if (row.isSchoolActivity === true || row.isReportReflection === true) return false;
  if (row.isStatutoryHoliday === true) return false;
  if (row.isManual === true || row.isPriorPeriodAdjustment === true) return false;
  const sessionType = cleanToken(row.sessionType);
  if (sessionType && sessionType !== 'class') return false;
  const sessionId = String(row.sessionId || '').trim().toLowerCase();
  if (sessionId.startsWith('act-') || sessionId.startsWith('rptref-') || sessionId.startsWith('adj-')) return false;
  if (sessionId.startsWith('stathol-')) return false;
  return true;
}

function isEmptyEnrollmentSession(row = {}) {
  if (!isClassTimesheetRow(row)) return false;
  const count = Number(row.enrolledStudentCount);
  return Number.isFinite(count) && count <= 0;
}

function applyEmptyEnrollmentHoursSuppression(row = {}) {
  return {
    ...row,
    hours: 0,
    timesheetHours: 0,
    emptyEnrollmentHoursSuppressed: true
  };
}

function applyEmptyEnrollmentSessionsPolicy(rows = [], policy = {}) {
  const mode = resolvePolicy(policy).emptyEnrollmentSessions;
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    if (!isEmptyEnrollmentSession(row)) return [row];
    if (mode === EMPTY_ENROLLMENT_SESSION_MODES.HIDE) return [];
    if (mode === EMPTY_ENROLLMENT_SESSION_MODES.SHOW_WITHOUT_HOURS) {
      return [applyEmptyEnrollmentHoursSuppression(row)];
    }
    return [row];
  });
}

function hasBlockingIncompleteClassSource(rows = []) {
  return (Array.isArray(rows) ? rows : []).some((row) => (
    isClassTimesheetRow(row)
    && row?.isFinalStatus === false
    && row?.isProvisional !== true
  ));
}

module.exports = {
  EMPTY_ENROLLMENT_SESSION_MODES,
  DEFAULT_EMPTY_ENROLLMENT_SESSIONS,
  PAYABLE_HOLIDAY_TYPES,
  DEFAULT_STATUTORY_HOLIDAY_PAY,
  DEFAULT_POLICY,
  normalizeEmptyEnrollmentSessions,
  normalizeStatutoryHolidayPay,
  normalizePolicyFromStored,
  normalizePolicyFromForm,
  resolvePolicy,
  validatePolicyInput,
  isClassTimesheetRow,
  isEmptyEnrollmentSession,
  applyEmptyEnrollmentSessionsPolicy,
  hasBlockingIncompleteClassSource
};
