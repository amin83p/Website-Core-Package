'use strict';

const trackActivityCore = require('./trackActivityCore');
const {
  getDateTimePartsInTimezone,
  getDayBoundsMs
} = require('../../utils/timezoneUtils');

const {
  cleanText,
  clamp,
  buildLookupMap,
  parseTimelineFilters,
  buildSafeFiltersForResponse,
  resolveLogTimestamp,
  resolveSectionInfo,
  resolveOperationInfo,
  buildDateTokensForQuery,
  resolveDayWindowsForRange,
  MAX_RANGE_DAYS,
  DEFAULT_ORG_TIMEZONE
} = trackActivityCore;

function normalizeTimezoneToken(value, fallback = DEFAULT_ORG_TIMEZONE) {
  const token = cleanText(value, 80) || fallback;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: token });
    return token;
  } catch (_) {
    return fallback;
  }
}

function formatDateTimeInTimezone(ms, timeZone = DEFAULT_ORG_TIMEZONE) {
  const date = new Date(Number(ms || 0));
  if (Number.isNaN(date.getTime())) return '-';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: normalizeTimezoneToken(timeZone, DEFAULT_ORG_TIMEZONE),
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  } catch (_) {
    return date.toISOString();
  }
}

function formatDateInTimezone(ms, timeZone = DEFAULT_ORG_TIMEZONE) {
  const date = new Date(Number(ms || 0));
  if (Number.isNaN(date.getTime())) return '-';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: normalizeTimezoneToken(timeZone, DEFAULT_ORG_TIMEZONE),
      year: 'numeric',
      month: 'short',
      day: '2-digit'
    }).format(date);
  } catch (_) {
    return date.toISOString().slice(0, 10);
  }
}

function toDateKeyInTimezone(ms, timeZone = DEFAULT_ORG_TIMEZONE) {
  const parts = getDateTimePartsInTimezone(ms, timeZone);
  if (!parts) return '';
  const yyyy = String(parts.year || 0).padStart(4, '0');
  const mm = String(parts.month || 0).padStart(2, '0');
  const dd = String(parts.day || 0).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function mapRangeMeta(filters = {}, timezone = DEFAULT_ORG_TIMEZONE) {
  return {
    startAt: filters.startAt,
    endAt: filters.endAt,
    startAtMs: filters.startAtMs,
    endAtMs: filters.endAtMs,
    focusStartAt: filters.focusStartAt,
    focusEndAt: filters.focusEndAt,
    focusStartAtMs: filters.focusStartAtMs,
    focusEndAtMs: filters.focusEndAtMs,
    timezone,
    rangeTrimmed: Boolean(filters.rangeTrimmed),
    maxRangeDays: MAX_RANGE_DAYS
  };
}

function toHourLabel(hour) {
  const safe = clamp(Number(hour) || 0, 0, 23);
  const token = String(safe).padStart(2, '0');
  return `${token}:00 - ${token}:59`;
}

function toHourIsoWindow(dayStartMs, hourOffsetMs) {
  const startMs = Number(dayStartMs || 0) + Number(hourOffsetMs || 0);
  const endMs = startMs + (60 * 60 * 1000) - 1;
  return {
    startAtMs: startMs,
    endAtMs: endMs,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString()
  };
}

function normalizeTrackTimelineZoomLevel(value) {
  const token = cleanText(value, 20).toLowerCase();
  if (token === '5m') return '5m';
  if (token === '15s') return '15s';
  return 'hourly';
}

function normalizeHourIndex(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) return -1;
  return parsed;
}

function normalizeFiveMinuteIndex(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 11) return -1;
  return parsed;
}

function resolveTimelineDayKey(ms, timezone = DEFAULT_ORG_TIMEZONE) {
  return toDateKeyInTimezone(ms, timezone);
}

function resolveTimelineTimeParts(ms, timezone = DEFAULT_ORG_TIMEZONE) {
  const parts = getDateTimePartsInTimezone(ms, timezone);
  if (!parts) return null;
  return {
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function toFiveMinuteLabel(hour, fiveMinuteIndex) {
  const safeHour = clamp(Number(hour) || 0, 0, 23);
  const safeFive = clamp(Number(fiveMinuteIndex) || 0, 0, 11);
  const startMinute = safeFive * 5;
  const endMinute = startMinute + 4;
  return `${String(safeHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')} - ${String(safeHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
}

function toFifteenSecondLabel(hour, fiveMinuteIndex, secondChunkIndex) {
  const safeHour = clamp(Number(hour) || 0, 0, 23);
  const safeFive = clamp(Number(fiveMinuteIndex) || 0, 0, 11);
  const safeChunk = clamp(Number(secondChunkIndex) || 0, 0, 19);
  const minuteBase = safeFive * 5;
  const startTotalSeconds = safeChunk * 15;
  const endTotalSeconds = startTotalSeconds + 14;
  const startMinuteOffset = Math.floor(startTotalSeconds / 60);
  const endMinuteOffset = Math.floor(endTotalSeconds / 60);
  const startSecond = startTotalSeconds % 60;
  const endSecond = endTotalSeconds % 60;
  const startMinute = minuteBase + startMinuteOffset;
  const endMinute = minuteBase + endMinuteOffset;
  return `${String(safeHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}:${String(startSecond).padStart(2, '0')} - ${String(safeHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:${String(endSecond).padStart(2, '0')}`;
}

function buildEmptyMetricSlots(length = 0) {
  return Array.from({ length: Math.max(0, Number(length) || 0) }, () => ({
    requestCount: 0,
    attemptCount: 0
  }));
}

function applyColorWeights(chunks = []) {
  const busiest = (Array.isArray(chunks) ? chunks : [])
    .reduce((max, row) => Math.max(max, Number(row?.requestCount || 0)), 0);

  (Array.isArray(chunks) ? chunks : []).forEach((row) => {
    const ratio = busiest > 0 ? (Number(row.requestCount || 0) / busiest) : 0;
    row.colorWeight = Number(ratio.toFixed(3));
  });

  return busiest;
}

function isAttemptLikeLog(log = {}, sectionName = '', operationName = '') {
  const sectionToken = cleanText(sectionName || log?.sectionId, 140).toLowerCase();
  const operationToken = cleanText(operationName || log?.operationId, 140).toLowerCase();
  const details = (log && typeof log.details === 'object') ? log.details : {};
  const urlToken = cleanText(details.url || details.targetUrl || details.path, 260).toLowerCase();

  if (sectionToken.includes('attempt') || operationToken.includes('attempt')) return true;
  if (urlToken.includes('/attempt')) return true;
  if (urlToken.includes('/practice/start') || urlToken.includes('/practice/attempt')) return true;
  return false;
}

function logMatchesTimelineFilters(log, filters, sectionIds, operationIds, orgIds) {
  const timestampToken = resolveLogTimestamp(log);
  if (!timestampToken) return false;
  const occurredAtMs = new Date(timestampToken).getTime();
  if (!Number.isFinite(occurredAtMs)) return false;
  if (occurredAtMs < filters.startAtMs || occurredAtMs > filters.endAtMs) return false;

  if (filters.userId) {
    const details = (log && typeof log.details === 'object') ? log.details : {};
    const actor = (details.actor && typeof details.actor === 'object') ? details.actor : {};
    const userToken = cleanText(log?.userId || actor.userId, 120);
    if (userToken !== filters.userId) return false;
  }

  if (sectionIds.length) {
    const sid = cleanText(log?.sectionId, 120);
    if (!sectionIds.includes(sid)) return false;
  }
  if (operationIds.length) {
    const oid = cleanText(log?.operationId, 120);
    if (!operationIds.includes(oid)) return false;
  }
  if (orgIds.length) {
    const oid = cleanText(log?.orgId, 120);
    if (!orgIds.includes(oid)) return false;
  }

  if (filters.status) {
    const statusToken = cleanText(log?.status, 80).toLowerCase();
    if (!statusToken.includes(String(filters.status).toLowerCase())) return false;
  }

  if (filters.q) {
    const q = String(filters.q).toLowerCase();
    const blob = [
      log?.summary,
      log?.userId,
      log?.sectionId,
      log?.operationId,
      JSON.stringify(log?.details || {})
    ].join(' ').toLowerCase();
    if (!blob.includes(q)) return false;
  }

  return true;
}

function filterLogsForHourlyTimeline(logs, filters, sectionIds, operationIds, orgIds) {
  return (Array.isArray(logs) ? logs : []).filter((log) => logMatchesTimelineFilters(
    log,
    filters,
    sectionIds,
    operationIds,
    orgIds
  ));
}

function buildHourlyTimelineFromLogs({
  logs = [],
  rawQuery = {},
  timezone = DEFAULT_ORG_TIMEZONE,
  lookups = { sections: [], operations: [] },
  presetFilters = null
} = {}) {
  const filters = presetFilters || parseTimelineFilters(rawQuery, timezone);
  const requestedZoomLevel = normalizeTrackTimelineZoomLevel(rawQuery?.zoomLevel);
  const focusDay = cleanText(rawQuery?.focusDay, 20);
  const focusHour = normalizeHourIndex(rawQuery?.focusHour);
  const focusFiveMinute = normalizeFiveMinuteIndex(rawQuery?.focusFiveMinute);

  const dayWindows = resolveDayWindowsForRange(filters.startAtMs, filters.endAtMs, timezone);
  const sectionIds = (Array.isArray(filters.sectionIds) ? filters.sectionIds : [])
    .map((id) => cleanText(id, 120)).filter(Boolean);
  const operationIds = (Array.isArray(filters.operationIds) ? filters.operationIds : [])
    .map((id) => cleanText(id, 120)).filter(Boolean);
  const orgIds = (Array.isArray(filters.orgIds) ? filters.orgIds : [])
    .map((id) => cleanText(id, 120)).filter(Boolean);

  const filteredLogs = filterLogsForHourlyTimeline(logs, filters, sectionIds, operationIds, orgIds);

  const dayWindowMap = new Map();
  const dayHourCounters = new Map();
  dayWindows.forEach((window) => {
    const key = cleanText(window?.dateKey, 20);
    if (!key) return;
    dayWindowMap.set(key, window);
    dayHourCounters.set(key, buildEmptyMetricSlots(24));
  });

  const sectionMap = buildLookupMap(lookups.sections);
  const operationMap = buildLookupMap(lookups.operations);
  const fiveMinuteCounters = new Map();
  const fifteenSecondCounters = new Map();

  const ensureFiveMinuteSlots = (key) => {
    if (!fiveMinuteCounters.has(key)) fiveMinuteCounters.set(key, buildEmptyMetricSlots(12));
    return fiveMinuteCounters.get(key);
  };
  const ensureFifteenSecondSlots = (key) => {
    if (!fifteenSecondCounters.has(key)) fifteenSecondCounters.set(key, buildEmptyMetricSlots(20));
    return fifteenSecondCounters.get(key);
  };

  filteredLogs.forEach((log) => {
    const timestampToken = resolveLogTimestamp(log);
    if (!timestampToken) return;
    const occurredAtMs = new Date(timestampToken).getTime();
    if (!Number.isFinite(occurredAtMs)) return;
    if (occurredAtMs < filters.startAtMs || occurredAtMs > filters.endAtMs) return;

    const dayKey = resolveTimelineDayKey(occurredAtMs, timezone);
    const daySlots = dayHourCounters.get(dayKey);
    if (!Array.isArray(daySlots)) return;

    const hourParts = resolveTimelineTimeParts(occurredAtMs, timezone);
    const hour = clamp(Number(hourParts?.hour || 0), 0, 23);
    const minute = clamp(Number(hourParts?.minute || 0), 0, 59);
    const second = clamp(Number(hourParts?.second || 0), 0, 59);
    const slot = daySlots[hour];
    if (!slot) return;

    const sectionInfo = resolveSectionInfo(log.sectionId, sectionMap);
    const operationInfo = resolveOperationInfo(log.operationId, operationMap);
    slot.requestCount += 1;
    const fiveMinuteIndex = clamp(Math.floor(minute / 5), 0, 11);
    const fiveMinuteKey = `${dayKey}|${hour}`;
    const fiveSlots = ensureFiveMinuteSlots(fiveMinuteKey);
    fiveSlots[fiveMinuteIndex].requestCount += 1;

    const secondOffset = ((minute % 5) * 60) + second;
    const fifteenSecondIndex = clamp(Math.floor(secondOffset / 15), 0, 19);
    const fifteenSecondKey = `${dayKey}|${hour}|${fiveMinuteIndex}`;
    const fifteenSlots = ensureFifteenSecondSlots(fifteenSecondKey);
    fifteenSlots[fifteenSecondIndex].requestCount += 1;

    if (isAttemptLikeLog(log, sectionInfo?.name, operationInfo?.name)) {
      slot.attemptCount += 1;
      fiveSlots[fiveMinuteIndex].attemptCount += 1;
      fifteenSlots[fifteenSecondIndex].attemptCount += 1;
    }
  });

  const dayTimelines = dayWindows.map((window) => {
    const key = cleanText(window?.dateKey, 20);
    const dayStartMs = Number(window?.dayStartMs || 0);
    const dayEndMs = Number(window?.dayEndMs || (dayStartMs + (24 * 60 * 60 * 1000) - 1));
    const daySlots = dayHourCounters.get(key) || buildEmptyMetricSlots(24);
    const chunks = Array.from({ length: 24 }, (_, hour) => {
      const slot = daySlots[hour] || { requestCount: 0, attemptCount: 0 };
      const hourWindow = toHourIsoWindow(dayStartMs, hour * 60 * 60 * 1000);
      return {
        hour,
        label: toHourLabel(hour),
        requestCount: Number(slot.requestCount || 0),
        attemptCount: Number(slot.attemptCount || 0),
        ...hourWindow,
        colorWeight: 0
      };
    });
    const busiest = applyColorWeights(chunks);
    const totalRequests = chunks.reduce((sum, chunk) => sum + Number(chunk.requestCount || 0), 0);
    const totalAttempts = chunks.reduce((sum, chunk) => sum + Number(chunk.attemptCount || 0), 0);
    return {
      dateKey: key,
      label: formatDateInTimezone(dayStartMs, timezone),
      startAt: new Date(dayStartMs).toISOString(),
      endAt: new Date(dayEndMs).toISOString(),
      startAtDisplay: formatDateTimeInTimezone(dayStartMs, timezone),
      endAtDisplay: formatDateTimeInTimezone(dayEndMs, timezone),
      totalRequests,
      totalAttempts,
      busiestChunkRequests: busiest,
      chunks
    };
  });

  const totalRequests = dayTimelines.reduce((sum, day) => sum + Number(day.totalRequests || 0), 0);
  const totalAttempts = dayTimelines.reduce((sum, day) => sum + Number(day.totalAttempts || 0), 0);
  const globalBusiestHour = dayTimelines.reduce((max, day) => Math.max(max, Number(day.busiestChunkRequests || 0)), 0);

  let zoomLevel = requestedZoomLevel;
  let focusTimeline = null;

  if (requestedZoomLevel === '5m') {
    const focusWindow = dayWindowMap.get(focusDay);
    if (focusWindow && focusHour >= 0) {
      const fiveKey = `${focusDay}|${focusHour}`;
      const fiveSlots = fiveMinuteCounters.get(fiveKey) || buildEmptyMetricSlots(12);
      const hourWindow = toHourIsoWindow(focusWindow.dayStartMs, focusHour * 60 * 60 * 1000);
      const chunks = Array.from({ length: 12 }, (_, index) => {
        const startMs = Number(hourWindow.startAtMs) + (index * 5 * 60 * 1000);
        const endMs = startMs + (5 * 60 * 1000) - 1;
        const slot = fiveSlots[index] || { requestCount: 0, attemptCount: 0 };
        return {
          index,
          label: toFiveMinuteLabel(focusHour, index),
          requestCount: Number(slot.requestCount || 0),
          attemptCount: Number(slot.attemptCount || 0),
          startAtMs: startMs,
          endAtMs: endMs,
          startAt: new Date(startMs).toISOString(),
          endAt: new Date(endMs).toISOString(),
          startAtDisplay: formatDateTimeInTimezone(startMs, timezone),
          endAtDisplay: formatDateTimeInTimezone(endMs, timezone),
          colorWeight: 0
        };
      });
      applyColorWeights(chunks);
      focusTimeline = {
        zoomLevel: '5m',
        dateKey: focusDay,
        hour: focusHour,
        title: `${formatDateInTimezone(focusWindow.dayStartMs, timezone)} • ${toHourLabel(focusHour)}`,
        subtitle: '5-minute chunks',
        chunks
      };
    } else {
      zoomLevel = 'hourly';
    }
  } else if (requestedZoomLevel === '15s') {
    const focusWindow = dayWindowMap.get(focusDay);
    if (focusWindow && focusHour >= 0 && focusFiveMinute >= 0) {
      const fifteenKey = `${focusDay}|${focusHour}|${focusFiveMinute}`;
      const fifteenSlots = fifteenSecondCounters.get(fifteenKey) || buildEmptyMetricSlots(20);
      const hourWindow = toHourIsoWindow(focusWindow.dayStartMs, focusHour * 60 * 60 * 1000);
      const focusFiveStartMs = Number(hourWindow.startAtMs) + (focusFiveMinute * 5 * 60 * 1000);
      const chunks = Array.from({ length: 20 }, (_, index) => {
        const startMs = focusFiveStartMs + (index * 15 * 1000);
        const endMs = startMs + (15 * 1000) - 1;
        const slot = fifteenSlots[index] || { requestCount: 0, attemptCount: 0 };
        return {
          index,
          label: toFifteenSecondLabel(focusHour, focusFiveMinute, index),
          requestCount: Number(slot.requestCount || 0),
          attemptCount: Number(slot.attemptCount || 0),
          startAtMs: startMs,
          endAtMs: endMs,
          startAt: new Date(startMs).toISOString(),
          endAt: new Date(endMs).toISOString(),
          startAtDisplay: formatDateTimeInTimezone(startMs, timezone),
          endAtDisplay: formatDateTimeInTimezone(endMs, timezone),
          colorWeight: 0
        };
      });
      applyColorWeights(chunks);
      focusTimeline = {
        zoomLevel: '15s',
        dateKey: focusDay,
        hour: focusHour,
        fiveMinute: focusFiveMinute,
        title: `${formatDateInTimezone(focusWindow.dayStartMs, timezone)} • ${toFiveMinuteLabel(focusHour, focusFiveMinute)}`,
        subtitle: '15-second chunks',
        chunks
      };
    } else {
      zoomLevel = 'hourly';
    }
  }

  return {
    timezone,
    filters: buildSafeFiltersForResponse(filters),
    range: mapRangeMeta(filters, timezone),
    zoomLevel,
    focus: {
      day: focusDay,
      hour: focusHour,
      fiveMinute: focusFiveMinute
    },
    summary: {
      totalRequests,
      totalAttempts,
      busiestChunkRequests: globalBusiestHour,
      daysCount: dayTimelines.length
    },
    dayTimelines,
    focusTimeline
  };
}

module.exports = {
  buildHourlyTimelineFromLogs,
  filterLogsForHourlyTimeline,
  logMatchesTimelineFilters
};
