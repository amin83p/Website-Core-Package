'use strict';

const schoolDataService = require('./schoolDataService');
const timesheetPrintService = require('./timesheetPrintService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const FROZEN_TIMESHEET_STATUSES = new Set(['submitted', 'processed', 'approved']);

function addDays(dateStr, amount) {
  const token = String(dateStr || '').trim();
  if (!token) return '';
  const parsed = new Date(`${token}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  parsed.setUTCDate(parsed.getUTCDate() + Number(amount || 0));
  return parsed.toISOString().slice(0, 10);
}

function getWeekday(dateStr) {
  const parsed = new Date(`${String(dateStr || '').trim()}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return -1;
  return parsed.getUTCDay();
}

function resolveAuthoritativeEntries(timesheet = {}) {
  const status = String(timesheet?.status || '').toLowerCase();
  if (
    FROZEN_TIMESHEET_STATUSES.has(status)
    && Array.isArray(timesheet?.submissionSnapshot?.entries)
    && timesheet.submissionSnapshot.entries.length
  ) {
    return timesheet.submissionSnapshot.entries;
  }
  return Array.isArray(timesheet?.entries) ? timesheet.entries : [];
}

function isPayableWorkdayEntry(entry = {}) {
  if (!entry || entry.isDeleted === true || entry.isStatutoryHoliday === true) return false;
  return timesheetPrintService.resolvePayableHours(entry) > 0;
}

class WorkdayHistory {
  constructor(hoursByDate = new Map()) {
    this.hoursByDate = hoursByDate;
  }

  getHours(date) {
    return Number(this.hoursByDate.get(String(date || '').trim()) || 0);
  }

  hasWorkday(date) {
    return this.getHours(date) > 0;
  }

  countWorkdaysBefore(beforeDate, { minDate = '' } = {}) {
    const cutoff = String(beforeDate || '').trim();
    const floor = String(minDate || '').trim();
    let count = 0;
    this.hoursByDate.forEach((hours, date) => {
      if (!date || date >= cutoff) return;
      if (floor && date < floor) return;
      if (hours > 0) count += 1;
    });
    return count;
  }

  countWeekdayOccurrences(weekday, beforeDate, lookback) {
    const targetWeekday = Number(weekday);
    const requiredLookback = Math.max(1, Number(lookback) || 1);
    if (!Number.isFinite(targetWeekday) || targetWeekday < 0 || targetWeekday > 6) return 0;
    let count = 0;
    let checked = 0;
    let cursor = addDays(beforeDate, -1);
    let guard = 0;
    while (checked < requiredLookback && cursor && guard < 400) {
      if (getWeekday(cursor) === targetWeekday) {
        if (this.hasWorkday(cursor)) count += 1;
        checked += 1;
      }
      cursor = addDays(cursor, -1);
      guard += 1;
    }
    return count;
  }

  lastWorkdayBefore(date, maxSearchDays = 14) {
    let cursor = addDays(date, -1);
    let searched = 0;
    while (cursor && searched <= Math.max(0, Number(maxSearchDays) || 0)) {
      if (this.hasWorkday(cursor)) return cursor;
      cursor = addDays(cursor, -1);
      searched += 1;
    }
    return '';
  }

  firstWorkdayAfter(date, maxSearchDays = 14) {
    let cursor = addDays(date, 1);
    let searched = 0;
    while (cursor && searched <= Math.max(0, Number(maxSearchDays) || 0)) {
      if (this.hasWorkday(cursor)) return cursor;
      cursor = addDays(cursor, 1);
      searched += 1;
    }
    return '';
  }

  totalHoursInRange(startDate, endDate) {
    const start = String(startDate || '').trim();
    const end = String(endDate || '').trim();
    let total = 0;
    this.hoursByDate.forEach((hours, date) => {
      if (!date || date < start || date > end) return;
      total += Number(hours) || 0;
    });
    return Number(total.toFixed(2));
  }

  workdayCountInRange(startDate, endDate) {
    const start = String(startDate || '').trim();
    const end = String(endDate || '').trim();
    let count = 0;
    this.hoursByDate.forEach((hours, date) => {
      if (!date || date < start || date > end) return;
      if (hours > 0) count += 1;
    });
    return count;
  }
}

async function buildWorkdayHistory({
  orgId,
  personId,
  endDate,
  lookbackDays = 120,
  reqUser,
  supplementalEntries = []
} = {}) {
  const end = String(endDate || '').trim();
  const start = addDays(end, -Math.max(1, Number(lookbackDays) || 120));
  const hoursByDate = new Map();

  function ingestEntry(entry) {
    if (!isPayableWorkdayEntry(entry)) return;
    const date = String(entry?.date || '').trim();
    if (!date || (start && date < start) || (end && date > end)) return;
    const hours = timesheetPrintService.resolvePayableHours(entry);
    if (hours <= 0) return;
    hoursByDate.set(date, Number(((hoursByDate.get(date) || 0) + hours).toFixed(2)));
  }

  const timesheets = await schoolDataService.fetchData(
    'timesheets',
    {
      teacherId__eq: personId,
      orgId__eq: orgId,
      limit: 500
    },
    reqUser
  );

  (Array.isArray(timesheets) ? timesheets : []).forEach((timesheet) => {
    if (!idsEqual(timesheet?.orgId, orgId)) return;
    if (!idsEqual(timesheet?.teacherId, personId)) return;
    resolveAuthoritativeEntries(timesheet).forEach(ingestEntry);
  });

  (Array.isArray(supplementalEntries) ? supplementalEntries : []).forEach(ingestEntry);

  return new WorkdayHistory(hoursByDate);
}

module.exports = {
  WorkdayHistory,
  addDays,
  getWeekday,
  resolveAuthoritativeEntries,
  isPayableWorkdayEntry,
  buildWorkdayHistory
};
