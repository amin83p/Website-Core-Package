'use strict';

const {
  toUtcMsFromTimezoneLocal,
  shiftCalendarParts,
  getDateTimePartsInTimezone
} = require('../../utils/timezoneUtils');

const ARCHIVE_ZIP_NAME_RE = /^activity-archive_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})_(EXP-[^/\\]+\.zip)$/i;

function cleanDateKey(value) {
  const token = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function parseDateKeyParts(dateKey) {
  const token = String(dateKey || '').trim();
  const match = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return { year, month, day };
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

function msToArchiveDateKey(ms, timezone) {
  const parts = getDateTimePartsInTimezone(Number(ms || 0), String(timezone || 'UTC').trim() || 'UTC');
  if (!parts || !parts.year) return '';
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function timestampInArchiveRange(isoValue, bounds) {
  const ms = new Date(String(isoValue || '')).getTime();
  if (!Number.isFinite(ms)) return false;
  return ms >= bounds.dayStartMs && ms <= bounds.dayEndMs;
}

function buildArchiveBoundsMongoFieldClause(field, bounds) {
  if (!field || !bounds) return null;
  const startDate = new Date(bounds.dayStartMs);
  const endDate = new Date(bounds.dayEndMs);
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return null;
  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();
  return {
    $or: [
      { [field]: { $gte: startDate, $lte: endDate } },
      { [field]: { $gte: startIso, $lte: endIso } }
    ]
  };
}

function buildArchiveBoundsMongoFilter(bounds, dateFields = []) {
  const fields = (Array.isArray(dateFields) ? dateFields : [dateFields])
    .map((f) => String(f || '').trim())
    .filter(Boolean);
  if (!fields.length) return {};
  const clauses = fields
    .map((field) => buildArchiveBoundsMongoFieldClause(field, bounds))
    .filter(Boolean);
  if (!clauses.length) return {};
  if (clauses.length === 1) return clauses[0];
  return { $or: clauses };
}

const ACTION_STATE_ARCHIVE_DATE_FIELDS = Object.freeze([
  'startedAt',
  'createdAt',
  'updatedAt',
  'lastActiveAt'
]);

function actionStateArchiveTimestamp(row) {
  if (!row || typeof row !== 'object') return '';
  return row.startedAt || row.createdAt || row.updatedAt || '';
}

/** Match Activity Tracking date filters: any canonical timestamp falls in org-timezone range. */
function actionStateRowInArchiveRange(row, bounds) {
  if (!row || typeof row !== 'object' || !bounds) return false;
  return ACTION_STATE_ARCHIVE_DATE_FIELDS.some((field) => (
    timestampInArchiveRange(row[field], bounds)
  ));
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

function isActivityArchiveZipName(name) {
  return Boolean(parseArchiveZipFileName(name));
}

module.exports = {
  cleanDateKey,
  parseDateKeyParts,
  resolveArchiveRangeBoundsMs,
  msToArchiveDateKey,
  timestampInArchiveRange,
  buildArchiveBoundsMongoFieldClause,
  buildArchiveBoundsMongoFilter,
  actionStateArchiveTimestamp,
  actionStateRowInArchiveRange,
  ACTION_STATE_ARCHIVE_DATE_FIELDS,
  dateKeysOverlap,
  userRangeExtendsBeyondManifest,
  parseArchiveZipFileName,
  isActivityArchiveZipName,
  ARCHIVE_ZIP_NAME_RE
};
