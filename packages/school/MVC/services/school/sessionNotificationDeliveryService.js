'use strict';

const { requireCoreModule } = require('./schoolCoreModuleResolver');
const resendEmailService = requireCoreModule('MVC/services/resendEmailService');
const emailManagementService = requireCoreModule('MVC/services/emailManagementService');
const sessionAccessPolicyService = require('./sessionAccessPolicyService');
const sessionNotificationLedgerModel = require('../../models/school/sessionNotificationLedgerModel');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const sessionDeliveryTeamService = require('./sessionDeliveryTeamService');
const sessionUncompletedNotificationService = require('./sessionUncompletedNotificationService');
const { mapNotificationContextToEmailPlaceholders } = require('./sessionNotificationEmailContextAdapter');
const { renderTemplate, DAILY_DIGEST_SESSION_ID, usesManagedEmailTemplate } = sessionAccessPolicyService;

function cleanText(value) {
  return String(value || '').trim();
}

function readPersonPhone(person = {}) {
  const phones = Array.isArray(person?.contact?.phones) ? person.contact.phones : [];
  const direct = cleanText(
    person?.contact?.mobile
    || person?.contact?.phone
    || person?.contact?.primaryPhone
    || person?.mobile
    || person?.phone
  );
  if (direct) return direct;
  const fromList = phones.find((row) => cleanText(row?.number || row?.phone || row?.value));
  return cleanText(fromList?.number || fromList?.phone || fromList?.value);
}

function buildSessionName(session = {}) {
  const date = cleanText(session?.date);
  const start = cleanText(session?.startTime).slice(0, 5);
  const end = cleanText(session?.endTime).slice(0, 5);
  const room = cleanText(session?.room);
  const parts = [date, [start, end].filter(Boolean).join('-'), room].filter(Boolean);
  return parts.join(' ') || cleanText(session?.sessionId || session?.id) || 'Session';
}

function buildTemplateContext({
  classData = {},
  session = {},
  teacher = {},
  orgName = '',
  baseUrl = ''
} = {}) {
  const classId = cleanText(classData?.id);
  const sessionId = cleanText(session?.sessionId || session?.id);
  const baseContext = {
    className: cleanText(classData?.title || classData?.name || classId),
    classId,
    sessionName: buildSessionName(session),
    sessionId,
    sessionDate: cleanText(session?.date),
    sessionTime: [cleanText(session?.startTime).slice(0, 5), cleanText(session?.endTime).slice(0, 5)].filter(Boolean).join(' - '),
    teacherName: schoolPersonAccessService.formatPersonName
      ? schoolPersonAccessService.formatPersonName(teacher)
      : cleanText(teacher?.displayName || teacher?.name),
    orgName: cleanText(orgName),
    sessionManagerUrl: classId && sessionId
      ? `/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}`
      : ''
  };
  const sessionList = sessionUncompletedNotificationService.buildSessionListText(
    [{ classData, session }],
    { baseUrl }
  );
  return {
    ...baseContext,
    sessionCount: '1',
    sessionList
  };
}

function listSessionEditorIds(session = {}) {
  const ids = [];
  const mainTeacherId = sessionDeliveryTeamService.getSessionMainTeacherId(session);
  if (mainTeacherId) ids.push(mainTeacherId);
  sessionDeliveryTeamService.getSessionCoTeachers(session).forEach((row) => {
    if (row?.personId && row.canEdit === true && !ids.includes(row.personId)) {
      ids.push(row.personId);
    }
  });
  return ids;
}

async function resolveEmailDeliveryPayload({
  emailChannel = {},
  teacher = {},
  context = {},
  orgId = '',
  subjectPrefix = ''
} = {}) {
  const to = schoolPersonAccessService.readPersonEmail
    ? schoolPersonAccessService.readPersonEmail(teacher)
    : cleanText(teacher?.contact?.email || teacher?.email);
  if (!to) {
    return { status: 'skipped_no_contact', channel: 'email' };
  }
  if (!resendEmailService.isConfigured()) {
    return { status: 'skipped_email_not_configured', channel: 'email' };
  }

  if (usesManagedEmailTemplate(emailChannel)) {
    const rendered = await emailManagementService.resolveTemplateById({
      templateId: emailChannel.emailTemplateId,
      orgId,
      to,
      injectedValues: mapNotificationContextToEmailPlaceholders(context)
    });
    const prefix = cleanText(subjectPrefix);
    return {
      status: 'ready',
      channel: 'email',
      recipient: to,
      payload: {
        to: rendered.to,
        subject: `${prefix}${rendered.subject}`,
        text: rendered.text,
        html: rendered.html,
        from: rendered.from || undefined
      },
      subject: `${prefix}${rendered.subject}`,
      text: rendered.text
    };
  }

  const subject = `${cleanText(subjectPrefix)}${renderTemplate(emailChannel.subjectTemplate, context)}`;
  const text = renderTemplate(emailChannel.bodyTemplate, context);
  const from = cleanText(emailChannel.fromEmail) || undefined;
  return {
    status: 'ready',
    channel: 'email',
    recipient: to,
    payload: {
      to,
      subject,
      text,
      from
    },
    subject,
    text
  };
}

async function sendEmailNotification({
  policy,
  teacher,
  context,
  orgId = ''
} = {}) {
  const emailChannel = policy?.uncompletedSessionNotification?.channels?.email || {};
  if (!emailChannel.enabled) {
    return { status: 'skipped_channel_disabled' };
  }
  const resolved = await resolveEmailDeliveryPayload({
    emailChannel,
    teacher,
    context,
    orgId
  });
  if (resolved.status !== 'ready') {
    return resolved;
  }
  await resendEmailService.sendEmail({
    ...resolved.payload,
    meta: {
      orgId,
      purpose: 'uncompleted_session_notification',
      sessionId: context.sessionId,
      classId: context.classId,
      emailTemplateId: emailChannel.emailTemplateId || ''
    }
  });
  return { status: 'sent', channel: 'email', recipient: resolved.recipient };
}

async function sendSmsNotification({
  policy,
  teacher,
  context
} = {}) {
  const smsChannel = policy?.uncompletedSessionNotification?.channels?.sms || {};
  if (!smsChannel.enabled) {
    return { status: 'skipped_channel_disabled' };
  }
  const phone = readPersonPhone(teacher);
  if (!phone) {
    return { status: 'skipped_no_contact', channel: 'sms' };
  }
  return {
    status: 'skipped_no_sms_provider',
    channel: 'sms',
    recipient: phone,
    message: renderTemplate(smsChannel.bodyTemplate, context)
  };
}

async function sendDigestEmailNotification({
  policy,
  teacher,
  context,
  orgId = '',
  subjectPrefix = ''
} = {}) {
  const emailChannel = policy?.uncompletedSessionNotification?.channels?.email || {};
  if (!emailChannel.enabled) {
    return { status: 'skipped_channel_disabled' };
  }
  const resolved = await resolveEmailDeliveryPayload({
    emailChannel,
    teacher,
    context,
    orgId,
    subjectPrefix
  });
  if (resolved.status !== 'ready') {
    return resolved;
  }
  await resendEmailService.sendEmail({
    ...resolved.payload,
    meta: {
      orgId,
      purpose: 'uncompleted_session_digest_notification',
      sessionCount: context.sessionCount,
      emailTemplateId: emailChannel.emailTemplateId || ''
    }
  });
  return {
    status: 'sent',
    channel: 'email',
    recipient: resolved.recipient,
    subject: resolved.subject,
    text: resolved.text
  };
}

async function sendDigestSmsNotification({
  policy,
  teacher,
  context
} = {}) {
  const smsChannel = policy?.uncompletedSessionNotification?.channels?.sms || {};
  if (!smsChannel.enabled) {
    return { status: 'skipped_channel_disabled' };
  }
  const phone = readPersonPhone(teacher);
  if (!phone) {
    return { status: 'skipped_no_contact', channel: 'sms' };
  }
  const message = renderTemplate(smsChannel.bodyTemplate, context);
  if (message.length > 320) {
    return {
      status: 'skipped_message_too_long',
      channel: 'sms',
      recipient: phone,
      message
    };
  }
  return {
    status: 'skipped_no_sms_provider',
    channel: 'sms',
    recipient: phone,
    message
  };
}

async function notifyTeacherDigest({
  orgId = '',
  orgName = '',
  teacher = {},
  sessions = [],
  policy = null,
  sendWhenDate = '',
  baseUrl = '',
  skipLedger = false,
  channels = ['email', 'sms']
} = {}) {
  const resolvedPolicy = policy || sessionAccessPolicyService.resolvePolicy();
  const context = sessionUncompletedNotificationService.buildDigestContext({
    teacher,
    sessions,
    orgName,
    baseUrl
  });
  const teacherId = cleanText(teacher?.id || teacher?.personId);
  const results = [];
  const targetChannels = (Array.isArray(channels) ? channels : ['email', 'sms'])
    .filter((channel) => ['email', 'sms'].includes(channel));

  for (const channel of targetChannels) {
    const dedupeKey = sessionNotificationLedgerModel.buildDedupeKey({
      orgId,
      sessionId: DAILY_DIGEST_SESSION_ID,
      teacherId,
      channel,
      sendWhenDate
    });
    if (!skipLedger && await sessionNotificationLedgerModel.hasSentEntry(dedupeKey)) {
      results.push({ channel, status: 'skipped_duplicate' });
      continue;
    }
    const outcome = channel === 'email'
      ? await sendDigestEmailNotification({ policy: resolvedPolicy, teacher, context, orgId })
      : await sendDigestSmsNotification({ policy: resolvedPolicy, teacher, context });
    if (!skipLedger) {
      await sessionNotificationLedgerModel.appendEntry({
        dedupeKey,
        orgId,
        sessionId: DAILY_DIGEST_SESSION_ID,
        teacherId,
        channel,
        sendWhenDate,
        status: outcome.status,
        recipient: outcome.recipient || '',
        message: outcome.message || outcome.text || `${context.sessionCount} session(s)`
      });
    }
    results.push(outcome);
  }

  return results;
}

async function notifyTeacherForSession({
  orgId = '',
  orgName = '',
  classData = {},
  session = {},
  teacher = {},
  policy = null,
  sendWhenDate = '',
  channels = ['email', 'sms']
} = {}) {
  const resolvedPolicy = policy || sessionAccessPolicyService.resolvePolicy();
  const context = buildTemplateContext({ classData, session, teacher, orgName });
  const teacherId = cleanText(teacher?.id || teacher?.personId);
  const sessionId = cleanText(session?.sessionId || session?.id);
  const results = [];
  const targetChannels = (Array.isArray(channels) ? channels : ['email', 'sms'])
    .filter((channel) => ['email', 'sms'].includes(channel));

  for (const channel of targetChannels) {
    const dedupeKey = sessionNotificationLedgerModel.buildDedupeKey({
      orgId,
      sessionId,
      teacherId,
      channel,
      sendWhenDate
    });
    if (await sessionNotificationLedgerModel.hasSentEntry(dedupeKey)) {
      results.push({ channel, status: 'skipped_duplicate' });
      continue;
    }
    const outcome = channel === 'email'
      ? await sendEmailNotification({ policy: resolvedPolicy, teacher, context, orgId })
      : await sendSmsNotification({ policy: resolvedPolicy, teacher, context });
    await sessionNotificationLedgerModel.appendEntry({
      dedupeKey,
      orgId,
      sessionId,
      teacherId,
      channel,
      sendWhenDate,
      status: outcome.status,
      recipient: outcome.recipient || '',
      message: outcome.message || context.sessionName
    });
    results.push(outcome);
  }

  return results;
}

module.exports = {
  buildSessionName,
  buildTemplateContext,
  listSessionEditorIds,
  notifyTeacherForSession,
  notifyTeacherDigest,
  sendDigestEmailNotification,
  readPersonPhone
};
