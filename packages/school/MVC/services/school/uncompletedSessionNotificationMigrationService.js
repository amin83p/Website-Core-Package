'use strict';

const sessionAccessPolicyModel = require('../../models/school/sessionAccessPolicyModel');
const sessionAccessPolicyService = require('./sessionAccessPolicyService');
const notificationRuleModel = require('../../models/school/notificationRuleModel');
const notificationCenterRuleService = require('./notificationCenterRuleService');
const schoolDataService = require('./schoolDataService');
const { syncRuleScheduledTasks } = require('./notificationCenterTaskSyncService');
const {
  disableOrphanPolicyTasks
} = require('./sessionAccessPolicyTaskSyncService');

function cleanText(value) {
  return String(value || '').trim();
}

function detectEmailBodyMode(bodyTemplate = '') {
  const text = String(bodyTemplate || '');
  return /<[a-z][\s\S]*>/i.test(text) ? 'html' : 'plain';
}

function mapSendWhenToTimingMode(sendWhen = '') {
  const token = cleanText(sendWhen).toLowerCase();
  if (token === 'daily_all') return 'daily_digest';
  return notificationRuleModel.normalizeNotificationTimingMode(token, 'daily_digest');
}

function buildRuleFromLegacyNotification(orgId, notification = {}) {
  const orgKey = cleanText(orgId);
  const channels = notification.channels && typeof notification.channels === 'object'
    ? notification.channels
    : {};
  const email = channels.email && typeof channels.email === 'object' ? channels.email : {};
  const sms = channels.sms && typeof channels.sms === 'object' ? channels.sms : {};
  const sendWhen = cleanText(email.sendWhen || sms.sendWhen || 'daily_all').toLowerCase() || 'daily_all';
  const timingMode = mapSendWhenToTimingMode(sendWhen);
  const digest = timingMode === 'daily_digest';
  const bodyTemplate = cleanText(email.bodyTemplate);
  const emailBodyMode = detectEmailBodyMode(bodyTemplate);
  const sessionDateRange = email.sessionDateRange || sms.sessionDateRange || { type: 'this_week' };
  const channelsEnabled = email.enabled === true || sms.enabled === true;

  return notificationRuleModel.sanitizeRuleInput({
    orgId: orgKey,
    label: 'Uncompleted sessions',
    ruleType: 'session_not_final',
    enabled: notification.enabled === true,
    criteria: {
      sessionDateRange,
      notificationTiming: { mode: timingMode },
      includeLockedSessions: false
    },
    channels: {
      email: {
        enabled: email.enabled === true,
        sendWhen: digest ? 'daily_all' : timingMode,
        sendAtTime: cleanText(email.sendAtTime || '18:00').slice(0, 5) || '18:00',
        prepareAtTime: cleanText(email.prepareAtTime || '17:00').slice(0, 5) || '17:00',
        sessionDateRange,
        emailTemplateId: cleanText(email.emailTemplateId),
        emailTemplateName: cleanText(email.emailTemplateName),
        bodyTextTemplate: emailBodyMode === 'plain' ? bodyTemplate : '',
        bodyHtmlTemplate: emailBodyMode === 'html' ? bodyTemplate : '',
        emailBodyMode,
        subjectTemplate: cleanText(email.subjectTemplate)
      },
      sms: {
        enabled: sms.enabled === true,
        sendWhen: digest ? 'daily_all' : timingMode,
        sendAtTime: cleanText(sms.sendAtTime || '18:00').slice(0, 5) || '18:00',
        prepareAtTime: cleanText(sms.prepareAtTime || '17:00').slice(0, 5) || '17:00',
        sessionDateRange: sms.sessionDateRange || sessionDateRange,
        bodyTextTemplate: cleanText(sms.bodyTemplate)
      }
    },
    schedule: {
      scheduleEnabled: notification.enabled === true && digest,
      runAtTime: cleanText(email.prepareAtTime || '08:00').slice(0, 5) || '08:00',
      daysOfWeek: digest ? [0, 1, 2, 3, 4, 5, 6] : [],
      autoQueueOnSchedule: notification.enabled === true && channelsEnabled
    }
  });
}

async function findExistingSessionNotFinalRule(orgId, user) {
  const rows = await notificationCenterRuleService.listRulesForOrg(orgId, user);
  return rows.find((row) => row.legacyKey === notificationRuleModel.LEGACY_SESSION_RULE_KEY)
    || rows.find((row) => row.ruleType === 'session_not_final' && cleanText(row.label).toLowerCase() === 'uncompleted sessions')
    || null;
}

async function upsertMigratedRule(orgId, notification, user) {
  const payload = buildRuleFromLegacyNotification(orgId, notification);
  delete payload.legacyKey;
  const existing = await findExistingSessionNotFinalRule(orgId, user);
  if (existing?.id) {
    return schoolDataService.updateData('notificationRules', existing.id, {
      ...payload,
      id: existing.id,
      legacyKey: ''
    }, user);
  }
  return schoolDataService.addData('notificationRules', payload, user);
}

async function disableLegacyNotificationTasksForOrg(orgId) {
  await disableOrphanPolicyTasks(orgId, []);
}

async function migrateOrgSessionNotificationToNc(orgId, options = {}) {
  const orgKey = cleanText(orgId);
  if (!orgKey || orgKey === 'SYSTEM') return { orgId: orgKey, skipped: true, reason: 'invalid_org' };

  const doc = await sessionAccessPolicyModel.readPolicyDocument();
  const byOrg = doc?.byOrgId && typeof doc.byOrgId === 'object' ? doc.byOrgId : {};
  const storedRow = byOrg[orgKey];
  if (storedRow?.sessionNotificationMigratedToNcAt) {
    await disableLegacyNotificationTasksForOrg(orgKey);
    return { orgId: orgKey, skipped: true, reason: 'already_migrated' };
  }

  const user = notificationCenterRuleService.buildNcReqUser(orgKey, options.auditUserId || 'session-notification-migration');
  const resolved = await sessionAccessPolicyModel.getPolicyForOrg(orgKey);

  const notification = resolved.uncompletedSessionNotification || {};
  const hadConfig = notification.enabled === true
    || notification.channels?.email?.enabled === true
    || notification.channels?.sms?.enabled === true;

  let rule = null;
  if (hadConfig || await findExistingSessionNotFinalRule(orgKey, user)) {
    rule = await upsertMigratedRule(orgKey, notification, user);
    await syncRuleScheduledTasks(orgKey, rule, { reqUser: user, ...options });
  }

  await sessionAccessPolicyModel.markSessionNotificationMigrated(orgKey, user.id);
  await disableLegacyNotificationTasksForOrg(orgKey);

  return {
    orgId: orgKey,
    migrated: true,
    ruleId: rule?.id || '',
    hadConfig
  };
}

async function migrateAllOrgsSessionNotificationToNc(options = {}) {
  const doc = await sessionAccessPolicyModel.readPolicyDocument();
  const byOrg = doc?.byOrgId && typeof doc.byOrgId === 'object' ? doc.byOrgId : {};
  const orgIdSet = new Set(Object.keys(byOrg).filter((id) => cleanText(id) && cleanText(id) !== 'SYSTEM'));
  try {
    const rules = await notificationRuleModel.getAllNotificationRules();
    (Array.isArray(rules) ? rules : []).forEach((row) => {
      const id = cleanText(row?.orgId);
      if (id) orgIdSet.add(id);
    });
  } catch (_) {
    // optional when rules store unavailable
  }
  const orgIds = [...orgIdSet];
  const results = [];
  for (const orgId of orgIds) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await migrateOrgSessionNotificationToNc(orgId, options));
  }
  return results;
}

module.exports = {
  buildRuleFromLegacyNotification,
  migrateOrgSessionNotificationToNc,
  migrateAllOrgsSessionNotificationToNc,
  disableLegacyNotificationTasksForOrg
};
