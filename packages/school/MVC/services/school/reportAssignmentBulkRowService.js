/**
 * Schedule-based bulk generation for report assignment target rows.
 */
const SCHEDULE_PRESETS = Object.freeze({
  END_OF_MONTH: 'end_of_month',
  END_OF_WEEK: 'end_of_week',
  END_OF_EACH_DAY: 'end_of_each_day',
  SEMI_MONTHLY: 'semi_monthly',
  CUSTOM: 'custom'
});

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function parseDate(dateStr) {
  const normalized = normalizeDateOnly(dateStr);
  if (!normalized) return null;
  return new Date(`${normalized}T00:00:00`);
}

function formatDate(dateObj) {
  if (!dateObj || Number.isNaN(dateObj.getTime())) return '';
  return dateObj.toISOString().slice(0, 10);
}

function daysBetween(leftDate, rightDate) {
  const left = parseDate(leftDate);
  const right = parseDate(rightDate);
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.round((right.getTime() - left.getTime()) / 86400000);
}

function getSessionId(session = {}) {
  return String(session?.sessionId || session?.id || '').trim();
}

function getWeekStartMonday(dateStr) {
  const date = parseDate(dateStr);
  if (!date) return '';
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return formatDate(date);
}

function lastCalendarDayOfMonth(year, monthIndex) {
  return formatDate(new Date(year, monthIndex + 1, 0));
}

function sessionsInWindow(sessions = [], startDate = '', endDate = '') {
  const start = normalizeDateOnly(startDate);
  const end = normalizeDateOnly(endDate);
  return (Array.isArray(sessions) ? sessions : []).filter((session) => {
    const date = normalizeDateOnly(session?.date);
    if (!date) return false;
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
  });
}

function buildEndOfMonthAnchors(sessions) {
  const byMonth = new Map();
  sessions.forEach((session) => {
    const date = normalizeDateOnly(session?.date);
    if (!date) return;
    const monthKey = date.slice(0, 7);
    const prev = byMonth.get(monthKey);
    if (!prev || date > prev.date) {
      byMonth.set(monthKey, { type: 'date', date });
    }
  });
  return [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function buildEndOfWeekAnchors(sessions) {
  const byWeek = new Map();
  sessions.forEach((session) => {
    const date = normalizeDateOnly(session?.date);
    if (!date) return;
    const weekKey = getWeekStartMonday(date);
    const prev = byWeek.get(weekKey);
    const endTime = String(session?.endTime || '').trim();
    if (!prev || date > prev.date || (date === prev.date && endTime > prev.endTime)) {
      byWeek.set(weekKey, { type: 'date', date, endTime });
    }
  });
  return [...byWeek.values()]
    .map(({ type, date }) => ({ type, date }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildSemiMonthlyAnchors(startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end || start > end) return [];

  const seen = new Set();
  const anchors = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cursor <= endMonth) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const fifteenth = formatDate(new Date(year, month, 15));
    const monthEnd = lastCalendarDayOfMonth(year, month);
    [fifteenth, monthEnd].forEach((date) => {
      if (!date || seen.has(date)) return;
      if (date < startDate || date > endDate) return;
      seen.add(date);
      anchors.push({ type: 'date', date });
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return anchors.sort((a, b) => a.date.localeCompare(b.date));
}

function buildCustomAnchors(startDate, endDate, customStepDays = 7) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end || start > end) return [];
  const step = Math.max(1, Number(customStepDays) || 7);
  const anchors = [];
  const cursor = new Date(start.getTime());
  while (cursor <= end) {
    anchors.push({ type: 'date', date: formatDate(cursor) });
    cursor.setDate(cursor.getDate() + step);
  }
  return anchors;
}

function buildScheduleAnchors({
  preset = SCHEDULE_PRESETS.END_OF_MONTH,
  startDate = '',
  endDate = '',
  sessions = [],
  customStepDays = 7
} = {}) {
  const normalizedPreset = String(preset || '').trim().toLowerCase();
  const scopedSessions = sessionsInWindow(sessions, startDate, endDate);

  if (normalizedPreset === SCHEDULE_PRESETS.END_OF_EACH_DAY) {
    return scopedSessions
      .map((session) => ({
        type: 'session',
        sessionId: getSessionId(session),
        date: normalizeDateOnly(session?.date)
      }))
      .filter((anchor) => anchor.sessionId && anchor.date)
      .sort((a, b) => a.date.localeCompare(b.date) || a.sessionId.localeCompare(b.sessionId));
  }

  if (normalizedPreset === SCHEDULE_PRESETS.END_OF_MONTH) {
    return buildEndOfMonthAnchors(scopedSessions);
  }

  if (normalizedPreset === SCHEDULE_PRESETS.END_OF_WEEK) {
    return buildEndOfWeekAnchors(scopedSessions);
  }

  if (normalizedPreset === SCHEDULE_PRESETS.SEMI_MONTHLY) {
    return buildSemiMonthlyAnchors(startDate, endDate);
  }

  if (normalizedPreset === SCHEDULE_PRESETS.CUSTOM) {
    return buildCustomAnchors(startDate, endDate, customStepDays);
  }

  return [];
}

function findClosestSessionForDate(sessions = [], anchorDate = '') {
  const anchor = normalizeDateOnly(anchorDate);
  if (!anchor) return null;
  const candidates = (Array.isArray(sessions) ? sessions : [])
    .filter((session) => normalizeDateOnly(session?.date));
  if (!candidates.length) return null;

  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  candidates.forEach((session) => {
    const sessionDate = normalizeDateOnly(session.date);
    const distance = Math.abs(daysBetween(anchor, sessionDate));
    if (distance < bestDistance) {
      best = session;
      bestDistance = distance;
      return;
    }
    if (distance !== bestDistance || !best) return;

    const bestDate = normalizeDateOnly(best.date);
    const bestAfter = bestDate >= anchor;
    const sessionAfter = sessionDate >= anchor;
    if (sessionAfter && !bestAfter) {
      best = session;
      return;
    }
    if (sessionAfter !== bestAfter) return;
    if (sessionDate > bestDate) {
      best = session;
      return;
    }
    if (sessionDate === bestDate && String(session?.endTime || '') > String(best?.endTime || '')) {
      best = session;
    }
  });

  return best;
}

function generateTargetRowId() {
  return `row_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function resolveTeacherId(session, defaults = {}) {
  const fromSession = String(session?.delivery?.deliveredBy || '').trim();
  const fromDefaults = String(defaults?.teacherId || '').trim();
  return fromSession || fromDefaults;
}

function resolveTaskTimes(session, defaults = {}) {
  const fromDefaultsStart = String(defaults?.taskStartTime || '').trim();
  const fromDefaultsEnd = String(defaults?.taskEndTime || '').trim();
  return {
    taskStartTime: fromDefaultsStart || String(session?.startTime || '').trim(),
    taskEndTime: fromDefaultsEnd || String(session?.endTime || '').trim()
  };
}

function buildTargetRowsFromSchedule({
  anchors = [],
  sessions = [],
  linkSessions = true,
  defaults = {}
} = {}) {
  const sessionById = new Map(
    (Array.isArray(sessions) ? sessions : [])
      .map((session) => [getSessionId(session), session])
      .filter(([id]) => Boolean(id))
  );
  const rows = [];

  (Array.isArray(anchors) ? anchors : []).forEach((anchor) => {
    if (anchor?.type === 'session' && anchor.sessionId) {
      const session = sessionById.get(String(anchor.sessionId).trim());
      if (!session) return;
      const sessionDate = normalizeDateOnly(session.date);
      const teacherId = resolveTeacherId(session, defaults);
      const taskTimes = resolveTaskTimes(session, defaults);
      rows.push({
        rowId: generateTargetRowId(),
        targetType: linkSessions ? 'session' : 'date',
        sessionId: linkSessions ? getSessionId(session) : '',
        sessionDate: linkSessions ? sessionDate : '',
        dueDate: linkSessions ? '' : sessionDate,
        reportStartDate: sessionDate,
        reportDueDate: sessionDate,
        taskStartTime: taskTimes.taskStartTime,
        taskEndTime: taskTimes.taskEndTime,
        conflictPermitted: linkSessions ? true : Boolean(defaults?.conflictPermitted),
        timesheetReflection: defaults?.timesheetReflection === true,
        allocatedHours: defaults?.timesheetReflection ? Number(defaults?.allocatedHours) || 0 : 0,
        teacherId,
        teacherName: String(defaults?.teacherName || '').trim(),
        status: String(defaults?.status || 'active').trim().toLowerCase() || 'active',
        notes: String(defaults?.notes || '').trim(),
        linkNote: linkSessions ? `Linked session ${getSessionId(session)}` : `Date target ${sessionDate}`
      });
      return;
    }

    const anchorDate = normalizeDateOnly(anchor?.date);
    if (!anchorDate) return;

    if (linkSessions) {
      const session = findClosestSessionForDate(sessions, anchorDate);
      if (!session) return;
      const sessionDate = normalizeDateOnly(session.date);
      const teacherId = resolveTeacherId(session, defaults);
      const taskTimes = resolveTaskTimes(session, defaults);
      rows.push({
        rowId: generateTargetRowId(),
        targetType: 'session',
        sessionId: getSessionId(session),
        sessionDate,
        dueDate: '',
        reportStartDate: sessionDate,
        reportDueDate: sessionDate,
        taskStartTime: taskTimes.taskStartTime,
        taskEndTime: taskTimes.taskEndTime,
        conflictPermitted: true,
        timesheetReflection: defaults?.timesheetReflection === true,
        allocatedHours: defaults?.timesheetReflection ? Number(defaults?.allocatedHours) || 0 : 0,
        teacherId,
        teacherName: String(defaults?.teacherName || '').trim(),
        status: String(defaults?.status || 'active').trim().toLowerCase() || 'active',
        notes: String(defaults?.notes || '').trim(),
        linkNote: `Anchor ${anchorDate} → session ${getSessionId(session)} (${sessionDate})`
      });
      return;
    }

    const teacherId = String(defaults?.teacherId || '').trim();
    rows.push({
      rowId: generateTargetRowId(),
      targetType: 'date',
      sessionId: '',
      sessionDate: '',
      dueDate: anchorDate,
      reportStartDate: anchorDate,
      reportDueDate: anchorDate,
      taskStartTime: String(defaults?.taskStartTime || '').trim(),
      taskEndTime: String(defaults?.taskEndTime || '').trim(),
      conflictPermitted: Boolean(defaults?.conflictPermitted),
      timesheetReflection: defaults?.timesheetReflection === true,
      allocatedHours: defaults?.timesheetReflection ? Number(defaults?.allocatedHours) || 0 : 0,
      teacherId,
      teacherName: String(defaults?.teacherName || '').trim(),
      status: String(defaults?.status || 'active').trim().toLowerCase() || 'active',
      notes: String(defaults?.notes || '').trim(),
      linkNote: `Date target ${anchorDate}`
    });
  });

  return rows;
}

function rowDedupeKey(row = {}) {
  const targetType = String(row?.targetType || '').trim().toLowerCase();
  const teacherId = String(row?.teacherId || '').trim();
  if (targetType === 'session') {
    return `session:${String(row?.sessionId || '').trim()}`;
  }
  return `date:${String(row?.dueDate || row?.sessionDate || '').trim()}:${teacherId}`;
}

function dedupeTargetRows(existingRows = [], candidateRows = []) {
  const seen = new Set((Array.isArray(existingRows) ? existingRows : []).map(rowDedupeKey));
  const accepted = [];
  const skipped = [];

  (Array.isArray(candidateRows) ? candidateRows : []).forEach((row) => {
    const key = rowDedupeKey(row);
    if (!key || key === 'date::' || key === 'session:') {
      skipped.push({ row, reason: 'Invalid row identity.' });
      return;
    }
    if (seen.has(key)) {
      skipped.push({ row, reason: 'Duplicate target already exists in this assignment.' });
      return;
    }
    seen.add(key);
    accepted.push(row);
  });

  return { accepted, skipped };
}

function generateBulkTargetRows({
  preset,
  startDate,
  endDate,
  sessions,
  customStepDays,
  linkSessions,
  defaults
} = {}) {
  const anchors = buildScheduleAnchors({
    preset,
    startDate,
    endDate,
    sessions,
    customStepDays
  });
  return buildTargetRowsFromSchedule({
    anchors,
    sessions,
    linkSessions,
    defaults
  });
}

module.exports = {
  SCHEDULE_PRESETS,
  normalizeDateOnly,
  buildScheduleAnchors,
  findClosestSessionForDate,
  buildTargetRowsFromSchedule,
  dedupeTargetRows,
  generateBulkTargetRows
};
