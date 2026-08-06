'use strict';

const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const { requireCoreModule } = require('./schoolCoreContracts');

const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const allocationLocks = new Map();

class MakeupAllocationError extends Error {
  constructor(message, { code = 'MAKEUP_ALLOCATION_INVALID', statusCode = 409, data = null } = {}) {
    super(message);
    this.name = 'MakeupAllocationError';
    this.code = code;
    this.statusCode = statusCode;
    this.data = data;
  }
}

function normalizeClock(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function calculateDurationMinutes(session = {}) {
  const start = normalizeClock(session?.startTime);
  const end = normalizeClock(session?.endTime);
  if (start && end && start < end) {
    const [startHours, startMinutes] = start.split(':').map(Number);
    const [endHours, endMinutes] = end.split(':').map(Number);
    const duration = ((endHours * 60) + endMinutes) - ((startHours * 60) + startMinutes);
    if (duration > 0) return duration;
  }
  const fallbackHours = Number(session?.durationHours);
  return Number.isFinite(fallbackHours) && fallbackHours > 0
    ? Math.max(1, Math.round(fallbackHours * 60))
    : 0;
}

function minutesToHours(minutes) {
  const safe = Number(minutes);
  if (!Number.isFinite(safe) || safe <= 0) return 0;
  return Number((safe / 60).toFixed(2));
}

function normalizeStatusCode(value) {
  return sessionStatusPolicyService.normalizeStatusCode(value);
}

function resolveStatusDefinition(statusDefinitions, session = {}) {
  const normalized = sessionStatusPolicyService.normalizeSessionStatus(session?.status, session?.notes);
  if (statusDefinitions instanceof Map) {
    return sessionStatusPolicyService.resolveStatusDefinition(statusDefinitions, session)?.definition || null;
  }
  return (Array.isArray(statusDefinitions) ? statusDefinitions : [])
    .find((row) => normalizeStatusCode(row?.code) === normalized) || null;
}

function resolveAllowedDurationPercent({
  originalSession = {},
  statusDefinition = null,
  requestedPercent,
  allowOverride = false
} = {}) {
  const storedPercent = originalSession?.makeupScheduling?.durationPercent;
  const fallbackPercent = storedPercent ?? statusDefinition?.makeupDurationPercent ?? 100;
  if (allowOverride === true && requestedPercent !== undefined && requestedPercent !== null && requestedPercent !== '') {
    const requested = Number(requestedPercent);
    if (!Number.isFinite(requested) || requested < 1 || requested > 100) {
      throw new MakeupAllocationError('Make-up Duration % must be between 1 and 100.', {
        code: 'MAKEUP_DURATION_PERCENT_INVALID',
        statusCode: 400
      });
    }
    return sessionStatusPolicyService.normalizeMakeupDurationPercent(requested, fallbackPercent);
  }
  return sessionStatusPolicyService.normalizeMakeupDurationPercent(fallbackPercent, statusDefinition?.makeupDurationPercent ?? 100);
}

function isDirectMakeupForSession(session = {}, classId = '', originalSessionId = '') {
  return session?.makeup?.isMakeup === true
    && idsEqual(session?.makeup?.originalClassId, classId)
    && idsEqual(session?.makeup?.originalSessionId, originalSessionId);
}

function buildSessionReference(session = {}, { classId = '', statusDefinitions = [] } = {}) {
  const sessionId = toPublicId(session?.sessionId || session?.id);
  const status = sessionStatusPolicyService.normalizeSessionStatus(session?.status, session?.notes);
  const definition = resolveStatusDefinition(statusDefinitions, session);
  const durationMinutes = calculateDurationMinutes(session);
  return {
    classId: toPublicId(classId),
    sessionId,
    date: String(session?.date || '').trim(),
    startTime: normalizeClock(session?.startTime),
    endTime: normalizeClock(session?.endTime),
    durationMinutes,
    durationHours: minutesToHours(durationMinutes),
    durationPercent: 0,
    status,
    statusLabel: String(definition?.label || status || 'Unknown').trim(),
    statusColorBg: String(definition?.colorBg || '').trim(),
    statusColorText: String(definition?.colorText || '').trim(),
    statusColorBorder: String(definition?.colorBorder || '').trim(),
    teacherId: toPublicId(session?.delivery?.deliveredBy),
    teacherName: String(session?.delivery?.deliveredByName || session?.delivery?.deliveredBy || '').trim(),
    room: String(session?.room || '').trim(),
    locked: session?.locked === true || String(session?.locked) === 'true',
    manageUrl: classId && sessionId
      ? `/school/classes/${encodeURIComponent(String(classId))}/sessions/${encodeURIComponent(String(sessionId))}`
      : ''
  };
}

function buildMakeupAllocationSummary({
  classId = '',
  originalSession = {},
  sessions = [],
  statusDefinitions = [],
  allowedDurationPercent
} = {}) {
  const originalSessionId = toPublicId(originalSession?.sessionId || originalSession?.id);
  const originalDurationMinutes = calculateDurationMinutes(originalSession);
  const statusDefinition = resolveStatusDefinition(statusDefinitions, originalSession);
  const effectivePercent = allowedDurationPercent === undefined || allowedDurationPercent === null || allowedDurationPercent === ''
    ? resolveAllowedDurationPercent({ originalSession, statusDefinition })
    : sessionStatusPolicyService.normalizeMakeupDurationPercent(allowedDurationPercent, statusDefinition?.makeupDurationPercent ?? 100);
  const allowedDurationMinutes = originalDurationMinutes > 0
    ? Math.max(1, Math.round(originalDurationMinutes * (effectivePercent / 100)))
    : 0;
  const makeupSessions = (Array.isArray(sessions) ? sessions : [])
    .filter((session) => isDirectMakeupForSession(session, classId, originalSessionId))
    .map((session) => buildSessionReference(session, { classId, statusDefinitions }))
    .map((row) => ({
      ...row,
      durationPercent: originalDurationMinutes > 0
        ? Number(((row.durationMinutes / originalDurationMinutes) * 100).toFixed(2))
        : 0
    }))
    .sort((left, right) => (
      String(left.date || '').localeCompare(String(right.date || ''))
      || String(left.startTime || '').localeCompare(String(right.startTime || ''))
      || String(left.sessionId || '').localeCompare(String(right.sessionId || ''))
    ));
  const allocatedDurationMinutes = makeupSessions.reduce((sum, row) => sum + row.durationMinutes, 0);
  const remainingDurationMinutes = Math.max(0, allowedDurationMinutes - allocatedDurationMinutes);
  const excessDurationMinutes = Math.max(0, allocatedDurationMinutes - allowedDurationMinutes);

  return {
    classId: toPublicId(classId),
    originalSessionId,
    originalDurationMinutes,
    originalDurationHours: minutesToHours(originalDurationMinutes),
    allowedDurationPercent: effectivePercent,
    allowedDurationMinutes,
    allowedDurationHours: minutesToHours(allowedDurationMinutes),
    allocatedDurationMinutes,
    allocatedDurationHours: minutesToHours(allocatedDurationMinutes),
    remainingDurationMinutes,
    remainingDurationHours: minutesToHours(remainingDurationMinutes),
    excessDurationMinutes,
    excessDurationHours: minutesToHours(excessDurationMinutes),
    sessionCount: makeupSessions.length,
    isFullyAllocated: allowedDurationMinutes > 0 && allocatedDurationMinutes === allowedDurationMinutes,
    isOverAllocated: excessDurationMinutes > 0,
    sessions: makeupSessions
  };
}

function assertMakeupAllocationAvailable(summary = {}, proposedDurationMinutes = 0) {
  const proposed = Math.round(Number(proposedDurationMinutes) || 0);
  if (proposed <= 0) {
    throw new MakeupAllocationError('Make-up session duration must be greater than zero.', {
      code: 'MAKEUP_DURATION_INVALID',
      statusCode: 400,
      data: { makeupSummary: summary }
    });
  }
  if (Number(summary?.allowedDurationMinutes || 0) <= 0) {
    throw new MakeupAllocationError('The original session does not have a valid make-up duration allowance.', {
      code: 'MAKEUP_ALLOWANCE_INVALID',
      data: { makeupSummary: summary }
    });
  }
  const remaining = Number(summary?.remainingDurationMinutes || 0);
  if (remaining <= 0 || proposed > remaining) {
    throw new MakeupAllocationError(
      remaining <= 0
        ? 'The full allowed make-up duration has already been defined.'
        : `This make-up session exceeds the remaining allowance by ${minutesToHours(proposed - remaining).toFixed(2)} hours.`,
      {
        code: 'MAKEUP_DURATION_EXCEEDED',
        data: {
          proposedDurationMinutes: proposed,
          proposedDurationHours: minutesToHours(proposed),
          makeupSummary: summary
        }
      }
    );
  }
  return {
    proposedDurationMinutes: proposed,
    proposedDurationHours: minutesToHours(proposed),
    allocatedAfterMinutes: Number(summary?.allocatedDurationMinutes || 0) + proposed,
    allocatedAfterHours: minutesToHours(Number(summary?.allocatedDurationMinutes || 0) + proposed),
    remainingAfterMinutes: remaining - proposed,
    remainingAfterHours: minutesToHours(remaining - proposed)
  };
}

function assertAllowedPercentCoversAllocated(summary = {}) {
  if (summary?.isOverAllocated !== true) return summary;
  throw new MakeupAllocationError('Make-up Duration % cannot be lower than the hours already defined.', {
    code: 'MAKEUP_DURATION_PERCENT_BELOW_ALLOCATED',
    data: { makeupSummary: summary }
  });
}

function buildAllocationLockKey(classId, originalSessionId) {
  return `${toPublicId(classId)}::${toPublicId(originalSessionId)}`;
}

async function withMakeupAllocationLock(classId, originalSessionId, task) {
  const key = buildAllocationLockKey(classId, originalSessionId);
  const prior = allocationLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = prior.catch(() => undefined).then(() => gate);
  allocationLocks.set(key, tail);
  await prior.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (allocationLocks.get(key) === tail) allocationLocks.delete(key);
  }
}

function findDirectChildMakeupSessions(sessions = [], classId = '', parentSessionId = '') {
  const safeClassId = toPublicId(classId);
  const safeParentSessionId = toPublicId(parentSessionId);
  if (!safeClassId || !safeParentSessionId) return [];
  return (Array.isArray(sessions) ? sessions : []).filter((session) => (
    session?.makeup?.isMakeup === true
    && idsEqual(session?.makeup?.originalClassId, safeClassId)
    && idsEqual(session?.makeup?.originalSessionId, safeParentSessionId)
  ));
}

function buildChildMakeupSessionRows(children = [], { classId = '', statusDefinitions = [] } = {}) {
  return (Array.isArray(children) ? children : []).map((session) => buildSessionReference(session, {
    classId: toPublicId(session?.makeup?.originalClassId || classId),
    statusDefinitions
  }));
}

function assertMakeupSessionDeletable(session = {}, statusDefinitions = []) {
  const status = sessionStatusPolicyService.normalizeSessionStatus(session?.status, session?.notes);
  if (status !== 'scheduled') {
    const definition = resolveStatusDefinition(statusDefinitions, session);
    throw new MakeupAllocationError(
      `Only Scheduled make-up sessions can be deleted. Resolve the session status to Scheduled first (${definition?.label || status || 'current status'}).`,
      {
        code: 'MAKEUP_DELETE_STATUS_NOT_SCHEDULED',
        statusCode: 409,
        data: {
          sessionId: toPublicId(session?.sessionId || session?.id),
          status
        }
      }
    );
  }
}

function assertNoUnresolvedChildMakeups(sessions = [], classId = '', makeupSessionId = '', statusDefinitions = []) {
  const children = findDirectChildMakeupSessions(sessions, classId, makeupSessionId);
  if (!children.length) return;
  throw new MakeupAllocationError(
    'Remove or resolve child make-up sessions before deleting this make-up session.',
    {
      code: 'MAKEUP_CHILD_SESSIONS_EXIST',
      statusCode: 409,
      data: {
        parentSessionId: toPublicId(makeupSessionId),
        childSessions: buildChildMakeupSessionRows(children, { classId, statusDefinitions })
      }
    }
  );
}

function assertSessionRemovalAllowed({
  sessions = [],
  allSessions = sessions,
  classId = '',
  sessionToRemove = null,
  statusDefinitions = []
} = {}) {
  const safeClassId = toPublicId(classId);
  const sessionId = toPublicId(sessionToRemove?.sessionId || sessionToRemove?.id);
  if (!sessionId) return;

  const childMakeups = findDirectChildMakeupSessions(allSessions, safeClassId, sessionId);
  if (childMakeups.length) {
    throw new MakeupAllocationError(
      'Remove linked make-up sessions from Session Manager before deleting this session.',
      {
        code: 'MAKEUP_CHILD_SESSIONS_EXIST',
        statusCode: 409,
        data: {
          parentSessionId: sessionId,
          childSessions: buildChildMakeupSessionRows(childMakeups, { classId: safeClassId, statusDefinitions })
        }
      }
    );
  }

  if (sessionToRemove?.makeup?.isMakeup === true) {
    assertMakeupSessionDeletable(sessionToRemove, statusDefinitions);
    assertNoUnresolvedChildMakeups(allSessions, safeClassId, sessionId, statusDefinitions);
  }
}

function removeMakeupSessionFromLedger({
  sessions = [],
  classId = '',
  originalSessionId = '',
  makeupSessionId = ''
} = {}) {
  const safeClassId = toPublicId(classId);
  const safeOriginalSessionId = toPublicId(originalSessionId);
  const safeMakeupSessionId = toPublicId(makeupSessionId);
  if (!safeClassId || !safeOriginalSessionId || !safeMakeupSessionId) {
    throw new MakeupAllocationError('Make-up session removal requires class, original, and make-up session ids.', {
      code: 'MAKEUP_DELETE_INVALID',
      statusCode: 400
    });
  }

  const nextSessions = [...(Array.isArray(sessions) ? sessions : [])];
  const makeupIndex = nextSessions.findIndex((row) => idsEqual(row?.sessionId || row?.id, safeMakeupSessionId));
  if (makeupIndex < 0) {
    throw new MakeupAllocationError('Make-up session not found.', { code: 'MAKEUP_DELETE_NOT_FOUND', statusCode: 404 });
  }
  const makeupSession = nextSessions[makeupIndex];
  if (
    makeupSession?.makeup?.isMakeup !== true
    || !idsEqual(makeupSession?.makeup?.originalClassId, safeClassId)
    || !idsEqual(makeupSession?.makeup?.originalSessionId, safeOriginalSessionId)
  ) {
    throw new MakeupAllocationError('The selected session is not a linked make-up for this original session.', {
      code: 'MAKEUP_DELETE_NOT_LINKED',
      statusCode: 409
    });
  }

  nextSessions.splice(makeupIndex, 1);
  const originalIndex = nextSessions.findIndex((row) => idsEqual(row?.sessionId || row?.id, safeOriginalSessionId));
  if (originalIndex >= 0) {
    const originalSession = nextSessions[originalIndex];
    if (Array.isArray(originalSession.makeupHistory)) {
      originalSession.makeupHistory = originalSession.makeupHistory.filter((row) => {
        const linkedId = toPublicId(row?.makeupSessionId || row?.sessionId || '');
        return !linkedId || !idsEqual(linkedId, safeMakeupSessionId);
      });
    }
    originalSession.audit = {
      ...(originalSession.audit || {}),
      lastUpdateDateTime: new Date().toISOString()
    };
    nextSessions[originalIndex] = originalSession;
  }

  return {
    sessions: nextSessions,
    removedIds: [safeMakeupSessionId]
  };
}

function cleanupMakeupHistoryForRemovedSessions(existingSessions = [], incomingSessions = []) {
  const incomingIds = new Set(
    (Array.isArray(incomingSessions) ? incomingSessions : [])
      .map((row) => toPublicId(row?.sessionId || row?.id))
      .filter(Boolean)
  );
  const removedIds = new Set(
    (Array.isArray(existingSessions) ? existingSessions : [])
      .map((row) => toPublicId(row?.sessionId || row?.id))
      .filter((id) => id && !incomingIds.has(id))
  );
  if (!removedIds.size) return incomingSessions;

  return (Array.isArray(incomingSessions) ? incomingSessions : []).map((session) => {
    if (!Array.isArray(session?.makeupHistory) || !session.makeupHistory.length) return session;
    const filteredHistory = session.makeupHistory.filter((row) => {
      const linkedId = toPublicId(row?.makeupSessionId || row?.sessionId || '');
      return !linkedId || !removedIds.has(linkedId);
    });
    if (filteredHistory.length === session.makeupHistory.length) return session;
    return {
      ...session,
      makeupHistory: filteredHistory
    };
  });
}

function assertIncomingSessionsHonorMakeupRemovalRules({
  existingSessions = [],
  incomingSessions = [],
  classId = '',
  statusDefinitions = []
} = {}) {
  const incomingIds = new Set(
    (Array.isArray(incomingSessions) ? incomingSessions : [])
      .map((row) => toPublicId(row?.sessionId || row?.id))
      .filter(Boolean)
  );
  const removedSessions = (Array.isArray(existingSessions) ? existingSessions : []).filter((row) => {
    const sessionId = toPublicId(row?.sessionId || row?.id);
    return sessionId && !incomingIds.has(sessionId);
  });
  removedSessions.forEach((row) => {
    assertSessionRemovalAllowed({
      sessions: incomingSessions,
      allSessions: existingSessions,
      classId,
      sessionToRemove: row,
      statusDefinitions
    });
  });
}

module.exports = {
  MakeupAllocationError,
  assertAllowedPercentCoversAllocated,
  assertIncomingSessionsHonorMakeupRemovalRules,
  assertMakeupAllocationAvailable,
  assertMakeupSessionDeletable,
  assertNoUnresolvedChildMakeups,
  assertSessionRemovalAllowed,
  buildAllocationLockKey,
  buildChildMakeupSessionRows,
  buildMakeupAllocationSummary,
  buildSessionReference,
  calculateDurationMinutes,
  cleanupMakeupHistoryForRemovedSessions,
  findDirectChildMakeupSessions,
  isDirectMakeupForSession,
  minutesToHours,
  removeMakeupSessionFromLedger,
  resolveAllowedDurationPercent,
  withMakeupAllocationLock
};
