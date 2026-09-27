'use strict';

const activityAssigneeTimingService = require('./activityAssigneeTimingService');
const sessionConflictDetectionService = require('./sessionConflictDetectionService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const { requireCoreModule } = require('./schoolCoreContracts');

const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function resolveScheduleController() {
  return require('../../controllers/school/scheduleController');
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function normalizeClockTime(value) {
  const token = String(value || '').trim();
  const match = token.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hh = String(Math.max(0, Math.min(23, Number(match[1] || 0)))).padStart(2, '0');
  const mm = String(Math.max(0, Math.min(59, Number(match[2] || 0)))).padStart(2, '0');
  return `${hh}:${mm}`;
}

function clockWindowsOverlap(aStart, aEnd, bStart, bEnd) {
  const toMinutes = (clock) => {
    const normalized = normalizeClockTime(clock);
    if (!normalized) return null;
    const [hour, minute] = normalized.split(':').map(Number);
    return (hour * 60) + minute;
  };
  const aStartMinutes = toMinutes(aStart);
  const aEndMinutes = toMinutes(aEnd);
  const bStartMinutes = toMinutes(bStart);
  const bEndMinutes = toMinutes(bEnd);
  if ([aStartMinutes, aEndMinutes, bStartMinutes, bEndMinutes].some((value) => !Number.isInteger(value))) return false;
  if (aEndMinutes <= aStartMinutes || bEndMinutes <= bStartMinutes) return false;
  return aStartMinutes < bEndMinutes && aEndMinutes > bStartMinutes;
}

function parseForceConflicts(value) {
  if (value === true) return true;
  const token = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(token);
}

function isSameWorkSessionScheduleEvent(event = {}, activityId = '', entryId = '') {
  const normalizedActivityId = toPublicId(activityId);
  const normalizedEntryId = toPublicId(entryId);
  if (!normalizedActivityId || !normalizedEntryId) return false;
  const eventActivityId = toPublicId(event?.activityId);
  const eventEntryId = toPublicId(event?.activityEntryId);
  if (eventActivityId && eventEntryId) {
    return idsEqual(eventActivityId, normalizedActivityId) && idsEqual(eventEntryId, normalizedEntryId);
  }
  if (eventActivityId && idsEqual(eventActivityId, normalizedActivityId)) {
    const eventId = String(event?.id || '').trim();
    if (eventId.includes(normalizedEntryId)) return true;
  }
  return false;
}

function resolveEventWindow(event = {}) {
  return {
    date: normalizeDateOnly(event?.date),
    start: normalizeClockTime(event?.start || event?.startTime),
    end: normalizeClockTime(event?.end || event?.endTime)
  };
}

function resolveEventLabel(event = {}) {
  return String(
    event?.title
    || event?.className
    || event?.classTitle
    || event?.label
    || 'Scheduled event'
  ).trim();
}

function scheduleFieldsChanged(priorEntry = {}, next = {}) {
  return normalizeDateOnly(priorEntry?.date) !== normalizeDateOnly(next?.date)
    || normalizeClockTime(priorEntry?.startTime) !== normalizeClockTime(next?.startTime)
    || normalizeClockTime(priorEntry?.endTime) !== normalizeClockTime(next?.endTime);
}

async function detectWorkSessionAssigneeScheduleConflicts({
  orgId = '',
  activityId = '',
  entryId = '',
  date = '',
  startTime = '',
  endTime = '',
  assignees = [],
  reqUser
} = {}) {
  const sessionDate = normalizeDateOnly(date);
  const sessionStart = normalizeClockTime(startTime);
  const sessionEnd = normalizeClockTime(endTime);
  if (!sessionDate || !sessionStart || !sessionEnd) return [];

  const entryStub = { date: sessionDate, startTime: sessionStart, endTime: sessionEnd };
  const rows = Array.isArray(assignees) ? assignees : [];
  const personIds = [...new Set(rows.map((row) => toPublicId(row?.personId)).filter(Boolean))];
  if (!personIds.length) return [];

  const personDisplayMap = await schoolPersonAccessService.buildPersonByIdMap({ reqUser, personIds });
  const scheduleController = resolveScheduleController();
  const conflicts = [];

  for (let index = 0; index < personIds.length; index += 1) {
    const personId = personIds[index];
    const personName = schoolPersonAccessService.formatPersonName(personDisplayMap.get(personId), personId);
    const assigneeRow = rows.find((row) => idsEqual(row?.personId, personId)) || { personId };
    const timing = activityAssigneeTimingService.resolveAssigneeTiming({ assignee: assigneeRow, entry: entryStub });
    const assigneeStart = normalizeClockTime(timing?.startTime);
    const assigneeEnd = normalizeClockTime(timing?.endTime);
    if (!assigneeStart || !assigneeEnd) continue;

    // eslint-disable-next-line no-await-in-loop
    const scheduleResult = await scheduleController.buildEventsForPersonAndRange({
      personId,
      startDate: sessionDate,
      endDate: sessionDate,
      reqUser,
      activeOrgId: orgId
    });
    const events = Array.isArray(scheduleResult?.events) ? scheduleResult.events : [];
    events.forEach((event) => {
      if (isSameWorkSessionScheduleEvent(event, activityId, entryId)) return;
      const window = resolveEventWindow(event);
      if (window.date !== sessionDate) return;
      if (!clockWindowsOverlap(assigneeStart, assigneeEnd, window.start, window.end)) return;
      conflicts.push({
        personId,
        date: sessionDate,
        teacherName: personName,
        conflictClass: resolveEventLabel(event),
        existTime: `${window.start} - ${window.end}`,
        conflictType: String(event?.eventType || event?.targetType || 'schedule').trim() || 'schedule'
      });
    });
  }

  return sessionConflictDetectionService.dedupeSessionConflictRows(conflicts);
}

async function assertNoAssigneeScheduleConflicts(options = {}) {
  const {
    priorEntry = {},
    forceConflicts = false,
    status = 'posted'
  } = options;
  const nextStatus = String(status || priorEntry?.status || 'posted').trim().toLowerCase();
  if (nextStatus === 'cancelled') return { conflicts: [] };

  const nextSchedule = {
    date: options.date,
    startTime: options.startTime,
    endTime: options.endTime
  };
  if (!scheduleFieldsChanged(priorEntry, nextSchedule)) {
    return { conflicts: [] };
  }

  const conflicts = await detectWorkSessionAssigneeScheduleConflicts(options);
  if (!conflicts.length || parseForceConflicts(forceConflicts)) {
    return { conflicts };
  }

  const warningMessage = 'The updated work session date or time conflicts with existing schedule entries for one or more assignees.';
  const error = new Error(warningMessage);
  error.statusCode = 409;
  error.code = 'SESSION_METADATA_CONFLICTS';
  error.data = {
    requiresConfirmation: true,
    conflicts: conflicts.slice(0, 12).map((row) => ({
      date: row?.date || normalizeDateOnly(options.date),
      teacherName: row?.teacherName || '',
      conflictClass: row?.conflictClass || 'schedule conflict',
      existTime: row?.existTime || ''
    }))
  };
  throw error;
}

module.exports = {
  detectWorkSessionAssigneeScheduleConflicts,
  assertNoAssigneeScheduleConflicts,
  scheduleFieldsChanged,
  parseForceConflicts
};
