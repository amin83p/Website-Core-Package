'use strict';

const schoolRepositories = require('../../repositories/school');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const attendanceMarkAppearanceService = require('./attendanceMarkAppearanceService');
const { buildSchoolListScope } = require('./schoolDataScopeBuilder');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function resolveListScope(options = {}) {
  const scope = options?.scope;
  if (scope && (scope.canViewAll === true || scope.denyAll === true || scope.activeOrgId)) {
    return scope;
  }
  return buildSchoolListScope(options?.reqUser, {
    accessContext: options?.accessContext || scope || { scopeId: 'SCP_ORG' }
  });
}

function normalizeLoggedStatus(status) {
  const normalized = attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(status, '');
  return normalized || '';
}

function parseNonNegInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function normalizeExcuseFlag(value) {
  return attendanceMatrixMetricsService.normalizeAttendanceTimingExcuseFlag(value);
}

function rosterAttendanceSnapshot(row = {}) {
  const timing = attendanceMatrixMetricsService.normalizeAttendanceTimingFields(row);
  const absenceFields = attendanceMatrixMetricsService.normalizeAbsenceExcusedFields({
    ...row,
    attendance: normalizeLoggedStatus(row?.attendance)
  });
  return {
    status: normalizeLoggedStatus(row?.attendance),
    lateMinutes: timing.lateMinutes,
    earlyLeaveMinutes: timing.earlyLeaveMinutes,
    lateExcused: timing.lateExcused,
    earlyLeaveExcused: timing.earlyLeaveExcused,
    absenceExcused: Boolean(absenceFields.absenceExcused)
  };
}

function snapshotsEqual(left, right) {
  return left.status === right.status
    && left.lateMinutes === right.lateMinutes
    && left.earlyLeaveMinutes === right.earlyLeaveMinutes
    && left.lateExcused === right.lateExcused
    && left.earlyLeaveExcused === right.earlyLeaveExcused
    && left.absenceExcused === right.absenceExcused;
}

function buildChangeFromSnapshots(personId, fromSnapshot, toSnapshot) {
  return {
    personId,
    fromStatus: fromSnapshot.status,
    toStatus: toSnapshot.status,
    fromLateMinutes: fromSnapshot.lateMinutes,
    toLateMinutes: toSnapshot.lateMinutes,
    fromEarlyLeaveMinutes: fromSnapshot.earlyLeaveMinutes,
    toEarlyLeaveMinutes: toSnapshot.earlyLeaveMinutes,
    fromLateExcused: fromSnapshot.lateExcused,
    toLateExcused: toSnapshot.lateExcused,
    fromEarlyLeaveExcused: fromSnapshot.earlyLeaveExcused,
    toEarlyLeaveExcused: toSnapshot.earlyLeaveExcused,
    fromAbsenceExcused: fromSnapshot.absenceExcused,
    toAbsenceExcused: toSnapshot.absenceExcused
  };
}

function rosterSnapshotMap(roster) {
  const map = new Map();
  (Array.isArray(roster) ? roster : []).forEach((row) => {
    const personId = String(row?.personId || '').trim();
    if (!personId) return;
    map.set(personId, rosterAttendanceSnapshot(row));
  });
  return map;
}

function diffRosterAttendanceChanges(beforeRoster, afterRoster) {
  const before = rosterSnapshotMap(beforeRoster);
  const after = rosterSnapshotMap(afterRoster);
  const personIds = new Set([...before.keys(), ...after.keys()]);
  const changes = [];
  const emptySnapshot = rosterAttendanceSnapshot({});

  personIds.forEach((personId) => {
    const fromSnapshot = before.get(personId) || emptySnapshot;
    const toSnapshot = after.get(personId) || emptySnapshot;
    if (!snapshotsEqual(fromSnapshot, toSnapshot)) {
      changes.push(buildChangeFromSnapshots(personId, fromSnapshot, toSnapshot));
    }
  });
  return changes;
}

function diffRosterAttendanceStatusChanges(beforeRoster, afterRoster) {
  return diffRosterAttendanceChanges(beforeRoster, afterRoster).map((change) => ({
    personId: change.personId,
    fromStatus: change.fromStatus,
    toStatus: change.toStatus
  })).filter((change) => change.fromStatus !== change.toStatus);
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

function formatStatusLabel(markPolicy, status, snapshot = null) {
  const normalized = normalizeLoggedStatus(status);
  if (normalized === 'excused' || (normalized === 'absent' && snapshot?.absenceExcused)) {
    const mark = attendanceMarkAppearanceService.getMark(markPolicy, 'excused_absence');
    if (mark?.label) return mark.label;
    return 'Excused absence';
  }
  if (normalized === 'acf' && snapshot?.absenceExcused) {
    const mark = attendanceMarkAppearanceService.getMark(markPolicy, 'excused_absence');
    if (mark?.label) return mark.label;
    return 'Excused ACF';
  }
  const markKey = statusToMarkKey(status);
  const mark = attendanceMarkAppearanceService.getMark(markPolicy, markKey);
  if (mark?.label) return mark.label;
  if (!normalized) return 'Unmarked';
  return String(status || '').trim() || 'Unmarked';
}

function formatTimingFields(entry = {}, prefix) {
  const lateMinutes = parseNonNegInt(entry[`${prefix}LateMinutes`]);
  const earlyLeaveMinutes = parseNonNegInt(entry[`${prefix}EarlyLeaveMinutes`]);
  return {
    lateMinutes,
    earlyLeaveMinutes,
    lateExcused: normalizeExcuseFlag(entry[`${prefix}LateExcused`]),
    earlyLeaveExcused: normalizeExcuseFlag(entry[`${prefix}EarlyLeaveExcused`]),
    absenceExcused: normalizeExcuseFlag(entry[`${prefix}AbsenceExcused`])
  };
}

function formatEntry(entry, markPolicy) {
  const changedBy = entry?.changedBy && typeof entry.changedBy === 'object' ? entry.changedBy : {};
  const fromTiming = formatTimingFields(entry, 'from');
  const toTiming = formatTimingFields(entry, 'to');
  const fromStatus = normalizeLoggedStatus(entry?.fromStatus);
  const toStatus = normalizeLoggedStatus(entry?.toStatus);
  const fromSnapshot = { status: fromStatus, ...fromTiming };
  const toSnapshot = { status: toStatus, ...toTiming };

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
    fromStatus,
    toStatus,
    fromLabel: formatStatusLabel(markPolicy, fromStatus, fromSnapshot),
    toLabel: formatStatusLabel(markPolicy, toStatus, toSnapshot),
    fromLateMinutes: fromTiming.lateMinutes,
    toLateMinutes: toTiming.lateMinutes,
    fromEarlyLeaveMinutes: fromTiming.earlyLeaveMinutes,
    toEarlyLeaveMinutes: toTiming.earlyLeaveMinutes,
    fromLateExcused: fromTiming.lateExcused,
    toLateExcused: toTiming.lateExcused,
    fromEarlyLeaveExcused: fromTiming.earlyLeaveExcused,
    toEarlyLeaveExcused: toTiming.earlyLeaveExcused,
    fromAbsenceExcused: fromTiming.absenceExcused,
    toAbsenceExcused: toTiming.absenceExcused
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
  const scope = resolveListScope(options);
  if (scope?.denyAll) return [];

  const rows = await schoolRepositories.attendanceChangeLogs.list({
    query: {},
    scope
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

function hasAttendanceChange(change = {}) {
  const fromSnapshot = rosterAttendanceSnapshot({
    attendance: change.fromStatus,
    lateMinutes: change.fromLateMinutes,
    earlyLeaveMinutes: change.fromEarlyLeaveMinutes,
    lateExcused: change.fromLateExcused,
    earlyLeaveExcused: change.fromEarlyLeaveExcused,
    absenceExcused: change.fromAbsenceExcused
  });
  const toSnapshot = rosterAttendanceSnapshot({
    attendance: change.toStatus,
    lateMinutes: change.toLateMinutes,
    earlyLeaveMinutes: change.toEarlyLeaveMinutes,
    lateExcused: change.toLateExcused,
    earlyLeaveExcused: change.toEarlyLeaveExcused,
    absenceExcused: change.toAbsenceExcused
  });
  return !snapshotsEqual(fromSnapshot, toSnapshot);
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
      const normalizedChange = buildChangeFromSnapshots(
        studentPersonId,
        rosterAttendanceSnapshot({
          attendance: change?.fromStatus,
          lateMinutes: change?.fromLateMinutes,
          earlyLeaveMinutes: change?.fromEarlyLeaveMinutes,
          lateExcused: change?.fromLateExcused,
          earlyLeaveExcused: change?.fromEarlyLeaveExcused,
          absenceExcused: change?.fromAbsenceExcused
        }),
        rosterAttendanceSnapshot({
          attendance: change?.toStatus,
          lateMinutes: change?.toLateMinutes,
          earlyLeaveMinutes: change?.toEarlyLeaveMinutes,
          lateExcused: change?.toLateExcused,
          earlyLeaveExcused: change?.toEarlyLeaveExcused,
          absenceExcused: change?.toAbsenceExcused
        })
      );
      if (!hasAttendanceChange(normalizedChange)) return null;
      const { personId: _ignoredPersonId, ...changeFields } = normalizedChange;
      return {
        orgId: normalizedOrgId,
        classId: normalizedClassId,
        sessionId: normalizedSessionId,
        sessionDate: normalizedSessionDate,
        studentPersonId,
        source: normalizedSource,
        changedAt,
        changedBy: actor,
        ...changeFields
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
  rosterAttendanceSnapshot,
  diffRosterAttendanceChanges,
  diffRosterAttendanceStatusChanges,
  resolveChangedBy,
  buildCellKey,
  resolveListScope,
  appendChanges,
  listForCell,
  listForCells,
  formatEntry
};
