'use strict';

const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const enrollmentSessionMarksService = require('./enrollmentSessionMarksService');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const sessionAccessPolicyService = require('./sessionAccessPolicyService');
const classEnrollmentPeriodModel = require('../../models/school/classEnrollmentPeriodModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const { APPLICABILITY_REASON } = classEnrollmentSessionApplicabilityService;

const NA_REASON = Object.freeze({
  ENROLLMENT_EXCLUDED: 'enrollment_excluded',
  HOUR_CAP_REACHED: 'hour_cap_reached',
  SESSION_CAP_REACHED: 'session_cap_reached',
  MAKEUP_REQUIRED: 'makeup_required',
  APPROVED_LEAVE: 'approved_leave',
  ON_HOLD: 'on_hold',
  MANUAL_NOT_APPLICABLE: 'manual_not_applicable'
});

const NA_LABELS = Object.freeze({
  [NA_REASON.ENROLLMENT_EXCLUDED]: 'Enrollment office N/A',
  [NA_REASON.HOUR_CAP_REACHED]: 'Hour cap reached',
  [NA_REASON.SESSION_CAP_REACHED]: 'Session cap reached',
  [NA_REASON.MAKEUP_REQUIRED]: 'Make-up required session',
  [NA_REASON.APPROVED_LEAVE]: 'Approved leave',
  [NA_REASON.ON_HOLD]: 'On-hold enrollment',
  [NA_REASON.MANUAL_NOT_APPLICABLE]: 'Teacher N/A'
});

const POLICY_KEY_BY_REASON = Object.freeze({
  [NA_REASON.ENROLLMENT_EXCLUDED]: 'enrollmentExcludedNa',
  [NA_REASON.ON_HOLD]: 'onHoldNa',
  [NA_REASON.MANUAL_NOT_APPLICABLE]: 'teacherNa',
  [NA_REASON.APPROVED_LEAVE]: 'approvedLeaveNa',
  [NA_REASON.MAKEUP_REQUIRED]: 'makeupRequiredNa',
  [NA_REASON.HOUR_CAP_REACHED]: 'capReachedNa',
  [NA_REASON.SESSION_CAP_REACHED]: 'capReachedNa'
});

function normalizeDateOnly(value = '') {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function cleanPersonId(value = '') {
  return toPublicId(value);
}

function dateInRange(date, startDate, endDate) {
  const dateToken = normalizeDateOnly(date);
  const start = normalizeDateOnly(startDate);
  const end = normalizeDateOnly(endDate) || start;
  if (!dateToken || !start) return false;
  return dateToken >= start && dateToken <= end;
}

function findPeriodForPerson(periodRows = [], personId = '') {
  const targetPersonId = cleanPersonId(personId);
  if (!targetPersonId) return null;
  return (Array.isArray(periodRows) ? periodRows : []).find((row) => idsEqual(row?.personId, targetPersonId)) || null;
}

function findActiveHoldForSession(periodRows = [], personId = '', session = {}) {
  const period = findPeriodForPerson(periodRows, personId);
  if (!period) return null;
  const sessionDate = normalizeDateOnly(session?.date || session?.sessionDate);
  if (!sessionDate) return null;
  const holds = classEnrollmentPeriodModel.sanitizeEnrollmentHoldPeriods(period.enrollmentHoldPeriods);
  return holds.find((hold) => hold.status === 'applied'
    && dateInRange(sessionDate, hold.startDate, hold.endDate)) || null;
}

function isOnHoldNaRow({ rosterRow, periodRows = [], personId = '', session = {} }) {
  const attendance = attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(
    rosterRow?.attendance,
    ''
  );
  if (attendance !== attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE) return null;
  const hold = findActiveHoldForSession(periodRows, personId, session);
  if (!hold) return null;
  const rosterNotes = String(rosterRow?.notes || '').trim();
  const holdReason = String(hold.reason || '').trim();
  if (holdReason && rosterNotes && rosterNotes !== holdReason) return null;
  return hold;
}

function resolveNaStatusContext({
  personId = '',
  session = {},
  rosterRow = {},
  applicabilityState = null,
  periodRows = [],
  classId = '',
  approvedLeaveNote = '',
  forceSessionMakeup = false
} = {}) {
  const sessionId = toPublicId(session?.sessionId || session?.id);
  const normalizedPersonId = cleanPersonId(personId);
  const reason = String(applicabilityState?.reason || '').trim();

  if (reason === APPLICABILITY_REASON.ENROLLMENT_EXCLUDED) {
    const lock = enrollmentSessionMarksService.findLockedEnrollmentNaMark(
      periodRows,
      classId,
      sessionId,
      normalizedPersonId
    );
    return {
      naReasonCode: NA_REASON.ENROLLMENT_EXCLUDED,
      naLabel: NA_LABELS[NA_REASON.ENROLLMENT_EXCLUDED],
      naNote: String(lock?.mark?.note || '').trim(),
      displayOnlyEnrollmentExcluded: true
    };
  }

  if (reason === APPLICABILITY_REASON.HOUR_CAP_REACHED) {
    return {
      naReasonCode: NA_REASON.HOUR_CAP_REACHED,
      naLabel: NA_LABELS[NA_REASON.HOUR_CAP_REACHED],
      naNote: 'Enrollment target hours reached for this student.',
      displayOnlyEnrollmentExcluded: false
    };
  }

  if (reason === APPLICABILITY_REASON.SESSION_CAP_REACHED) {
    return {
      naReasonCode: NA_REASON.SESSION_CAP_REACHED,
      naLabel: NA_LABELS[NA_REASON.SESSION_CAP_REACHED],
      naNote: 'Enrollment target session count reached for this student.',
      displayOnlyEnrollmentExcluded: false
    };
  }

  if (reason === APPLICABILITY_REASON.MAKEUP_REQUIRED || forceSessionMakeup) {
    return {
      naReasonCode: NA_REASON.MAKEUP_REQUIRED,
      naLabel: NA_LABELS[NA_REASON.MAKEUP_REQUIRED],
      naNote: 'This original session requires a make-up session. Attendance remains visible as N/A for tracking and is excluded from attendance calculations.',
      displayOnlyEnrollmentExcluded: false
    };
  }

  if (reason === APPLICABILITY_REASON.APPROVED_LEAVE) {
    return {
      naReasonCode: NA_REASON.APPROVED_LEAVE,
      naLabel: NA_LABELS[NA_REASON.APPROVED_LEAVE],
      naNote: String(approvedLeaveNote || '').trim() || 'Approved leave for this session.',
      displayOnlyEnrollmentExcluded: false
    };
  }

  const hold = isOnHoldNaRow({ rosterRow, periodRows, personId: normalizedPersonId, session });
  if (hold) {
    return {
      naReasonCode: NA_REASON.ON_HOLD,
      naLabel: NA_LABELS[NA_REASON.ON_HOLD],
      naNote: String(hold.reason || rosterRow?.notes || '').trim() || 'Enrollment on hold for this session.',
      displayOnlyEnrollmentExcluded: false
    };
  }

  const attendance = attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(
    rosterRow?.attendance,
    ''
  );
  if (attendance === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE
    || reason === APPLICABILITY_REASON.MANUAL_NOT_APPLICABLE) {
    const rosterNote = String(rosterRow?.notes || '').trim();
    const commentNote = Array.isArray(rosterRow?.comments)
      ? rosterRow.comments.map((row) => String(row?.text || row?.body || '').trim()).filter(Boolean).join('\n')
      : '';
    const combinedNote = [rosterNote, commentNote].filter(Boolean).join('\n').trim();
    return {
      naReasonCode: NA_REASON.MANUAL_NOT_APPLICABLE,
      naLabel: NA_LABELS[NA_REASON.MANUAL_NOT_APPLICABLE],
      naNote: combinedNote || 'Marked N/A by teacher.',
      displayOnlyEnrollmentExcluded: false
    };
  }

  return {
    naReasonCode: '',
    naLabel: '',
    naNote: '',
    displayOnlyEnrollmentExcluded: false
  };
}

function shouldIncludeApplicabilityState(state, visibility = {}) {
  if (!state) return false;
  const policy = sessionAccessPolicyService.resolveNaAttendanceVisibility(visibility);
  if (state.expected === true) return true;
  const reason = String(state.reason || '').trim();
  if (reason === APPLICABILITY_REASON.MANUAL_NOT_APPLICABLE) return policy.teacherNa === true;
  if (reason === APPLICABILITY_REASON.APPROVED_LEAVE) return policy.approvedLeaveNa === true;
  if (reason === APPLICABILITY_REASON.MAKEUP_REQUIRED) return policy.makeupRequiredNa === true;
  if (reason === APPLICABILITY_REASON.ENROLLMENT_EXCLUDED) return policy.enrollmentExcludedNa === true;
  if (reason === APPLICABILITY_REASON.HOUR_CAP_REACHED
    || reason === APPLICABILITY_REASON.SESSION_CAP_REACHED) {
    return false;
  }
  return false;
}

function isNaTypeVisible(visibility = {}, naReasonCode = '') {
  const policy = sessionAccessPolicyService.resolveNaAttendanceVisibility(visibility);
  const code = String(naReasonCode || '').trim();
  if (!code) return true;
  const policyKey = POLICY_KEY_BY_REASON[code];
  if (!policyKey) return true;
  return policy[policyKey] === true;
}

function filterRosterByNaVisibilityPolicy(roster = [], visibility = {}, contextByPersonId = new Map()) {
  const rows = Array.isArray(roster) ? roster : [];
  return rows.filter((row) => {
    const personId = cleanPersonId(row?.personId);
    const context = contextByPersonId.get(personId) || {};
    const naReasonCode = String(context.naReasonCode || row?.naReasonCode || '').trim();
    const attendance = attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(row?.attendance, '');
    if (attendance !== attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE && !naReasonCode) {
      return true;
    }
    if (!naReasonCode) return true;
    return isNaTypeVisible(visibility, naReasonCode);
  });
}

function stripDisplayOnlyEnrollmentExcludedFromSave({
  incomingRoster = [],
  existingRoster = [],
  periodRows = [],
  classId = '',
  sessionId = ''
} = {}) {
  const normalizedSessionId = toPublicId(sessionId);
  const existing = Array.isArray(existingRoster) ? existingRoster : [];
  return (Array.isArray(incomingRoster) ? incomingRoster : []).filter((row) => {
    const personId = cleanPersonId(row?.personId);
    if (!personId) return true;
    if (row?.displayOnlyEnrollmentExcluded === true) return false;
    const lock = enrollmentSessionMarksService.findLockedEnrollmentNaMark(
      periodRows,
      classId,
      normalizedSessionId,
      personId
    );
    if (!lock) return true;
    const existedOnRoster = existing.some((item) => idsEqual(item?.personId, personId));
    return existedOnRoster;
  });
}

function attachNaContextToRosterRow(row = {}, context = {}) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    naReasonCode: String(context.naReasonCode || '').trim(),
    naLabel: String(context.naLabel || '').trim(),
    naNote: String(context.naNote || '').trim(),
    displayOnlyEnrollmentExcluded: context.displayOnlyEnrollmentExcluded === true
  };
}

module.exports = {
  NA_REASON,
  NA_LABELS,
  POLICY_KEY_BY_REASON,
  resolveNaStatusContext,
  shouldIncludeApplicabilityState,
  isNaTypeVisible,
  filterRosterByNaVisibilityPolicy,
  stripDisplayOnlyEnrollmentExcludedFromSave,
  attachNaContextToRosterRow,
  findActiveHoldForSession,
  isOnHoldNaRow
};
