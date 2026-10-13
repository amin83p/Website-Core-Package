'use strict';

const { isManualScheduledCloseForAttendance } = require('./classEnrollmentSessionApplicabilityService');

const TERMINAL_CLOSE_STATUSES = new Set(['completed', 'withdrawn', 'cancelled', 'archived']);

function normalizeEnrollmentDateOnly(value = '') {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function readEnrollmentLastCloseSnapshot(row = {}) {
  const snap = row?.transactionSummary?.lastCloseSnapshot;
  return snap && typeof snap === 'object' ? snap : null;
}

function resolveScheduledClosingDateForRow(row = {}) {
  const endDate = String(row?.endDate || '').trim();
  const snap = readEnrollmentLastCloseSnapshot(row);
  return endDate || normalizeEnrollmentDateOnly(snap?.closedEndDate);
}

function rowHasScheduledEnrollmentClose(row = {}) {
  const status = String(row?.status || '').trim().toLowerCase();
  const terminalClose = TERMINAL_CLOSE_STATUSES.has(status);
  const snap = readEnrollmentLastCloseSnapshot(row);
  const closingDate = resolveScheduledClosingDateForRow(row);
  return Boolean(normalizeEnrollmentDateOnly(snap?.closedEndDate) || (terminalClose && closingDate));
}

/**
 * @returns {{
 *   primaryDate: string,
 *   enrollmentEndDate: string,
 *   closedOnDate: string,
 *   showEnrollmentEndLine: boolean,
 *   showClosedOn: boolean,
 *   completionSessionId: string,
 *   showCompletingSessionDate: boolean,
 *   dateLineCount: number
 * }}
 */
function shouldSuppressTargetCompletionDateForDisplay(row = {}, completionDate = '', closingDate = '') {
  if (!completionDate || !closingDate || completionDate >= closingDate) return false;
  return isManualScheduledCloseForAttendance(row);
}

function resolveEnrollmentCompletionDisplay(row = {}, completion = null) {
  const closingDate = resolveScheduledClosingDateForRow(row);
  const showClosing = rowHasScheduledEnrollmentClose(row) && Boolean(closingDate);
  const completionDate = String(completion?.date || '').trim();
  const snap = readEnrollmentLastCloseSnapshot(row);
  const closedOnDate = showClosing && snap?.closedAt
    ? normalizeEnrollmentDateOnly(snap.closedAt)
    : '';

  const suppressTargetCompletion = shouldSuppressTargetCompletionDateForDisplay(row, completionDate, closingDate);
  const showCompletingSessionDate = Boolean(completionDate && !suppressTargetCompletion);
  const primaryDate = showCompletingSessionDate
    ? completionDate
    : (showClosing ? closingDate : completionDate);
  const enrollmentEndDate = showClosing && closingDate && closingDate !== primaryDate ? closingDate : '';
  const showEnrollmentEndLine = Boolean(enrollmentEndDate);
  const showClosedOn = Boolean(closedOnDate);
  const completionSessionId = String(completion?.sessionId || '').trim();

  let dateLineCount = 0;
  if (primaryDate) dateLineCount += 1;
  if (showEnrollmentEndLine) dateLineCount += 1;
  if (showClosedOn) dateLineCount += 1;

  return {
    primaryDate,
    enrollmentEndDate,
    closedOnDate,
    showEnrollmentEndLine,
    showClosedOn,
    showCompletingSessionDate,
    completionSessionId,
    dateLineCount,
    showClosing,
    closingDate,
    completionDate
  };
}

module.exports = {
  normalizeEnrollmentDateOnly,
  readEnrollmentLastCloseSnapshot,
  resolveScheduledClosingDateForRow,
  rowHasScheduledEnrollmentClose,
  shouldSuppressTargetCompletionDateForDisplay,
  resolveEnrollmentCompletionDisplay
};
