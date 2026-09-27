'use strict';

const sessionStatusPolicyService = require('./sessionStatusPolicyService');

function normalizeClockTime(value) {
  const raw = String(value || '').trim();
  if (!/^\d{2}:\d{2}$/.test(raw)) return '';
  const [hour, minute] = raw.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return '';
  return raw;
}

function normalizePaidHours(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return Number(Number(fallback || 0).toFixed(2));
  return Number(Math.min(24, n).toFixed(2));
}

function deriveAssigneeEndTime(startTime, paidHours) {
  const start = normalizeClockTime(startTime);
  if (!start) return '';
  const hours = normalizePaidHours(paidHours, 0);
  if (hours <= 0) return start;
  const minutes = Math.round(hours * 60);
  return sessionStatusPolicyService.addMinutesToClockTime(start, minutes) || '';
}

function resolveAssigneeTiming({ assignee = {}, entry = {} } = {}) {
  const entryStart = normalizeClockTime(entry?.startTime);
  const entryEnd = normalizeClockTime(entry?.endTime);
  const assigneeStart = normalizeClockTime(assignee?.startTime);
  const assigneeEnd = normalizeClockTime(assignee?.endTime);
  const paidHours = normalizePaidHours(
    assignee?.paidHours,
    entry?.durationHours || 0
  );
  const startTime = assigneeStart || entryStart || '';
  const endTime = assigneeEnd
    || (startTime ? deriveAssigneeEndTime(startTime, paidHours) : '')
    || entryEnd
    || '';
  return { startTime, endTime };
}

function resolveAssigneeEndTime({
  assignee = {},
  entry = {},
  overrides = {},
  startTime = '',
  paidHours = 0
} = {}) {
  if (overrides.endTime !== undefined) {
    const overrideEnd = normalizeClockTime(overrides.endTime);
    if (overrideEnd) return overrideEnd;
  }
  const existingEnd = normalizeClockTime(assignee?.endTime);
  if (existingEnd) return existingEnd;
  return startTime ? deriveAssigneeEndTime(startTime, paidHours) : '';
}

function clockTimeToMinutes(value) {
  const clock = normalizeClockTime(value);
  if (!clock) return null;
  const [hour, minute] = clock.split(':').map(Number);
  return (hour * 60) + minute;
}

function hoursBetweenClockTimes(startTime, endTime) {
  const startMinutes = clockTimeToMinutes(startTime);
  const endMinutes = clockTimeToMinutes(endTime);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return 0;
  return Number(((endMinutes - startMinutes) / 60).toFixed(2));
}

function validateAssigneeClockRange(startTime, endTime) {
  const start = normalizeClockTime(startTime);
  const end = normalizeClockTime(endTime);
  if (!start || !end) return { valid: true, message: '' };
  const startMinutes = clockTimeToMinutes(start);
  const endMinutes = clockTimeToMinutes(end);
  if (endMinutes <= startMinutes) {
    return {
      valid: false,
      message: 'Assignee end time must be after the start time.'
    };
  }
  return { valid: true, message: '' };
}

function validateAssigneeWithinSessionWindow(assigneeStartTime, assigneeEndTime, sessionStartTime, sessionEndTime) {
  const sessionStart = normalizeClockTime(sessionStartTime);
  const sessionEnd = normalizeClockTime(sessionEndTime);
  const assigneeStart = normalizeClockTime(assigneeStartTime);
  const assigneeEnd = normalizeClockTime(assigneeEndTime);
  if (!sessionStart || !sessionEnd) return { valid: true, message: '' };
  if (!assigneeStart || !assigneeEnd) {
    return {
      valid: false,
      message: 'Assignee start and end times are required.'
    };
  }
  const sessionStartMinutes = clockTimeToMinutes(sessionStart);
  const sessionEndMinutes = clockTimeToMinutes(sessionEnd);
  const assigneeStartMinutes = clockTimeToMinutes(assigneeStart);
  const assigneeEndMinutes = clockTimeToMinutes(assigneeEnd);
  if (assigneeStartMinutes < sessionStartMinutes) {
    return {
      valid: false,
      message: 'Assignee start time cannot be before the work session start time.'
    };
  }
  if (assigneeEndMinutes > sessionEndMinutes) {
    return {
      valid: false,
      message: 'Assignee end time cannot be after the work session end time.'
    };
  }
  return { valid: true, message: '' };
}

function validateAssigneePaidHoursWithinSpan(paidHours, assigneeStartTime, assigneeEndTime, isPaid = true) {
  const hours = normalizePaidHours(paidHours, 0);
  if (!isPaid) {
    if (hours !== 0) {
      return {
        valid: false,
        message: 'Paid hours must be zero when the assignee is not payable.'
      };
    }
    return { valid: true, message: '' };
  }
  const spanHours = hoursBetweenClockTimes(assigneeStartTime, assigneeEndTime);
  if (spanHours <= 0 && hours > 0) {
    return {
      valid: false,
      message: 'Paid hours require a valid assignee time range.'
    };
  }
  if (hours > spanHours + 0.001) {
    return {
      valid: false,
      message: 'Paid hours cannot exceed the assignee time range.'
    };
  }
  return { valid: true, message: '' };
}

function validateAssigneeTimingRules({ assignee = {}, entry = {} } = {}) {
  const timing = resolveAssigneeTiming({ assignee, entry });
  const rangeCheck = validateAssigneeClockRange(timing.startTime, timing.endTime);
  if (!rangeCheck.valid) return rangeCheck;
  const windowCheck = validateAssigneeWithinSessionWindow(
    timing.startTime,
    timing.endTime,
    entry?.startTime,
    entry?.endTime
  );
  if (!windowCheck.valid) return windowCheck;
  const isPaid = assignee?.paid !== false;
  const paidCheck = validateAssigneePaidHoursWithinSpan(
    assignee?.paidHours,
    timing.startTime,
    timing.endTime,
    isPaid
  );
  if (!paidCheck.valid) return paidCheck;
  return { valid: true, message: '' };
}

function assertAssigneeTimingRules({ assignee = {}, entry = {} } = {}) {
  const result = validateAssigneeTimingRules({ assignee, entry });
  if (!result.valid) throw new Error(result.message || 'Invalid assignee timing.');
}

function applyAssigneeTiming(assignee = {}, entry = {}, overrides = {}) {
  const paidHours = normalizePaidHours(
    overrides.paidHours !== undefined ? overrides.paidHours : assignee?.paidHours,
    entry?.durationHours || 0
  );
  const startTime = normalizeClockTime(
    overrides.startTime !== undefined ? overrides.startTime : assignee?.startTime
  ) || normalizeClockTime(entry?.startTime) || '';
  const endTime = resolveAssigneeEndTime({
    assignee,
    entry,
    overrides,
    startTime,
    paidHours
  });
  const next = { ...assignee, paidHours };
  if (startTime) next.startTime = startTime;
  if (endTime) next.endTime = endTime;
  return next;
}

function backfillAssigneeTiming(assignee = {}, entry = {}) {
  const paidHours = normalizePaidHours(
    assignee?.paidHours,
    entry?.durationHours || 0
  );
  const startTime = normalizeClockTime(entry?.startTime);
  if (!startTime) return { ...assignee, paidHours };
  const endTime = deriveAssigneeEndTime(startTime, paidHours);
  return {
    ...assignee,
    paidHours,
    startTime,
    endTime
  };
}

function assigneeTimingMatchesRule(assignee = {}, entry = {}) {
  const currentStart = normalizeClockTime(assignee?.startTime);
  const currentEnd = normalizeClockTime(assignee?.endTime);
  if (currentStart && currentEnd) return true;
  const expected = backfillAssigneeTiming(assignee, entry);
  const expectedStart = normalizeClockTime(expected.startTime);
  const expectedEnd = normalizeClockTime(expected.endTime);
  if (!expectedStart || !expectedEnd) return Boolean(currentStart && currentEnd);
  return currentStart === expectedStart && currentEnd === expectedEnd;
}

function shouldShiftAssigneeStartOnSessionChange({
  assignee = {},
  priorSessionStartTime = '',
  newSessionStartTime = ''
} = {}) {
  const prior = normalizeClockTime(priorSessionStartTime);
  const next = normalizeClockTime(newSessionStartTime);
  if (!prior || !next || prior === next) return false;
  const assigneeStart = normalizeClockTime(assignee?.startTime);
  return !assigneeStart || assigneeStart === prior;
}

function resolveAssigneeStartAfterSessionChange({
  assignee = {},
  priorSessionStartTime = '',
  newSessionStartTime = ''
} = {}) {
  if (shouldShiftAssigneeStartOnSessionChange({
    assignee,
    priorSessionStartTime,
    newSessionStartTime
  })) {
    return normalizeClockTime(newSessionStartTime);
  }
  return normalizeClockTime(assignee?.startTime)
    || normalizeClockTime(priorSessionStartTime)
    || normalizeClockTime(newSessionStartTime)
    || '';
}

module.exports = {
  normalizeClockTime,
  normalizePaidHours,
  deriveAssigneeEndTime,
  resolveAssigneeEndTime,
  clockTimeToMinutes,
  hoursBetweenClockTimes,
  validateAssigneeClockRange,
  validateAssigneeWithinSessionWindow,
  validateAssigneePaidHoursWithinSpan,
  validateAssigneeTimingRules,
  assertAssigneeTimingRules,
  resolveAssigneeTiming,
  applyAssigneeTiming,
  backfillAssigneeTiming,
  assigneeTimingMatchesRule,
  shouldShiftAssigneeStartOnSessionChange,
  resolveAssigneeStartAfterSessionChange
};
