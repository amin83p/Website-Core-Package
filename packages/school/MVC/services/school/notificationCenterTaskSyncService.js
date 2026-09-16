'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const scheduledTaskDefinitionRepository = requireCoreModule('MVC/repositories/scheduledTaskDefinitionRepository');
const notificationCenterRuleService = require('./notificationCenterRuleService');

const PREPARE_TASK_KEY = 'school.notificationCenter.prepare';
const DISPATCH_TASK_KEY = 'school.notificationCenter.dispatch';
const SOURCE = 'school.notificationCenter';

function cleanText(value) {
  return String(value || '').trim();
}

async function disableNotificationCenterScheduledTasks(orgId) {
  const orgKey = cleanText(orgId);
  if (!orgKey) return { disabledIds: [] };
  const rows = await scheduledTaskDefinitionRepository.list({
    query: {
      orgId__eq: orgKey,
      source__eq: SOURCE,
      page: 1,
      limit: 500
    }
  });
  const disabledIds = [];
  for (const row of rows) {
    if (row?.enabled !== false || row?.paused !== true) {
      // eslint-disable-next-line no-await-in-loop
      await scheduledTaskDefinitionRepository.update(row.id, { enabled: false, paused: true });
      disabledIds.push(row.id);
    }
  }
  return { disabledIds };
}

/** @deprecated Notification centre is manual-only; disables legacy scheduled task rows. */
async function syncOrgRules(orgId) {
  const orgKey = cleanText(orgId);
  if (!orgKey) return null;
  await notificationCenterRuleService.syncLegacySessionNotFinalRule(orgKey);
  const disabled = await disableNotificationCenterScheduledTasks(orgKey);
  return { ruleCount: 0, activeRefs: [], ...disabled };
}

async function syncAllOrgs() {
  const notificationRuleModel = require('../../models/school/notificationRuleModel');
  const all = await notificationRuleModel.getAllNotificationRules();
  const orgIds = [...new Set(all.map((row) => cleanText(row.orgId)).filter(Boolean))];
  const results = [];
  for (const orgId of orgIds) {
    results.push({ orgId, synced: await syncOrgRules(orgId) });
  }
  return results;
}

module.exports = {
  PREPARE_TASK_KEY,
  DISPATCH_TASK_KEY,
  SOURCE,
  disableNotificationCenterScheduledTasks,
  syncOrgRules,
  syncAllOrgs
};
