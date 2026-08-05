const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const ENTRY_ID_PREFIX = 'ENT-';
const DEFAULT_SEQUENCE_WIDTH = 4;
const ENTRY_ID_PATTERN = /^ENT-(.+)-(\d{4,})$/;

function normalizeActivityId(activityId) {
  return toPublicId(activityId);
}

function resolveEntryId(entry = {}) {
  return toPublicId(entry?.entryId || entry?.id || '');
}

function buildEntryId(activityId, sequence, options = {}) {
  const activityToken = normalizeActivityId(activityId);
  if (!activityToken) throw new Error('activityId is required to build an entry id.');
  const seq = Number(sequence);
  if (!Number.isFinite(seq) || seq < 1) throw new Error('Entry sequence must be a positive integer.');
  const width = Math.max(
    DEFAULT_SEQUENCE_WIDTH,
    Number(options.sequenceWidth) || DEFAULT_SEQUENCE_WIDTH,
    String(Math.floor(seq)).length
  );
  return `${ENTRY_ID_PREFIX}${activityToken}-${String(Math.floor(seq)).padStart(width, '0')}`;
}

function parseEntryId(entryId) {
  const token = toPublicId(entryId);
  if (!token) return null;
  const match = token.match(ENTRY_ID_PATTERN);
  if (!match) return null;
  const sequence = Number(match[2]);
  if (!Number.isFinite(sequence) || sequence < 1) return null;
  return { activityId: match[1], sequence };
}

function isActivityScopedEntryId(entryId, activityId = '') {
  const parsed = parseEntryId(entryId);
  if (!parsed) return false;
  const expectedActivityId = normalizeActivityId(activityId);
  if (!expectedActivityId) return true;
  return idsEqual(parsed.activityId, expectedActivityId);
}

function findDuplicateEntryIds(entries = []) {
  const seen = new Map();
  const duplicates = [];
  (Array.isArray(entries) ? entries : []).forEach((row) => {
    const entryId = resolveEntryId(row);
    if (!entryId) return;
    if (!seen.has(entryId)) {
      seen.set(entryId, 1);
      return;
    }
    seen.set(entryId, seen.get(entryId) + 1);
    if (seen.get(entryId) === 2) duplicates.push(entryId);
  });
  return duplicates;
}

function assignSequentialEntryIds(activityId, entries = []) {
  const activityToken = normalizeActivityId(activityId);
  const rows = (Array.isArray(entries) ? entries : []).map((row) => ({ ...row }));
  if (!activityToken || !rows.length) return rows;

  const usedIds = new Set();
  let sequence = 0;
  return rows.map((row) => {
    sequence += 1;
    let candidate = buildEntryId(activityToken, sequence);
    while (usedIds.has(candidate)) {
      sequence += 1;
      candidate = buildEntryId(activityToken, sequence);
    }
    usedIds.add(candidate);
    return { ...row, entryId: candidate };
  });
}

function ensureActivityEntryIds(activityId, entries = []) {
  const activityToken = normalizeActivityId(activityId);
  const rows = (Array.isArray(entries) ? entries : []).map((row) => ({ ...row }));
  if (!activityToken || !rows.length) {
    return { entries: rows, reassigned: 0 };
  }

  const duplicates = findDuplicateEntryIds(rows);
  const needsReassign = duplicates.length > 0 || rows.some((row) => {
    const entryId = resolveEntryId(row);
    return !entryId || !isActivityScopedEntryId(entryId, activityToken);
  });

  if (!needsReassign) {
    return { entries: rows, reassigned: 0 };
  }

  const reassigned = assignSequentialEntryIds(activityToken, rows);
  return { entries: reassigned, reassigned: reassigned.length };
}

module.exports = {
  buildEntryId,
  parseEntryId,
  isActivityScopedEntryId,
  resolveEntryId,
  findDuplicateEntryIds,
  assignSequentialEntryIds,
  ensureActivityEntryIds
};
