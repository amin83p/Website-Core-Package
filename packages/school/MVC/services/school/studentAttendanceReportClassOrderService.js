'use strict';

const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');

const { parseTimeToMinutes } = attendanceMatrixMetricsService;

const DAYPART_RANK = Object.freeze({
  AM: 0,
  PM: 1,
  UNKNOWN: 2
});

const PM_DAYPART_MINUTES = 12 * 60;

function clean(value = '') {
  return String(value ?? '').trim();
}

function normalizeDateOnly(value = '') {
  const token = clean(value);
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function sessionIsInDateWindow(session = {}, startDate = '', endDate = '') {
  const date = normalizeDateOnly(session?.date || session?.sessionDate || session?.startDate);
  if (!date) return false;
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function filterSessionsInDateWindow(sessions = [], startDate = '', endDate = '') {
  const start = normalizeDateOnly(startDate);
  const end = normalizeDateOnly(endDate);
  return (Array.isArray(sessions) ? sessions : []).filter((session) => {
    if (!start && !end) return true;
    return sessionIsInDateWindow(session, start, end);
  });
}

function computeEarliestSessionStartMinutes(sessions = []) {
  let earliest = null;
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    const minutes = parseTimeToMinutes(session?.startTime || session?.start);
    if (minutes == null) return;
    if (earliest == null || minutes < earliest) earliest = minutes;
  });
  return earliest;
}

function buildSessionStartLookup(sessions = []) {
  const byDate = new Map();
  const bySessionId = new Map();
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    const minutes = parseTimeToMinutes(session?.startTime || session?.start);
    if (minutes == null) return;
    const sessionId = clean(session?.id || session?.sessionId);
    const date = normalizeDateOnly(session?.date || session?.sessionDate || session?.startDate);
    if (sessionId) bySessionId.set(sessionId, minutes);
    if (date) {
      const prev = byDate.get(date);
      if (prev == null || minutes < prev) byDate.set(date, minutes);
    }
  });
  return { byDate, bySessionId };
}

function resolveRecordStartMinutes(record = {}, lookup = {}) {
  const sessionId = clean(record?.sessionId);
  if (sessionId && lookup.bySessionId instanceof Map && lookup.bySessionId.has(sessionId)) {
    return lookup.bySessionId.get(sessionId);
  }
  const date = normalizeDateOnly(record?.date);
  if (date && lookup.byDate instanceof Map && lookup.byDate.has(date)) {
    return lookup.byDate.get(date);
  }
  return null;
}

function rollupRecordCountsForStudentSchedule(record = {}) {
  if (record?.expectedForSession === false) return false;
  if (record?.enrollmentNaLock === true && String(record?.status || '').trim().toLowerCase() === 'not_applicable') {
    return false;
  }
  return true;
}

function sessionMinutesMatchClassDaypart(minutes, daypartRank = DAYPART_RANK.UNKNOWN) {
  if (minutes == null) return false;
  if (daypartRank === DAYPART_RANK.AM) return minutes < PM_DAYPART_MINUTES;
  if (daypartRank === DAYPART_RANK.PM) return minutes >= PM_DAYPART_MINUTES;
  return true;
}

function scanEarliestStudentMinutes(rollupRecords = [], lookup = {}, daypartRank = DAYPART_RANK.UNKNOWN) {
  let earliest = null;
  (Array.isArray(rollupRecords) ? rollupRecords : []).forEach((record) => {
    if (!rollupRecordCountsForStudentSchedule(record)) return;
    const minutes = resolveRecordStartMinutes(record, lookup);
    if (minutes == null) return;
    if (!sessionMinutesMatchClassDaypart(minutes, daypartRank)) return;
    if (earliest == null || minutes < earliest) earliest = minutes;
  });
  return earliest;
}

function computeEarliestSessionStartMinutesForStudent(sessions = [], rollupRecords = [], className = '') {
  const lookup = buildSessionStartLookup(sessions);
  const daypartRank = inferDaypartRankFromClassName(className);
  let earliest = scanEarliestStudentMinutes(rollupRecords, lookup, daypartRank);
  if (earliest == null && daypartRank !== DAYPART_RANK.UNKNOWN) {
    earliest = scanEarliestStudentMinutes(rollupRecords, lookup, DAYPART_RANK.UNKNOWN);
  }
  if (earliest != null) return earliest;
  if (daypartRank === DAYPART_RANK.AM || daypartRank === DAYPART_RANK.PM) {
    let scoped = null;
    (Array.isArray(sessions) ? sessions : []).forEach((session) => {
      const minutes = parseTimeToMinutes(session?.startTime || session?.start);
      if (minutes == null) return;
      if (!sessionMinutesMatchClassDaypart(minutes, daypartRank)) return;
      if (scoped == null || minutes < scoped) scoped = minutes;
    });
    if (scoped != null) return scoped;
  }
  return computeEarliestSessionStartMinutes(sessions);
}

function inferDaypartRankFromClassName(className = '') {
  const upper = clean(className).toUpperCase();
  if (!upper) return DAYPART_RANK.UNKNOWN;
  const amToken = /(?:^|[-_/.\s])AM(?:[-_/.\s]|$)/.test(upper);
  const pmToken = /(?:^|[-_/.\s])PM(?:[-_/.\s]|$)/.test(upper);
  if (amToken && !pmToken) return DAYPART_RANK.AM;
  if (pmToken && !amToken) return DAYPART_RANK.PM;
  return DAYPART_RANK.UNKNOWN;
}

function resolveEarliestMinutes(classRow = {}) {
  const stored = classRow?.earliestSessionStartMinutes;
  if (Number.isFinite(Number(stored))) return Number(stored);
  return null;
}

function resolveDaypartRank(classRow = {}) {
  const stored = classRow?.daypartRank;
  if (Number.isFinite(Number(stored))) return Number(stored);
  return inferDaypartRankFromClassName(classRow?.className);
}

function attachScheduleSortFields(classRow = {}, sessions = [], options = {}) {
  const row = classRow && typeof classRow === 'object' ? classRow : {};
  const startDate = options.startDate || '';
  const endDate = options.endDate || '';
  const scopedSessions = startDate || endDate
    ? filterSessionsInDateWindow(sessions, startDate, endDate)
    : (Array.isArray(sessions) ? sessions : []);
  const rollupRecords = Array.isArray(options.rollupRecords) ? options.rollupRecords : [];
  const earliest = rollupRecords.length
    ? computeEarliestSessionStartMinutesForStudent(scopedSessions, rollupRecords, row.className)
    : computeEarliestSessionStartMinutes(scopedSessions);
  if (earliest != null) row.earliestSessionStartMinutes = earliest;
  else delete row.earliestSessionStartMinutes;
  row.daypartRank = inferDaypartRankFromClassName(row.className);
  return row;
}

function compareStudentAttendanceReportClasses(left = {}, right = {}) {
  const aMins = resolveEarliestMinutes(left);
  const bMins = resolveEarliestMinutes(right);
  const aHas = aMins != null;
  const bHas = bMins != null;
  if (aHas && bHas && aMins !== bMins) return aMins - bMins;
  if (aHas !== bHas) return aHas ? -1 : 1;
  if (aHas && bHas && aMins === bMins) {
    const daypartDiff = resolveDaypartRank(left) - resolveDaypartRank(right);
    if (daypartDiff !== 0) return daypartDiff;
  }
  if (!aHas && !bHas) {
    const daypartDiff = resolveDaypartRank(left) - resolveDaypartRank(right);
    if (daypartDiff !== 0) return daypartDiff;
  }
  const nameCompare = String(left?.className || '').localeCompare(String(right?.className || ''));
  if (nameCompare !== 0) return nameCompare;
  return String(left?.classId || '').localeCompare(String(right?.classId || ''));
}

function sortStudentAttendanceReportClasses(classes = []) {
  const rows = Array.isArray(classes) ? classes : [];
  rows.sort(compareStudentAttendanceReportClasses);
  return rows;
}

module.exports = {
  DAYPART_RANK,
  computeEarliestSessionStartMinutes,
  computeEarliestSessionStartMinutesForStudent,
  inferDaypartRankFromClassName,
  attachScheduleSortFields,
  compareStudentAttendanceReportClasses,
  sortStudentAttendanceReportClasses,
  filterSessionsInDateWindow,
  sessionIsInDateWindow
};
