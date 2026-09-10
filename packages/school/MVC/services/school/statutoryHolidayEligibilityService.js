'use strict';

const leaveRequestService = require('./leaveRequestService');
const timesheetParametersPolicyService = require('./timesheetParametersPolicyService');
const {
  addDays,
  getWeekday,
  buildWorkdayHistory,
  isPayableWorkdayEntry
} = require('./timesheetWorkdayHistoryService');
const timesheetPrintService = require('./timesheetPrintService');
const timesheetLegacyImportService = require('./timesheetLegacyImportService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function resolveHolidayDate(holiday = {}) {
  return String(holiday?.date || holiday?.holidayDate || '').trim();
}

function getHolidayWeekRange(holidayDate) {
  const weekday = getWeekday(holidayDate);
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const start = addDays(holidayDate, mondayOffset);
  return { start, end: addDays(start, 6) };
}

function resolveHolidayTitle(holiday = {}) {
  return String(holiday?.title || holiday?.name || holiday?.holidayName || holiday?.label || 'Statutory holiday').trim();
}

function resolveHolidayType(holiday = {}) {
  return String(holiday?.type || holiday?.holidayType || '').trim();
}

function isPayableHoliday(holiday, payableHolidayTypes = []) {
  if (holiday?.statutoryHolidayPayable === true) return true;
  if (holiday?.statutoryHolidayPayable === false) return false;
  const type = resolveHolidayType(holiday);
  const allowed = Array.isArray(payableHolidayTypes) && payableHolidayTypes.length
    ? payableHolidayTypes
    : timesheetParametersPolicyService.DEFAULT_STATUTORY_HOLIDAY_PAY.payableHolidayTypes;
  return allowed.includes(type);
}

function buildStatHolidaySessionId(holidayId, personId) {
  return `stathol-${String(holidayId || '').trim()}-${String(personId || '').trim()}`;
}

function cleanId(value) {
  return String(value ?? '').trim();
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
    if (checks.leaveBeforeAfter?.boundariesResolved === false) {
      const missing = [];
      if (checks.leaveBeforeAfter?.missingBeforeBoundary) missing.push('before');
      if (checks.leaveBeforeAfter?.missingAfterBoundary) missing.push('after');
      if (missing.length) {
        reasons.push(`Could not resolve ${missing.join(' and ')} boundary workday within the search window.`);
      } else {
        reasons.push('Approved leave on the last or first adjacent payable workday.');
      }
    } else {
      reasons.push('Approved leave on the last or first adjacent payable workday.');
    }
  }
  if (checks.calculatedHours?.pass === false) {
    reasons.push('No payable workdays in the earnings lookback window.');
  }
  return reasons;
}

const WEEKDAY_NAMES = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);

function evaluateHolidayEligibility({
  holiday,
  policy,
  workdayHistory,
  leaveDates = new Set(),
  supplementalHoursByDate = new Map()
}) {
  const statPolicy = policy?.statutoryHolidayPay || timesheetParametersPolicyService.DEFAULT_STATUTORY_HOLIDAY_PAY;
  const date = resolveHolidayDate(holiday);
  const weekday = getWeekday(date);
  const weekdayName = WEEKDAY_NAMES[weekday] || 'weekday';

  const hasLeaveOnDate = (targetDate) => {
    const token = String(targetDate || '').trim();
    return token ? leaveDates.has(token) : false;
  };

  const payableOnHoliday = Number(workdayHistory.getHours(date) || 0)
    + Number(supplementalHoursByDate.get(date) || 0);

  const actualWorkdays = workdayHistory.countWorkdaysBefore(date);
  const minWorkdaysPass = actualWorkdays >= statPolicy.minWorkdays;

  const weekdayActual = workdayHistory.countWeekdayOccurrences(
    weekday,
    date,
    statPolicy.weekdayOccurrencesLookback
  );
  const weekdayRulePass = weekdayActual >= statPolicy.weekdayOccurrencesRequired;
  const regularWorkday = weekdayRulePass;
  const workedOnHoliday = payableOnHoliday > 0;
  const workdayMatchPass = regularWorkday || workedOnHoliday;

  let holidayAttendancePass = true;
  let holidayAttendanceReason = 'No approved leave on the statutory holiday date.';
  if (regularWorkday && hasLeaveOnDate(date)) {
    holidayAttendancePass = false;
    holidayAttendanceReason = 'Approved leave on statutory holiday.';
  }

  const weekRange = getHolidayWeekRange(date);
  const leaveDuringWeekIds = [];
  leaveDates.forEach((leaveDate) => {
    if (leaveDate >= weekRange.start && leaveDate <= weekRange.end) leaveDuringWeekIds.push(leaveDate);
  });
  const enforceWeekLeaveRule = statPolicy.disqualifyOnLeaveDuringHolidayWeek === true;
  const leaveDuringHolidayWeekPass = !enforceWeekLeaveRule || leaveDuringWeekIds.length === 0;

  const beforeDate = workdayHistory.lastWorkdayBefore(date, statPolicy.beforeAfterSearchDays);
  const afterDate = workdayHistory.firstWorkdayAfter(date, statPolicy.beforeAfterSearchDays);
  const leaveBeforeAfterIds = [];
  if (beforeDate && hasLeaveOnDate(beforeDate)) leaveBeforeAfterIds.push(beforeDate);
  if (afterDate && hasLeaveOnDate(afterDate)) leaveBeforeAfterIds.push(afterDate);
  const boundariesResolved = Boolean(beforeDate) && Boolean(afterDate);
  const leaveBeforeAfterPass = !statPolicy.disqualifyOnLeaveBeforeAfter
    || (boundariesResolved && leaveBeforeAfterIds.length === 0);

  const earningsEnd = addDays(date, -1);
  const earningsStart = addDays(earningsEnd, -(statPolicy.earningsLookbackWeeks * 7 - 1));
  const totalHours = workdayHistory.totalHoursInRange(earningsStart, earningsEnd);
  const earningsWorkdays = workdayHistory.workdayCountInRange(earningsStart, earningsEnd);
  const calculatedHours = earningsWorkdays > 0
    ? Number((totalHours / earningsWorkdays).toFixed(2))
    : 0;
  const calculatedHoursPass = calculatedHours > 0;

  const checks = {
    minWorkdays: {
      pass: minWorkdaysPass,
      actual: actualWorkdays,
      required: statPolicy.minWorkdays
    },
    weekdayRule: {
      pass: weekdayRulePass,
      actual: weekdayActual,
      required: statPolicy.weekdayOccurrencesRequired,
      lookback: statPolicy.weekdayOccurrencesLookback,
      weekday,
      weekdayName
    },
    workdayMatch: {
      pass: workdayMatchPass,
      regularWorkday,
      workedOnHoliday
    },
    holidayAttendance: {
      pass: holidayAttendancePass,
      reason: holidayAttendanceReason
    },
    leaveDuringHolidayWeek: enforceWeekLeaveRule ? {
      pass: leaveDuringHolidayWeekPass,
      leaveDates: leaveDuringWeekIds
    } : undefined,
    leaveBeforeAfter: {
      pass: leaveBeforeAfterPass,
      beforeDate,
      afterDate,
      leaveDates: leaveBeforeAfterIds,
      boundariesResolved,
      missingBeforeBoundary: !beforeDate,
      missingAfterBoundary: !afterDate
    },
    calculatedHours: {
      pass: calculatedHoursPass,
      earningsStart,
      earningsEnd,
      totalHours,
      workdayCount: earningsWorkdays,
      averageHours: calculatedHours
    }
  };

  const qualified = minWorkdaysPass
    && workdayMatchPass
    && holidayAttendancePass
    && leaveDuringHolidayWeekPass
    && leaveBeforeAfterPass
    && calculatedHoursPass;

  const disqualifyReasons = summarizeDisqualifyReasons(checks);

  return {
    holidayId: String(holiday?.id || '').trim(),
    date,
    title: resolveHolidayTitle(holiday),
    type: resolveHolidayType(holiday),
    qualified,
    calculatedHours,
    checks,
    disqualifyReasons
  };
}

function buildSupplementalHoursByDate(entries = []) {
  const map = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!isPayableWorkdayEntry(entry)) return;
    const date = String(entry?.date || '').trim();
    if (!date) return;
    const hours = timesheetPrintService.resolvePayableHours(entry);
    if (hours <= 0) return;
    map.set(date, Number(((map.get(date) || 0) + hours).toFixed(2)));
  });
  return map;
}

function resolveExistingOverride(existingEntry = null) {
  const override = existingEntry?.statHolidayOverride;
  if (!override || typeof override !== 'object') return null;
  return override;
}

const MAX_STAT_HOLIDAY_PAY_HOURS = 24;

function resolveStatHolidayPayHours({
  evaluation,
  existingEntry = null,
  allowManagerOverride = false
} = {}) {
  const override = resolveExistingOverride(existingEntry);
  const forcePay = override?.forcePay === true;
  const forceDisqualify = override?.forcePay === false;
  const shouldPay = (evaluation.qualified && !forceDisqualify) || forcePay;
  if (!shouldPay) {
    return { shouldPay: false, hours: 0, blockReason: 'not_qualified' };
  }

  let hours = evaluation.calculatedHours;
  if (allowManagerOverride && override && Number.isFinite(Number(override.hours))) {
    hours = Number(Number(override.hours).toFixed(2));
  }
  if (hours > MAX_STAT_HOLIDAY_PAY_HOURS) {
    return { shouldPay: false, hours, blockReason: 'exceeds_max_payable_hours' };
  }
  return { shouldPay: true, hours, blockReason: '' };
}

function buildStatHolidayWarning({
  evaluation,
  existingEntry = null,
  allowManagerOverride = false
} = {}) {
  const payResolution = resolveStatHolidayPayHours({ evaluation, existingEntry, allowManagerOverride });
  if (payResolution.shouldPay) return null;
  const reasons = [...(Array.isArray(evaluation?.disqualifyReasons) ? evaluation.disqualifyReasons : [])];
  if (payResolution.blockReason === 'exceeds_max_payable_hours') {
    reasons.push(
      `Calculated statutory holiday hours (${payResolution.hours}) exceed the maximum payable per day (${MAX_STAT_HOLIDAY_PAY_HOURS}).`
    );
  }
  if (!reasons.length) {
    reasons.push('Statutory holiday pay could not be calculated automatically.');
  }
  return {
    holidayId: evaluation.holidayId,
    date: evaluation.date,
    title: evaluation.title,
    reasons,
    checks: evaluation.checks,
    calculatedHours: evaluation.calculatedHours
  };
}

function buildStatHolidayRow({
  evaluation,
  personId,
  existingEntry = null,
  allowManagerOverride = false
}) {
  const override = resolveExistingOverride(existingEntry);
  const sessionId = buildStatHolidaySessionId(evaluation.holidayId, personId);
  const payResolution = resolveStatHolidayPayHours({ evaluation, existingEntry, allowManagerOverride });
  const hours = payResolution.shouldPay ? payResolution.hours : 0;

  const row = {
    sessionId,
    date: evaluation.date,
    className: evaluation.title,
    description: 'Statutory holiday pay',
    hours,
    timesheetHours: hours,
    durationHours: hours,
    isStatutoryHoliday: true,
    isManual: false,
    isFinalStatus: true,
    status: payResolution.shouldPay ? 'stat_holiday' : 'stat_holiday_not_qualified',
    statHolidayMeta: {
      holidayId: evaluation.holidayId,
      qualified: evaluation.qualified,
      calculatedHours: evaluation.calculatedHours,
      checks: evaluation.checks,
      disqualifyReasons: evaluation.disqualifyReasons,
      payBlockedReason: payResolution.blockReason || ''
    }
  };

  if (override) {
    row.statHolidayOverride = { ...override };
  }

  if (existingEntry?.comment) row.comment = String(existingEntry.comment || '').trim();

  return row;
}

function resolveStatHolidayActivityId(policy = {}) {
  const resolved = timesheetParametersPolicyService.resolvePolicy(policy);
  return String(resolved?.statutoryHolidayPay?.activityId || '').trim();
}

function usesStatHolidayActivityMode(policy = {}) {
  return Boolean(resolveStatHolidayActivityId(policy));
}

function normalizeOverrideInput(override = null) {
  if (!override || typeof override !== 'object') return null;
  return { ...override };
}

function buildOverrideLookup(existingEntries = [], overrideMap = null) {
  const lookup = new Map();
  (Array.isArray(existingEntries) ? existingEntries : []).forEach((entry) => {
    const sessionId = String(entry?.sessionId || '').trim();
    const holidayId = cleanId(entry?.statHolidayMeta?.holidayId);
    if (holidayId) {
      lookup.set(holidayId, entry);
      return;
    }
    if (sessionId.startsWith('stathol-')) {
      const parts = sessionId.split('-');
      if (parts.length >= 3) lookup.set(parts[1], entry);
    }
  });
  if (overrideMap && typeof overrideMap === 'object' && !Array.isArray(overrideMap)) {
    Object.entries(overrideMap).forEach(([holidayId, override]) => {
      const key = cleanId(holidayId);
      if (!key) return;
      const prior = lookup.get(key) || {};
      lookup.set(key, {
        ...prior,
        statHolidayOverride: normalizeOverrideInput(override)
      });
    });
  }
  return lookup;
}

function buildStatHolidayPayItems({
  evaluations = [],
  existingByHolidayId = new Map(),
  allowManagerOverride = false
} = {}) {
  return (Array.isArray(evaluations) ? evaluations : []).map((evaluation) => {
    const existingEntry = existingByHolidayId.get(cleanId(evaluation?.holidayId)) || null;
    const payResolution = resolveStatHolidayPayHours({
      evaluation,
      existingEntry,
      allowManagerOverride
    });
    return {
      evaluation,
      existingEntry,
      payResolution,
      hours: payResolution.shouldPay ? payResolution.hours : 0
    };
  });
}

function mergeWorkdaySourceEntries(periodEntries = [], supplementalEntries = []) {
  const merged = [];
  const seenSessionIds = new Set();
  [...(Array.isArray(periodEntries) ? periodEntries : []), ...(Array.isArray(supplementalEntries) ? supplementalEntries : [])]
    .forEach((entry) => {
      if (!entry || entry.isDeleted === true || entry.isStatutoryHoliday === true) return;
      const sessionId = String(entry?.sessionId || '').trim();
      if (sessionId) {
        if (seenSessionIds.has(sessionId)) return;
        seenSessionIds.add(sessionId);
      }
      merged.push(entry);
    });
  return merged;
}

function isStatHolidayActivitySupplementalEntry(entry = {}) {
  return Boolean(cleanId(entry?.statHolidayId) && cleanId(entry?.statHolidayPersonId));
}

function assemblePeriodWorkdayEntries(existingEntries = [], liveSessions = []) {
  const entries = Array.isArray(existingEntries) ? existingEntries : [];
  const live = Array.isArray(liveSessions) ? liveSessions : [];
  const deletedAutoSessionIds = new Set(
    entries
      .filter((entry) => entry?.isDeleted === true)
      .map((entry) => String(entry?.sessionId || '').trim())
      .filter(Boolean)
  );
  const savedRows = entries.filter((entry) => {
    if (!entry || entry.isDeleted === true || entry.isStatutoryHoliday === true) return false;
    if (isStatHolidayActivitySupplementalEntry(entry)) return false;
    if (entry.isManual === true) return true;
    return timesheetLegacyImportService.isLegacyImportEntry(entry);
  });
  const autoRows = live.filter((entry) => {
    const sessionId = String(entry?.sessionId || '').trim();
    if (!sessionId || deletedAutoSessionIds.has(sessionId)) return false;
    if (isStatHolidayActivitySupplementalEntry(entry)) return false;
    return true;
  });
  return [...savedRows, ...autoRows];
}

async function buildStatutoryHolidayTimesheetContext({
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
    return { rows: [], warnings: [], evaluations: [], usesActivityMode: Boolean(activityId), activityId };
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

  const workdayHistory = await buildWorkdayHistory({
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
  const existingByHolidayId = buildOverrideLookup(existingEntries, overrideMap);

  const rows = [];
  const warnings = [];
  const evaluations = [];

  payableHolidays.forEach((holiday) => {
    const evaluation = evaluateHolidayEligibility({
      holiday,
      policy: resolvedPolicy,
      workdayHistory,
      leaveDates,
      supplementalHoursByDate
    });
    evaluations.push(evaluation);
    const sessionId = buildStatHolidaySessionId(evaluation.holidayId, personId);
    const existingEntry = existingByHolidayId.get(cleanId(evaluation.holidayId))
      || existingBySessionId.get(sessionId)
      || null;
    const row = buildStatHolidayRow({
      evaluation,
      personId,
      existingEntry,
      allowManagerOverride
    });
    rows.push(row);
    const warning = buildStatHolidayWarning({
      evaluation,
      existingEntry,
      allowManagerOverride
    });
    if (warning) warnings.push(warning);
  });

  return {
    rows,
    warnings,
    evaluations,
    usesActivityMode: Boolean(activityId),
    activityId
  };
}

function buildTrustedStatHolidayEntry({
  entry,
  trustedRow,
  existingEntry = null,
  allowManagerOverride = false,
  actor = null
}) {
  if (!trustedRow) {
    return {
      sessionId: String(entry?.sessionId || '').trim(),
      isDeleted: true,
      ignoredReason: 'ineligible_stat_holiday'
    };
  }

  const overrideInput = allowManagerOverride ? entry?.statHolidayOverride : null;
  const existingOverride = resolveExistingOverride(existingEntry);
  let override = existingOverride ? { ...existingOverride } : null;

  if (allowManagerOverride && overrideInput && typeof overrideInput === 'object') {
    override = {
      ...(override || {}),
      ...overrideInput
    };
    if (overrideInput.forcePay === true || overrideInput.forcePay === false) {
      override.forcePay = overrideInput.forcePay === true;
    }
    if (Number.isFinite(Number(overrideInput.hours))) {
      override.hours = Number(Number(overrideInput.hours).toFixed(2));
    }
    if (overrideInput.reason !== undefined) {
      override.reason = String(overrideInput.reason || '').trim();
    }
    if (actor?.id) override.by = String(actor.id);
    if (actor?.name) override.byName = String(actor.name);
    override.at = new Date().toISOString();
  }

  const forcePay = override?.forcePay === true;
  const forceDisqualify = override?.forcePay === false;
  const shouldPay = (trustedRow.statHolidayMeta?.qualified && !forceDisqualify) || forcePay;

  let hours = 0;
  let payBlockedReason = trustedRow.statHolidayMeta?.payBlockedReason || '';
  if (shouldPay) {
    hours = trustedRow.hours ?? trustedRow.statHolidayMeta?.calculatedHours ?? 0;
    if (override && Number.isFinite(Number(override.hours))) {
      hours = Number(Number(override.hours).toFixed(2));
    }
    if (hours > MAX_STAT_HOLIDAY_PAY_HOURS) {
      hours = 0;
      payBlockedReason = 'exceeds_max_payable_hours';
    }
  } else {
    payBlockedReason = payBlockedReason || 'not_qualified';
  }

  const result = {
    sessionId: trustedRow.sessionId,
    date: trustedRow.date,
    className: trustedRow.className,
    description: trustedRow.description || 'Statutory holiday pay',
    hours,
    timesheetHours: hours,
    durationHours: hours,
    isStatutoryHoliday: true,
    isManual: false,
    isFinalStatus: true,
    status: hours > 0 ? 'stat_holiday' : 'stat_holiday_not_qualified',
    comment: String(entry?.comment || trustedRow.comment || '').trim(),
    deliveryDepartmentId: String(entry?.deliveryDepartmentId || trustedRow.deliveryDepartmentId || '').trim(),
    deliveryDepartmentName: String(entry?.deliveryDepartmentName || trustedRow.deliveryDepartmentName || '').trim(),
    statHolidayMeta: {
      ...(trustedRow.statHolidayMeta || {}),
      payBlockedReason
    }
  };

  if (override) result.statHolidayOverride = override;
  return result;
}

module.exports = {
  PAYABLE_HOLIDAY_TYPES: timesheetParametersPolicyService.PAYABLE_HOLIDAY_TYPES,
  MAX_STAT_HOLIDAY_PAY_HOURS,
  isStatHolidayActivitySupplementalEntry,
  assemblePeriodWorkdayEntries,
  buildStatHolidaySessionId,
  buildStatHolidayRow,
  buildStatHolidayWarning,
  buildStatHolidayPayItems,
  buildOverrideLookup,
  evaluateHolidayEligibility,
  buildStatutoryHolidayTimesheetContext,
  buildTrustedStatHolidayEntry,
  resolveStatHolidayActivityId,
  usesStatHolidayActivityMode,
  resolveStatHolidayPayHours,
  isPayableHoliday,
  resolveHolidayDate,
  resolveHolidayTitle
};
