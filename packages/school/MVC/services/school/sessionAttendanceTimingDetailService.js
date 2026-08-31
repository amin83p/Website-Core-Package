function parseAttendanceClockToMinutes(clock) {
  const token = String(clock || '').trim();
  if (!/^\d{2}:\d{2}$/.test(token)) return null;
  const [hours, minutes] = token.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return (hours * 60) + minutes;
}

function calculateAttendanceClockRangeMinutes(startTime, endTime) {
  const start = parseAttendanceClockToMinutes(startTime);
  const end = parseAttendanceClockToMinutes(endTime);
  if (start == null || end == null || end <= start) return 0;
  return end - start;
}

function clampAttendanceMinuteValue(minutes, maxMinutes) {
  const max = Math.max(0, Math.floor(Number(maxMinutes) || 0));
  const n = Math.floor(Number(minutes) || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.max(0, Math.min(max, n));
}

function parseNonNegBreakMinutes(value) {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function computeBoundaryLateMinutes(start, arrival) {
  const startM = parseAttendanceClockToMinutes(start);
  if (startM == null) return 0;
  const arrivalToken = String(arrival || '').trim();
  const effectiveArrival = arrivalToken || String(start || '').trim();
  const arrivalM = parseAttendanceClockToMinutes(effectiveArrival);
  if (arrivalM == null) return 0;
  return Math.max(0, arrivalM - startM);
}

function computeBoundaryEarlyMinutes(end, leave) {
  const endM = parseAttendanceClockToMinutes(end);
  if (endM == null) return 0;
  const leaveToken = String(leave || '').trim();
  const effectiveLeave = leaveToken || String(end || '').trim();
  const leaveM = parseAttendanceClockToMinutes(effectiveLeave);
  if (leaveM == null) return 0;
  return Math.max(0, endM - leaveM);
}

function computeAttendanceTimingTotals({
  start,
  end,
  arrival,
  leave,
  breakLate,
  breakEarly
}) {
  const maxSpan = calculateAttendanceClockRangeMinutes(start, end);
  const boundaryLate = clampAttendanceMinuteValue(computeBoundaryLateMinutes(start, arrival), maxSpan);
  const boundaryEarly = clampAttendanceMinuteValue(computeBoundaryEarlyMinutes(end, leave), maxSpan);
  const breakLateMinutes = clampAttendanceMinuteValue(breakLate, maxSpan);
  const breakEarlyLeaveMinutes = clampAttendanceMinuteValue(breakEarly, maxSpan);
  return {
    boundaryLate,
    boundaryEarly,
    breakLateMinutes,
    breakEarlyLeaveMinutes,
    lateMinutes: clampAttendanceMinuteValue(boundaryLate + breakLateMinutes, maxSpan),
    earlyLeaveMinutes: clampAttendanceMinuteValue(boundaryEarly + breakEarlyLeaveMinutes, maxSpan)
  };
}

function normalizeStoredArrivalTime(startTime, arrivalTime) {
  const start = String(startTime || '').trim();
  const arrival = String(arrivalTime || '').trim();
  if (!arrival || (start && arrival === start)) return '';
  return arrival;
}

function normalizeStoredLeaveTime(endTime, leaveTime) {
  const end = String(endTime || '').trim();
  const leave = String(leaveTime || '').trim();
  if (!leave || (end && leave === end)) return '';
  return leave;
}

function normalizeAttendanceTimingDetailForSave({
  startTime,
  endTime,
  arrivalTime,
  leaveTime,
  breakLateMinutes,
  breakEarlyLeaveMinutes
}) {
  const attendanceArrivalTime = normalizeStoredArrivalTime(startTime, arrivalTime);
  const attendanceLeaveTime = normalizeStoredLeaveTime(endTime, leaveTime);
  const breakLate = parseNonNegBreakMinutes(breakLateMinutes);
  const breakEarly = parseNonNegBreakMinutes(breakEarlyLeaveMinutes);
  const totals = computeAttendanceTimingTotals({
    start: startTime,
    end: endTime,
    arrival: attendanceArrivalTime,
    leave: attendanceLeaveTime,
    breakLate,
    breakEarly
  });
  return {
    attendanceArrivalTime,
    attendanceLeaveTime,
    breakLateMinutes: breakLate,
    breakEarlyLeaveMinutes: breakEarly,
    lateMinutes: totals.lateMinutes,
    earlyLeaveMinutes: totals.earlyLeaveMinutes
  };
}

function resolveModalDisplayTimes({
  startTime,
  endTime,
  attendanceArrivalTime,
  attendanceLeaveTime
}) {
  const start = String(startTime || '').trim();
  const end = String(endTime || '').trim();
  const storedArrival = String(attendanceArrivalTime || '').trim();
  const storedLeave = String(attendanceLeaveTime || '').trim();
  return {
    arrivalDisplay: storedArrival || start,
    leaveDisplay: storedLeave || end
  };
}

function readRosterTimingDetailFromRecord(record = {}) {
  return {
    attendanceArrivalTime: String(record.attendanceArrivalTime || '').trim(),
    attendanceLeaveTime: String(record.attendanceLeaveTime || '').trim(),
    breakLateMinutes: parseNonNegBreakMinutes(record.breakLateMinutes),
    breakEarlyLeaveMinutes: parseNonNegBreakMinutes(record.breakEarlyLeaveMinutes)
  };
}

function parseNonNegTotalMinutes(value) {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function backfillRosterTimingDetailFromTotals(row = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { row, changed: false };
  }

  const lateMinutes = parseNonNegTotalMinutes(row.lateMinutes);
  const earlyLeaveMinutes = parseNonNegTotalMinutes(row.earlyLeaveMinutes);
  const next = {
    ...row,
    attendanceArrivalTime: '',
    attendanceLeaveTime: '',
    breakLateMinutes: lateMinutes,
    breakEarlyLeaveMinutes: earlyLeaveMinutes,
    lateMinutes,
    earlyLeaveMinutes
  };

  const priorArrival = String(row.attendanceArrivalTime || '').trim();
  const priorLeave = String(row.attendanceLeaveTime || '').trim();
  const priorBreakLate = parseNonNegTotalMinutes(row.breakLateMinutes);
  const priorBreakEarly = parseNonNegTotalMinutes(row.breakEarlyLeaveMinutes);
  const priorLate = parseNonNegTotalMinutes(row.lateMinutes);
  const priorEarly = parseNonNegTotalMinutes(row.earlyLeaveMinutes);

  const changed = (
    priorArrival !== ''
    || priorLeave !== ''
    || priorBreakLate !== lateMinutes
    || priorBreakEarly !== earlyLeaveMinutes
    || priorLate !== lateMinutes
    || priorEarly !== earlyLeaveMinutes
  );

  return { row: changed ? next : row, changed };
}

module.exports = {
  parseAttendanceClockToMinutes,
  calculateAttendanceClockRangeMinutes,
  clampAttendanceMinuteValue,
  computeBoundaryLateMinutes,
  computeBoundaryEarlyMinutes,
  computeAttendanceTimingTotals,
  normalizeStoredArrivalTime,
  normalizeStoredLeaveTime,
  normalizeAttendanceTimingDetailForSave,
  resolveModalDisplayTimes,
  readRosterTimingDetailFromRecord,
  backfillRosterTimingDetailFromTotals
};
