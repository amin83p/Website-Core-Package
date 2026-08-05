const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const MANUAL_SESSION_PREFIX = 'MAN-';
const LEGACY_MANUAL_PREFIX = 'MAN_';
const DEFAULT_SEQUENCE_WIDTH = 4;
const MANUAL_SESSION_PATTERN = /^MAN-(.+)-(\d{4,})$/;

function normalizeScopeId(scopeId) {
  return toPublicId(scopeId);
}

function resolveManualSessionId(entry = {}) {
  return toPublicId(entry?.sessionId || entry?.materializedSessionId || '');
}

function isLegacyManualSessionId(sessionId) {
  const token = toPublicId(sessionId);
  return Boolean(token && token.startsWith(LEGACY_MANUAL_PREFIX) && !token.startsWith(MANUAL_SESSION_PREFIX));
}

function buildManualSessionId(scopeId, sequence, options = {}) {
  const scopeToken = normalizeScopeId(scopeId);
  if (!scopeToken) throw new Error('scopeId is required to build a manual session id.');
  const seq = Number(sequence);
  if (!Number.isFinite(seq) || seq < 1) throw new Error('Manual session sequence must be a positive integer.');
  const width = Math.max(
    DEFAULT_SEQUENCE_WIDTH,
    Number(options.sequenceWidth) || DEFAULT_SEQUENCE_WIDTH,
    String(Math.floor(seq)).length
  );
  return `${MANUAL_SESSION_PREFIX}${scopeToken}-${String(Math.floor(seq)).padStart(width, '0')}`;
}

function parseManualSessionId(sessionId) {
  const token = toPublicId(sessionId);
  if (!token) return null;
  const match = token.match(MANUAL_SESSION_PATTERN);
  if (!match) return null;
  const sequence = Number(match[2]);
  if (!Number.isFinite(sequence) || sequence < 1) return null;
  return { scopeId: match[1], sequence };
}

function isScopedManualSessionId(sessionId, scopeId = '') {
  const parsed = parseManualSessionId(sessionId);
  if (!parsed) return false;
  const expectedScopeId = normalizeScopeId(scopeId);
  if (!expectedScopeId) return true;
  return idsEqual(parsed.scopeId, expectedScopeId);
}

function isManualSessionId(sessionId) {
  const token = toPublicId(sessionId);
  if (!token) return false;
  return token.startsWith(MANUAL_SESSION_PREFIX) || isLegacyManualSessionId(token);
}

function collectUsedManualSequences(scopeId, entries = []) {
  const scopeToken = normalizeScopeId(scopeId);
  const used = new Set();
  (Array.isArray(entries) ? entries : []).forEach((row) => {
    const sessionId = resolveManualSessionId(row);
    const parsed = parseManualSessionId(sessionId);
    if (!parsed || !idsEqual(parsed.scopeId, scopeToken)) return;
    used.add(parsed.sequence);
  });
  return used;
}

function buildNextManualSessionId(scopeId, existingEntries = [], options = {}) {
  const scopeToken = normalizeScopeId(scopeId);
  if (!scopeToken) throw new Error('scopeId is required to build a manual session id.');
  const usedSequences = collectUsedManualSequences(scopeToken, existingEntries);
  const usedIds = new Set(
    (Array.isArray(existingEntries) ? existingEntries : [])
      .map((row) => resolveManualSessionId(row))
      .filter(Boolean)
  );
  let sequence = Math.max(0, Number(options.startSequence) || 0);
  for (let guard = 0; guard < 100000; guard += 1) {
    sequence += 1;
    const candidate = buildManualSessionId(scopeToken, sequence, options);
    if (!usedSequences.has(sequence) && !usedIds.has(candidate)) return candidate;
  }
  throw new Error('Unable to allocate a unique manual session id.');
}

function findDuplicateManualSessionIds(entries = [], scopeId = '') {
  const scopeToken = normalizeScopeId(scopeId);
  const seen = new Map();
  const duplicates = [];
  (Array.isArray(entries) ? entries : []).forEach((row) => {
    const sessionId = resolveManualSessionId(row);
    if (!sessionId || !isManualSessionId(sessionId)) return;
    const parsed = parseManualSessionId(sessionId);
    if (scopeToken && parsed && !idsEqual(parsed.scopeId, scopeToken)) return;
    if (!seen.has(sessionId)) {
      seen.set(sessionId, 1);
      return;
    }
    seen.set(sessionId, seen.get(sessionId) + 1);
    if (seen.get(sessionId) === 2) duplicates.push(sessionId);
  });
  return duplicates;
}

function ensureManualSessionIds(scopeId, entries = [], options = {}) {
  const scopeToken = normalizeScopeId(scopeId);
  const rows = (Array.isArray(entries) ? entries : []).map((row) => ({ ...row }));
  if (!scopeToken || !rows.length) return { entries: rows, reassigned: 0 };

  const duplicates = findDuplicateManualSessionIds(rows, scopeToken);
  const needsReassign = duplicates.length > 0 || rows.some((row) => {
    const sessionId = resolveManualSessionId(row);
    if (!sessionId) return options.treatMissingAsManual === true;
    if (!isManualSessionId(sessionId)) return false;
    return isLegacyManualSessionId(sessionId) || !isScopedManualSessionId(sessionId, scopeToken);
  });

  if (!needsReassign) return { entries: rows, reassigned: 0 };

  const usedIds = new Set();
  let sequence = 0;
  let reassignedCount = 0;
  const nextRows = rows.map((row) => {
    const sessionId = resolveManualSessionId(row);
    const isManual = sessionId && isManualSessionId(sessionId);
    const shouldReassign = !sessionId
      ? options.treatMissingAsManual === true
      : (isManual && (isLegacyManualSessionId(sessionId) || !isScopedManualSessionId(sessionId, scopeToken) || duplicates.includes(sessionId)));

    if (!shouldReassign) {
      if (sessionId) usedIds.add(sessionId);
      return row;
    }

    let candidate = '';
    for (let guard = 0; guard < 100000; guard += 1) {
      sequence += 1;
      candidate = buildManualSessionId(scopeToken, sequence, options);
      if (!usedIds.has(candidate)) break;
    }
    usedIds.add(candidate);
    reassignedCount += 1;
    const next = { ...row, sessionId: candidate };
    if (row.materializedSessionId && isManualSessionId(row.materializedSessionId)) {
      next.materializedSessionId = candidate;
    }
    return next;
  });

  return { entries: nextRows, reassigned: reassignedCount };
}

function ensureTimesheetManualSessionIds(timesheetId, entries = []) {
  const rows = (Array.isArray(entries) ? entries : []).map((row) => ({ ...row }));
  const scopeGroups = new Map();
  rows.forEach((entry, index) => {
    if (!entry || entry.isDeleted === true || entry.isManual !== true) return;
    const scopeId = normalizeScopeId(entry.classId || entry.activityId || timesheetId);
    if (!scopeId) return;
    if (!scopeGroups.has(scopeId)) scopeGroups.set(scopeId, []);
    scopeGroups.get(scopeId).push(index);
  });

  const nextRows = rows.map((row) => ({ ...row }));
  scopeGroups.forEach((indices, scopeId) => {
    const group = indices.map((index) => nextRows[index]);
    const ensured = ensureManualSessionIds(scopeId, group);
    ensured.entries.forEach((entry, offset) => {
      nextRows[indices[offset]] = entry;
    });
  });
  return nextRows;
}

module.exports = {
  MANUAL_SESSION_PREFIX,
  LEGACY_MANUAL_PREFIX,
  buildManualSessionId,
  parseManualSessionId,
  isScopedManualSessionId,
  isLegacyManualSessionId,
  isManualSessionId,
  resolveManualSessionId,
  buildNextManualSessionId,
  findDuplicateManualSessionIds,
  ensureManualSessionIds,
  ensureTimesheetManualSessionIds
};
