'use strict';

const leaveRequestService = require('./leaveRequestService');
const timesheetParametersPolicyService = require('./timesheetParametersPolicyService');
const statutoryHolidaySchemeService = require('./statutoryHolidaySchemeService');
const {
  addDays,
  buildWorkdayHistory,
  WorkdayHistory
} = require('./timesheetWorkdayHistoryService');
const {
  evaluateHolidayEligibility,
  buildLeaveBeforeAfterCheck,
  buildStatHolidayRow,
  buildStatHolidayWarning,
  buildStatHolidaySessionId,
  buildSupplementalHoursByDate,
  mergeWorkdaySourceEntries,
  resolveStatHolidayActivityId,
  buildOverrideLookup,
  resolveHolidayDate,
  isPayableHoliday
} = require('./statutoryHolidayEligibilityService');
const {
  isStatutoryHolidayRoundingEnabled,
  applyStatutoryHolidayHoursRounding
} = require('./statutoryHolidayHoursRoundingService');

function cleanId(value) {
  return String(value ?? '').trim();
}

function resolveHolidayTitle(holiday = {}) {
  return String(holiday?.title || holiday?.name || holiday?.holidayName || holiday?.label || 'Statutory holiday').trim();
}

function resolveHolidayType(holiday = {}) {
  return String(holiday?.type || holiday?.holidayType || '').trim();
}

function summarizeDisqualifyReasons(checks = {}) {
  const reasons = [];
  if (checks.minWorkdays?.pass === false) {
    reasons.push(`Needs ${checks.minWorkdays.required} workdays (has ${checks.minWorkdays.actual}).`);
  }
  if (checks.weekdayRule?.pass === false) {
    reasons.push(`Needs ${checks.weekdayRule.required} of last ${checks.weekdayRule.lookback} ${checks.weekdayRule.weekdayName}s with pay (has ${checks.weekdayRule.actual}).`);
  }
  if (checks.workdayMatch?.pass === false) {
    reasons.push('Holiday is not on a regular workday and no payable hours were logged on the holiday.');
  }
  if (checks.holidayAttendance?.pass === false) {
    reasons.push(checks.holidayAttendance.reason || 'Approved leave on statutory holiday.');
  }
  if (checks.leaveDuringHolidayWeek?.pass === false) {
    reasons.push('Approved leave overlaps the calendar week of the holiday.');
  }
  if (checks.leaveBeforeAfter?.pass === false) {
    reasons.push('Approved leave on the last or first adjacent payable workday.');
  }
  if (checks.calculatedHours?.pass === false) {
    if (checks.trackType === statutoryHolidaySchemeService.SCHEME_LINC) {
      reasons.push('No payable LINC department hours were found on this weekday from timesheet history.');
    } else {
      reasons.push('No payable workdays in the earnings lookback window.');
    }
  }
  return reasons;
}

function evaluateEquilibriumTrack({
  holiday,
  policy,
  workdayEntries = [],
  leaveDates = new Set(),
  supplementalHoursByDate = new Map()
} = {}) {
  const resolvedPolicy = timesheetParametersPolicyService.resolvePolicy(policy);
  const schemeEntries = statutoryHolidaySchemeService.filterEntriesForScheme(
    workdayEntries,
    statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM,
    resolvedPolicy
  );
  const supplementalForScheme = buildSupplementalHoursByDate(schemeEntries);
  const hoursByDate = statutoryHolidaySchemeService.buildWorkdayHistoryFromEntries(schemeEntries);
  const workdayHistory = new WorkdayHistory(hoursByDate);

  const evaluation = evaluateHolidayEligibility({
    holiday,
    policy: resolvedPolicy,
    workdayHistory,
    leaveDates,
    supplementalHoursByDate: supplementalForScheme
  });

  const schemeResult = statutoryHolidaySchemeService.calculateEquilibriumSchemeHours({
    holidayDate: evaluation.date,
    workdayEntries,
    policy: resolvedPolicy
  });

  const roundingEnabled = isStatutoryHolidayRoundingEnabled(resolvedPolicy);
  const calculatedHours = applyStatutoryHolidayHoursRounding(
    Number(schemeResult.calculatedHours || 0),
    { enabled: roundingEnabled }
  );
  const checks = {
    ...evaluation.checks,
    trackType: statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM,
    calculatedHours: {
      ...(evaluation.checks?.calculatedHours || {}),
      pass: calculatedHours > 0,
      averageHours: calculatedHours
    }
  };

  const qualified = Boolean(
    checks.minWorkdays?.pass
    && checks.workdayMatch?.pass
    && checks.holidayAttendance?.pass
    && (checks.leaveDuringHolidayWeek?.pass !== false)
    && checks.leaveBeforeAfter?.pass
    && calculatedHours > 0
  );

  return {
    ...evaluation,
    qualified,
    calculatedHours,
    checks,
    disqualifyReasons: summarizeDisqualifyReasons(checks),
    schemeResult
  };
}

function evaluateLincTrack({
  holiday,
  policy,
  workdayEntries = [],
  leaveDates = new Set()
} = {}) {
  const resolvedPolicy = timesheetParametersPolicyService.resolvePolicy(policy);
  const statPolicy = resolvedPolicy?.statutoryHolidayPay
    || timesheetParametersPolicyService.DEFAULT_STATUTORY_HOLIDAY_PAY;
  const date = resolveHolidayDate(holiday);
  const schemeConfig = statutoryHolidaySchemeService.resolveSchemeConfig(
    statutoryHolidaySchemeService.SCHEME_LINC,
    resolvedPolicy
  );
  const schemeResult = statutoryHolidaySchemeService.calculateLincSchemeHours({
    holidayDate: date,
    workdayEntries,
    policy: resolvedPolicy
  });
  const roundingEnabled = isStatutoryHolidayRoundingEnabled(resolvedPolicy);
  const calculatedHours = applyStatutoryHolidayHoursRounding(
    Number(schemeResult.calculatedHours || 0),
    { enabled: roundingEnabled }
  );
  const enforceBoundaryLeave = schemeConfig?.disqualifyOnLeaveBeforeAfter === true;
  let leaveBeforeAfter;
  if (enforceBoundaryLeave) {
    const schemeEntries = statutoryHolidaySchemeService.filterEntriesForScheme(
      workdayEntries,
      statutoryHolidaySchemeService.SCHEME_LINC,
      resolvedPolicy
    );
    const hoursByDate = statutoryHolidaySchemeService.buildWorkdayHistoryFromEntries(schemeEntries);
    const workdayHistory = new WorkdayHistory(hoursByDate);
    leaveBeforeAfter = buildLeaveBeforeAfterCheck({
      date,
      workdayHistory,
      leaveDates,
      beforeAfterSearchDays: statPolicy.beforeAfterSearchDays,
      enforce: true
    });
  }
  const qualified = calculatedHours > 0
    && (!enforceBoundaryLeave || leaveBeforeAfter.pass);
  const departmentDetails = schemeResult?.departmentDetails && typeof schemeResult.departmentDetails === 'object'
    ? schemeResult.departmentDetails
    : {};
  const departments = Object.entries(schemeResult.calculatedHoursByDepartment || {}).map(
    ([departmentId, hours]) => ({
      departmentId,
      hours: Number(hours || 0),
      matchedDate: cleanId(departmentDetails[departmentId]?.matchedDate),
      searchDirection: cleanId(departmentDetails[departmentId]?.searchDirection)
    })
  );
  const primaryMatch = departments.find((row) => row.matchedDate) || departments[0] || null;

  const checks = {
    trackType: statutoryHolidaySchemeService.SCHEME_LINC,
    hourMode: schemeConfig?.hourMode || statutoryHolidaySchemeService.LINC_HOUR_MODES.MOST_RECENT,
    fixedHours: Number(schemeConfig?.fixedHours || 0),
    averageWeeks: Number(schemeConfig?.averageWeeks || 4),
    matchedDate: primaryMatch?.matchedDate || '',
    searchDirection: primaryMatch?.searchDirection || '',
    departments,
    calculatedHours: {
      pass: calculatedHours > 0,
      averageHours: calculatedHours,
      totalHours: calculatedHours,
      workdayCount: departments.length
    },
    ...(leaveBeforeAfter ? { leaveBeforeAfter } : {})
  };

  return {
    holidayId: cleanId(holiday?.id),
    date,
    title: resolveHolidayTitle(holiday),
    type: resolveHolidayType(holiday),
    qualified,
    calculatedHours,
    checks,
    disqualifyReasons: qualified
      ? []
      : summarizeDisqualifyReasons(checks),
    schemeResult
  };
}

function evaluateSchemeHolidayTrack({
  schemeId = '',
  holiday,
  policy,
  workdayEntries = [],
  leaveDates = new Set(),
  supplementalHoursByDate = new Map()
} = {}) {
  const key = cleanId(schemeId) || statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM;
  if (key === statutoryHolidaySchemeService.SCHEME_LINC) {
    return evaluateLincTrack({ holiday, policy, workdayEntries, leaveDates });
  }
  return evaluateEquilibriumTrack({
    holiday,
    policy,
    workdayEntries,
    leaveDates,
    supplementalHoursByDate
  });
}

async function calculateStatutoryHolidayForPeriod({
  orgId,
  personId,
  periodStartDate,
  periodEndDate,
  policy,
  holidays = [],
  periodEntries = [],
  supplementalEntries = [],
  supplementalEntryFilter = null,
  existingEntries = [],
  reqUser,
  allowManagerOverride = false,
  overrideMap = null
} = {}) {
  const resolvedPolicy = timesheetParametersPolicyService.resolvePolicy(policy);
  const statPolicy = resolvedPolicy.statutoryHolidayPay;
  if (!statPolicy?.enabled) {
    return { rows: [], warnings: [], evaluations: [], usesActivityMode: false, activityId: '' };
  }

  const activityId = resolveStatHolidayActivityId(resolvedPolicy);
  const payableHolidays = (Array.isArray(holidays) ? holidays : [])
    .filter((holiday) => {
      const date = resolveHolidayDate(holiday);
      return date
        && date >= String(periodStartDate || '')
        && date <= String(periodEndDate || '')
        && isPayableHoliday(holiday, statPolicy.payableHolidayTypes);
    });

  if (!payableHolidays.length) {
    return {
      rows: [],
      warnings: [],
      evaluations: [],
      usesActivityMode: Boolean(activityId),
      activityId,
      schemeActivityIds: statutoryHolidaySchemeService.resolveAllSchemeActivityIds(resolvedPolicy),
      activeSchemes: []
    };
  }

  const maxHolidayDate = payableHolidays
    .map((holiday) => resolveHolidayDate(holiday))
    .sort()
    .pop();
  const lookbackDays = Math.max(
    statPolicy.minWorkdays * 3,
    statPolicy.beforeAfterSearchDays + 30,
    statPolicy.earningsLookbackWeeks * 7 + 14,
    statPolicy.weekdayOccurrencesLookback * 7 + 14
  );

  const leaveEvents = await leaveRequestService.getApprovedLeaveEventsForPerson({
    orgId,
    personId,
    startDate: addDays(periodStartDate, -lookbackDays),
    endDate: addDays(periodEndDate, statPolicy.beforeAfterSearchDays + 7),
    reqUser
  });
  const leaveDates = new Set(
    (Array.isArray(leaveEvents) ? leaveEvents : [])
      .map((event) => String(event?.date || '').trim())
      .filter(Boolean)
  );

  const filteredSupplementalEntries = (Array.isArray(supplementalEntries) ? supplementalEntries : [])
    .filter((entry) => typeof supplementalEntryFilter !== 'function' || supplementalEntryFilter(entry));
  const filteredPeriodEntries = (Array.isArray(periodEntries) ? periodEntries : [])
    .filter((entry) => typeof supplementalEntryFilter !== 'function' || supplementalEntryFilter(entry));
  const workdaySourceEntries = mergeWorkdaySourceEntries(filteredPeriodEntries, filteredSupplementalEntries);
  const historyEndDate = addDays(
    [String(periodEndDate || '').trim(), maxHolidayDate].filter(Boolean).sort().pop(),
    statPolicy.beforeAfterSearchDays + 7
  );

  await buildWorkdayHistory({
    orgId,
    personId,
    endDate: historyEndDate,
    lookbackDays,
    useFullHistory: true,
    reqUser,
    supplementalEntries: workdaySourceEntries
  });

  const supplementalHoursByDate = buildSupplementalHoursByDate(workdaySourceEntries);
  const existingBySessionId = new Map(
    (Array.isArray(existingEntries) ? existingEntries : [])
      .filter((entry) => entry && entry.isDeleted !== true)
      .map((entry) => [String(entry?.sessionId || '').trim(), entry])
      .filter(([sessionId]) => Boolean(sessionId))
  );
  const existingBySchemeHoliday = buildOverrideLookup(existingEntries, overrideMap, { personId });
  const activeSchemes = statutoryHolidaySchemeService.resolveActiveSchemesForPerson({
    workdayEntries: workdaySourceEntries,
    existingEntries,
    policy: resolvedPolicy
  });

  const rows = [];
  const warnings = [];
  const evaluations = [];
  const seenWarningKeys = new Set();

  payableHolidays.forEach((holiday) => {
    activeSchemes.forEach((schemeId) => {
      const evaluation = evaluateSchemeHolidayTrack({
        schemeId,
        holiday,
        policy: resolvedPolicy,
        workdayEntries: workdaySourceEntries,
        leaveDates,
        supplementalHoursByDate
      });
      evaluations.push({ ...evaluation, schemeId });

      const schemeResult = evaluation.schemeResult
        || statutoryHolidaySchemeService.calculateSchemeHours({
          schemeId,
          holidayDate: evaluation.date,
          workdayEntries: workdaySourceEntries,
          policy: resolvedPolicy
        });
      const lookupKey = statutoryHolidaySchemeService.buildStatHolidayOverrideKey(
        schemeId,
        evaluation.holidayId
      );
      const sessionId = buildStatHolidaySessionId(evaluation.holidayId, personId, schemeId);
      const existingEntry = existingBySchemeHoliday.get(lookupKey)
        || existingBySessionId.get(sessionId)
        || null;
      const hasOverride = Boolean(existingEntry?.statHolidayOverride);
      const row = buildStatHolidayRow({
        evaluation,
        personId,
        existingEntry,
        allowManagerOverride,
        schemeId,
        schemeResult,
        policy: resolvedPolicy
      });
      const warningKey = lookupKey;
      rows.push(row);
      if (!seenWarningKeys.has(warningKey)) {
        const warning = buildStatHolidayWarning({
          evaluation,
          existingEntry,
          allowManagerOverride,
          schemeId,
          schemeResult,
          policy: resolvedPolicy
        });
        if (warning) {
          warnings.push(warning);
          seenWarningKeys.add(warningKey);
        }
      }
    });
  });

  const schemeActivityIds = statutoryHolidaySchemeService.resolveAllSchemeActivityIds(resolvedPolicy);

  return {
    rows,
    warnings,
    evaluations,
    usesActivityMode: schemeActivityIds.length > 0 || Boolean(activityId),
    activityId,
    schemeActivityIds,
    activeSchemes
  };
}

module.exports = {
  evaluateEquilibriumTrack,
  evaluateLincTrack,
  evaluateSchemeHolidayTrack,
  calculateStatutoryHolidayForPeriod
};
