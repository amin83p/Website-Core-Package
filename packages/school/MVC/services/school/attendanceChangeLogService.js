'use strict';

const schoolRepositories = require('../../repositories/school');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const attendanceMarkAppearanceService = require('./attendanceMarkAppearanceService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function normalizeLoggedStatus(status) {
  const normalized = attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(status, '');
  return normalized || '';
}

function rosterStatusMap(roster) {
  const map = new Map();
  (Array.isArray(roster) ? roster : []).forEach((row) => {
    const personId = String(row?.personId || '').trim();
    if (!personId) return;
    map.set(personId, normalizeLoggedStatus(row?.attendance));
  });
  return map;
}

function diffRosterAttendanceStatusChanges(beforeRoster, afterRoster) {
  const before = rosterStatusMap(beforeRoster);
  const after = rosterStatusMap(afterRoster);
  const personIds = new Set([...before.keys(), ...after.keys()]);
  const changes = [];
  personIds.forEach((personId) => {
    const fromStatus = before.has(personId) ? before.get(personId) : '';
    const toStatus = after.has(personId) ? after.get(personId) : '';
    if (fromStatus !== toStatus) {
      changes.push({ personId, fromStatus, toStatus });
    }
  });
  return changes;
}

function resolveChangedBy(reqUser = {}) {
  const userId = toPublicId(reqUser?.id || reqUser?.username || '') || '';
  const username = String(reqUser?.username || reqUser?.email || '').trim();
  const displayName = String(
    reqUser?.displayName
    || reqUser?.name
    || reqUser?.fullName
    || username
    || userId
  ).trim();
  return { userId, username, displayName };
}

function buildCellKey(sessionId, studentPersonId) {
  return `${String(sessionId || '').trim()}::${String(studentPersonId || '').trim()}`;
}

function statusToMarkKey(status) {
  const normalized = normalizeLoggedStatus(status);
  return normalized || 'unmarked';
}

function formatStatusLabel(markPolicy, status) {
  const markKey = statusToMarkKey(status);
  const mark = attendanceMarkAppearanceService.getMark(markPolicy, markKey);
  if (mark?.label) return mark.label;
  if (!normalizeLoggedStatus(status)) return 'Unmarked';
  return String(status || '').trim() || 'Unmarked';
}

function formatEntry(entry, markPolicy) {
  const changedBy = entry?.changedBy && typeof entry.changedBy === 'object' ? entry.changedBy : {};
  return {
    id: entry?.id || '',
    classId: entry?.classId || '',
    sessionId: entry?.sessionId || '',
    sessionDate: entry?.sessionDate || '',
    studentPersonId: entry?.studentPersonId || '',
    source: entry?.source || '',
    changedAt: entry?.changedAt || '',
    changedBy: {
      userId: changedBy.userId || '',
      username: changedBy.username || '',
      displayName: changedBy.displayName || changedBy.username || changedBy.userId || ''
    },
    fromStatus: normalizeLoggedStatus(entry?.fromStatus),
    toStatus: normalizeLoggedStatus(entry?.toStatus),
    fromLabel: formatStatusLabel(markPolicy, entry?.fromStatus),
    toLabel: formatStatusLabel(markPolicy, entry?.toStatus)
  };
}

function sortEntriesOldestFirst(entries) {
  return [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
    const leftTs = Date.parse(left?.changedAt || '') || 0;
    const rightTs = Date.parse(right?.changedAt || '') || 0;
    if (leftTs !== rightTs) return leftTs - rightTs;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  });
}

async function listRawForClass(classId, options = {}) {
  const normalizedClassId = String(classId || '').trim();
  if (!normalizedClassId) return [];
  const rows = await schoolRepositories.attendanceChangeLogs.list({
    query: {},
    scope: options?.scope || { canViewAll: true }
  });
  const startDate = String(options?.startDate || '').trim();
  const endDate = String(options?.endDate || '').trim();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!idsEqual(row?.classId, normalizedClassId)) return false;
    const sessionDate = String(row?.sessionDate || '').trim();
    if (startDate && sessionDate && sessionDate < startDate) return false;
    if (endDate && sessionDate && sessionDate > endDate) return false;
    return true;
  });
}

async function appendChanges({
  orgId,
  classId,
  sessionId,
  sessionDate,
  source,
  changes = [],
  reqUser
} = {}) {
  const normalizedOrgId = String(orgId || '').trim();
  const normalizedClassId = String(classId || '').trim();
  const normalizedSessionId = String(sessionId || '').trim();
  const normalizedSessionDate = String(sessionDate || '').trim();
  const normalizedSource = String(source || '').trim() || 'matrix_cell';
  const actor = resolveChangedBy(reqUser);
  const changedAt = new Date().toISOString();

  const payloads = (Array.isArray(changes) ? changes : [])
    .map((change) => {
      const studentPersonId = String(change?.personId || change?.studentPersonId || '').trim();
      if (!studentPersonId) return null;
      const fromStatus = normalizeLoggedStatus(change?.fromStatus);
      const toStatus = normalizeLoggedStatus(change?.toStatus);
      if (fromStatus === toStatus) return null;
      return {
        orgId: normalizedOrgId,
        classId: normalizedClassId,
        sessionId: normalizedSessionId,
        sessionDate: normalizedSessionDate,
        studentPersonId,
        source: normalizedSource,
        changedAt,
        changedBy: actor,
        fromStatus,
        toStatus
      };
    })
    .filter(Boolean);

  if (!payloads.length) return [];
  return schoolRepositories.attendanceChangeLogs.create(payloads);
}

async function listForCell({ classId, sessionId, studentPersonId, markPolicy }, options = {}) {
  const rows = await listRawForClass(classId, options);
  const filtered = rows.filter((row) => (
    idsEqual(row?.sessionId, sessionId)
    && idsEqual(row?.studentPersonId, studentPersonId)
  ));
  return sortEntriesOldestFirst(filtered).map((row) => formatEntry(row, markPolicy));
}

async function listForCells({
  classId,
  startDate,
  endDate,
  cells = [],
  markPolicy
} = {}, options = {}) {
  const cellKeys = new Set(
    (Array.isArray(cells) ? cells : [])
      .map((cell) => buildCellKey(cell?.sessionId, cell?.studentPersonId))
      .filter((key) => key !== '::')
  );
  if (!cellKeys.size) return {};

  const rows = await listRawForClass(classId, { ...options, startDate, endDate });
  const grouped = new Map();
  cellKeys.forEach((key) => grouped.set(key, []));

  rows.forEach((row) => {
    const key = buildCellKey(row?.sessionId, row?.studentPersonId);
    if (!cellKeys.has(key)) return;
    grouped.get(key).push(formatEntry(row, markPolicy));
  });

  const output = {};
  grouped.forEach((entries, key) => {
    output[key] = sortEntriesOldestFirst(entries);
  });
  return output;
}

module.exports = {
  normalizeLoggedStatus,
  diffRosterAttendanceStatusChanges,
  resolveChangedBy,
  buildCellKey,
  appendChanges,
  listForCell,
  listForCells,
  formatEntry
};
