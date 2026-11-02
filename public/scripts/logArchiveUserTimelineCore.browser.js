(function (root, factory) {
  const api = factory(root.LogArchiveAnalyzerRange || {});
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.LogArchiveUserTimelineCore = api;
  }
}(typeof self !== 'undefined' ? self : this, function (Range) {
  'use strict';

  const WINDOW_DAYS = 3;
  const cleanDateKey = Range.cleanDateKey || ((v) => String(v || '').trim());
  const resolveArchiveRangeBoundsMs = Range.resolveArchiveRangeBoundsMs
    || (() => ({ dayStartMs: 0, dayEndMs: 0 }));
  const msToArchiveDateKey = Range.msToArchiveDateKey || (() => '');
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

  function compareDateKeys(a, b) {
    return String(a || '').localeCompare(String(b || ''));
  }

  function addCalendarDays(dateKey, deltaDays) {
    const parts = parseDateKeyParts(dateKey);
    if (!parts) return '';
    const shifted = shiftCalendarParts(parts, deltaDays);
    return `${String(shifted.year).padStart(4, '0')}-${String(shifted.month).padStart(2, '0')}-${String(shifted.day).padStart(2, '0')}`;
  }

  function computeCalendarWindows(reportStart, reportEnd, timezone, windowDays) {
    const start = cleanDateKey(reportStart);
    const end = cleanDateKey(reportEnd);
    const days = Math.max(1, Number(windowDays) || WINDOW_DAYS);
    if (!start || !end || compareDateKeys(start, end) > 0) return [];

    const windows = [];
    let cursor = start;
    while (compareDateKeys(cursor, end) <= 0) {
      let windowEnd = cursor;
      for (let i = 1; i < days; i += 1) {
        const next = addCalendarDays(windowEnd, 1);
        if (!next || compareDateKeys(next, end) > 0) break;
        windowEnd = next;
      }
      const bounds = resolveArchiveRangeBoundsMs(cursor, windowEnd, timezone);
      windows.push({
        startDate: cursor,
        endDate: windowEnd,
        startMs: bounds.dayStartMs,
        endMs: bounds.dayEndMs
      });
      const after = addCalendarDays(windowEnd, 1);
      if (!after || compareDateKeys(after, end) > 0) break;
      cursor = after;
    }
    return windows;
  }

  function advanceWindow(windows, index, delta) {
    const list = Array.isArray(windows) ? windows : [];
    if (!list.length) return 0;
    return Math.max(0, Math.min(list.length - 1, Number(index) + Number(delta || 0)));
  }

  function groupEventsByDay(events, timezone) {
    const tz = String(timezone || 'UTC');
    const map = new Map();
    (Array.isArray(events) ? events : []).forEach((event) => {
      const ms = Number(event?.occurredAtMs || 0);
      if (!Number.isFinite(ms) || ms <= 0) return;
      const key = msToArchiveDateKey(ms, tz);
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(event);
    });
    map.forEach((rows) => {
      rows.sort((a, b) => Number(a.occurredAtMs || 0) - Number(b.occurredAtMs || 0));
    });
    return map;
  }

  function computeDayColumnLayout(dayEvents, options) {
    const events = Array.isArray(dayEvents) ? dayEvents.slice() : [];
    events.sort((a, b) => Number(a.occurredAtMs || 0) - Number(b.occurredAtMs || 0));
    if (!events.length) {
      return { dayStartMs: 0, dayEndMs: 0, markers: [] };
    }
    let dayStartMs = Number(events[0].occurredAtMs || 0);
    let dayEndMs = Number(events[events.length - 1].occurredAtMs || 0);
    if (dayStartMs === dayEndMs) {
      dayEndMs = dayStartMs + 60000;
    }
    const span = dayEndMs - dayStartMs;
    const branchBase = Number(options?.branchBase) || 36;
    const markers = events.map((event, index) => {
      const ms = Number(event.occurredAtMs || 0);
      const yRatio = span > 0 ? (ms - dayStartMs) / span : 0.5;
      const side = index % 2 === 0 ? 1 : -1;
      const branchLength = branchBase + (index % 4) * 8;
    const normalizedRatio = events.length === 1 ? 0.5 : Math.max(0, Math.min(1, yRatio));
    return {
      eventId: String(event.id || ''),
      occurredAtMs: ms,
      yRatio: normalizedRatio,
        branchLength,
        branchSide: side,
        hasActionState: Boolean(event.hasActionState),
        source: String(event.source || 'log'),
        tooltipTitle: String(event.operationName || event.sectionName || event.sourceLabel || event.source || 'Activity'),
        tooltipTime: String(event.occurredAtDisplay || event.occurredAt || ''),
        tooltipMeta: String(event.statusRaw || event.summary || '').slice(0, 220)
      };
    });
    return { dayStartMs, dayEndMs, markers };
  }

  function layoutWindowColumns(events, windowDef, timezone) {
    const win = windowDef || {};
    const tz = String(timezone || 'UTC');
    const byDay = groupEventsByDay(events, tz);
    const columns = [];
    let cursor = cleanDateKey(win.startDate);
    const end = cleanDateKey(win.endDate);
    while (cursor && end && compareDateKeys(cursor, end) <= 0) {
      const dayEvents = byDay.get(cursor) || [];
      columns.push({
        dateKey: cursor,
        ...computeDayColumnLayout(dayEvents)
      });
      const next = addCalendarDays(cursor, 1);
      if (!next || next === cursor) break;
      cursor = next;
    }
    return columns;
  }

  function filterEventsToWindow(events, windowDef) {
    const win = windowDef || {};
    const startMs = Number(win.startMs);
    const endMs = Number(win.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return [];
    }
    return (Array.isArray(events) ? events : []).filter((event) => {
      const ms = Number(event?.occurredAtMs || 0);
      return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
    });
  }

  function layoutEqualSpacedBatch(events, options) {
    const list = (Array.isArray(events) ? events.slice() : [])
      .sort((a, b) => Number(a.occurredAtMs || 0) - Number(b.occurredAtMs || 0));
    if (!list.length) {
      return { markers: [], firstMs: 0, lastMs: 0 };
    }
    const branchBase = Number(options?.branchBase) || 36;
    const n = list.length;
    const markers = list.map((event, index) => {
      const yRatio = n === 1 ? 0.5 : index / (n - 1);
      const side = index % 2 === 0 ? 1 : -1;
      const branchLength = branchBase + (index % 4) * 8;
      const ms = Number(event.occurredAtMs || 0);
      return {
        eventId: String(event.id || ''),
        occurredAtMs: ms,
        yRatio,
        branchLength,
        branchSide: side,
        hasActionState: Boolean(event.hasActionState),
        source: String(event.source || 'log'),
        tooltipTitle: String(event.operationName || event.sectionName || event.sourceLabel || event.source || 'Activity'),
        tooltipTime: String(event.occurredAtDisplay || event.occurredAt || ''),
        tooltipMeta: String(event.statusRaw || event.summary || '').slice(0, 220)
      };
    });
    return {
      markers,
      firstMs: Number(list[0].occurredAtMs || 0),
      lastMs: Number(list[list.length - 1].occurredAtMs || 0)
    };
  }

  function layoutBatchedEqualSpacedTimelines(events, startDate, endDate, timezone, windowDays) {
    const windows = computeCalendarWindows(startDate, endDate, timezone, windowDays);
    return windows.map((window) => {
      const batchEvents = filterEventsToWindow(events, window);
      const layout = layoutEqualSpacedBatch(batchEvents);
      return {
        window,
        events: batchEvents,
        markers: layout.markers,
        firstMs: layout.firstMs,
        lastMs: layout.lastMs
      };
    });
  }

  return {
    WINDOW_DAYS,
    computeCalendarWindows,
    advanceWindow,
    groupEventsByDay,
    computeDayColumnLayout,
    layoutWindowColumns,
    filterEventsToWindow,
    layoutEqualSpacedBatch,
    layoutBatchedEqualSpacedTimelines
  };
}));
