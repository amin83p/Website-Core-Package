(function (root, factory) {
  const api = factory(
    root.TrackActivityCoreBrowser || {},
    root.LogArchiveAnalyzerRange || {}
  );
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TrackActivityArchiveLocal = api;
  }
}(typeof self !== 'undefined' ? self : this, function (Core, Range) {
  'use strict';

  function cleanText(value, max) {
    const text = String(value == null ? '' : value).trim();
    const cap = Number(max) > 0 ? Number(max) : 220;
    return text.length > cap ? text.slice(0, cap) : text;
  }

  function mergeLookups(session, pageConfig) {
    const cfg = pageConfig && typeof pageConfig === 'object' ? pageConfig : {};
    const base = cfg.lookups && typeof cfg.lookups === 'object' ? cfg.lookups : {};
    const refs = session?.refs && typeof session.refs === 'object' ? session.refs : {};
    const mergeRows = (a, b) => {
      const map = new Map();
      (Array.isArray(a) ? a : []).forEach((row) => {
        const id = cleanText(row?.id, 120);
        if (id) map.set(id, row);
      });
      (Array.isArray(b) ? b : []).forEach((row) => {
        const id = cleanText(row?.id, 120);
        if (id) map.set(id, { ...map.get(id), ...row, id });
      });
      return Array.from(map.values());
    };
    return {
      sections: mergeRows(base.sections, refs.sections),
      operations: mergeRows(base.operations, refs.operations),
      organizations: Array.isArray(base.orgs) ? base.orgs : (Array.isArray(base.organizations) ? base.organizations : [])
    };
  }

  function sessionTimezone(session) {
    return cleanText(
      session?.manifest?.timezone
        || session?.manifest?.reportRange?.timezone
        || session?.effectiveTimezone,
      80
    ) || 'UTC';
  }

  function allowedUserIdSet(session) {
    const ids = session?.reportSetup?.userIds;
    if (Array.isArray(ids) && ids.length) {
      return new Set(ids.map((id) => cleanText(id, 120)).filter(Boolean));
    }
    return null;
  }

  function clampFiltersToSession(filters, session) {
    const report = session?.reportSetup || {};
    const tz = sessionTimezone(session);
    let startMs = Number(filters.startAtMs);
    let endMs = Number(filters.endAtMs);
    if (Range.resolveArchiveRangeBoundsMs && report.startDate && report.endDate) {
      const bounds = Range.resolveArchiveRangeBoundsMs(report.startDate, report.endDate, tz);
      if (Number.isFinite(bounds.dayStartMs)) startMs = Math.max(startMs, bounds.dayStartMs);
      if (Number.isFinite(bounds.dayEndMs)) endMs = Math.min(endMs, bounds.dayEndMs);
    }
    const allowed = allowedUserIdSet(session);
    let userId = cleanText(filters.userId, 120);
    if (allowed && userId && !allowed.has(userId)) userId = '';
    if (allowed && userId && !allowed.has(userId)) {
      userId = '';
    }
    return {
      ...filters,
      startAtMs: startMs,
      endAtMs: endMs,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      userId,
      rangeTrimmed: false
    };
  }

  function paramsToRawQuery(params) {
    const raw = {};
    if (!params) return raw;
    if (params instanceof URLSearchParams) {
      params.forEach((value, key) => { raw[key] = value; });
      return raw;
    }
    return { ...params };
  }

  function toMaskedEventDetails(event, reveal, maskFn) {
    const mask = typeof maskFn === 'function' ? maskFn : (obj) => obj;
    const base = {
      eventId: event.id,
      occurredAt: event.occurredAt,
      occurredAtDisplay: event.occurredAtDisplay,
      requestId: event.requestId,
      actionStateId: event.actionStateId,
      statusRaw: event.statusRaw,
      summary: event.summary,
      source: event.source,
      sourceLabel: event.sourceLabel,
      sectionId: event.sectionId,
      sectionName: event.sectionName,
      operationId: event.operationId,
      operationName: event.operationName,
      userId: event.userId,
      username: event.username,
      displayName: event.displayName,
      actorPrimary: event.actorPrimary,
      actorSecondary: event.actorSecondary,
      orgId: event.orgId,
      orgName: event.orgName,
      contextLine: event.contextLine,
      recordId: event.recordId,
      hasActionState: Boolean(event.hasActionState)
    };
    base.details = reveal ? (event.details || {}) : mask(event.details || {});
    if (event.actionState) {
      base.actionState = {
        recordId: event.actionState.recordId,
        requestId: event.actionState.requestId,
        occurredAt: event.actionState.occurredAt,
        occurredAtDisplay: event.actionState.occurredAtDisplay,
        statusRaw: event.actionState.statusRaw,
        summary: event.actionState.summary,
        targetKey: event.actionState.targetKey,
        method: event.actionState.method,
        url: event.actionState.url,
        orgId: event.actionState.orgId,
        orgName: event.actionState.orgName,
        details: reveal ? (event.actionState.details || {}) : mask(event.actionState.details || {})
      };
    }
    return base;
  }

  function buildLocalEvents(session, rawQuery, lookups, presetFilters) {
    const tz = sessionTimezone(session);
    const filters = clampFiltersToSession(
      presetFilters || Core.parseTimelineFilters(rawQuery, tz),
      session
    );
    const allowed = allowedUserIdSet(session);
    let logs = Array.isArray(session.logs) ? session.logs.slice() : [];
    if (allowed) {
      logs = logs.filter((log) => {
        const details = log?.details && typeof log.details === 'object' ? log.details : {};
        const actor = details.actor && typeof details.actor === 'object' ? details.actor : {};
        const uid = cleanText(log?.userId || actor.userId, 120);
        return allowed.has(uid);
      });
    }
    const built = Core.buildEventsFromSourceRecords({
      logs,
      actionStates: session.actionStates || [],
      filters,
      timezone: tz,
      lookups: {
        sections: lookups.sections || [],
        operations: lookups.operations || [],
        organizations: lookups.organizations || []
      },
      userRows: []
    });
    return { ...built, filters };
  }

  function buildLocalTimelinePayload(session, formParams, pageConfig) {
    const rawQuery = paramsToRawQuery(formParams);
    const lookups = mergeLookups(session, pageConfig);
    const tz = sessionTimezone(session);
    const filters = clampFiltersToSession(Core.parseTimelineFilters(rawQuery, tz), session);
    return Core.buildHourlyTimelineFromLogs({
      logs: session.logs || [],
      rawQuery,
      timezone: tz,
      lookups,
      presetFilters: filters
    });
  }

  function resolveLocalDetails(session, query, pageConfig, options) {
    const rawQuery = paramsToRawQuery(query);
    const lookups = mergeLookups(session, pageConfig);
    const tz = sessionTimezone(session);
    const kind = cleanText(rawQuery.kind, 20).toLowerCase();
    const reveal = options?.reveal === true;
    const maskFn = Core.maskSensitiveObject || ((v) => v);
    const { events, filters } = buildLocalEvents(session, rawQuery, lookups);

    if (kind === 'event') {
      const eventId = cleanText(rawQuery.eventId, 220);
      const event = events.find((row) => row.id === eventId) || null;
      return {
        kind: 'event',
        filters: Core.buildSafeFiltersForResponse(filters),
        timezone: tz,
        found: Boolean(event),
        canReveal: Boolean(options?.canReveal),
        reveal,
        event: event ? toMaskedEventDetails(event, reveal, maskFn) : null
      };
    }

    const intervalStartMs = Date.parse(String(rawQuery.bucketStartAt || ''));
    const intervalEndMs = Date.parse(String(rawQuery.bucketEndAt || ''));
    let startMs = Number.isFinite(intervalStartMs) ? intervalStartMs : filters.focusStartAtMs;
    let endMs = Number.isFinite(intervalEndMs) ? intervalEndMs : filters.focusEndAtMs;
    if (startMs > endMs) {
      const tmp = startMs;
      startMs = endMs;
      endMs = tmp;
    }
    startMs = Math.max(filters.startAtMs, startMs);
    endMs = Math.min(filters.endAtMs, endMs);

    const intervalRows = events
      .filter((event) => event.occurredAtMs >= startMs && event.occurredAtMs <= endMs)
      .sort((a, b) => Number(b.occurredAtMs || 0) - Number(a.occurredAtMs || 0));

    const sampleRows = intervalRows.slice(0, 30).map((event) => toMaskedEventDetails(event, reveal, maskFn));

    return {
      kind: 'interval',
      filters: Core.buildSafeFiltersForResponse(filters),
      timezone: tz,
      canReveal: Boolean(options?.canReveal),
      reveal,
      interval: {
        startAtMs: startMs,
        endAtMs: endMs,
        startAt: new Date(startMs).toISOString(),
        endAt: new Date(endMs).toISOString()
      },
      summary: Core.buildSummary ? Core.buildSummary(intervalRows) : { totalEvents: intervalRows.length },
      sampleRows
    };
  }

  function resolveLocalActionState(session, actionStateId) {
    const token = cleanText(actionStateId, 160);
    if (!token) return null;
    const rows = Array.isArray(session.actionStates) ? session.actionStates : [];
    return rows.find((row) => cleanText(row?.id, 160) === token) || null;
  }

  function sessionMaxRangeDays(session) {
    const report = session?.reportSetup || {};
    const tz = sessionTimezone(session);
    if (!report.startDate || !report.endDate || !Range.resolveArchiveRangeBoundsMs) {
      return Core.MAX_RANGE_DAYS || 7;
    }
    const bounds = Range.resolveArchiveRangeBoundsMs(report.startDate, report.endDate, tz);
    const spanMs = Number(bounds.dayEndMs) - Number(bounds.dayStartMs);
    if (!Number.isFinite(spanMs) || spanMs <= 0) return Core.MAX_RANGE_DAYS || 7;
    return Math.max(1, Math.ceil(spanMs / (24 * 60 * 60 * 1000)));
  }

  function deriveLocalUserPickerItems(session) {
    const selected = session?.reportSetup?.selectedUsers;
    if (Array.isArray(selected) && selected.length) {
      return selected.map((u) => ({
        id: cleanText(u.id, 120),
        label: cleanText(u.label || u.name || u.id, 180),
        name: cleanText(u.label || u.name || u.id, 180)
      })).filter((u) => u.id);
    }
    const allowed = allowedUserIdSet(session);
    const ids = new Set();
    (session.logs || []).forEach((log) => {
      const details = log?.details && typeof log.details === 'object' ? log.details : {};
      const actor = details.actor && typeof details.actor === 'object' ? details.actor : {};
      const uid = cleanText(log?.userId || actor.userId, 120);
      if (!uid) return;
      if (allowed && !allowed.has(uid)) return;
      ids.add(uid);
    });
    return Array.from(ids).map((id) => ({ id, label: id, name: id }));
  }

  return {
    mergeLookups,
    sessionTimezone,
    clampFiltersToSession,
    buildLocalEvents,
    buildLocalTimelinePayload,
    resolveLocalDetails,
    resolveLocalActionState,
    sessionMaxRangeDays,
    deriveLocalUserPickerItems,
    allowedUserIdSet,
    toMaskedEventDetails
  };
}));
