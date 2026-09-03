'use strict';

const { requireCoreModule } = require('./schoolCoreModuleResolver');
const sessionAccessPolicyModel = require('../../models/school/sessionAccessPolicyModel');
const timesheetPeriodModel = require('../../models/school/timesheetPeriodModel');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const {
  zonedWallClockToUtcMs,
  normalizeTimezoneToken
} = requireCoreModule('MVC/utils/timezoneUtils');

const FIXED_GRACE_DAYS_WHEN_DISABLED = 1;
const SECTION_EDIT_TARGETS = Object.freeze({
  attendance: Object.freeze({
    key: 'attendance',
    policyKey: 'completedSessionAttendanceEdit',
    label: 'Attendance',
    errorCode: 'SESSION_ATTENDANCE_EDIT_WINDOW_EXPIRED'
  }),
  notes: Object.freeze({
    key: 'notes',
    policyKey: 'completedSessionNotesEdit',
    label: 'Session Notes',
    errorCode: 'SESSION_NOTES_EDIT_WINDOW_EXPIRED'
  }),
  gradebook: Object.freeze({
    key: 'gradebook',
    policyKey: 'completedSessionGradebookEdit',
    label: 'Grade book/Activities',
    errorCode: 'SESSION_GRADEBOOK_EDIT_WINDOW_EXPIRED'
  }),
  conduct: Object.freeze({
    key: 'conduct',
    policyKey: 'completedSessionConductEdit',
    label: 'Class Conduct Before Reports',
    errorCode: 'SESSION_CONDUCT_EDIT_WINDOW_EXPIRED'
  }),
  curriculum: Object.freeze({
    key: 'curriculum',
    policyKey: 'completedSessionCurriculumEdit',
    label: 'Curriculum',
    errorCode: 'SESSION_CURRICULUM_EDIT_WINDOW_EXPIRED'
  }),
  studentcases: Object.freeze({
    key: 'studentcases',
    policyKey: 'completedSessionStudentCasesEdit',
    label: 'Student Cases',
    errorCode: 'SESSION_STUDENT_CASES_EDIT_WINDOW_EXPIRED'
  })
});

function resolveSectionEditTarget(target = 'attendance') {
  const key = String(target || 'attendance').trim().toLowerCase();
  return SECTION_EDIT_TARGETS[key] || SECTION_EDIT_TARGETS.attendance;
}

function cleanDateKey(value) {
  const token = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function addDaysToDateKey(dateKey, days) {
  const token = cleanDateKey(dateKey);
  if (!token) return '';
  const [year, month, day] = token.split('-').map((part) => Number(part));
  const utc = Date.UTC(year, month - 1, day + Number(days || 0));
  const next = new Date(utc);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

function endOfWeekDateKey(dateKey) {
  const token = cleanDateKey(dateKey);
  if (!token) return '';
  const [year, month, day] = token.split('-').map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  const daysUntilSunday = weekday === 0 ? 0 : (7 - weekday);
  return addDaysToDateKey(token, daysUntilSunday);
}

function endOfMonthDateKey(dateKey) {
  const token = cleanDateKey(dateKey);
  if (!token) return '';
  const [year, month] = token.split('-').map((part) => Number(part));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

function resolveCompletionInstant(session = {}) {
  const completedAt = String(session?.completedAt || '').trim();
  if (completedAt) {
    const parsed = Date.parse(completedAt);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  const sessionDate = cleanDateKey(session?.date);
  if (sessionDate) {
    const endTime = String(session?.endTime || session?.startTime || '23:59').trim().slice(0, 5);
    return new Date(zonedWallClockToUtcMs(sessionDate, endTime, 'UTC'));
  }
  return null;
}

function resolveSessionDateKey(session = {}) {
  return cleanDateKey(session?.date);
}

async function findTimesheetPeriodForSessionDate(orgId, sessionDate) {
  const dateKey = cleanDateKey(sessionDate);
  if (!dateKey) return null;
  const periods = await timesheetPeriodModel.getAllTimesheetPeriods();
  const orgPeriods = (Array.isArray(periods) ? periods : [])
    .filter((row) => String(row?.orgId || '').trim() === String(orgId || '').trim())
    .filter((row) => cleanDateKey(row?.startDate) && cleanDateKey(row?.endDate))
    .filter((row) => cleanDateKey(row.startDate) <= dateKey && dateKey <= cleanDateKey(row.endDate))
    .sort((left, right) => String(right.endDate).localeCompare(String(left.endDate)));
  return orgPeriods[0] || null;
}

function resolveDeadlineDateKey({
  policy,
  session,
  orgId,
  timesheetPeriod = null,
  policyKey = SECTION_EDIT_TARGETS.attendance.policyKey
}) {
  const editPolicy = policy?.[policyKey] || {};
  const sessionDate = resolveSessionDateKey(session);
  const completionInstant = resolveCompletionInstant(session);
  const completionDate = completionInstant
    ? cleanDateKey(completionInstant.toISOString().slice(0, 10))
    : sessionDate;

  if (!editPolicy.enabled) {
    const baseDate = completionDate || sessionDate;
    return baseDate ? addDaysToDateKey(baseDate, FIXED_GRACE_DAYS_WHEN_DISABLED) : '';
  }

  switch (editPolicy.windowType) {
    case 'end_of_week':
      return endOfWeekDateKey(completionDate || sessionDate);
    case 'end_of_month':
      return endOfMonthDateKey(completionDate || sessionDate);
    case 'timesheet_period': {
      const periodEnd = cleanDateKey(timesheetPeriod?.endDate);
      if (periodEnd) return periodEnd;
      return endOfMonthDateKey(completionDate || sessionDate);
    }
    case 'days_after_session': {
      const days = Number(editPolicy.daysAfterSession || 0);
      const baseDate = sessionDate || completionDate;
      return baseDate && days > 0 ? addDaysToDateKey(baseDate, days) : '';
    }
    default:
      return '';
  }
}

function resolveDeadlineInstant({
  deadlineDateKey = '',
  timeZone = 'UTC'
} = {}) {
  const dateKey = cleanDateKey(deadlineDateKey);
  if (!dateKey) return null;
  const tz = normalizeTimezoneToken(timeZone, 'UTC');
  const ms = zonedWallClockToUtcMs(dateKey, '23:59', tz);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

async function resolveSessionSectionEditAccess({
  orgId = '',
  session = {},
  policy = null,
  orgTimeZone = 'UTC',
  now = new Date(),
  timesheetPeriod = undefined,
  target = 'attendance',
  statusMap = null
} = {}) {
  const resolvedTarget = resolveSectionEditTarget(target);
  const resolvedPolicy = policy || await sessionAccessPolicyModel.getPolicyForOrg(orgId);
  const effectiveStatusMap = statusMap || await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
  const isCompletion = sessionStatusPolicyService.isSessionCompletionStatusByMap(effectiveStatusMap, session);
  if (!isCompletion) {
    return {
      editable: true,
      reason: 'session_not_completed',
      deadlineAt: null,
      deadlineDateKey: '',
      policy: resolvedPolicy,
      target: resolvedTarget.key,
      policyKey: resolvedTarget.policyKey,
      targetLabel: resolvedTarget.label
    };
  }

  const period = timesheetPeriod === undefined
    ? await findTimesheetPeriodForSessionDate(orgId, resolveSessionDateKey(session))
    : timesheetPeriod;
  const deadlineDateKey = resolveDeadlineDateKey({
    policy: resolvedPolicy,
    session,
    orgId,
    timesheetPeriod: period,
    policyKey: resolvedTarget.policyKey
  });
  const deadlineAt = resolveDeadlineInstant({
    deadlineDateKey,
    timeZone: orgTimeZone
  });
  const editable = !deadlineAt || now.getTime() <= deadlineAt.getTime();

  return {
    editable,
    reason: editable ? 'within_edit_window' : 'edit_window_expired',
    deadlineAt: deadlineAt ? deadlineAt.toISOString() : null,
    deadlineDateKey,
    policy: resolvedPolicy,
    timesheetPeriod: period,
    target: resolvedTarget.key,
    policyKey: resolvedTarget.policyKey,
    targetLabel: resolvedTarget.label
  };
}

function resolveLockedSectionLabel(access = {}, fallbackTarget = 'attendance') {
  const fallback = resolveSectionEditTarget(fallbackTarget);
  return String(access?.targetLabel || fallback.label || 'This section').trim();
}

function formatDeadlineMessage(access = {}, fallbackTarget = 'attendance') {
  const sectionLabel = resolveLockedSectionLabel(access, fallbackTarget);
  if (access.editable) return '';
  if (access.deadlineDateKey) {
    return `${sectionLabel} edits are locked after ${access.deadlineDateKey} for completed sessions. Contact an administrator if you need an override.`;
  }
  return `${sectionLabel} edits are locked for this completed session. Contact an administrator if you need an override.`;
}

async function assertSessionSectionEditable({
  orgId = '',
  session = {},
  policy = null,
  orgTimeZone = 'UTC',
  now = new Date(),
  canOverride = false,
  timesheetPeriod = undefined,
  target = 'attendance',
  statusMap = null
} = {}) {
  const resolvedTarget = resolveSectionEditTarget(target);
  if (canOverride) {
    return {
      editable: true,
      reason: 'admin_override',
      target: resolvedTarget.key,
      policyKey: resolvedTarget.policyKey,
      targetLabel: resolvedTarget.label
    };
  }
  const access = await resolveSessionSectionEditAccess({
    orgId,
    session,
    policy,
    orgTimeZone,
    now,
    timesheetPeriod,
    target: resolvedTarget.key,
    statusMap
  });
  if (!access.editable) {
    const error = new Error(formatDeadlineMessage(access, resolvedTarget.key));
    error.statusCode = 403;
    error.code = resolvedTarget.errorCode;
    error.data = {
      deadlineAt: access.deadlineAt,
      deadlineDateKey: access.deadlineDateKey,
      target: resolvedTarget.key,
      targetLabel: resolvedTarget.label
    };
    throw error;
  }
  return access;
}

async function resolveAttendanceEditAccess(options = {}) {
  return resolveSessionSectionEditAccess({ ...options, target: 'attendance' });
}

async function assertSessionAttendanceEditable(options = {}) {
  return assertSessionSectionEditable({ ...options, target: 'attendance' });
}

module.exports = {
  FIXED_GRACE_DAYS_WHEN_DISABLED,
  SECTION_EDIT_TARGETS,
  resolveSectionEditTarget,
  addDaysToDateKey,
  endOfWeekDateKey,
  endOfMonthDateKey,
  resolveCompletionInstant,
  findTimesheetPeriodForSessionDate,
  resolveDeadlineDateKey,
  resolveDeadlineInstant,
  resolveSessionSectionEditAccess,
  assertSessionSectionEditable,
  resolveAttendanceEditAccess,
  formatDeadlineMessage,
  assertSessionAttendanceEditable
};
