(function (global) {
  'use strict';

  const HOUR_STEP = 0.25;
  const DAY_NAME_TO_INDEX = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6
  };

  function cleanText(value) {
    return String(value || '').trim();
  }

  function normalizeDateOnly(value) {
    const token = cleanText(value);
    if (!token) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
    const parsed = new Date(token);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
  }

  function toPublicId(value) {
    return cleanText(value);
  }

  function normalizeStatusCode(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function isHolidayOff(notes) {
    const normalized = cleanText(notes).toLowerCase();
    return normalized === 'holiday/off' || normalized === 'holiday off' || normalized === 'holiday';
  }

  function normalizeSessionStatus(status, notes = '') {
    if (isHolidayOff(notes)) return 'holiday';
    return normalizeStatusCode(status) || 'scheduled';
  }

  function normalizeStatusMap(statusMap = {}) {
    const map = new Map();
    if (statusMap instanceof Map) {
      statusMap.forEach((value, key) => map.set(normalizeStatusCode(key), value));
      return map;
    }
    Object.keys(statusMap || {}).forEach((key) => {
      map.set(normalizeStatusCode(key), statusMap[key]);
    });
    return map;
  }

  function resolveStatusDefinition(statusMap, { status, notes = '' } = {}) {
    const map = statusMap instanceof Map ? statusMap : normalizeStatusMap(statusMap);
    const normalized = normalizeSessionStatus(status, notes);
    const definition = map.get(normalized) || null;
    return { normalized, definition };
  }

  function shouldForceNotApplicableAttendanceByMap(statusMap, { status, notes = '' } = {}) {
    const { definition } = resolveStatusDefinition(statusMap, { status, notes });
    return definition?.makeUpRequired === true;
  }

  function shouldExcludeFromAttendanceByMap(statusMap, { status, notes = '' } = {}) {
    const { normalized, definition } = resolveStatusDefinition(statusMap, { status, notes });
    if (normalized === 'holiday') return true;
    if (!definition) return normalized === 'cancelled';
    if (definition.makeUpRequired === true) return false;
    return definition.excludeFromAttendance === true;
  }

  function buildForceNotApplicableAttendanceSessionKeys(statusMap, sessions = []) {
    const out = new Set();
    (Array.isArray(sessions) ? sessions : []).forEach((session) => {
      if (!shouldForceNotApplicableAttendanceByMap(statusMap, {
        status: session?.status,
        notes: session?.notes
      })) return;
      const sessionId = toPublicId(session?.sessionId || session?.id || '');
      const date = cleanText(session?.date || session?.sessionDate || '');
      if (sessionId) out.add(sessionId);
      if (date) out.add(date);
    });
    return out;
  }

  function roundTargetHours(value) {
    const parsed = Number.parseFloat(String(value ?? '').trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    const stepped = Math.round(parsed / HOUR_STEP) * HOUR_STEP;
    return Number(stepped.toFixed(2));
  }

  function normalizeTargetHours(value) {
    return roundTargetHours(value);
  }

  function normalizeTargetSessionCount(value) {
    const parsed = Number.parseInt(cleanText(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function computeDurationHoursFromTimes(startTime, endTime) {
    const start = cleanText(startTime);
    const end = cleanText(endTime);
    if (!start || !end) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if (![sh, sm, eh, em].every((n) => Number.isFinite(n))) return 0;
    const hours = (eh + em / 60) - (sh + sm / 60);
    return hours > 0 ? Number(hours.toFixed(2)) : 0;
  }

  function resolveSessionDurationHours(session = {}) {
    const stored = Number(session?.durationHours);
    if (Number.isFinite(stored) && stored > 0) return Number(stored.toFixed(2));
    return computeDurationHoursFromTimes(session.startTime || session.start, session.endTime || session.end);
  }

  function getSessionId(session = {}, fallback = '') {
    return toPublicId(session.sessionId || session.id || fallback);
  }

  function getSessionDate(session = {}) {
    return normalizeDateOnly(session.date || session.sessionDate || session.startDate);
  }

  function getSessionSortKey(session = {}, index = 0) {
    return [
      getSessionDate(session) || '9999-12-31',
      cleanText(session.startTime || session.start || ''),
      String(index).padStart(6, '0')
    ].join('|');
  }

  function dateInWindow(date, startDate, endDate) {
    const d = normalizeDateOnly(date);
    const start = normalizeDateOnly(startDate);
    const end = normalizeDateOnly(endDate) || '9999-12-31';
    if (!d || !start) return false;
    return start <= d && d <= end;
  }

  function classifySessionForWindow(session = {}, { startDate, endDate, statusMap, forceNaKeys } = {}) {
    const sessionId = getSessionId(session);
    const date = getSessionDate(session);
    const inWindow = dateInWindow(date, startDate, endDate);
    const excluded = shouldExcludeFromAttendanceByMap(statusMap, {
      status: session?.status,
      notes: session?.notes
    });
    const forceNa = forceNaKeys instanceof Set
      && (forceNaKeys.has(sessionId) || forceNaKeys.has(date));
    const countable = inWindow && !excluded && !forceNa;
    let excludeReason = '';
    if (!inWindow) excludeReason = 'out_of_window';
    else if (forceNa) excludeReason = 'makeup_required';
    else if (excluded) excludeReason = 'excluded_from_attendance';

    return {
      sessionId,
      date,
      startTime: cleanText(session.startTime || session.start || ''),
      endTime: cleanText(session.endTime || session.end || ''),
      status: cleanText(session.status || 'scheduled'),
      room: cleanText(session.room || ''),
      durationHours: resolveSessionDurationHours(session),
      inWindow,
      countable,
      excludeReason
    };
  }

  function listSessionsInWindow({ sessions = [], startDate = '', endDate = '', statusMap = {} } = {}) {
    const forceNaKeys = buildForceNotApplicableAttendanceSessionKeys(statusMap, sessions);
    const rows = (Array.isArray(sessions) ? sessions : [])
      .map((session, index) => ({
        session,
        index,
        sortKey: getSessionSortKey(session, index)
      }))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .map(({ session }) => classifySessionForWindow(session, { startDate, endDate, statusMap, forceNaKeys }))
      .filter((row) => row.inWindow);

    const countableSessions = rows.filter((row) => row.countable);
    return {
      sessions: rows,
      countableSessions,
      availableCount: countableSessions.length
    };
  }

  function sumCountableHours(countableSessions = []) {
    return roundTargetHours(
      (Array.isArray(countableSessions) ? countableSessions : [])
        .reduce((sum, row) => sum + Number(row?.durationHours || 0), 0)
    );
  }

  function computeHourAllocation(countableSessions = [], targetHours = 0) {
    const target = normalizeTargetHours(targetHours);
    if (!target) {
      return { allocatedSessionCount: 0, allocatedHours: 0, gapHours: 0 };
    }
    let allocatedHours = 0;
    let allocatedSessionCount = 0;
    (Array.isArray(countableSessions) ? countableSessions : []).forEach((row) => {
      if (allocatedHours >= target) return;
      const hours = Number(row?.durationHours || 0);
      allocatedSessionCount += 1;
      allocatedHours = roundTargetHours(allocatedHours + hours);
    });
    return {
      allocatedSessionCount,
      allocatedHours,
      gapHours: Math.max(0, roundTargetHours(target - allocatedHours))
    };
  }

  function evaluateHourAlignment({
    sessions = [],
    startDate = '',
    endDate = '',
    targetHours = 0,
    statusMap = {}
  } = {}) {
    const normalizedStart = normalizeDateOnly(startDate);
    const normalizedEnd = normalizeDateOnly(endDate);
    const target = normalizeTargetHours(targetHours);
    if (!target) {
      return {
        availableCount: 0,
        availableHours: 0,
        sessions: [],
        countableSessions: [],
        alignmentStatus: 'no_end_date',
        requiredNaCount: 0,
        requiredNaHours: 0,
        gapCount: 0,
        gapHours: 0,
        effectiveTarget: 0,
        effectiveTargetHours: 0,
        allocatedSessionCount: 0,
        allocatedHours: 0
      };
    }

    if (!normalizedEnd) {
      const listed = listSessionsInWindow({
        sessions,
        startDate: normalizedStart,
        endDate: '',
        statusMap
      });
      const availableHours = sumCountableHours(listed.countableSessions);
      const allocation = computeHourAllocation(listed.countableSessions, target);
      let alignmentStatus = 'ok';
      let gapHours = 0;
      let requiredNaHours = 0;

      if (availableHours < target) {
        alignmentStatus = 'insufficient_hours';
        gapHours = roundTargetHours(target - availableHours);
      } else if (availableHours > target) {
        alignmentStatus = 'overage_requires_na';
        requiredNaHours = roundTargetHours(availableHours - target);
      }

      return {
        availableCount: listed.availableCount,
        availableHours,
        sessions: listed.sessions,
        countableSessions: listed.countableSessions,
        alignmentStatus,
        requiredNaCount: 0,
        requiredNaHours,
        gapCount: 0,
        gapHours,
        effectiveTarget: 0,
        effectiveTargetHours: target,
        allocatedSessionCount: allocation.allocatedSessionCount,
        allocatedHours: allocation.allocatedHours
      };
    }

    const listed = listSessionsInWindow({
      sessions,
      startDate: normalizedStart,
      endDate: normalizedEnd,
      statusMap
    });
    const availableHours = sumCountableHours(listed.countableSessions);
    const allocation = computeHourAllocation(listed.countableSessions, target);
    let alignmentStatus = 'ok';
    let gapHours = 0;
    let requiredNaHours = 0;

    if (availableHours < target) {
      alignmentStatus = 'insufficient_hours';
      gapHours = roundTargetHours(target - availableHours);
    } else if (availableHours > target) {
      alignmentStatus = 'overage_requires_na';
      requiredNaHours = roundTargetHours(availableHours - target);
    }

    return {
      availableCount: listed.availableCount,
      availableHours,
      sessions: listed.sessions,
      countableSessions: listed.countableSessions,
      alignmentStatus,
      requiredNaCount: 0,
      requiredNaHours,
      gapCount: 0,
      gapHours,
      effectiveTarget: 0,
      effectiveTargetHours: target,
      allocatedSessionCount: allocation.allocatedSessionCount,
      allocatedHours: allocation.allocatedHours
    };
  }

  function evaluateAlignment({
    sessions = [],
    startDate = '',
    endDate = '',
    targetSessionCount = 0,
    targetHours = 0,
    statusMap = {}
  } = {}) {
    const hourTarget = normalizeTargetHours(targetHours);
    if (hourTarget > 0) {
      return evaluateHourAlignment({
        sessions,
        startDate,
        endDate,
        targetHours: hourTarget,
        statusMap
      });
    }

    const normalizedStart = normalizeDateOnly(startDate);
    const normalizedEnd = normalizeDateOnly(endDate);
    const target = normalizeTargetSessionCount(targetSessionCount);

    if (!normalizedEnd) {
      if (target <= 0) {
        return {
          availableCount: 0,
          availableHours: 0,
          sessions: [],
          countableSessions: [],
          alignmentStatus: 'no_end_date',
          requiredNaCount: 0,
          requiredNaHours: 0,
          gapCount: 0,
          gapHours: 0,
          effectiveTarget: target,
          effectiveTargetHours: 0,
          allocatedSessionCount: 0,
          allocatedHours: 0
        };
      }

      const listed = listSessionsInWindow({
        sessions,
        startDate: normalizedStart,
        endDate: '',
        statusMap
      });
      const availableCount = listed.availableCount;
      const effectiveTarget = target;
      let alignmentStatus = 'ok';
      let gapCount = 0;

      if (availableCount < effectiveTarget) {
        alignmentStatus = 'insufficient_sessions';
        gapCount = effectiveTarget - availableCount;
      }

      return {
        availableCount,
        availableHours: 0,
        sessions: listed.sessions,
        countableSessions: listed.countableSessions,
        alignmentStatus,
        requiredNaCount: 0,
        requiredNaHours: 0,
        gapCount,
        gapHours: 0,
        effectiveTarget,
        effectiveTargetHours: 0,
        allocatedSessionCount: 0,
        allocatedHours: 0
      };
    }

    const listed = listSessionsInWindow({
      sessions,
      startDate: normalizedStart,
      endDate: normalizedEnd,
      statusMap
    });
    const availableCount = listed.availableCount;
    const effectiveTarget = target > 0 ? target : availableCount;

    let alignmentStatus = 'ok';
    let requiredNaCount = 0;
    let gapCount = 0;

    if (availableCount === 0 || effectiveTarget > availableCount) {
      alignmentStatus = 'insufficient_sessions';
      gapCount = Math.max(0, effectiveTarget - availableCount);
    } else if (effectiveTarget > 0 && effectiveTarget < availableCount) {
      alignmentStatus = 'overage_requires_na';
      requiredNaCount = availableCount - effectiveTarget;
    }

    return {
      availableCount,
      availableHours: sumCountableHours(listed.countableSessions),
      sessions: listed.sessions,
      countableSessions: listed.countableSessions,
      alignmentStatus,
      requiredNaCount,
      requiredNaHours: 0,
      gapCount,
      gapHours: 0,
      effectiveTarget,
      effectiveTargetHours: 0,
      allocatedSessionCount: 0,
      allocatedHours: 0
    };
  }

  function isTargetSessionCountEnforced(targetSessionCount = 0) {
    return normalizeTargetSessionCount(targetSessionCount) >= 1;
  }

  function isTargetHoursEnforced(targetHours = 0) {
    return normalizeTargetHours(targetHours) > 0;
  }

  function slimSessionRow(session = {}) {
    const sessionId = toPublicId(session.sessionId || session.id || '');
    const date = cleanText(session.date || session.sessionDate || session.startDate || '');
    const startTime = cleanText(session.startTime || session.start || '');
    const endTime = cleanText(session.endTime || session.end || '');
    const durationHours = resolveSessionDurationHours(session);
    return {
      sessionId,
      id: sessionId,
      date,
      startTime,
      endTime,
      status: cleanText(session.status || 'scheduled').toLowerCase() || 'scheduled',
      notes: cleanText(session.notes || ''),
      room: cleanText(session.room || ''),
      durationHours
    };
  }

  function mergeWorkspaceSessions(workspaceSessions = [], pendingStagedSessions = []) {
    const base = Array.isArray(workspaceSessions) ? workspaceSessions : [];
    const staged = Array.isArray(pendingStagedSessions) ? pendingStagedSessions : [];
    if (!staged.length) return base.slice();
    return [...base, ...staged.map(slimSessionRow)];
  }

  function buildAlignmentPayload({
    workspace = {},
    startDate = '',
    endDate = '',
    targetSessionCount = 0,
    targetHours = 0,
    pendingStagedSessions = [],
    pendingGapBatch = null
  } = {}) {
    const sessionTarget = normalizeTargetSessionCount(targetSessionCount);
    const hourTarget = normalizeTargetHours(targetHours);
    if (sessionTarget > 0 && hourTarget > 0) {
      throw new Error('Set either a session target or an hour target, not both.');
    }

    const statusMap = workspace?.statusMap || {};
    const scheduleDefaults = workspace?.scheduleDefaults || {};
    const mergedSessions = mergeWorkspaceSessions(workspace?.sessions, pendingStagedSessions);
    const alignment = evaluateAlignment({
      sessions: mergedSessions,
      startDate,
      endDate,
      targetSessionCount: sessionTarget,
      targetHours: hourTarget,
      statusMap
    });

    return {
      ...alignment,
      startDate: normalizeDateOnly(startDate),
      endDate: normalizeDateOnly(endDate),
      targetSessionCount: sessionTarget,
      targetHours: hourTarget,
      enforceSessionCount: isTargetSessionCountEnforced(sessionTarget),
      enforceHours: isTargetHoursEnforced(hourTarget),
      scheduleDefaults,
      hasPendingGapBatch: Boolean(pendingGapBatch),
      pendingStagedCount: Array.isArray(pendingStagedSessions) ? pendingStagedSessions.length : 0
    };
  }

  const api = {
    evaluateAlignment,
    evaluateHourAlignment,
    listSessionsInWindow,
    classifySessionForWindow,
    buildAlignmentPayload,
    mergeWorkspaceSessions,
    slimSessionRow,
    normalizeTargetSessionCount,
    normalizeTargetHours,
    normalizeDateOnly,
    isTargetSessionCountEnforced,
    isTargetHoursEnforced
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.RollingEnrollmentAlignmentClient = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
