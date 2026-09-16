'use strict';

const enrollmentSessionMarksService = require('./enrollmentSessionMarksService');
const sessionNaVisibilityService = require('./sessionNaVisibilityService');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const attendanceAccessService = require('./attendanceAccessService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const LEAVE_NA_ERROR = 'This attendance is N/A due to enrollment on-hold or an enrollment office session exemption. Status, late/early minutes, and arrival/leave times cannot be changed unless you have attendance administrator access. Notes and admin discussion may still be edited.';

function parseTimingMinutes(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function normalizeTimingFlag(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function rosterTimingSnapshot(row = {}) {
  return {
    lateMinutes: parseTimingMinutes(row?.lateMinutes),
    earlyLeaveMinutes: parseTimingMinutes(row?.earlyLeaveMinutes),
    breakLateMinutes: parseTimingMinutes(row?.breakLateMinutes),
    breakEarlyLeaveMinutes: parseTimingMinutes(row?.breakEarlyLeaveMinutes),
    attendanceArrivalTime: String(row?.attendanceArrivalTime || '').trim(),
    attendanceLeaveTime: String(row?.attendanceLeaveTime || '').trim(),
    lateExcused: normalizeTimingFlag(row?.lateExcused),
    earlyLeaveExcused: normalizeTimingFlag(row?.earlyLeaveExcused)
  };
}

function rosterTimingChanged(priorRow = {}, nextRow = {}) {
  const prior = rosterTimingSnapshot(priorRow);
  const next = rosterTimingSnapshot(nextRow);
  return Object.keys(prior).some((key) => prior[key] !== next[key]);
}

function isPriorStatusEnrollmentNa(priorAttendance) {
  return normalizeAttendance(priorAttendance)
    === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE;
}

function requiresOverrideForEnrollmentNaLockedEdit({
  lockActive,
  priorAttendance,
  nextAttendance,
  priorRow = {},
  nextRow = {}
} = {}) {
  if (!lockActive || !isPriorStatusEnrollmentNa(priorAttendance)) return false;
  if (requiresOverrideToLeaveNa({ priorAttendance, nextAttendance, lockActive: true })) return true;
  if (rosterTimingChanged(priorRow, nextRow)) return true;
  return false;
}

function normalizeAttendance(value) {
  return attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(value, '');
}

function isEnrollmentNaLockActive({
  periodRows = [],
  classId = '',
  session = {},
  personId = '',
  rosterRow = null
} = {}) {
  const normalizedPersonId = toPublicId(personId);
  const sessionId = toPublicId(session?.sessionId || session?.id);
  if (!normalizedPersonId || !sessionId) return false;

  const lock = enrollmentSessionMarksService.findLockedEnrollmentNaMark(
    periodRows,
    classId,
    sessionId,
    normalizedPersonId
  );
  if (lock) return true;

  const row = rosterRow && typeof rosterRow === 'object'
    ? rosterRow
    : (Array.isArray(session?.roster) ? session.roster : []).find(
      (item) => toPublicId(item?.personId) === normalizedPersonId
    ) || null;

  const hold = sessionNaVisibilityService.findActiveHoldForSession(
    periodRows,
    normalizedPersonId,
    session
  );
  if (!hold || !row) return false;
  return Boolean(sessionNaVisibilityService.isOnHoldNaRow({
    rosterRow: row,
    periodRows,
    personId: normalizedPersonId,
    session
  }));
}

function requiresOverrideToLeaveNa({ priorAttendance, nextAttendance, lockActive } = {}) {
  if (!lockActive) return false;
  const prior = normalizeAttendance(priorAttendance);
  const next = normalizeAttendance(nextAttendance);
  const na = attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE;
  return prior === na && next !== na;
}

function assertCanLeaveEnrollmentNaLock({
  attendanceAccess = {},
  periodRows = [],
  classData = {},
  session = {},
  personId = '',
  rosterRow = null,
  nextAttendance,
  priorAttendance,
  nextRow = null
} = {}) {
  const priorRec = rosterRow && typeof rosterRow === 'object' ? rosterRow : {};
  const prior = priorAttendance !== undefined ? priorAttendance : priorRec?.attendance;
  const next = nextRow && typeof nextRow === 'object'
    ? nextRow
    : {
      ...(priorRec || {}),
      attendance: nextAttendance !== undefined ? nextAttendance : prior
    };
  const lockActive = isEnrollmentNaLockActive({
    periodRows,
    classId: classData?.id,
    session,
    personId,
    rosterRow: priorRec
  });
  if (!requiresOverrideForEnrollmentNaLockedEdit({
    lockActive,
    priorAttendance: prior,
    nextAttendance: next?.attendance,
    priorRow: priorRec,
    nextRow: next
  })) {
    return;
  }
  if (attendanceAccess?.canOverrideSessionLock === true) {
    return;
  }
  throw new Error(LEAVE_NA_ERROR);
}

async function buildAttendanceAccessForUser(reqUser, ipAddress = '') {
  return attendanceAccessService.buildAttendanceAccess(reqUser, ipAddress);
}

function listEnrollmentNaLockedPersonIdsForSession({
  periodRows = [],
  classId = '',
  session = {},
  roster = []
} = {}) {
  const locked = new Set();
  const sessionId = toPublicId(session?.sessionId || session?.id);
  const rows = Array.isArray(roster) ? roster : [];
  const periods = Array.isArray(periodRows) ? periodRows : [];

  periods.forEach((period) => {
    enrollmentSessionMarksService.getMarksMap(period).forEach((mark, sid) => {
      if (sid === sessionId && mark?.locked && period.personId) {
        locked.add(toPublicId(period.personId));
      }
    });
  });

  rows.forEach((row) => {
    const personId = toPublicId(row?.personId);
    if (!personId || locked.has(personId)) return;
    if (isEnrollmentNaLockActive({
      periodRows: periods,
      classId,
      session,
      personId,
      rosterRow: row
    })) {
      locked.add(personId);
    }
  });

  return [...locked];
}

module.exports = {
  LEAVE_NA_ERROR,
  isEnrollmentNaLockActive,
  requiresOverrideToLeaveNa,
  requiresOverrideForEnrollmentNaLockedEdit,
  rosterTimingChanged,
  rosterTimingSnapshot,
  assertCanLeaveEnrollmentNaLock,
  buildAttendanceAccessForUser,
  listEnrollmentNaLockedPersonIdsForSession
};
