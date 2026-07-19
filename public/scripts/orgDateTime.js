(function initAppOrgDateTime(global) {
  const config = global.__APP_ORG_DATETIME__ || {};
  const fallbackTimeZone = String(config.timeZone || 'UTC').trim() || 'UTC';
  const fallbackToday = String(config.today || '').trim();

  function cleanToken(value) {
    return String(value ?? '').trim();
  }

  function isValidTimeZone(token) {
    if (!token) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: token });
      return true;
    } catch (_) {
      return false;
    }
  }

  function resolveTimeZone(value) {
    const token = cleanToken(value || fallbackTimeZone);
    return isValidTimeZone(token) ? token : (isValidTimeZone(fallbackTimeZone) ? fallbackTimeZone : 'UTC');
  }

  function coerceInstantMs(value) {
    if (value === undefined || value === null || value === '') return NaN;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const date = new Date(value);
    return date.getTime();
  }

  function getDateParts(ms, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(ms));
    const pick = (type) => parts.find((part) => part.type === type)?.value || '';
    return {
      year: pick('year'),
      month: pick('month'),
      day: pick('day')
    };
  }

  function todayDateKey(timeZone) {
    const tz = resolveTimeZone(timeZone);
    const parts = getDateParts(Date.now(), tz);
    if (!parts.year || !parts.month || !parts.day) return fallbackToday || '';
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function formatInstant(value, options = {}) {
    const ms = coerceInstantMs(value);
    if (!Number.isFinite(ms)) return '-';
    const tz = resolveTimeZone(options.timeZone);
    const formatOptions = {
      timeZone: tz,
      year: options.year || 'numeric',
      month: options.month || 'short',
      day: options.day || '2-digit',
      hour: options.hour || '2-digit',
      minute: options.minute || '2-digit',
      hour12: options.hour12 !== undefined ? options.hour12 : false
    };
    if (options.second) formatOptions.second = options.second;
    if (options.weekday) formatOptions.weekday = options.weekday;
    try {
      return new Intl.DateTimeFormat('en-US', formatOptions).format(new Date(ms));
    } catch (_) {
      return new Date(ms).toISOString();
    }
  }

  function parseDateKey(dateKey) {
    const token = cleanToken(dateKey);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return null;
    const [year, month, day] = token.split('-').map((part) => Number(part));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    return { year, month, day };
  }

  function dateKeyToDate(dateKey) {
    const parts = parseDateKey(dateKey);
    if (!parts) return null;
    return new Date(parts.year, parts.month - 1, parts.day);
  }

  function dateToDateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function orgYear(timeZone) {
    const today = timeZone ? todayDateKey(timeZone) : (fallbackToday || todayDateKey());
    return today ? today.slice(0, 4) : '';
  }

  function formatSchoolInstant(value, options = {}) {
    return formatInstant(value, options);
  }

  function formatDateKey(dateKey, options = {}) {
    const token = cleanToken(dateKey);
    if (!token) return '-';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
    const date = dateKeyToDate(token);
    if (!date || Number.isNaN(date.getTime())) return token;
    const formatOptions = {
      year: options.year || 'numeric',
      month: options.month || 'short',
      day: options.day || 'numeric'
    };
    if (options.weekday) formatOptions.weekday = options.weekday;
    try {
      return new Intl.DateTimeFormat('en-US', formatOptions).format(date);
    } catch (_) {
      return token;
    }
  }

  global.AppOrgDateTime = {
    timeZone: resolveTimeZone(),
    today: fallbackToday || todayDateKey(),
    resolveTimeZone,
    todayDateKey,
    orgYear,
    formatInstant,
    formatSchoolInstant,
    formatDateKey,
    parseDateKey,
    dateKeyToDate,
    dateToDateKey
  };
})(window);
