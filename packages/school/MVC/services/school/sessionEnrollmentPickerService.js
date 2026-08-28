'use strict';

const schoolDataService = require('./schoolDataService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const rollingEnrollmentSessionAlignmentService = require('./rollingEnrollmentSessionAlignmentService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const VIEW_PRESETS = Object.freeze([
  'day',
  'week',
  'twoWeeks',
  'thirtyDays',
  'month',
  'twoMonths',
  'threeMonths',
  'fourMonths',
  'fiveMonths',
  'sixMonths',
  'wholeCycle',
  'custom'
]);

function normalizeDateOnly(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  return raw;
}

function parseAnchorDate(value, fallback = '') {
  const raw = normalizeDateOnly(value) || normalizeDateOnly(fallback);
  if (raw) return raw;
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysIso(dateStr, days) {
  const base = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(base.getTime())) return dateStr;
  base.setDate(base.getDate() + Number(days || 0));
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function endOfMonth(dateStr) {
  const base = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(base.getTime())) return dateStr;
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  const y = end.getFullYear();
  const m = String(end.getMonth() + 1).padStart(2, '0');
  const d = String(end.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfMonth(dateStr) {
  const base = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(base.getTime())) return dateStr;
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

function addMonthsIso(dateStr, months) {
  const base = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(base.getTime())) return dateStr;
  base.setMonth(base.getMonth() + Number(months || 0));
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function computeMonthSpanViewRange(anchor, monthSpan, presetKey) {
  const start = startOfMonth(anchor);
  const endAnchor = addMonthsIso(start, monthSpan - 1);
  return { startDate: start, endDate: endOfMonth(endAnchor), preset: presetKey, anchorDate: anchor };
}

function computeCustomViewRange(startDate = '', endDate = '') {
  const start = normalizeDateOnly(startDate);
  const end = normalizeDateOnly(endDate) || start;
  const anchor = start || parseAnchorDate('');
  const safeEnd = end >= anchor ? end : anchor;
  return { startDate: anchor, endDate: safeEnd, preset: 'custom', anchorDate: anchor };
}

function computeWholeCycleViewRange({ startDate = '', endDate = '' } = {}) {
  const start = normalizeDateOnly(startDate) || parseAnchorDate('');
  const end = normalizeDateOnly(endDate) || start;
  const safeEnd = end >= start ? end : start;
  return { startDate: start, endDate: safeEnd, preset: 'wholeCycle', anchorDate: start };
}

function clampViewRangeToBounds(viewRange = {}, { minDate = '', maxDate = '' } = {}) {
  const min = normalizeDateOnly(minDate);
  const max = normalizeDateOnly(maxDate);
  let start = normalizeDateOnly(viewRange?.startDate);
  let end = normalizeDateOnly(viewRange?.endDate);
  if (!start || !end) return viewRange;
  if (min && start < min) start = min;
  if (max && end > max) end = max;
  if (min && end < min) end = min;
  if (max && start > max) start = max;
  if (end < start) end = start;
  return {
    ...viewRange,
    startDate: start,
    endDate: end,
    anchorDate: normalizeDateOnly(viewRange?.anchorDate) || start
  };
}

function computeViewRange(preset = 'week', anchorDate = '', options = {}) {
  const anchor = parseAnchorDate(anchorDate);
  const key = String(preset || 'week').trim();
  if (key === 'custom') {
    return computeCustomViewRange(options.startDate || anchor, options.endDate || anchor);
  }
  if (key === 'wholeCycle') {
    return computeWholeCycleViewRange({
      startDate: options.startDate || anchor,
      endDate: options.endDate || anchor
    });
  }
  if (key === 'day') {
    return { startDate: anchor, endDate: anchor, preset: key, anchorDate: anchor };
  }
  if (key === 'week') {
    const start = addDaysIso(anchor, -((new Date(`${anchor}T00:00:00`).getDay() + 6) % 7));
    return { startDate: start, endDate: addDaysIso(start, 6), preset: key, anchorDate: anchor };
  }
  if (key === 'twoWeeks') {
    const start = addDaysIso(anchor, -((new Date(`${anchor}T00:00:00`).getDay() + 6) % 7));
    return { startDate: start, endDate: addDaysIso(start, 13), preset: key, anchorDate: anchor };
  }
  if (key === 'thirtyDays') {
    return { startDate: anchor, endDate: addDaysIso(anchor, 30), preset: key, anchorDate: anchor };
  }
  if (key === 'month') {
    const start = startOfMonth(anchor);
    return { startDate: start, endDate: endOfMonth(anchor), preset: key, anchorDate: anchor };
  }
  if (key === 'twoMonths') {
    return computeMonthSpanViewRange(anchor, 2, key);
  }
  if (key === 'threeMonths') {
    return computeMonthSpanViewRange(anchor, 3, key);
  }
  if (key === 'fourMonths') {
    return computeMonthSpanViewRange(anchor, 4, key);
  }
  if (key === 'fiveMonths') {
    return computeMonthSpanViewRange(anchor, 5, key);
  }
  if (key === 'sixMonths') {
    return computeMonthSpanViewRange(anchor, 6, key);
  }
  return { startDate: anchor, endDate: addDaysIso(anchor, 6), preset: 'week', anchorDate: anchor };
}

function buildManageSessionUrl(classId, sessionId) {
  const cid = toPublicId(classId);
  const sid = String(sessionId || '').trim();
  if (!cid || !sid) return '';
  return `/school/classes/${encodeURIComponent(cid)}/sessions/${encodeURIComponent(sid)}`;
}

function resolveTeacherName(session = {}, classData = {}) {
  const delivery = session?.delivery && typeof session.delivery === 'object' ? session.delivery : {};
  const fromDelivery = String(delivery.deliveredByName || '').trim();
  if (fromDelivery) return fromDelivery;
  const resolved = rollingEnrollmentSessionAlignmentService.resolveDefaultTeacherFromClass(classData, {});
  return String(resolved?.teacherName || '').trim() || 'Teacher';
}

function sessionScheduleKey(row = {}) {
  const date = normalizeDateOnly(row?.date || row?.sessionDate || '');
  const start = String(row?.startTime || row?.start || '').trim();
  const end = String(row?.endTime || row?.end || '').trim();
  return `${date}|${start}|${end}`;
}

function mergeEnrollmentSessions({
  persistedSessions = [],
  sessionsToCreate = [],
  clientSessions = []
} = {}) {
  const stagedIds = new Set(
    (Array.isArray(sessionsToCreate) ? sessionsToCreate : [])
      .map((row) => String(row?.sessionId || '').trim())
      .filter(Boolean)
  );
  const stagedKeys = new Set(
    (Array.isArray(sessionsToCreate) ? sessionsToCreate : []).map((row) => sessionScheduleKey(row))
  );
  const clientKeys = new Set(
    (Array.isArray(clientSessions) ? clientSessions : []).map((row) => sessionScheduleKey(row))
  );

  const base = (Array.isArray(persistedSessions) ? persistedSessions : [])
    .filter((row) => {
      const id = String(row?.sessionId || '').trim();
      if (id && stagedIds.has(id)) return false;
      if (stagedKeys.has(sessionScheduleKey(row))) return false;
      return true;
    });

  const staged = (Array.isArray(sessionsToCreate) ? sessionsToCreate : []).map((row) => ({
    ...row,
    isStaged: true
  }));

  if (Array.isArray(clientSessions) && clientSessions.length) {
    const merged = [];
    const seen = new Set();
    [...base, ...staged, ...clientSessions].forEach((row) => {
      const id = String(row?.sessionId || '').trim();
      const key = id || sessionScheduleKey(row);
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(row);
    });
    return merged;
  }

  return [...base, ...staged];
}

function summarizeSelection(events = [], selectedSessionIds = []) {
  const selectedSet = new Set(
    (Array.isArray(selectedSessionIds) ? selectedSessionIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );
  const selectedEvents = (Array.isArray(events) ? events : [])
    .filter((row) => selectedSet.has(String(row?.sessionId || '').trim()));
  const selectedCount = selectedEvents.length;
  const selectedHours = classEnrollmentSessionApplicabilityService.roundTargetHours(
    selectedEvents.reduce((sum, row) => sum + Number(row?.durationHours || 0), 0)
  );
  const dates = selectedEvents
    .map((row) => normalizeDateOnly(row?.date))
    .filter(Boolean)
    .sort();
  return {
    selectedCount,
    selectedHours,
    selectionStartDate: dates[0] || '',
    selectionEndDate: dates.length ? dates[dates.length - 1] : ''
  };
}

function filterEventsByViewRange(events = [], viewRange = {}) {
  const start = normalizeDateOnly(viewRange?.startDate);
  const end = normalizeDateOnly(viewRange?.endDate);
  if (!start || !end) return Array.isArray(events) ? events : [];
  return (Array.isArray(events) ? events : []).filter((row) => {
    const date = normalizeDateOnly(row?.date);
    if (!date) return false;
    return date >= start && date <= end;
  });
}

function buildEnrollmentSessionPickerPayloadSync({
  classData,
  persistedSessions = [],
  statusMap = {},
  studentId = '',
  startDate = '',
  endDate = '',
  targetSessionCount = 0,
  targetHours = 0,
  selectedSessionIds = [],
  sessions = [],
  sessionsToCreate = [],
  viewPreset = 'week',
  anchorDate = ''
} = {}) {
  if (!classData?.id) throw new Error('classData is required.');

  const enrollmentStart = normalizeDateOnly(startDate);
  const enrollmentEnd = normalizeDateOnly(endDate);
  const normalizedTargetSessions = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(targetSessionCount);
  const normalizedTargetHours = classEnrollmentSessionApplicabilityService.normalizeTargetHours(targetHours);
  if (normalizedTargetSessions > 0 && normalizedTargetHours > 0) {
    throw new Error('Set either a session target or an hour target, not both.');
  }

  const stagedSessions = rollingEnrollmentSessionAlignmentService.parsePendingStagedSessions({
    pendingStagedSessions: sessionsToCreate
  });

  const mergedSessions = mergeEnrollmentSessions({
    persistedSessions: Array.isArray(persistedSessions) ? persistedSessions : [],
    sessionsToCreate: stagedSessions,
    clientSessions: sessions
  });

  const policyStatusMap = statusMap instanceof Map
    ? statusMap
    : (() => {
      const map = new Map();
      Object.keys(statusMap || {}).forEach((key) => map.set(key, statusMap[key]));
      return map;
    })();

  const alignment = rollingEnrollmentSessionAlignmentService.evaluateAlignment({
    sessions: mergedSessions,
    startDate: enrollmentStart,
    endDate: enrollmentEnd,
    targetSessionCount: normalizedTargetSessions,
    targetHours: normalizedTargetHours,
    statusMap: policyStatusMap
  });

  const classifiedById = new Map(
    (Array.isArray(alignment?.sessions) ? alignment.sessions : []).map((row) => [String(row.sessionId || '').trim(), row])
  );

  const selectedSet = new Set(
    rollingEnrollmentSessionAlignmentService.sanitizePlannedNaSessionIds(selectedSessionIds)
  );

  const classId = toPublicId(classData.id);
  const events = mergedSessions.map((session) => {
    const sessionId = String(session?.sessionId || '').trim();
    const classified = classifiedById.get(sessionId) || rollingEnrollmentSessionAlignmentService.classifySessionForWindow(
      session,
      { startDate: enrollmentStart, endDate: enrollmentEnd, statusMap: policyStatusMap }
    );
    const date = normalizeDateOnly(classified?.date || session?.date);
    const start = String(classified?.startTime || session?.startTime || '').trim();
    const end = String(classified?.endTime || session?.endTime || '').trim();
    const durationHours = Number(classified?.durationHours || 0);
    const rosterCount = Array.isArray(session?.roster)
      ? session.roster.length
      : Math.max(0, Number(session?.rosterCount || 0) || 0);
    const selectable = classified?.countable === true;
    return {
      sessionId,
      classId,
      date,
      start,
      end,
      durationHours,
      rosterCount,
      teacherName: resolveTeacherName(session, classData),
      manageable: Boolean(sessionId),
      manageSessionUrl: buildManageSessionUrl(classId, sessionId),
      selectable,
      excludeReason: selectable ? '' : String(classified?.excludeReason || '').trim(),
      isStaged: session?.isStaged === true,
      selected: selectedSet.has(sessionId)
    };
  }).filter((row) => row.date);

  const selectableSessionIds = events
    .filter((row) => row.selectable && row.sessionId)
    .map((row) => row.sessionId);

  const viewRange = computeViewRange(viewPreset, anchorDate || enrollmentStart);
  const visibleEvents = filterEventsByViewRange(events, viewRange);
  const summary = summarizeSelection(events, Array.from(selectedSet));

  return {
    events: visibleEvents,
    allEvents: events,
    window: {
      enrollmentStartDate: enrollmentStart,
      enrollmentEndDate: enrollmentEnd
    },
    viewRange,
    selectableSessionIds,
    summary,
    enrollmentAlignment: {
      alignmentStatus: String(alignment?.alignmentStatus || '').trim(),
      requiredNaCount: Number(alignment?.requiredNaCount || 0),
      requiredNaHours: Number(alignment?.requiredNaHours || 0),
      availableCount: Number(alignment?.availableCount || 0),
      availableHours: Number(alignment?.availableHours || 0)
    },
    studentId: toPublicId(studentId)
  };
}

async function buildEnrollmentSessionPickerPayload({
  classData,
  studentId = '',
  startDate = '',
  endDate = '',
  targetSessionCount = 0,
  targetHours = 0,
  selectedSessionIds = [],
  sessions = [],
  sessionsToCreate = [],
  viewPreset = 'week',
  anchorDate = '',
  persistedSessions = null,
  statusMapOverride = null,
  reqUser
} = {}) {
  if (!classData?.id) throw new Error('classData is required.');

  const stagedSessions = rollingEnrollmentSessionAlignmentService.parsePendingStagedSessions({
    pendingStagedSessions: sessionsToCreate
  });

  let persisted = Array.isArray(persistedSessions) ? persistedSessions : null;
  if (!persisted) {
    persisted = await schoolDataService.getClassSessions(classData.id, reqUser);
    persisted = Array.isArray(persisted) ? persisted : [];
  }

  let resolvedStatusMap = statusMapOverride;
  if (!resolvedStatusMap || (typeof resolvedStatusMap !== 'object' && !(resolvedStatusMap instanceof Map))) {
    resolvedStatusMap = await sessionStatusPolicyService.getStatusMap(
      classData?.orgId || reqUser?.activeOrgId || '',
      { includeInactive: true }
    );
  }

  return buildEnrollmentSessionPickerPayloadSync({
    classData,
    persistedSessions: persisted,
    statusMap: resolvedStatusMap,
    studentId,
    startDate,
    endDate,
    targetSessionCount,
    targetHours,
    selectedSessionIds,
    sessions,
    sessionsToCreate: stagedSessions,
    viewPreset,
    anchorDate
  });
}

module.exports = {
  VIEW_PRESETS,
  computeViewRange,
  computeCustomViewRange,
  computeWholeCycleViewRange,
  clampViewRangeToBounds,
  summarizeSelection,
  filterEventsByViewRange,
  buildEnrollmentSessionPickerPayload,
  buildEnrollmentSessionPickerPayloadSync,
  buildManageSessionUrl
};
