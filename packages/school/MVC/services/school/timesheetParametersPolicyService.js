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
  activityId: '',
  defaultSchemeId: 'equilibrium_school',
  schemes: {
    equilibrium_school: {
      id: 'equilibrium_school',
      name: 'Equilibrium School Scheme',
      builtIn: true,
      activityId: ''
    },
    linc: {
      id: 'linc',
      name: 'LINC Scheme',
      builtIn: true,
      activityId: '',
      hourMode: 'most_recent',
      fixedHours: 0,
      averageWeeks: 4,
      disqualifyOnLeaveBeforeAfter: false
    }
  },
  departmentSchemeAssignments: {},
  minWorkdays: 30,
  weekdayOccurrencesRequired: 5,
  weekdayOccurrencesLookback: 9,
  earningsLookbackWeeks: 4,
  beforeAfterSearchDays: 14,
  disqualifyOnLeaveDuringHolidayWeek: false,
  disqualifyOnLeaveBeforeAfter: true,
  payableHolidayTypes: [...PAYABLE_HOLIDAY_TYPES],
  roundCalculatedHours: false,
  skipAfterBoundaryInNextMonth: false,
  mappingYear: '',
  mappingActivityId: ''
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

function schemeService() {
  return require('./statutoryHolidaySchemeService');
}

function normalizeStatutoryHolidayPay(input = {}, { strict = false } = {}) {
  const statutoryHolidaySchemeService = schemeService();
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const defaults = DEFAULT_STATUTORY_HOLIDAY_PAY;
  const migrated = statutoryHolidaySchemeService.migrateStatutoryHolidayPaySchemes({
    ...defaults,
    ...source
  });
  const defaultSchemeId = statutoryHolidaySchemeService.BUILTIN_SCHEME_IDS.includes(
    cleanId(migrated.defaultSchemeId)
  )
    ? cleanId(migrated.defaultSchemeId)
    : statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM;
  const schemes = statutoryHolidaySchemeService.normalizeSchemesBlock(
    migrated.schemes,
    cleanId(migrated.activityId)
  );
  const defaultActivityId = cleanId(schemes[defaultSchemeId]?.activityId)
    || cleanId(schemes[statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM]?.activityId)
    || cleanId(migrated.activityId);
  if (!cleanId(schemes[statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM].activityId) && defaultActivityId) {
    schemes[statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM].activityId = defaultActivityId;
  }
  const lincScheme = schemes[statutoryHolidaySchemeService.SCHEME_LINC];
  if (lincScheme) {
    const hourMode = statutoryHolidaySchemeService.normalizeLincHourMode(lincScheme.hourMode);
    lincScheme.hourMode = hourMode;
    if (strict && hourMode === statutoryHolidaySchemeService.LINC_HOUR_MODES.FIXED
      && !(Number(lincScheme.fixedHours) > 0)) {
      const error = new Error('Enter fixed hours greater than zero for the LINC scheme.');
      error.statusCode = 400;
      throw error;
    }
    if (strict && hourMode === statutoryHolidaySchemeService.LINC_HOUR_MODES.AVERAGE_WEEKS
      && !(Number(lincScheme.averageWeeks) >= 1)) {
      const error = new Error('Enter the number of weeks to average for the LINC scheme.');
      error.statusCode = 400;
      throw error;
    }
  }
  return {
    enabled: cleanBoolean(source.enabled, defaults.enabled),
    activityId: defaultActivityId,
    defaultSchemeId,
    schemes,
    departmentSchemeAssignments: statutoryHolidaySchemeService.normalizeDepartmentSchemeAssignments(
      migrated.departmentSchemeAssignments
    ),
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
    payableHolidayTypes: normalizePayableHolidayTypes(source.payableHolidayTypes, { strict }),
    roundCalculatedHours: cleanBoolean(
      source.roundCalculatedHours,
      defaults.roundCalculatedHours
    ),
    skipAfterBoundaryInNextMonth: cleanBoolean(
      source.skipAfterBoundaryInNextMonth,
      defaults.skipAfterBoundaryInNextMonth
    ),
    mappingYear: String(source.mappingYear ?? '').trim(),
    mappingActivityId: String(source.mappingActivityId ?? '').trim()
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

function parseDepartmentSchemeAssignmentsFromForm(input = {}) {
  const statutoryHolidaySchemeService = schemeService();
  const statPayNested = input.statutoryHolidayPay && typeof input.statutoryHolidayPay === 'object'
    ? input.statutoryHolidayPay
    : null;
  const nested = input.departmentSchemeAssignments
    || statPayNested?.departmentSchemeAssignments;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return statutoryHolidaySchemeService.normalizeDepartmentSchemeAssignments(nested);
  }
  const assignments = {};
  Object.entries(input || {}).forEach(([key, value]) => {
    const match = /^departmentSchemeAssignment_(.+)$/.exec(String(key || ''));
    if (!match) return;
    const schemeId = cleanId(value);
    if (!schemeId) return;
    assignments[match[1]] = schemeId;
  });
  return statutoryHolidaySchemeService.normalizeDepartmentSchemeAssignments(assignments);
}

function parseSchemesFromForm(input = {}) {
  const statutoryHolidaySchemeService = schemeService();
  const statPayNested = input.statutoryHolidayPay && typeof input.statutoryHolidayPay === 'object'
    ? input.statutoryHolidayPay
    : null;
  const legacyActivityId = cleanId(input.statutoryHolidayActivityId)
    || cleanId(statPayNested?.activityId);
  const nested = input.statutoryHolidaySchemes
    || (statPayNested?.schemes && typeof statPayNested.schemes === 'object' ? statPayNested.schemes : null);
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return statutoryHolidaySchemeService.normalizeSchemesBlock(
      nested,
      legacyActivityId
    );
  }
  const schemes = {};
  statutoryHolidaySchemeService.BUILTIN_SCHEME_IDS.forEach((schemeId) => {
    const activityKey = `schemeActivityId_${schemeId}`;
    const hourModeKey = `schemeHourMode_${schemeId}`;
    const fixedHoursKey = `schemeFixedHours_${schemeId}`;
    const averageWeeksKey = `schemeAverageWeeks_${schemeId}`;
    const disqualifyBeforeAfterKey = `schemeDisqualifyOnLeaveBeforeAfter_${schemeId}`;
    const patch = {};
    if (Object.prototype.hasOwnProperty.call(input, activityKey)) {
      patch.activityId = input[activityKey];
    }
    if (schemeId === statutoryHolidaySchemeService.SCHEME_LINC) {
      if (Object.prototype.hasOwnProperty.call(input, hourModeKey)) {
        patch.hourMode = input[hourModeKey];
      }
      if (Object.prototype.hasOwnProperty.call(input, fixedHoursKey)) {
        patch.fixedHours = input[fixedHoursKey];
      }
      if (Object.prototype.hasOwnProperty.call(input, averageWeeksKey)) {
        patch.averageWeeks = input[averageWeeksKey];
      }
      if (Object.prototype.hasOwnProperty.call(input, disqualifyBeforeAfterKey)) {
        patch.disqualifyOnLeaveBeforeAfter = input[disqualifyBeforeAfterKey];
      }
    }
    if (Object.keys(patch).length) {
      schemes[schemeId] = patch;
    }
  });
  return statutoryHolidaySchemeService.normalizeSchemesBlock(
    schemes,
    legacyActivityId
  );
}

function normalizePolicyFromForm(input = {}) {
  const nestedStat = input.statutoryHolidayPay && typeof input.statutoryHolidayPay === 'object'
    ? input.statutoryHolidayPay
    : {};
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
      enabled: input.statutoryHolidayPayEnabled ?? input['statutoryHolidayPay.enabled'] ?? nestedStat.enabled,
      activityId: input.statutoryHolidayActivityId ?? input['statutoryHolidayPay.activityId'] ?? nestedStat.activityId,
      defaultSchemeId: input.statutoryHolidayDefaultSchemeId
        ?? input['statutoryHolidayPay.defaultSchemeId']
        ?? nestedStat.defaultSchemeId,
      schemes: parseSchemesFromForm(input),
      departmentSchemeAssignments: parseDepartmentSchemeAssignmentsFromForm(input),
      minWorkdays: input.statutoryHolidayMinWorkdays ?? input['statutoryHolidayPay.minWorkdays'] ?? nestedStat.minWorkdays,
      weekdayOccurrencesRequired: input.statutoryHolidayWeekdayOccurrencesRequired
        ?? input['statutoryHolidayPay.weekdayOccurrencesRequired']
        ?? nestedStat.weekdayOccurrencesRequired,
      weekdayOccurrencesLookback: input.statutoryHolidayWeekdayOccurrencesLookback
        ?? input['statutoryHolidayPay.weekdayOccurrencesLookback']
        ?? nestedStat.weekdayOccurrencesLookback,
      earningsLookbackWeeks: input.statutoryHolidayEarningsLookbackWeeks
        ?? input['statutoryHolidayPay.earningsLookbackWeeks']
        ?? nestedStat.earningsLookbackWeeks,
      beforeAfterSearchDays: input.statutoryHolidayBeforeAfterSearchDays
        ?? input['statutoryHolidayPay.beforeAfterSearchDays']
        ?? nestedStat.beforeAfterSearchDays,
      disqualifyOnLeaveDuringHolidayWeek: input.statutoryHolidayDisqualifyOnLeaveDuringHolidayWeek
        ?? input['statutoryHolidayPay.disqualifyOnLeaveDuringHolidayWeek']
        ?? nestedStat.disqualifyOnLeaveDuringHolidayWeek,
      disqualifyOnLeaveBeforeAfter: input.statutoryHolidayDisqualifyOnLeaveBeforeAfter
        ?? input['statutoryHolidayPay.disqualifyOnLeaveBeforeAfter']
        ?? nestedStat.disqualifyOnLeaveBeforeAfter,
      roundCalculatedHours: input.statutoryHolidayRoundCalculatedHours
        ?? input['statutoryHolidayPay.roundCalculatedHours']
        ?? nestedStat.roundCalculatedHours,
      skipAfterBoundaryInNextMonth: input.statutoryHolidaySkipAfterBoundaryInNextMonth
        ?? input['statutoryHolidayPay.skipAfterBoundaryInNextMonth']
        ?? nestedStat.skipAfterBoundaryInNextMonth,
      payableHolidayTypes: hasExplicitHolidayTypeInput
        ? payableHolidayTypes
        : (nestedStat.payableHolidayTypes ?? DEFAULT_STATUTORY_HOLIDAY_PAY.payableHolidayTypes),
      mappingYear: input.statutoryHolidayMappingYear
        ?? input['statutoryHolidayPay.mappingYear']
        ?? nestedStat.mappingYear
        ?? '',
      mappingActivityId: input.statutoryHolidayMappingActivityId
        ?? input['statutoryHolidayPay.mappingActivityId']
        ?? nestedStat.mappingActivityId
        ?? ''
    }, { strict: hasExplicitHolidayTypeInput })
  };
}

function resolvePolicy(input = {}) {
  return normalizePolicyFromStored(input);
}

function validatePolicyInput(input = {}) {
  const statutoryHolidaySchemeService = schemeService();
  const normalized = normalizePolicyFromForm(input);
  const statPay = normalized.statutoryHolidayPay || {};
  if (statPay.enabled === false) return normalized;

  const defaultSchemeId = cleanId(statPay.defaultSchemeId)
    || statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM;
  const defaultActivityId = statutoryHolidaySchemeService.resolveSchemeActivityId(
    normalized,
    defaultSchemeId
  );
  if (!defaultActivityId) {
    const error = new Error('Select a public statutory holiday activity for the default scheme when statutory holiday pay is enabled.');
    error.statusCode = 400;
    throw error;
  }

  const schemesInUse = statutoryHolidaySchemeService.resolveSchemesWithAssignedDepartments(normalized);
  schemesInUse.forEach(({ schemeId, config }) => {
    if (!cleanId(config?.activityId)) {
      const schemeName = String(config?.name || schemeId).trim();
      const error = new Error(`Select a public activity for the ${schemeName} statutory holiday scheme.`);
      error.statusCode = 400;
      throw error;
    }
  });
  return normalized;
}

function cleanId(value) {
  return String(value ?? '').trim();
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
