'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const { zonedWallClockToIso } = requireCoreModule('MVC/utils/timezoneUtils');

function resolvePeriodSubmissionDeadlineAt(period, orgTimeZone = '') {
  const deadline = String(period?.submissionDeadline || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return '';
  const time = String(period?.submissionDeadlineTime || '23:59').trim() || '23:59';
  return zonedWallClockToIso(deadline, time, orgTimeZone) || '';
}

function isPeriodSubmissionDeadlinePassed(period, orgTimeZone = '', now = new Date()) {
  const deadlineAt = resolvePeriodSubmissionDeadlineAt(period, orgTimeZone);
  if (!deadlineAt) return false;
  const deadlineMs = Date.parse(deadlineAt);
  if (!Number.isFinite(deadlineMs)) return false;
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now || ''));
  if (!Number.isFinite(nowMs)) return false;
  return nowMs > deadlineMs;
}

function normalizeTodayToken(today = '') {
  const token = String(today || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function resolvePeriodEligibility(period, options = {}) {
  const {
    orgTimeZone = '',
    today = '',
    now = new Date(),
    isManagementViewer = false,
    viewingOtherTeacher = false,
    allowLateSubmission = false
  } = options;

  const startDate = String(period?.startDate || '').trim();
  const todayToken = normalizeTodayToken(today);
  const base = {
    phase: 'active',
    canOpen: true,
    canSubmit: true,
    reason: ''
  };

  if (todayToken && startDate && todayToken < startDate) {
    if (isManagementViewer && viewingOtherTeacher) {
      return {
        phase: 'upcoming',
        canOpen: true,
        canSubmit: false,
        reason: 'This timesheet period has not started yet. You can preview it as a manager, but the teacher cannot submit until the period begins.'
      };
    }
    return {
      phase: 'upcoming',
      canOpen: false,
      canSubmit: false,
      reason: `This timesheet period opens on ${startDate}.`
    };
  }

  if (isPeriodSubmissionDeadlinePassed(period, orgTimeZone, now) && allowLateSubmission !== true) {
    const deadlineLabel = String(period?.submissionDeadline || '').trim();
    return {
      phase: 'deadline_passed',
      canOpen: true,
      canSubmit: false,
      reason: deadlineLabel
        ? `The submission deadline (${deadlineLabel}) for this timesheet period has passed.`
        : 'The submission deadline for this timesheet period has passed.'
    };
  }

  return base;
}

function attachEligibilityToPeriodRow(period, options = {}) {
  const eligibility = resolvePeriodEligibility(period, options);
  return {
    ...period,
    eligibilityPhase: eligibility.phase,
    canOpen: eligibility.canOpen,
    canSubmit: eligibility.canSubmit,
    eligibilityReason: eligibility.reason
  };
}

module.exports = {
  resolvePeriodSubmissionDeadlineAt,
  isPeriodSubmissionDeadlinePassed,
  resolvePeriodEligibility,
  attachEligibilityToPeriodRow
};
