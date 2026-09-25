'use strict';

const DEFAULT_POLICY = Object.freeze({
  daysToExpectedFinishDate: null,
  sessionsToFinishEnrollment: null,
  hoursToFinishEnrollment: null,
  alertMessage: ''
});

const ALERT_MESSAGE_MAX_LENGTH = 500;

function normalizeDateOnly(value = '') {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function normalizeOptionalThreshold(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(9999, parsed);
}

function normalizeAlertMessage(value = '') {
  return String(value || '').trim().slice(0, ALERT_MESSAGE_MAX_LENGTH);
}

function normalizePolicyFromStored(stored = {}) {
  const row = stored && typeof stored === 'object' ? stored : {};
  return {
    daysToExpectedFinishDate: normalizeOptionalThreshold(row.daysToExpectedFinishDate),
    sessionsToFinishEnrollment: normalizeOptionalThreshold(row.sessionsToFinishEnrollment),
    hoursToFinishEnrollment: normalizeOptionalThreshold(row.hoursToFinishEnrollment),
    alertMessage: normalizeAlertMessage(row.alertMessage)
  };
}

function resolvePolicy(base = {}) {
  const normalized = normalizePolicyFromStored(base);
  return {
    ...DEFAULT_POLICY,
    ...normalized
  };
}

function validatePolicyInput(body = {}) {
  const source = body && typeof body === 'object' ? body : {};
  return resolvePolicy({
    daysToExpectedFinishDate: source.daysToExpectedFinishDate,
    sessionsToFinishEnrollment: source.sessionsToFinishEnrollment,
    hoursToFinishEnrollment: source.hoursToFinishEnrollment,
    alertMessage: source.alertMessage
  });
}

function calendarDaysFromTo(fromDate = '', toDate = '') {
  const from = normalizeDateOnly(fromDate);
  const to = normalizeDateOnly(toDate);
  if (!from || !to) return null;
  const fromMs = new Date(`${from}T12:00:00`).getTime();
  const toMs = new Date(`${to}T12:00:00`).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return Math.round((toMs - fromMs) / 86400000);
}

function evaluateAlert({
  policy = {},
  sessionDate = '',
  finishDate = '',
  remainingSessionCount = null,
  remainingHours = null,
  hasSessionTarget = false,
  hasHourTarget = false
} = {}) {
  const resolved = resolvePolicy(policy);
  const reasons = [];
  const details = [];

  const daysThreshold = resolved.daysToExpectedFinishDate;
  if (daysThreshold != null) {
    const daysUntilFinish = calendarDaysFromTo(sessionDate, finishDate);
    if (daysUntilFinish !== null && daysUntilFinish <= daysThreshold) {
      reasons.push('days');
      details.push({
        reason: 'days',
        threshold: daysThreshold,
        daysUntilFinish,
        finishDate: normalizeDateOnly(finishDate),
        sessionDate: normalizeDateOnly(sessionDate)
      });
    }
  }

  const sessionsThreshold = resolved.sessionsToFinishEnrollment;
  if (sessionsThreshold != null && hasSessionTarget && remainingSessionCount !== null) {
    const remaining = Number(remainingSessionCount);
    if (Number.isFinite(remaining) && remaining <= sessionsThreshold) {
      reasons.push('sessions');
      details.push({
        reason: 'sessions',
        threshold: sessionsThreshold,
        remainingSessionCount: remaining
      });
    }
  }

  const hoursThreshold = resolved.hoursToFinishEnrollment;
  if (hoursThreshold != null && hasHourTarget && remainingHours !== null) {
    const remaining = Number(remainingHours);
    if (Number.isFinite(remaining) && remaining <= hoursThreshold) {
      reasons.push('hours');
      details.push({
        reason: 'hours',
        threshold: hoursThreshold,
        remainingHours: remaining
      });
    }
  }

  return {
    active: reasons.length > 0,
    reasons,
    details,
    alertMessage: resolved.alertMessage
  };
}

module.exports = {
  DEFAULT_POLICY,
  ALERT_MESSAGE_MAX_LENGTH,
  normalizeOptionalThreshold,
  normalizePolicyFromStored,
  resolvePolicy,
  validatePolicyInput,
  evaluateAlert,
  calendarDaysFromTo
};
