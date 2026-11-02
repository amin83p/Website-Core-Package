(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LogArchiveAnalyzerRange = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ARCHIVE_ZIP_NAME_RE = /^activity-archive_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})_(EXP-[^/\\]+\.zip)$/i;
  const FALLBACK_TIMEZONE = 'UTC';

  function cleanDateKey(value) {
    const token = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
  }

  function parseDateKeyParts(dateKey) {
    const token = String(dateKey || '').trim();
    const match = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return {
      year: Number.parseInt(match[1], 10),
      month: Number.parseInt(match[2], 10),
      day: Number.parseInt(match[3], 10)
    };
  }

  function normalizeTimezoneToken(value) {
    const token = String(value || '').trim().slice(0, 80) || FALLBACK_TIMEZONE;
    try {
      Intl.DateTimeFormat('en-US', { timeZone: token });
      return token;
    } catch (_) {
      return FALLBACK_TIMEZONE;
    }
  }

  function getDateTimePartsInTimezone(ms, timeZone) {
    const date = new Date(Number(ms || 0));
    if (Number.isNaN(date.getTime())) return null;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: normalizeTimezoneToken(timeZone),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        hour12: false
      }).formatToParts(date);
      const pick = (type) => parts.find((part) => part.type === type)?.value || '';
      let hour = Number(pick('hour') || 0);
      if (hour === 24) hour = 0;
      return {
        year: Number(pick('year') || 0),
        month: Number(pick('month') || 0),
        day: Number(pick('day') || 0),
        hour,
        minute: Number(pick('minute') || 0),
        second: Number(pick('second') || 0)
      };
    } catch (_) {
      return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
        second: date.getUTCSeconds()
      };
    }
  }

  function shiftCalendarParts(parts, deltaDays) {
    const year = Number(parts.year || 0);
    const month = Number(parts.month || 0);
    const day = Number(parts.day || 0);
    if (!year || !month || !day) return { year: 0, month: 0, day: 0 };
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + Number(deltaDays || 0));
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate()
    };
  }

  function toUtcMsFromTimezoneLocal(parts, timeZone) {
    const year = Number(parts.year || 0);
    const month = Number(parts.month || 0);
    const day = Number(parts.day || 0);
    const hour = Number(parts.hour || 0);
    const minute = Number(parts.minute || 0);
    const second = Number(parts.second || 0);
    if (!year || !month || !day) return Number.NaN;
    let guess = Date.UTC(year, month - 1, day, hour, minute, second);
    for (let i = 0; i < 3; i += 1) {
      const currentParts = getDateTimePartsInTimezone(guess, timeZone);
      if (!currentParts) break;
      const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, second);
      const currentUtc = Date.UTC(
        currentParts.year,
        currentParts.month - 1,
        currentParts.day,
        currentParts.hour,
        currentParts.minute,
        currentParts.second
      );
      const diff = desiredUtc - currentUtc;
      if (!diff) break;
      guess += diff;
    }
    return guess;
  }

  function msToArchiveDateKey(ms, timezone) {
    const parts = getDateTimePartsInTimezone(Number(ms || 0), timezone);
    if (!parts || !parts.year) return '';
    return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  }

  function resolveArchiveRangeBoundsMs(startDate, endDate, timezone) {
    const startParts = parseDateKeyParts(startDate);
    const endParts = parseDateKeyParts(endDate);
    if (!startParts || !endParts) {
      return { dayStartMs: Number.NEGATIVE_INFINITY, dayEndMs: Number.POSITIVE_INFINITY };
    }
    const dayStartMs = toUtcMsFromTimezoneLocal({
      year: startParts.year,
      month: startParts.month,
      day: startParts.day,
      hour: 0,
      minute: 0,
      second: 0
    }, timezone);
    const nextEndDay = shiftCalendarParts(endParts, 1);
    const endExclusiveMs = toUtcMsFromTimezoneLocal({
      year: nextEndDay.year,
      month: nextEndDay.month,
      day: nextEndDay.day,
      hour: 0,
      minute: 0,
      second: 0
    }, timezone);
    return {
      dayStartMs: Number.isFinite(dayStartMs) ? dayStartMs : Number.NEGATIVE_INFINITY,
      dayEndMs: Number.isFinite(endExclusiveMs) ? endExclusiveMs - 1 : Number.POSITIVE_INFINITY
    };
  }

  function timestampInArchiveRange(isoValue, bounds) {
    const ms = new Date(String(isoValue || '')).getTime();
    if (!Number.isFinite(ms)) return false;
    return ms >= bounds.dayStartMs && ms <= bounds.dayEndMs;
  }

  function dateKeysOverlap(userStart, userEnd, arcStart, arcEnd) {
    const u0 = cleanDateKey(userStart);
    const u1 = cleanDateKey(userEnd);
    const a0 = cleanDateKey(arcStart);
    const a1 = cleanDateKey(arcEnd);
    if (!u0 || !u1 || !a0 || !a1) return false;
    return u0 <= a1 && u1 >= a0;
  }

  function userRangeExtendsBeyondManifest(userStart, userEnd, arcStart, arcEnd) {
    const u0 = cleanDateKey(userStart);
    const u1 = cleanDateKey(userEnd);
    const a0 = cleanDateKey(arcStart);
    const a1 = cleanDateKey(arcEnd);
    if (!u0 || !u1 || !a0 || !a1) return false;
    return u0 < a0 || u1 > a1;
  }

  function parseArchiveZipFileName(name) {
    const base = String(name || '').trim().replace(/\\/g, '/').split('/').pop() || '';
    const match = base.match(ARCHIVE_ZIP_NAME_RE);
    if (!match) return null;
    return {
      startDate: match[1],
      endDate: match[2],
      exportId: match[3].replace(/\.zip$/i, ''),
      fileName: base
    };
  }

  return {
    cleanDateKey,
    msToArchiveDateKey,
    resolveArchiveRangeBoundsMs,
    timestampInArchiveRange,
    dateKeysOverlap,
    userRangeExtendsBeyondManifest,
    parseArchiveZipFileName,
    ARCHIVE_ZIP_NAME_RE
  };
}));
