'use strict';

const { resolvePeriodStartYearToken } = require('./timesheetExcel/timesheetPeriodMatchService');

function cleanId(value) {
  return String(value ?? '').trim();
}

function filterPeriodsForNavigationYear(periods = [], year = '', fallbackYear = '') {
  const yearToken = String(year || '').trim();
  return (Array.isArray(periods) ? periods : [])
    .filter((row) => resolvePeriodStartYearToken(row, fallbackYear || yearToken) === yearToken)
    .sort((a, b) => String(a?.startDate || '').localeCompare(String(b?.startDate || '')));
}

function resolveAdjacentPeriods({
  periods = [],
  currentPeriodId = '',
  year = '',
  fallbackYear = ''
} = {}) {
  const yearPeriods = filterPeriodsForNavigationYear(periods, year, fallbackYear);
  const currentId = cleanId(currentPeriodId);
  const currentIndex = yearPeriods.findIndex((row) => cleanId(row?.id) === currentId);
  if (currentIndex < 0) {
    return { prevPeriod: null, nextPeriod: null, yearPeriods };
  }
  return {
    prevPeriod: currentIndex > 0 ? yearPeriods[currentIndex - 1] : null,
    nextPeriod: currentIndex < yearPeriods.length - 1 ? yearPeriods[currentIndex + 1] : null,
    yearPeriods
  };
}

function buildTimesheetEditorHref({ periodId = '', teacherId = '', year = '' } = {}) {
  const pid = cleanId(periodId);
  if (!pid) return '';
  const params = new URLSearchParams();
  const yearToken = String(year || '').trim();
  if (yearToken) params.set('year', yearToken);
  const tid = cleanId(teacherId);
  if (tid) params.set('teacherId', tid);
  const query = params.toString();
  return `/school/timesheets/editor/${encodeURIComponent(pid)}${query ? `?${query}` : ''}`;
}

function shapePeriodNavEntry(period, options = {}) {
  if (!period) return null;
  const {
    teacherId = '',
    year = '',
    canOpen = true,
    reason = ''
  } = options;
  return {
    id: cleanId(period.id),
    name: String(period.name || '').trim(),
    startDate: String(period.startDate || '').trim(),
    endDate: String(period.endDate || '').trim(),
    href: buildTimesheetEditorHref({ periodId: period.id, teacherId, year }),
    canOpen: canOpen !== false,
    reason: String(reason || '').trim()
  };
}

module.exports = {
  filterPeriodsForNavigationYear,
  resolveAdjacentPeriods,
  buildTimesheetEditorHref,
  shapePeriodNavEntry
};
