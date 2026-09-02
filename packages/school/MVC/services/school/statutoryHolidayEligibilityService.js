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
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function getHolidayWeekRange(holidayDate) {
  const weekday = getWeekday(holidayDate);
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const start = addDays(holidayDate, mondayOffset);
  return { start, end: addDays(start, 6) };
}

function resolveHolidayDate(holiday = {}) {
  return String(holiday?.date || holiday?.holidayDate || '').trim();
}

function resolveHolidayTitle(holiday = {}) {
  return String(holiday?.title || holiday?.name || holiday?.holidayName || holiday?.label || 'Statutory holiday').trim();
}

function resolveHolidayType(holiday = {}) {
  return String(holiday?.type || holiday?.holidayType || '').trim();
}

function isPayableHoliday(holiday, payableHolidayTypes = []) {
  const type = resolveHolidayType(holiday);
  const allowed = Array.isArray(payableHolidayTypes) && payableHolidayTypes.length
    ? payableHolidayTypes
    : timesheetParametersPolicyService.DEFAULT_STATUTORY_HOLIDAY_PAY.payableHolidayTypes;
  return allowed.includes(type);
}

function buildStatHolidaySessionId(holidayId, personId) {
  return `stathol-${String(holidayId || '').trim()}-${String(personId || '').trim()}`;
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
    reasons.push(checks.holidayAttendance.reason || 'Absent on statutory holiday.');
  }
  if (checks.leaveDuringHolidayWeek?.pass === false) {
    reasons.push('Approved leave overlaps the calendar week of the holiday.');
  }
  if (checks.leaveBeforeAfter?.pass === false) {
    reasons.push('Approved leave on the last or first adjacent payable workday.');
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
  let holidayAttendanceReason = '';
  if (regularWorkday) {
    if (hasLeaveOnDate(date)) {
      holidayAttendancePass = false;
      holidayAttendanceReason = 'Approved leave on statutory holiday.';
    } else if (!workedOnHoliday) {
      holidayAttendancePass = false;
      holidayAttendanceReason = 'Expected to work on this regular workday but no payable hours were logged.';
    }
  }

  const weekRange = getHolidayWeekRange(date);
  const leaveDuringWeekIds = [];
  leaveDates.forEach((leaveDate) => {
    if (leaveDate >= weekRange.start && leaveDate <= weekRange.end) leaveDuringWeekIds.push(leaveDate);
  });
  const leaveDuringHolidayWeekPass = !statPolicy.disqualifyOnLeaveDuringHolidayWeek || leaveDuringWeekIds.length === 0;

  const beforeDate = workdayHistory.lastWorkdayBefore(date, statPolicy.beforeAfterSearchDays);
  const afterDate = workdayHistory.firstWorkdayAfter(date, statPolicy.beforeAfterSearchDays);
  const leaveBeforeAfterIds = [];
  if (beforeDate && hasLeaveOnDate(beforeDate)) leaveBeforeAfterIds.push(beforeDate);
  if (afterDate && hasLeaveOnDate(afterDate)) leaveBeforeAfterIds.push(afterDate);
  const leaveBeforeAfterPass = !statPolicy.disqualifyOnLeaveBeforeAfter || leaveBeforeAfterIds.length === 0;

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
    leaveDuringHolidayWeek: {
      pass: leaveDuringHolidayWeekPass,
      leaveDates: leaveDuringWeekIds
    },
    leaveBeforeAfter: {
      pass: leaveBeforeAfterPass,
      beforeDate,
      afterDate,
      leaveDates: leaveBeforeAfterIds
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

function buildStatHolidayRow({
  evaluation,
  personId,
  existingEntry = null,
  allowManagerOverride = false
}) {
  const override = resolveExistingOverride(existingEntry);
  const sessionId = buildStatHolidaySessionId(evaluation.holidayId, personId);
  const forcePay = override?.forcePay === true;
  const forceDisqualify = override?.forcePay === false;
  const shouldPay = (evaluation.qualified && !forceDisqualify) || forcePay;
  if (!shouldPay) return null;

  let hours = evaluation.calculatedHours;
  if (allowManagerOverride && override && Number.isFinite(Number(override.hours))) {
    hours = Number(Number(override.hours).toFixed(2));
  }

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
    status: 'stat_holiday',
    statHolidayMeta: {
      holidayId: evaluation.holidayId,
      qualified: evaluation.qualified,
      calculatedHours: evaluation.calculatedHours,
      checks: evaluation.checks,
      disqualifyReasons: evaluation.disqualifyReasons
    }
  };

  if (override) {
    row.statHolidayOverride = { ...override };
  }

  if (existingEntry?.comment) row.comment = String(existingEntry.comment || '').trim();

  return row;
}

async function buildStatutoryHolidayTimesheetContext({
  orgId,
  personId,
  periodStartDate,
  periodEndDate,
  policy,
  holidays = [],
  supplementalEntries = [],
  existingEntries = [],
  reqUser,
  allowManagerOverride = false
} = {}) {
  const resolvedPolicy = timesheetParametersPolicyService.resolvePolicy(policy);
  const statPolicy = resolvedPolicy.statutoryHolidayPay;
  if (!statPolicy?.enabled) {
    return { rows: [], warnings: [] };
  }

  const payableHolidays = (Array.isArray(holidays) ? holidays : [])
    .filter((holiday) => {
      const date = resolveHolidayDate(holiday);
      return date
        && date >= String(periodStartDate || '')
        && date <= String(periodEndDate || '')
        && isPayableHoliday(holiday, statPolicy.payableHolidayTypes);
    });

  if (!payableHolidays.length) {
    return { rows: [], warnings: [] };
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

  const workdayHistory = await buildWorkdayHistory({
    orgId,
    personId,
    endDate: maxHolidayDate,
    lookbackDays,
    reqUser,
    supplementalEntries
  });

  const supplementalHoursByDate = buildSupplementalHoursByDate(supplementalEntries);
  const existingBySessionId = new Map(
    (Array.isArray(existingEntries) ? existingEntries : [])
      .filter((entry) => entry && entry.isDeleted !== true)
      .map((entry) => [String(entry?.sessionId || '').trim(), entry])
      .filter(([sessionId]) => Boolean(sessionId))
  );

  const rows = [];
  const warnings = [];

  payableHolidays.forEach((holiday) => {
    const evaluation = evaluateHolidayEligibility({
      holiday,
      policy: resolvedPolicy,
      workdayHistory,
      leaveDates,
      supplementalHoursByDate
    });
    const sessionId = buildStatHolidaySessionId(evaluation.holidayId, personId);
    const existingEntry = existingBySessionId.get(sessionId) || null;
    const row = buildStatHolidayRow({
      evaluation,
      personId,
      existingEntry,
      allowManagerOverride
    });
    if (row) {
      rows.push(row);
      return;
    }
    warnings.push({
      holidayId: evaluation.holidayId,
      date: evaluation.date,
      title: evaluation.title,
      reasons: evaluation.disqualifyReasons,
      checks: evaluation.checks,
      calculatedHours: evaluation.calculatedHours
    });
  });

  return { rows, warnings };
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
  if (!shouldPay) {
    return {
      sessionId: trustedRow.sessionId,
      isDeleted: true,
      ignoredReason: 'stat_holiday_disqualified'
    };
  }

  let hours = trustedRow.hours ?? trustedRow.statHolidayMeta?.calculatedHours ?? 0;
  if (override && Number.isFinite(Number(override.hours))) {
    hours = Number(Number(override.hours).toFixed(2));
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
    status: 'stat_holiday',
    comment: String(entry?.comment || trustedRow.comment || '').trim(),
    statHolidayMeta: trustedRow.statHolidayMeta
  };

  if (override) result.statHolidayOverride = override;
  return result;
}

module.exports = {
  PAYABLE_HOLIDAY_TYPES: timesheetParametersPolicyService.PAYABLE_HOLIDAY_TYPES,
  buildStatHolidaySessionId,
  buildStatHolidayRow,
  evaluateHolidayEligibility,
  buildStatutoryHolidayTimesheetContext,
  buildTrustedStatHolidayEntry,
  isPayableHoliday,
  resolveHolidayDate,
  resolveHolidayTitle
};
