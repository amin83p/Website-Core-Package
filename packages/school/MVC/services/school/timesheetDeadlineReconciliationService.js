'use strict';

const POLICY_VERSION = 1;
const SOURCE_TYPE_CLASS_SESSION = 'class_session';

function normalizeDate(value) {
  const token = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function roundHours(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function resolveReconciliationCutoffDate(period = {}) {
  const startDate = normalizeDate(period?.startDate);
  const endDate = normalizeDate(period?.endDate);
  const deadlineDate = normalizeDate(period?.submissionDeadline);
  if (!startDate || !endDate || !deadlineDate || startDate > endDate || deadlineDate > endDate) return '';
  return deadlineDate < startDate ? startDate : deadlineDate;
}

function isDateInPeriod(date, period = {}) {
  const dateKey = normalizeDate(date);
  const startDate = normalizeDate(period?.startDate);
  const endDate = normalizeDate(period?.endDate);
  return Boolean(dateKey && startDate && endDate && dateKey >= startDate && dateKey <= endDate);
}

function isDateInReconciliationWindow(date, period = {}) {
  const dateKey = normalizeDate(date);
  const cutoffDate = resolveReconciliationCutoffDate(period);
  const endDate = normalizeDate(period?.endDate);
  return Boolean(dateKey && cutoffDate && endDate && dateKey >= cutoffDate && dateKey <= endDate);
}

function classifySession({
  period = {},
  sessionDate = '',
  isFinalStatus = false,
  baselineStatus = '',
  baselineHours = 0,
  sourceType = SOURCE_TYPE_CLASS_SESSION
} = {}) {
  const cutoffDate = resolveReconciliationCutoffDate(period);
  const reconciliationRequired = isDateInReconciliationWindow(sessionDate, period);
  const isProvisional = reconciliationRequired && isFinalStatus !== true;
  const result = {
    reconciliationRequired,
    isProvisional
  };
  if (reconciliationRequired) {
    result.provisionalMeta = {
      policyVersion: POLICY_VERSION,
      cutoffDate,
      baselineStatus: String(baselineStatus || '').trim().toLowerCase(),
      baselineHours: roundHours(baselineHours),
      sourceType: String(sourceType || SOURCE_TYPE_CLASS_SESSION).trim().toLowerCase() || SOURCE_TYPE_CLASS_SESSION
    };
  }
  return result;
}

function applySessionClassification(entry = {}, { period = {}, isFinalStatus = false, sourceType = SOURCE_TYPE_CLASS_SESSION } = {}) {
  const baselineHours = entry?.timesheetHours ?? entry?.hours ?? entry?.durationHours ?? 0;
  return {
    ...entry,
    isFinalStatus: isFinalStatus === true,
    ...classifySession({
      period,
      sessionDate: entry?.date,
      isFinalStatus,
      baselineStatus: entry?.status,
      baselineHours,
      sourceType
    })
  };
}

function isBlockingNonFinalSession({ period = {}, sessionDate = '', isFinalStatus = false } = {}) {
  if (isFinalStatus === true) return false;
  if (!isDateInPeriod(sessionDate, period)) return false;
  return !isDateInReconciliationWindow(sessionDate, period);
}

function resolveReconciliationSnapshotEntries(timesheet = {}) {
  const snapshotEntries = Array.isArray(timesheet?.submissionSnapshot?.entries)
    ? timesheet.submissionSnapshot.entries
    : [];
  return snapshotEntries.filter((entry) => (
    entry
    && entry.isDeleted !== true
    && entry.isManual !== true
    && entry.reconciliationRequired === true
  ));
}

function hasReconciliationSnapshotEntries(timesheet = {}) {
  return resolveReconciliationSnapshotEntries(timesheet).length > 0;
}

module.exports = {
  POLICY_VERSION,
  SOURCE_TYPE_CLASS_SESSION,
  applySessionClassification,
  classifySession,
  hasReconciliationSnapshotEntries,
  isBlockingNonFinalSession,
  isDateInPeriod,
  isDateInReconciliationWindow,
  normalizeDate,
  resolveReconciliationCutoffDate,
  resolveReconciliationSnapshotEntries,
  roundHours
};
