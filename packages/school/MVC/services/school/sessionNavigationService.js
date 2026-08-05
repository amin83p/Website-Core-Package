const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const CLASS_SCOPED_SESSION_ID_PATTERN = /^SES-(.+)-(\d{4,})$/;

function isClassScopedSessionId(sessionId, classId = '') {
  const token = toPublicId(sessionId);
  if (!token) return false;
  const match = token.match(CLASS_SCOPED_SESSION_ID_PATTERN);
  if (!match) return false;
  const classToken = toPublicId(classId);
  if (!classToken) return true;
  return idsEqual(match[1], classToken);
}

function normalizeSessionDate(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function resolveSessionPublicId(session = {}) {
  return toPublicId(session?.sessionId || session?.id || session?._id || '');
}

function sessionMatchesIdentity(row = {}, sessionId = '', sessionDate = '') {
  if (!idsEqual(resolveSessionPublicId(row), sessionId)) return false;
  const normalizedDate = normalizeSessionDate(sessionDate);
  if (!normalizedDate) return true;
  return normalizeSessionDate(row?.date) === normalizedDate;
}

function buildManageSessionHref(classId, session = {}, options = {}) {
  const classToken = toPublicId(classId);
  const sessionPublicId = resolveSessionPublicId(session);
  if (!classToken || !sessionPublicId) return '';
  const sessionDate = normalizeSessionDate(options.sessionDate || session?.date);
  const needsDateDisambiguation = sessionDate && !isClassScopedSessionId(sessionPublicId, classToken);
  return needsDateDisambiguation
    ? `/school/classes/${encodeURIComponent(classToken)}/sessions/${encodeURIComponent(sessionPublicId)}?sessionDate=${encodeURIComponent(sessionDate)}`
    : `/school/classes/${encodeURIComponent(classToken)}/sessions/${encodeURIComponent(sessionPublicId)}`;
}

function normalizeClockTime(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '00:00';
  const hour = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const minute = Math.max(0, Math.min(59, Number(match[2]) || 0));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function compareSessionsChronologically(left = {}, right = {}) {
  const dateLeft = String(left?.date || '').trim();
  const dateRight = String(right?.date || '').trim();
  if (dateLeft !== dateRight) return dateLeft.localeCompare(dateRight);
  return normalizeClockTime(left?.startTime).localeCompare(normalizeClockTime(right?.startTime));
}

function sortSessionsChronologically(sessions = []) {
  return [...(Array.isArray(sessions) ? sessions : [])].sort(compareSessionsChronologically);
}

function findSessionIndexInList(sessions = [], sessionId = '', sessionDate = '') {
  const targetId = toPublicId(sessionId);
  if (!targetId) return -1;
  const list = Array.isArray(sessions) ? sessions : [];
  const normalizedDate = normalizeSessionDate(sessionDate);
  if (normalizedDate) {
    const datedIndex = list.findIndex((row) => sessionMatchesIdentity(row, targetId, normalizedDate));
    if (datedIndex >= 0) return datedIndex;
  }
  return list.findIndex((row) => idsEqual(resolveSessionPublicId(row), targetId));
}

function resolveAdjacentSessionIds(sessions = [], sessionId = '', sessionDate = '') {
  const sortedSessions = sortSessionsChronologically(sessions);
  const currentIndex = findSessionIndexInList(sortedSessions, sessionId, sessionDate);
  if (currentIndex < 0) {
    return {
      sortedSessions,
      currentIndex,
      prevSessionId: null,
      prevSessionDate: null,
      nextSessionId: null,
      nextSessionDate: null
    };
  }
  const prevSession = currentIndex > 0 ? sortedSessions[currentIndex - 1] : null;
  const nextSession = currentIndex < sortedSessions.length - 1 ? sortedSessions[currentIndex + 1] : null;
  return {
    sortedSessions,
    currentIndex,
    prevSessionId: prevSession ? resolveSessionPublicId(prevSession) : null,
    prevSessionDate: prevSession ? normalizeSessionDate(prevSession?.date) : null,
    nextSessionId: nextSession ? resolveSessionPublicId(nextSession) : null,
    nextSessionDate: nextSession ? normalizeSessionDate(nextSession?.date) : null
  };
}

module.exports = {
  normalizeSessionDate,
  resolveSessionPublicId,
  sessionMatchesIdentity,
  buildManageSessionHref,
  compareSessionsChronologically,
  sortSessionsChronologically,
  findSessionIndexInList,
  resolveAdjacentSessionIds,
  isClassScopedSessionId
};
