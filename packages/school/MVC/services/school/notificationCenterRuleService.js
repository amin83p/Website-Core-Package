'use strict';

const notificationRuleModel = require('../../models/school/notificationRuleModel');
const sessionAccessPolicyModel = require('../../models/school/sessionAccessPolicyModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function cleanText(value) {
  return String(value || '').trim();
}

function mapLegacyNotificationToRule(orgId, notification = {}) {
  const channels = notification.channels || {};
  return {
    orgId,
    label: 'Uncompleted sessions',
    ruleType: 'session_not_final',
    enabled: notification.enabled === true,
    legacyKey: notificationRuleModel.LEGACY_SESSION_RULE_KEY,
    criteria: {
      sessionDateRange: channels.email?.sessionDateRange || channels.sms?.sessionDateRange || { type: 'this_week' },
      includeLockedSessions: false
    },
    channels: {
      email: channels.email || {},
      sms: channels.sms || {}
    },
    schedule: {
      autoQueueOnSchedule: true
    }
  };
}

async function syncLegacySessionNotFinalRule(orgId, policy = null) {
  const orgKey = cleanText(orgId);
  if (!orgKey) return null;
  const resolvedPolicy = policy || await sessionAccessPolicyModel.getPolicyForOrg(orgKey);
  const notification = resolvedPolicy?.uncompletedSessionNotification || {};
  const existing = (await notificationRuleModel.listNotificationRulesByOrg(orgKey))
    .find((row) => row.legacyKey === notificationRuleModel.LEGACY_SESSION_RULE_KEY);
  const payload = mapLegacyNotificationToRule(orgKey, notification);
  if (existing) {
    return notificationRuleModel.updateNotificationRule(existing.id, payload, 'legacy-sync');
  }
  return notificationRuleModel.addNotificationRule(payload, 'legacy-sync');
}

async function listRulesForOrg(orgId) {
  return notificationRuleModel.listNotificationRulesByOrg(orgId);
}

async function getRule(orgId, ruleId) {
  const row = await notificationRuleModel.getNotificationRuleById(ruleId);
  if (!row) return null;
  if (!idsEqual(row.orgId, orgId)) return null;
  return row;
}

async function saveRule(orgId, input, auditUserId) {
  const orgKey = cleanText(orgId);
  if (input?.id) {
    const existing = await notificationRuleModel.getNotificationRuleById(input.id);
    if (!existing || !idsEqual(existing.orgId, orgKey)) throw new Error('Notification rule not found.');
    return notificationRuleModel.updateNotificationRule(input.id, { ...input, orgId: orgKey }, auditUserId);
  }
  return notificationRuleModel.addNotificationRule({ ...input, orgId: orgKey }, auditUserId);
}

async function deleteRule(orgId, ruleId, auditUserId) {
  const row = await getRule(orgId, ruleId);
  if (!row) throw new Error('Notification rule not found.');
  if (row.legacyKey === notificationRuleModel.LEGACY_SESSION_RULE_KEY) {
    throw new Error('The legacy session rule is managed from School Settings until migration is complete.');
  }
  return notificationRuleModel.deleteNotificationRule(ruleId);
}

module.exports = {
  syncLegacySessionNotFinalRule,
  listRulesForOrg,
  getRule,
  saveRule,
  deleteRule,
  mapLegacyNotificationToRule
};
