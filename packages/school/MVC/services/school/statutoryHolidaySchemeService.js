'use strict';

const timesheetParametersPolicyService = require('./timesheetParametersPolicyService');
const timesheetPrintService = require('./timesheetPrintService');
const { addDays, getWeekday, isPayableWorkdayEntry } = require('./timesheetWorkdayHistoryService');

const SCHEME_EQUILIBRIUM = 'equilibrium_school';
const SCHEME_LINC = 'linc';

const BUILTIN_SCHEME_IDS = Object.freeze([SCHEME_EQUILIBRIUM, SCHEME_LINC]);

const LINC_HOUR_MODES = Object.freeze({
  MOST_RECENT: 'most_recent',
  FIXED: 'fixed',
  AVERAGE_WEEKS: 'average_weeks'
});

const DEFAULT_BUILTIN_SCHEMES = Object.freeze({
  [SCHEME_EQUILIBRIUM]: {
    id: SCHEME_EQUILIBRIUM,
    name: 'Equilibrium School Scheme',
    builtIn: true,
    activityId: ''
  },
  [SCHEME_LINC]: {
    id: SCHEME_LINC,
    name: 'LINC Scheme',
    builtIn: true,
    activityId: '',
    hourMode: LINC_HOUR_MODES.MOST_RECENT,
    fixedHours: 0,
    averageWeeks: 4,
    disqualifyOnLeaveBeforeAfter: false
  }
});

function cleanId(value) {
  return String(value ?? '').trim();
}

function resolveEntryDepartmentId(entry = {}) {
  return cleanId(entry?.deliveryDepartmentId || entry?.departmentId);
}

function normalizeLincHourMode(value, fallback = LINC_HOUR_MODES.MOST_RECENT) {
  const token = String(value || '').trim().toLowerCase();
  if (token === LINC_HOUR_MODES.FIXED) return LINC_HOUR_MODES.FIXED;
  if (token === LINC_HOUR_MODES.AVERAGE_WEEKS) return LINC_HOUR_MODES.AVERAGE_WEEKS;
  return fallback;
}

function normalizeSchemeConfig(input = {}, defaults = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const id = cleanId(source.id || defaults.id);
  const isLinc = id === SCHEME_LINC;
  const hourMode = isLinc
    ? normalizeLincHourMode(source.hourMode, defaults.hourMode || LINC_HOUR_MODES.MOST_RECENT)
    : undefined;
  const fixedHours = Number(source.fixedHours);
  const averageWeeks = Number.parseInt(String(source.averageWeeks ?? '').trim(), 10);
  const row = {
    id,
    name: String(source.name || defaults.name || id).trim(),
    builtIn: source.builtIn === true || defaults.builtIn === true,
    activityId: cleanId(source.activityId ?? defaults.activityId)
  };
  if (isLinc) {
    row.hourMode = hourMode;
    row.fixedHours = Number.isFinite(fixedHours) && fixedHours > 0
      ? Number(fixedHours.toFixed(2))
      : 0;
    row.averageWeeks = Number.isFinite(averageWeeks) && averageWeeks >= 1
      ? Math.min(52, averageWeeks)
      : (defaults.averageWeeks || 4);
    row.disqualifyOnLeaveBeforeAfter = source.disqualifyOnLeaveBeforeAfter === true
      || source.disqualifyOnLeaveBeforeAfter === 'true';
  }
  return row;
}

function normalizeSchemesBlock(input = {}, legacyActivityId = '') {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const equilibriumDefaults = {
    ...DEFAULT_BUILTIN_SCHEMES[SCHEME_EQUILIBRIUM],
    activityId: legacyActivityId
  };
  return {
    [SCHEME_EQUILIBRIUM]: normalizeSchemeConfig(
      source[SCHEME_EQUILIBRIUM] || {},
      equilibriumDefaults
    ),
    [SCHEME_LINC]: normalizeSchemeConfig(
      source[SCHEME_LINC] || {},
      DEFAULT_BUILTIN_SCHEMES[SCHEME_LINC]
    )
  };
}

function normalizeDepartmentSchemeAssignments(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const assignments = {};
  Object.entries(source).forEach(([departmentId, schemeId]) => {
    const deptKey = cleanId(departmentId);
    const schemeKey = cleanId(schemeId);
    if (!deptKey || !schemeKey || !BUILTIN_SCHEME_IDS.includes(schemeKey)) return;
    assignments[deptKey] = schemeKey;
  });
  return assignments;
}

function migrateStatutoryHolidayPaySchemes(statPay = {}) {
  const source = statPay && typeof statPay === 'object' ? statPay : {};
  const legacyActivityId = cleanId(source.activityId);
  const hasSchemesBlock = source.schemes && typeof source.schemes === 'object';
  const schemes = normalizeSchemesBlock(hasSchemesBlock ? source.schemes : {}, legacyActivityId);
  if (!cleanId(schemes[SCHEME_EQUILIBRIUM].activityId) && legacyActivityId) {
    schemes[SCHEME_EQUILIBRIUM].activityId = legacyActivityId;
  }
  const defaultSchemeId = BUILTIN_SCHEME_IDS.includes(cleanId(source.defaultSchemeId))
    ? cleanId(source.defaultSchemeId)
    : SCHEME_EQUILIBRIUM;
  const defaultActivityId = cleanId(schemes[defaultSchemeId]?.activityId)
    || cleanId(schemes[SCHEME_EQUILIBRIUM].activityId)
    || legacyActivityId;
  return {
    ...source,
    activityId: defaultActivityId,
    defaultSchemeId,
    schemes,
    departmentSchemeAssignments: normalizeDepartmentSchemeAssignments(source.departmentSchemeAssignments)
  };
}

function resolveSchemes(policy = {}) {
  const resolved = timesheetParametersPolicyService.resolvePolicy(policy);
  const statPay = migrateStatutoryHolidayPaySchemes(resolved.statutoryHolidayPay || {});
  return {
    defaultSchemeId: statPay.defaultSchemeId || SCHEME_EQUILIBRIUM,
    schemes: statPay.schemes || normalizeSchemesBlock({}, cleanId(statPay.activityId)),
    departmentSchemeAssignments: statPay.departmentSchemeAssignments || {}
  };
}

function resolveSchemeForDepartment(departmentId = '', policy = {}) {
  const { defaultSchemeId, departmentSchemeAssignments } = resolveSchemes(policy);
  const deptKey = cleanId(departmentId);
  if (deptKey && departmentSchemeAssignments[deptKey]) {
    return departmentSchemeAssignments[deptKey];
  }
  return defaultSchemeId || SCHEME_EQUILIBRIUM;
}

function resolveSchemeConfig(schemeId = '', policy = {}) {
  const { schemes } = resolveSchemes(policy);
  const key = cleanId(schemeId);
  return schemes[key] || schemes[SCHEME_EQUILIBRIUM];
}

function resolveSchemeActivityId(policy = {}, schemeId = '') {
  const { schemes, defaultSchemeId } = resolveSchemes(policy);
  const key = cleanId(schemeId) || defaultSchemeId;
  const fromScheme = cleanId(schemes[key]?.activityId);
  if (fromScheme) return fromScheme;
  const statPay = timesheetParametersPolicyService.resolvePolicy(policy).statutoryHolidayPay || {};
  return cleanId(statPay.activityId);
}

function resolveAllSchemeActivityIds(policy = {}) {
  const { schemes } = resolveSchemes(policy);
  const ids = new Set();
  BUILTIN_SCHEME_IDS.forEach((schemeId) => {
    const activityId = cleanId(schemes[schemeId]?.activityId);
    if (activityId) ids.add(activityId);
  });
  const legacy = cleanId(timesheetParametersPolicyService.resolvePolicy(policy).statutoryHolidayPay?.activityId);
  if (legacy) ids.add(legacy);
  return Array.from(ids);
}

function departmentsForScheme(schemeId = '', policy = {}) {
  const target = cleanId(schemeId);
  const { departmentSchemeAssignments, defaultSchemeId } = resolveSchemes(policy);
  const assigned = Object.entries(departmentSchemeAssignments)
    .filter(([, value]) => cleanId(value) === target)
    .map(([departmentId]) => cleanId(departmentId))
    .filter(Boolean);
  return { assigned, includesDefault: target === cleanId(defaultSchemeId) };
}

function buildDepartmentHoursIndex(entries = []) {
  const byDeptDate = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!isPayableWorkdayEntry(entry)) return;
    const deptId = resolveEntryDepartmentId(entry);
    if (!deptId) return;
    const date = cleanId(entry?.date);
    if (!date) return;
    const hours = timesheetPrintService.resolvePayableHours(entry);
    if (hours <= 0) return;
    if (!byDeptDate.has(deptId)) byDeptDate.set(deptId, new Map());
    const dateMap = byDeptDate.get(deptId);
    dateMap.set(date, Number(((dateMap.get(date) || 0) + hours).toFixed(2)));
  });
  return byDeptDate;
}

function filterEntriesForScheme(entries = [], schemeId = '', policy = {}) {
  const { assigned, includesDefault } = departmentsForScheme(schemeId, policy);
  const assignedSet = new Set(assigned);
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (!isPayableWorkdayEntry(entry)) return false;
    const deptId = resolveEntryDepartmentId(entry);
    if (!deptId) return includesDefault;
    if (assignedSet.has(deptId)) return true;
    if (assigned.length === 0 && includesDefault) {
      return resolveSchemeForDepartment(deptId, policy) === cleanId(schemeId);
    }
    return false;
  });
}

function buildWorkdayHistoryFromEntries(entries = []) {
  const hoursByDate = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!isPayableWorkdayEntry(entry)) return;
    const date = cleanId(entry?.date);
    if (!date) return;
    const hours = timesheetPrintService.resolvePayableHours(entry);
    if (hours <= 0) return;
    hoursByDate.set(date, Number(((hoursByDate.get(date) || 0) + hours).toFixed(2)));
  });
  return hoursByDate;
}

function calculateEquilibriumSchemeHours({
  holidayDate = '',
  workdayEntries = [],
  policy = {}
} = {}) {
  const statPolicy = timesheetParametersPolicyService.resolvePolicy(policy).statutoryHolidayPay
    || timesheetParametersPolicyService.DEFAULT_STATUTORY_HOLIDAY_PAY;
  const schemeEntries = filterEntriesForScheme(workdayEntries, SCHEME_EQUILIBRIUM, policy);
  const hoursByDate = buildWorkdayHistoryFromEntries(schemeEntries);
  const earningsEnd = addDays(holidayDate, -1);
  const earningsStart = addDays(earningsEnd, -(statPolicy.earningsLookbackWeeks * 7 - 1));
  let totalHours = 0;
  let workdayCount = 0;
  hoursByDate.forEach((hours, date) => {
    if (!date || date < earningsStart || date > earningsEnd) return;
    if (hours > 0) {
      totalHours += hours;
      workdayCount += 1;
    }
  });
  const calculatedHours = workdayCount > 0
    ? Number((totalHours / workdayCount).toFixed(2))
    : 0;
  const departmentIds = Array.from(new Set(
    schemeEntries.map((entry) => resolveEntryDepartmentId(entry)).filter(Boolean)
  ));
  return {
    schemeId: SCHEME_EQUILIBRIUM,
    calculatedHours,
    departmentIds,
    calculatedHoursByDepartment: {}
  };
}

function listSameWeekdayDatesBefore({
  holidayDate = '',
  deptDateMap = new Map(),
  maxCount = 52
} = {}) {
  const targetWeekday = getWeekday(holidayDate);
  if (targetWeekday < 0) return [];
  const matches = [];
  let cursor = addDays(holidayDate, -1);
  let guard = 0;
  while (cursor && guard < 400 && matches.length < maxCount) {
    if (getWeekday(cursor) === targetWeekday) {
      const hours = Number(deptDateMap.get(cursor) || 0);
      if (hours > 0) matches.push({ date: cursor, hours });
    }
    cursor = addDays(cursor, -1);
    guard += 1;
  }
  return matches;
}

function listSameWeekdayDatesAfter({
  holidayDate = '',
  deptDateMap = new Map(),
  maxCount = 52
} = {}) {
  const targetWeekday = getWeekday(holidayDate);
  if (targetWeekday < 0) return [];
  const matches = [];
  let cursor = addDays(holidayDate, 1);
  let guard = 0;
  while (cursor && guard < 400 && matches.length < maxCount) {
    if (getWeekday(cursor) === targetWeekday) {
      const hours = Number(deptDateMap.get(cursor) || 0);
      if (hours > 0) matches.push({ date: cursor, hours });
    }
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return matches;
}

function resolveMostRecentSameWeekdayMatch(holidayDate = '', deptDateMap = new Map()) {
  const before = listSameWeekdayDatesBefore({ holidayDate, deptDateMap, maxCount: 1 });
  if (before.length) {
    return {
      date: before[0].date,
      hours: Number(before[0].hours || 0),
      searchDirection: 'before'
    };
  }
  const after = listSameWeekdayDatesAfter({ holidayDate, deptDateMap, maxCount: 1 });
  if (after.length) {
    return {
      date: after[0].date,
      hours: Number(after[0].hours || 0),
      searchDirection: 'after'
    };
  }
  return { date: '', hours: 0, searchDirection: '' };
}

function personWorkedWeekdayInDepartment(deptDateMap = new Map(), holidayDate = '', schemeConfig = {}) {
  const hourMode = normalizeLincHourMode(schemeConfig?.hourMode);
  if (hourMode === LINC_HOUR_MODES.MOST_RECENT) {
    const match = resolveMostRecentSameWeekdayMatch(holidayDate, deptDateMap);
    return match.hours > 0;
  }
  return listSameWeekdayDatesBefore({ holidayDate, deptDateMap, maxCount: 1 }).length > 0;
}

function calculateLincDepartmentHours({
  holidayDate = '',
  deptId = '',
  deptDateMap = new Map(),
  schemeConfig = {}
} = {}) {
  const hourMode = normalizeLincHourMode(schemeConfig.hourMode);
  const hasHistory = personWorkedWeekdayInDepartment(deptDateMap, holidayDate, schemeConfig);
  if (!hasHistory && hourMode !== LINC_HOUR_MODES.FIXED) {
    return { hours: 0, matchedDate: '', searchDirection: '' };
  }

  if (hourMode === LINC_HOUR_MODES.FIXED) {
    if (!hasHistory) return { hours: 0, matchedDate: '', searchDirection: '' };
    const fixed = Number(schemeConfig.fixedHours || 0);
    const hours = fixed > 0 ? Number(fixed.toFixed(2)) : 0;
    const backward = listSameWeekdayDatesBefore({ holidayDate, deptDateMap, maxCount: 1 });
    return {
      hours,
      matchedDate: backward[0]?.date || '',
      searchDirection: backward.length ? 'before' : ''
    };
  }

  if (hourMode === LINC_HOUR_MODES.MOST_RECENT) {
    const match = resolveMostRecentSameWeekdayMatch(holidayDate, deptDateMap);
    return {
      hours: Number(Number(match.hours || 0).toFixed(2)),
      matchedDate: match.date || '',
      searchDirection: match.searchDirection || ''
    };
  }

  const occurrences = listSameWeekdayDatesBefore({
    holidayDate,
    deptDateMap,
    maxCount: Math.max(1, Number(schemeConfig.averageWeeks) || 4)
  });
  if (!occurrences.length) {
    return { hours: 0, matchedDate: '', searchDirection: '' };
  }

  const total = occurrences.reduce((sum, row) => sum + Number(row.hours || 0), 0);
  return {
    hours: Number((total / occurrences.length).toFixed(2)),
    matchedDate: occurrences[0]?.date || '',
    searchDirection: 'before'
  };
}

function calculateLincSchemeHours({
  holidayDate = '',
  workdayEntries = [],
  policy = {}
} = {}) {
  const schemeConfig = resolveSchemeConfig(SCHEME_LINC, policy);
  const { assigned, includesDefault } = departmentsForScheme(SCHEME_LINC, policy);
  const deptIndex = buildDepartmentHoursIndex(workdayEntries);
  const targetDepartments = new Set(assigned);
  if (includesDefault) {
    deptIndex.forEach((_, deptId) => {
      if (resolveSchemeForDepartment(deptId, policy) === SCHEME_LINC) {
        targetDepartments.add(deptId);
      }
    });
  }
  if (!targetDepartments.size && assigned.length) {
    assigned.forEach((deptId) => targetDepartments.add(deptId));
  }

  const calculatedHoursByDepartment = {};
  const departmentDetails = {};
  let calculatedHours = 0;
  targetDepartments.forEach((deptId) => {
    const deptDateMap = deptIndex.get(deptId) || new Map();
    const deptResult = calculateLincDepartmentHours({
      holidayDate,
      deptId,
      deptDateMap,
      schemeConfig
    });
    const hours = Number(deptResult?.hours || 0);
    if (hours > 0) {
      calculatedHoursByDepartment[deptId] = hours;
      departmentDetails[deptId] = {
        hours,
        matchedDate: cleanId(deptResult?.matchedDate),
        searchDirection: cleanId(deptResult?.searchDirection)
      };
      calculatedHours = Number((calculatedHours + hours).toFixed(2));
    }
  });

  return {
    schemeId: SCHEME_LINC,
    calculatedHours,
    departmentIds: Object.keys(calculatedHoursByDepartment),
    calculatedHoursByDepartment,
    departmentDetails
  };
}

function calculateSchemeHours({
  schemeId = '',
  holidayDate = '',
  workdayEntries = [],
  policy = {}
} = {}) {
  const key = cleanId(schemeId);
  if (key === SCHEME_LINC) {
    return calculateLincSchemeHours({ holidayDate, workdayEntries, policy });
  }
  return calculateEquilibriumSchemeHours({ holidayDate, workdayEntries, policy });
}

function resolveSchemeIdFromEntry(entry = {}) {
  const fromMeta = cleanId(entry?.statHolidayMeta?.schemeId);
  if (fromMeta && BUILTIN_SCHEME_IDS.includes(fromMeta)) return fromMeta;
  return SCHEME_EQUILIBRIUM;
}

function resolveActiveSchemesForPerson({
  workdayEntries = [],
  existingEntries = [],
  policy = {}
} = {}) {
  const resolvedPolicy = timesheetParametersPolicyService.resolvePolicy(policy);
  if (resolvedPolicy?.statutoryHolidayPay?.enabled === false) {
    return [];
  }
  return [...BUILTIN_SCHEME_IDS];
}

function resolveSchemesWithAssignedDepartments(policy = {}) {
  const { schemes, departmentSchemeAssignments, defaultSchemeId } = resolveSchemes(policy);
  const usage = new Map(BUILTIN_SCHEME_IDS.map((schemeId) => [schemeId, 0]));
  Object.values(departmentSchemeAssignments).forEach((schemeId) => {
    const key = cleanId(schemeId);
    if (usage.has(key)) usage.set(key, usage.get(key) + 1);
  });
  if (!Object.keys(departmentSchemeAssignments).length) {
    usage.set(cleanId(defaultSchemeId) || SCHEME_EQUILIBRIUM, 1);
  }
  return BUILTIN_SCHEME_IDS
    .filter((schemeId) => usage.get(schemeId) > 0 || cleanId(schemes[schemeId]?.activityId))
    .map((schemeId) => ({
      schemeId,
      config: schemes[schemeId],
      assignedDepartmentCount: usage.get(schemeId) || 0
    }));
}

function buildStatHolidayOverrideKey(schemeId = '', holidayId = '') {
  return `${cleanId(schemeId) || SCHEME_EQUILIBRIUM}|${cleanId(holidayId)}`;
}

function parseStatHolidayOverrideKey(key = '') {
  const token = String(key || '').trim();
  if (!token.includes('|')) {
    return { schemeId: SCHEME_EQUILIBRIUM, holidayId: token };
  }
  const [schemeId, ...rest] = token.split('|');
  return { schemeId: cleanId(schemeId) || SCHEME_EQUILIBRIUM, holidayId: rest.join('|') };
}

module.exports = {
  SCHEME_EQUILIBRIUM,
  SCHEME_LINC,
  BUILTIN_SCHEME_IDS,
  LINC_HOUR_MODES,
  DEFAULT_BUILTIN_SCHEMES,
  migrateStatutoryHolidayPaySchemes,
  normalizeSchemesBlock,
  normalizeDepartmentSchemeAssignments,
  normalizeLincHourMode,
  resolveSchemes,
  resolveSchemeForDepartment,
  resolveSchemeConfig,
  resolveSchemeActivityId,
  resolveAllSchemeActivityIds,
  departmentsForScheme,
  buildDepartmentHoursIndex,
  filterEntriesForScheme,
  buildWorkdayHistoryFromEntries,
  calculateSchemeHours,
  calculateEquilibriumSchemeHours,
  calculateLincSchemeHours,
  listSameWeekdayDatesBefore,
  listSameWeekdayDatesAfter,
  resolveMostRecentSameWeekdayMatch,
  resolveSchemeIdFromEntry,
  resolveActiveSchemesForPerson,
  resolveSchemesWithAssignedDepartments,
  buildStatHolidayOverrideKey,
  parseStatHolidayOverrideKey,
  resolveEntryDepartmentId
};
