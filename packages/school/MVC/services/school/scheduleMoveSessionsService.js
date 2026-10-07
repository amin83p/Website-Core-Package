'use strict';

const crypto = require('crypto');
const schoolDataService = require('./schoolDataService');
const schoolRepositories = require('../../repositories/school');
const classSessionCapacityService = require('./classSessionCapacityService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const enrollmentMoveService = require('./enrollmentMoveService');
const sessionIdService = require('./sessionIdService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const OPEN_STATUSES = new Set(['draft', 'planned', 'to_be_confirmed', 'waiting_list', 'active']);

let dependencies = {
  schoolDataService,
  schoolRepositories,
  classSessionCapacityService,
  classEnrollmentSessionApplicabilityService,
  enrollmentMoveService,
  sessionIdService
};

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  return '';
}

function addDaysIso(dateStr, days) {
  const date = normalizeDateOnly(dateStr);
  if (!date) return '';
  const [year, month, day] = date.split('-').map(Number);
  const cursor = new Date(year, month - 1, day);
  cursor.setDate(cursor.getDate() + Number(days || 0));
  const nextMonth = String(cursor.getMonth() + 1).padStart(2, '0');
  const nextDay = String(cursor.getDate()).padStart(2, '0');
  return `${cursor.getFullYear()}-${nextMonth}-${nextDay}`;
}

function timeToMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return NaN;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function minutesToTime(total) {
  const minutes = Math.max(0, Math.floor(Number(total) || 0));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function sessionIdentity(session = {}) {
  return toPublicId(session.sessionId || session.id || '');
}

function sessionDate(session = {}) {
  return normalizeDateOnly(session.date || session.sessionDate || session.startDate);
}

function sessionStart(session = {}) {
  return String(session.startTime || session.start || '').trim();
}

function sessionEnd(session = {}) {
  return String(session.endTime || session.end || '').trim();
}

function durationMinutes(session = {}) {
  const start = timeToMinutes(sessionStart(session));
  const end = timeToMinutes(sessionEnd(session));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return end - start;
}

function isRollingClass(classRow) {
  return dependencies.classSessionCapacityService.getClassRegistrationModeKey(classRow) === 'rolling';
}

function isClosedForNewEnrollment(classRow) {
  return classRow?.isClosedForNewEnrollment === true
    || String(classRow?.isClosedForNewEnrollment || '').trim().toLowerCase() === 'true';
}

function evaluateCapacityGate({
  sourceClass,
  targetClass
} = {}) {
  const blockers = [];
  if (!targetClass) {
    blockers.push({ code: 'TARGET_CLASS_REQUIRED', message: 'Choose a target class.' });
    return blockers;
  }
  if (!isRollingClass(targetClass)) {
    blockers.push({ code: 'TARGET_NOT_ROLLING', message: 'Target class must use rolling enrollment.' });
  }
  if (sourceClass && !idsEqual(targetClass.orgId, sourceClass.orgId)) {
    blockers.push({ code: 'ORG_MISMATCH', message: 'Target class must belong to the same organization.' });
  }
  if (sourceClass && idsEqual(targetClass.id, sourceClass.id)) {
    blockers.push({ code: 'SAME_CLASS', message: 'Choose a different class than the one you selected sessions from.' });
  }
  if (isClosedForNewEnrollment(targetClass)) {
    blockers.push({ code: 'TARGET_CLOSED', message: 'Target class cycle is closed for new enrollment.' });
  }
  const sourceCapacity = dependencies.classSessionCapacityService.resolveClassMaxCapacity(sourceClass || {});
  const targetCapacity = dependencies.classSessionCapacityService.resolveClassMaxCapacity(targetClass);
  if (sourceCapacity === 1 && targetCapacity !== 1) {
    blockers.push({
      code: 'CAPACITY_MISMATCH',
      message: 'The original class has capacity 1, so the target class must also have capacity 1.'
    });
  }
  return blockers;
}

function sessionBlockerMessage(code, count, targetCapacity) {
  const these = count === 1 ? 'This session' : 'These sessions';
  switch (code) {
    case 'INVALID_DURATION':
      return `${these} ${count === 1 ? 'does' : 'do'} not have a valid start and end time.`;
    case 'END_TIME_OVERFLOW':
      return `${these} would end after midnight with this start time.`;
    case 'OUT_OF_CYCLE':
      return `${these} ${count === 1 ? 'is' : 'are'} outside the target class cycle.`;
    case 'TIME_MISMATCH':
      return count === 1
        ? 'The target class already has a session on this date in this time range, but the start time or length does not match. Resolve that session before continuing.'
        : 'The target class already has sessions in this time range on these dates, but the start time or length does not match. Resolve those sessions before continuing.';
    case 'OCCUPIED_ONE_ON_ONE':
      return count === 1
        ? 'The matching session already has an enrollment, and the target class capacity is 1. Resolve that enrollment before continuing.'
        : 'The matching sessions already have an enrollment, and the target class capacity is 1. Resolve those enrollments before continuing.';
    case 'CAPACITY_EXCEEDED':
      return count === 1
        ? `The matching session cannot hold the current enrollments plus the enrollments being moved (capacity ${targetCapacity}). Resolve that before continuing.`
        : `The matching sessions cannot hold the current enrollments plus the enrollments being moved (capacity ${targetCapacity}). Resolve that before continuing.`;
    default:
      return count === 1
        ? 'Resolve this session before continuing.'
        : 'Resolve these sessions before continuing.';
  }
}

function groupSessionBlockers(rows, targetCapacity) {
  const grouped = [];
  const byCode = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    let group = byCode.get(row.code);
    if (!group) {
      group = { code: row.code, sessions: [] };
      byCode.set(row.code, group);
      grouped.push(group);
    }
    group.sessions.push({
      sessionId: row.sessionId,
      date: row.date,
      startTime: row.startTime || '',
      endTime: row.endTime || ''
    });
  });
  return grouped.map((group) => ({
    code: group.code,
    message: sessionBlockerMessage(group.code, group.sessions.length, targetCapacity),
    sessions: group.sessions
  }));
}

function studentsCoveringDate(periods, date) {
  const ids = new Set();
  (Array.isArray(periods) ? periods : []).forEach((period) => {
    const status = String(period?.status || '').trim().toLowerCase();
    if (!OPEN_STATUSES.has(status)) return;
    if (!dependencies.classEnrollmentSessionApplicabilityService.periodCoversSession(period, { date })) return;
    const studentId = toPublicId(period.studentId);
    if (studentId) ids.add(studentId);
  });
  return ids;
}

function evaluateSessionConflicts({
  selectedSessions = [],
  targetSessions = [],
  startTime = '',
  targetCapacity = 0,
  sourcePeriods = [],
  targetPeriods = [],
  cycleStartDate = '',
  cycleEndDate = ''
} = {}) {
  const blockers = [];
  const sessionBlockers = [];
  const notices = [];
  const plans = [];
  const newStartMin = timeToMinutes(startTime);
  if (!Number.isFinite(newStartMin)) {
    blockers.push({ code: 'START_TIME_REQUIRED', message: 'Enter a start time for the sessions on the target class.' });
    return { blockers, notices, plans };
  }

  const selected = (Array.isArray(selectedSessions) ? selectedSessions : [])
    .map((session) => ({
      session,
      sessionId: sessionIdentity(session),
      date: sessionDate(session),
      duration: durationMinutes(session)
    }))
    .filter((row) => row.sessionId && row.date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.sessionId.localeCompare(b.sessionId));

  selected.forEach((row) => {
    const sessionRef = {
      date: row.date,
      sessionId: row.sessionId,
      startTime: sessionStart(row.session),
      endTime: sessionEnd(row.session)
    };
    if (!row.duration) {
      sessionBlockers.push({ code: 'INVALID_DURATION', ...sessionRef });
      return;
    }
    const proposedStart = newStartMin;
    const proposedEnd = newStartMin + row.duration;
    if (proposedEnd > (24 * 60)) {
      sessionBlockers.push({ code: 'END_TIME_OVERFLOW', ...sessionRef });
      return;
    }
    const cycleStart = normalizeDateOnly(cycleStartDate);
    const cycleEnd = normalizeDateOnly(cycleEndDate);
    if ((cycleStart && row.date < cycleStart) || (cycleEnd && row.date > cycleEnd)) {
      sessionBlockers.push({ code: 'OUT_OF_CYCLE', ...sessionRef });
      return;
    }

    const sameDay = (Array.isArray(targetSessions) ? targetSessions : []).filter((session) => sessionDate(session) === row.date);
    const overlaps = sameDay.filter((session) => {
      const start = timeToMinutes(sessionStart(session));
      const end = timeToMinutes(sessionEnd(session));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
      return proposedStart < end && start < proposedEnd;
    });
    const exact = overlaps.find((session) => {
      const start = timeToMinutes(sessionStart(session));
      return start === proposedStart && durationMinutes(session) === row.duration;
    });
    const mismatched = overlaps.filter((session) => session !== exact);
    if (mismatched.length) {
      sessionBlockers.push({ code: 'TIME_MISMATCH', ...sessionRef });
      return;
    }
    if (exact) {
      const targetStudents = studentsCoveringDate(targetPeriods, row.date);
      const movingStudents = studentsCoveringDate(sourcePeriods, row.date);
      const combined = new Set([...targetStudents, ...movingStudents]);
      if (targetCapacity === 1 && targetStudents.size > 0) {
        sessionBlockers.push({
          code: 'OCCUPIED_ONE_ON_ONE',
          ...sessionRef,
          sessionId: sessionIdentity(exact) || row.sessionId
        });
        return;
      }
      if (targetCapacity > 1 && combined.size > targetCapacity) {
        sessionBlockers.push({
          code: 'CAPACITY_EXCEEDED',
          ...sessionRef,
          sessionId: sessionIdentity(exact) || row.sessionId
        });
        return;
      }
      plans.push({
        action: 'reuse',
        date: row.date,
        sourceSessionId: row.sessionId,
        targetSessionId: sessionIdentity(exact),
        startTime: minutesToTime(proposedStart),
        endTime: minutesToTime(proposedEnd)
      });
      return;
    }
    plans.push({
      action: 'create',
      date: row.date,
      sourceSessionId: row.sessionId,
      targetSessionId: '',
      startTime: minutesToTime(proposedStart),
      endTime: minutesToTime(proposedEnd)
    });
  });

  const reuseCount = plans.filter((row) => row.action === 'reuse').length;
  const createCount = plans.filter((row) => row.action === 'create').length;
  const groupedBlockers = groupSessionBlockers(sessionBlockers, targetCapacity);
  blockers.push(...groupedBlockers);
  if (!blockers.length && reuseCount > 0 && createCount > 0) {
    notices.push({
      code: 'PARTIAL_CREATE',
      message: `This will create ${createCount} missing session(s) on the target class and will not change the ${reuseCount} session(s) that already match.`
    });
  }
  return { blockers, notices, plans };
}

function consumedBeforeDate(period, sessions, closeDate) {
  const prior = (Array.isArray(sessions) ? sessions : []).filter((session) => {
    const date = sessionDate(session);
    return date && closeDate && date <= closeDate;
  });
  if (!toPublicId(period?.personId) || !prior.length) {
    return { count: 0, hours: 0 };
  }
  const result = dependencies.classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentApplicability({
    sessions: prior,
    periodRows: [period],
    allowedStatuses: OPEN_STATUSES
  });
  const summary = result.summariesByPeriodId.get(toPublicId(period.id));
  return {
    count: Number(summary?.consumedCount || 0),
    hours: Number(summary?.consumedHours || 0)
  };
}

function remainingEnrollmentTerms(period, consumed) {
  const applicability = dependencies.classEnrollmentSessionApplicabilityService;
  const targetHours = applicability.normalizeTargetHours(period?.targetHours);
  const targetSessionCount = applicability.normalizeTargetSessionCount(period?.targetSessionCount);
  if (targetHours > 0) {
    return {
      targetHours: Math.max(0, applicability.roundTargetHours(targetHours - Number(consumed?.hours || 0))),
      targetSessionCount: 0,
      endDate: ''
    };
  }
  if (targetSessionCount > 0) {
    return {
      targetHours: 0,
      targetSessionCount: Math.max(0, targetSessionCount - Number(consumed?.count || 0)),
      endDate: ''
    };
  }
  return {
    targetHours: 0,
    targetSessionCount: 0,
    endDate: normalizeDateOnly(period?.endDate)
  };
}

function classifyMoveEnrollments({
  periods = [],
  selectedDates = [],
  sourceSessions = []
} = {}) {
  const dates = (Array.isArray(selectedDates) ? selectedDates : []).map(normalizeDateOnly).filter(Boolean).sort();
  const firstSelectedDate = dates[0] || '';
  const rows = [];
  (Array.isArray(periods) ? periods : []).forEach((period) => {
    const status = String(period?.status || '').trim().toLowerCase();
    if (!OPEN_STATUSES.has(status)) return;
    const coveredDates = dates.filter((date) => (
      dependencies.classEnrollmentSessionApplicabilityService.periodCoversSession(period, { date })
    ));
    if (!coveredDates.length || !firstSelectedDate) return;
    const startDate = normalizeDateOnly(period.startDate);
    const anchorDate = coveredDates[0];
    const moveAnchor = startDate && startDate > firstSelectedDate ? anchorDate : firstSelectedDate;
    const termsBase = { periodId: toPublicId(period.id), studentId: toPublicId(period.studentId), startDate };
    if (startDate && startDate === moveAnchor) {
      rows.push({
        ...termsBase,
        action: 'reassign',
        closeDate: '',
        newStartDate: startDate,
        ...remainingEnrollmentTerms(period, { count: 0, hours: 0 }),
        endDate: normalizeDateOnly(period.endDate)
      });
      const last = rows[rows.length - 1];
      if (dependencies.classEnrollmentSessionApplicabilityService.hasEnrollmentCap(period)) {
        last.endDate = '';
      }
      return;
    }
    const closeDate = addDaysIso(moveAnchor, -1);
    const consumed = consumedBeforeDate(period, sourceSessions, closeDate);
    const terms = remainingEnrollmentTerms(period, consumed);
    rows.push({
      ...termsBase,
      action: 'close_and_open',
      closeDate,
      newStartDate: moveAnchor,
      targetHours: terms.targetHours,
      targetSessionCount: terms.targetSessionCount,
      endDate: terms.endDate
    });
  });
  return rows;
}

function buildMovePreviewHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function parseSelectedSessionIds(body = {}) {
  const rows = Array.isArray(body.sessions) ? body.sessions : [];
  const ids = rows.map((row) => toPublicId(row?.sessionId || row?.id)).filter(Boolean);
  return Array.from(new Set(ids));
}

function studentDisplayName(student, fallback) {
  if (!student || typeof student !== 'object') return fallback;
  const displayName = String(student.displayName || '').trim();
  if (displayName) return displayName;
  const name = student.name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  if (name && typeof name === 'object') {
    const full = `${String(name.first || '').trim()} ${String(name.last || '').trim()}`.trim();
    if (full) return full;
  }
  return fallback;
}

async function loadMoveContext({
  classId,
  targetClassId,
  sessionIds = [],
  reqUser,
  accessContext
} = {}) {
  const sourceId = toPublicId(classId);
  const targetId = toPublicId(targetClassId);
  const sourceClass = sourceId
    ? await dependencies.schoolDataService.getDataById('classes', sourceId, reqUser, accessContext)
    : null;
  const targetClass = targetId
    ? await dependencies.schoolDataService.getDataById('classes', targetId, reqUser, accessContext)
    : null;
  if (!sourceClass) throw new Error('Source class not found.');
  const sourceSessions = await dependencies.schoolDataService.getClassSessions(sourceId, reqUser);
  const selected = (Array.isArray(sourceSessions) ? sourceSessions : []).filter((session) => (
    sessionIds.includes(sessionIdentity(session))
  ));
  if (!selected.length) throw new Error('Select at least one saved session from the source class.');
  const targetSessions = targetClass
    ? await dependencies.schoolDataService.getClassSessions(targetId, reqUser)
    : [];
  const sourcePeriods = await dependencies.schoolDataService.getClassEnrollmentPeriodsByClassId(sourceId, reqUser);
  const targetPeriods = targetClass
    ? await dependencies.schoolDataService.getClassEnrollmentPeriodsByClassId(targetId, reqUser)
    : [];
  return {
    sourceClass,
    targetClass,
    sourceSessions: Array.isArray(sourceSessions) ? sourceSessions : [],
    selectedSessions: selected,
    targetSessions: Array.isArray(targetSessions) ? targetSessions : [],
    sourcePeriods: Array.isArray(sourcePeriods) ? sourcePeriods : [],
    targetPeriods: Array.isArray(targetPeriods) ? targetPeriods : []
  };
}

async function buildMovePreview({
  classId,
  targetClassId,
  startTime = '',
  sessionIds = [],
  reqUser,
  accessContext
} = {}) {
  const context = await loadMoveContext({
    classId,
    targetClassId,
    sessionIds,
    reqUser,
    accessContext
  });
  const capacityBlockers = evaluateCapacityGate({
    sourceClass: context.sourceClass,
    targetClass: context.targetClass
  });
  const targetCapacity = context.targetClass
    ? dependencies.classSessionCapacityService.resolveClassMaxCapacity(context.targetClass)
    : 0;
  const sourceCapacity = dependencies.classSessionCapacityService.resolveClassMaxCapacity(context.sourceClass);
  const selectedDates = context.selectedSessions.map(sessionDate).filter(Boolean).sort();
  const enrollments = classifyMoveEnrollments({
    periods: context.sourcePeriods,
    selectedDates,
    sourceSessions: context.sourceSessions
  });
  let conflict = { blockers: [], notices: [], plans: [] };
  if (context.targetClass && String(startTime || '').trim()) {
    conflict = evaluateSessionConflicts({
      selectedSessions: context.selectedSessions,
      targetSessions: context.targetSessions,
      startTime,
      targetCapacity,
      sourcePeriods: context.sourcePeriods,
      targetPeriods: context.targetPeriods,
      cycleStartDate: context.targetClass.cycleStartDate,
      cycleEndDate: context.targetClass.cycleEndDate
    });
  }
  const blockers = [...capacityBlockers, ...conflict.blockers];
  const labeled = [];
  for (const row of enrollments) {
    let label = row.studentId;
    try {
      const student = await dependencies.schoolDataService.getDataById('students', row.studentId, reqUser, accessContext);
      label = studentDisplayName(student, row.studentId);
    } catch (error) {
      label = row.studentId;
    }
    labeled.push({ ...row, studentLabel: label });
  }
  const hashPayload = {
    sourceClassId: toPublicId(context.sourceClass.id),
    targetClassId: toPublicId(context.targetClass?.id),
    startTime: String(startTime || '').trim(),
    sessionIds: context.selectedSessions.map(sessionIdentity).sort(),
    plans: conflict.plans,
    enrollments: labeled.map((row) => ({
      periodId: row.periodId,
      action: row.action,
      closeDate: row.closeDate,
      newStartDate: row.newStartDate,
      endDate: row.endDate,
      targetHours: row.targetHours,
      targetSessionCount: row.targetSessionCount
    }))
  };
  return {
    canContinue: blockers.length === 0 && Boolean(context.targetClass),
    blockers,
    notices: conflict.notices,
    sourceCapacity,
    targetCapacity,
    targetClass: context.targetClass ? {
      id: toPublicId(context.targetClass.id),
      title: String(context.targetClass.title || context.targetClass.id || '').trim()
    } : null,
    firstSelectedDate: selectedDates[0] || '',
    sessionPlans: conflict.plans,
    enrollments: labeled,
    previewHash: buildMovePreviewHash(hashPayload)
  };
}

function resolveTargetTeacher(classData = {}) {
  const primary = toPublicId(classData?.primaryTeacherId);
  if (primary) return { teacherId: primary, teacherName: '' };
  const instructors = Array.isArray(classData?.instructors) ? classData.instructors : [];
  const active = instructors.find((row) => String(row?.status || '').trim().toLowerCase() === 'active') || instructors[0] || null;
  return {
    teacherId: toPublicId(active?.personId),
    teacherName: String(active?.name || '').trim()
  };
}

function mergeRoster(targetRoster, sourceRoster) {
  const next = (Array.isArray(targetRoster) ? targetRoster : []).map((row) => ({ ...row }));
  const seen = new Set(next.map((row) => toPublicId(row?.personId)).filter(Boolean));
  (Array.isArray(sourceRoster) ? sourceRoster : []).forEach((row) => {
    const personId = toPublicId(row?.personId);
    if (!personId || seen.has(personId)) return;
    seen.add(personId);
    next.push({ ...row });
  });
  return next;
}

function buildCreatedSession({ classId, sourceSession, plan, existingSessions, teacher }) {
  const sessionId = dependencies.sessionIdService.buildNextSessionId(classId, existingSessions);
  const status = String(sourceSession?.status || '').trim() || 'scheduled';
  return {
    sessionId,
    date: plan.date,
    originalDate: plan.date,
    startTime: plan.startTime,
    endTime: plan.endTime,
    durationHours: dependencies.classEnrollmentSessionApplicabilityService.computeDurationHoursFromTimes(plan.startTime, plan.endTime),
    room: String(sourceSession?.room || '').trim(),
    status,
    notes: String(sourceSession?.notes || '').trim(),
    locked: Boolean(sourceSession?.locked),
    delivery: {
      deliveredBy: teacher.teacherId || null,
      deliveredByName: teacher.teacherName || '',
      substitute: false,
      coTeachers: []
    },
    roster: mergeRoster([], sourceSession?.roster)
  };
}

async function applyEnrollmentRow({
  row,
  period,
  targetClass,
  reqUser,
  orgId,
  engineHooks
} = {}) {
  const targetCapacity = dependencies.classSessionCapacityService.resolveClassMaxCapacity(targetClass);
  if (row.action === 'reassign') {
    const patch = {
      classId: toPublicId(targetClass.id),
      updatedBy: toPublicId(reqUser?.id || reqUser?.userId || 'system')
    };
    if (targetCapacity === 1) patch.sessionCapacityType = 'one_on_one';
    return dependencies.schoolRepositories.classEnrollmentPeriods.update(period.id, patch, { allowClassChange: true });
  }
  const payload = {
    close: {
      effectiveDate: row.closeDate,
      reason: 'Sessions moved to another class.'
    },
    target: {
      classId: toPublicId(targetClass.id),
      startDate: row.newStartDate,
      endDate: row.endDate,
      targetSessionCount: row.targetSessionCount,
      targetHours: row.targetHours,
      funder: {
        funderId: period.funderId || 'self',
        funderType: period.funderType || 'self'
      },
      reasonStart: 'Continued after sessions were moved to this class.',
      status: String(period.status || 'active').trim().toLowerCase() || 'active',
      claimNumber: period.claimNumber || '',
      claimNumberId: period.claimNumberId || '',
      sessionCountPolicy: period.sessionCountPolicy,
      programId: period.programId,
      termId: period.termId,
      programRegistrationId: period.programRegistrationId,
      sessionCapacityType: targetCapacity === 1 ? 'one_on_one' : (period.sessionCapacityType || 'group'),
      notes: period.notes || ''
    }
  };
  const movePreview = await dependencies.enrollmentMoveService.previewMoveEnrollment({
    sourcePeriodId: period.id,
    payload,
    reqUser,
    orgId
  });
  if (!movePreview.canApply) {
    throw new Error(movePreview.blockers?.[0]?.message || 'Enrollment move is blocked.');
  }
  return dependencies.enrollmentMoveService.applyMoveEnrollment({
    sourcePeriodId: period.id,
    payload,
    previewHash: movePreview.previewHash,
    reqUser,
    orgId,
    engineHooks
  });
}

async function applyMoveSessions({
  classId,
  targetClassId,
  startTime = '',
  sessionIds = [],
  previewHash = '',
  reqUser,
  req,
  accessContext,
  buildEngineHooks
} = {}) {
  const preview = await buildMovePreview({
    classId,
    targetClassId,
    startTime,
    sessionIds,
    reqUser,
    accessContext
  });
  if (!String(startTime || '').trim()) throw new Error('Enter a start time for the sessions on the target class.');
  if (!preview.canContinue) {
    const error = new Error(preview.blockers[0]?.message || 'Resolve the listed issues before moving sessions.');
    error.preview = preview;
    throw error;
  }
  if (!previewHash || previewHash !== preview.previewHash) {
    throw new Error('Preview is stale. Review the move again before applying.');
  }
  const context = await loadMoveContext({
    classId,
    targetClassId,
    sessionIds,
    reqUser,
    accessContext
  });
  const teacher = resolveTargetTeacher(context.targetClass);
  const sourceById = new Map(context.selectedSessions.map((session) => [sessionIdentity(session), session]));
  let targetSessions = context.targetSessions.slice();
  const created = [];
  const upsertedSessions = [];
  preview.sessionPlans.forEach((plan) => {
    const sourceSession = sourceById.get(plan.sourceSessionId);
    if (!sourceSession) return;
    const targetClassId = toPublicId(context.targetClass.id);
    const upsertDate = normalizeDateOnly(plan.date) || sessionDate(sourceSession);
    if (plan.action === 'create') {
      const session = buildCreatedSession({
        classId: context.targetClass.id,
        sourceSession,
        plan,
        existingSessions: targetSessions,
        teacher
      });
      targetSessions.push(session);
      created.push(session.sessionId);
      upsertedSessions.push({
        classId: targetClassId,
        sessionId: session.sessionId,
        date: upsertDate
      });
      return;
    }
    targetSessions = targetSessions.map((session) => {
      if (!idsEqual(sessionIdentity(session), plan.targetSessionId)) return session;
      return { ...session, roster: mergeRoster(session.roster, sourceSession.roster) };
    });
    upsertedSessions.push({
      classId: targetClassId,
      sessionId: toPublicId(plan.targetSessionId),
      date: upsertDate
    });
  });
  await dependencies.schoolDataService.saveClassSessions(
    context.targetClass.id,
    targetSessions,
    reqUser,
    accessContext
  );

  const orgId = toPublicId(context.sourceClass.orgId);
  for (const row of preview.enrollments) {
    const period = context.sourcePeriods.find((item) => idsEqual(item.id, row.periodId));
    if (!period) continue;
    const hooks = typeof buildEngineHooks === 'function'
      ? buildEngineHooks(req, context.targetClass)
      : {};
    await applyEnrollmentRow({
      row,
      period,
      targetClass: context.targetClass,
      reqUser,
      orgId,
      engineHooks: hooks
    });
  }

  const removeIds = new Set(context.selectedSessions.map(sessionIdentity));
  const remaining = context.sourceSessions.filter((session) => !removeIds.has(sessionIdentity(session)));
  await dependencies.schoolDataService.saveClassSessions(
    context.sourceClass.id,
    remaining,
    reqUser,
    accessContext
  );
  const sourceClassId = toPublicId(context.sourceClass.id);
  const removedSessions = context.selectedSessions.map((session) => ({
    classId: sourceClassId,
    sessionId: toPublicId(sessionIdentity(session)),
    date: sessionDate(session)
  })).filter((row) => row.sessionId && row.date);

  return {
    createdSessionIds: created,
    reusedSessionCount: preview.sessionPlans.filter((row) => row.action === 'reuse').length,
    removedSessionCount: removeIds.size,
    enrollmentCount: preview.enrollments.length,
    removedSessions,
    upsertedSessions
  };
}

function __setDependenciesForTest(nextDeps = {}) {
  dependencies = { ...dependencies, ...nextDeps };
}

function __resetDependenciesForTest() {
  dependencies = {
    schoolDataService,
    schoolRepositories,
    classSessionCapacityService,
    classEnrollmentSessionApplicabilityService,
    enrollmentMoveService,
    sessionIdService
  };
}

module.exports = {
  OPEN_STATUSES,
  addDaysIso,
  evaluateCapacityGate,
  evaluateSessionConflicts,
  classifyMoveEnrollments,
  buildMovePreviewHash,
  parseSelectedSessionIds,
  buildMovePreview,
  applyMoveSessions,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
