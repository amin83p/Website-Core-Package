'use strict';

const SEND_WHEN_VALUES = Object.freeze(['same_day', 'next_day', 'daily_all']);
const DAILY_DIGEST_SESSION_ID = 'daily_digest';
const SESSION_DATE_RANGE_TYPES = Object.freeze([
  'this_week',
  'two_weeks',
  'this_month',
  'timesheet_period',
  'days_before_today'
]);
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
  'sessionManagerUrl',
  'sessionCount',
  'sessionList'
]);

const DEFAULT_SESSION_DATE_RANGE = Object.freeze({
  type: 'this_week',
  daysBeforeToday: null
});

const DEFAULT_CHANNEL_SCHEDULE = Object.freeze({
  sendWhen: 'same_day',
  sendAtTime: '18:00',
  sessionDateRange: DEFAULT_SESSION_DATE_RANGE
});

const DEFAULT_POLICY = Object.freeze({
  uncompletedSessionNotification: Object.freeze({
    enabled: false,
    channels: Object.freeze({
      email: Object.freeze({
        enabled: true,
        sendWhen: 'daily_all',
        sendAtTime: '18:00',
        sessionDateRange: DEFAULT_SESSION_DATE_RANGE,
        emailTemplateId: '',
        fromEmail: '',
        subjectTemplate: 'Reminder: {{sessionCount}} uncompleted session(s) need attention',
        bodyTemplate: 'Hi {{teacherName}},\n\nThe following uncompleted sessions need your attention:\n\n{{sessionList}}\n\nThank you,\n{{orgName}}'
      }),
      sms: Object.freeze({
        enabled: false,
        sendWhen: 'same_day',
        sendAtTime: '18:00',
        sessionDateRange: DEFAULT_SESSION_DATE_RANGE,
        bodyTemplate: '{{orgName}}: {{sessionCount}} uncompleted session(s) need attention.'
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

function normalizeSessionDateRangeType(value, fallback = 'this_week') {
  const token = cleanText(value, { max: 64 }).toLowerCase();
  return SESSION_DATE_RANGE_TYPES.includes(token) ? token : fallback;
}

function normalizeDaysBeforeToday(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.min(parsed, 365);
}

function normalizeSessionDateRange(input = {}, fallback = DEFAULT_SESSION_DATE_RANGE) {
  const type = normalizeSessionDateRangeType(input?.type, fallback.type);
  const daysBeforeToday = type === 'days_before_today'
    ? normalizeDaysBeforeToday(input?.daysBeforeToday)
    : null;
  return { type, daysBeforeToday };
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

function normalizeChannelSchedule(input = {}, legacy = {}, fallback = DEFAULT_CHANNEL_SCHEDULE) {
  return {
    sendWhen: normalizeSendWhen(
      input.sendWhen ?? legacy.sendWhen,
      fallback.sendWhen
    ),
    sendAtTime: normalizeTimeHm(
      input.sendAtTime ?? legacy.sendAtTime,
      fallback.sendAtTime
    ),
    sessionDateRange: normalizeSessionDateRange(
      input.sessionDateRange,
      fallback.sessionDateRange
    )
  };
}

function normalizeEmailChannel(input = {}, legacy = {}, fallback = DEFAULT_POLICY.uncompletedSessionNotification.channels.email) {
  const schedule = normalizeChannelSchedule(input, legacy, fallback);
  const emailTemplateId = cleanText(input.emailTemplateId, { max: 120 });
  const fromEmail = cleanText(input.fromEmail, { max: 254 });
  const subjectTemplate = cleanText(input.subjectTemplate, { max: 500, allowEmpty: true });
  const bodyTemplate = cleanText(input.bodyTemplate, { max: 4000, allowEmpty: true });
  return {
    enabled: boolFlag(input.enabled, fallback.enabled === true),
    ...schedule,
    emailTemplateId,
    fromEmail,
    subjectTemplate: subjectTemplate || fallback.subjectTemplate,
    bodyTemplate: bodyTemplate || fallback.bodyTemplate
  };
}

function hasLegacyEmailTemplates(channel = {}) {
  return Boolean(
    cleanText(channel?.fromEmail, { max: 254 })
    || cleanText(channel?.subjectTemplate, { max: 500 })
    || cleanText(channel?.bodyTemplate, { max: 4000 })
  );
}

function usesManagedEmailTemplate(channel = {}) {
  return Boolean(cleanText(channel?.emailTemplateId, { max: 120 }));
}

function normalizeSmsChannel(input = {}, legacy = {}, fallback = DEFAULT_POLICY.uncompletedSessionNotification.channels.sms) {
  const schedule = normalizeChannelSchedule(input, legacy, fallback);
  return {
    enabled: boolFlag(input.enabled, fallback.enabled === true),
    ...schedule,
    bodyTemplate: cleanText(
      input.bodyTemplate,
      { max: 320, allowEmpty: false }
    ) || fallback.bodyTemplate
  };
}

function normalizeNotificationSettings(input = {}) {
  const fallback = DEFAULT_POLICY.uncompletedSessionNotification;
  const channels = input.channels && typeof input.channels === 'object' ? input.channels : {};
  const legacySchedule = {
    sendWhen: input.sendWhen,
    sendAtTime: input.sendAtTime
  };
  return {
    enabled: boolFlag(input.enabled, fallback.enabled === true),
    channels: {
      email: normalizeEmailChannel(channels.email, legacySchedule, fallback.channels.email),
      sms: normalizeSmsChannel(channels.sms, legacySchedule, fallback.channels.sms)
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
  let policyInput = input;
  if (typeof input.policy === 'string' && input.policy.trim()) {
    try {
      policyInput = JSON.parse(input.policy);
    } catch (_) {
      const error = new Error('Session access settings must be valid JSON.');
      error.statusCode = 400;
      throw error;
    }
  } else if (input.policy && typeof input.policy === 'object' && !Array.isArray(input.policy)) {
    policyInput = input.policy;
  }
  return normalizePolicyFromStored(policyInput);
}

function resolvePolicy(input = {}) {
  return normalizePolicyFromStored(input);
}

function validateChannelSessionDateRanges(notification = {}) {
  const channels = notification?.channels || {};
  for (const channelName of ['email', 'sms']) {
    const channel = channels[channelName] || {};
    if (channel.sessionDateRange?.type === 'days_before_today' && !channel.sessionDateRange?.daysBeforeToday) {
      const error = new Error(`Days before today is required for ${channelName} session date range.`);
      error.statusCode = 400;
      throw error;
    }
  }
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
  validateChannelSessionDateRanges(normalized.uncompletedSessionNotification);
  const emailChannel = normalized.uncompletedSessionNotification?.channels?.email || {};
  if (emailChannel.enabled === true && !usesManagedEmailTemplate(emailChannel)) {
    const error = new Error('An email template is required when email notifications are enabled.');
    error.statusCode = 400;
    throw error;
  }
  const templatesToValidate = [];
  if (!usesManagedEmailTemplate(emailChannel)) {
    templatesToValidate.push(
      emailChannel.subjectTemplate,
      emailChannel.bodyTemplate
    );
  }
  templatesToValidate.push(normalized.uncompletedSessionNotification.channels.sms.bodyTemplate);
  const invalidTokens = findInvalidTemplateTokens(templatesToValidate);
  if (invalidTokens.length) {
    const error = new Error(`Unknown template placeholder(s): ${invalidTokens.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function findInvalidTemplateTokens(templates = []) {
  const allowed = new Set(TEMPLATE_TOKENS.map((token) => token.toLowerCase()));
  const invalid = new Set();
  templates.forEach((template) => {
    const matches = String(template || '').match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) || [];
    matches.forEach((match) => {
      const key = match.replace(/[{}\s]/g, '');
      if (!allowed.has(String(key || '').toLowerCase())) invalid.add(key);
    });
  });
  return [...invalid];
}

function renderTemplate(template = '', context = {}) {
  const contextKeys = Object.keys(context || {});
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const token = String(key || '').trim();
    const resolvedKey = contextKeys.find((entry) => entry.toLowerCase() === token.toLowerCase()) || token;
    const value = context[resolvedKey];
    return value == null ? '' : String(value);
  });
}

module.exports = {
  SEND_WHEN_VALUES,
  DAILY_DIGEST_SESSION_ID,
  SESSION_DATE_RANGE_TYPES,
  WINDOW_TYPE_VALUES,
  TEMPLATE_TOKENS,
  DEFAULT_POLICY,
  normalizePolicyFromStored,
  normalizePolicyFromForm,
  resolvePolicy,
  validatePolicyInput,
  renderTemplate,
  findInvalidTemplateTokens,
  hasLegacyEmailTemplates,
  usesManagedEmailTemplate
};
