'use strict';

const notificationRuleModel = require('../../models/school/notificationRuleModel');
const sessionAccessPolicyModel = require('../../models/school/sessionAccessPolicyModel');
const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function cleanText(value) {
  return String(value || '').trim();
}

function buildNcReqUser(orgId, userId = '') {
  const orgKey = cleanText(orgId);
  const id = cleanText(userId) || 'system';
  return { activeOrgId: orgKey, id };
}

function resolveReqUser(orgId, reqUser) {
  const orgKey = cleanText(orgId);
  if (reqUser && typeof reqUser === 'object') {
    const activeOrgId = cleanText(reqUser.activeOrgId) || orgKey;
    const id = cleanText(reqUser.id || reqUser.userId || reqUser._id) || 'system';
    return { ...reqUser, activeOrgId, id };
  }
  if (typeof reqUser === 'string' && reqUser) {
    return buildNcReqUser(orgKey, reqUser);
  }
  return buildNcReqUser(orgKey);
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

async function syncLegacySessionNotFinalRule(orgId, policy = null, reqUser = null) {
  const orgKey = cleanText(orgId);
  if (!orgKey) return null;
  const user = resolveReqUser(orgKey, reqUser || buildNcReqUser(orgKey, 'legacy-sync'));
  const resolvedPolicy = policy || await sessionAccessPolicyModel.getPolicyForOrg(orgKey);
  const notification = resolvedPolicy?.uncompletedSessionNotification || {};
  const existing = (await listRulesForOrg(orgKey, user))
    .find((row) => row.legacyKey === notificationRuleModel.LEGACY_SESSION_RULE_KEY);
  const payload = mapLegacyNotificationToRule(orgKey, notification);
  if (existing) {
    return schoolDataService.updateData('notificationRules', existing.id, payload, user);
  }
  return schoolDataService.addData('notificationRules', payload, user);
}

async function listRulesForOrg(orgId, reqUser = null) {
  const orgKey = cleanText(orgId);
  const user = resolveReqUser(orgKey, reqUser);
  const rows = await schoolDataService.fetchAllData(
    'notificationRules',
    { orgId__eq: orgKey },
    user
  );
  return Array.isArray(rows) ? rows : [];
}

async function getRule(orgId, ruleId, reqUser = null) {
  const orgKey = cleanText(orgId);
  const user = resolveReqUser(orgKey, reqUser);
  const row = await schoolDataService.getDataById('notificationRules', ruleId, user);
  if (!row) return null;
  if (!idsEqual(row.orgId, orgKey)) return null;
  return row;
}

async function saveRule(orgId, input, reqUser = null) {
  const orgKey = cleanText(orgId);
  const user = resolveReqUser(orgKey, reqUser);
  if (input?.id) {
    const existing = await schoolDataService.getDataById('notificationRules', input.id, user);
    if (!existing || !idsEqual(existing.orgId, orgKey)) throw new Error('Notification rule not found.');
    return schoolDataService.updateData('notificationRules', input.id, { ...input, orgId: orgKey }, user);
  }
  return schoolDataService.addData('notificationRules', { ...input, orgId: orgKey }, user);
}

async function deleteRule(orgId, ruleId, reqUser = null) {
  const orgKey = cleanText(orgId);
  const user = resolveReqUser(orgKey, reqUser);
  const row = await getRule(orgKey, ruleId, user);
  if (!row) throw new Error('Notification rule not found.');
  if (row.legacyKey === notificationRuleModel.LEGACY_SESSION_RULE_KEY) {
    throw new Error('The legacy session rule is managed from School Settings until migration is complete.');
  }
  await schoolDataService.deleteData('notificationRules', ruleId, user);
  return true;
}

module.exports = {
  buildNcReqUser,
  syncLegacySessionNotFinalRule,
  listRulesForOrg,
  getRule,
  saveRule,
  deleteRule,
  mapLegacyNotificationToRule
};
