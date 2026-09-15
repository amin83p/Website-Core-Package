'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const notificationSendLedgerModel = require('../../models/school/notificationSendLedgerModel');
const sessionNotificationDeliveryService = require('./sessionNotificationDeliveryService');
const sessionAccessPolicyService = require('./sessionAccessPolicyService');
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
    // fall through
  }
  return resolveDefaultTimezone();
}

function buildSendAtIso(cycleDate, sendAtTime, timeZone) {
  return zonedWallClockToIso(cycleDate, sendAtTime || '18:00', timeZone);
}

async function queueChannelForBatch({
  orgId,
  rule,
  run,
  batch,
  channelName,
  channelConfig,
  cycleDate,
  sendAt,
  logger
}) {
  if (!channelConfig?.enabled) return { queued: 0, skipped: 1 };
  const teacherId = cleanText(batch.recipientPersonId);
  const teacher = await schoolPersonAccessService.getPersonById({
    reqUser: { activeOrgId: orgId },
    personId: teacherId
  }).catch(() => null);
  if (!teacher) return { queued: 0, skipped: 1 };

  const preview = batch.preview || {};
  const semanticDedupeKey = notificationSendLedgerModel.buildDedupeKey({
    orgId,
    ruleId: rule.id,
    recipientPersonId: teacherId,
    channel: channelName,
    cycleDate,
    semanticKey: cleanText(batch.id)
  });
  if (await notificationSendLedgerModel.hasSentEntry(semanticDedupeKey)) {
    return { queued: 0, skipped: 1 };
  }

  const context = {
    teacherName: preview.recipientName || teacherId,
    sessionCount: batch.itemCount || 0,
    sessionListText: preview.plainText || '',
    sessionListHtml: preview.htmlBody || '',
    orgName: orgId
  };

  const resolvePayload = channelName === 'email'
    ? sessionNotificationDeliveryService.resolveEmailPayload?.bind(sessionNotificationDeliveryService)
    : sessionNotificationDeliveryService.resolveSmsPayload?.bind(sessionNotificationDeliveryService);

  let resolved = { status: 'ready', subject: preview.subject, body: preview.plainText, html: preview.htmlBody };
  if (typeof resolvePayload === 'function') {
    resolved = await resolvePayload({ channelConfig, teacher, context, orgId });
  }

  if (resolved.status !== 'ready') {
    if (channelName === 'email') {
      resolved = {
        status: 'ready',
        subject: preview.subject || rule.label,
        body: preview.plainText,
        html: preview.htmlBody
      };
    } else {
      resolved = {
        status: 'ready',
        body: preview.smsText || preview.plainText
      };
    }
  }

  const outboxService = channelName === 'email' ? emailOutboxService : smsOutboxService;
  const to = channelName === 'email'
    ? cleanText(teacher?.email || teacher?.contactEmail)
    : cleanText(teacher?.mobile || teacher?.phone);
  if (!to) return { queued: 0, skipped: 1 };

  const entry = channelName === 'email'
    ? {
      orgId,
      to,
      subject: resolved.subject || preview.subject,
      bodyText: resolved.body || preview.plainText,
      bodyHtml: resolved.html || preview.htmlBody,
      sendAt,
      dedupeKey: semanticDedupeKey,
      metadata: { ruleId: rule.id, runId: run.id, batchId: batch.id }
    }
    : {
      orgId,
      to,
      body: resolved.body || preview.smsText,
      sendAt,
      dedupeKey: semanticDedupeKey,
      metadata: { ruleId: rule.id, runId: run.id, batchId: batch.id }
    };

  const created = await outboxService.enqueue(entry);
  if (!created) return { queued: 0, skipped: 1 };

  await notificationSendLedgerModel.appendEntry({
    dedupeKey: semanticDedupeKey,
    orgId,
    ruleId: rule.id,
    runId: run.id,
    batchId: batch.id,
    recipientPersonId: teacherId,
    channel: channelName,
    cycleDate,
    status: 'queued',
    recipient: to,
    message: `${batch.itemCount || 0} item(s)`
  });
  if (logger) logger.info(`Queued ${channelName} for ${teacherId} rule ${rule.id}`);
  return { queued: 1, skipped: 0 };
}

async function dispatchRunBatches({ orgId, rule, run, user, logger } = {}) {
  const orgKey = cleanText(orgId);
  const timeZone = await resolveOrgTimeZone(orgKey);
  const cycleDate = getTodayDateKeyInTimezone(timeZone);
  const channels = rule?.channels || {};
  const batches = Array.isArray(run?.batches) ? run.batches : [];
  let queued = 0;
  let skipped = 0;

  for (const batch of batches) {
    for (const channelName of ['email', 'sms']) {
      const channelConfig = channels[channelName] || {};
      const sendAt = buildSendAtIso(cycleDate, channelConfig.sendAtTime, timeZone);
      const result = await queueChannelForBatch({
        orgId: orgKey,
        rule,
        run,
        batch,
        channelName,
        channelConfig,
        cycleDate,
        sendAt,
        logger
      });
      queued += result.queued;
      skipped += result.skipped;
    }
  }

  return { queued, skipped, batches: batches.length };
}

async function prepareScheduledRule({ orgId, ruleId, logger, now = new Date() } = {}) {
  const notificationCenterRunService = require('./notificationCenterRunService');
  const notificationCenterRuleService = require('./notificationCenterRuleService');
  const orgKey = cleanText(orgId);
  const rule = await notificationCenterRuleService.getRule(orgKey, ruleId);
  if (!rule || rule.enabled !== true) return { prepared: 0, skipped: 0 };
  const autoQueue = rule.schedule?.autoQueueOnSchedule !== false;
  const run = await notificationCenterRunService.executeRun({
    orgId: orgKey,
    ruleId: rule.id,
    user: { activeOrgId: orgKey, id: 'scheduled-task' },
    trigger: 'scheduled',
    asOfDate: cleanText(now.toISOString().slice(0, 10)),
    queueDelivery: autoQueue
  });
  if (!run) return { prepared: 0, skipped: 1 };
  return {
    prepared: run.batchCount || 0,
    skipped: 0,
    runId: run.id,
    mode: autoQueue ? 'queued' : 'preview'
  };
}

module.exports = {
  dispatchRunBatches,
  prepareScheduledRule
};
