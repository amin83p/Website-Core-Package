const schoolDataService = require('./schoolDataService');
const activityService = require('./activityService');
const leaveRequestService = require('./leaveRequestService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const { requireCoreModule } = require('./schoolCoreContracts');

const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function normalizeClockTime(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function toMinutes(value) {
  const normalized = normalizeClockTime(value);
  if (!normalized) return null;
  const [h, m] = normalized.split(':').map(Number);
  return (h * 60) + m;
}

function hasOverlap(startA, endA, startB, endB) {
  const aStart = toMinutes(startA);
  const aEnd = toMinutes(endA);
  const bStart = toMinutes(startB);
  const bEnd = toMinutes(endB);
  if (aStart === null || aEnd === null || bStart === null || bEnd === null) return false;
  if (aEnd <= aStart || bEnd <= bStart) return false;
  return aStart < bEnd && aEnd > bStart;
}

function normalizeRole(role) {
  const token = String(role || '').trim().toLowerCase();
  if (!token) return '';
  if (token.includes('teacher')) return 'teacher';
  if (token.includes('student')) return 'student';
  if (token.includes('staff')) return 'staff';
  return '';
}

function normalizeActiveRoles(roles = []) {
  const set = new Set((Array.isArray(roles) ? roles : [])
    .map((role) => normalizeRole(role))
    .filter(Boolean));
  return [...set];
}

function activityEventMatchesRoles(activityEvent = {}, activeRoles = []) {
  if (!activeRoles.length) return true;
  const labels = Array.isArray(activityEvent?.roles) ? activityEvent.roles : [];
  const mapped = labels.map((label) => normalizeRole(label)).filter(Boolean);
  if (!mapped.length) return true;
  return mapped.some((role) => activeRoles.includes(role));
}

function buildConflictRow(entry, conflictingEvent, type = 'schedule') {
  return {
    entrySessionId: normalizeId(entry?.sessionId),
    date: normalizeDate(entry?.date),
    startTime: normalizeClockTime(entry?.startTime),
    endTime: normalizeClockTime(entry?.endTime),
    conflictType: type,
    role: normalizeRole(conflictingEvent?.role),
    conflictLabel: String(conflictingEvent?.label || conflictingEvent?.className || conflictingEvent?.title || 'Scheduled event').trim(),
    conflictDate: normalizeDate(conflictingEvent?.date),
    conflictStartTime: normalizeClockTime(conflictingEvent?.startTime || conflictingEvent?.start),
    conflictEndTime: normalizeClockTime(conflictingEvent?.endTime || conflictingEvent?.end),
    sourceClassId: normalizeId(conflictingEvent?.classId),
    sourceSessionId: normalizeId(conflictingEvent?.sessionId),
    sourceId: normalizeId(conflictingEvent?.id)
  };
}

function normalizeManualConflictCandidate(row = {}, { provisionalSessionId = '' } = {}) {
  const sessionId = normalizeId(row?.sessionId) || provisionalSessionId;
  const classId = normalizeId(row?.classId);
  const activityId = normalizeId(row?.activityId);
  const date = normalizeDate(row?.date);
  if (!sessionId || !date) return null;
  if (!classId && !activityId) return null;
  const startTime = normalizeClockTime(row?.startTime);
  const endTime = normalizeClockTime(row?.endTime);
  return {
    sessionId,
    classId,
    activityId,
    className: String(row?.className || row?.activityName || '').trim(),
    date,
    startTime,
    endTime,
    isTimed: Boolean(startTime && endTime),
    isActivity: Boolean(activityId)
  };
}

function normalizeTimesheetOverlapCandidate(row = {}) {
  const sessionId = normalizeId(row?.sessionId);
  const date = normalizeDate(row?.date);
  const startTime = normalizeClockTime(row?.startTime);
  const endTime = normalizeClockTime(row?.endTime);
  if (!sessionId || !date || !startTime || !endTime) return null;
  return {
    sessionId,
    classId: normalizeId(row?.classId),
    activityId: normalizeId(row?.activityId),
    className: String(row?.className || '').trim(),
    date,
    startTime,
    endTime
  };
}

async function listClassSessionScheduleEvents({ activeOrgId, personId, activeRoles, startDate, endDate, reqUser }) {
  const roles = normalizeActiveRoles(activeRoles);
  if (!roles.length) return [];

  const scopedClasses = (await schoolDataService.fetchData('classes', {}, reqUser) || [])
    .filter((row) => idsEqual(row?.orgId, activeOrgId));
  const statusMap = await sessionStatusPolicyService.getStatusMap(activeOrgId, { includeInactive: true });
  const events = [];

  for (const classRow of scopedClasses) {
    // eslint-disable-next-line no-await-in-loop
    const sessions = await schoolDataService.getClassSessions(classRow?.id, reqUser);
    (Array.isArray(sessions) ? sessions : []).forEach((sessionRow) => {
      const date = normalizeDate(sessionRow?.date);
      if (!date || date < startDate || date > endDate) return;
      const startTime = normalizeClockTime(sessionRow?.startTime);
      const endTime = normalizeClockTime(sessionRow?.endTime);
      if (!startTime || !endTime) return;

      const teacherExcluded = sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap(statusMap, {
        status: sessionRow?.status,
        notes: sessionRow?.notes
      });
      const studentExcluded = sessionStatusPolicyService.shouldExcludeFromStudentIndexByMap(statusMap, {
        status: sessionRow?.status,
        notes: sessionRow?.notes
      });

      if (roles.includes('teacher') && !teacherExcluded && idsEqual(sessionRow?.delivery?.deliveredBy, personId)) {
        events.push({
          id: `teacher-${normalizeId(classRow?.id)}-${normalizeId(sessionRow?.sessionId || sessionRow?.id)}`,
          role: 'teacher',
          label: `${String(classRow?.title || classRow?.id || 'Class').trim()} session`,
          classId: normalizeId(classRow?.id),
          sessionId: normalizeId(sessionRow?.sessionId || sessionRow?.id),
          date,
          startTime,
          endTime
        });
      }

      const roster = Array.isArray(sessionRow?.roster) ? sessionRow.roster : [];
      const rosterHasPerson = roster.some((row) => idsEqual(row?.personId, personId));
      if (rosterHasPerson && !studentExcluded && roles.includes('student')) {
        events.push({
          id: `student-${normalizeId(classRow?.id)}-${normalizeId(sessionRow?.sessionId || sessionRow?.id)}`,
          role: 'student',
          label: `${String(classRow?.title || classRow?.id || 'Class').trim()} session`,
          classId: normalizeId(classRow?.id),
          sessionId: normalizeId(sessionRow?.sessionId || sessionRow?.id),
          date,
          startTime,
          endTime
        });
      }
    });
  }

  return events;
}

async function listRoleAwareActivityScheduleEvents({ activeOrgId, personId, activeRoles, startDate, endDate, reqUser }) {
  const roles = normalizeActiveRoles(activeRoles);
  if (!roles.length) return [];
  const events = await activityService.getScheduleEventsForPerson({
    orgId: activeOrgId,
    personId,
    startDate,
    endDate,
    reqUser
  });
  return (Array.isArray(events) ? events : [])
    .filter((row) => activityEventMatchesRoles(row, roles))
    .map((row) => ({
      id: normalizeId(row?.id),
      role: normalizeRole((Array.isArray(row?.roles) ? row.roles[0] : '') || row?.roleLabel),
      label: String(row?.title || row?.className || 'Activity').trim(),
      classId: normalizeId(row?.classId),
      sessionId: '',
      date: normalizeDate(row?.date),
      startTime: normalizeClockTime(row?.start),
      endTime: normalizeClockTime(row?.end)
    }))
    .filter((row) => row.date && row.startTime && row.endTime);
}

function detectManualOverlapConflicts(candidates = [], scheduleEvents = []) {
  const conflicts = [];
  candidates.forEach((entry, index) => {
    if (entry.isTimed) {
      scheduleEvents.forEach((event) => {
        if (normalizeDate(event?.date) !== normalizeDate(entry?.date)) return;
        if (!hasOverlap(entry?.startTime, entry?.endTime, event?.startTime, event?.endTime)) return;
        conflicts.push(buildConflictRow(entry, event, 'schedule'));
      });
    } else {
      scheduleEvents.forEach((event) => {
        if (normalizeDate(event?.date) !== normalizeDate(entry?.date)) return;
        conflicts.push(buildConflictRow(entry, {
          ...event,
          label: `${event?.label || 'Scheduled event'} (same day)`
        }, 'same_day_schedule'));
      });
    }

    for (let pointer = 0; pointer < candidates.length; pointer += 1) {
      if (pointer === index) continue;
      const other = candidates[pointer];
      if (normalizeDate(other?.date) !== normalizeDate(entry?.date)) continue;
      if (entry.isTimed && other.isTimed) {
        if (!hasOverlap(entry?.startTime, entry?.endTime, other?.startTime, other?.endTime)) continue;
      }
      conflicts.push(buildConflictRow(entry, {
        id: normalizeId(other?.sessionId),
        role: 'manual',
        label: 'Another manual row in this draft',
        date: other?.date,
        startTime: other?.startTime,
        endTime: other?.endTime,
        classId: other?.classId,
        sessionId: other?.sessionId
      }, 'manual_overlap'));
    }
  });
  return conflicts;
}

function detectTimesheetInternalOverlaps(entries = [], { ignoreSessionId = '' } = {}) {
  const candidates = (Array.isArray(entries) ? entries : [])
    .filter((row) => row && row.isDeleted !== true)
    .filter((row) => !ignoreSessionId || normalizeId(row?.sessionId) !== normalizeId(ignoreSessionId))
    .map((row) => normalizeTimesheetOverlapCandidate(row))
    .filter(Boolean);
  const conflicts = [];
  candidates.forEach((entry, index) => {
    for (let pointer = index + 1; pointer < candidates.length; pointer += 1) {
      const other = candidates[pointer];
      if (other.date !== entry.date) continue;
      if (!hasOverlap(entry.startTime, entry.endTime, other.startTime, other.endTime)) continue;
      conflicts.push(buildConflictRow(entry, {
        id: other.sessionId,
        role: 'timesheet',
        label: 'Another timesheet row overlaps this time',
        date: other.date,
        startTime: other.startTime,
        endTime: other.endTime,
        sessionId: other.sessionId
      }, 'timesheet_overlap'));
    }
  });
  return conflicts;
}

function dedupeConflicts(conflicts = []) {
  const seen = new Set();
  return (Array.isArray(conflicts) ? conflicts : []).filter((row) => {
    const key = [
      row.entrySessionId,
      row.conflictType,
      row.conflictDate,
      row.conflictStartTime,
      row.conflictEndTime,
      row.conflictLabel
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function detectRoleAwareManualEntryConflicts({
  activeOrgId = '',
  personId = '',
  activeRoles = [],
  startDate = '',
  endDate = '',
  candidateEntries = [],
  draftEntries = [],
  timesheetEntries = [],
  ignoreSessionId = '',
  reqUser
} = {}) {
  const normalizedPersonId = normalizeId(personId);
  const normalizedOrgId = normalizeId(activeOrgId);
  const periodStart = normalizeDate(startDate);
  const periodEnd = normalizeDate(endDate);
  const candidates = (Array.isArray(candidateEntries) ? candidateEntries : [])
    .map((row, index) => normalizeManualConflictCandidate(row, { provisionalSessionId: `candidate-${index}` }))
    .filter(Boolean);
  if (!normalizedPersonId || !normalizedOrgId || !periodStart || !periodEnd || !candidates.length) {
    return detectTimesheetInternalOverlaps(timesheetEntries, { ignoreSessionId });
  }

  const roles = normalizeActiveRoles(activeRoles);
  if (!roles.length) return dedupeConflicts(detectTimesheetInternalOverlaps(timesheetEntries, { ignoreSessionId }));

  const [classEvents, activityEvents] = await Promise.all([
    listClassSessionScheduleEvents({
      activeOrgId: normalizedOrgId,
      personId: normalizedPersonId,
      activeRoles: roles,
      startDate: periodStart,
      endDate: periodEnd,
      reqUser
    }),
    listRoleAwareActivityScheduleEvents({
      activeOrgId: normalizedOrgId,
      personId: normalizedPersonId,
      activeRoles: roles,
      startDate: periodStart,
      endDate: periodEnd,
      reqUser
    })
  ]);

  const draftManualCandidates = (Array.isArray(draftEntries) ? draftEntries : [])
    .filter((row) => row?.isManual === true && row?.isDeleted !== true)
    .filter((row) => !ignoreSessionId || normalizeId(row?.sessionId) !== normalizeId(ignoreSessionId))
    .map((row, index) => normalizeManualConflictCandidate(row, { provisionalSessionId: `draft-${index}` }))
    .filter(Boolean);

  const mergedCandidates = [...draftManualCandidates];
  candidates.forEach((row) => {
    if (!mergedCandidates.some((item) => item.sessionId === row.sessionId)) mergedCandidates.push(row);
  });

  const scheduleConflicts = detectManualOverlapConflicts(mergedCandidates, [...classEvents, ...activityEvents]);
  const timedCandidates = mergedCandidates.filter((row) => row.isTimed);
  const leaveWindows = timedCandidates.map((entry, index) => ({
    sessionIndex: index,
    personId: normalizedPersonId,
    personName: normalizedPersonId,
    date: entry.date,
    startTime: entry.startTime,
    endTime: entry.endTime
  }));
  const leaveConflicts = await leaveRequestService.findApprovedLeaveConflicts({
    orgId: normalizedOrgId,
    windows: leaveWindows,
    reqUser
  });
  leaveConflicts.forEach((leaveConflict) => {
    const sessionIndex = Number(leaveConflict?.sessionIndex);
    const entry = timedCandidates[Number.isInteger(sessionIndex) ? sessionIndex : -1];
    if (!entry) return;
    scheduleConflicts.push(buildConflictRow(entry, {
      id: normalizeId(leaveConflict?.leaveRequestId),
      role: 'leave',
      label: 'Approved leave request',
      date: entry.date,
      startTime: leaveConflict?.startTime,
      endTime: leaveConflict?.endTime
    }, 'approved_leave'));
  });

  const internalConflicts = detectTimesheetInternalOverlaps(timesheetEntries, { ignoreSessionId });
  return dedupeConflicts([...scheduleConflicts, ...internalConflicts]);
}

module.exports = {
  detectRoleAwareManualEntryConflicts,
  detectTimesheetInternalOverlaps,
  normalizeManualConflictCandidate,
  normalizeClockTime
};
