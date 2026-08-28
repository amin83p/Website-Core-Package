'use strict';

const SEND_WHEN_VALUES = Object.freeze(['same_day', 'next_day']);
const WINDOW_TYPE_VALUES = Object.freeze([
  'end_of_week',
  'end_of_month',
  'timesheet_period',
  'days_after_session'
]);

const TEMPLATE_TOKENS = Object.freeze([
  'className',
  'classId',
  'sessionName',
  'sessionId',
  'sessionDate',
  'sessionTime',
  'teacherName',
  'orgName',
  'sessionManagerUrl'
]);

const DEFAULT_POLICY = Object.freeze({
  uncompletedSessionNotification: Object.freeze({
    enabled: false,
    sendWhen: 'same_day',
    sendAtTime: '18:00',
    channels: Object.freeze({
      email: Object.freeze({
        enabled: true,
        fromEmail: '',
        subjectTemplate: 'Reminder: complete session for {{className}} on {{sessionDate}}',
        bodyTemplate: 'Please complete attendance for {{className}} — {{sessionName}} ({{sessionDate}} {{sessionTime}}).'
      }),
      sms: Object.freeze({
        enabled: false,
        bodyTemplate: 'Reminder: complete {{sessionName}} for {{className}} on {{sessionDate}}.'
      })
    })
  }),
  completedSessionAttendanceEdit: Object.freeze({
    enabled: true,
    windowType: 'timesheet_period',
    daysAfterSession: null
  })
});

function boolFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback === true;
  if (value === true || value === 1) return true;
  const token = String(value).trim().toLowerCase();
  if (['true', '1', 'on', 'yes'].includes(token)) return true;
  if (['false', '0', 'off', 'no'].includes(token)) return false;
  return fallback === true;
}

function cleanText(value, { max = 4000, allowEmpty = true } = {}) {
  const text = String(value ?? '').replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return '';
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeTimeHm(value, fallback = '18:00') {
  const token = cleanText(value, { max: 8 });
  if (/^\d{2}:\d{2}$/.test(token)) {
    const [hours, minutes] = token.split(':').map((part) => Number(part));
    if (Number.isInteger(hours) && Number.isInteger(minutes) && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return token;
    }
  }
  return normalizeTimeHm(fallback, '18:00');
}

function normalizeSendWhen(value, fallback = 'same_day') {
  const token = cleanText(value, { max: 32 }).toLowerCase();
  return SEND_WHEN_VALUES.includes(token) ? token : fallback;
}

function normalizeWindowType(value, fallback = 'timesheet_period') {
  const token = cleanText(value, { max: 64 }).toLowerCase();
  return WINDOW_TYPE_VALUES.includes(token) ? token : fallback;
}

function normalizeDaysAfterSession(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.min(parsed, 365);
}

function normalizeEmailChannel(input = {}, fallback = DEFAULT_POLICY.uncompletedSessionNotification.channels.email) {
  return {
    enabled: boolFlag(input.enabled, fallback.enabled === true),
    fromEmail: cleanText(input.fromEmail, { max: 254 }),
    subjectTemplate: cleanText(
      input.subjectTemplate,
      { max: 500, allowEmpty: false }
    ) || fallback.subjectTemplate,
    bodyTemplate: cleanText(
      input.bodyTemplate,
      { max: 4000, allowEmpty: false }
    ) || fallback.bodyTemplate
  };
}

function normalizeSmsChannel(input = {}, fallback = DEFAULT_POLICY.uncompletedSessionNotification.channels.sms) {
  return {
    enabled: boolFlag(input.enabled, fallback.enabled === true),
    bodyTemplate: cleanText(
      input.bodyTemplate,
      { max: 320, allowEmpty: false }
    ) || fallback.bodyTemplate
  };
}

function normalizeNotificationSettings(input = {}) {
  const fallback = DEFAULT_POLICY.uncompletedSessionNotification;
  const channels = input.channels && typeof input.channels === 'object' ? input.channels : {};
  return {
    enabled: boolFlag(input.enabled, fallback.enabled === true),
    sendWhen: normalizeSendWhen(input.sendWhen, fallback.sendWhen),
    sendAtTime: normalizeTimeHm(input.sendAtTime, fallback.sendAtTime),
    channels: {
      email: normalizeEmailChannel(channels.email, fallback.channels.email),
      sms: normalizeSmsChannel(channels.sms, fallback.channels.sms)
    }
  };
}

function normalizeAttendanceEditSettings(input = {}) {
  const fallback = DEFAULT_POLICY.completedSessionAttendanceEdit;
  const windowType = normalizeWindowType(input.windowType, fallback.windowType);
  const daysAfterSession = windowType === 'days_after_session'
    ? normalizeDaysAfterSession(input.daysAfterSession)
    : null;
  return {
    enabled: boolFlag(input.enabled, fallback.enabled === true),
    windowType,
    daysAfterSession
  };
}

function normalizePolicyFromStored(input = {}) {
  return {
    uncompletedSessionNotification: normalizeNotificationSettings(input.uncompletedSessionNotification),
    completedSessionAttendanceEdit: normalizeAttendanceEditSettings(input.completedSessionAttendanceEdit)
  };
}

function normalizePolicyFromForm(input = {}) {
  return normalizePolicyFromStored(input);
}

function resolvePolicy(input = {}) {
  return normalizePolicyFromStored(input);
}

function validatePolicyInput(input = {}) {
  const normalized = normalizePolicyFromForm(input);
  if (
    normalized.completedSessionAttendanceEdit.windowType === 'days_after_session'
    && !normalized.completedSessionAttendanceEdit.daysAfterSession
  ) {
    const error = new Error('Days after session is required when that edit window is selected.');
    error.statusCode = 400;
    throw error;
  }
  const invalidTokens = findInvalidTemplateTokens([
    normalized.uncompletedSessionNotification.channels.email.subjectTemplate,
    normalized.uncompletedSessionNotification.channels.email.bodyTemplate,
    normalized.uncompletedSessionNotification.channels.sms.bodyTemplate
  ]);
  if (invalidTokens.length) {
    const error = new Error(`Unknown template placeholder(s): ${invalidTokens.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function findInvalidTemplateTokens(templates = []) {
  const invalid = new Set();
  templates.forEach((template) => {
    const matches = String(template || '').match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) || [];
    matches.forEach((match) => {
      const key = match.replace(/[{}\s]/g, '');
      if (!TEMPLATE_TOKENS.includes(key)) invalid.add(key);
    });
  });
  return [...invalid];
}

function renderTemplate(template = '', context = {}) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = context[String(key || '').trim()];
    return value == null ? '' : String(value);
  });
}

module.exports = {
  SEND_WHEN_VALUES,
  WINDOW_TYPE_VALUES,
  TEMPLATE_TOKENS,
  DEFAULT_POLICY,
  normalizePolicyFromStored,
  normalizePolicyFromForm,
  resolvePolicy,
  validatePolicyInput,
  renderTemplate,
  findInvalidTemplateTokens
};
