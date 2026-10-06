'use strict';

const notificationRuleModel = require('../../models/school/notificationRuleModel');
const sessionNotificationPrepareService = require('./sessionNotificationPrepareService');

function cleanText(value) {
  return String(value || '').trim();
}

function buildSyntheticNotificationFromRule(rule = {}) {
  const channels = rule.channels && typeof rule.channels === 'object' ? rule.channels : {};
  const sendWhen = notificationRuleModel.notificationTimingModeToSendWhen(
    notificationRuleModel.resolveRuleNotificationTimingMode(rule)
  );
  const sessionDateRange = rule.criteria?.sessionDateRange || { type: 'this_week' };
  return {
    enabled: rule.enabled === true,
    channels: {
      email: {
        ...(channels.email || {}),
        sendWhen,
        sessionDateRange
      },
      sms: {
        ...(channels.sms || {}),
        sendWhen,
        sessionDateRange
      }
    }
  };
}

async function prepareRuleChannelNotificationsFromNcRule({
  orgId = '',
  rule = {},
  channelName = 'email',
  now = new Date(),
  logger = null
} = {}) {
  const orgKey = cleanText(orgId);
  const channel = cleanText(channelName).toLowerCase();
  if (!orgKey || !rule?.id) return { prepared: 0, skipped: 1 };
  if (channel !== 'email' && channel !== 'sms') return { prepared: 0, skipped: 1 };
  const syntheticPolicy = {
    uncompletedSessionNotification: buildSyntheticNotificationFromRule(rule)
  };
  return sessionNotificationPrepareService.prepareChannelNotifications({
    orgId: orgKey,
    policy: syntheticPolicy,
    channelName: channel,
    now,
    logger
  });
}

async function queuePerSessionNotificationsFromRule({
  orgId = '',
  rule = {},
  now = new Date(),
  logger = null
} = {}) {
  const channels = rule?.channels || {};
  let prepared = 0;
  let skipped = 0;
  for (const channelName of ['email', 'sms']) {
    const channelConfig = channels[channelName] || {};
    if (channelConfig.enabled !== true) continue;
    // eslint-disable-next-line no-await-in-loop
    const result = await prepareRuleChannelNotificationsFromNcRule({
      orgId,
      rule,
      channelName,
      now,
      logger
    });
    prepared += Number(result?.prepared) || 0;
    skipped += Number(result?.skipped) || 0;
  }
  return { prepared, skipped };
}

module.exports = {
  buildSyntheticNotificationFromRule,
  prepareRuleChannelNotificationsFromNcRule,
  queuePerSessionNotificationsFromRule
};
