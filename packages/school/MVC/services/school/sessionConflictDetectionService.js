const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const leaveRequestService = require('./leaveRequestService');
const activityService = require('./activityService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const scheduleController = require('../../controllers/school/scheduleController');
const schoolRepositories = require('../../repositories/school');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const reportAssignmentSessionUtils = requireCoreModule('MVC/utils/reportAssignmentSessionUtils');

function cleanPersonId(id) {
  return toPublicId(id);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function normalizeDateOnlyValue(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function normalizeClockTime(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  const match = token.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hh = String(Math.max(0, Math.min(23, Number(match[1] || 0)))).padStart(2, '0');
  const mm = String(Math.max(0, Math.min(59, Number(match[2] || 0)))).padStart(2, '0');
  return `${hh}:${mm}`;
}

function resolveSessionTeacherId(sessionRow = {}, fallbackTeacherId = '') {
  return cleanPersonId(
    sessionRow?.delivery?.deliveredBy
    || sessionRow?.deliveredBy
    || sessionRow?.teacherId
    || sessionRow?.instructorId
    || fallbackTeacherId
  );
}

async function buildTeacherIdentityLookup({ activeOrgId = '', reqUser } = {}) {
  const rows = await schoolDataService.fetchData('teachers', {}, reqUser).catch(() => []);
  const teacherToPerson = new Map();
  const personToTeacherIds = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (activeOrgId && row?.orgId && !idsEqual(row.orgId, activeOrgId)) return;
    const teacherId = cleanPersonId(row?.id);
    const personId = cleanPersonId(row?.personId);
    if (!personId) return;
    if (teacherId) teacherToPerson.set(teacherId, personId);
    if (!personToTeacherIds.has(personId)) personToTeacherIds.set(personId, new Set());
    if (teacherId) personToTeacherIds.get(personId).add(teacherId);
  });
  return { teacherToPerson, personToTeacherIds };
}

function resolveTeacherPersonId(value, teacherIdentityLookup = {}) {
  const clean = cleanPersonId(value);
  if (!clean) return '';
  return teacherIdentityLookup?.teacherToPerson?.get(clean) || clean;
}

function clockTimeToMinutes(value) {
  const normalized = normalizeClockTime(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(':').map(Number);
  return (hour * 60) + minute;
}

function clockWindowsOverlap(aStart, aEnd, bStart, bEnd) {
  const aStartMinutes = clockTimeToMinutes(aStart);
  const aEndMinutes = clockTimeToMinutes(aEnd);
  const bStartMinutes = clockTimeToMinutes(bStart);
  const bEndMinutes = clockTimeToMinutes(bEnd);
  if ([aStartMinutes, aEndMinutes, bStartMinutes, bEndMinutes].some((value) => !Number.isInteger(value))) return false;
  if (aEndMinutes <= aStartMinutes || bEndMinutes <= bStartMinutes) return false;
  return aStartMinutes < bEndMinutes && aEndMinutes > bStartMinutes;
}

function getSessionByIdFromMap(classSessionsById = new Map(), classId = '', sessionId = '') {
  const normalizedClassId = toPublicId(classId);
  const normalizedSessionId = toPublicId(sessionId);
  if (!normalizedClassId || !normalizedSessionId) return null;
  const sessions = classSessionsById.get(normalizedClassId) || [];
  return (Array.isArray(sessions) ? sessions : [])
    .find((row) => idsEqual(row?.sessionId || row?.id, normalizedSessionId)) || null;
}

function resolveReportAssignmentConflictDate(assignment = {}, classSessionsById = new Map()) {
  const explicitDate = normalizeDateOnlyValue(reportAssignmentSessionUtils.resolveAssignmentTargetDate(assignment));
  if (explicitDate) return explicitDate;
  const sourceSession = getSessionByIdFromMap(classSessionsById, assignment?.classId, assignment?.sessionId);
  return normalizeDateOnlyValue(sourceSession?.date);
}

function resolveReportAssignmentConflictWindow(assignment = {}, classSessionsById = new Map()) {
  const start = normalizeClockTime(assignment?.taskStartTime);
  const end = normalizeClockTime(assignment?.taskEndTime);
  if (start && end) return { start, end };

  const sourceSession = getSessionByIdFromMap(classSessionsById, assignment?.classId, assignment?.sessionId);
  return {
    start: normalizeClockTime(sourceSession?.startTime),
    end: normalizeClockTime(sourceSession?.endTime)
  };
}

function buildReportAssignmentLabel(assignment = {}, classIdTitleMap = new Map()) {
  const classTitle = classIdTitleMap.get(toPublicId(assignment?.classId)) || toPublicId(assignment?.classId) || 'Class';
  const assignmentId = toPublicId(assignment?.id);
  const target = toPublicId(assignment?.assignmentRowId || assignment?.rowId || assignment?.sessionId || assignment?.dueDate);
  return `Report: ${classTitle}${assignmentId ? ` ${assignmentId}` : ''}${target ? ` (${target})` : ''}`;
}

function dedupeSessionConflictRows(conflicts = []) {
  const seen = new Set();
  return (Array.isArray(conflicts) ? conflicts : []).filter((row) => {
    const key = [
      row?.sessionIndex,
      row?.date,
      row?.teacherName,
      row?.conflictClass,
      row?.existTime,
      row?.conflictType
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function appendActivitySessionConflicts({
  conflicts,
  session,
  sessionIndex,
  activeOrgId,
  reqUser
}) {
  const teacherId = cleanPersonId(session?.resolvedPersonId);
  const date = normalizeDateOnlyValue(session?.date);
  const startTime = normalizeClockTime(session?.startTime);
  const endTime = normalizeClockTime(session?.endTime);
  if (!teacherId || !date || !startTime || !endTime) return;

  const activityEvents = await activityService.getScheduleEventsForPerson({
    orgId: activeOrgId,
    personId: teacherId,
    startDate: date,
    endDate: date,
    reqUser
  });

  (Array.isArray(activityEvents) ? activityEvents : []).forEach((event) => {
    const eventDate = normalizeDateOnlyValue(event?.date);
    const eventStart = normalizeClockTime(event?.start || event?.startTime);
    const eventEnd = normalizeClockTime(event?.end || event?.endTime);
    if (eventDate !== date || !clockWindowsOverlap(startTime, endTime, eventStart, eventEnd)) return;

    const label = String(event?.title || event?.className || 'Work session').trim();
    conflicts.push({
      sessionIndex,
      date,
      teacherName: session?.delivery?.deliveredByName || teacherId,
      conflictClass: `Activity: ${label}`,
      existTime: `${eventStart} - ${eventEnd}`,
      conflictType: 'activity_work_session',
      activityId: toPublicId(event?.activityId),
      activityEntryId: toPublicId(event?.activityEntryId)
    });
  });
}

async function appendReportAssignmentConflicts({
  conflicts,
  session,
  sessionIndex,
  activeOrgId,
  classSessionsById,
  classIdTitleMap,
  teacherIdentityLookup
}) {
  const teacherId = cleanPersonId(session?.resolvedPersonId);
  const date = normalizeDateOnlyValue(session?.date);
  const startTime = normalizeClockTime(session?.startTime);
  const endTime = normalizeClockTime(session?.endTime);
  if (!teacherId || !date || !startTime || !endTime) return;

  const assignments = await schoolRepositories.reportAssignments.list({
    query: {},
    scope: { canViewAll: true }
  });

  const expandedAssignments = [];
  (Array.isArray(assignments) ? assignments : []).forEach((assignment) => {
    if (activeOrgId && !idsEqual(assignment?.orgId, activeOrgId)) return;
    if (String(assignment?.status || '').trim().toLowerCase() !== 'active') return;
    const rows = reportAssignmentSessionUtils.getEffectiveTargetRows(assignment);
    (rows.length ? rows : [{}]).forEach((row) => {
      if (String(row?.status || 'active').trim().toLowerCase() !== 'active') return;
      expandedAssignments.push(reportAssignmentSessionUtils.applyTargetRow(assignment, row));
    });
  });

  expandedAssignments.forEach((assignment) => {
    if (parseBoolean(assignment?.conflictPermitted, false)) return;
    const teacherIds = Array.isArray(assignment?.teacherIds)
      ? assignment.teacherIds.map((id) => resolveTeacherPersonId(id, teacherIdentityLookup)).filter(Boolean)
      : [];
    if (!teacherIds.includes(teacherId)) return;

    const reportDate = resolveReportAssignmentConflictDate(assignment, classSessionsById);
    if (reportDate !== date) return;

    const window = resolveReportAssignmentConflictWindow(assignment, classSessionsById);
    if (!clockWindowsOverlap(startTime, endTime, window.start, window.end)) return;

    conflicts.push({
      sessionIndex,
      date,
      teacherName: session?.delivery?.deliveredByName || teacherId,
      conflictClass: buildReportAssignmentLabel(assignment, classIdTitleMap),
      existTime: `${window.start} - ${window.end}`,
      conflictType: 'report_assignment',
      reportAssignmentId: toPublicId(assignment?.id),
      reportAssignmentRowId: toPublicId(assignment?.assignmentRowId || assignment?.rowId)
    });
  });
}

async function detectSessionConflicts({
  classId = '',
  sessions = [],
  activeOrgId = '',
  reqUser,
  fallbackTeacherId = '',
  includeExternalScheduleConflicts = false,
  externalFocusSessionIds = []
}) {
  const parsedSessions = Array.isArray(sessions) ? sessions : [];
  const statusMap = await sessionStatusPolicyService.getStatusMap(activeOrgId, { includeInactive: true });
  const teacherIdentityLookup = await buildTeacherIdentityLookup({ activeOrgId, reqUser });
  const allClasses = await schoolDataService.fetchData('classes', {}, reqUser);
  const scopedClasses = (Array.isArray(allClasses) ? allClasses : []).filter((row) => {
    if (!activeOrgId) return true;
    return idsEqual(row?.orgId, activeOrgId);
  });
  const classIdTitleMap = new Map(
    scopedClasses.map((row) => [toPublicId(row?.id), String(row?.title || row?.id || '').trim()])
  );
  const classSessionsBundle = await Promise.all(
    scopedClasses.map(async (row) => ({
      classId: toPublicId(row?.id),
      sessions: await schoolDataService.getClassSessions(row?.id, reqUser)
    }))
  );
  const classSessionsById = new Map(
    classSessionsBundle.map((bundle) => [toPublicId(bundle?.classId), Array.isArray(bundle?.sessions) ? bundle.sessions : []])
  );
  const teacherDayMap = new Map();
  classSessionsBundle.forEach((bundle) => {
    const sourceClassId = String(bundle?.classId || '').trim();
    const sourceClassRow = scopedClasses.find((row) => idsEqual(row?.id, sourceClassId));
    const classFallbackTeacherId = cleanPersonId(sourceClassRow?.instructors?.[0]?.personId);
    const sessionRows = Array.isArray(bundle?.sessions) ? bundle.sessions : [];
    sessionRows.forEach((sessionRow) => {
      if (sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap(statusMap, {
        status: sessionRow?.status,
        notes: sessionRow?.notes
      })) return;
      const tid = resolveTeacherPersonId(resolveSessionTeacherId(sessionRow, classFallbackTeacherId), teacherIdentityLookup);
      const date = String(sessionRow?.date || '').trim();
      const startTime = String(sessionRow?.startTime || '').trim();
      const endTime = String(sessionRow?.endTime || '').trim();
      if (!tid || !date || !startTime || !endTime) return;
      const key = `${tid}::${date}`;
      if (!teacherDayMap.has(key)) teacherDayMap.set(key, []);
      teacherDayMap.get(key).push({
        classId: sourceClassId,
        startTime,
        endTime
      });
    });
  });
  const conflicts = [];

  const normalizedSessions = parsedSessions.map((session, index) => ({
    ...session,
    _rowIndex: index,
    resolvedPersonId: resolveTeacherPersonId(resolveSessionTeacherId(session, fallbackTeacherId), teacherIdentityLookup)
  }));

  const leaveConflictWindows = normalizedSessions
    .filter((ses) => !sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap(statusMap, {
      status: ses?.status,
      notes: ses?.notes
    }))
    .filter((ses) => ses.resolvedPersonId && ses.date && ses.startTime && ses.endTime)
    .map((ses) => ({
      sessionIndex: ses._rowIndex,
      personId: ses.resolvedPersonId,
      personName: ses?.delivery?.deliveredByName || ses.resolvedPersonId,
      date: ses.date,
      startTime: ses.startTime,
      endTime: ses.endTime
    }));

  const leaveConflicts = await leaveRequestService.findApprovedLeaveConflicts({
    orgId: activeOrgId,
    windows: leaveConflictWindows,
    reqUser
  });
  leaveConflicts.forEach((conflict) => {
    conflicts.push({
      sessionIndex: conflict.sessionIndex,
      date: conflict.date,
      teacherName: conflict.personName || conflict.personId,
      conflictClass: 'Approved leave request',
      existTime: conflict.leaveLabel || `${conflict.startTime || ''}${conflict.endTime ? ` - ${conflict.endTime}` : ''}`,
      conflictType: 'approved_leave',
      leaveRequestId: conflict.leaveRequestId
    });
  });

  if (classId) {
    const targetClassRow = scopedClasses.find((row) => idsEqual(row?.id, classId)) || null;
    const sessionDates = normalizedSessions.map((ses) => ses.date).filter(Boolean);
    const activeRosterResult = await classEnrollmentReadService.listActiveStudentIdsForClass({
      classId,
      classItem: targetClassRow,
      reqUser,
      activeOrgId,
      sessionDates
    });
    const activeStudentIds = activeRosterResult?.studentIds instanceof Set
      ? [...activeRosterResult.studentIds]
      : [];
    if (activeStudentIds.length) {
      const allStudents = await schoolDataService.fetchData('students', {}, reqUser);
      const studentPersonMap = new Map(
        (Array.isArray(allStudents) ? allStudents : [])
          .map((student) => [
            toPublicId(student?.id),
            {
              personId: toPublicId(student?.personId),
              name: [student?.firstName, student?.lastName].map((part) => String(part || '').trim()).filter(Boolean).join(' ') || toPublicId(student?.id)
            }
          ])
          .filter(([studentId, info]) => Boolean(studentId && info.personId))
      );
      const studentLeaveWindows = [];
      normalizedSessions
        .filter((ses) => !sessionStatusPolicyService.shouldExcludeFromStudentIndexByMap(statusMap, {
          status: ses?.status,
          notes: ses?.notes
        }))
        .filter((ses) => ses.date && ses.startTime && ses.endTime)
        .forEach((ses) => {
          activeStudentIds.forEach((studentId) => {
            const info = studentPersonMap.get(toPublicId(studentId));
            if (!info?.personId) return;
            studentLeaveWindows.push({
              sessionIndex: ses._rowIndex,
              personId: info.personId,
              personName: info.name,
              date: ses.date,
              startTime: ses.startTime,
              endTime: ses.endTime
            });
          });
        });
      const studentLeaveConflicts = await leaveRequestService.findApprovedLeaveConflicts({
        orgId: activeOrgId,
        windows: studentLeaveWindows,
        reqUser
      });
      studentLeaveConflicts.forEach((conflict) => {
        conflicts.push({
          sessionIndex: conflict.sessionIndex,
          date: conflict.date,
          teacherName: conflict.personName || conflict.personId,
          conflictClass: 'Student approved leave request',
          existTime: conflict.leaveLabel || `${conflict.startTime || ''}${conflict.endTime ? ` - ${conflict.endTime}` : ''}`,
          conflictType: 'student_approved_leave',
          leaveRequestId: conflict.leaveRequestId
        });
      });
    }
  }

  normalizedSessions.forEach((ses, index) => {
    if (sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap(statusMap, {
      status: ses?.status,
      notes: ses?.notes
    })) return;

    const tid = ses.resolvedPersonId;
    if (!tid || !ses.date || !ses.startTime || !ses.endTime) return;

    const newStart = new Date(`${ses.date}T${ses.startTime}`);
    const newEnd = new Date(`${ses.date}T${ses.endTime}`);
    if (Number.isNaN(newStart.getTime()) || Number.isNaN(newEnd.getTime())) return;

    const teacherDay = teacherDayMap.get(`${tid}::${ses.date}`) || [];
    teacherDay.forEach((existingSes) => {
      if (classId && idsEqual(existingSes.classId, classId)) return;

      const existStart = new Date(`${ses.date}T${existingSes.startTime}`);
      const existEnd = new Date(`${ses.date}T${existingSes.endTime}`);
      if (Number.isNaN(existStart.getTime()) || Number.isNaN(existEnd.getTime())) return;

      if (newStart < existEnd && newEnd > existStart) {
        const conflictClassTitle = classIdTitleMap.get(toPublicId(existingSes.classId)) || existingSes.classId;
        conflicts.push({
          sessionIndex: index,
          date: ses.date,
          teacherName: ses?.delivery?.deliveredByName || tid,
          conflictClass: conflictClassTitle,
          existTime: `${existingSes.startTime} - ${existingSes.endTime}`,
          conflictType: 'teacher_schedule'
        });
      }
    });

    for (let j = 0; j < normalizedSessions.length; j++) {
      if (index === j) continue;
      const otherSes = normalizedSessions[j];

      if (sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap(statusMap, {
        status: otherSes?.status,
        notes: otherSes?.notes
      })) continue;
      if (otherSes.resolvedPersonId !== tid || otherSes.date !== ses.date) continue;
      if (!otherSes.startTime || !otherSes.endTime) continue;

      const otherStart = new Date(`${otherSes.date}T${otherSes.startTime}`);
      const otherEnd = new Date(`${otherSes.date}T${otherSes.endTime}`);
      if (Number.isNaN(otherStart.getTime()) || Number.isNaN(otherEnd.getTime())) continue;

      if (newStart < otherEnd && newEnd > otherStart) {
        conflicts.push({
          sessionIndex: index,
          date: ses.date,
          teacherName: ses?.delivery?.deliveredByName || tid,
          conflictClass: 'Another unsaved session in this list',
          existTime: `${otherSes.startTime} - ${otherSes.endTime}`,
          conflictType: 'teacher_schedule'
        });
      }
    }
  });

  if (includeExternalScheduleConflicts) {
    const focusedSessionIds = new Set(
      (Array.isArray(externalFocusSessionIds) ? externalFocusSessionIds : [])
        .map((id) => toPublicId(id))
        .filter(Boolean)
    );
    for (let index = 0; index < normalizedSessions.length; index += 1) {
      const ses = normalizedSessions[index];
      const normalizedSessionId = toPublicId(ses?.sessionId || ses?.id);
      if (focusedSessionIds.size && !focusedSessionIds.has(normalizedSessionId)) continue;
      if (sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap(statusMap, {
        status: ses?.status,
        notes: ses?.notes
      })) continue;

      // eslint-disable-next-line no-await-in-loop
      await appendActivitySessionConflicts({
        conflicts,
        session: ses,
        sessionIndex: index,
        activeOrgId,
        reqUser
      });
      // eslint-disable-next-line no-await-in-loop
      await appendReportAssignmentConflicts({
        conflicts,
        session: ses,
        sessionIndex: index,
        activeOrgId,
        classSessionsById,
        classIdTitleMap,
        teacherIdentityLookup
      });
    }
  }

  return dedupeSessionConflictRows(conflicts);
}

function buildStudentPersonEntries(studentPersonIds = [], studentPersonMap = new Map()) {
  const entries = [];
  const seen = new Set();
  (Array.isArray(studentPersonIds) ? studentPersonIds : []).forEach((row) => {
    const personId = cleanPersonId(row?.personId || row);
    const studentId = toPublicId(row?.studentId || '');
    if (!personId || seen.has(personId)) return;
    seen.add(personId);
    const fromMap = studentId ? studentPersonMap.get(studentId) : null;
    entries.push({
      personId,
      studentId,
      name: row?.name || fromMap?.name || personId
    });
  });
  return entries;
}

async function detectStudentScheduleConflicts({
  orgId = '',
  classId = '',
  proposedSessions = [],
  studentPersonEntries = [],
  reqUser
} = {}) {
  const sessions = Array.isArray(proposedSessions) ? proposedSessions : [];
  const entries = Array.isArray(studentPersonEntries) ? studentPersonEntries : [];
  if (!sessions.length || !entries.length) return [];

  const dates = sessions.map((row) => normalizeDateOnlyValue(row?.date)).filter(Boolean);
  if (!dates.length) return [];

  const startDate = dates.reduce((min, d) => (min < d ? min : d));
  const endDate = dates.reduce((max, d) => (max > d ? max : d));
  const normalizedClassId = toPublicId(classId);
  const conflicts = [];

  for (const entry of entries) {
  // eslint-disable-next-line no-await-in-loop
    const scheduleResult = await scheduleController.buildEventsForPersonAndRange({
      personId: entry.personId,
      startDate,
      endDate,
      reqUser,
      activeOrgId: orgId
    });
    const studentEvents = scheduleController.filterScheduleEventsForRole(scheduleResult?.events, 'student');

    sessions.forEach((session, sessionIndex) => {
      const date = normalizeDateOnlyValue(session?.date);
      const startTime = normalizeClockTime(session?.startTime);
      const endTime = normalizeClockTime(session?.endTime);
      if (!date || !startTime || !endTime) return;

      studentEvents.forEach((event) => {
        const eventDate = normalizeDateOnlyValue(event?.date);
        const eventStart = normalizeClockTime(event?.start || event?.startTime);
        const eventEnd = normalizeClockTime(event?.end || event?.endTime);
        if (eventDate !== date || !clockWindowsOverlap(startTime, endTime, eventStart, eventEnd)) return;

        const eventClassId = toPublicId(event?.classId || event?.sourceClassId || '');
        if (normalizedClassId && eventClassId && idsEqual(eventClassId, normalizedClassId)) return;

        const label = String(event?.title || event?.className || event?.classTitle || 'Class session').trim();
        conflicts.push({
          sessionIndex,
          date,
          teacherName: entry.name || entry.personId,
          conflictClass: label,
          existTime: `${eventStart} - ${eventEnd}`,
          conflictType: 'student_schedule',
          personId: entry.personId,
          studentId: entry.studentId || ''
        });
      });
    });
  }

  return dedupeSessionConflictRows(conflicts);
}

async function evaluateEnrollmentGapBatchConflicts({
  classData = {},
  proposedSessions = [],
  teacherId = '',
  enrollingStudentId = '',
  reqUser
} = {}) {
  const classId = toPublicId(classData?.id);
  const activeOrgId = String(classData?.orgId || reqUser?.activeOrgId || '').trim();
  const fallbackTeacherId = cleanPersonId(teacherId);

  const teacherConflicts = await detectSessionConflicts({
    classId,
    sessions: proposedSessions,
    activeOrgId,
    reqUser,
    fallbackTeacherId,
    includeExternalScheduleConflicts: true
  });

  const sessionDates = (Array.isArray(proposedSessions) ? proposedSessions : [])
    .map((row) => normalizeDateOnlyValue(row?.date))
    .filter(Boolean);

  const activeRosterResult = await classEnrollmentReadService.listActiveStudentIdsForClass({
    classId,
    classItem: classData,
    reqUser,
    activeOrgId,
    sessionDates
  });
  const rosterStudentIds = activeRosterResult?.studentIds instanceof Set
    ? [...activeRosterResult.studentIds]
    : [];

  const allStudents = await schoolDataService.fetchData('students', {}, reqUser);
  const studentRows = Array.isArray(allStudents) ? allStudents : [];
  const studentPersonMap = new Map(
    studentRows
      .map((student) => [
        toPublicId(student?.id),
        {
          personId: toPublicId(student?.personId),
          name: [student?.firstName, student?.lastName].map((part) => String(part || '').trim()).filter(Boolean).join(' ') || toPublicId(student?.id)
        }
      ])
      .filter(([studentId, info]) => Boolean(studentId && info.personId))
  );

  const enrollingStudentToken = toPublicId(enrollingStudentId);
  const rosterEntries = rosterStudentIds
    .map((studentId) => {
      const sid = toPublicId(studentId);
      const info = studentPersonMap.get(sid);
      if (!info?.personId) return null;
      return { studentId: sid, personId: info.personId, name: info.name };
    })
    .filter(Boolean);

  const enrollingEntry = enrollingStudentToken
    ? (() => {
      const info = studentPersonMap.get(enrollingStudentToken);
      if (!info?.personId) return null;
      return { studentId: enrollingStudentToken, personId: info.personId, name: info.name };
    })()
    : null;

  const rosterStudentConflicts = await detectStudentScheduleConflicts({
    orgId: activeOrgId,
    classId,
    proposedSessions,
    studentPersonEntries: rosterEntries,
    reqUser
  });

  const enrollingStudentConflicts = enrollingEntry
    ? await detectStudentScheduleConflicts({
      orgId: activeOrgId,
      classId,
      proposedSessions,
      studentPersonEntries: [enrollingEntry],
      reqUser
    })
    : [];

  const allConflicts = dedupeSessionConflictRows([
    ...teacherConflicts,
    ...rosterStudentConflicts,
    ...enrollingStudentConflicts
  ]);

  return {
    teacherConflicts,
    rosterStudentConflicts,
    enrollingStudentConflicts,
    allConflicts,
    hasConflicts: allConflicts.length > 0
  };
}

function buildConflictBlockingMessage(conflicts = []) {
  if (!Array.isArray(conflicts) || !conflicts.length) return '';
  const lines = conflicts.slice(0, 5).map((c) =>
    `${c.date}: ${c.teacherName} overlaps ${c.conflictClass} (${c.existTime})`
  );
  const suffix = conflicts.length > 5 ? ` (+${conflicts.length - 5} more)` : '';
  return `Scheduling conflicts detected. Resolve the session overlaps before saving. ${lines.join(' | ')}${suffix}`;
}

const TEACHER_CONFLICT_TYPES = new Set([
  'teacher_schedule',
  'approved_leave',
  'activity_work_session',
  'report_assignment'
]);

function sessionScheduleKey(session = {}) {
  return [
    normalizeDateOnlyValue(session?.date),
    normalizeClockTime(session?.startTime || session?.start),
    normalizeClockTime(session?.endTime || session?.end)
  ].join('|');
}

function dateInStudentWindow(date, windowStart, windowEnd) {
  const day = normalizeDateOnlyValue(date);
  const start = normalizeDateOnlyValue(windowStart);
  const end = normalizeDateOnlyValue(windowEnd) || '9999-12-31';
  return Boolean(day && start && start <= day && end >= day);
}

/**
 * Pure builder for Plan A conflict-review UI payload.
 * studentWindows: [{ studentId, displayName, role, windowStart, windowEnd }]
 */
function buildEnrollmentGapConflictReview({
  stagedSessions = [],
  conflictResult = {},
  studentWindows = []
} = {}) {
  const sessions = Array.isArray(stagedSessions) ? stagedSessions : [];
  const windows = Array.isArray(studentWindows) ? studentWindows : [];
  const teacherConflicts = (Array.isArray(conflictResult?.teacherConflicts) ? conflictResult.teacherConflicts : [])
    .filter((row) => TEACHER_CONFLICT_TYPES.has(String(row?.conflictType || '').trim()));
  const studentConflictRows = [
    ...(Array.isArray(conflictResult?.rosterStudentConflicts) ? conflictResult.rosterStudentConflicts : []),
    ...(Array.isArray(conflictResult?.enrollingStudentConflicts) ? conflictResult.enrollingStudentConflicts : [])
  ];
  const studentLeaveConflicts = (Array.isArray(conflictResult?.teacherConflicts) ? conflictResult.teacherConflicts : [])
    .filter((row) => String(row?.conflictType || '').trim() === 'student_approved_leave');

  const conflictsByStudentAndKey = new Map();
  studentConflictRows.forEach((row) => {
    const studentId = toPublicId(row?.studentId || '');
    if (!studentId) return;
    const key = [
      normalizeDateOnlyValue(row?.date),
      String(row?.sessionIndex ?? '')
    ].join('|');
    const list = conflictsByStudentAndKey.get(studentId) || [];
    list.push({ ...row, _matchKey: key });
    conflictsByStudentAndKey.set(studentId, list);
  });

  const students = windows.map((windowRow) => {
    const studentId = toPublicId(windowRow?.studentId || '');
    const displayName = String(windowRow?.displayName || studentId).trim();
    const windowStart = normalizeDateOnlyValue(windowRow?.windowStart);
    const windowEnd = normalizeDateOnlyValue(windowRow?.windowEnd) || '9999-12-31';
    const studentConflicts = [
      ...(conflictsByStudentAndKey.get(studentId) || []),
      ...studentLeaveConflicts.filter((row) => {
        const leaveName = String(row?.teacherName || '').trim().toLowerCase();
        return leaveName && leaveName === displayName.toLowerCase();
      })
    ];
    const allowedSessions = sessions
      .map((session, sessionIndex) => {
        const date = normalizeDateOnlyValue(session?.date);
        const startTime = normalizeClockTime(session?.startTime || session?.start);
        const endTime = normalizeClockTime(session?.endTime || session?.end);
        if (!dateInStudentWindow(date, windowStart, windowEnd)) return null;
        const matched = studentConflicts.find((row) => Number(row?.sessionIndex) === sessionIndex)
          || studentConflicts.find((row) => normalizeDateOnlyValue(row?.date) === date);
        return {
          sessionId: String(session?.sessionId || '').trim(),
          date,
          startTime,
          endTime,
          hasConflict: Boolean(matched),
          conflictType: matched ? String(matched.conflictType || '') : '',
          conflictDetail: matched
            ? `${matched.conflictClass || 'Conflict'} (${matched.existTime || ''})`.trim()
            : ''
        };
      })
      .filter(Boolean);

    return {
      studentId,
      displayName,
      role: windowRow?.role === 'enrolling' ? 'enrolling' : 'enrolled',
      windowStart,
      windowEnd,
      sessions: allowedSessions,
      hasConflicts: allowedSessions.some((row) => row.hasConflict)
    };
  });

  const hasStudentConflicts = students.some((row) => row.hasConflicts);
  const hasTeacherConflicts = teacherConflicts.length > 0;

  return {
    hasConflicts: hasStudentConflicts || hasTeacherConflicts,
    teacherConflicts,
    students,
    stagedSessionCount: sessions.length
  };
}

module.exports = {
  detectSessionConflicts,
  detectStudentScheduleConflicts,
  evaluateEnrollmentGapBatchConflicts,
  buildEnrollmentGapConflictReview,
  buildConflictBlockingMessage,
  buildTeacherIdentityLookup,
  resolveTeacherPersonId,
  resolveSessionTeacherId,
  dedupeSessionConflictRows,
  TEACHER_CONFLICT_TYPES,
  sessionScheduleKey
};
