'use strict';

const crypto = require('crypto');
const schoolDataService = require('./schoolDataService');
const schoolIndexService = require('./schoolIndexService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const sessionConflictDetectionService = require('./sessionConflictDetectionService');
const sessionDeliveryTeamService = require('./sessionDeliveryTeamService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

let dependencies = {
  schoolDataService,
  schoolIndexService,
  schoolPersonAccessService,
  sessionConflictDetectionService,
  sessionDeliveryTeamService,
  sessionStatusPolicyService,
  classEnrollmentSessionApplicabilityService
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

function buildTakeOverPreviewHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function isApprovedTimesheetLocked(session = {}) {
  const locked = session?.locked === true || String(session?.locked) === 'true';
  return locked && cleanText(session?.lockReason) === 'timesheet_approved';
}

function isMergedSession(session = {}) {
  return session?.merged?.isMergedSession === true;
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

function timesOverlap(left = {}, right = {}) {
  if (!left.date || left.date !== right.date) return false;
  if (!left.startTime || !left.endTime || !right.startTime || !right.endTime) return false;
  return left.startTime < right.endTime && right.startTime < left.endTime;
}

function blockerMessage(code, count) {
  const these = count === 1 ? 'This session' : 'These sessions';
  switch (code) {
    case 'MULTIPLE_CLASSES':
      return 'Select sessions from one class.';
    case 'ALREADY_MERGED':
      return count === 1
        ? 'This session has already been merged.'
        : 'These sessions have already been merged.';
    case 'TIMESHEET_LOCKED':
      return `${these} ${count === 1 ? 'is' : 'are'} locked by an approved timesheet.`;
    case 'COMPLETED':
      return count === 1
        ? 'This session is completed.'
        : 'These sessions are completed.';
    case 'NO_ENROLLMENT':
      return count === 1
        ? 'This session has no enrollment.'
        : 'These sessions have no enrollment.';
    case 'SAME_TEACHER':
      return count === 1
        ? 'The selected teacher is already the main teacher for this session.'
        : 'The selected teacher is already the main teacher for these sessions.';
    case 'SESSION_OVERLAP':
      return 'The selected sessions overlap each other.';
    case 'TEACHER_CONFLICT':
      return 'The selected teacher already has a scheduled session that conflicts with the selected sessions.';
    case 'CANNOT_UNDO':
      return count === 1
        ? 'This session has no take over to undo.'
        : 'These sessions have no take over to undo.';
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

function collectTakeOverBlockers({
  classIds = [],
  rows = [],
  teacherId = ''
} = {}) {
  const blocked = [];
  const classIdList = [...new Set((Array.isArray(classIds) ? classIds : []).map((id) => toPublicId(id)).filter(Boolean))];
  if (classIdList.length > 1) {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      blocked.push({ code: 'MULTIPLE_CLASSES', ...sessionRef(row.classId, row.session || row) });
    });
  }

  const normalizedTeacherId = toPublicId(teacherId);
  const comparable = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const session = row.session || row;
    const ref = sessionRef(row.classId, session);
    if (row.alreadyMerged || isMergedSession(session)) {
      blocked.push({ code: 'ALREADY_MERGED', ...ref });
    }
    if (row.timesheetLocked || isApprovedTimesheetLocked(session)) {
      blocked.push({ code: 'TIMESHEET_LOCKED', ...ref });
    }
    if (row.isFinal) blocked.push({ code: 'COMPLETED', ...ref });
    if (row.hasEnrollment === false) blocked.push({ code: 'NO_ENROLLMENT', ...ref });
    const mainTeacherId = toPublicId(row.mainTeacherId || session?.delivery?.deliveredBy);
    if (normalizedTeacherId && mainTeacherId && idsEqual(mainTeacherId, normalizedTeacherId)) {
      blocked.push({ code: 'SAME_TEACHER', ...ref });
    }
    comparable.push(ref);
  });

  for (let index = 0; index < comparable.length; index += 1) {
    for (let other = index + 1; other < comparable.length; other += 1) {
      if (!timesOverlap(comparable[index], comparable[other])) continue;
      blocked.push({ code: 'SESSION_OVERLAP', ...comparable[index] });
      blocked.push({ code: 'SESSION_OVERLAP', ...comparable[other] });
    }
  }

  return groupBlockers(blocked);
}

function listPreviousTeacherCoTeachers(session = {}) {
  return dependencies.sessionDeliveryTeamService.getSessionCoTeachers(session)
    .filter((row) => cleanText(row?.roleLabel) === 'Previous Teacher');
}

function canUndoTakeOverSession(session = {}) {
  if (isMergedSession(session)) return false;
  if (isApprovedTimesheetLocked(session)) return false;
  return listPreviousTeacherCoTeachers(session).length === 1;
}

function undoTakeOverFromSession(session = {}) {
  const previousRows = listPreviousTeacherCoTeachers(session);
  if (previousRows.length !== 1) {
    throw new Error('This session has no take over to undo.');
  }
  const previousTeacher = previousRows[0];
  const restoreId = toPublicId(previousTeacher?.personId);
  const restoreName = cleanText(previousTeacher?.name) || restoreId;
  const coTeachers = dependencies.sessionDeliveryTeamService.getSessionCoTeachers(session)
    .filter((row) => !idsEqual(row?.personId, restoreId));
  const delivery = dependencies.sessionDeliveryTeamService.applyCoTeachersToDelivery(
    {
      ...(session.delivery || {}),
      deliveredBy: restoreId,
      deliveredByName: restoreName
    },
    coTeachers,
    { mainTeacherId: restoreId }
  );
  return {
    ...session,
    delivery
  };
}

function collectUndoTakeOverBlockers({
  classIds = [],
  rows = []
} = {}) {
  const blocked = [];
  const classIdList = [...new Set((Array.isArray(classIds) ? classIds : []).map((id) => toPublicId(id)).filter(Boolean))];
  if (classIdList.length > 1) {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      blocked.push({ code: 'MULTIPLE_CLASSES', ...sessionRef(row.classId, row.session || row) });
    });
  }
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const session = row.session || row;
    const ref = sessionRef(row.classId, session);
    if (isMergedSession(session)) {
      blocked.push({ code: 'ALREADY_MERGED', ...ref });
    }
    if (isApprovedTimesheetLocked(session)) {
      blocked.push({ code: 'TIMESHEET_LOCKED', ...ref });
    }
    if (row.isFinal) blocked.push({ code: 'COMPLETED', ...ref });
    if (row.hasEnrollment === false) blocked.push({ code: 'NO_ENROLLMENT', ...ref });
    if (!canUndoTakeOverSession(session)) {
      blocked.push({ code: 'CANNOT_UNDO', ...ref });
    }
  });
  return groupBlockers(blocked);
}

function buildUpsertedSessionRefs(classId, sessions = [], selectedIds = new Set()) {
  const normalizedClassId = toPublicId(classId);
  const refs = [];
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    const sessionId = toPublicId(session?.sessionId || session?.id);
    if (!sessionId || !selectedIds.has(sessionId)) return;
    refs.push({
      classId: normalizedClassId,
      sessionId,
      date: cleanText(session?.date).slice(0, 10)
    });
  });
  return refs;
}

function applyTakeOverToSession(session = {}, { teacherId = '', teacherName = '' } = {}) {
  const nextTeacherId = toPublicId(teacherId);
  const previousTeacherId = toPublicId(session?.delivery?.deliveredBy);
  const previousTeacherName = cleanText(session?.delivery?.deliveredByName) || previousTeacherId;
  const keptCoTeachers = dependencies.sessionDeliveryTeamService.getSessionCoTeachers(session)
    .filter((row) => !idsEqual(row?.personId, nextTeacherId) && !idsEqual(row?.personId, previousTeacherId));
  const coTeachers = previousTeacherId && !idsEqual(previousTeacherId, nextTeacherId)
    ? [
      ...keptCoTeachers,
      {
        personId: previousTeacherId,
        name: previousTeacherName,
        roleLabel: 'Previous Teacher',
        paid: false,
        paidHours: 0,
        canEdit: false
      }
    ]
    : keptCoTeachers;
  const delivery = dependencies.sessionDeliveryTeamService.applyCoTeachersToDelivery(
    {
      ...(session.delivery || {}),
      deliveredBy: nextTeacherId,
      deliveredByName: cleanText(teacherName) || nextTeacherId
    },
    coTeachers,
    { mainTeacherId: nextTeacherId }
  );
  return {
    ...session,
    delivery
  };
}

function sessionHasExpectedEnrollment({
  classData = {},
  session = {},
  sessions = [],
  periods = []
} = {}) {
  const mode = cleanText(classData?.registrationMode).toLowerCase();
  if (mode === 'rolling') {
    const applicability = dependencies.classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentApplicability({
      sessions,
      periodRows: periods,
      studentToPersonMap: new Map(),
      activeOrgId: toPublicId(classData?.orgId)
    });
    const sessionId = toPublicId(session?.sessionId || session?.id);
    return [...(applicability?.stateByKey instanceof Map ? applicability.stateByKey.entries() : [])]
      .some(([key, state]) => state?.expected === true && cleanText(key).endsWith(`::${sessionId}`));
  }
  return (Array.isArray(session?.roster) ? session.roster : []).some((row) => toPublicId(row?.personId));
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

async function loadTakeOverClass({
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
    loaded.push({ classId: row.classId, session, classData: bucket.classData, classSessions: bucket.sessions });
  }
  return { classIds, buckets, loaded };
}

async function buildTakeOverPreview({
  teacherId = '',
  sessions = [],
  reqUser,
  accessContext
} = {}) {
  const selected = Array.isArray(sessions) ? sessions : [];
  const teacher = toPublicId(teacherId);
  if (!teacher) throw new Error('Choose a teacher.');
  const loadedClass = await loadTakeOverClass({ sessions: selected, reqUser, accessContext });
  const statusMap = loadedClass.classIds.length === 1
    ? await dependencies.sessionStatusPolicyService.getStatusMap(toPublicId(loadedClass.loaded[0]?.classData?.orgId), { includeInactive: true })
    : new Map();
  const periodCache = new Map();
  const rows = [];
  for (const row of loadedClass.loaded) {
    const mode = cleanText(row.classData?.registrationMode).toLowerCase();
    let periods = [];
    if (mode === 'rolling' && !periodCache.has(row.classId)) {
      const listed = await dependencies.schoolDataService.getClassEnrollmentPeriodsByClassId(row.classId, reqUser);
      periodCache.set(row.classId, Array.isArray(listed) ? listed : []);
    }
    periods = periodCache.get(row.classId) || [];
    const isFinal = dependencies.sessionStatusPolicyService.isFinalStatusByMap(statusMap, {
      status: row.session?.status,
      notes: row.session?.notes
    });
    rows.push({
      classId: row.classId,
      session: row.session,
      isFinal,
      hasEnrollment: sessionHasExpectedEnrollment({
        classData: row.classData,
        session: row.session,
        sessions: row.classSessions,
        periods
      }),
      mainTeacherId: toPublicId(row.session?.delivery?.deliveredBy)
    });
  }

  const blocked = collectTakeOverBlockers({
    classIds: loadedClass.classIds,
    rows,
    teacherId: teacher
  });

  let teacherConflicts = [];
  if (loadedClass.classIds.length === 1 && teacher) {
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
        if (conflictType === 'student_approved_leave' || conflictType === 'student_schedule') return false;
        return cleanText(row?.conflictClass) !== 'Another unsaved session in this list';
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
  const review = rows.map((row) => ({
    ...sessionRef(row.classId, row.session),
    previousTeacherId: toPublicId(row.session?.delivery?.deliveredBy),
    previousTeacherName: cleanText(row.session?.delivery?.deliveredByName),
    teacherId: teacher,
    teacherName
  }));
  const hashPayload = {
    teacherId: teacher,
    classId: loadedClass.classIds.length === 1 ? loadedClass.classIds[0] : '',
    sessionKeys: selected.map((row) => `${row.classId}::${row.sessionId}`).sort(),
    previousKeys: review.map((row) => `${row.sessionId}::${row.previousTeacherId}`).sort()
  };
  return {
    canContinue: blocked.length === 0 && loadedClass.classIds.length === 1 && review.length === selected.length,
    blockers: blocked,
    sessions: review,
    teacherId: teacher,
    teacherName,
    previewHash: buildTakeOverPreviewHash(hashPayload),
    classId: loadedClass.classIds[0] || '',
    orgId: toPublicId(loadedClass.loaded[0]?.classData?.orgId)
  };
}

async function applyTakeOverSessions({
  teacherId = '',
  sessions = [],
  previewHash = '',
  reqUser,
  accessContext
} = {}) {
  const preview = await buildTakeOverPreview({
    teacherId,
    sessions,
    reqUser,
    accessContext
  });
  if (!preview.canContinue) {
    const error = new Error(preview.blockers[0]?.message || 'Resolve the listed issues before taking over sessions.');
    error.preview = preview;
    throw error;
  }
  if (!previewHash || previewHash !== preview.previewHash) {
    throw new Error('Preview is stale. Review the take over again before applying.');
  }
  const loadedClass = await loadTakeOverClass({ sessions, reqUser, accessContext });
  const bucket = loadedClass.buckets.get(preview.classId);
  const selectedIds = new Set(sessions.map((row) => toPublicId(row.sessionId)));
  const now = new Date().toISOString();
  const actorId = toPublicId(reqUser?.id || reqUser?.username || '');
  const nextSessions = (bucket?.sessions || []).map((session) => {
    const sessionId = toPublicId(session?.sessionId || session?.id);
    if (!selectedIds.has(sessionId)) return session;
    const updated = applyTakeOverToSession(session, {
      teacherId: preview.teacherId,
      teacherName: preview.teacherName
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
    takenOverCount: selectedIds.size,
    teacherId: preview.teacherId,
    teacherName: preview.teacherName,
    upsertedSessions: buildUpsertedSessionRefs(preview.classId, nextSessions, selectedIds)
  };
}

async function buildSessionActionRows(loadedClass, reqUser) {
  const statusMap = loadedClass.classIds.length === 1
    ? await dependencies.sessionStatusPolicyService.getStatusMap(toPublicId(loadedClass.loaded[0]?.classData?.orgId), { includeInactive: true })
    : new Map();
  const periodCache = new Map();
  const rows = [];
  for (const row of loadedClass.loaded) {
    const mode = cleanText(row.classData?.registrationMode).toLowerCase();
    let periods = [];
    if (mode === 'rolling' && !periodCache.has(row.classId)) {
      const listed = await dependencies.schoolDataService.getClassEnrollmentPeriodsByClassId(row.classId, reqUser);
      periodCache.set(row.classId, Array.isArray(listed) ? listed : []);
    }
    periods = periodCache.get(row.classId) || [];
    const isFinal = dependencies.sessionStatusPolicyService.isFinalStatusByMap(statusMap, {
      status: row.session?.status,
      notes: row.session?.notes
    });
    rows.push({
      classId: row.classId,
      session: row.session,
      isFinal,
      hasEnrollment: sessionHasExpectedEnrollment({
        classData: row.classData,
        session: row.session,
        sessions: row.classSessions,
        periods
      }),
      mainTeacherId: toPublicId(row.session?.delivery?.deliveredBy)
    });
  }
  return rows;
}

async function buildUndoTakeOverPreview({
  sessions = [],
  reqUser,
  accessContext
} = {}) {
  const selected = Array.isArray(sessions) ? sessions : [];
  const loadedClass = await loadTakeOverClass({ sessions: selected, reqUser, accessContext });
  const rows = await buildSessionActionRows(loadedClass, reqUser);
  const blocked = collectUndoTakeOverBlockers({
    classIds: loadedClass.classIds,
    rows
  });
  const review = rows.map((row) => {
    const previousRows = listPreviousTeacherCoTeachers(row.session);
    const previousTeacher = previousRows[0] || {};
    return {
      ...sessionRef(row.classId, row.session),
      restoredTeacherId: toPublicId(previousTeacher?.personId),
      restoredTeacherName: cleanText(previousTeacher?.name),
      currentTeacherId: toPublicId(row.session?.delivery?.deliveredBy),
      currentTeacherName: cleanText(row.session?.delivery?.deliveredByName)
    };
  });
  const hashPayload = {
    classId: loadedClass.classIds.length === 1 ? loadedClass.classIds[0] : '',
    sessionKeys: selected.map((row) => `${row.classId}::${row.sessionId}`).sort(),
    restoreKeys: review.map((row) => `${row.sessionId}::${row.restoredTeacherId}`).sort()
  };
  return {
    canContinue: blocked.length === 0 && loadedClass.classIds.length === 1 && review.length === selected.length,
    blockers: blocked,
    sessions: review,
    previewHash: buildTakeOverPreviewHash(hashPayload),
    classId: loadedClass.classIds[0] || '',
    orgId: toPublicId(loadedClass.loaded[0]?.classData?.orgId)
  };
}

async function applyUndoTakeOver({
  sessions = [],
  previewHash = '',
  reqUser,
  accessContext
} = {}) {
  const preview = await buildUndoTakeOverPreview({
    sessions,
    reqUser,
    accessContext
  });
  if (!preview.canContinue) {
    const error = new Error(preview.blockers[0]?.message || 'Resolve the listed issues before undoing the take over.');
    error.preview = preview;
    throw error;
  }
  if (!previewHash || previewHash !== preview.previewHash) {
    throw new Error('Preview is stale. Review the undo again before applying.');
  }
  const loadedClass = await loadTakeOverClass({ sessions, reqUser, accessContext });
  const bucket = loadedClass.buckets.get(preview.classId);
  const selectedIds = new Set(sessions.map((row) => toPublicId(row.sessionId)));
  const now = new Date().toISOString();
  const actorId = toPublicId(reqUser?.id || reqUser?.username || '');
  const nextSessions = (bucket?.sessions || []).map((session) => {
    const sessionId = toPublicId(session?.sessionId || session?.id);
    if (!selectedIds.has(sessionId)) return session;
    const updated = undoTakeOverFromSession(session);
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
    undoneCount: selectedIds.size,
    upsertedSessions: buildUpsertedSessionRefs(preview.classId, nextSessions, selectedIds)
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
    sessionDeliveryTeamService,
    sessionStatusPolicyService,
    classEnrollmentSessionApplicabilityService
  };
}

module.exports = {
  parseSelectedSessions,
  buildTakeOverPreviewHash,
  collectTakeOverBlockers,
  collectUndoTakeOverBlockers,
  applyTakeOverToSession,
  undoTakeOverFromSession,
  canUndoTakeOverSession,
  sessionHasExpectedEnrollment,
  buildTakeOverPreview,
  applyTakeOverSessions,
  buildUndoTakeOverPreview,
  applyUndoTakeOver,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
