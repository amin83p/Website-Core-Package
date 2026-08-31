'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const sessionAccessPolicyModel = require('../../models/school/sessionAccessPolicyModel');
const sessionAccessPolicyService = require('./sessionAccessPolicyService');
const sessionUncompletedNotificationService = require('./sessionUncompletedNotificationService');
const sessionNotificationDeliveryService = require('./sessionNotificationDeliveryService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const sessionNotificationLedgerModel = require('../../models/school/sessionNotificationLedgerModel');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const sessionAttendanceEditAccessService = require('./sessionAttendanceEditAccessService');
const { mapNotificationContextToEmailPlaceholders } = require('./sessionNotificationEmailContextAdapter');
const { usesManagedEmailTemplate } = require('./sessionAccessPolicyService');
const {
  getTodayDateKeyInTimezone,
  resolveDefaultTimezone,
  resolveOrganizationTimezoneFromRow,
  zonedWallClockToIso
} = requireCoreModule('MVC/utils/timezoneUtils');
const emailOutboxService = requireCoreModule('MVC/services/emailOutboxService');
const smsOutboxService = requireCoreModule('MVC/services/smsOutboxService');

function cleanText(value) {
  return String(value || '').trim();
}

async function resolveOrgTimeZone(orgId) {
  try {
    const organizationModel = requireCoreModule('MVC/models/organizationModel');
    const row = await organizationModel.getOrganizationById(orgId);
    if (row) return resolveOrganizationTimezoneFromRow(row);
  } catch (_) {
    // Fall back below.
  }
  return resolveDefaultTimezone();
}

function resolveCycleDate(orgTimeZone, now = new Date()) {
  return getTodayDateKeyInTimezone(orgTimeZone, now.getTime());
}

function resolveSendDateKey(cycleDate = '', prepareAtTime = '', sendAtTime = '') {
  const prep = sessionAccessPolicyService.timeHmToMinutes(prepareAtTime || '17:00');
  const send = sessionAccessPolicyService.timeHmToMinutes(sendAtTime || '18:00');
  if (send <= prep) {
    return sessionAttendanceEditAccessService.addDaysToDateKey(cycleDate, 1);
  }
  return cycleDate;
}

function buildSendAtIso({
  cycleDate = '',
  prepareAtTime = '',
  sendAtTime = '',
  timeZone = ''
} = {}) {
  const sendDate = resolveSendDateKey(cycleDate, prepareAtTime, sendAtTime);
  return zonedWallClockToIso(sendDate, sendAtTime, timeZone);
}

function resolveTargetSessionDateForCycle(channelConfig = {}, cycleDate = '') {
  const sendWhen = cleanText(channelConfig?.sendWhen || 'same_day');
  if (sendWhen === 'daily_all') return null;
  if (sendWhen === 'next_day') {
    return sessionAttendanceEditAccessService.addDaysToDateKey(cycleDate, -1);
  }
  return cycleDate;
}

function isChannelPrepareEnabled(notification, channelConfig) {
  return notification?.enabled === true && channelConfig?.enabled === true;
}

async function shouldSkipPrepareEntry({ semanticDedupeKey, prepareMode = 'additive', orgId, outboxService }) {
  const key = cleanText(semanticDedupeKey);
  if (!key) return false;

  const entries = await sessionNotificationLedgerModel.readAllEntries();
  if (entries.some((row) => (
    cleanText(row?.dedupeKey) === key && cleanText(row?.status) === 'sent'
  ))) {
    return true;
  }

  if (prepareMode === 'replace' && outboxService && typeof outboxService.hasActiveEntry === 'function') {
    return outboxService.hasActiveEntry(orgId, key);
  }

  return false;
}

function buildOutboxDedupeKey(semanticDedupeKey, { prepareMode = 'additive', prepareRunId = '' } = {}) {
  const semanticKey = cleanText(semanticDedupeKey);
  if (!semanticKey) return '';
  if (prepareMode === 'replace') return semanticKey;
  const runId = cleanText(prepareRunId);
  return runId ? `${semanticKey}::${runId}` : semanticKey;
}

async function prepareDigestChannel({
  orgKey,
  channelName,
  channelConfig,
  cycleDate,
  sendAt,
  statusMap,
  outboxService,
  resolvePayload,
  buildOutboxEntry,
  logger,
  prepareMode = 'additive',
  prepareRunId = ''
}) {
  const sessionDateRange = channelConfig.sessionDateRange || {};
  const { fromDate, throughDate } = await sessionUncompletedNotificationService.resolveSessionDateRangeBounds({
    orgId: orgKey,
    throughDate: cycleDate,
    rangeType: sessionDateRange.type,
    daysBeforeToday: sessionDateRange.daysBeforeToday
  });
  const allEntries = await sessionUncompletedNotificationService.listUncompletedSessionsForOrg(orgKey, {
    fromDate,
    throughDate,
    statusMap,
    reqUser: { activeOrgId: orgKey }
  });
  const teacherPersonMap = await sessionUncompletedNotificationService.loadTeacherPersonMap(orgKey, { activeOrgId: orgKey });
  const grouped = sessionUncompletedNotificationService.groupSessionsByTeacher(allEntries, { teacherPersonMap });

  let prepared = 0;
  let skipped = 0;
  let teachers = 0;
  const baseUrl = '';

  for (const [teacherId, sessions] of grouped.entries()) {
    teachers += 1;
    const semanticDedupeKey = sessionNotificationLedgerModel.buildDedupeKey({
      orgId: orgKey,
      sessionId: sessionAccessPolicyService.DAILY_DIGEST_SESSION_ID,
      teacherId,
      channel: channelName,
      sendWhenDate: cycleDate
    });
    if (await shouldSkipPrepareEntry({
      semanticDedupeKey,
      prepareMode,
      orgId: orgKey,
      outboxService
    })) {
      skipped += 1;
      continue;
    }

    const teacher = await schoolPersonAccessService.getPersonById({
      reqUser: { activeOrgId: orgKey },
      personId: teacherId
    }).catch(() => null);
    if (!teacher) {
      skipped += 1;
      continue;
    }

    const context = sessionUncompletedNotificationService.buildDigestContext({
      teacher,
      sessions,
      orgName: orgKey,
      baseUrl
    });
    const resolved = await resolvePayload({ channelConfig, teacher, context, orgId: orgKey });
    if (resolved.status !== 'ready') {
      skipped += 1;
      if (logger) logger.info(`Skipped teacher ${teacherId}: ${resolved.status}`);
      continue;
    }

    const outboxEntry = buildOutboxEntry({
      orgKey,
      channelConfig,
      teacher,
      context,
      resolved,
      sendAt,
      dedupeKey: buildOutboxDedupeKey(semanticDedupeKey, { prepareMode, prepareRunId }),
      semanticDedupeKey,
      cycleDate,
      teacherId,
      sessionId: sessionAccessPolicyService.DAILY_DIGEST_SESSION_ID,
      prepareMode,
      prepareRunId
    });

    const created = await outboxService.enqueue(outboxEntry);
    if (created) {
      prepared += 1;
      await sessionNotificationLedgerModel.appendEntry({
        dedupeKey: semanticDedupeKey,
        orgId: orgKey,
        sessionId: sessionAccessPolicyService.DAILY_DIGEST_SESSION_ID,
        teacherId,
        channel: channelName,
        sendWhenDate: cycleDate,
        status: 'queued',
        recipient: outboxEntry.to,
        message: `${context.sessionCount} session(s)`
      });
      if (logger) logger.info(`Queued digest ${channelName} for teacher ${teacherId}`);
    } else {
      skipped += 1;
    }
  }

  return { prepared, skipped, teachers, mode: 'daily_all', fromDate, throughDate };
}

async function preparePerSessionChannel({
  orgKey,
  channelName,
  channelConfig,
  cycleDate,
  sendAt,
  statusMap,
  outboxService,
  resolvePayload,
  buildOutboxEntry,
  logger,
  prepareMode = 'additive',
  prepareRunId = ''
}) {
  const targetSessionDate = resolveTargetSessionDateForCycle(channelConfig, cycleDate);
  const classes = await sessionUncompletedNotificationService.listOrgClasses(orgKey, { activeOrgId: orgKey });
  let prepared = 0;
  let skipped = 0;
  let teachers = 0;

  for (const classData of classes) {
    if (cleanText(classData?.orgId) !== cleanText(orgKey)) continue;
    // eslint-disable-next-line no-await-in-loop
    const sessions = await sessionUncompletedNotificationService.listClassSessions(classData, { activeOrgId: orgKey });
    for (const session of sessions) {
      if (cleanText(session?.date) !== targetSessionDate) continue;
      if (session?.locked === true) continue;
      const isFinal = sessionStatusPolicyService.isFinalStatusByMap(statusMap, session);
      if (isFinal) continue;

      const teacherIds = sessionNotificationDeliveryService.listSessionEditorIds(session);
      for (const teacherId of teacherIds) {
        teachers += 1;
        const sessionId = cleanText(session?.sessionId || session?.id);
        const semanticDedupeKey = sessionNotificationLedgerModel.buildDedupeKey({
          orgId: orgKey,
          sessionId,
          teacherId,
          channel: channelName,
          sendWhenDate: cycleDate
        });
        // eslint-disable-next-line no-await-in-loop
        if (await shouldSkipPrepareEntry({
          semanticDedupeKey,
          prepareMode,
          orgId: orgKey,
          outboxService
        })) {
          skipped += 1;
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const teacher = await schoolPersonAccessService.getPersonById({
          reqUser: { activeOrgId: orgKey },
          personId: teacherId
        }).catch(() => null);
        if (!teacher) {
          skipped += 1;
          continue;
        }

        const context = sessionNotificationDeliveryService.buildTemplateContext({
          classData,
          session,
          teacher,
          orgName: orgKey
        });
        // eslint-disable-next-line no-await-in-loop
        const resolved = await resolvePayload({ channelConfig, teacher, context, orgId: orgKey });
        if (resolved.status !== 'ready') {
          skipped += 1;
          if (logger) logger.info(`Skipped teacher ${teacherId} session ${sessionId}: ${resolved.status}`);
          continue;
        }

        const outboxEntry = buildOutboxEntry({
          orgKey,
          channelConfig,
          teacher,
          context,
          resolved,
          sendAt,
          dedupeKey: buildOutboxDedupeKey(semanticDedupeKey, { prepareMode, prepareRunId }),
          semanticDedupeKey,
          cycleDate,
          teacherId,
          sessionId,
          prepareMode,
          prepareRunId
        });

        // eslint-disable-next-line no-await-in-loop
        const created = await outboxService.enqueue(outboxEntry);
        if (created) {
          prepared += 1;
          // eslint-disable-next-line no-await-in-loop
          await sessionNotificationLedgerModel.appendEntry({
            dedupeKey: semanticDedupeKey,
            orgId: orgKey,
            sessionId,
            teacherId,
            channel: channelName,
            sendWhenDate: cycleDate,
            status: 'queued',
            recipient: outboxEntry.to,
            message: context.sessionName || sessionId
          });
        } else {
          skipped += 1;
        }
      }
    }
  }

  return {
    prepared,
    skipped,
    teachers,
    mode: channelConfig.sendWhen,
    targetSessionDate
  };
}

function buildEmailOutboxEntry({
  orgKey,
  channelConfig,
  teacher,
  context,
  resolved,
  sendAt,
  dedupeKey,
  semanticDedupeKey = '',
  cycleDate,
  teacherId,
  sessionId,
  prepareMode = 'additive',
  prepareRunId = ''
}) {
  const payload = resolved.payload || {};
  return {
    orgId: orgKey,
    eventKey: usesManagedEmailTemplate(channelConfig) ? 'SCHOOL_UNCOMPLETED_SESSION_EMAIL' : '',
    to: cleanText(payload.to || resolved.recipient),
    subject: cleanText(payload.subject || resolved.subject),
    text: cleanText(payload.text || resolved.text),
    html: cleanText(payload.html),
    from: cleanText(payload.from),
    replyTo: cleanText(payload.replyTo),
    providerProfileId: cleanText(channelConfig.providerProfileId),
    templateId: cleanText(channelConfig.emailTemplateId),
    injectedValues: mapNotificationContextToEmailPlaceholders(context, { emailChannel: channelConfig, teacher }),
    sendAt,
    dedupeKey,
    taskRunId: cleanText(prepareRunId),
    meta: {
      purpose: 'uncompleted_session_notification',
      teacherId,
      sessionId,
      cycleDate,
      sendWhen: channelConfig.sendWhen,
      sessionCount: context.sessionCount || '1',
      semanticDedupeKey: cleanText(semanticDedupeKey || dedupeKey),
      prepareRunId: cleanText(prepareRunId),
      prepareMode: cleanText(prepareMode)
    }
  };
}

function buildSmsOutboxEntry({
  orgKey,
  channelConfig,
  context,
  resolved,
  sendAt,
  dedupeKey,
  semanticDedupeKey = '',
  cycleDate,
  teacherId,
  sessionId,
  prepareMode = 'additive',
  prepareRunId = ''
}) {
  const payload = resolved.payload || {};
  return {
    orgId: orgKey,
    eventKey: 'SCHOOL_UNCOMPLETED_SESSION_SMS',
    to: cleanText(payload.to || resolved.recipient),
    body: cleanText(payload.body || resolved.message),
    sendAt,
    dedupeKey,
    taskRunId: cleanText(prepareRunId),
    meta: {
      purpose: 'uncompleted_session_notification',
      teacherId,
      sessionId,
      cycleDate,
      sendWhen: channelConfig.sendWhen,
      sessionCount: context.sessionCount || '1',
      semanticDedupeKey: cleanText(semanticDedupeKey || dedupeKey),
      prepareRunId: cleanText(prepareRunId),
      prepareMode: cleanText(prepareMode)
    }
  };
}

async function prepareChannelNotifications({
  orgId = '',
  policy = null,
  channelName = 'email',
  now = new Date(),
  logger = null,
  prepareMode = 'additive',
  prepareRunId = ''
} = {}) {
  const orgKey = cleanText(orgId);
  if (!orgKey) return { prepared: 0, skipped: 0, teachers: 0 };

  const resolvedPolicy = policy || await sessionAccessPolicyModel.getPolicyForOrg(orgKey);
  const notification = resolvedPolicy?.uncompletedSessionNotification || {};
  const channelConfig = notification.channels?.[channelName] || {};
  if (!isChannelPrepareEnabled(notification, channelConfig)) {
    return { prepared: 0, skipped: 0, teachers: 0, reason: 'channel_disabled' };
  }

  const isEmailChannel = channelName === 'email';
  const mode = cleanText(prepareMode).toLowerCase() === 'replace' ? 'replace' : 'additive';
  if (mode === 'replace') {
    if (isEmailChannel && typeof emailOutboxService.cancelActiveNotificationEntries === 'function') {
      await emailOutboxService.cancelActiveNotificationEntries(orgKey);
    } else if (!isEmailChannel && typeof smsOutboxService.cancelActiveNotificationEntries === 'function') {
      await smsOutboxService.cancelActiveNotificationEntries(orgKey);
    }
  }

  const orgTimeZone = await resolveOrgTimeZone(orgKey);
  const cycleDate = resolveCycleDate(orgTimeZone, now);
  const sendAt = buildSendAtIso({
    cycleDate,
    prepareAtTime: channelConfig.prepareAtTime,
    sendAtTime: channelConfig.sendAtTime,
    timeZone: orgTimeZone
  });
  const statusMap = await sessionStatusPolicyService.getStatusMap(orgKey, { includeInactive: true });

  const outboxServiceResolved = isEmailChannel ? emailOutboxService : smsOutboxService;
  const resolvePayload = isEmailChannel
    ? ({ channelConfig: cfg, teacher, context, orgId: org }) => sessionNotificationDeliveryService.resolveEmailDeliveryPayload({
      emailChannel: cfg,
      teacher,
      context,
      orgId: org
    })
    : ({ channelConfig: cfg, teacher, context }) => sessionNotificationDeliveryService.resolveSmsDeliveryPayload({
      smsChannel: cfg,
      teacher,
      context
    });
  const buildOutboxEntry = isEmailChannel ? buildEmailOutboxEntry : buildSmsOutboxEntry;

  const sharedArgs = {
    orgKey,
    channelName,
    channelConfig,
    cycleDate,
    sendAt,
    statusMap,
    outboxService: outboxServiceResolved,
    resolvePayload,
    buildOutboxEntry,
    logger,
    prepareMode: mode,
    prepareRunId: cleanText(prepareRunId)
  };

  const metrics = channelConfig.sendWhen === 'daily_all'
    ? await prepareDigestChannel(sharedArgs)
    : await preparePerSessionChannel(sharedArgs);

  return {
    ...metrics,
    cycleDate,
    sendAt
  };
}

async function prepareUncompletedSessionEmailsForOrg(args = {}) {
  return prepareChannelNotifications({ ...args, channelName: 'email' });
}

async function prepareUncompletedSessionSmsForOrg(args = {}) {
  return prepareChannelNotifications({ ...args, channelName: 'sms' });
}

function buildScheduledIsoFromDateAndTime({
  dateKey = '',
  prepareAtTime = '',
  timeHm = '',
  timeZone = ''
} = {}) {
  return buildSendAtIso({
    cycleDate: dateKey,
    prepareAtTime,
    sendAtTime: timeHm,
    timeZone
  });
}

module.exports = {
  prepareUncompletedSessionEmailsForOrg,
  prepareUncompletedSessionSmsForOrg,
  prepareChannelNotifications,
  buildScheduledIsoFromDateAndTime,
  buildSendAtIso,
  resolveCycleDate,
  resolveSendDateKey,
  resolveTargetSessionDateForCycle
};
