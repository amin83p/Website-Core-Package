const settingService = require('../services/settingService');

/**
 * Org timezone fallback policy (headless / no-request contexts):
 * 1. explicit `orgToday` param
 * 2. `user.orgToday` / request `orgToday`
 * 3. compute from org timezone
 * 4. UTC server date (last resort for system/headless only)
 */

const FALLBACK_TIMEZONE = 'UTC';

const CURATED_TIMEZONE_OPTIONS = Object.freeze([
  { group: 'UTC', value: 'UTC', label: 'UTC' },
  { group: 'Americas', value: 'America/St_Johns', label: 'America/St_Johns (Newfoundland)' },
  { group: 'Americas', value: 'America/Halifax', label: 'America/Halifax (Atlantic)' },
  { group: 'Americas', value: 'America/Toronto', label: 'America/Toronto (Eastern)' },
  { group: 'Americas', value: 'America/New_York', label: 'America/New_York (Eastern)' },
  { group: 'Americas', value: 'America/Chicago', label: 'America/Chicago (Central)' },
  { group: 'Americas', value: 'America/Winnipeg', label: 'America/Winnipeg (Central)' },
  { group: 'Americas', value: 'America/Edmonton', label: 'America/Edmonton (Mountain)' },
  { group: 'Americas', value: 'America/Denver', label: 'America/Denver (Mountain)' },
  { group: 'Americas', value: 'America/Vancouver', label: 'America/Vancouver (Pacific)' },
  { group: 'Americas', value: 'America/Los_Angeles', label: 'America/Los_Angeles (Pacific)' },
  { group: 'Americas', value: 'America/Mexico_City', label: 'America/Mexico_City' },
  { group: 'Americas', value: 'America/Sao_Paulo', label: 'America/Sao_Paulo' },
  { group: 'Europe', value: 'Europe/London', label: 'Europe/London' },
  { group: 'Europe', value: 'Europe/Paris', label: 'Europe/Paris' },
  { group: 'Europe', value: 'Europe/Berlin', label: 'Europe/Berlin' },
  { group: 'Europe', value: 'Europe/Istanbul', label: 'Europe/Istanbul' },
  { group: 'Europe', value: 'Europe/Moscow', label: 'Europe/Moscow' },
  { group: 'Asia', value: 'Asia/Dubai', label: 'Asia/Dubai' },
  { group: 'Asia', value: 'Asia/Tehran', label: 'Asia/Tehran' },
  { group: 'Asia', value: 'Asia/Karachi', label: 'Asia/Karachi' },
  { group: 'Asia', value: 'Asia/Kolkata', label: 'Asia/Kolkata' },
  { group: 'Asia', value: 'Asia/Dhaka', label: 'Asia/Dhaka' },
  { group: 'Asia', value: 'Asia/Bangkok', label: 'Asia/Bangkok' },
  { group: 'Asia', value: 'Asia/Singapore', label: 'Asia/Singapore' },
  { group: 'Asia', value: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong' },
  { group: 'Asia', value: 'Asia/Shanghai', label: 'Asia/Shanghai' },
  { group: 'Asia', value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
  { group: 'Asia', value: 'Asia/Seoul', label: 'Asia/Seoul' },
  { group: 'Pacific', value: 'Australia/Perth', label: 'Australia/Perth' },
  { group: 'Pacific', value: 'Australia/Sydney', label: 'Australia/Sydney' },
  { group: 'Pacific', value: 'Pacific/Auckland', label: 'Pacific/Auckland' }
]);

function cleanTimezoneToken(value) {
  return String(value ?? '').trim().slice(0, 80);
}

function isValidTimezoneToken(token) {
  const value = cleanTimezoneToken(token);
  if (!value) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch (_) {
    return false;
  }
}

function normalizeTimezoneToken(value, fallback = FALLBACK_TIMEZONE) {
  const token = cleanTimezoneToken(value);
  if (!token) return normalizeTimezoneToken(fallback, FALLBACK_TIMEZONE);
  if (!isValidTimezoneToken(token)) return normalizeTimezoneToken(fallback, FALLBACK_TIMEZONE);
  return token;
}

function resolveDefaultTimezone() {
  try {
    const settings = settingService.get();
    const candidate = settings?.app?.defaultTimezone || settings?.app?.timezone || FALLBACK_TIMEZONE;
    return normalizeTimezoneToken(candidate, FALLBACK_TIMEZONE);
  } catch (_) {
    return FALLBACK_TIMEZONE;
  }
}

function listCuratedTimezoneOptions() {
  return CURATED_TIMEZONE_OPTIONS.map((row) => ({ ...row }));
}

function isCuratedTimezoneValue(value) {
  const token = cleanTimezoneToken(value);
  if (!token) return false;
  return CURATED_TIMEZONE_OPTIONS.some((row) => row.value === token);
}

function parseOrganizationTimezoneInput(body = {}, fallback = resolveDefaultTimezone()) {
  const selectValue = cleanTimezoneToken(body.timeZone || body.timezone);
  let rawValue = selectValue;
  if (selectValue === '__default__' || !selectValue) {
    rawValue = fallback;
  } else if (selectValue === '__custom__') {
    rawValue = cleanTimezoneToken(body.timeZoneCustom || body.timezoneCustom);
  }
  if (!rawValue) {
    return {
      timeZone: normalizeTimezoneToken(fallback, FALLBACK_TIMEZONE),
      error: ''
    };
  }
  if (!isValidTimezoneToken(rawValue)) {
    return {
      timeZone: '',
      error: 'Timezone must be a valid IANA timezone (e.g. America/Edmonton).'
    };
  }
  return {
    timeZone: normalizeTimezoneToken(rawValue, fallback),
    error: ''
  };
}

function formatNowInTimezone(timeZone = FALLBACK_TIMEZONE) {
  return formatInstantInTimezone(new Date(), timeZone, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function resolveOrganizationTimezoneFromRow(row = {}) {
  const candidates = [
    row?.settings?.timeZone,
    row?.settings?.timezone,
    row?.timeZone,
    row?.timezone,
    row?.identity?.timeZone,
    row?.identity?.timezone
  ];
  for (const candidate of candidates) {
    const token = cleanTimezoneToken(candidate);
    if (!token) continue;
    return normalizeTimezoneToken(token, resolveDefaultTimezone());
  }
  return resolveDefaultTimezone();
}

function resolveActiveOrgTimezoneFromUser(user = {}) {
  const explicit = cleanTimezoneToken(user?.activeOrgTimeZone);
  if (explicit && isValidTimezoneToken(explicit)) {
    return normalizeTimezoneToken(explicit, resolveDefaultTimezone());
  }
  const activeOrgId = String(user?.activeOrgId || '').trim();
  if (activeOrgId && activeOrgId !== 'SYSTEM') {
    const allowedOrgs = Array.isArray(user?.allowedOrgs) ? user.allowedOrgs : [];
    const activeOrg = allowedOrgs.find((row) => {
      const orgId = String(row?.orgId || row?.id || '').trim();
      return orgId && orgId === activeOrgId;
    });
    if (activeOrg?.timeZone) {
      return normalizeTimezoneToken(activeOrg.timeZone, resolveDefaultTimezone());
    }
  }
  if (activeOrgId === 'SYSTEM') {
    return resolveDefaultTimezone();
  }
  return resolveDefaultTimezone();
}

function getDateTimePartsInTimezone(ms = Date.now(), timeZone = FALLBACK_TIMEZONE) {
  const date = new Date(Number(ms || 0));
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: normalizeTimezoneToken(timeZone, FALLBACK_TIMEZONE),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(date);
    const pick = (type) => parts.find((part) => part.type === type)?.value || '';
    return {
      year: pick('year'),
      month: pick('month'),
      day: pick('day'),
      hour: pick('hour'),
      minute: pick('minute'),
      second: pick('second')
    };
  } catch (_) {
    return null;
  }
}

function getTodayDateKeyInTimezone(timeZone = FALLBACK_TIMEZONE, referenceMs = Date.now()) {
  const parts = getDateTimePartsInTimezone(referenceMs, timeZone);
  if (!parts?.year || !parts?.month || !parts?.day) {
    return new Date(referenceMs).toISOString().slice(0, 10);
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getDateKeyInTimezone(isoDateTime = '', timeZone = FALLBACK_TIMEZONE) {
  const ms = isoDateTime ? coerceInstantMs(isoDateTime) : Date.now();
  if (!Number.isFinite(ms)) return new Date().toISOString().slice(0, 10);
  const parts = getDateTimePartsInTimezone(ms, timeZone);
  if (!parts?.year || !parts?.month || !parts?.day) {
    return new Date(ms).toISOString().slice(0, 10);
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function coerceInstantMs(value) {
  if (value === undefined || value === null || value === '') return NaN;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const date = new Date(value);
  return date.getTime();
}

function formatInstantInTimezone(value, timeZone = FALLBACK_TIMEZONE, options = {}) {
  const ms = coerceInstantMs(value);
  if (!Number.isFinite(ms)) return '-';
  const normalized = normalizeTimezoneToken(timeZone, FALLBACK_TIMEZONE);
  const {
    weekday,
    year = 'numeric',
    month = 'short',
    day = '2-digit',
    hour = '2-digit',
    minute = '2-digit',
    second,
    hour12 = false
  } = options;
  try {
    const formatOptions = {
      timeZone: normalized,
      year,
      month,
      day,
      hour,
      minute,
      hour12
    };
    if (second) formatOptions.second = second;
    if (weekday) formatOptions.weekday = weekday;
    return new Intl.DateTimeFormat('en-US', formatOptions).format(new Date(ms));
  } catch (_) {
    return new Date(ms).toISOString();
  }
}

function formatDateKeyInTimezone(dateKey, timeZone = FALLBACK_TIMEZONE, options = {}) {
  const token = String(dateKey || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return token || '-';
  const ms = coerceInstantMs(`${token}T12:00:00.000Z`);
  return formatInstantInTimezone(ms, timeZone, {
    weekday: options.weekday,
    year: options.year || 'numeric',
    month: options.month || 'short',
    day: options.day || 'numeric',
    hour: undefined,
    minute: undefined,
    hour12: undefined
  });
}

function buildOrgTimezoneContext(user = null) {
  const timeZone = user ? resolveActiveOrgTimezoneFromUser(user) : resolveDefaultTimezone();
  const today = user?.orgToday && /^\d{4}-\d{2}-\d{2}$/.test(String(user.orgToday))
    ? String(user.orgToday)
    : getTodayDateKeyInTimezone(timeZone);
  return {
    timeZone,
    today,
    source: user?.activeOrgTimeZone ? 'user' : (user ? 'allowedOrgs' : 'default')
  };
}

function attachOrgTimezoneContext(req, res) {
  const user = req?.user || null;
  const context = buildOrgTimezoneContext(user);
  req.orgTimeZone = context.timeZone;
  req.orgToday = context.today;
  if (user && !user.activeOrgTimeZone) {
    user.activeOrgTimeZone = context.timeZone;
  }
  if (user && !user.orgToday) {
    user.orgToday = context.today;
  }
  if (res?.locals) {
    res.locals.orgTimeZone = context.timeZone;
    res.locals.orgToday = context.today;
    res.locals.formatOrgDateTime = (value, opts = {}) => formatInstantInTimezone(value, context.timeZone, opts);
    res.locals.formatOrgDate = (value, opts = {}) => formatDateKeyInTimezone(value, context.timeZone, opts);
  }
  return context;
}

function resolveOrgTodayFromRequest(req) {
  const fromRequest = String(req?.orgToday || req?.user?.orgToday || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromRequest)) return fromRequest;
  return getTodayDateKeyInTimezone(req?.orgTimeZone || req?.user?.activeOrgTimeZone);
}

function resolveOrgYearFromRequest(req) {
  return resolveOrgTodayFromRequest(req).slice(0, 4);
}

function resolveOrgTodayFromContext({ orgToday, orgTimeZone, user, orgId } = {}) {
  void orgId;
  const explicit = String(orgToday || user?.orgToday || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;

  const tzToken = cleanTimezoneToken(orgTimeZone || user?.activeOrgTimeZone);
  if (tzToken && isValidTimezoneToken(tzToken)) {
    return getTodayDateKeyInTimezone(normalizeTimezoneToken(tzToken, resolveDefaultTimezone()));
  }

  return new Date().toISOString().slice(0, 10);
}

/**
 * Convert a wall-clock date+time in a named timezone to a UTC epoch ms.
 * dateKey: YYYY-MM-DD, timeHm: HH:mm or HH:mm:ss
 */
function zonedWallClockToUtcMs(dateKey = '', timeHm = '00:00', timeZone = FALLBACK_TIMEZONE) {
  const dateToken = String(dateKey || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateToken)) return NaN;
  const timeToken = String(timeHm || '00:00').trim() || '00:00';
  const timeMatch = timeToken.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!timeMatch) return NaN;

  const year = Number(dateToken.slice(0, 4));
  const month = Number(dateToken.slice(5, 7));
  const day = Number(dateToken.slice(8, 10));
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] || 0);
  if (![year, month, day, hour, minute, second].every((n) => Number.isFinite(n))) return NaN;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return NaN;

  const tz = normalizeTimezoneToken(timeZone, FALLBACK_TIMEZONE);
  const desiredUtcLike = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = desiredUtcLike;

  for (let i = 0; i < 6; i += 1) {
    const parts = getDateTimePartsInTimezone(guess, tz);
    if (!parts) return NaN;
    let partHour = Number(parts.hour);
    if (partHour === 24) partHour = 0;
    const actualUtcLike = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      partHour,
      Number(parts.minute),
      Number(parts.second)
    );
    const delta = desiredUtcLike - actualUtcLike;
    if (delta === 0) return guess;
    guess += delta;
  }

  return guess;
}

function zonedWallClockToIso(dateKey = '', timeHm = '00:00', timeZone = FALLBACK_TIMEZONE) {
  const ms = zonedWallClockToUtcMs(dateKey, timeHm, timeZone);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString();
}

module.exports = {
  FALLBACK_TIMEZONE,
  cleanTimezoneToken,
  isValidTimezoneToken,
  normalizeTimezoneToken,
  resolveDefaultTimezone,
  resolveOrganizationTimezoneFromRow,
  resolveActiveOrgTimezoneFromUser,
  getDateTimePartsInTimezone,
  getTodayDateKeyInTimezone,
  getDateKeyInTimezone,
  formatInstantInTimezone,
  formatDateKeyInTimezone,
  buildOrgTimezoneContext,
  attachOrgTimezoneContext,
  resolveOrgTodayFromRequest,
  resolveOrgYearFromRequest,
  resolveOrgTodayFromContext,
  zonedWallClockToUtcMs,
  zonedWallClockToIso,
  listCuratedTimezoneOptions,
  isCuratedTimezoneValue,
  parseOrganizationTimezoneInput,
  formatNowInTimezone
};
