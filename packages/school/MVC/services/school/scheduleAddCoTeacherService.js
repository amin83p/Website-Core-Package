'use strict';

const crypto = require('crypto');
const schoolDataService = require('./schoolDataService');
const schoolIndexService = require('./schoolIndexService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const sessionConflictDetectionService = require('./sessionConflictDetectionService');
const sessionDeliveryTeamService = require('./sessionDeliveryTeamService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const MIN_PAID_HOURS = 0.5;

let dependencies = {
  schoolDataService,
  schoolIndexService,
  schoolPersonAccessService,
  sessionConflictDetectionService,
  sessionDeliveryTeamService
};

function cleanText(value) {
  return String(value || '').trim();
}

function parseSelectedSessions(body = {}) {
  const rows = Array.isArray(body.sessions) ? body.sessions : [];
  const seen = new Set();
  const sessions = [];
  rows.forEach((row) => {
    const classId = toPublicId(row?.classId);
    const sessionId = toPublicId(row?.sessionId || row?.id);
    if (!classId || !sessionId) return;
    const key = `${classId}::${sessionId}`;
    if (seen.has(key)) return;
    seen.add(key);
    sessions.push({ classId, sessionId });
  });
  return sessions;
}

function buildAddCoTeacherPreviewHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function isApprovedTimesheetLocked(session = {}) {
  const locked = session?.locked === true || String(session?.locked) === 'true';
  return locked && cleanText(session?.lockReason) === 'timesheet_approved';
}

function sessionClock(session = {}, key) {
  return cleanText(session?.[key] || session?.[key === 'startTime' ? 'start' : 'end']).slice(0, 5);
}

function sessionRef(classId, session = {}) {
  return {
    classId: toPublicId(classId),
    sessionId: toPublicId(session?.sessionId || session?.id),
    date: cleanText(session?.date).slice(0, 10),
    startTime: sessionClock(session, 'startTime'),
    endTime: sessionClock(session, 'endTime')
  };
}

function sessionDurationHours(session = {}) {
  const start = sessionClock(session, 'startTime').match(/^(\d{2}):(\d{2})$/);
  const end = sessionClock(session, 'endTime').match(/^(\d{2}):(\d{2})$/);
  if (!start || !end) return 0;
  const minutes = (Number(end[1]) * 60 + Number(end[2])) - (Number(start[1]) * 60 + Number(start[2]));
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Number((minutes / 60).toFixed(2));
}

function isPaidChoice(value) {
  if (value === false || value === 0) return false;
  const token = cleanText(value).toLowerCase();
  return token !== 'false' && token !== 'unpaid' && token !== '0';
}

function resolveRequestedPaidHours(raw, duration) {
  if (raw === undefined || raw === null || raw === '') return duration;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(2));
}

function timesOverlap(left = {}, right = {}) {
  if (!left.date || left.date !== right.date) return false;
  if (!left.startTime || !left.endTime || !right.startTime || !right.endTime) return false;
  return left.startTime < right.endTime && right.startTime < left.endTime;
}

function normalizeAction(value) {
  return cleanText(value).toLowerCase() === 'remove' ? 'remove' : 'upsert';
}

function coTeacherOnSession(session = {}, teacherId = '') {
  const id = toPublicId(teacherId);
  if (!id) return null;
  return dependencies.sessionDeliveryTeamService.getSessionCoTeachers(session)
    .find((entry) => idsEqual(entry?.personId, id)) || null;
}

function assignedToEverySession(rows = [], teacherId = '') {
  const list = Array.isArray(rows) ? rows : [];
  return list.length > 0 && list.every((row) => coTeacherOnSession(row.session || row, teacherId));
}

function listExistingCoTeachers(rows = []) {
  const grouped = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const session = row.session || row;
    const ref = sessionRef(row.classId, session);
    dependencies.sessionDeliveryTeamService.getSessionCoTeachers(session).forEach((entry) => {
      const personId = toPublicId(entry?.personId);
      if (!personId) return;
      let group = grouped.get(personId);
      if (!group) {
        group = { personId, name: cleanText(entry?.name) || personId, sessions: [], payments: [] };
        grouped.set(personId, group);
      }
      group.sessions.push(ref);
      group.payments.push({
        paid: entry?.paid !== false,
        paidHours: entry?.paid === false ? 0 : Number(entry?.paidHours || 0)
      });
    });
  });
  return [...grouped.values()].map((group) => {
    const first = group.payments[0] || { paid: false, paidHours: 0 };
    const mixedPayment = group.payments.some((row) => row.paid !== first.paid || row.paidHours !== first.paidHours);
    return {
      personId: group.personId,
      name: group.name,
      paid: mixedPayment ? null : first.paid,
      paidHours: mixedPayment ? null : first.paidHours,
      mixedPayment,
      sessionCount: group.sessions.length,
      sessions: group.sessions
    };
  });
}

function blockerMessage(code, count) {
  const these = count === 1 ? 'This session' : 'These sessions';
  switch (code) {
    case 'MULTIPLE_CLASSES':
      return 'Select sessions from one class.';
    case 'TIMESHEET_LOCKED':
      return `${these} ${count === 1 ? 'is' : 'are'} locked by an approved timesheet.`;
    case 'SAME_TEACHER':
      return count === 1
        ? 'The selected teacher is already the main teacher for this session.'
        : 'The selected teacher is already the main teacher for these sessions.';
    case 'CO_TEACHER_LIMIT':
      return count === 1
        ? 'This session already has 10 co-teachers.'
        : 'These sessions already have 10 co-teachers.';
    case 'MIXED_DURATION':
      return 'Selected sessions have different durations. Choose sessions with the same length or use Unpaid.';
    case 'PAID_HOURS':
      return `Paid hours must be between ${MIN_PAID_HOURS} and the session duration.`;
    case 'TEACHER_CONFLICT':
      return 'The selected teacher already has a scheduled session that conflicts with the selected sessions.';
    case 'SELECTED_OVERLAP':
      return 'The selected sessions overlap each other, so this co-teacher cannot be on all of them.';
    case 'NOT_ASSIGNED':
      return 'The selected teacher is not a co-teacher on these sessions.';
    default:
      return count === 1
        ? 'Resolve this session before continuing.'
        : 'Resolve these sessions before continuing.';
  }
}

function groupBlockers(rows) {
  const grouped = [];
  const byCode = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    let group = byCode.get(row.code);
    if (!group) {
      group = { code: row.code, sessions: [] };
      byCode.set(row.code, group);
      grouped.push(group);
    }
    group.sessions.push(sessionRef(row.classId, row));
  });
  return grouped.map((group) => ({
    code: group.code,
    message: blockerMessage(group.code, group.sessions.length),
    sessions: group.sessions
  }));
}

function collectAddCoTeacherBlockers({
  classIds = [],
  rows = [],
  teacherId = '',
  paid = true,
  paidHours = null,
  action = 'upsert',
  skipSelectedOverlap = false
} = {}) {
  const blocked = [];
  const classIdList = [...new Set((Array.isArray(classIds) ? classIds : []).map((id) => toPublicId(id)).filter(Boolean))];
  if (classIdList.length > 1) {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      blocked.push({ code: 'MULTIPLE_CLASSES', ...sessionRef(row.classId, row.session || row) });
    });
  }

  const normalizedTeacherId = toPublicId(teacherId);
  const removing = normalizeAction(action) === 'remove';
  const durations = [];
  const comparable = [];
  let assignedCount = 0;
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const session = row.session || row;
    const ref = sessionRef(row.classId, session);
    if (row.timesheetLocked || isApprovedTimesheetLocked(session)) {
      blocked.push({ code: 'TIMESHEET_LOCKED', ...ref });
    }
    const alreadyListed = Boolean(coTeacherOnSession(session, normalizedTeacherId));
    if (alreadyListed) assignedCount += 1;
    if (!removing) {
      const mainTeacherId = toPublicId(row.mainTeacherId || session?.delivery?.deliveredBy);
      if (normalizedTeacherId && mainTeacherId && idsEqual(mainTeacherId, normalizedTeacherId)) {
        blocked.push({ code: 'SAME_TEACHER', ...ref });
      }
      const existing = dependencies.sessionDeliveryTeamService.getSessionCoTeachers(session);
      if (!alreadyListed && existing.length >= dependencies.sessionDeliveryTeamService.MAX_CO_TEACHERS) {
        blocked.push({ code: 'CO_TEACHER_LIMIT', ...ref });
      }
    }
    durations.push({ ref, hours: sessionDurationHours(session) });
    comparable.push(ref);
  });

  if (removing && normalizedTeacherId && assignedCount < 1 && (Array.isArray(rows) ? rows.length : 0)) {
    comparable.forEach((ref) => blocked.push({ code: 'NOT_ASSIGNED', ...ref }));
  }

  if (!removing && !skipSelectedOverlap && comparable.length > 1) {
    let overlaps = false;
    for (let index = 0; index < comparable.length; index += 1) {
      for (let other = index + 1; other < comparable.length; other += 1) {
        if (timesOverlap(comparable[index], comparable[other])) overlaps = true;
      }
    }
    if (overlaps) {
      comparable.forEach((ref) => blocked.push({ code: 'SELECTED_OVERLAP', ...ref }));
    }
  }

  if (!removing && isPaidChoice(paid) && durations.length) {
    const unique = [...new Set(durations.map((row) => row.hours))];
    if (unique.length > 1) {
      durations.forEach((row) => blocked.push({ code: 'MIXED_DURATION', ...row.ref }));
    } else {
      const duration = unique[0];
      const hours = resolveRequestedPaidHours(paidHours, duration);
      const outOfRange = duration < MIN_PAID_HOURS
        || hours === null
        || hours < MIN_PAID_HOURS
        || hours > duration;
      if (outOfRange) {
        durations.forEach((row) => blocked.push({ code: 'PAID_HOURS', ...row.ref }));
      }
    }
  }

  return groupBlockers(blocked);
}

function applyCoTeacherToSession(session = {}, {
  teacherId = '',
  teacherName = '',
  paid = true,
  paidHours = 0,
  action = 'upsert'
} = {}) {
  const nextTeacherId = toPublicId(teacherId);
  const existing = dependencies.sessionDeliveryTeamService.getSessionCoTeachers(session);
  if (normalizeAction(action) === 'remove') {
    const delivery = dependencies.sessionDeliveryTeamService.applyCoTeachersToDelivery(
      session.delivery || {},
      existing.filter((row) => !idsEqual(row?.personId, nextTeacherId)),
      { mainTeacherId: toPublicId(session?.delivery?.deliveredBy) }
    );
    return { ...session, delivery };
  }
  const prior = existing.find((row) => idsEqual(row?.personId, nextTeacherId));
  const isPaid = isPaidChoice(paid);
  const nextRow = {
    personId: nextTeacherId,
    name: cleanText(prior?.name) || cleanText(teacherName) || nextTeacherId,
    roleLabel: cleanText(prior?.roleLabel) || 'Co-Teacher',
    canEdit: prior ? prior.canEdit === true : false,
    paid: isPaid,
    paidHours: isPaid ? Number(paidHours) : 0
  };
  const coTeachers = prior
    ? existing.map((row) => (idsEqual(row?.personId, nextTeacherId) ? nextRow : row))
    : [...existing, nextRow];
  const delivery = dependencies.sessionDeliveryTeamService.applyCoTeachersToDelivery(
    session.delivery || {},
    coTeachers,
    { mainTeacherId: toPublicId(session?.delivery?.deliveredBy) }
  );
  return {
    ...session,
    delivery
  };
}

function paymentForRows(rows = [], paid = true, paidHours = null) {
  const isPaid = isPaidChoice(paid);
  if (!isPaid) return { paid: false, paidHours: 0 };
  const durations = [...new Set((Array.isArray(rows) ? rows : []).map((row) => sessionDurationHours(row.session || row)))];
  const duration = durations.length === 1 ? durations[0] : 0;
  const hours = resolveRequestedPaidHours(paidHours, duration);
  return { paid: true, paidHours: hours === null ? null : hours };
}

async function resolveTeacherName(teacherId, reqUser) {
  const id = toPublicId(teacherId);
  if (!id) return '';
  const person = await dependencies.schoolPersonAccessService.getPersonById({
    reqUser,
    personId: id,
    requireSchoolRole: false
  }).catch(() => null);
  return dependencies.schoolPersonAccessService.formatPersonName(person, id);
}

async function loadAddCoTeacherClass({
  sessions = [],
  reqUser,
  accessContext
} = {}) {
  if (!sessions.length) throw new Error('Select at least one saved session.');
  const classIds = [...new Set(sessions.map((row) => toPublicId(row.classId)).filter(Boolean))];
  const buckets = new Map();
  for (const classId of classIds) {
    const classData = await dependencies.schoolDataService.getDataById('classes', classId, reqUser, accessContext);
    if (!classData) throw new Error('Source class not found.');
    const classSessions = await dependencies.schoolDataService.getClassSessions(classId, reqUser);
    buckets.set(classId, {
      classData,
      sessions: Array.isArray(classSessions) ? classSessions : []
    });
  }
  const loaded = [];
  for (const row of sessions) {
    const bucket = buckets.get(row.classId);
    const session = (bucket?.sessions || []).find((item) => idsEqual(item?.sessionId || item?.id, row.sessionId));
    if (!session) throw new Error('One or more selected sessions could not be found. Refresh the schedule and try again.');
    loaded.push({ classId: row.classId, session, classData: bucket.classData });
  }
  return { classIds, buckets, loaded };
}

async function buildAddCoTeacherPreview({
  teacherId = '',
  sessions = [],
  paid = true,
  paidHours = null,
  action = 'upsert',
  reqUser,
  accessContext
} = {}) {
  const selected = Array.isArray(sessions) ? sessions : [];
  const teacher = toPublicId(teacherId);
  const resolvedAction = normalizeAction(action);
  const loadedClass = await loadAddCoTeacherClass({ sessions: selected, reqUser, accessContext });
  const rows = loadedClass.loaded.map((row) => ({
    classId: row.classId,
    session: row.session,
    mainTeacherId: toPublicId(row.session?.delivery?.deliveredBy)
  }));
  const existingCoTeachers = listExistingCoTeachers(rows);
  if (!teacher) {
    const contextBlockers = collectAddCoTeacherBlockers({
      classIds: loadedClass.classIds,
      rows,
      teacherId: '',
      paid: false,
      action: 'upsert',
      skipSelectedOverlap: true
    });
    return {
      canContinue: false,
      blockers: contextBlockers,
      sessions: rows.map((row) => ({
        ...sessionRef(row.classId, row.session),
        status: cleanText(row.session?.status)
      })),
      existingCoTeachers,
      teacherId: '',
      teacherName: '',
      action: '',
      change: '',
      paid: false,
      paidHours: 0,
      previewHash: '',
      classId: loadedClass.classIds[0] || '',
      orgId: toPublicId(loadedClass.loaded[0]?.classData?.orgId)
    };
  }
  const fullyAssigned = assignedToEverySession(rows, teacher);
  const payment = resolvedAction === 'remove'
    ? { paid: false, paidHours: 0 }
    : paymentForRows(rows, paid, paidHours);
  const blocked = collectAddCoTeacherBlockers({
    classIds: loadedClass.classIds,
    rows,
    teacherId: teacher,
    paid: payment.paid,
    paidHours: payment.paid ? paidHours : 0,
    action: resolvedAction,
    skipSelectedOverlap: resolvedAction === 'remove' || fullyAssigned
  });

  let teacherConflicts = [];
  if (resolvedAction !== 'remove' && !fullyAssigned && loadedClass.classIds.length === 1 && teacher) {
    const classData = loadedClass.loaded[0].classData;
    const proposed = rows.map((row) => ({
      ...row.session,
      delivery: {
        deliveredBy: teacher,
        deliveredByName: teacher,
        coTeachers: []
      }
    }));
    const dates = proposed.map((row) => cleanText(row.date).slice(0, 10)).filter(Boolean).sort();
    teacherConflicts = await dependencies.sessionConflictDetectionService.detectSessionConflicts({
      classId: loadedClass.classIds[0],
      sessions: proposed,
      activeOrgId: toPublicId(classData?.orgId),
      reqUser,
      includeExternalScheduleConflicts: true,
      excludeSessionKeys: selected.map((row) => `${row.classId}::${row.sessionId}`),
      startDate: dates[0] || '',
      endDate: dates[dates.length - 1] || ''
    });
    teacherConflicts = (Array.isArray(teacherConflicts) ? teacherConflicts : [])
      .filter((row) => {
        const conflictType = cleanText(row?.conflictType);
        return conflictType !== 'student_approved_leave' && conflictType !== 'student_schedule';
      });
    if (teacherConflicts.length) {
      blocked.push({
        code: 'TEACHER_CONFLICT',
        message: blockerMessage('TEACHER_CONFLICT', teacherConflicts.length),
        sessions: teacherConflicts.map((row) => ({
          classId: loadedClass.classIds[0],
          sessionId: '',
          date: cleanText(row?.date).slice(0, 10),
          startTime: '',
          endTime: '',
          detail: `${cleanText(row?.conflictClass)} ${cleanText(row?.existTime)}`.trim()
        }))
      });
    }
  }

  const teacherName = await resolveTeacherName(teacher, reqUser);
  const resolvedPayment = payment.paid
    ? payment
    : { paid: false, paidHours: 0 };
  const change = resolvedAction === 'remove'
    ? 'remove'
    : (fullyAssigned ? 'update' : 'add');
  const review = rows.map((row) => ({
    ...sessionRef(row.classId, row.session),
    status: cleanText(row.session?.status),
    teacherId: teacher,
    teacherName,
    change: resolvedAction === 'remove'
      ? 'remove'
      : (coTeacherOnSession(row.session, teacher) ? 'update' : 'add'),
    paid: resolvedPayment.paid,
    paidHours: resolvedPayment.paidHours,
    durationHours: sessionDurationHours(row.session)
  }));
  const hashPayload = {
    teacherId: teacher,
    classId: loadedClass.classIds.length === 1 ? loadedClass.classIds[0] : '',
    sessionKeys: selected.map((row) => `${row.classId}::${row.sessionId}`).sort(),
    action: resolvedAction,
    paid: resolvedPayment.paid,
    paidHours: resolvedPayment.paidHours
  };
  return {
    canContinue: blocked.length === 0 && loadedClass.classIds.length === 1 && review.length === selected.length,
    blockers: blocked,
    sessions: review,
    existingCoTeachers,
    teacherId: teacher,
    teacherName,
    action: resolvedAction,
    change,
    paid: resolvedPayment.paid,
    paidHours: resolvedPayment.paidHours,
    previewHash: buildAddCoTeacherPreviewHash(hashPayload),
    classId: loadedClass.classIds[0] || '',
    orgId: toPublicId(loadedClass.loaded[0]?.classData?.orgId)
  };
}

async function applyAddCoTeacher({
  teacherId = '',
  sessions = [],
  paid = true,
  paidHours = null,
  action = 'upsert',
  previewHash = '',
  reqUser,
  accessContext
} = {}) {
  const preview = await buildAddCoTeacherPreview({
    teacherId,
    sessions,
    paid,
    paidHours,
    action,
    reqUser,
    accessContext
  });
  if (!preview.canContinue) {
    const error = new Error(preview.blockers[0]?.message || 'Resolve the listed issues before adding a co-teacher.');
    error.preview = preview;
    throw error;
  }
  if (!previewHash || previewHash !== preview.previewHash) {
    throw new Error('Preview is stale. Review the co-teacher again before applying.');
  }
  const loadedClass = await loadAddCoTeacherClass({ sessions, reqUser, accessContext });
  const bucket = loadedClass.buckets.get(preview.classId);
  const selectedIds = new Set(sessions.map((row) => toPublicId(row.sessionId)));
  const now = new Date().toISOString();
  const actorId = toPublicId(reqUser?.id || reqUser?.username || '');
  const nextSessions = (bucket?.sessions || []).map((session) => {
    const sessionId = toPublicId(session?.sessionId || session?.id);
    if (!selectedIds.has(sessionId)) return session;
    const updated = applyCoTeacherToSession(session, {
      teacherId: preview.teacherId,
      teacherName: preview.teacherName,
      paid: preview.paid,
      paidHours: preview.paidHours,
      action: preview.action
    });
    updated.audit = {
      ...(session.audit || {}),
      lastUpdateUser: actorId,
      lastUpdateDateTime: now
    };
    return updated;
  });
  await dependencies.schoolDataService.saveClassSessions(preview.classId, nextSessions, reqUser);
  await dependencies.schoolIndexService.rebuildIndexesForClass(preview.classId);
  return {
    classId: preview.classId,
    updatedCount: selectedIds.size,
    teacherId: preview.teacherId,
    teacherName: preview.teacherName,
    paid: preview.paid,
    paidHours: preview.paidHours,
    action: preview.action,
    change: preview.change
  };
}

function __setDependenciesForTest(nextDeps = {}) {
  dependencies = { ...dependencies, ...nextDeps };
}

function __resetDependenciesForTest() {
  dependencies = {
    schoolDataService,
    schoolIndexService,
    schoolPersonAccessService,
    sessionConflictDetectionService,
    sessionDeliveryTeamService
  };
}

module.exports = {
  MIN_PAID_HOURS,
  parseSelectedSessions,
  buildAddCoTeacherPreviewHash,
  collectAddCoTeacherBlockers,
  sessionDurationHours,
  applyCoTeacherToSession,
  listExistingCoTeachers,
  buildAddCoTeacherPreview,
  applyAddCoTeacher,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
