const schoolDataService = require('./schoolDataService');
const schoolRepositories = require('../../repositories/school');
const leaveRequestModel = require('../../models/school/leaveRequestModel');
const leaveRequestService = require('./leaveRequestService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const { SCOPE_MODES } = require('./schoolDataScopeBuilder');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const TEACHER_STAFF_ROLES = new Set(['teacher', 'staff', 'admin']);
const REVIEWABLE_STATUSES = new Set(['submitted', 'pending_reapproval']);
const LEAVE_RESOLUTION_ACCESS_CONTEXT = Object.freeze({ scopeId: 'SCP_ORG' });

function cleanPersonId(value) {
  return toPublicId(value);
}

function resolveSessionDeliveredBy(session = {}) {
  return cleanPersonId(
    session?.delivery?.deliveredBy
    || session?.deliveredBy
    || session?.teacherId
    || session?.instructorId
  );
}

function cleanString(value, max = 500) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function cleanDate(value) {
  const text = cleanString(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function cleanTime(value) {
  const text = cleanString(value, 10);
  return /^\d{2}:\d{2}$/.test(text) ? text : '';
}

function dateRangesOverlap(aStart, aEnd, bStart, bEnd) {
  const startA = cleanDate(aStart);
  const endA = cleanDate(aEnd || aStart);
  const startB = cleanDate(bStart);
  const endB = cleanDate(bEnd || bStart);
  if (!startA || !endA || !startB || !endB) return false;
  return startA <= endB && endA >= startB;
}

function timeRangesOverlap(aStart, aEnd, bStart, bEnd) {
  const startA = cleanTime(aStart) || '00:00';
  const endA = cleanTime(aEnd) || '23:59';
  const startB = cleanTime(bStart) || '00:00';
  const endB = cleanTime(bEnd) || '23:59';
  return startA < endB && endA > startB;
}

function addDays(day, amount) {
  const parsed = new Date(`${day}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function resolveLeaveOrgId(request = {}, reqUser = {}) {
  return toPublicId(request?.orgId || leaveRequestService.getActiveOrgId(reqUser));
}

function buildLeaveResolutionRepositoryScope(request = {}, reqUser = {}) {
  const orgId = resolveLeaveOrgId(request, reqUser);
  return {
    canViewAll: true,
    activeOrgId: orgId,
    scopeMode: SCOPE_MODES.ORG_WIDE,
    denyAll: false
  };
}

async function fetchOrgClassesForLeaveResolution(request, reqUser) {
  const orgId = resolveLeaveOrgId(request, reqUser);
  let rows = await schoolDataService.fetchData('classes', {}, reqUser, LEAVE_RESOLUTION_ACCESS_CONTEXT);
  if (!Array.isArray(rows) || !rows.length) {
    rows = await schoolRepositories.classes.list({
      query: { page: 1, limit: 5000 },
      scope: buildLeaveResolutionRepositoryScope(request, reqUser),
      skipExecutor: true
    });
  }
  return (Array.isArray(rows) ? rows : []).filter((row) => !orgId || idsEqual(row?.orgId, orgId));
}

async function loadClassSessionsForLeaveResolution(classId, request, reqUser) {
  const normalizedClassId = toPublicId(classId);
  if (!normalizedClassId) return [];

  try {
    const sessions = await schoolDataService.getClassSessions(
      normalizedClassId,
      reqUser,
      LEAVE_RESOLUTION_ACCESS_CONTEXT
    );
    if (Array.isArray(sessions)) return sessions;
  } catch (_) {
    /* fall through to repository read */
  }

  const rows = await schoolRepositories.classes.list({
    query: { id__eq: normalizedClassId, page: 1, limit: 1 },
    scope: buildLeaveResolutionRepositoryScope(request, reqUser),
    skipExecutor: true
  });
  const classRow = Array.isArray(rows) ? rows[0] : null;
  return Array.isArray(classRow?.sessions) ? classRow.sessions : [];
}

function buildRepositoryScope(reqUser) {
  const orgId = leaveRequestService.getActiveOrgId(reqUser);
  const viewAll = typeof leaveRequestService.canViewAllLeaveRequests === 'function'
    && leaveRequestService.canViewAllLeaveRequests(reqUser, {});
  return {
    query: {},
    scope: viewAll
      ? { canViewAll: true, activeOrgId: orgId, scopeMode: SCOPE_MODES.ORG_WIDE }
      : { activeOrgId: orgId, scopeMode: SCOPE_MODES.ORG_WIDE }
  };
}

function getActorId(user) {
  return toPublicId(user?.id || user?._id || user?.userId || user?.username || '');
}

function buildLeaveWindowFromRequest(request = {}) {
  return leaveRequestModel.buildLeaveWindowSnapshot(request);
}

function requiresSessionResolution(request = {}) {
  const role = String(request?.requesterRole || '').trim().toLowerCase();
  return TEACHER_STAFF_ROLES.has(role);
}

function sessionOverlapsLeaveWindow(leaveWindow, session = {}) {
  if (!leaveWindow || !session?.date) return false;
  if (!dateRangesOverlap(
    leaveWindow.startDate,
    leaveWindow.endDate,
    session.date,
    session.date
  )) return false;
  if (leaveWindow.allDay !== false) return true;
  return timeRangesOverlap(
    leaveWindow.startTime,
    leaveWindow.endTime,
    session.startTime,
    session.endTime
  );
}

function sessionHasAttendanceOrGradebook(session = {}) {
  const rosterHit = Array.isArray(session?.roster) && session.roster.some((row) => (
    String(row?.attendanceStatus || row?.attendance || row?.comment || row?.notes || '').trim()
    || row?.classEffortPercent !== undefined
    || row?.classParticipationPercent !== undefined
  ));
  const gradebookCount = Array.isArray(session?.gradebooks) ? session.gradebooks.length : 0;
  return rosterHit || gradebookCount > 0;
}

function normalizeSessionRow({
  classId,
  classTitle,
  session,
  requesterPersonId,
  requesterName,
  leaveWindow
}) {
  const sessionId = toPublicId(session?.sessionId || session?.id);
  const currentTeacherId = resolveSessionDeliveredBy(session);
  const resolved = !idsEqual(currentTeacherId, requesterPersonId);
  return {
    classId: toPublicId(classId),
    classTitle: cleanString(classTitle, 200),
    sessionId,
    date: String(session?.date || '').trim(),
    startTime: String(session?.startTime || '').trim(),
    endTime: String(session?.endTime || '').trim(),
    status: sessionStatusPolicyService.normalizeSessionStatus(session?.status, session?.notes),
    locked: session?.locked === true || String(session?.locked) === 'true',
    room: cleanString(session?.room, 200),
    currentTeacherId,
    currentTeacherName: cleanString(session?.delivery?.deliveredByName || currentTeacherId, 160),
    hasAttendanceOrGradebook: sessionHasAttendanceOrGradebook(session),
    manageSessionUrl: `/school/classes/${encodeURIComponent(toPublicId(classId))}/sessions/${encodeURIComponent(sessionId)}`,
    resolved,
    requesterPersonId: toPublicId(requesterPersonId),
    requesterName: cleanString(requesterName, 160),
    overlapsLeave: sessionOverlapsLeaveWindow(leaveWindow, session)
  };
}

function resolveTeacherIndexKeys(indexRoot = {}, personId = '') {
  const keys = new Set();
  const normalized = cleanPersonId(personId);
  if (!normalized) return [];
  if (indexRoot[normalized]) keys.add(normalized);
  Object.keys(indexRoot).forEach((key) => {
    if (idsEqual(key, normalized)) keys.add(key);
  });
  return [...keys];
}

function isDateWithinLeaveWindow(leaveWindow, dateToken = '') {
  const date = String(dateToken || '').trim();
  if (!date || !leaveWindow?.startDate) return false;
  const endDate = leaveWindow.endDate || leaveWindow.startDate;
  return date >= leaveWindow.startDate && date <= endDate;
}

function shouldIncludeSessionForLeaveConflict({
  session,
  requesterPersonId,
  leaveWindow,
  statusMap
}) {
  if (!session || !isDateWithinLeaveWindow(leaveWindow, session?.date)) return false;
  if (sessionStatusPolicyService.shouldExcludeFromTeacherIndexByMap(statusMap, {
    status: session?.status,
    notes: session?.notes
  })) return false;
  const deliveredBy = resolveSessionDeliveredBy(session);
  if (!idsEqual(deliveredBy, requesterPersonId)) return false;
  return sessionOverlapsLeaveWindow(leaveWindow, session);
}

function tryAppendSessionHit({
  classId,
  session,
  requesterPersonId,
  requesterName,
  leaveWindow,
  statusMap,
  classTitleCache,
  seen,
  hits
}) {
  const sessionId = toPublicId(session?.sessionId || session?.id);
  const normalizedClassId = toPublicId(classId);
  if (!normalizedClassId || !sessionId) return;
  const dedupeKey = `${normalizedClassId}::${sessionId}`;
  if (seen.has(dedupeKey)) return;
  if (!shouldIncludeSessionForLeaveConflict({ session, requesterPersonId, leaveWindow, statusMap })) return;
  seen.add(dedupeKey);

  let classTitle = classTitleCache.get(normalizedClassId);
  if (classTitle === undefined) {
    classTitle = normalizedClassId;
    classTitleCache.set(normalizedClassId, classTitle);
  }

  hits.push(normalizeSessionRow({
    classId: normalizedClassId,
    classTitle,
    session,
    requesterPersonId,
    requesterName,
    leaveWindow
  }));
}

async function enrichSessionClassTitles(hits, classTitleCache, reqUser) {
  const missingClassIds = [...new Set(hits.map((row) => toPublicId(row?.classId)).filter(Boolean))]
    .filter((classId) => classTitleCache.get(classId) === classId);
  await Promise.all(missingClassIds.map(async (classId) => {
    try {
      const classData = await schoolDataService.getDataById(
        'classes',
        classId,
        reqUser,
        LEAVE_RESOLUTION_ACCESS_CONTEXT
      );
      const title = cleanString(classData?.title || classId, 200);
      classTitleCache.set(classId, title);
    } catch (_) {
      classTitleCache.set(classId, classId);
    }
  }));
  hits.forEach((row) => {
    const title = classTitleCache.get(toPublicId(row.classId));
    if (title) row.classTitle = title;
  });
}

async function scanOrgClassesForOverlappingSessions({
  request,
  reqUser,
  leaveWindow,
  requesterPersonId,
  statusMap,
  seen,
  hits,
  classTitleCache
}) {
  const allClasses = await fetchOrgClassesForLeaveResolution(request, reqUser);

  for (const classRow of allClasses) {
    const classId = toPublicId(classRow?.id);
    if (!classId) continue;
    const sessions = await loadClassSessionsForLeaveResolution(classId, request, reqUser);
    for (const session of Array.isArray(sessions) ? sessions : []) {
      tryAppendSessionHit({
        classId,
        session,
        requesterPersonId,
        requesterName: request?.requesterName,
        leaveWindow,
        statusMap,
        classTitleCache,
        seen,
        hits
      });
    }
  }
}

async function listOverlappingTeacherSessions({ request, reqUser } = {}) {
  if (!request || !requiresSessionResolution(request)) return [];

  const leaveWindow = buildLeaveWindowFromRequest(request);
  const requesterPersonId = cleanPersonId(request?.requesterPersonId);
  if (!leaveWindow || !requesterPersonId || !leaveWindow.startDate) return [];

  const teacherIndex = await schoolDataService.getTeacherIndex();
  const indexRoot = teacherIndex && typeof teacherIndex === 'object' && !Array.isArray(teacherIndex)
    ? teacherIndex
    : {};

  const statusMap = await sessionStatusPolicyService.getStatusMap(request?.orgId || leaveRequestService.getActiveOrgId(reqUser), {
    includeInactive: true
  });

  const classTitleCache = new Map();
  const sessionCache = new Map();
  const hits = [];
  const seen = new Set();

  const indexKeys = resolveTeacherIndexKeys(indexRoot, requesterPersonId);
  let day = leaveWindow.startDate;
  const lastDay = leaveWindow.endDate || leaveWindow.startDate;
  while (day && day <= lastDay) {
    indexKeys.forEach((personKey) => {
      const personIndex = indexRoot[personKey] && typeof indexRoot[personKey] === 'object'
        ? indexRoot[personKey]
        : {};
      const dayRows = Array.isArray(personIndex[day]) ? personIndex[day] : [];
      dayRows.forEach((indexRow) => {
        const classId = toPublicId(indexRow?.classId);
        const sessionId = toPublicId(indexRow?.sessionId);
        if (!classId || !sessionId) return;
        if (!sessionCache.has(classId)) sessionCache.set(classId, null);
      });
    });
    day = addDays(day, 1);
  }

  for (const classId of sessionCache.keys()) {
    const sessions = await loadClassSessionsForLeaveResolution(classId, request, reqUser);
    sessionCache.set(classId, Array.isArray(sessions) ? sessions : []);
  }

  day = leaveWindow.startDate;
  while (day && day <= lastDay) {
    indexKeys.forEach((personKey) => {
      const personIndex = indexRoot[personKey] && typeof indexRoot[personKey] === 'object'
        ? indexRoot[personKey]
        : {};
      const dayRows = Array.isArray(personIndex[day]) ? personIndex[day] : [];
      dayRows.forEach((indexRow) => {
        const classId = toPublicId(indexRow?.classId);
        const sessionId = toPublicId(indexRow?.sessionId);
        if (!classId || !sessionId) return;
        const session = (sessionCache.get(classId) || []).find((row) => idsEqual(row?.sessionId || row?.id, sessionId));
        if (!session) return;
        tryAppendSessionHit({
          classId,
          session,
          requesterPersonId,
          requesterName: request?.requesterName,
          leaveWindow,
          statusMap,
          classTitleCache,
          seen,
          hits
        });
      });
    });
    day = addDays(day, 1);
  }

  await scanOrgClassesForOverlappingSessions({
    request,
    reqUser,
    leaveWindow,
    requesterPersonId,
    statusMap,
    seen,
    hits,
    classTitleCache
  });

  await enrichSessionClassTitles(hits, classTitleCache, reqUser);

  hits.sort((a, b) => {
    const dateCmp = String(a.date || '').localeCompare(String(b.date || ''));
    if (dateCmp !== 0) return dateCmp;
    const timeCmp = String(a.startTime || '').localeCompare(String(b.startTime || ''));
    if (timeCmp !== 0) return timeCmp;
    return String(a.classTitle || '').localeCompare(String(b.classTitle || ''));
  });

  return hits;
}

async function getResolutionState(request, reqUser) {
  const requestId = toPublicId(request?.id);
  const sessions = await listOverlappingTeacherSessions({ request, reqUser });
  const unresolved = sessions.filter((row) => !row.resolved);
  const savedResolutions = Array.isArray(request?.sessionResolutions) ? request.sessionResolutions : [];
  const resolveSessionsUrl = requestId
    ? `/school/leave-requests/resolve-sessions/${encodeURIComponent(requestId)}`
    : '';
  return {
    requiresResolution: requiresSessionResolution(request),
    sessions,
    unresolvedCount: unresolved.length,
    totalCount: sessions.length,
    readyForApproval: !requiresSessionResolution(request) || unresolved.length === 0,
    savedResolutions,
    resolveSessionsUrl
  };
}

async function assertCanOverrideLockedSession(reqUser) {
  return adminChekersService.isAdminForRequestAsync(
    reqUser,
    SECTIONS.SCHOOL_CLASSES,
    OPERATIONS.UPDATE,
    { section: { id: SECTIONS.SCHOOL_CLASSES } }
  );
}

async function applySessionResolutions({ requestId, resolutions = [], reqUser }) {
  if (!leaveRequestService.isAdminViewer(reqUser)) {
    const error = new Error('Only school administrators can resolve leave session conflicts.');
    error.statusCode = 403;
    throw error;
  }

  const existing = await schoolRepositories.leaveRequests.getById(requestId, buildRepositoryScope(reqUser));
  if (!existing) throw new Error('Leave request was not found.');

  const status = String(existing.status || '').trim().toLowerCase();
  if (!REVIEWABLE_STATUSES.has(status)) {
    throw new Error('Session resolutions can only be applied while the leave request is awaiting review.');
  }
  if (!requiresSessionResolution(existing)) {
    throw new Error('This leave request does not require teacher session resolution.');
  }

  const rows = Array.isArray(resolutions) ? resolutions : [];
  if (!rows.length) throw new Error('At least one session resolution is required.');

  const leaveWindow = buildLeaveWindowFromRequest(existing);
  const requesterPersonId = cleanPersonId(existing.requesterPersonId);
  const requesterName = cleanString(existing.requesterName, 160);
  const canOverrideLocked = await assertCanOverrideLockedSession(reqUser);
  const now = new Date().toISOString();
  const actorId = getActorId(reqUser);

  const byClass = new Map();
  rows.forEach((row) => {
    const classId = toPublicId(row?.classId);
    const sessionId = toPublicId(row?.sessionId);
    const substituteTeacherId = cleanPersonId(row?.substituteTeacherId || row?.teacherId);
    const substituteTeacherName = cleanString(row?.substituteTeacherName || row?.teacherName, 160);
    if (!classId || !sessionId || !substituteTeacherId) return;
    if (idsEqual(substituteTeacherId, requesterPersonId)) {
      throw new Error('Substitute instructor cannot be the same person as the leave requester.');
    }
    if (!byClass.has(classId)) byClass.set(classId, []);
    byClass.get(classId).push({ sessionId, substituteTeacherId, substituteTeacherName });
  });

  if (!byClass.size) throw new Error('No valid session resolutions were provided.');

  const appliedResolutions = [];
  const orgId = toPublicId(existing.orgId || leaveRequestService.getActiveOrgId(reqUser));

  for (const [classId, classResolutions] of byClass.entries()) {
    const sessions = await loadClassSessionsForLeaveResolution(classId, existing, reqUser);
    if (!Array.isArray(sessions)) throw new Error(`Could not load sessions for class ${classId}.`);

    let touched = false;
    for (const resolution of classResolutions) {
      const sessionIndex = sessions.findIndex((row) => idsEqual(row?.sessionId || row?.id, resolution.sessionId));
      if (sessionIndex < 0) throw new Error(`Session ${resolution.sessionId} was not found in class ${classId}.`);

      const session = sessions[sessionIndex];
      const isLocked = session?.locked === true || String(session?.locked) === 'true';
      if (isLocked && !canOverrideLocked) {
        throw new Error(`Session ${resolution.sessionId} is locked. An administrator override is required to assign a substitute.`);
      }

      const currentTeacherId = resolveSessionDeliveredBy(session);
      if (!idsEqual(currentTeacherId, requesterPersonId)) {
        throw new Error(`Session ${resolution.sessionId} is no longer assigned to the leave requester. Refresh and try again.`);
      }
      if (!sessionOverlapsLeaveWindow(leaveWindow, session)) {
        throw new Error(`Session ${resolution.sessionId} does not overlap this leave window.`);
      }

      const leaveConflicts = await leaveRequestService.findApprovedLeaveConflicts({
        orgId,
        windows: [{
          sessionIndex: 0,
          personId: resolution.substituteTeacherId,
          personName: resolution.substituteTeacherName,
          date: session.date,
          startTime: session.startTime,
          endTime: session.endTime
        }],
        reqUser
      });
      if (leaveConflicts.length) {
        const first = leaveConflicts[0];
        throw new Error(
          `Substitute ${resolution.substituteTeacherName || resolution.substituteTeacherId} has approved leave on ${first.date || session.date}.`
        );
      }

      session.delivery = {
        ...(session.delivery && typeof session.delivery === 'object' ? session.delivery : {}),
        deliveredBy: resolution.substituteTeacherId,
        deliveredByName: resolution.substituteTeacherName || resolution.substituteTeacherId,
        substitute: true,
        originalDeliveredBy: requesterPersonId,
        originalDeliveredByName: requesterName,
        leaveRequestId: toPublicId(requestId)
      };
      session.audit = {
        ...(session.audit || {}),
        lastUpdateUser: actorId,
        lastUpdateDateTime: now
      };
      touched = true;

      appliedResolutions.push({
        classId,
        sessionId: resolution.sessionId,
        action: 'substitute',
        substituteTeacherId: resolution.substituteTeacherId,
        substituteTeacherName: resolution.substituteTeacherName || resolution.substituteTeacherId,
        resolvedAt: now,
        resolvedBy: actorId
      });
    }

    if (touched) {
      await schoolDataService.saveClassSessions(classId, sessions, reqUser);
      await indexService.rebuildIndexesForClass(classId);
    }
  }

  const priorResolutions = Array.isArray(existing.sessionResolutions) ? existing.sessionResolutions : [];
  const mergedResolutions = [...priorResolutions];
  appliedResolutions.forEach((row) => {
    const idx = mergedResolutions.findIndex((item) => (
      idsEqual(item?.classId, row.classId) && idsEqual(item?.sessionId, row.sessionId)
    ));
    if (idx >= 0) mergedResolutions[idx] = row;
    else mergedResolutions.push(row);
  });

  const updated = await schoolRepositories.leaveRequests.update(requestId, {
    ...existing,
    sessionResolutions: leaveRequestModel.sanitizeSessionResolutions(mergedResolutions)
  }, buildRepositoryScope(reqUser));

  const state = await getResolutionState(updated, reqUser);
  return {
    request: updated,
    appliedCount: appliedResolutions.length,
    state
  };
}

async function assertReadyForApproval(request, reqUser) {
  if (!requiresSessionResolution(request)) {
    return { ready: true, unresolved: [] };
  }
  const state = await getResolutionState(request, reqUser);
  if (state.readyForApproval) {
    return { ready: true, unresolved: [] };
  }
  const error = new Error(
    `${state.unresolvedCount} class session(s) still assign the leave requester. Resolve substitutes before approval.`
  );
  error.code = 'LEAVE_SESSIONS_UNRESOLVED';
  error.statusCode = 409;
  error.data = {
    unresolvedCount: state.unresolvedCount,
    totalCount: state.totalCount,
    resolveSessionsUrl: state.resolveSessionsUrl,
    sessions: state.sessions.filter((row) => !row.resolved)
  };
  throw error;
}

module.exports = {
  TEACHER_STAFF_ROLES,
  requiresSessionResolution,
  buildLeaveWindowFromRequest,
  listOverlappingTeacherSessions,
  getResolutionState,
  applySessionResolutions,
  assertReadyForApproval
};
