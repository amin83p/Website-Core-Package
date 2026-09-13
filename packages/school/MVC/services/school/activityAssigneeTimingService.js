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

function validateAssigneeClockRange(startTime, endTime) {
  const start = normalizeClockTime(startTime);
  const end = normalizeClockTime(endTime);
  if (!start || !end) return { valid: true, message: '' };
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMinutes = (sh * 60) + sm;
  const endMinutes = (eh * 60) + em;
  if (endMinutes <= startMinutes) {
    return {
      valid: false,
      message: 'Assignee end time must be after the start time.'
    };
  }
  return { valid: true, message: '' };
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
  validateAssigneeClockRange,
  resolveAssigneeTiming,
  applyAssigneeTiming,
  backfillAssigneeTiming,
  assigneeTimingMatchesRule,
  shouldShiftAssigneeStartOnSessionChange,
  resolveAssigneeStartAfterSessionChange
};
