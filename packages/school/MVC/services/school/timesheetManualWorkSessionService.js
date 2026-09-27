'use strict';

const timesheetParametersPolicyService = require('./timesheetParametersPolicyService');

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function normalizeClockTime(value) {
  const token = String(value ?? '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(token) && !/^\d{2}:\d{2}$/.test(token)) return '';
  const [h, m] = token.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseClockTimeToMinutes(value) {
  const token = normalizeClockTime(value);
  if (!token) return NaN;
  const [h, m] = token.split(':').map(Number);
  return (h * 60) + m;
}

function resolveManualWorkSessionPolicy(policy = {}) {
  return timesheetParametersPolicyService.resolveManualActivityWorkSessionPolicy(policy);
}

function resolveAssigneeWindowFromManualEntry(entry = {}) {
  const date = normalizeDate(entry?.date);
  const startTime = normalizeClockTime(entry?.startTime);
  const endTime = normalizeClockTime(entry?.endTime);
  if (!date || !startTime || !endTime) {
    const error = new Error('Manual activity rows require a valid date, start time, and end time before work session materialization.');
    error.statusCode = 400;
    throw error;
  }
  const startMinutes = parseClockTimeToMinutes(startTime);
  const endMinutes = parseClockTimeToMinutes(endTime);
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes <= startMinutes) {
    const error = new Error('Manual activity rows require a valid time range before work session materialization.');
    error.statusCode = 400;
    throw error;
  }
  return { date, startTime, endTime, startMinutes, endMinutes };
}

function resolveAssigneeNotesFromManualEntry(entry = {}, { defaultSessionTitle = '' } = {}) {
  const comment = String(entry?.comment || '').trim();
  if (comment) return comment;
  const description = String(entry?.description || '').trim();
  if (description) return description;
  const className = String(entry?.className || '').trim();
  const genericTitle = String(defaultSessionTitle || '').trim();
  if (className && className !== genericTitle) return className;
  return String(entry?.activityName || '').trim();
}

function isAssigneeWindowWithinSession(assigneeStart, assigneeEnd, sessionStart, sessionEnd) {
  const aStart = parseClockTimeToMinutes(assigneeStart);
  const aEnd = parseClockTimeToMinutes(assigneeEnd);
  const sStart = parseClockTimeToMinutes(sessionStart);
  const sEnd = parseClockTimeToMinutes(sessionEnd);
  if (!Number.isFinite(aStart) || !Number.isFinite(aEnd) || !Number.isFinite(sStart) || !Number.isFinite(sEnd)) {
    return false;
  }
  return aStart >= sStart && aEnd <= sEnd;
}

function workSessionTitleMatchesDefault(entryTitle = '', defaultTitle = '') {
  return String(entryTitle || '').trim() === String(defaultTitle || '').trim();
}

function isPostedWorkSession(entry = {}) {
  return String(entry?.status || 'posted').trim().toLowerCase() === 'posted';
}

function findGenericWorkSessionForAssignee(entries = [], {
  date = '',
  defaultTitle = '',
  assigneeStart = '',
  assigneeEnd = ''
} = {}) {
  const targetDate = normalizeDate(date);
  if (!targetDate || !defaultTitle) return null;
  const match = (Array.isArray(entries) ? entries : []).find((row) => {
    const entryDate = normalizeDate(row?.date);
    if (entryDate !== targetDate) return false;
    if (!isPostedWorkSession(row)) return false;
    if (!workSessionTitleMatchesDefault(row?.title, defaultTitle)) return false;
    return isAssigneeWindowWithinSession(
      assigneeStart,
      assigneeEnd,
      row?.startTime,
      row?.endTime
    );
  });
  if (!match) return null;
  return normalizeId(match?.entryId || match?.id);
}

function resolveWorkSessionWindowDurationHours(startTime, endTime) {
  const startMinutes = parseClockTimeToMinutes(startTime);
  const endMinutes = parseClockTimeToMinutes(endTime);
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes <= startMinutes) return 0;
  return Number(((endMinutes - startMinutes) / 60).toFixed(2));
}

function buildGenericWorkSessionDraft({
  date = '',
  defaultTitle = '',
  defaultStartTime = '',
  defaultEndTime = '',
  assignee = null
} = {}) {
  const durationHours = resolveWorkSessionWindowDurationHours(defaultStartTime, defaultEndTime);
  return {
    title: String(defaultTitle || '').trim(),
    date: normalizeDate(date),
    startTime: normalizeClockTime(defaultStartTime),
    endTime: normalizeClockTime(defaultEndTime),
    durationHours,
    status: 'posted',
    notes: '',
    assignees: assignee ? [assignee] : [],
    excludedPersonIds: []
  };
}

module.exports = {
  normalizeClockTime,
  parseClockTimeToMinutes,
  resolveManualWorkSessionPolicy,
  resolveAssigneeWindowFromManualEntry,
  resolveAssigneeNotesFromManualEntry,
  isAssigneeWindowWithinSession,
  findGenericWorkSessionForAssignee,
  buildGenericWorkSessionDraft,
  resolveWorkSessionWindowDurationHours,
  workSessionTitleMatchesDefault
};
