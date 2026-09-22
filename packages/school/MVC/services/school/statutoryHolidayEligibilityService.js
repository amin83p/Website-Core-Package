'use strict';

const leaveRequestService = require('./leaveRequestService');
const timesheetParametersPolicyService = require('./timesheetParametersPolicyService');
const statutoryHolidaySchemeService = require('./statutoryHolidaySchemeService');
const {
  addDays,
  getWeekday,
  buildWorkdayHistory,
  isPayableWorkdayEntry,
  isWorkdayHistory
} = require('./timesheetWorkdayHistoryService');
const timesheetPrintService = require('./timesheetPrintService');
const timesheetLegacyImportService = require('./timesheetLegacyImportService');
const {
  isStatutoryHolidayRoundingEnabled,
  applyStatutoryHolidayHoursRounding
} = require('./statutoryHolidayHoursRoundingService');
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

function buildStatHolidaySessionId(holidayId, personId, schemeId = '') {
  const holidayKey = String(holidayId || '').trim();
  const personKey = String(personId || '').trim();
  const schemeKey = cleanId(schemeId) || statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM;
  if (schemeKey && schemeKey !== statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM) {
    return `stathol-${schemeKey}-${holidayKey}-${personKey}`;
  }
  return `stathol-${holidayKey}-${personKey}`;
}

function parseStatHolidaySessionParts(sessionId = '', personId = '') {
  const normalized = String(sessionId || '').trim();
  if (!normalized.toLowerCase().startsWith('stathol-')) {
    return { schemeId: '', holidayId: '', personId: '' };
  }
  const suffix = String(personId || '').trim();
  const withoutPrefix = normalized.slice('stathol-'.length);
  let body = withoutPrefix;
  if (suffix && withoutPrefix.endsWith(`-${suffix}`)) {
    body = withoutPrefix.slice(0, -(suffix.length + 1));
  }
  const parts = body.split('-');
  if (!parts.length) {
    return { schemeId: '', holidayId: '', personId: suffix };
  }
  const first = cleanId(parts[0]);
  if (statutoryHolidaySchemeService.BUILTIN_SCHEME_IDS.includes(first)) {
    return {
      schemeId: first,
      holidayId: cleanId(parts.slice(1).join('-')),
      personId: suffix
    };
  }
  return {
    schemeId: statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM,
    holidayId: cleanId(body),
    personId: suffix
  };
}

function parseStatHolidaySessionHolidayId(sessionId = '', personId = '') {
  return parseStatHolidaySessionParts(sessionId, personId).holidayId;
}

function parseStatHolidaySessionSchemeId(sessionId = '', personId = '') {
  const parsed = parseStatHolidaySessionParts(sessionId, personId);
  return parsed.schemeId || statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM;
}

function cleanId(value) {
  return String(value ?? '').trim();
}

function entryHasStatHolidayOverride(entry = null) {
  return Boolean(entry?.statHolidayOverride && typeof entry.statHolidayOverride === 'object');
}

function mergeStatHolidayOverrideEntries(prior = null, next = null) {
  if (!next) return prior;
  if (!prior) return next;
  const priorOverride = entryHasStatHolidayOverride(prior) ? prior.statHolidayOverride : null;
  const nextOverride = entryHasStatHolidayOverride(next) ? next.statHolidayOverride : null;
  if (!priorOverride) return next;
  if (!nextOverride) return prior;
  return {
    ...prior,
    ...next,
    statHolidayOverride: {
      ...priorOverride,
      ...nextOverride
    }
  };
}

function resolveStatHolidayEntrySchemeId(entry = {}, existingEntries = [], personId = '') {
  const fromMeta = cleanId(entry?.statHolidayMeta?.schemeId);
  if (fromMeta) return fromMeta;
  const sessionId = String(entry?.sessionId || '').trim();
  if (sessionId) {
    return parseStatHolidaySessionSchemeId(sessionId, personId);
  }
  const date = cleanId(entry?.date);
  if (!date) return statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM;
  const peer = (Array.isArray(existingEntries) ? existingEntries : []).find((row) => {
    if (cleanId(row?.date) !== date) return false;
    return Boolean(cleanId(row?.statHolidayMeta?.schemeId));
  });
  return cleanId(peer?.statHolidayMeta?.schemeId)
    || statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM;
}

function resolveStatHolidayEntryHolidayId(entry = {}, existingEntries = [], personId = '') {
  const sessionId = String(entry?.sessionId || '').trim();
  const direct = cleanId(entry?.statHolidayMeta?.holidayId || entry?.statHolidayId)
    || parseStatHolidaySessionHolidayId(sessionId, personId);
  if (direct) return direct;

  const date = cleanId(entry?.date);
  if (!date) return '';

  const peer = (Array.isArray(existingEntries) ? existingEntries : []).find((row) => {
    if (cleanId(row?.date) !== date) return false;
    return Boolean(
      cleanId(row?.statHolidayMeta?.holidayId || row?.statHolidayId)
      || parseStatHolidaySessionHolidayId(String(row?.sessionId || '').trim(), personId)
    );
  });
  if (!peer) return '';

  return cleanId(peer?.statHolidayMeta?.holidayId || peer?.statHolidayId)
    || parseStatHolidaySessionHolidayId(String(peer?.sessionId || '').trim(), personId);
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

function isDifferentCalendarMonth(holidayDate, boundaryDate) {
  const holiday = String(holidayDate || '').trim();
  const boundary = String(boundaryDate || '').trim();
  if (!holiday || !boundary || holiday.length < 7 || boundary.length < 7) return false;
  return holiday.slice(0, 7) !== boundary.slice(0, 7);
}

function buildLeaveBeforeAfterCheck({
  date,
  workdayHistory,
  leaveDates = new Set(),
  beforeAfterSearchDays = 14,
  enforce = true,
  skipAfterBoundaryInNextMonth = false
} = {}) {
  const hasLeaveOnDate = (targetDate) => {
    const token = String(targetDate || '').trim();
    return token ? leaveDates.has(token) : false;
  };
  const beforeDate = workdayHistory.lastWorkdayBefore(date, beforeAfterSearchDays);
  const rawAfterDate = workdayHistory.firstWorkdayAfter(date, beforeAfterSearchDays);
  const afterBoundarySkippedNextMonth = Boolean(
    skipAfterBoundaryInNextMonth
    && rawAfterDate
    && isDifferentCalendarMonth(date, rawAfterDate)
  );
  const afterDate = afterBoundarySkippedNextMonth ? '' : (rawAfterDate || '');
  const afterDateIgnored = afterBoundarySkippedNextMonth ? rawAfterDate : '';
  const leaveBeforeAfterIds = [];
  if (beforeDate && hasLeaveOnDate(beforeDate)) leaveBeforeAfterIds.push(beforeDate);
  if (!afterBoundarySkippedNextMonth && rawAfterDate && hasLeaveOnDate(rawAfterDate)) {
    leaveBeforeAfterIds.push(rawAfterDate);
  }
  const afterBoundaryWaivedNoWorkday = Boolean(
    skipAfterBoundaryInNextMonth && !rawAfterDate
  );
  const afterBoundarySatisfied = afterBoundarySkippedNextMonth
    || Boolean(rawAfterDate)
    || afterBoundaryWaivedNoWorkday;
  const boundariesResolved = Boolean(beforeDate) && afterBoundarySatisfied;
  const pass = !enforce || (boundariesResolved && leaveBeforeAfterIds.length === 0);
  const result = {
    pass,
    beforeDate,
    afterDate,
    afterDateIgnored,
    afterBoundarySkippedNextMonth,
    leaveDates: leaveBeforeAfterIds,
    boundariesResolved,
    missingBeforeBoundary: !beforeDate,
    missingAfterBoundary: (afterBoundarySkippedNextMonth || afterBoundaryWaivedNoWorkday)
      ? false
      : !rawAfterDate,
    afterBoundaryWaivedNoWorkday
  };
  return result;
}

function evaluateHolidayEligibility({
  holiday,
  policy,
  workdayHistory,
  leaveDates = new Set(),
  supplementalHoursByDate = new Map(),
  boundaryWorkdayHistory = null
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

  const boundaryHistory = isWorkdayHistory(boundaryWorkdayHistory)
    ? boundaryWorkdayHistory
    : workdayHistory;
  const leaveBeforeAfter = buildLeaveBeforeAfterCheck({
    date,
    workdayHistory: boundaryHistory,
    leaveDates,
    beforeAfterSearchDays: statPolicy.beforeAfterSearchDays,
    enforce: statPolicy.disqualifyOnLeaveBeforeAfter,
    skipAfterBoundaryInNextMonth: statPolicy.skipAfterBoundaryInNextMonth === true
  });
  const leaveBeforeAfterPass = leaveBeforeAfter.pass;

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
      beforeDate: leaveBeforeAfter.beforeDate,
      afterDate: leaveBeforeAfter.afterDate,
      afterDateIgnored: leaveBeforeAfter.afterDateIgnored,
      afterBoundarySkippedNextMonth: leaveBeforeAfter.afterBoundarySkippedNextMonth,
      afterBoundaryWaivedNoWorkday: leaveBeforeAfter.afterBoundaryWaivedNoWorkday,
      leaveDates: leaveBeforeAfter.leaveDates,
      boundariesResolved: leaveBeforeAfter.boundariesResolved,
      missingBeforeBoundary: leaveBeforeAfter.missingBeforeBoundary,
      missingAfterBoundary: leaveBeforeAfter.missingAfterBoundary
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

function isStatHolidayPlanningWorkdayEntry(entry = {}) {
  return timesheetPrintService.isStatHolidayPlanningWorkdayEntry(entry);
}

function buildSupplementalHoursByDate(entries = []) {
  const map = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!isStatHolidayPlanningWorkdayEntry(entry)) return;
    const date = String(entry?.date || '').trim();
    if (!date) return;
    const hours = timesheetPrintService.resolveStatHolidayPlanningHours(entry);
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
  allowManagerOverride = false,
  schemeCalculatedHours = null,
  policy = null
} = {}) {
  const roundingEnabled = isStatutoryHolidayRoundingEnabled(
    policy ? timesheetParametersPolicyService.resolvePolicy(policy) : {}
  );
  const override = resolveExistingOverride(existingEntry);
  const forcePay = override?.forcePay === true;
  const forceDisqualify = override?.forcePay === false;
  const shouldPay = (evaluation.qualified && !forceDisqualify) || forcePay;
  if (!shouldPay) {
    return { shouldPay: false, hours: 0, blockReason: 'not_qualified' };
  }

  let hours = Number.isFinite(Number(schemeCalculatedHours))
    ? Number(schemeCalculatedHours)
    : evaluation.calculatedHours;
  hours = applyStatutoryHolidayHoursRounding(hours, { enabled: roundingEnabled });
  if (allowManagerOverride && override && Number.isFinite(Number(override.hours))) {
    hours = applyStatutoryHolidayHoursRounding(
      Number(Number(override.hours).toFixed(2)),
      { enabled: roundingEnabled }
    );
  }
  if (hours > MAX_STAT_HOLIDAY_PAY_HOURS) {
    return { shouldPay: false, hours, blockReason: 'exceeds_max_payable_hours' };
  }
  return { shouldPay: true, hours, blockReason: '' };
}

function buildStatHolidayWarning({
  evaluation,
  existingEntry = null,
  allowManagerOverride = false,
  schemeId = '',
  schemeResult = null,
  policy = null
} = {}) {
  const resolvedSchemeId = cleanId(schemeId)
    || cleanId(schemeResult?.schemeId)
    || statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM;
  const schemeConfig = statutoryHolidaySchemeService.resolveSchemeConfig(resolvedSchemeId);
  const schemeCalculatedHours = Number.isFinite(Number(evaluation?.calculatedHours))
    ? Number(evaluation.calculatedHours)
    : (Number.isFinite(Number(schemeResult?.calculatedHours))
      ? Number(schemeResult.calculatedHours)
      : 0);
  const payResolution = resolveStatHolidayPayHours({
    evaluation,
    existingEntry,
    allowManagerOverride,
    schemeCalculatedHours,
    policy
  });
  if (payResolution.shouldPay) return null;
  const reasons = [...(Array.isArray(evaluation?.disqualifyReasons) ? evaluation.disqualifyReasons : [])];
  if (payResolution.blockReason === 'exceeds_max_payable_hours') {
    reasons.push(
      `Calculated statutory holiday hours (${payResolution.hours}) exceed the maximum payable per day (${MAX_STAT_HOLIDAY_PAY_HOURS}).`
    );
  }
  if (!reasons.length && Number(schemeCalculatedHours) <= 0) {
    reasons.push('No payable statutory holiday hours were calculated for this scheme.');
  }
  if (!reasons.length) {
    reasons.push('Statutory holiday pay could not be calculated automatically.');
  }
  let displayCalculatedHours = schemeCalculatedHours;
  if (resolvedSchemeId === statutoryHolidaySchemeService.SCHEME_LINC) {
    const deptRows = Array.isArray(evaluation?.checks?.departments) ? evaluation.checks.departments : [];
    const matchedHours = deptRows
      .filter((row) => cleanId(row?.matchedDate) && Number(row?.hours || 0) > 0)
      .reduce((sum, row) => sum + Number(row.hours || 0), 0);
    if (matchedHours > 0) {
      displayCalculatedHours = Number(matchedHours.toFixed(2));
    }
  }
  return {
    holidayId: evaluation.holidayId,
    date: evaluation.date,
    title: evaluation.title,
    schemeId: resolvedSchemeId,
    schemeName: String(schemeConfig?.name || resolvedSchemeId).trim(),
    reasons,
    checks: evaluation.checks,
    calculatedHours: displayCalculatedHours
  };
}

function resolveStatHolidayActivityPayHours(liveSessions = [], {
  schemeId = '',
  holidayId = '',
  date = ''
} = {}) {
  const targetSchemeId = cleanId(schemeId) || statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM;
  const targetHolidayId = cleanId(holidayId);
  const targetDate = cleanId(date);
  if (!targetHolidayId || !targetDate) return 0;
  let maxHours = 0;
  (Array.isArray(liveSessions) ? liveSessions : []).forEach((session) => {
    const sessionHolidayId = cleanId(session?.statHolidayId || session?.statHolidayMeta?.holidayId);
    if (sessionHolidayId !== targetHolidayId) return;
    if (cleanId(session?.date) !== targetDate) return;
    const sessionSchemeId = cleanId(session?.statHolidaySchemeId || session?.statHolidayMeta?.schemeId)
      || statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM;
    if (sessionSchemeId !== targetSchemeId) return;
    const hours = Number(session?.hours ?? session?.timesheetHours ?? session?.durationHours ?? 0);
    if (hours > maxHours) maxHours = hours;
  });
  return Number(maxHours.toFixed(2));
}

function resolvePrimaryStatHolidayDepartment(payItem = {}, departmentNameById = new Map()) {
  const evaluation = payItem?.evaluation || {};
  const meta = evaluation?.statHolidayMeta || payItem?.statHolidayMeta || {};
  const schemeResult = evaluation?.schemeResult || payItem?.schemeResult || {};
  const byDept = (meta.calculatedHoursByDepartment && typeof meta.calculatedHoursByDepartment === 'object'
    ? meta.calculatedHoursByDepartment
    : schemeResult.calculatedHoursByDepartment) || {};
  let bestId = '';
  let bestHours = -1;
  Object.entries(byDept).forEach(([deptId, hours]) => {
    const value = Number(hours || 0);
    if (value > bestHours) {
      bestHours = value;
      bestId = cleanId(deptId);
    }
  });
  const checkDepts = Array.isArray(evaluation?.checks?.departments) ? evaluation.checks.departments : [];
  if (!bestId && checkDepts.length) {
    const primary = checkDepts.find((row) => cleanId(row?.matchedDate)) || checkDepts[0];
    bestId = cleanId(primary?.departmentId);
  }
  if (!bestId && Array.isArray(meta.departmentIds) && meta.departmentIds[0]) {
    bestId = cleanId(meta.departmentIds[0]);
  }
  const nameFromMap = bestId ? String(departmentNameById.get(bestId) || '').trim() : '';
  return {
    deliveryDepartmentId: bestId,
    deliveryDepartmentName: nameFromMap
  };
}

function filterStatHolidayWarningsForDisplay(warnings = [], {
  liveSessions = [],
  previewRows = []
} = {}) {
  return (Array.isArray(warnings) ? warnings : []).filter((warning) => {
    const schemeId = cleanId(warning?.schemeId);
    const holidayId = cleanId(warning?.holidayId);
    const date = cleanId(warning?.date);
    const activityHours = resolveStatHolidayActivityPayHours(liveSessions, { schemeId, holidayId, date });
    if (activityHours > 0) return false;
    const previewRow = (Array.isArray(previewRows) ? previewRows : []).find((row) => (
      cleanId(row?.statHolidayMeta?.schemeId) === schemeId
      && cleanId(row?.statHolidayMeta?.holidayId) === holidayId
      && cleanId(row?.date) === date
    ));
    const previewHours = Number(previewRow?.hours ?? previewRow?.timesheetHours ?? 0);
    return previewHours <= 0;
  });
}

function buildStatHolidayRow({
  evaluation,
  personId,
  existingEntry = null,
  allowManagerOverride = false,
  schemeId = '',
  schemeResult = null,
  policy = null
}) {
  const override = resolveExistingOverride(existingEntry);
  const resolvedSchemeId = cleanId(schemeId)
    || cleanId(schemeResult?.schemeId)
    || statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM;
  const schemeConfig = statutoryHolidaySchemeService.resolveSchemeConfig(resolvedSchemeId);
  const schemeCalculatedHours = Number.isFinite(Number(evaluation?.calculatedHours))
    ? Number(evaluation.calculatedHours)
    : (Number.isFinite(Number(schemeResult?.calculatedHours))
      ? Number(schemeResult.calculatedHours)
      : 0);
  const sessionId = buildStatHolidaySessionId(evaluation.holidayId, personId, resolvedSchemeId);
  const payResolution = resolveStatHolidayPayHours({
    evaluation,
    existingEntry,
    allowManagerOverride,
    schemeCalculatedHours,
    policy
  });
  const hours = payResolution.shouldPay ? payResolution.hours : 0;

  const row = {
    sessionId,
    date: evaluation.date,
    className: evaluation.title,
    description: schemeConfig?.name
      ? `${schemeConfig.name} statutory holiday pay`
      : 'Statutory holiday pay',
    hours,
    timesheetHours: hours,
    durationHours: hours,
    isStatutoryHoliday: true,
    isManual: false,
    isFinalStatus: true,
    status: payResolution.shouldPay ? 'stat_holiday' : 'stat_holiday_not_qualified',
    statHolidayMeta: {
      holidayId: evaluation.holidayId,
      schemeId: resolvedSchemeId,
      schemeName: String(schemeConfig?.name || resolvedSchemeId).trim(),
      departmentIds: Array.isArray(schemeResult?.departmentIds) ? schemeResult.departmentIds : [],
      calculatedHoursByDepartment: schemeResult?.calculatedHoursByDepartment
        && typeof schemeResult.calculatedHoursByDepartment === 'object'
        ? schemeResult.calculatedHoursByDepartment
        : {},
      qualified: evaluation.qualified,
      calculatedHours: schemeCalculatedHours,
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

function resolveStatHolidayActivityId(policy = {}, schemeId = '') {
  const activityId = statutoryHolidaySchemeService.resolveSchemeActivityId(policy, schemeId);
  if (activityId) return activityId;
  const resolved = timesheetParametersPolicyService.resolvePolicy(policy);
  return String(resolved?.statutoryHolidayPay?.activityId || '').trim();
}

function usesStatHolidayActivityMode(policy = {}) {
  const activityIds = statutoryHolidaySchemeService.resolveAllSchemeActivityIds(policy);
  if (activityIds.length) return true;
  return Boolean(resolveStatHolidayActivityId(policy));
}

function normalizeOverrideInput(override = null) {
  if (!override || typeof override !== 'object') return null;
  return { ...override };
}

function buildOverrideLookup(existingEntries = [], overrideMap = null, options = {}) {
  const lookup = new Map();
  const personId = cleanId(options?.personId);
  const remember = (schemeId, holidayId, entry) => {
    const key = statutoryHolidaySchemeService.buildStatHolidayOverrideKey(schemeId, holidayId);
    if (!key || !entry) return;
    lookup.set(key, mergeStatHolidayOverrideEntries(lookup.get(key), entry));
  };
  const entries = Array.isArray(existingEntries) ? existingEntries : [];
  entries.forEach((entry) => {
    const holidayId = resolveStatHolidayEntryHolidayId(entry, entries, personId);
    if (!holidayId) return;
    const schemeId = resolveStatHolidayEntrySchemeId(entry, entries, personId);
    remember(schemeId, holidayId, entry);
  });
  if (overrideMap && typeof overrideMap === 'object' && !Array.isArray(overrideMap)) {
    Object.entries(overrideMap).forEach(([rawKey, override]) => {
      const parsed = statutoryHolidaySchemeService.parseStatHolidayOverrideKey(rawKey);
      const key = statutoryHolidaySchemeService.buildStatHolidayOverrideKey(
        parsed.schemeId,
        parsed.holidayId
      );
      if (!parsed.holidayId) return;
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
  rows = [],
  evaluations = [],
  existingBySchemeHoliday = null,
  existingByHolidayId = null,
  allowManagerOverride = false,
  policy = null
} = {}) {
  const overrideLookup = existingBySchemeHoliday instanceof Map
    ? existingBySchemeHoliday
    : (existingByHolidayId instanceof Map ? existingByHolidayId : new Map());
  const sourceRows = Array.isArray(rows) && rows.length
    ? rows
    : (Array.isArray(evaluations) ? evaluations : []).map((evaluation) => ({
      evaluation,
      schemeId: statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM,
      calculatedHours: evaluation?.calculatedHours
    }));

  return sourceRows.map((item) => {
    const rawEvaluation = item?.evaluation || item;
    const schemeId = cleanId(item?.schemeId)
      || cleanId(item?.statHolidayMeta?.schemeId)
      || cleanId(rawEvaluation?.statHolidayMeta?.schemeId)
      || statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM;
    const holidayId = cleanId(rawEvaluation?.holidayId)
      || cleanId(rawEvaluation?.statHolidayMeta?.holidayId)
      || cleanId(item?.statHolidayMeta?.holidayId);
    const evaluation = {
      ...rawEvaluation,
      holidayId,
      title: String(
        rawEvaluation?.title
        || rawEvaluation?.className
        || rawEvaluation?.statHolidayMeta?.holidayName
        || holidayId
      ).trim()
    };
    const lookupKey = statutoryHolidaySchemeService.buildStatHolidayOverrideKey(schemeId, holidayId);
    const legacyKey = cleanId(holidayId);
    const existingEntry = overrideLookup.get(lookupKey)
      || overrideLookup.get(legacyKey)
      || item?.existingEntry
      || null;
    const schemeCalculatedHours = Number.isFinite(Number(item?.calculatedHours))
      ? Number(item.calculatedHours)
      : Number(
        item?.statHolidayMeta?.calculatedHours
        ?? evaluation?.statHolidayMeta?.calculatedHours
        ?? evaluation?.calculatedHours
        ?? evaluation?.hours
      );
    const payResolution = resolveStatHolidayPayHours({
      evaluation,
      existingEntry,
      allowManagerOverride,
      schemeCalculatedHours,
      policy
    });
    const payableHours = payResolution.shouldPay
      ? payResolution.hours
      : (String(evaluation?.status || '') === 'stat_holiday'
        ? Number(Number(evaluation?.hours || schemeCalculatedHours || 0).toFixed(2))
        : 0);
    return {
      evaluation,
      schemeId,
      existingEntry,
      payResolution,
      hours: payableHours
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
    if (timesheetLegacyImportService.isLegacyImportEntry(entry)) return true;
    return isPayableWorkdayEntry(entry);
  });
  const seenSessionIds = new Set(
    savedRows
      .map((entry) => String(entry?.sessionId || '').trim())
      .filter(Boolean)
  );
  const autoRows = live.filter((entry) => {
    const sessionId = String(entry?.sessionId || '').trim();
    if (!sessionId || deletedAutoSessionIds.has(sessionId)) return false;
    if (seenSessionIds.has(sessionId)) return false;
    if (isStatHolidayActivitySupplementalEntry(entry)) return false;
    return true;
  });
  return [...savedRows, ...autoRows];
}

async function buildStatutoryHolidayTimesheetContext(ctx = {}) {
  const statutoryHolidayCalculationService = require('./statutoryHolidayCalculationService');
  return statutoryHolidayCalculationService.calculateStatutoryHolidayForPeriod(ctx);
}

function buildStatHolidayMetadataRowsFromEvaluations({
  evaluations = [],
  personId,
  activitySessions = [],
  policy = {}
} = {}) {
  const sessions = (Array.isArray(activitySessions) ? activitySessions : [])
    .filter((row) => String(row?.statHolidayId || row?.statHolidayMeta?.holidayId || '').trim());
  if (!sessions.length) return [];

  const rows = [];
  const seen = new Set();
  sessions.forEach((session) => {
    const holidayId = String(session?.statHolidayId || session?.statHolidayMeta?.holidayId || '').trim();
    const date = String(session?.date || '').trim();
    const schemeId = cleanId(session?.statHolidaySchemeId || session?.statHolidayMeta?.schemeId)
      || statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM;
    const dedupeKey = `${schemeId}|${holidayId}|${date}`;
    if (!holidayId || !date || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const resolveEvaluationSchemeId = (row = {}) => (
      cleanId(row?.schemeId) || statutoryHolidaySchemeService.SCHEME_EQUILIBRIUM
    );
    const evaluation = (Array.isArray(evaluations) ? evaluations : []).find((row) => (
      resolveEvaluationSchemeId(row) === schemeId
      && String(row?.holidayId || '').trim() === holidayId
      && String(row?.date || '').trim() === date
    )) || (Array.isArray(evaluations) ? evaluations : []).find((row) => (
      resolveEvaluationSchemeId(row) === schemeId
      && String(row?.holidayId || '').trim() === holidayId
    ));
    if (!evaluation?.checks) return;

    const schemeConfig = statutoryHolidaySchemeService.resolveSchemeConfig(schemeId, policy);
    rows.push({
      sessionId: buildStatHolidaySessionId(holidayId, personId, schemeId),
      date,
      className: String(session?.className || evaluation?.title || 'Statutory holiday').trim() || 'Statutory holiday',
      description: 'Statutory holiday pay',
      hours: 0,
      timesheetHours: 0,
      durationHours: 0,
      isStatutoryHoliday: true,
      isManual: false,
      isFinalStatus: true,
      status: evaluation.qualified ? 'stat_holiday' : 'stat_holiday_not_qualified',
      statHolidayMeta: {
        holidayId,
        schemeId,
        schemeName: String(schemeConfig?.name || schemeId).trim(),
        qualified: evaluation.qualified === true,
        calculatedHours: evaluation.calculatedHours,
        checks: evaluation.checks,
        disqualifyReasons: Array.isArray(evaluation.disqualifyReasons) ? evaluation.disqualifyReasons : []
      }
    });
  });
  return rows;
}

async function buildStatHolidayMetadataRowsForActivitySessions({
  orgId,
  personId,
  period = {},
  policy,
  periodEntries = [],
  existingEntries = [],
  reqUser,
  allowManagerOverride = false,
  activitySessions = []
} = {}) {
  const sessions = (Array.isArray(activitySessions) ? activitySessions : [])
    .filter((row) => String(row?.statHolidayId || row?.statHolidayMeta?.holidayId || '').trim());
  if (!sessions.length) return [];

  const sessionHolidays = sessions.map((session) => ({
    id: String(session?.statHolidayId || session?.statHolidayMeta?.holidayId || '').trim(),
    date: String(session?.date || '').trim(),
    title: String(session?.className || session?.description || 'Statutory holiday').trim() || 'Statutory holiday',
    type: 'National Holiday'
  }));

  const context = await buildStatutoryHolidayTimesheetContext({
    orgId,
    personId,
    periodStartDate: period?.startDate,
    periodEndDate: period?.endDate,
    policy,
    holidays: sessionHolidays,
    periodEntries,
    existingEntries,
    reqUser,
    allowManagerOverride
  });

  if (Array.isArray(context.rows) && context.rows.length) {
    return context.rows.map((row) => ({
      ...row,
      hours: 0,
      timesheetHours: 0,
      durationHours: 0
    }));
  }

  return buildStatHolidayMetadataRowsFromEvaluations({
    evaluations: context.evaluations || [],
    personId,
    activitySessions: sessions,
    policy
  });
}

function buildTrustedStatHolidayEntry({
  entry,
  trustedRow,
  existingEntry = null,
  allowManagerOverride = false,
  actor = null,
  policy = null
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

  const roundingEnabled = isStatutoryHolidayRoundingEnabled(
    policy ? timesheetParametersPolicyService.resolvePolicy(policy) : {}
  );
  const forcePay = override?.forcePay === true;
  const forceDisqualify = override?.forcePay === false;
  const shouldPay = (trustedRow.statHolidayMeta?.qualified && !forceDisqualify) || forcePay;

  let hours = 0;
  let payBlockedReason = trustedRow.statHolidayMeta?.payBlockedReason || '';
  if (shouldPay) {
    hours = trustedRow.hours ?? trustedRow.statHolidayMeta?.calculatedHours ?? 0;
    hours = applyStatutoryHolidayHoursRounding(hours, { enabled: roundingEnabled });
    if (override && Number.isFinite(Number(override.hours))) {
      hours = applyStatutoryHolidayHoursRounding(
        Number(Number(override.hours).toFixed(2)),
        { enabled: roundingEnabled }
      );
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
  parseStatHolidaySessionHolidayId,
  parseStatHolidaySessionSchemeId,
  parseStatHolidaySessionParts,
  resolveStatHolidayEntryHolidayId,
  resolveStatHolidayEntrySchemeId,
  buildStatHolidayRow,
  buildStatHolidayWarning,
  filterStatHolidayWarningsForDisplay,
  resolveStatHolidayActivityPayHours,
  resolvePrimaryStatHolidayDepartment,
  buildStatHolidayPayItems,
  buildOverrideLookup,
  evaluateHolidayEligibility,
  buildLeaveBeforeAfterCheck,
  buildStatutoryHolidayTimesheetContext,
  buildStatHolidayMetadataRowsFromEvaluations,
  buildStatHolidayMetadataRowsForActivitySessions,
  buildTrustedStatHolidayEntry,
  resolveStatHolidayActivityId,
  usesStatHolidayActivityMode,
  resolveStatHolidayPayHours,
  isPayableHoliday,
  resolveHolidayDate,
  resolveHolidayTitle,
  mergeWorkdaySourceEntries,
  buildSupplementalHoursByDate,
  isStatHolidayPlanningWorkdayEntry
};
