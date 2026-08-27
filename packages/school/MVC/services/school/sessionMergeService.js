'use strict';

const schoolDataService = require('./schoolDataService');
const schoolIndexService = require('./schoolIndexService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const sessionDeliveryTeamService = require('./sessionDeliveryTeamService');
const sessionConflictDetectionService = require('./sessionConflictDetectionService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const teacherIdentityService = require('./teacherIdentityService');
const { requireCoreModule } = require('./schoolCoreContracts');

const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

class SessionMergeError extends Error {
  constructor(message, { code = 'SESSION_MERGE_INVALID', statusCode = 409, data = null } = {}) {
    super(message);
    this.name = 'SessionMergeError';
    this.code = code;
    this.statusCode = statusCode;
    this.data = data;
  }
}

function normalizeClock(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function cleanPersonId(value) {
  return toPublicId(value) || String(value || '').trim();
}

function resolveTeacherIndexKeys(indexRoot = {}, personId = '', teacherIdentityLookup = null) {
  const normalized = cleanPersonId(personId);
  if (!normalized) return [];
  const resolvedPersonId = sessionConflictDetectionService.resolveTeacherPersonId(normalized, teacherIdentityLookup) || normalized;
  const teacherPersonMap = buildTeacherPersonMapFromLookup(teacherIdentityLookup);
  const keys = new Set(teacherIdentityService.collectTeacherRecordIdsForPerson(resolvedPersonId, teacherPersonMap));
  keys.add(normalized);
  keys.add(resolvedPersonId);
  const linkedTeacherIds = teacherIdentityLookup?.personToTeacherIds?.get(resolvedPersonId);
  if (linkedTeacherIds instanceof Set) {
    linkedTeacherIds.forEach((teacherId) => {
      const token = cleanPersonId(teacherId);
      if (token) keys.add(token);
    });
  }
  Object.keys(indexRoot).forEach((key) => {
    if (idsEqual(key, normalized) || idsEqual(key, resolvedPersonId)) keys.add(key);
  });
  return [...keys].filter(Boolean);
}

function buildTeacherPersonMapFromLookup(teacherIdentityLookup = null) {
  const map = new Map();
  const teacherToPerson = teacherIdentityLookup?.teacherToPerson;
  if (teacherToPerson instanceof Map) {
    teacherToPerson.forEach((personId, teacherId) => {
      const teacherToken = String(teacherId || '').trim();
      const personToken = String(personId || '').trim();
      if (teacherToken && personToken) map.set(teacherToken, personToken);
    });
  }
  return map;
}

async function collectCandidateClassIdsForTeacher({
  orgId = '',
  personId = '',
  reqUser = null,
  teacherIdentityLookup = null,
  teacherIndex = {}
} = {}) {
  const teacherPersonMap = buildTeacherPersonMapFromLookup(teacherIdentityLookup);
  const normalizedPersonId = sessionConflictDetectionService.resolveTeacherPersonId(personId, teacherIdentityLookup) || cleanPersonId(personId);
  const classIds = new Set();
  const indexRoot = teacherIndex && typeof teacherIndex === 'object' && !Array.isArray(teacherIndex)
    ? teacherIndex
    : {};
  const indexKeys = resolveTeacherIndexKeys(indexRoot, normalizedPersonId, teacherIdentityLookup);
  indexKeys.forEach((key) => {
    const byDate = indexRoot[key];
    if (!byDate || typeof byDate !== 'object') return;
    Object.values(byDate).forEach((entries) => {
      (Array.isArray(entries) ? entries : []).forEach((entry) => {
        const classId = toPublicId(entry?.classId);
        if (classId) classIds.add(classId);
      });
    });
  });

  const classes = await schoolDataService.fetchAllData('classes', {}, reqUser).catch(() => []);
  let instructorClassCount = 0;
  (Array.isArray(classes) ? classes : []).forEach((classRow) => {
    if (orgId && classRow?.orgId && !idsEqual(classRow.orgId, orgId)) return;
    if (String(classRow?.status || '').trim().toLowerCase() === 'cancelled') return;
    const classId = toPublicId(classRow?.id);
    if (!classId) return;
    const instructors = Array.isArray(classRow?.instructors) ? classRow.instructors : [];
    const isInstructor = instructors.some((inst) => {
      const linkedPersonId = teacherIdentityService.resolveTeacherPersonId(inst?.personId, teacherPersonMap);
      return linkedPersonId && idsEqual(linkedPersonId, normalizedPersonId);
    });
    if (isInstructor) {
      instructorClassCount += 1;
      classIds.add(classId);
    }
  });

  return {
    classIds,
    instructorClassCount,
    normalizedPersonId
  };
}

function evaluatePartnerSessionCandidate({
  classId = '',
  session = {},
  sourceClassId = '',
  sourceSessionId = '',
  sourceStart = '',
  sourceEnd = '',
  resolvedMergingId = '',
  teacherIdentityLookup = null,
  statusMap = null,
  scan = null
} = {}) {
  const sessionId = toPublicId(session?.sessionId || session?.id);
  if (!classId || !sessionId) return null;
  if (idsEqual(classId, sourceClassId) && idsEqual(sessionId, sourceSessionId)) {
    if (scan?.rejectCounts) scan.rejectCounts.sameSession += 1;
    return null;
  }

  if (sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap(statusMap, {
    status: session?.status,
    notes: session?.notes
  })) {
    if (scan?.rejectCounts) scan.rejectCounts.excludedStatus += 1;
    return null;
  }

  const mainTeacherId = sessionDeliveryTeamService.getSessionMainTeacherId(session);
  const resolvedMain = sessionConflictDetectionService.resolveTeacherPersonId(mainTeacherId, teacherIdentityLookup) || mainTeacherId;
  const start = normalizeClock(session?.startTime);
  const end = normalizeClock(session?.endTime);

  if (!idsEqual(resolvedMain, resolvedMergingId)) {
    if (scan?.rejectCounts) scan.rejectCounts.notMainTeacher += 1;
    if (scan && start === sourceStart && end === sourceEnd) {
      scan.partialMatches.push({
        classId,
        sessionId,
        startTime: start,
        endTime: end,
        reason: 'not_main_teacher'
      });
    }
    return null;
  }

  if (start !== sourceStart || end !== sourceEnd) {
    if (scan?.rejectCounts) scan.rejectCounts.timeMismatch += 1;
    if (scan) {
      scan.partialMatches.push({
        classId,
        sessionId,
        startTime: start,
        endTime: end,
        reason: 'time_mismatch'
      });
    }
    return null;
  }

  return { classId, session, sessionId };
}

function isMergedSessionRow(session = {}) {
  return session?.merged?.isMergedSession === true;
}

function areMergeLinkedSessions(sessionA = {}, classIdA = '', sessionB = {}, classIdB = '') {
  const aClassId = toPublicId(classIdA || sessionA?.merged?.partnerClassId);
  const aSessionId = toPublicId(sessionA?.sessionId || sessionA?.id);
  const bClassId = toPublicId(classIdB || sessionB?.mergedPartner?.linkedClassId);
  const bSessionId = toPublicId(sessionB?.sessionId || sessionB?.id);

  if (sessionA?.merged?.isMergedSession === true) {
    const partnerClassId = toPublicId(sessionA?.merged?.partnerClassId);
    const partnerSessionId = toPublicId(sessionA?.merged?.partnerSessionId);
    if (partnerClassId && partnerSessionId && idsEqual(partnerClassId, classIdB) && idsEqual(partnerSessionId, bSessionId)) {
      return true;
    }
  }
  if (sessionB?.merged?.isMergedSession === true) {
    const partnerClassId = toPublicId(sessionB?.merged?.partnerClassId);
    const partnerSessionId = toPublicId(sessionB?.merged?.partnerSessionId);
    if (partnerClassId && partnerSessionId && idsEqual(partnerClassId, classIdA) && idsEqual(partnerSessionId, aSessionId)) {
      return true;
    }
  }
  if (sessionA?.mergedPartner?.ignoreScheduleConflict === true) {
    const linkedClassId = toPublicId(sessionA?.mergedPartner?.linkedClassId);
    const linkedSessionId = toPublicId(sessionA?.mergedPartner?.linkedSessionId);
    if (linkedClassId && linkedSessionId && idsEqual(linkedClassId, classIdB) && idsEqual(linkedSessionId, bSessionId)) {
      return true;
    }
  }
  if (sessionB?.mergedPartner?.ignoreScheduleConflict === true) {
    const linkedClassId = toPublicId(sessionB?.mergedPartner?.linkedClassId);
    const linkedSessionId = toPublicId(sessionB?.mergedPartner?.linkedSessionId);
    if (linkedClassId && linkedSessionId && idsEqual(linkedClassId, classIdA) && idsEqual(linkedSessionId, aSessionId)) {
      return true;
    }
  }
  return false;
}

async function resolvePersonDisplayName(personId, reqUser) {
  const pid = cleanPersonId(personId);
  if (!pid) return '';
  const personById = await schoolPersonAccessService.buildPersonByIdMap({ reqUser, personIds: [pid] });
  return schoolPersonAccessService.formatPersonName(personById.get(pid), pid);
}

async function loadClassTitle(classId, reqUser, cache = new Map()) {
  const token = toPublicId(classId);
  if (!token) return '';
  if (cache.has(token)) return cache.get(token);
  const classData = await schoolDataService.getDataById('classes', token, reqUser).catch(() => null);
  const title = String(classData?.title || classData?.name || token).trim();
  cache.set(token, title);
  return title;
}

function buildPartnerReference({
  classId = '',
  session = {},
  classTitle = '',
  statusMap = null,
  statusDefinitions = []
} = {}) {
  const sessionId = toPublicId(session?.sessionId || session?.id);
  const status = sessionStatusPolicyService.normalizeSessionStatus(session?.status, session?.notes);
  let statusLabel = status;
  if (statusMap instanceof Map) {
    const def = statusMap.get(status);
    if (def?.label) statusLabel = String(def.label).trim();
  } else {
    const def = (Array.isArray(statusDefinitions) ? statusDefinitions : []).find((row) => sessionStatusPolicyService.normalizeStatusCode(row?.code) === status);
    if (def?.label) statusLabel = String(def.label).trim();
  }
  return {
    classId: toPublicId(classId),
    sessionId,
    date: normalizeDateOnly(session?.date),
    startTime: normalizeClock(session?.startTime),
    endTime: normalizeClock(session?.endTime),
    durationHours: Number(session?.durationHours || 0),
    teacherId: sessionDeliveryTeamService.getSessionMainTeacherId(session),
    teacherName: String(session?.delivery?.deliveredByName || '').trim(),
    room: String(session?.room || '').trim(),
    status,
    statusLabel,
    classTitle: String(classTitle || classId || '').trim(),
    manageUrl: classId && sessionId
      ? `/school/classes/${encodeURIComponent(String(classId))}/sessions/${encodeURIComponent(String(sessionId))}`
      : ''
  };
}

async function scanPartnerSessionsForMerge({
  orgId = '',
  sourceClassId = '',
  sourceSession = {},
  mergingTeacherId = '',
  reqUser = null
} = {}) {
  const sourceSessionId = toPublicId(sourceSession?.sessionId || sourceSession?.id);
  const sourceDate = normalizeDateOnly(sourceSession?.date);
  const sourceStart = normalizeClock(sourceSession?.startTime);
  const sourceEnd = normalizeClock(sourceSession?.endTime);
  const mergingId = cleanPersonId(mergingTeacherId);

  if (!sourceSessionId || !sourceDate || !sourceStart || !sourceEnd) {
    throw new SessionMergeError('Source session date and time are required for merge.', {
      code: 'MERGE_SOURCE_INVALID',
      statusCode: 400
    });
  }
  if (!mergingId) {
    throw new SessionMergeError('Merging teacher is required.', {
      code: 'MERGE_TEACHER_REQUIRED',
      statusCode: 400
    });
  }

  const teacherIdentityLookup = await sessionConflictDetectionService.buildTeacherIdentityLookup({ activeOrgId: orgId, reqUser });
  const resolvedMergingId = sessionConflictDetectionService.resolveTeacherPersonId(mergingId, teacherIdentityLookup) || mergingId;

  const teacherIndex = await schoolDataService.getTeacherIndex();
  const indexRoot = teacherIndex && typeof teacherIndex === 'object' && !Array.isArray(teacherIndex)
    ? teacherIndex
    : {};

  const statusMap = await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
  const classTitleCache = new Map();
  const sessionCache = new Map();
  const indexKeys = resolveTeacherIndexKeys(indexRoot, resolvedMergingId, teacherIdentityLookup);
  const dayRows = [];
  const scan = {
    mergingTeacherId: resolvedMergingId,
    sourceDate,
    sourceStart,
    sourceEnd,
    indexKeyCount: indexKeys.length,
    indexRowCount: 0,
    lookupSource: 'teacher_index',
    classScanCandidateCount: 0,
    classScanSessionsOnDate: 0,
    instructorClassCount: 0,
    rejectCounts: {
      sameSession: 0,
      sessionNotFound: 0,
      excludedStatus: 0,
      notMainTeacher: 0,
      timeMismatch: 0
    },
    partialMatches: []
  };

  indexKeys.forEach((personKey) => {
    const personIndex = indexRoot[personKey] && typeof indexRoot[personKey] === 'object'
      ? indexRoot[personKey]
      : {};
    const rows = Array.isArray(personIndex[sourceDate]) ? personIndex[sourceDate] : [];
    rows.forEach((row) => dayRows.push(row));
  });
  scan.indexRowCount = dayRows.length;

  for (const indexRow of dayRows) {
    const classId = toPublicId(indexRow?.classId);
    const sessionId = toPublicId(indexRow?.sessionId);
    if (!classId || !sessionId) continue;

    if (!sessionCache.has(classId)) {
      const sessions = await schoolDataService.getClassSessions(classId, reqUser).catch(() => []);
      sessionCache.set(classId, Array.isArray(sessions) ? sessions : []);
    }
    const session = (sessionCache.get(classId) || []).find((row) => idsEqual(row?.sessionId || row?.id, sessionId));
    if (!session) {
      scan.rejectCounts.sessionNotFound += 1;
      continue;
    }

    const match = evaluatePartnerSessionCandidate({
      classId,
      session,
      sourceClassId,
      sourceSessionId,
      sourceStart,
      sourceEnd,
      resolvedMergingId,
      teacherIdentityLookup,
      statusMap,
      scan
    });
    if (!match) continue;

    const classTitle = await loadClassTitle(classId, reqUser, classTitleCache);
    return {
      partner: buildPartnerReference({
        classId,
        session,
        classTitle,
        statusMap
      }),
      scan
    };
  }

  const candidateInfo = await collectCandidateClassIdsForTeacher({
    orgId,
    personId: resolvedMergingId,
    reqUser,
    teacherIdentityLookup,
    teacherIndex: indexRoot
  });
  scan.classScanCandidateCount = candidateInfo.classIds.size;
  scan.instructorClassCount = candidateInfo.instructorClassCount;

  for (const classId of candidateInfo.classIds) {
    if (!sessionCache.has(classId)) {
      const sessions = await schoolDataService.getClassSessions(classId, reqUser).catch(() => []);
      sessionCache.set(classId, Array.isArray(sessions) ? sessions : []);
    }
    const sessionsOnDate = (sessionCache.get(classId) || []).filter((row) => normalizeDateOnly(row?.date) === sourceDate);
    scan.classScanSessionsOnDate += sessionsOnDate.length;
    for (const session of sessionsOnDate) {
      const match = evaluatePartnerSessionCandidate({
        classId,
        session,
        sourceClassId,
        sourceSessionId,
        sourceStart,
        sourceEnd,
        resolvedMergingId,
        teacherIdentityLookup,
        statusMap,
        scan
      });
      if (!match) continue;

      scan.lookupSource = 'class_scan';
      const classTitle = await loadClassTitle(classId, reqUser, classTitleCache);
      return {
        partner: buildPartnerReference({
          classId,
          session,
          classTitle,
          statusMap
        }),
        scan
      };
    }
  }

  return { partner: null, scan };
}

function buildPartnerMergeFailureMessage(scan = {}, teacherName = '') {
  const teacherLabel = String(teacherName || scan?.mergingTeacherId || 'This teacher').trim() || 'This teacher';
  const dateLabel = scan?.sourceDate || 'this date';
  const timeLabel = `${scan?.sourceStart || '--:--'} – ${scan?.sourceEnd || '--:--'}`;

  if (!scan?.indexRowCount && !scan?.classScanSessionsOnDate) {
    if (Number(scan?.instructorClassCount || 0) > 0) {
      return `${teacherLabel} is a class instructor on ${dateLabel}, but has no session there as the main teacher at ${timeLabel}. The schedule can show instructor classes even when this teacher is not the session main teacher. Merge needs another class session where ${teacherLabel} is the main teacher with the exact same start and end time.`;
    }
    return `${teacherLabel} has no main-teacher session on ${dateLabel} at ${timeLabel} in another class. Merge requires an exact date/time match where they are the main teacher on the partner session.`;
  }

  const coTeacherOnly = (scan.partialMatches || []).some((row) => row.reason === 'not_main_teacher');
  if (coTeacherOnly || Number(scan?.rejectCounts?.notMainTeacher || 0) > 0) {
    const hasExactTimeCoTeacher = (scan.partialMatches || []).some((row) => row.reason === 'not_main_teacher');
    if (hasExactTimeCoTeacher) {
      return `${teacherLabel} has a session on ${dateLabel} at ${timeLabel}, but only as a co-teacher. Merge requires a partner session where ${teacherLabel} is the main teacher with the exact same start and end time.`;
    }
  }

  if (Number(scan?.rejectCounts?.timeMismatch || 0) > 0) {
    const samples = (scan.partialMatches || [])
      .filter((row) => row.reason === 'time_mismatch')
      .slice(0, 3)
      .map((row) => `${row.startTime || '--:--'} – ${row.endTime || '--:--'}`)
      .join(', ');
    const sampleText = samples ? ` Found: ${samples}.` : '';
    return `${teacherLabel} has session(s) on ${dateLabel}, but none with the exact time ${timeLabel}.${sampleText} Merge requires an exact start/end match.`;
  }

  if (Number(scan?.rejectCounts?.excludedStatus || 0) > 0) {
    return `${teacherLabel} has session(s) on ${dateLabel}, but their status excludes them from the teacher schedule (for example cancelled or make-up).`;
  }

  return `${teacherLabel} cannot take over this session and merge it to their class. A partner session on ${dateLabel} at ${timeLabel} where they are the main teacher is required.`;
}

async function explainPartnerSessionMergeFailure(params = {}) {
  const { scan } = await scanPartnerSessionsForMerge(params);
  const teacherName = await resolvePersonDisplayName(params?.mergingTeacherId, params?.reqUser);
  return {
    code: 'MERGE_PARTNER_NOT_FOUND',
    message: buildPartnerMergeFailureMessage(scan, teacherName),
    scan
  };
}

async function findPartnerSessionForMerge(params = {}) {
  const { partner } = await scanPartnerSessionsForMerge(params);
  return partner;
}

async function executeSessionMerge({
  sourceClassId = '',
  sourceSessionId = '',
  mergingTeacherId = '',
  partnerClassId = '',
  partnerSessionId = '',
  mergedStatusCode = 'merged_session',
  reqUser = null
} = {}) {
  const sourceClassToken = toPublicId(sourceClassId);
  const sourceSessionToken = toPublicId(sourceSessionId);
  const partnerClassToken = toPublicId(partnerClassId);
  const partnerSessionToken = toPublicId(partnerSessionId);
  const mergingId = cleanPersonId(mergingTeacherId);
  const mergedCode = sessionStatusPolicyService.normalizeStatusCode(mergedStatusCode) || 'merged_session';

  if (!sourceClassToken || !sourceSessionToken || !partnerClassToken || !partnerSessionToken || !mergingId) {
    throw new SessionMergeError('Source session, partner session, and merging teacher are required.', {
      code: 'MERGE_PAYLOAD_INVALID',
      statusCode: 400
    });
  }

  const sourceClassData = await schoolDataService.getDataById('classes', sourceClassToken, reqUser);
  if (!sourceClassData) throw new SessionMergeError('Source class not found.', { code: 'MERGE_SOURCE_CLASS_NOT_FOUND', statusCode: 404 });

  const orgId = toPublicId(sourceClassData?.orgId) || '';
  const statusMap = await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
  if (!statusMap.has(mergedCode)) {
    throw new SessionMergeError('Invalid merged session status.', { code: 'MERGE_STATUS_INVALID', statusCode: 400 });
  }

  const sourceSessions = await schoolDataService.getClassSessions(sourceClassToken, reqUser);
  const sourceIndex = (Array.isArray(sourceSessions) ? sourceSessions : [])
    .findIndex((row) => idsEqual(row?.sessionId || row?.id, sourceSessionToken));
  if (sourceIndex < 0) {
    throw new SessionMergeError('Source session not found.', { code: 'MERGE_SOURCE_NOT_FOUND', statusCode: 404 });
  }

  const sourceSession = sourceSessions[sourceIndex];
  if (isMergedSessionRow(sourceSession)) {
    throw new SessionMergeError('This session has already been merged.', { code: 'MERGE_ALREADY_COMPLETED', statusCode: 409 });
  }

  const previewPartner = await findPartnerSessionForMerge({
    orgId,
    sourceClassId: sourceClassToken,
    sourceSession,
    mergingTeacherId: mergingId,
    reqUser
  });
  if (!previewPartner) {
    const failure = await explainPartnerSessionMergeFailure({
      orgId,
      sourceClassId: sourceClassToken,
      sourceSession,
      mergingTeacherId: mergingId,
      reqUser
    });
    throw new SessionMergeError(failure?.message || 'This teacher cannot take over this session and merge it to their class.', {
      code: failure?.code || 'MERGE_PARTNER_NOT_FOUND',
      statusCode: 409,
      data: failure?.scan ? { scan: failure.scan } : null
    });
  }
  if (!idsEqual(previewPartner.classId, partnerClassToken) || !idsEqual(previewPartner.sessionId, partnerSessionToken)) {
    throw new SessionMergeError('Partner session does not match the teacher\'s schedule at this time.', {
      code: 'MERGE_PARTNER_MISMATCH',
      statusCode: 409,
      data: { expectedPartner: previewPartner }
    });
  }

  const teacherIdentityLookup = await sessionConflictDetectionService.buildTeacherIdentityLookup({ activeOrgId: orgId, reqUser });
  const resolvedMergingId = sessionConflictDetectionService.resolveTeacherPersonId(mergingId, teacherIdentityLookup) || mergingId;
  const previousTeacherId = sessionDeliveryTeamService.getSessionMainTeacherId(sourceSession);
  const resolvedPreviousId = sessionConflictDetectionService.resolveTeacherPersonId(previousTeacherId, teacherIdentityLookup) || previousTeacherId;

  if (idsEqual(resolvedPreviousId, resolvedMergingId)) {
    throw new SessionMergeError('The selected teacher is already the main teacher for this session.', {
      code: 'MERGE_SAME_TEACHER',
      statusCode: 409
    });
  }

  const partnerSessions = await schoolDataService.getClassSessions(partnerClassToken, reqUser);
  const partnerIndex = (Array.isArray(partnerSessions) ? partnerSessions : [])
    .findIndex((row) => idsEqual(row?.sessionId || row?.id, partnerSessionToken));
  if (partnerIndex < 0) {
    throw new SessionMergeError('Partner session not found.', { code: 'MERGE_PARTNER_NOT_FOUND', statusCode: 404 });
  }

  const partnerSession = partnerSessions[partnerIndex];
  const mergingTeacherName = await resolvePersonDisplayName(resolvedMergingId, reqUser);
  const previousTeacherName = await resolvePersonDisplayName(resolvedPreviousId, reqUser);
  const now = new Date().toISOString();
  const actorId = toPublicId(reqUser?.id || reqUser?.username || '');
  const actorPersonId = toPublicId(reqUser?.personId || reqUser?.id || '');

  const existingCoTeachers = sessionDeliveryTeamService.getSessionCoTeachers(sourceSession)
    .filter((row) => !idsEqual(row.personId, resolvedMergingId) && !idsEqual(row.personId, resolvedPreviousId));
  const coTeachersWithPrevious = [
    ...existingCoTeachers,
    {
      personId: resolvedPreviousId,
      name: previousTeacherName || resolvedPreviousId,
      roleLabel: 'Previous Teacher',
      paid: false,
      paidHours: 0,
      canEdit: false
    }
  ];

  sourceSession.status = mergedCode;
  sourceSession.delivery = sessionDeliveryTeamService.applyCoTeachersToDelivery(
    {
      ...(sourceSession.delivery || {}),
      deliveredBy: resolvedMergingId,
      deliveredByName: mergingTeacherName || resolvedMergingId
    },
    coTeachersWithPrevious,
    { mainTeacherId: resolvedMergingId }
  );
  sourceSession.merged = {
    isMergedSession: true,
    partnerClassId: partnerClassToken,
    partnerSessionId: partnerSessionToken,
    mergingTeacherId: resolvedMergingId,
    previousTeacherId: resolvedPreviousId,
    mergedAt: now,
    mergedBy: actorId,
    mergedByPersonId: actorPersonId
  };
  sourceSession.audit = {
    ...(sourceSession.audit || {}),
    lastUpdateUser: actorId,
    lastUpdateDateTime: now
  };

  partnerSession.mergedPartner = {
    linkedClassId: sourceClassToken,
    linkedSessionId: sourceSessionToken,
    ignoreScheduleConflict: true,
    linkedAt: now,
    linkedBy: actorId
  };
  partnerSession.audit = {
    ...(partnerSession.audit || {}),
    lastUpdateUser: actorId,
    lastUpdateDateTime: now
  };

  sourceSessions[sourceIndex] = sourceSession;
  partnerSessions[partnerIndex] = partnerSession;

  await schoolDataService.saveClassSessions(sourceClassToken, sourceSessions, reqUser);
  await schoolDataService.saveClassSessions(partnerClassToken, partnerSessions, reqUser);
  await schoolIndexService.rebuildIndexesForClass(sourceClassToken);
  await schoolIndexService.rebuildIndexesForClass(partnerClassToken);

  const partnerSummary = buildPartnerReference({
    classId: partnerClassToken,
    session: partnerSession,
    classTitle: await loadClassTitle(partnerClassToken, reqUser),
    statusMap
  });

  return {
    sourceClassId: sourceClassToken,
    sourceSessionId: sourceSessionToken,
    sourceSession,
    partnerSummary,
    mergingTeacherId: resolvedMergingId,
    mergingTeacherName: mergingTeacherName || resolvedMergingId,
    previousTeacherId: resolvedPreviousId,
    previousTeacherName: previousTeacherName || resolvedPreviousId
  };
}

function isMergeAddedPreviousTeacherCoTeacher(row = {}, previousTeacherId = '') {
  if (!row || !previousTeacherId) return false;
  if (!idsEqual(row.personId, previousTeacherId)) return false;
  return String(row.roleLabel || '').trim() === 'Previous Teacher';
}

function removeMergeAddedCoTeachers(coTeachers = [], previousTeacherId = '', mergingTeacherId = '') {
  return (Array.isArray(coTeachers) ? coTeachers : []).filter((row) => {
    if (!row || !row.personId) return false;
    if (mergingTeacherId && idsEqual(row.personId, mergingTeacherId)) return false;
    if (isMergeAddedPreviousTeacherCoTeacher(row, previousTeacherId)) return false;
    return true;
  });
}

async function executeSessionUnmerge({
  sourceClassId = '',
  sourceSessionId = '',
  reqUser = null
} = {}) {
  const sourceClassToken = toPublicId(sourceClassId);
  const sourceSessionToken = toPublicId(sourceSessionId);

  if (!sourceClassToken || !sourceSessionToken) {
    throw new SessionMergeError('Source session is required for unmerge.', {
      code: 'MERGE_PAYLOAD_INVALID',
      statusCode: 400
    });
  }

  const sourceClassData = await schoolDataService.getDataById('classes', sourceClassToken, reqUser);
  if (!sourceClassData) {
    throw new SessionMergeError('Source class not found.', { code: 'MERGE_SOURCE_CLASS_NOT_FOUND', statusCode: 404 });
  }

  const orgId = toPublicId(sourceClassData?.orgId) || '';
  const statusMap = await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
  const scheduledCode = sessionStatusPolicyService.normalizeStatusCode('scheduled');
  if (!statusMap.has(scheduledCode)) {
    throw new SessionMergeError('Scheduled status is not configured for this organization.', {
      code: 'MERGE_STATUS_INVALID',
      statusCode: 400
    });
  }

  const sourceSessions = await schoolDataService.getClassSessions(sourceClassToken, reqUser);
  const sourceIndex = (Array.isArray(sourceSessions) ? sourceSessions : [])
    .findIndex((row) => idsEqual(row?.sessionId || row?.id, sourceSessionToken));
  if (sourceIndex < 0) {
    throw new SessionMergeError('Source session not found.', { code: 'MERGE_SOURCE_NOT_FOUND', statusCode: 404 });
  }

  const sourceSession = sourceSessions[sourceIndex];
  if (!isMergedSessionRow(sourceSession)) {
    throw new SessionMergeError('This session has not been merged.', {
      code: 'MERGE_NOT_APPLIED',
      statusCode: 409
    });
  }

  const partnerClassToken = toPublicId(sourceSession?.merged?.partnerClassId);
  const partnerSessionToken = toPublicId(sourceSession?.merged?.partnerSessionId);
  if (!partnerClassToken || !partnerSessionToken) {
    throw new SessionMergeError('Merged session is missing partner reference metadata.', {
      code: 'MERGE_NOT_APPLIED',
      statusCode: 409
    });
  }

  const partnerSessions = await schoolDataService.getClassSessions(partnerClassToken, reqUser);
  const partnerIndex = (Array.isArray(partnerSessions) ? partnerSessions : [])
    .findIndex((row) => idsEqual(row?.sessionId || row?.id, partnerSessionToken));
  if (partnerIndex < 0) {
    throw new SessionMergeError('Partner session not found.', { code: 'MERGE_PARTNER_NOT_FOUND', statusCode: 404 });
  }

  const partnerSession = partnerSessions[partnerIndex];
  if (!areMergeLinkedSessions(sourceSession, sourceClassToken, partnerSession, partnerClassToken)) {
    throw new SessionMergeError('Partner session does not match this merged session link.', {
      code: 'MERGE_PARTNER_MISMATCH',
      statusCode: 409
    });
  }

  const teacherIdentityLookup = await sessionConflictDetectionService.buildTeacherIdentityLookup({ activeOrgId: orgId, reqUser });
  const resolvedPreviousId = sessionConflictDetectionService.resolveTeacherPersonId(
    sourceSession?.merged?.previousTeacherId,
    teacherIdentityLookup
  ) || cleanPersonId(sourceSession?.merged?.previousTeacherId);
  const resolvedMergingId = sessionConflictDetectionService.resolveTeacherPersonId(
    sourceSession?.merged?.mergingTeacherId,
    teacherIdentityLookup
  ) || cleanPersonId(sourceSession?.merged?.mergingTeacherId);

  if (!resolvedPreviousId) {
    throw new SessionMergeError('Cannot unmerge because the previous teacher reference is missing.', {
      code: 'MERGE_NOT_APPLIED',
      statusCode: 409
    });
  }

  const previousTeacherName = await resolvePersonDisplayName(resolvedPreviousId, reqUser);
  const now = new Date().toISOString();
  const actorId = toPublicId(reqUser?.id || reqUser?.username || '');

  const restoredCoTeachers = removeMergeAddedCoTeachers(
    sessionDeliveryTeamService.getSessionCoTeachers(sourceSession),
    resolvedPreviousId,
    resolvedMergingId
  );

  sourceSession.status = scheduledCode;
  sourceSession.delivery = sessionDeliveryTeamService.applyCoTeachersToDelivery(
    {
      ...(sourceSession.delivery || {}),
      deliveredBy: resolvedPreviousId,
      deliveredByName: previousTeacherName || resolvedPreviousId
    },
    restoredCoTeachers,
    { mainTeacherId: resolvedPreviousId }
  );
  delete sourceSession.merged;
  sourceSession.audit = {
    ...(sourceSession.audit || {}),
    lastUpdateUser: actorId,
    lastUpdateDateTime: now
  };

  delete partnerSession.mergedPartner;
  partnerSession.audit = {
    ...(partnerSession.audit || {}),
    lastUpdateUser: actorId,
    lastUpdateDateTime: now
  };

  sourceSessions[sourceIndex] = sourceSession;
  partnerSessions[partnerIndex] = partnerSession;

  await schoolDataService.saveClassSessions(sourceClassToken, sourceSessions, reqUser);
  await schoolDataService.saveClassSessions(partnerClassToken, partnerSessions, reqUser);
  await schoolIndexService.rebuildIndexesForClass(sourceClassToken);
  await schoolIndexService.rebuildIndexesForClass(partnerClassToken);

  const partnerSummary = buildPartnerReference({
    classId: partnerClassToken,
    session: partnerSession,
    classTitle: await loadClassTitle(partnerClassToken, reqUser),
    statusMap
  });

  return {
    sourceClassId: sourceClassToken,
    sourceSessionId: sourceSessionToken,
    sourceSession,
    partnerSummary,
    restoredTeacherId: resolvedPreviousId,
    restoredTeacherName: previousTeacherName || resolvedPreviousId,
    restoredStatus: scheduledCode
  };
}

module.exports = {
  SessionMergeError,
  normalizeClock,
  normalizeDateOnly,
  isMergedSessionRow,
  areMergeLinkedSessions,
  scanPartnerSessionsForMerge,
  explainPartnerSessionMergeFailure,
  findPartnerSessionForMerge,
  executeSessionMerge,
  executeSessionUnmerge,
  isMergeAddedPreviousTeacherCoTeacher,
  removeMergeAddedCoTeachers,
  buildPartnerReference,
  resolvePersonDisplayName
};
