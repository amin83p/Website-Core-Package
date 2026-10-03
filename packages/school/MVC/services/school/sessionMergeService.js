'use strict';

const schoolDataService = require('./schoolDataService');
const schoolIndexService = require('./schoolIndexService');
const schoolDependencyService = require('./schoolDependencyService');
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

function timeToMinutes(value) {
  const token = normalizeClock(value);
  if (!token) return NaN;
  const [hours, minutes] = token.split(':').map(Number);
  return (hours * 60) + minutes;
}

function partnerSessionCoversMergingWindow({
  partnerStart = '',
  partnerEnd = '',
  sourceStart = '',
  sourceEnd = ''
} = {}) {
  const pStart = timeToMinutes(partnerStart);
  const pEnd = timeToMinutes(partnerEnd);
  const sStart = timeToMinutes(sourceStart);
  const sEnd = timeToMinutes(sourceEnd);
  if (![pStart, pEnd, sStart, sEnd].every(Number.isFinite)) return false;
  if (pEnd <= pStart || sEnd <= sStart) return false;
  return pStart <= sStart && pEnd >= sEnd;
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

  const coversMergingWindow = partnerSessionCoversMergingWindow({
    partnerStart: start,
    partnerEnd: end,
    sourceStart,
    sourceEnd
  });

  if (!idsEqual(resolvedMain, resolvedMergingId)) {
    if (scan?.rejectCounts) scan.rejectCounts.notMainTeacher += 1;
    if (scan && coversMergingWindow) {
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

  if (!coversMergingWindow) {
    if (scan?.rejectCounts) scan.rejectCounts.timeMismatch += 1;
    if (scan) {
      scan.partialMatches.push({
        classId,
        sessionId,
        startTime: start,
        endTime: end,
        reason: 'outside_merging_window'
      });
    }
    return null;
  }

  return { classId, session, sessionId };
}

function isMergedSessionRow(session = {}) {
  return session?.merged?.isMergedSession === true;
}

function canUserUndoSessionMerge(session = {}, personId = '', { isClassAdmin = false, isSessionAdmin = false } = {}) {
  if (!isMergedSessionRow(session)) return false;
  if (isClassAdmin || isSessionAdmin) return true;
  const viewerId = toPublicId(personId);
  if (!viewerId) return false;
  const mergingId = toPublicId(session?.merged?.mergingTeacherId);
  if (mergingId && idsEqual(viewerId, mergingId)) return true;
  if (isPersonMergedPreviousTeacherEditor(session, personId)) return true;
  return false;
}

function isPersonMergedPreviousTeacherEditor(session = {}, personId = '') {
  if (!isMergedSessionRow(session)) return false;
  const viewerId = toPublicId(personId);
  if (!viewerId) return false;
  const previousId = toPublicId(session?.merged?.previousTeacherId);
  if (previousId && idsEqual(viewerId, previousId)) return true;
  const coTeachers = sessionDeliveryTeamService.getSessionCoTeachers(session);
  return coTeachers.some((row) => isMergeAddedPreviousTeacherCoTeacher(row, viewerId));
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

  const coverageRequirement = `The partner session must start at or before ${scan?.sourceStart || '--:--'} and end at or after ${scan?.sourceEnd || '--:--'}.`;

  if (!scan?.indexRowCount && !scan?.classScanSessionsOnDate) {
    if (Number(scan?.instructorClassCount || 0) > 0) {
      return `${teacherLabel} is a class instructor on ${dateLabel}, but has no session there as the main teacher that fully covers ${timeLabel}. The schedule can show instructor classes even when this teacher is not the session main teacher. Merge needs another class session where ${teacherLabel} is the main teacher and ${coverageRequirement}`;
    }
    return `${teacherLabel} has no main-teacher session on ${dateLabel} that fully covers ${timeLabel} in another class. Merge requires a partner session on the same date where they are the main teacher and ${coverageRequirement}`;
  }

  const coTeacherOnly = (scan.partialMatches || []).some((row) => row.reason === 'not_main_teacher');
  if (coTeacherOnly || Number(scan?.rejectCounts?.notMainTeacher || 0) > 0) {
    const hasCoveringCoTeacher = (scan.partialMatches || []).some((row) => row.reason === 'not_main_teacher');
    if (hasCoveringCoTeacher) {
      return `${teacherLabel} has a session on ${dateLabel} that could cover ${timeLabel}, but only as a co-teacher. Merge requires a partner session where ${teacherLabel} is the main teacher and ${coverageRequirement}`;
    }
  }

  if (Number(scan?.rejectCounts?.timeMismatch || 0) > 0) {
    const samples = (scan.partialMatches || [])
      .filter((row) => row.reason === 'outside_merging_window' || row.reason === 'time_mismatch')
      .slice(0, 3)
      .map((row) => `${row.startTime || '--:--'} – ${row.endTime || '--:--'}`)
      .join(', ');
    const sampleText = samples ? ` Found: ${samples}.` : '';
    return `${teacherLabel} has session(s) on ${dateLabel}, but none that fully cover ${timeLabel}.${sampleText} ${coverageRequirement}`;
  }

  if (Number(scan?.rejectCounts?.excludedStatus || 0) > 0) {
    return `${teacherLabel} has session(s) on ${dateLabel}, but their status excludes them from the teacher schedule (for example cancelled or make-up).`;
  }

  return `${teacherLabel} cannot take over this session and merge it to their class. A partner session on ${dateLabel} that fully covers ${timeLabel} where they are the main teacher is required. ${coverageRequirement}`;
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

function partnerHasTakeoverLink(session = {}) {
  const linkedClassId = toPublicId(session?.mergedPartner?.linkedClassId);
  const linkedSessionId = toPublicId(session?.mergedPartner?.linkedSessionId);
  return Boolean(linkedClassId && linkedSessionId);
}

function isApprovedTimesheetLocked(session = {}) {
  return schoolDependencyService.isSessionTimesheetLocked(session)
    && String(session?.lockReason || '') === 'timesheet_approved';
}

function partnerAssignmentKey(partner = {}) {
  return `${toPublicId(partner.classId)}::${toPublicId(partner.sessionId)}`;
}

function sourceWarningRef(source = {}) {
  return {
    classId: toPublicId(source.classId),
    sessionId: toPublicId(source.sessionId),
    date: normalizeDateOnly(source.date),
    startTime: normalizeClock(source.startTime),
    endTime: normalizeClock(source.endTime)
  };
}

function mergeBlockerMessage(code, count) {
  const these = count === 1 ? 'This session' : 'These sessions';
  switch (code) {
    case 'ALREADY_MERGED':
      return count === 1
        ? 'This session has already been merged.'
        : 'These sessions have already been merged.';
    case 'TIMESHEET_LOCKED':
      return `${these} ${count === 1 ? 'is' : 'are'} locked by an approved timesheet.`;
    case 'SAME_TEACHER':
      return count === 1
        ? 'The selected teacher is already the main teacher for this session.'
        : 'The selected teacher is already the main teacher for these sessions.';
    case 'NO_PARTNER':
      return count === 1
        ? 'The selected teacher has no session that fully covers this session.'
        : 'The selected teacher has no session that fully covers these sessions.';
    case 'SHARED_PARTNER':
      return 'These sessions only fit inside the same partner session. Each selected session needs its own covering session.';
    default:
      return count === 1
        ? 'Resolve this session before continuing.'
        : 'Resolve these sessions before continuing.';
  }
}

function groupMergeBlockers(rows) {
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
      classId: row.classId,
      sessionId: row.sessionId,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime
    });
  });
  return grouped.map((group) => ({
    code: group.code,
    message: mergeBlockerMessage(group.code, group.sessions.length),
    sessions: group.sessions
  }));
}

function rankCoveringPartners(source = {}, partners = []) {
  const sourceStart = normalizeClock(source.startTime);
  const sourceEnd = normalizeClock(source.endTime);
  return partners.slice().sort((a, b) => {
    const aExact = normalizeClock(a.startTime) === sourceStart && normalizeClock(a.endTime) === sourceEnd ? 0 : 1;
    const bExact = normalizeClock(b.startTime) === sourceStart && normalizeClock(b.endTime) === sourceEnd ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aLength = timeToMinutes(a.endTime) - timeToMinutes(a.startTime);
    const bLength = timeToMinutes(b.endTime) - timeToMinutes(b.startTime);
    if (aLength !== bLength) return aLength - bLength;
    return partnerAssignmentKey(a).localeCompare(partnerAssignmentKey(b));
  });
}

function assignUniqueCoveringPartners(eligible = []) {
  if (!eligible.length) return [];
  const order = eligible
    .map((row, index) => ({ index, count: row.partners.length }))
    .sort((a, b) => a.count - b.count || a.index - b.index);
  const used = new Set();
  const assignment = new Array(eligible.length);
  function walk(position) {
    if (position >= order.length) return true;
    const sourceIndex = order[position].index;
    const ranked = rankCoveringPartners(eligible[sourceIndex].warning, eligible[sourceIndex].partners);
    for (const partner of ranked) {
      const key = partnerAssignmentKey(partner);
      if (!key || used.has(key)) continue;
      used.add(key);
      assignment[sourceIndex] = partner;
      if (walk(position + 1)) return true;
      used.delete(key);
      assignment[sourceIndex] = null;
    }
    return false;
  }
  return walk(0) ? assignment : null;
}

function connectedEligibleGroups(eligible = []) {
  const parent = eligible.map((_, index) => index);
  function find(index) {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  }
  function union(left, right) {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[leftRoot] = rightRoot;
  }
  const firstSourceByPartner = new Map();
  eligible.forEach((row, index) => {
    row.partners.forEach((partner) => {
      const key = partnerAssignmentKey(partner);
      if (!key) return;
      if (firstSourceByPartner.has(key)) union(firstSourceByPartner.get(key), index);
      else firstSourceByPartner.set(key, index);
    });
  });
  const groups = new Map();
  eligible.forEach((row, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(row);
  });
  return [...groups.values()];
}

function planSessionMergeAssignments({
  sources = [],
  mergingTeacherId = ''
} = {}) {
  const mergingId = cleanPersonId(mergingTeacherId);
  const blocked = [];
  const eligible = [];
  (Array.isArray(sources) ? sources : []).forEach((source) => {
    const warning = sourceWarningRef(source);
    if (source?.alreadyMerged) {
      blocked.push({ code: 'ALREADY_MERGED', ...warning });
      return;
    }
    if (source?.timesheetLocked) {
      blocked.push({ code: 'TIMESHEET_LOCKED', ...warning });
      return;
    }
    if (mergingId && idsEqual(source?.mainTeacherId, mergingId)) {
      blocked.push({ code: 'SAME_TEACHER', ...warning });
      return;
    }
    const partners = Array.isArray(source?.partners) ? source.partners : [];
    if (!partners.length) {
      blocked.push({ code: 'NO_PARTNER', ...warning });
      return;
    }
    eligible.push({ warning, partners });
  });

  let matches = [];
  if (!blocked.length && eligible.length) {
    const assignment = assignUniqueCoveringPartners(eligible);
    if (assignment) {
      matches = eligible.map((row, index) => ({
        ...row.warning,
        sourceClassId: row.warning.classId,
        sourceSessionId: row.warning.sessionId,
        partner: assignment[index]
      }));
    } else {
      connectedEligibleGroups(eligible).forEach((group) => {
        if (assignUniqueCoveringPartners(group)) return;
        group.forEach((row) => blocked.push({ code: 'SHARED_PARTNER', ...row.warning }));
      });
    }
  }

  const blockers = groupMergeBlockers(blocked);
  const sourceCount = Array.isArray(sources) ? sources.length : 0;
  return {
    canContinue: blockers.length === 0 && matches.length === sourceCount && sourceCount > 0,
    blockers,
    matches
  };
}

async function rememberClassSessions(classId, reqUser, sessionCache) {
  const token = toPublicId(classId);
  if (!token || sessionCache.has(token)) return;
  const sessions = await schoolDataService.getClassSessions(token, reqUser).catch(() => []);
  sessionCache.set(token, Array.isArray(sessions) ? sessions : []);
}

async function listCoveringPartnersForSource({
  sourceClassId = '',
  sourceSession = {},
  resolvedMergingId = '',
  teacherIdentityLookup = null,
  statusMap = null,
  indexRoot = {},
  candidateClassIds = [],
  reqUser = null,
  sessionCache = new Map(),
  classTitleCache = new Map()
} = {}) {
  const sourceSessionId = toPublicId(sourceSession?.sessionId || sourceSession?.id);
  const sourceDate = normalizeDateOnly(sourceSession?.date);
  const sourceStart = normalizeClock(sourceSession?.startTime);
  const sourceEnd = normalizeClock(sourceSession?.endTime);
  if (!sourceSessionId || !sourceDate || !sourceStart || !sourceEnd || !resolvedMergingId) return [];

  const found = new Map();
  async function consider(classId, session) {
    if (!session || partnerHasTakeoverLink(session)) return;
    const match = evaluatePartnerSessionCandidate({
      classId,
      session,
      sourceClassId,
      sourceSessionId,
      sourceStart,
      sourceEnd,
      resolvedMergingId,
      teacherIdentityLookup,
      statusMap
    });
    if (!match) return;
    const key = partnerAssignmentKey({ classId, sessionId: match.sessionId });
    if (!key || found.has(key)) return;
    const classTitle = await loadClassTitle(classId, reqUser, classTitleCache);
    found.set(key, buildPartnerReference({
      classId,
      session,
      classTitle,
      statusMap
    }));
  }

  const indexKeys = resolveTeacherIndexKeys(indexRoot, resolvedMergingId, teacherIdentityLookup);
  const dayRows = [];
  indexKeys.forEach((personKey) => {
    const personIndex = indexRoot[personKey] && typeof indexRoot[personKey] === 'object'
      ? indexRoot[personKey]
      : {};
    const rows = Array.isArray(personIndex[sourceDate]) ? personIndex[sourceDate] : [];
    rows.forEach((row) => dayRows.push(row));
  });
  for (const indexRow of dayRows) {
    const classId = toPublicId(indexRow?.classId);
    const sessionId = toPublicId(indexRow?.sessionId);
    if (!classId || !sessionId) continue;
    await rememberClassSessions(classId, reqUser, sessionCache);
    const session = (sessionCache.get(classId) || []).find((row) => idsEqual(row?.sessionId || row?.id, sessionId));
    await consider(classId, session);
  }

  for (const classId of candidateClassIds) {
    await rememberClassSessions(classId, reqUser, sessionCache);
    const sessionsOnDate = (sessionCache.get(toPublicId(classId)) || []).filter((row) => normalizeDateOnly(row?.date) === sourceDate);
    for (const session of sessionsOnDate) {
      await consider(classId, session);
    }
  }
  return [...found.values()];
}

async function previewSessionMergeBatch({
  orgId = '',
  mergingTeacherId = '',
  sourceRows = [],
  reqUser = null
} = {}) {
  const mergingId = cleanPersonId(mergingTeacherId);
  if (!mergingId) {
    throw new SessionMergeError('Choose a teacher.', {
      code: 'MERGE_TEACHER_REQUIRED',
      statusCode: 400
    });
  }
  const rows = Array.isArray(sourceRows) ? sourceRows : [];
  if (!rows.length) {
    throw new SessionMergeError('Select at least one saved session.', {
      code: 'MERGE_SOURCE_INVALID',
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
  const sessionCache = new Map();
  const classTitleCache = new Map();
  const candidateInfo = await collectCandidateClassIdsForTeacher({
    orgId,
    personId: resolvedMergingId,
    reqUser,
    teacherIdentityLookup,
    teacherIndex: indexRoot
  });

  const sources = [];
  for (const row of rows) {
    const session = row?.session || {};
    const classId = toPublicId(row?.classId);
    const mainTeacherId = sessionDeliveryTeamService.getSessionMainTeacherId(session);
    const resolvedMain = sessionConflictDetectionService.resolveTeacherPersonId(mainTeacherId, teacherIdentityLookup) || mainTeacherId;
    const partners = await listCoveringPartnersForSource({
      sourceClassId: classId,
      sourceSession: session,
      resolvedMergingId,
      teacherIdentityLookup,
      statusMap,
      indexRoot,
      candidateClassIds: candidateInfo.classIds,
      reqUser,
      sessionCache,
      classTitleCache
    });
    sources.push({
      classId,
      sessionId: toPublicId(session.sessionId || session.id),
      date: session.date,
      startTime: session.startTime,
      endTime: session.endTime,
      mainTeacherId: resolvedMain,
      alreadyMerged: isMergedSessionRow(session),
      timesheetLocked: isApprovedTimesheetLocked(session),
      partners
    });
  }

  const plan = planSessionMergeAssignments({ sources, mergingTeacherId: resolvedMergingId });
  const mergingTeacherName = await resolvePersonDisplayName(resolvedMergingId, reqUser);
  return {
    ...plan,
    mergingTeacherId: resolvedMergingId,
    mergingTeacherName: mergingTeacherName || resolvedMergingId
  };
}

function writeSessionMergeLink({
  sourceSession,
  partnerSession,
  sourceClassId,
  sourceSessionId,
  partnerClassId,
  partnerSessionId,
  resolvedMergingId,
  mergingTeacherName,
  resolvedPreviousId,
  previousTeacherName,
  mergedCode,
  now,
  actorId,
  actorPersonId
} = {}) {
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
    partnerClassId: toPublicId(partnerClassId),
    partnerSessionId: toPublicId(partnerSessionId),
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
    linkedClassId: toPublicId(sourceClassId),
    linkedSessionId: toPublicId(sourceSessionId),
    ignoreScheduleConflict: true,
    linkedAt: now,
    linkedBy: actorId
  };
  partnerSession.audit = {
    ...(partnerSession.audit || {}),
    lastUpdateUser: actorId,
    lastUpdateDateTime: now
  };
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

  writeSessionMergeLink({
    sourceSession,
    partnerSession,
    sourceClassId: sourceClassToken,
    sourceSessionId: sourceSessionToken,
    partnerClassId: partnerClassToken,
    partnerSessionId: partnerSessionToken,
    resolvedMergingId,
    mergingTeacherName,
    resolvedPreviousId,
    previousTeacherName,
    mergedCode,
    now,
    actorId,
    actorPersonId
  });

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

async function executeSessionMergeBatch({
  orgId = '',
  mergingTeacherId = '',
  matches = [],
  mergedStatusCode = 'merged_session',
  reqUser = null
} = {}) {
  const mergingId = cleanPersonId(mergingTeacherId);
  const planned = Array.isArray(matches) ? matches : [];
  const mergedCode = sessionStatusPolicyService.normalizeStatusCode(mergedStatusCode) || 'merged_session';
  if (!mergingId || !planned.length) {
    throw new SessionMergeError('Source sessions and a merging teacher are required.', {
      code: 'MERGE_PAYLOAD_INVALID',
      statusCode: 400
    });
  }

  const statusMap = await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
  if (!statusMap.has(mergedCode)) {
    throw new SessionMergeError('Invalid merged session status.', { code: 'MERGE_STATUS_INVALID', statusCode: 400 });
  }

  const teacherIdentityLookup = await sessionConflictDetectionService.buildTeacherIdentityLookup({ activeOrgId: orgId, reqUser });
  const resolvedMergingId = sessionConflictDetectionService.resolveTeacherPersonId(mergingId, teacherIdentityLookup) || mergingId;
  const mergingTeacherName = await resolvePersonDisplayName(resolvedMergingId, reqUser);
  const classIds = new Set();
  planned.forEach((match) => {
    const sourceClassId = toPublicId(match?.sourceClassId);
    const partnerClassId = toPublicId(match?.partner?.classId || match?.partnerClassId);
    if (sourceClassId) classIds.add(sourceClassId);
    if (partnerClassId) classIds.add(partnerClassId);
  });

  const sessionsByClass = new Map();
  for (const classId of classIds) {
    const sessions = await schoolDataService.getClassSessions(classId, reqUser);
    sessionsByClass.set(classId, Array.isArray(sessions) ? sessions : []);
  }

  const now = new Date().toISOString();
  const actorId = toPublicId(reqUser?.id || reqUser?.username || '');
  const actorPersonId = toPublicId(reqUser?.personId || reqUser?.id || '');
  const nameCache = new Map();
  async function personName(personId) {
    const token = cleanPersonId(personId);
    if (!token) return '';
    if (nameCache.has(token)) return nameCache.get(token);
    const name = await resolvePersonDisplayName(token, reqUser);
    nameCache.set(token, name);
    return name;
  }

  const prepared = [];
  const usedPartners = new Set();
  for (const match of planned) {
    const sourceClassId = toPublicId(match?.sourceClassId);
    const sourceSessionId = toPublicId(match?.sourceSessionId);
    const partnerClassId = toPublicId(match?.partner?.classId || match?.partnerClassId);
    const partnerSessionId = toPublicId(match?.partner?.sessionId || match?.partnerSessionId);
    const partnerKey = partnerAssignmentKey({ classId: partnerClassId, sessionId: partnerSessionId });
    if (!sourceClassId || !sourceSessionId || !partnerClassId || !partnerSessionId) {
      throw new SessionMergeError('Source session, partner session, and merging teacher are required.', {
        code: 'MERGE_PAYLOAD_INVALID',
        statusCode: 400
      });
    }
    if (usedPartners.has(partnerKey)) {
      throw new SessionMergeError('Each selected session needs its own covering session.', {
        code: 'SHARED_PARTNER',
        statusCode: 409
      });
    }
    usedPartners.add(partnerKey);

    const sourceSession = (sessionsByClass.get(sourceClassId) || [])
      .find((row) => idsEqual(row?.sessionId || row?.id, sourceSessionId));
    if (!sourceSession) {
      throw new SessionMergeError('Source session not found.', { code: 'MERGE_SOURCE_NOT_FOUND', statusCode: 404 });
    }
    if (isMergedSessionRow(sourceSession)) {
      throw new SessionMergeError('This session has already been merged.', { code: 'MERGE_ALREADY_COMPLETED', statusCode: 409 });
    }
    if (isApprovedTimesheetLocked(sourceSession)) {
      throw new SessionMergeError('This session is locked by an approved timesheet.', { code: 'TIMESHEET_LOCKED', statusCode: 409 });
    }

    const partnerSession = (sessionsByClass.get(partnerClassId) || [])
      .find((row) => idsEqual(row?.sessionId || row?.id, partnerSessionId));
    if (!partnerSession) {
      throw new SessionMergeError('Partner session not found.', { code: 'MERGE_PARTNER_NOT_FOUND', statusCode: 404 });
    }
    if (partnerHasTakeoverLink(partnerSession)) {
      throw new SessionMergeError('That partner session already has a takeover.', { code: 'MERGE_PARTNER_MISMATCH', statusCode: 409 });
    }

    const cover = evaluatePartnerSessionCandidate({
      classId: partnerClassId,
      session: partnerSession,
      sourceClassId,
      sourceSessionId,
      sourceStart: normalizeClock(sourceSession.startTime),
      sourceEnd: normalizeClock(sourceSession.endTime),
      resolvedMergingId,
      teacherIdentityLookup,
      statusMap
    });
    if (!cover) {
      throw new SessionMergeError('Partner session does not match the teacher\'s schedule at this time.', {
        code: 'MERGE_PARTNER_MISMATCH',
        statusCode: 409
      });
    }

    const previousTeacherId = sessionDeliveryTeamService.getSessionMainTeacherId(sourceSession);
    const resolvedPreviousId = sessionConflictDetectionService.resolveTeacherPersonId(previousTeacherId, teacherIdentityLookup) || previousTeacherId;
    if (idsEqual(resolvedPreviousId, resolvedMergingId)) {
      throw new SessionMergeError('The selected teacher is already the main teacher for this session.', {
        code: 'MERGE_SAME_TEACHER',
        statusCode: 409
      });
    }
    prepared.push({
      sourceSession,
      partnerSession,
      sourceClassId,
      sourceSessionId,
      partnerClassId,
      partnerSessionId,
      resolvedPreviousId,
      previousTeacherName: await personName(resolvedPreviousId)
    });
  }

  prepared.forEach((row) => {
    writeSessionMergeLink({
      sourceSession: row.sourceSession,
      partnerSession: row.partnerSession,
      sourceClassId: row.sourceClassId,
      sourceSessionId: row.sourceSessionId,
      partnerClassId: row.partnerClassId,
      partnerSessionId: row.partnerSessionId,
      resolvedMergingId,
      mergingTeacherName,
      resolvedPreviousId: row.resolvedPreviousId,
      previousTeacherName: row.previousTeacherName,
      mergedCode,
      now,
      actorId,
      actorPersonId
    });
  });

  for (const [classId, sessions] of sessionsByClass) {
    await schoolDataService.saveClassSessions(classId, sessions, reqUser);
    await schoolIndexService.rebuildIndexesForClass(classId);
  }

  return {
    mergedCount: prepared.length,
    mergingTeacherId: resolvedMergingId,
    mergingTeacherName: mergingTeacherName || resolvedMergingId
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
  timeToMinutes,
  partnerSessionCoversMergingWindow,
  evaluatePartnerSessionCandidate,
  isMergedSessionRow,
  canUserUndoSessionMerge,
  isPersonMergedPreviousTeacherEditor,
  areMergeLinkedSessions,
  scanPartnerSessionsForMerge,
  explainPartnerSessionMergeFailure,
  findPartnerSessionForMerge,
  partnerHasTakeoverLink,
  planSessionMergeAssignments,
  previewSessionMergeBatch,
  executeSessionMerge,
  executeSessionMergeBatch,
  executeSessionUnmerge,
  writeSessionMergeLink,
  isMergeAddedPreviousTeacherCoTeacher,
  removeMergeAddedCoTeachers,
  buildPartnerReference,
  resolvePersonDisplayName
};
