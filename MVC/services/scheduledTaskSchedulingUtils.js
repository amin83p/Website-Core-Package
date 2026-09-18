'use strict';

const {
  getDateTimePartsInTimezone,
  resolveDefaultTimezone
} = require('../utils/timezoneUtils');

function cleanText(value) {
  return String(value || '').trim();
}

function parseRunAtTime(value = '') {
  const token = cleanText(value).slice(0, 5);
  const match = /^(\d{2}):(\d{2})$/.exec(token);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function buildDateKeyFromParts(parts = {}) {
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function zonedDateTimeToUtcMs({ dateKey = '', hour = 0, minute = 0, timeZone = '' } = {}) {
  const tz = cleanText(timeZone) || resolveDefaultTimezone();
  const [year, month, day] = String(dateKey).split('-').map((part) => Number(part));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return NaN;

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const parts = getDateTimePartsInTimezone(utcGuess, tz);
  if (!parts) return NaN;
  const renderedDateKey = buildDateKeyFromParts(parts);
  if (renderedDateKey !== String(dateKey)) return NaN;
  const offsetMinutes = (parts.hour * 60 + parts.minute) - (hour * 60 + minute);
  return utcGuess - (offsetMinutes * 60 * 1000);
}

function computeNextDailyRunAt({
  runAtTime = '',
  timeZone = '',
  from = new Date()
} = {}) {
  const parsed = parseRunAtTime(runAtTime);
  if (!parsed) return '';
  const tz = cleanText(timeZone) || resolveDefaultTimezone();
  const baseMs = from instanceof Date ? from.getTime() : new Date(from).getTime();
  const baseParts = getDateTimePartsInTimezone(baseMs, tz);
  if (!baseParts) return '';

  let candidateDateKey = buildDateKeyFromParts(baseParts);
  let candidateMs = zonedDateTimeToUtcMs({
    dateKey: candidateDateKey,
    hour: parsed.hour,
    minute: parsed.minute,
    timeZone: tz
  });
  if (!Number.isFinite(candidateMs)) return '';
  if (candidateMs <= baseMs) {
    const nextDay = new Date(candidateMs);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const nextParts = getDateTimePartsInTimezone(nextDay.getTime(), tz);
    candidateDateKey = buildDateKeyFromParts(nextParts);
    candidateMs = zonedDateTimeToUtcMs({
      dateKey: candidateDateKey,
      hour: parsed.hour,
      minute: parsed.minute,
      timeZone: tz
    });
  }
  return Number.isFinite(candidateMs) ? new Date(candidateMs).toISOString() : '';
}

function computeIntervalNextRunAt({
  intervalMinutes = 5,
  from = new Date()
} = {}) {
  const minutes = Number(intervalMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  const baseMs = from instanceof Date ? from.getTime() : new Date(from).getTime();
  return new Date(baseMs + (minutes * 60 * 1000)).toISOString();
}

const WEEKDAY_SHORT_TO_INDEX = Object.freeze({
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
});

function normalizeDaysOfWeekList(raw = []) {
  const values = Array.isArray(raw) ? raw : [raw];
  return [...new Set(
    values
      .map((value) => Number.parseInt(String(value), 10))
      .filter((day) => Number.isFinite(day) && day >= 0 && day <= 6)
  )];
}

function addDaysToDateKey(dateKey, days = 1, timeZone = '') {
  const tz = cleanText(timeZone) || resolveDefaultTimezone();
  const ms = zonedDateTimeToUtcMs({ dateKey, hour: 12, minute: 0, timeZone: tz });
  if (!Number.isFinite(ms)) return '';
  const next = new Date(ms);
  next.setUTCDate(next.getUTCDate() + days);
  const parts = getDateTimePartsInTimezone(next.getTime(), tz);
  return buildDateKeyFromParts(parts);
}

function getWeekdayInTimezone(dateKey, timeZone = '') {
  const tz = cleanText(timeZone) || resolveDefaultTimezone();
  const ms = zonedDateTimeToUtcMs({ dateKey, hour: 12, minute: 0, timeZone: tz });
  if (!Number.isFinite(ms)) return NaN;
  try {
    const short = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(ms));
    return WEEKDAY_SHORT_TO_INDEX[short] ?? NaN;
  } catch (_) {
    return NaN;
  }
}

function computeNextWeeklyRunAt({
  runAtTime = '',
  timeZone = '',
  daysOfWeek = [],
  from = new Date()
} = {}) {
  const parsed = parseRunAtTime(runAtTime);
  const allowed = normalizeDaysOfWeekList(daysOfWeek);
  if (!parsed || !allowed.length) return '';
  const tz = cleanText(timeZone) || resolveDefaultTimezone();
  const baseMs = from instanceof Date ? from.getTime() : new Date(from).getTime();
  const baseParts = getDateTimePartsInTimezone(baseMs, tz);
  if (!baseParts) return '';

  const startDateKey = buildDateKeyFromParts(baseParts);
  for (let offset = 0; offset < 14; offset += 1) {
    const dateKey = offset === 0
      ? startDateKey
      : addDaysToDateKey(startDateKey, offset, tz);
    if (!dateKey) continue;
    const weekday = getWeekdayInTimezone(dateKey, tz);
    if (!allowed.includes(weekday)) continue;
    const candidateMs = zonedDateTimeToUtcMs({
      dateKey,
      hour: parsed.hour,
      minute: parsed.minute,
      timeZone: tz
    });
    if (!Number.isFinite(candidateMs)) continue;
    if (candidateMs > baseMs) {
      return new Date(candidateMs).toISOString();
    }
  }
  return '';
}

function computeNextRunAt(definition = {}, from = new Date()) {
  const scheduleType = cleanText(definition.scheduleType) || 'daily';
  if (scheduleType === 'interval') {
    return computeIntervalNextRunAt({
      intervalMinutes: definition.input?.intervalMinutes || definition.intervalMinutes || 5,
      from
    });
  }
  const weeklyDays = normalizeDaysOfWeekList(definition.input?.daysOfWeek);
  if (scheduleType === 'weekly' || weeklyDays.length) {
    return computeNextWeeklyRunAt({
      runAtTime: definition.runAtTime,
      timeZone: definition.timezone,
      daysOfWeek: weeklyDays.length ? weeklyDays : [0, 1, 2, 3, 4, 5, 6],
      from
    });
  }
  return computeNextDailyRunAt({
    runAtTime: definition.runAtTime,
    timeZone: definition.timezone,
    from
  });
}

module.exports = {
  parseRunAtTime,
  computeNextDailyRunAt,
  computeNextWeeklyRunAt,
  computeIntervalNextRunAt,
  computeNextRunAt,
  getWeekdayInTimezone,
  normalizeDaysOfWeekList
};
