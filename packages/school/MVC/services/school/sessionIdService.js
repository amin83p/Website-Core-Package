const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const {
  sortSessionsChronologically,
  normalizeSessionDate
} = require('./sessionNavigationService');

const SESSION_ID_PREFIX = 'SES-';
const DEFAULT_SEQUENCE_WIDTH = 4;
const SESSION_ID_PATTERN = /^SES-(.+)-(\d{4,})$/;

function normalizeClassId(classId) {
  return toPublicId(classId);
}

function resolveSessionId(session = {}) {
  return toPublicId(session?.sessionId || session?.id || session?._id || '');
}

function buildSessionId(classId, sequence, options = {}) {
  const classToken = normalizeClassId(classId);
  if (!classToken) throw new Error('classId is required to build a session id.');
  const seq = Number(sequence);
  if (!Number.isFinite(seq) || seq < 1) throw new Error('Session sequence must be a positive integer.');
  const width = Math.max(
    DEFAULT_SEQUENCE_WIDTH,
    Number(options.sequenceWidth) || DEFAULT_SEQUENCE_WIDTH,
    String(Math.floor(seq)).length
  );
  return `${SESSION_ID_PREFIX}${classToken}-${String(Math.floor(seq)).padStart(width, '0')}`;
}

function parseSessionId(sessionId) {
  const token = toPublicId(sessionId);
  if (!token) return null;
  const match = token.match(SESSION_ID_PATTERN);
  if (!match) return null;
  const sequence = Number(match[2]);
  if (!Number.isFinite(sequence) || sequence < 1) return null;
  return {
    classId: match[1],
    sequence
  };
}

function isClassScopedSessionId(sessionId, classId = '') {
  const parsed = parseSessionId(sessionId);
  if (!parsed) return false;
  const expectedClassId = normalizeClassId(classId);
  if (!expectedClassId) return true;
  return idsEqual(parsed.classId, expectedClassId);
}

function collectUsedSequences(classId, sessions = []) {
  const classToken = normalizeClassId(classId);
  const used = new Set();
  (Array.isArray(sessions) ? sessions : []).forEach((row) => {
    const sessionId = resolveSessionId(row);
    const parsed = parseSessionId(sessionId);
    if (!parsed || !idsEqual(parsed.classId, classToken)) return;
    used.add(parsed.sequence);
  });
  return used;
}

function buildNextSessionId(classId, existingSessions = [], options = {}) {
  const classToken = normalizeClassId(classId);
  if (!classToken) throw new Error('classId is required to build a session id.');
  const usedSequences = collectUsedSequences(classToken, existingSessions);
  const usedIds = new Set(
    (Array.isArray(existingSessions) ? existingSessions : [])
      .map((row) => resolveSessionId(row))
      .filter(Boolean)
  );
  let sequence = Math.max(0, Number(options.startSequence) || 0);
  for (let guard = 0; guard < 100000; guard += 1) {
    sequence += 1;
    const candidate = buildSessionId(classToken, sequence, options);
    if (!usedSequences.has(sequence) && !usedIds.has(candidate)) return candidate;
  }
  throw new Error(`Unable to allocate a unique session id for class ${classToken}.`);
}

function findDuplicateSessionIds(sessions = []) {
  const groups = new Map();
  (Array.isArray(sessions) ? sessions : []).forEach((row, index) => {
    const sessionId = resolveSessionId(row);
    if (!sessionId) return;
    if (!groups.has(sessionId)) groups.set(sessionId, []);
    groups.get(sessionId).push({ index, session: row });
  });
  return [...groups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([sessionId, rows]) => ({ sessionId, rows }));
}

function assignSequentialSessionIds(classId, sessions = [], options = {}) {
  const classToken = normalizeClassId(classId);
  if (!classToken) throw new Error('classId is required to assign session ids.');
  const sorted = sortSessionsChronologically(sessions).map((row) => (
    row && typeof row === 'object' ? { ...row } : row
  ));
  const startSequence = Math.max(0, Number(options.startSequence) || 0);
  return sorted.map((row, index) => ({
    ...row,
    sessionId: buildSessionId(classToken, startSequence + index + 1, options)
  }));
}

function ensureClassSessionIds(classId, sessions = [], options = {}) {
  const classToken = normalizeClassId(classId);
  if (!classToken) throw new Error('classId is required to ensure session ids.');
  const working = (Array.isArray(sessions) ? sessions : []).map((row) => (
    row && typeof row === 'object' ? { ...row } : row
  ));
  const chronologicalIndices = sortSessionsChronologically(
    working.map((row, index) => ({ row, index }))
  ).map((wrapper) => wrapper.index);
  const seenIds = new Set();
  const reassigned = [];

  chronologicalIndices.forEach((rowIndex) => {
    const row = working[rowIndex];
    const currentId = resolveSessionId(row);
    const needsNewId = (
      !currentId
      || options.normalizeAll === true
      || !isClassScopedSessionId(currentId, classToken)
      || seenIds.has(currentId)
    );
    if (!needsNewId) {
      seenIds.add(currentId);
      return;
    }
    const allocated = buildNextSessionId(classToken, working, options);
    const previousId = currentId || null;
    row.sessionId = allocated;
    seenIds.add(allocated);
    reassigned.push({
      index: rowIndex,
      previousId,
      sessionId: allocated,
      date: normalizeSessionDate(row?.date)
    });
  });

  return {
    sessions: working,
    reassigned
  };
}

function buildSessionRemapKey(sessionId, sessionDate = '') {
  const idToken = toPublicId(sessionId);
  const dateToken = normalizeSessionDate(sessionDate);
  return dateToken ? `${idToken}::${dateToken}` : idToken;
}

function assertUniqueSessionIds(sessions = [], context = '') {
  if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') return;
  const duplicates = findDuplicateSessionIds(sessions);
  if (!duplicates.length) return;
  const label = context ? ` (${context})` : '';
  console.warn(`[session-id] duplicate session ids detected${label}:`, duplicates.map((row) => row.sessionId));
}

module.exports = {
  SESSION_ID_PREFIX,
  SESSION_ID_PATTERN,
  buildSessionId,
  parseSessionId,
  isClassScopedSessionId,
  buildNextSessionId,
  assignSequentialSessionIds,
  ensureClassSessionIds,
  findDuplicateSessionIds,
  buildSessionRemapKey,
  resolveSessionId,
  assertUniqueSessionIds
};
