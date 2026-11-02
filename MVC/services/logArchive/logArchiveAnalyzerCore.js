'use strict';

const {
  cleanDateKey,
  dateKeysOverlap,
  parseArchiveZipFileName,
  resolveArchiveRangeBoundsMs,
  msToArchiveDateKey,
  timestampInArchiveRange
} = require('./logArchiveRangeUtils');

function cleanText(value, max) {
  const text = String(value == null ? '' : value).trim();
  const cap = Number(max) > 0 ? Number(max) : 500;
  return text.length > cap ? text.slice(0, cap) : text;
}

function resolveLogUserId(log) {
  const details = log?.details && typeof log.details === 'object' ? log.details : {};
  const actor = details.actor && typeof details.actor === 'object' ? details.actor : {};
  return cleanText(log?.userId || actor.userId, 120);
}

function resolveActionStateUserId(row) {
  return cleanText(row?.userId, 120);
}

function quickFilterZipNames(fileNames, userStart, userEnd) {
  const u0 = cleanDateKey(userStart);
  const u1 = cleanDateKey(userEnd);
  if (!u0 || !u1) return [];
  return (Array.isArray(fileNames) ? fileNames : [])
    .map((name) => {
      const parsed = parseArchiveZipFileName(name);
      if (!parsed) return null;
      if (!dateKeysOverlap(u0, u1, parsed.startDate, parsed.endDate)) return null;
      return { name, ...parsed };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
}

function mergeReferenceRows(existing = [], incoming = []) {
  const map = new Map();
  (Array.isArray(existing) ? existing : []).forEach((row) => {
    const id = cleanText(row?.id, 120);
    if (id) map.set(id, row);
  });
  (Array.isArray(incoming) ? incoming : []).forEach((row) => {
    const id = cleanText(row?.id, 120);
    if (id) map.set(id, row);
  });
  return Array.from(map.values());
}

function dedupeById(rows) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = cleanText(row?.id, 160);
    if (id) map.set(id, row);
  });
  return Array.from(map.values());
}

function mergeArchivePayloads(payloads = []) {
  const list = Array.isArray(payloads) ? payloads.filter(Boolean) : [];
  if (!list.length) {
    return {
      manifest: { exportId: 'merged', range: {}, timezone: 'UTC' },
      logs: [],
      actionStates: [],
      refs: { sections: [], operations: [] },
      sourceFiles: []
    };
  }

  let logs = [];
  let actionStates = [];
  let sections = [];
  let operations = [];
  const sourceFiles = [];
  const timezones = new Set();

  list.forEach((payload) => {
    logs = logs.concat(payload.logs || []);
    actionStates = actionStates.concat(payload.actionStates || []);
    sections = mergeReferenceRows(sections, payload.refs?.sections || []);
    operations = mergeReferenceRows(operations, payload.refs?.operations || []);
    if (payload.sourceFile) sourceFiles.push(payload.sourceFile);
    const tz = cleanText(payload.manifest?.timezone, 80);
    if (tz) timezones.add(tz);
  });

  const manifests = list.map((p) => p.manifest).filter(Boolean);
  const startDates = manifests.map((m) => cleanDateKey(m.range?.startDate)).filter(Boolean).sort();
  const endDates = manifests.map((m) => cleanDateKey(m.range?.endDate)).filter(Boolean).sort();
  const mergedManifest = {
    schemaVersion: manifests[0]?.schemaVersion || 1,
    exportId: list.length === 1 ? (manifests[0]?.exportId || 'archive') : `merged-${list.length}-archives`,
    exportedAt: manifests.map((m) => m.exportedAt).filter(Boolean).sort().pop() || new Date().toISOString(),
    timezone: timezones.size === 1 ? Array.from(timezones)[0] : (manifests[0]?.timezone || 'UTC'),
    range: {
      startDate: startDates[0] || '',
      endDate: endDates[endDates.length - 1] || ''
    },
    counts: {
      logs: dedupeById(logs).length,
      actionStates: dedupeById(actionStates).length
    },
    mergedFrom: manifests.map((m) => m.exportId).filter(Boolean)
  };

  return {
    manifest: mergedManifest,
    logs: dedupeById(logs),
    actionStates: dedupeById(actionStates),
    refs: { sections, operations },
    sourceFiles,
    timezoneMismatch: timezones.size > 1
  };
}

function filterSourceRecords({
  logs = [],
  actionStates = [],
  startDate,
  endDate,
  timezone = 'UTC',
  userIds = []
}) {
  const bounds = resolveArchiveRangeBoundsMs(startDate, endDate, timezone);
  const userSet = new Set(
    (Array.isArray(userIds) ? userIds : [])
      .map((id) => cleanText(id, 120))
      .filter(Boolean)
  );
  const filterUser = userSet.size > 0;

  const filteredLogs = (Array.isArray(logs) ? logs : []).filter((row) => {
    if (!timestampInArchiveRange(row.timestamp || row.createdAt, bounds)) return false;
    if (!filterUser) return true;
    return userSet.has(resolveLogUserId(row));
  });

  const filteredStates = (Array.isArray(actionStates) ? actionStates : []).filter((row) => {
    const ts = row.startedAt || row.createdAt || row.updatedAt;
    if (!timestampInArchiveRange(ts, bounds)) return false;
    if (!filterUser) return true;
    return userSet.has(resolveActionStateUserId(row));
  });

  return { logs: filteredLogs, actionStates: filteredStates, bounds };
}

function buildLookup(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const id = cleanText(row?.id, 120);
    if (id) map.set(id, cleanText(row?.name, 180) || id);
  });
  return map;
}

function logToEvent(log, sectionMap, operationMap) {
  const ts = cleanText(log.timestamp || log.createdAt, 40);
  const ms = new Date(ts).getTime();
  const sectionId = cleanText(log.sectionId, 120);
  const operationId = cleanText(log.operationId, 120);
  const details = log.details && typeof log.details === 'object' ? log.details : {};
  const actor = details.actor && typeof details.actor === 'object' ? details.actor : {};
  return {
    occurredAt: ts,
    occurredAtMs: Number.isFinite(ms) ? ms : 0,
    userId: cleanText(log.userId || actor.userId, 120),
    displayName: cleanText(log.displayName || actor.displayName || log.username || actor.username, 180),
    sectionId,
    sectionName: sectionMap.get(sectionId) || sectionId,
    operationId,
    operationName: operationMap.get(operationId) || operationId,
    statusRaw: cleanText(log.status, 80),
    summary: cleanText([details.method, details.url, details.errorMessage].filter(Boolean).join(' '), 400)
      || `${operationMap.get(operationId) || operationId} in ${sectionMap.get(sectionId) || sectionId}`,
    hasActionState: Boolean(cleanText(log.actionStateId || details.actionStateId, 120)),
    source: 'log'
  };
}

function buildTimelineEvents(manifest, logs, actionStates, refs) {
  const sectionMap = buildLookup(refs?.sections);
  const operationMap = buildLookup(refs?.operations);
  const events = (logs || []).map((row) => logToEvent(row, sectionMap, operationMap));
  events.sort((a, b) => Number(b.occurredAtMs || 0) - Number(a.occurredAtMs || 0));
  return events;
}

function countTimelineEvents(manifest, logs, actionStates, refs) {
  return buildTimelineEvents(manifest, logs, actionStates, refs).length;
}

function exceedsEventLimit(eventCount, maxLimit) {
  const limit = Number(maxLimit);
  const count = Number(eventCount);
  if (!Number.isFinite(limit) || limit <= 0) return false;
  return Number.isFinite(count) && count > limit;
}

function resolveRecordTimestampMs(row) {
  const ms = new Date(String(row?.timestamp || row?.createdAt || '')).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function truncateRecordsToLimit({
  logs = [],
  actionStates = [],
  limit,
  timezone = 'UTC',
  requestedStartDate = '',
  requestedEndDate = ''
}) {
  const cap = Number(limit);
  const list = Array.isArray(logs) ? logs.slice() : [];
  const matchedCount = list.length;
  const reqStart = cleanDateKey(requestedStartDate);
  const reqEnd = cleanDateKey(requestedEndDate);
  const statesIn = Array.isArray(actionStates) ? actionStates : [];

  if (!Number.isFinite(cap) || cap <= 0 || matchedCount <= cap) {
    return {
      logs: list,
      actionStates: statesIn,
      effectiveStartDate: reqStart,
      effectiveEndDate: reqEnd,
      matchedCount,
      truncated: false
    };
  }

  const kept = list
    .slice()
    .sort((a, b) => {
      const diff = resolveRecordTimestampMs(a) - resolveRecordTimestampMs(b);
      if (diff !== 0) return diff;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    })
    .slice(0, cap);

  let minMs = Number.POSITIVE_INFINITY;
  let maxMs = Number.NEGATIVE_INFINITY;
  kept.forEach((row) => {
    const ms = resolveRecordTimestampMs(row);
    if (Number.isFinite(ms) && ms > 0) {
      minMs = Math.min(minMs, ms);
      maxMs = Math.max(maxMs, ms);
    }
  });
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) {
    return {
      logs: kept,
      actionStates: [],
      effectiveStartDate: reqStart,
      effectiveEndDate: reqEnd,
      matchedCount,
      truncated: true
    };
  }

  const window = { dayStartMs: minMs, dayEndMs: maxMs };
  const trimmedStates = statesIn.filter((row) => {
    const ts = row?.startedAt || row?.createdAt || row?.updatedAt;
    return timestampInArchiveRange(ts, window);
  });

  return {
    logs: kept,
    actionStates: trimmedStates,
    effectiveStartDate: msToArchiveDateKey(minMs, timezone) || reqStart,
    effectiveEndDate: msToArchiveDateKey(maxMs, timezone) || reqEnd,
    matchedCount,
    truncated: true
  };
}

module.exports = {
  quickFilterZipNames,
  mergeArchivePayloads,
  filterSourceRecords,
  buildTimelineEvents,
  countTimelineEvents,
  exceedsEventLimit,
  truncateRecordsToLimit,
  resolveRecordTimestampMs,
  dedupeById,
  resolveLogUserId
};
